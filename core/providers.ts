// The composition root for image vendors. This is the one module that names
// them, and it is imported only by the two callers that already had to: the
// server and the command line. The run is handed a Provider and reaches this
// file for nothing, which is what keeps its import graph free of a vendor.
//
// A check in the smoke suite fails if any vendor reaches the run, so adding one
// here is the whole of what adding a vendor costs.
import { codex } from "./codex";
import { gemini } from "./gemini";
import { openai } from "./openai";
import type { Generator } from "./generate";

/** One model a Provider offers, named the way a request names it. */
export type ProviderModel = {
  /** The key a request carries. Only meaningful beside its provider. */
  id: string;
  label: string;
  /** What the vendor calls it. This is what reaches the Manifest. */
  model: string;
  /**
   * The one size this model produces, or null when it takes any the Provider
   * offers. A model with a single size resolves to it rather than refusing,
   * because there is nothing to substitute — asking for lite is asking for 1K.
   */
  fixedSize: string | null;
};

/** Whether a Provider can run now, and when it cannot, the sentence that says why. */
export type Readiness = { ok: true } | { ok: false; message: string };

/**
 * Everything the app needs to know about one image vendor, and nothing it does
 * not: which models it offers, which environment variable holds its key, which
 * sizes it can produce, how fast it will take them, and the one function that
 * makes an image. Each of those lives here because a caller above the registry
 * has no business knowing any of them.
 */
export type Provider = {
  id: string;
  label: string;
  /**
   * The environment variable that must be set. Named so a refusal can quote it.
   * Null for a Provider that signs in some other way, which then says through
   * `ready` whether it can run.
   */
  keyVar: string | null;
  /**
   * Whether it can run, for a Provider whose readiness is more than a key. Absent
   * means the key decides. See ADR 0004.
   */
  ready?: () => Promise<Readiness>;
  /**
   * Called once the run is finished with a Seed's attempt: its Frame stored or its
   * failure recorded. A Provider that leaves files of its own behind removes them
   * here, after the archive holds what it needs. Absent when there is nothing to do.
   */
  afterAttempt?: (seed: number) => void;
  /**
   * The version of the instruction this Provider wraps every Prompt in, when it
   * wraps one. Recorded on each Manifest row it writes, so a Frame can be traced
   * to the exact text sent and not only to the Prompt inside it.
   */
  promptWrapper?: string;
  /**
   * The most Frames it will make at once, when that is a fact about the vendor
   * rather than a rate. Absent means the per-minute limit decides.
   */
  maxConcurrency?: number;
  /**
   * How many failures in a row end a run. Absent means a run tries every Seed it
   * claimed. Set by a Provider whose failures tend to repeat, such as a tool that
   * has stopped working, so a batch does not spend itself proving it.
   */
  stopAfterFailures?: number;
  /** The image sizes this provider can produce, smallest first. */
  sizes: readonly string[];
  /**
   * The shapes it can produce, or null when it publishes no list. Null rather
   * than an enumeration, because the vendor SDK is handed the ratio either way
   * and a list written here would be a guess at what it accepts; a name that is
   * in a list is a refusal the caller can act on before a request is spent.
   */
  aspectRatios: readonly string[] | null;
  models: readonly ProviderModel[];
  /** Images it will accept per minute, when it publishes a limit. Null when it does not. */
  imagesPerMinute: number | null;
  /** What it says when asked for a size it cannot produce. */
  refuseSize: (size: string) => string;
  generate: Generator;
};

/**
 * Every Provider the app knows, keyed by the id a request names. Handed in
 * rather than imported at each use, so a test can stand up an app with a fake
 * that makes images and no test has to reach a network.
 */
export type ProviderRegistry = Record<string, Provider>;

export const providers: ProviderRegistry = { gemini, openai, codex };

/** The ceiling the run applies to any provider that does not name a tighter one. */
export const MAX_CONCURRENCY = 8;

export const providerIds = (): string[] => Object.keys(providers);

/**
 * Whether a Provider can run, never what its key is. A Provider with its own
 * `ready` answers for itself; any other is ready when its key is present. The
 * browser gets the answer and the sentence, and the key itself does not leave
 * the server.
 */
export const readiness = async (provider: Provider): Promise<Readiness> => {
  if (provider.ready) return provider.ready();
  if (provider.keyVar === null) return { ok: true };
  return process.env[provider.keyVar]?.trim()
    ? { ok: true }
    : { ok: false, message: `${provider.keyVar} is not set. Add it to .env and restart the server.` };
};

/**
 * What the run takes from a Provider, gathered once so the two callers that start
 * runs hand over the same facts and neither keeps a list that can fall behind.
 */
export const runPartsFor = (provider: Provider) => ({
  generate: provider.generate,
  maxConcurrency: maxConcurrencyFor(provider),
  ...(provider.stopAfterFailures !== undefined ? { stopAfterFailures: provider.stopAfterFailures } : {}),
  ...(provider.afterAttempt ? { afterAttempt: provider.afterAttempt } : {}),
  ...(provider.promptWrapper ? { promptWrapper: provider.promptWrapper } : {}),
});

export const modelOf = (provider: Provider, id: string): ProviderModel | undefined =>
  provider.models.find((m) => m.id === id);

/** The size that will actually be asked for, or a refusal naming the real limit. */
export type SizePlan = { ok: true; size: string } | { ok: false; refused: string };

export const sizeFor = (
  provider: Provider,
  model: ProviderModel,
  requested: string,
): SizePlan => {
  if (model.fixedSize) return { ok: true, size: model.fixedSize };
  if (provider.sizes.includes(requested)) return { ok: true, size: requested };
  // Refused rather than quietly answered with something smaller. The app does
  // not do another thing than the one it was asked for.
  return { ok: false, refused: provider.refuseSize(requested) };
};

/** The shape that will actually be asked for, or a refusal naming the real limit. */
export type AspectPlan = { ok: true } | { ok: false; refused: string };

/**
 * Whether this Provider can make the shape that was asked for. A Provider that
 * publishes no list takes what it is given, because the vendor SDK decides, so
 * nothing is refused there and a ratio that works today keeps working. One that
 * names a list is refusing everything outside it, because returning a different
 * shape under the name of the one asked for is the same defect as a size that
 * quietly drops.
 */
export const aspectFor = (provider: Provider, requested: string): AspectPlan => {
  if (provider.aspectRatios === null || provider.aspectRatios.includes(requested)) return { ok: true };
  const shapes = provider.aspectRatios.join(" and ");
  return {
    ok: false,
    refused: `${provider.label} makes ${shapes} only, so a ${requested} Frame would be filed as a ${shapes} one.`,
  };
};

/**
 * The most Frames this provider will take at once. Derived from a published
 * per-minute limit rather than chosen, so a tighter tier clamps on its own
 * number instead of on an assumption.
 */
export const maxConcurrencyFor = (provider: Provider): number =>
  Math.min(
    MAX_CONCURRENCY,
    provider.imagesPerMinute ?? MAX_CONCURRENCY,
    provider.maxConcurrency ?? MAX_CONCURRENCY,
  );
