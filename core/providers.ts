// The composition root for image vendors. This is the one module that names
// them, and it is imported only by the two callers that already had to: the
// server and the command line. The run is handed a Provider and reaches this
// file for nothing, which is what keeps its import graph free of a vendor.
//
// A check in the smoke suite fails if any vendor reaches the run, so adding one
// here is the whole of what adding a vendor costs.
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
  /** The environment variable that must be set. Named so a refusal can quote it. */
  keyVar: string;
  /** The image sizes this provider can produce, smallest first. */
  sizes: readonly string[];
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

export const providers: ProviderRegistry = { gemini, openai };

/** The provider a request gets when it names none. */
export const DEFAULT_PROVIDER = "gemini";

/** The ceiling the Job applies to any provider that does not name a tighter one. */
export const MAX_CONCURRENCY = 8;

export const providerIds = (): string[] => Object.keys(providers);

export const providerFor = (id: string): Provider | undefined => providers[id];

/**
 * Whether a key is present, never what it is. The browser asks this question and
 * gets a boolean; the key itself does not leave the server.
 */
export const hasKey = (provider: Provider): boolean =>
  Boolean(process.env[provider.keyVar]?.trim());

/** Every provider's key presence, for the Status a browser reads. */
export const keyStatus = (): Record<string, boolean> =>
  Object.fromEntries(Object.values(providers).map((p) => [p.id, hasKey(p)]));

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

/**
 * The most Frames this provider will take at once. Derived from a published
 * per-minute limit rather than chosen, so a tighter tier clamps on its own
 * number instead of on an assumption.
 */
export const maxConcurrencyFor = (provider: Provider): number =>
  provider.imagesPerMinute === null
    ? MAX_CONCURRENCY
    : Math.min(MAX_CONCURRENCY, provider.imagesPerMinute);