import "dotenv/config";
import OpenAI from "openai";
import { GenerationFailure } from "./errors";
// Both imports are type-only: nothing here is needed to name the Provider or the
// Generator, and the run never loads this module.
import type { Generator } from "./generate";
import type { Provider } from "./providers";

export const MODELS = {
  flare: "gpt-image-2.5-flare", // fast, high-quality everyday generation
  sunburst: "gpt-image-2.5-sunburst", // most capable, tuned for editing
} as const;

export const KEY_MESSAGE =
  "OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.";

/**
 * The largest 2:3 image each rung of the app's ladder can become. 1K matches the
 * ratio OpenAI recommends. 2K is the largest 2:3 that stays inside the
 * guaranteed pixel budget: OpenAI's ceiling is 8,294,400 pixels, which a 16:9
 * frame reaches exactly and a 2:3 frame cannot, and anything past 3,686,400
 * pixels is labelled experimental with no published meaning.
 */
const SIZES: Record<string, string> = {
  "1K": "1024x1536",
  "2K": "1536x2304",
};

/**
 * Every way an exhausted or over-budget account is refused comes back as a 429,
 * indistinguishable by status from a rate limit that clears. Only `code` tells
 * them apart, and re-asking a dead wallet just spends the rest of the budget.
 */
const BILLING = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

type OpenAiError = {
  status?: number;
  code?: string;
  error?: { code?: string; message?: string; moderation_details?: { moderation_stage?: string } };
};

/** Exported for the smoke suite, which drives these rules with the shapes OpenAI raises. */
export const codeOf = (err: unknown): string | undefined => {
  const e = err as OpenAiError;
  return e?.error?.code ?? e?.code;
};

/**
 * Whether another attempt could still succeed. A 429 clears unless it was
 * billing, and a 503 means the model was overloaded. Everything else — a 400
 * from moderation, a 401, a 403 — is answered the same way every time.
 */
export function isRetryable(err: unknown): boolean {
  const e = err as OpenAiError;
  const code = codeOf(err);
  if (code && BILLING.has(code)) return false;
  if (e?.status === 429) return true;
  return e?.status === 503;
}

/**
 * A refused prompt is terminal; a refused render is not. `input` means the
 * Prompt itself was turned away and no run will ever generate this Seed.
 * `output` means the prompt was fine and this particular render lost the draw,
 * so the Seed stays waiting and the next run may well succeed.
 */
export function refused(err: unknown): GenerationFailure | undefined {
  const e = err as OpenAiError;
  if (codeOf(err) !== "moderation_blocked") return undefined;
  const stage = e?.error?.moderation_details?.moderation_stage;
  if (stage !== "input") return undefined;
  return new GenerationFailure(
    "prompt-refused",
    "OpenAI refused this Prompt on moderation grounds. This Seed stays waiting forever unless the Prompt changes.",
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let client: OpenAI | undefined;

export const openaiGenerator: Generator = async (prompt, opts) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(KEY_MESSAGE);
  }
  const size = SIZES[opts.imageSize];
  if (!size) {
    // Not `no-image`: that code says the call came back with nothing in it, and
    // nothing was called at all. This is the app asking for a shape of image this
    // module has no size for, which no run will clear until it asks for one it has.
    throw new GenerationFailure("unsupported-size", `No OpenAI size is configured for ${opts.imageSize}.`);
  }
  client ??= new OpenAI({
    apiKey: key,
    // This module owns the retry policy, so the SDK must not keep a second one
    // underneath it. It retries 429s by default, which on its own would multiply
    // the attempt count and hide the rate limit that caused it.
    maxRetries: 0,
    // A documented image takes up to two minutes and no percentile is published,
    // so this is the documented ceiling with room for the round trip.
    timeout: 180_000,
  });

  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await client.images.generate({
        model: opts.model,
        prompt,
        // One image per request: a refusal fails the whole request, so asking
        // for a batch would throw away the good results with the bad one.
        n: 1,
        size,
        // Pinned rather than left on `auto`, which is not a fixed setting and is
        // not comparable between models.
        quality: "medium",
        output_format: "png",
        // Documented as strictly less restrictive, and free. It does not prevent
        // a refused render, but there is no reason to run the stricter default.
        moderation: "low",
      });
      const data = response.data?.[0]?.b64_json;
      if (!data) throw new GenerationFailure("no-image", "No image in response.");
      return Buffer.from(data, "base64");
    } catch (err) {
      const terminal = refused(err);
      if (terminal) throw terminal;
      if (err instanceof GenerationFailure || attempt >= maxAttempts || !isRetryable(err)) throw err;
      // Exponential from two seconds, capped at thirty, plus a jitter under half
      // a second so a limit that clears for the whole account is not re-asked by
      // every worker in the same instant. Nothing here waits on a header the
      // service may send: the wait is this module's own and is the same for every
      // 429, which is what keeps one rule from quietly changing shape with the
      // error it was handed.
      const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      console.warn(`  retry ${attempt}/${maxAttempts - 1} in ${Math.round(wait)}ms`);
      await sleep(wait);
    }
  }
};

export const openai: Provider = {
  id: "openai",
  label: "OpenAI",
  keyVar: "OPENAI_API_KEY",
  sizes: ["1K", "2K"],
  // One shape, and the request field is not a free-form ratio: OpenAI's image
  // endpoint takes a size, and every size it offers is 2:3. A 16:9 request that
  // reached it would not fail — it would come back as a 2:3 portrait, which is
  // why this list exists at all and why a ratio outside it is refused rather than
  // handed over.
  aspectRatios: ["2:3"],
  // 20 images a minute on the Build tier, and the ceiling is the same on every
  // model. Concurrency is clamped against it, which at the app's own ceiling of
  // 8 leaves nothing to clamp — the number is here so the rule is derived from
  // something published rather than guessed, and so a tighter tier binds on it.
  imagesPerMinute: 20,
  models: [
    { id: "flare", label: "Flare (default)", model: MODELS.flare, fixedSize: null },
    { id: "sunburst", label: "Sunburst (best quality)", model: MODELS.sunburst, fixedSize: null },
  ],
  refuseSize: (size) =>
    `OpenAI cannot produce ${size} at 2:3. Its largest is 1536x2304, which is smaller than Gemini's 2K, so Frames made here carry less detail in out/raw.`,
  generate: openaiGenerator,
};
