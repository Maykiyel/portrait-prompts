import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { GenerationFailure } from "./errors";
// The seam is declared by the module that stands on it, so this file is the
// implementation of a shape it does not own. Both imports are type-only: nothing
// here is needed to name the Provider or the Generator, and the run never loads
// this module.
import type { Generator } from "./generate";
import type { Provider } from "./providers";

export const MODELS = {
  lite: "gemini-3.1-flash-lite-image", // fastest and cheapest, 1K only
  flash: "gemini-3.1-flash-image", // default, general use
  pro: "gemini-3-pro-image", // highest quality
} as const;

export const KEY_MESSAGE =
  "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Google reports a structured code, but the thrown value carries only a message
 * and a status, so the code arrives as JSON text inside the message. It is read
 * from the first brace to the last rather than from the whole string, because the
 * SDK prefixes the JSON with the error's own wording and appends nothing
 * reliable. Anything that is not JSON is not a code, which leaves the caller on
 * the status-based rules below.
 */
export function codeOf(err: unknown): string | undefined {
  const message = (err as { message?: string })?.message ?? "";
  const first = message.indexOf("{");
  const last = message.lastIndexOf("}");
  if (first < 0 || last <= first) return undefined;
  try {
    return (JSON.parse(message.slice(first, last + 1)) as { error?: { code?: string } })?.error?.code;
  } catch {
    return undefined;
  }
}

/**
 * Whether another attempt could still succeed. A per-minute limit clears on its
 * own; a per-day quota and a billing refusal never clear, so they fail at once
 * rather than spending the rest of the budget re-asking.
 *
 * Exported so the smoke suite can drive it with the shapes Google actually
 * raises, rather than only through a run that cannot make one.
 */
export function isRetryable(err: unknown): boolean {
  const code = codeOf(err);
  if (code === "quota_exceeded" || code === "payment_required") return false;
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e?.status ?? e?.statusCode;
  if (status && RETRYABLE.has(status)) return true;
  // A dropped connection carries no status at all, so it is matched by name.
  return /fetch failed|ECONNRESET|ETIMEDOUT|overloaded/i.test(e?.message ?? "");
}

/**
 * A refusal that no amount of retrying will clear becomes the Prompt's last
 * word. Exported for the same reason as the classifier above.
 */
export function refused(err: unknown): GenerationFailure | undefined {
  const code = codeOf(err);
  if (code === "image_safety") {
    return new GenerationFailure(
      "prompt-refused",
      "Gemini refused this Prompt on safety grounds. This Seed stays waiting forever unless the Prompt changes.",
    );
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let client: GoogleGenAI | undefined;

export const geminiGenerator: Generator = async (prompt, opts) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(KEY_MESSAGE);
  }
  client ??= new GoogleGenAI({});

  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      const interaction = await client.interactions.create(
        {
          model: opts.model,
          input: prompt,
          response_format: {
            type: "image",
            aspect_ratio: opts.aspectRatio,
            image_size: opts.imageSize,
          },
        },
        // This module owns the retry policy, so the SDK must not keep a second
        // one underneath it: left alone it retries a 429 four times before this
        // loop sees anything, and `maxAttempts` would multiply that.
        { maxRetries: 0 },
      );
      const img = interaction.output_image;
      if (!img?.data) {
        const text = interaction.output_text ?? "no text returned";
        throw new GenerationFailure("no-image", `No image in response. Model said: ${text}`);
      }
      return Buffer.from(img.data, "base64");
    } catch (err) {
      const terminal = refused(err);
      if (terminal) throw terminal;
      if (err instanceof GenerationFailure || attempt >= maxAttempts || !isRetryable(err)) throw err;
      const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      console.warn(`  retry ${attempt}/${maxAttempts - 1} in ${Math.round(wait)}ms`);
      await sleep(wait);
    }
  }
};

export const gemini: Provider = {
  id: "gemini",
  label: "Gemini",
  keyVar: "GEMINI_API_KEY",
  sizes: ["1K", "2K", "4K"],
  // Google no longer publishes per-model image limits, so nothing is claimed
  // here that cannot be checked. The app's own ceiling stands.
  imagesPerMinute: null,
  models: [
    { id: "flash", label: "Flash (default)", model: MODELS.flash, fixedSize: null },
    { id: "lite", label: "Flash Lite (cheapest, 1K only)", model: MODELS.lite, fixedSize: "1K" },
    { id: "pro", label: "Pro (best quality)", model: MODELS.pro, fixedSize: null },
  ],
  refuseSize: (size) => `Gemini cannot produce ${size}.`,
  generate: geminiGenerator,
};