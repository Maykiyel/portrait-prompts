import { DEFAULT_PROVIDER, providers } from "./providers";
import type { RunRequest } from "./generate";

/**
 * What a generation run does when nobody has said otherwise: which Provider,
 * which model, how many Seeds, how many at a time, what shape, how big, and
 * whether the Prompt carries the Negative list.
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
 * The default model is read from the registry rather than written out, so this
 * file cannot name a model the catalog does not offer. It states which model it
 * means and lets the Provider say what that model is called, which is the same
 * division the run already keeps: the run is told what to make, not who makes it.
 */
export type GenerationPolicy = Pick<
  RunRequest,
  "count" | "concurrency" | "provider" | "model" | "aspectRatio" | "imageSize" | "useNegative"
>;

/** The model id the default Provider calls the named model. Throws rather than guessing. */
const defaultModel = (providerId: string, modelId: string): string => {
  const provider = providers[providerId];
  const model = provider?.models.find((m) => m.id === modelId);
  if (!model) throw new Error(`the default policy names a model the catalog does not offer: ${providerId}/${modelId}`);
  return model.model;
};

export const policy: GenerationPolicy = {
  count: 10,
  concurrency: 3,
  provider: DEFAULT_PROVIDER,
  model: defaultModel(DEFAULT_PROVIDER, "flash"),
  aspectRatio: "2:3",
  imageSize: "1K",
  useNegative: true,
};