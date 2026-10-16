// The vendor classifiers, driven directly with the shapes each vendor actually
// raises. Everything else in the suite reaches these rules through a run whose
// Generator is a fake, so none of it can make a 429, a quota refusal or a
// moderation block happen — which leaves the logic that decides whether a run
// spends the rest of its budget re-asking, or stops, or gives up on a Seed for
// good, without any coverage at all.
//
// These are the rules worth the most and the easiest to get quietly wrong: a
// billing 429 that is retried burns the whole attempt budget against a dead
// wallet, and a refused render treated as a refused Prompt throws away a Seed
// that the next run would have made.
//
// No network, no client construction, no key. Every row below is a value the
// vendor's documented error object is built from.
import {
  codeOf as geminiCode, isRetryable as geminiRetryable, refused as geminiRefused,
} from "../core/gemini";
import {
  codeOf as openAiCode, isRetryable as openAiRetryable, refused as openAiRefused,
} from "../core/openai";
import { GenerationFailure } from "../core/errors";
import { check, results } from "./smoke-harness";

/** Google's thrown value: a status, and a message carrying a JSON body after its own wording. */
const googleError = (status: number, body?: Record<string, unknown>, prefix = "got a problem:") => ({
  status,
  message: body ? `${prefix} ${JSON.stringify({ error: body })}` : prefix,
});

/** OpenAI's thrown value: the code sits on the error object, with the body beside it. */
const openAiError = (status: number, code?: string, moderationStage?: string) => ({
  status,
  code,
  error: {
    code,
    message: code ?? "failed",
    ...(moderationStage ? { moderation_details: { moderation_stage: moderationStage } } : {}),
  },
});

// ---- Gemini -----------------------------------------------------------------
// The code arrives as JSON inside the message, so the reader has to find the
// object rather than parse the whole string. Both of these rows are that claim.
results.push(check(
  "Google's code is read out of the message, past the SDK's own wording",
  geminiCode(googleError(429, { code: "rate_limit_exceeded" }, "API error: ")) === "rate_limit_exceeded" &&
    geminiCode(googleError(400, { code: "INVALID_ARGUMENT" })) === "INVALID_ARGUMENT" &&
    // Trailing prose after the JSON must not stop it being found.
    geminiCode({ status: 400, message: `x {"error":{"code":"Z"}} trailing` }) === "Z",
));

results.push(check(
  "a message that is not JSON is not a code, and leaves the caller on the status rules",
  geminiCode(googleError(429)) === undefined &&
    geminiCode(googleError(400, { nope: true })) === undefined &&
    geminiCode({ status: 400, message: "no braces here" }) === undefined &&
    geminiCode(undefined) === undefined,
));

const geminiRetries: [boolean, unknown][] = [
  [true, googleError(429, { code: "rate_limit_exceeded" })],
  [true, googleError(503, { code: "unavailable" })],
  [false, googleError(429, { code: "quota_exceeded" })],
  [false, googleError(402, { code: "payment_required" })],
  [false, googleError(400, { code: "INVALID_ARGUMENT" })],
  [true, { message: "fetch failed" }],
  [true, { message: "ECONNRESET" }],
  [false, googleError(400, { code: "image_safety" })],
];
results.push(check(
  "Gemini's classifier retries only what another attempt could clear",
  geminiRetries.every(([expected, err]) => geminiRetryable(err) === expected) &&
    geminiRetries.length === 8,
));

results.push(check(
  "Gemini's quota rule is decided by code, not by the wording of the message",
  // The three phrases the classifier used to match on. If any of them still
  // decides anything, this fails — the strings appear in no current Google doc,
  // so a rule resting on them is resting on nothing.
  geminiRetryable({ status: 429, message: "limit: 0 for this project" }) === true &&
    geminiRetryable({ status: 429, message: "please upgrade your tier" }) === true &&
    geminiRetryable({ status: 429, message: "quota exceeded per day" }) === true &&
    geminiRetryable({ status: 429, message: "RESOURCE_EXHAUSTED" }) === true,
));

