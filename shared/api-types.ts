// The module that owns the output folder defines its own types. The three below
// are the wire shapes that are genuinely identical to it, so they are named here
// rather than restated; nothing in the core imports anything from this file, and
// these are type-only imports, so the browser never pulls the module in and with
// it the image library.
import type { FrameRecord, ImportedFrame, PromptItem, SeedRecord } from "../core/output-folder";

export type ImageItem = FrameRecord;
export type ImportResult = ImportedFrame;
/** What the detail route answers with: one Seed's full record, not a summary. */
export type SeedRecordItem = SeedRecord;
export type { PromptItem };

/** One model a Provider offers, as the browser needs to draw it. */
export type ProviderModelInfo = {
  /** The key a request carries. Only meaningful beside its Provider. */
  id: string;
  label: string;
  /** The one size this model produces, or null when it takes any the Provider offers. */
  fixedSize: string | null;
};

/**
 * One Provider the registry knows. The browser is handed this rather than a list
 * of its own, so the models and sizes it offers are the ones the server would
 * accept — there is no second copy in the bundle to drift.
 */
export type ProviderInfo = {
  id: string;
  label: string;
  /** Whether this Provider's key is present. Never the key itself. */
  hasApiKey: boolean;
  /** The sizes this Provider can produce, smallest first. */
  sizes: string[];
  models: ProviderModelInfo[];
  /** The most Frames it will take at once, so the UI can clamp and explain. */
  maxConcurrency: number;
};

export type Status = {
  version: string;
  /** Null when the folder cannot be read. Never a guess at Seed 1: see the ADR. */
  next: number | null;
  done: number;
  /** Null when the folder cannot be read, which is not the same as zero waiting. */
  waiting: number | null;
  /** Seeds whose Prompt a vendor refused. Finished, not waiting: no run will clear them. */
  blocked: number;
  saltSet: boolean;
  /** One entry per Provider the registry knows. */
  providers: ProviderInfo[];
  /** Set when the saved output folder cannot be used, for example after the salt changed. */
  problem?: string;
};

export type PromptsResponse = {
  items: PromptItem[];
};

export type ImportResponse = { results: ImportResult[] };

export type GenerateRequest = {
  count: number;
  /** Which Provider to use. A key from the list Status carries. */
  provider: string;
  /** A model of that Provider's catalog. Only meaningful beside it. */
  model: string;
  /** One of that Provider's sizes. Refused rather than quietly answered with something else. */
  size: string;
  concurrency: number;
  useNegative: boolean;
};

export type JobState = {
  status: "idle" | "running" | "done" | "error";
  provider?: string;
  model?: string;
  total: number;
  done: number;
  failed: number;
  /** Seeds finished because the vendor refused their Prompt. */
  blocked: number;
  startedAt?: string;
  finishedAt?: string;
  /**
   * One line about a limit that bit, kept beside the counts rather than printed:
   * the run says when it clamps to what the Provider takes, and this is where the
   * browser hears it. Absent unless it clamped, so a run that ran as asked does
   * not claim a clamp that did not happen.
   */
  notice?: string;
  error?: string;
  log: { seed: number; ok: boolean; blocked: boolean; message?: string }[];
};