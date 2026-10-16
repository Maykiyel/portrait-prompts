import type { RunRequest } from "./generate";
// The registry is handed in rather than imported, which is the whole reason this
// module can read a default model out of a catalog: a value import would put the
// registry — and with it every vendor SDK — in the import graph of everything that
// reads the policy, and the policy is read by the run's own callers rather than by
// the run. The type is enough to say what a registry is, and costs nothing to load.
import type { ProviderRegistry } from "./providers";

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
 * The values that do not depend on the Provider are written out once, and the two
 * that do are asked of the registry the caller already holds. Which Provider a
 * run gets, and which model that Provider is asked for, are both facts about a
 * vendor — so they are resolved against a registry rather than baked in here,
 * and this file cannot name a model the catalog does not offer. That is also why
 * it takes the registry as an argument: a module that imported one would drag both
 * vendor SDKs into every consumer of the policy — the server, the command line
 * and the suite — to read a default model.
 */
export type GenerationPolicy = Pick<
  RunRequest,
  "count" | "concurrency" | "provider" | "model" | "aspectRatio" | "imageSize" | "useNegative"
>;

/** The Provider a run gets when nobody names one. It is policy, so it lives here. */
export const DEFAULT_PROVIDER = "gemini";

/**
 * Which model the policy means for each Provider, by the key a request names. A
 * key rather than a vendor string, because the catalog is what says what a key is
 * called — and a Provider added to the registry without a line here has no default
 * model, which is said out loud rather than answered with whichever model happens
 * to be first in the list.
 */
const DEFAULT_MODELS: Record<string, string> = { gemini: "flash", openai: "flare" };

/** What a run is asked for when nothing about the Provider has been said. */
const defaults = {
  count: 10,
  concurrency: 3,
  aspectRatio: "2:3",
  imageSize: "1K",
  useNegative: true,
} satisfies Omit<GenerationPolicy, "provider" | "model">;

/**
 * The policy for one Provider, resolved against the registry that holds it.
 * Both roots already hold a registry — they name their vendors — so neither has to
 * reach for one to ask this.
 */
export const policyFor = (
  registry: ProviderRegistry,
  providerId = DEFAULT_PROVIDER,
): GenerationPolicy => {
  const modelId = DEFAULT_MODELS[providerId];
  const model = registry[providerId]?.models.find((m) => m.id === modelId);
  // Refused rather than guessed. A policy that named a Provider no registry holds,
  // or a model that Provider does not offer, would hand the run a model string that
  // fails every Seed — and the message says which half of the catalog came up
  // empty, because "the default is wrong" names neither.
  if (!model)
    throw new Error(
      `the policy names what the catalog does not offer: ${providerId}/${modelId ?? "no default model"}`,
    );
  return { ...defaults, provider: providerId, model: model.model };
};