results.push(check(
  "Gemini's safety refusal is the one failure that ends a Seed",
  (() => {
    const safety = geminiRefused(googleError(400, { code: "image_safety" }));
    return safety instanceof GenerationFailure && safety.code === "prompt-refused" &&
      geminiRefused(googleError(400, { code: "INVALID_ARGUMENT" })) === undefined &&
      geminiRefused(googleError(429, { code: "rate_limit_exceeded" })) === undefined &&
      geminiRefused(undefined) === undefined;
  })(),
));

// ---- OpenAI -----------------------------------------------------------------
results.push(check(
  "OpenAI's code is read from the error object, with the top-level field as the fallback",
  openAiCode(openAiError(429, "slow_down")) === "slow_down" &&
    openAiCode({ status: 429, code: "rate_limit_exceeded" }) === "rate_limit_exceeded" &&
    openAiCode({ status: 400 }) === undefined,
));

// The one that matters most: every way a dead wallet is refused arrives as a
// 429, the same status as a rate limit that clears. Told apart by code alone,
// because status and message cannot tell them.
const openAiRetries: [boolean, unknown][] = [
  [true, openAiError(429, "slow_down")],
  [true, openAiError(429)],
  [true, openAiError(503, "server_is_overloaded")],
  [false, openAiError(429, "credit_balance_exhausted")],
  [false, openAiError(429, "organization_spend_limit_exceeded")],
  [false, openAiError(429, "project_spend_limit_exceeded")],
  [false, openAiError(429, "organization_usage_limit_exceeded")],
  [false, openAiError(400, "moderation_blocked", "input")],
  [false, openAiError(400)],
  [false, openAiError(401)],
];
results.push(check(
  "OpenAI's classifier tells a dead wallet from a live rate limit by code, not by status",
  openAiRetries.every(([expected, err]) => openAiRetryable(err) === expected) &&
    // Every billing row shares the 429 that a retryable row also uses, so this
    // is only a real claim because both kinds are here.
    openAiRetries.filter(([, e]) => (e as { status: number }).status === 429).length === 6 &&
    openAiRetries.length === 10,
));

results.push(check(
  "a refused render is a failure to retry, while a refused prompt ends the Seed",
  (() => {
    const onInput = openAiRefused(openAiError(400, "moderation_blocked", "input"));
    const onOutput = openAiRefused(openAiError(400, "moderation_blocked", "output"));
    const stageUnknown = openAiRefused(openAiError(400, "moderation_blocked"));
    return onInput instanceof GenerationFailure && onInput.code === "prompt-refused" &&
      // The same 400 and the same code. Only the stage tells them apart, and
      // getting it backwards would abandon a Prompt that works.
      onOutput === undefined && stageUnknown === undefined &&
      openAiRetryable(openAiError(400, "moderation_blocked", "output")) === false &&
      openAiRefused(openAiError(429, "slow_down")) === undefined &&
      openAiRefused(undefined) === undefined;
  })(),
));

// ---- The two, side by side --------------------------------------------------
// The whole point of a Provider is that these differ in detail and agree in
// shape. If they ever have to be made to agree by editing a caller, the seam
// has stopped earning its keep.
const shared: [string, boolean, boolean][] = [
  // label, what Gemini's classifier says, what OpenAI's says
  ["a per-minute rate limit", geminiRetryable(googleError(429, { code: "rate_limit_exceeded" })), openAiRetryable(openAiError(429, "slow_down"))],
  ["a server error", geminiRetryable(googleError(503)), openAiRetryable(openAiError(503, "server_is_overloaded"))],
  ["an exhausted quota", geminiRetryable(googleError(429, { code: "quota_exceeded" })), openAiRetryable(openAiError(429, "credit_balance_exhausted"))],
  ["a bad request", geminiRetryable(googleError(400)), openAiRetryable(openAiError(400))],
  ["an auth failure", geminiRetryable(googleError(401)), openAiRetryable(openAiError(401))],
];
results.push(check(
  "both classifiers answer the same question the same way for the same situations",
  shared.every(([, gemini, openai]) => gemini === openai) && shared.length === 5,
));

export const classifiersRun = (): boolean => results.every(Boolean);