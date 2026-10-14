import { MODELS } from "./gemini";
import type { RunRequest } from "./generate";

/**
 * What a generation run does when nobody has said otherwise: which model, how
 * many Seeds, how many at a time, what shape, how big, and whether the Prompt
 * carries the Negative list.
 *
 * It is stated once, here, beside the run rather than in either of the callers.
 * The command line reads it and lets its flags override the relevant value; the
 * Job reads it and lets the request override the relevant values. Neither
 * declares its own, so the terminal and the browser cannot come to disagree
 * about the model or the concurrency.
 *
 * It is `Pick<RunRequest, ...>` on purpose. That is the run's own shape, so the
 * policy cannot state a value the run would not take, and the excess-property
 * check on an object literal means a value the run does *not* take — a dry run,
 * a folder, a salt — cannot be added here without the typecheck turning red.
 * Those three are not generation policy and do not belong here: a dry run has no
 * business being the server's default, a dataset's root is where the data lives
 * and is injected by whoever owns the dataset, and a Seed salt is never a
 * default at all — it is handed in by whoever starts a run, so that two people
 * running the same workbench get different Prompts rather than the same ones.
 *
 * This is a module of its own beside `core/generate.ts` rather than a line in
 * it, for one reason: naming the default model means naming a vendor, and
 * `core/generate.ts` deliberately names no vendor and stands on nothing but the
 * module that owns the output folder. Putting the model string here keeps the
 * run's import graph free of the vendor client — `MODELS` lives in the module
 * that owns the model names, so this file reads them rather than repeating them.
 */
export type GenerationPolicy = Pick<
  RunRequest,
  "count" | "concurrency" | "model" | "aspectRatio" | "imageSize" | "useNegative"
>;

export const policy: GenerationPolicy = {
  count: 10,
  concurrency: 3,
  model: MODELS.flash,
  aspectRatio: "2:3",
  imageSize: "1K",
  useNegative: true,
};