import type { QCResult, QcFlag, QcStatus } from "./qc";

/**
 * The canonical shape of the archive's own record of what happened, as one name
 * per concept and no alias for any of them. This module holds nothing but those
 * names: it names no file, reads nothing and computes nothing, so the row shape
 * can be read by anyone without anyone having to own the folder to read it.
 *
 * Every field below that can legitimately be missing is marked optional, and
 * missing means unknown. Nothing here is ever filled with a placeholder string
 * to stand in for a fact nobody recorded. A value of `null` is the separate
 * case: it records that the thing does not apply, which is what a Provider is
 * on a row a person imported by hand.
 */

/** The schema version on every row this work writes. A row without one is older than this. */
export type SchemaVersion = 2;

/** Where the bytes on a row came from. */
export type FrameSource = "api" | "manual";

/**
 * Who sampled the attributes a row records.
 *
 * `run` is a generation run, which sampled the Portrait as part of building the
 * Prompt. `import` is a manual import, which sampled it separately, at import
 * time, to describe an image that was made somewhere else entirely. Both are
 * samples by this sampler, and neither is a claim about what the vendor was
 * actually asked for beyond the Prompt beside it.
 */
export type AttributesSource = "run" | "import";

/**
 * The outcome of one generation or import attempt.
 *
 * `blocked` is a failure no later run will clear, because the Provider refused
 * the Prompt itself rather than the request. It is recorded apart from `failed`
 * because the two are answered differently: a failed Seed runs again, a blocked
 * one is finished. A review row carries no status at all, because a review is a
 * decision about a Frame rather than an attempt to make one.
 */
export type GenerationStatus = "ok" | "failed" | "blocked";

/** What a person decided about a finished Frame. */
export type ReviewDecision = "accepted" | "rejected";

/**
 * What is known about a Seed's review.
 *
 * `unreviewed` is not a fourth decision. It is the state a Seed is in when no
 * review row names it, which is a recorded fact about the archive rather than a
 * gap in it, so it is spelled out rather than left absent. A decision and the
 * absence of one are the same field with different values, and the field never
 * goes missing.
 */
export type ReviewState = "unreviewed" | ReviewDecision;

/**
 * The three states of one Seed, each read from its own row and from no other.
 *
 * They are kept apart because they answer three different questions. How the
 * last attempt to make a Frame came to is a fact about an attempt. What its
 * quality checks said is a fact about the bytes that attempt produced. What a
 * person decided about the Frame afterwards is a fact about a person. A review
 * row records the third and is therefore never read for the first, and the
 * first two are read from the same row because they describe the same attempt:
 * a Seed is never described by one attempt's outcome beside another's checks.
 *
 * The first two are absent when the row that would carry them does not. That is
 * how this archive says it does not know, and it is why nothing here is ever
 * filled with a placeholder string. The third is never absent, because a Seed
 * no person has looked at is `unreviewed` rather than unknown.
 */
export type SeedState = {
  /** The outcome of the latest generation or import row for this Seed. */
  generationStatus?: GenerationStatus;
  /** The roll-up that same row's QC record reached. */
  qcStatus?: QcStatus;
  /** What a person last decided about this Seed's Frame. */
  reviewState: ReviewState;
};

/** Why a Frame was rejected. Absent when nobody said, which is what a legacy row is. */
export type ReviewReason =
  | "attribute_mismatch"
  | "visible_artifacts"
  | "not_a_portrait"
  | "duplicate"
  | "image_quality"
  | "policy"
  | "other";

/** The complete list of review reasons, in one place. */
export const REVIEW_REASONS: ReviewReason[] = [
  "attribute_mismatch", "visible_artifacts", "not_a_portrait", "duplicate", "image_quality", "policy", "other",
];

/** Which store a byte set lives in. */
export type DuplicateLocation = "archive" | "quarantine";

/** Which bytes of a Frame two rows are being compared through. */
export type DuplicateKind = "raw" | "normalized";

/** One optional detail, as the row records it: the pool it came from and the text chosen. */
export type PortraitDetail = { category: string; text: string };

/** The two tone bands the sampled attributes landed in. */
export type SkinEyeBands = { skin: string; eye: string };

/**
 * The request shape a Provider was asked for. `null` on a manual import, because
 * no Provider was asked for anything: the bytes came off a disk.
 */
export type GenerationParams = {
  aspectRatio: string;
  imageSize: string;
  useNegative: boolean;
  /** The version of the instruction the Provider wrapped the Prompt in. Absent when it sent the Prompt alone. */
  promptWrapper?: string;
};

/** What one set of bytes hashes to, and how big and how shaped it was. */
export type ImageDigest = { sha256: string; bytes: number; width: number; height: number };

/**
 * The steps the normalized artifact was built with, recorded so a reader can
 * tell what the pipeline did without having to believe it happened twice.
 */
export type NormalizeSteps = { fit: string; position: string; format: string };

/** The digest of the artifact actually written to the archive, and the steps that made it. */
export type NormalizedDigest = ImageDigest & { steps: NormalizeSteps };

/**
 * What a reader may find recorded about one set of bytes. The digest itself is
 * always there when a row names one at all; the size and the dimensions are
 * absent on a row written before they were recorded, and a reader says so rather
 * than reporting zeroes it did not measure.
 */
export type RecordedImageDigest = { sha256: string; bytes?: number; width?: number; height?: number };

/** The same, for the written artifact, whose steps may also be absent on an old row. */
export type RecordedNormalizedDigest = RecordedImageDigest & { steps?: NormalizeSteps };

/**
 * Where a Frame was put because it was refused as it arrived, and why. The
 * `path` is the quarantine copy of the bytes received, which is kept verbatim
 * and is not the artifact no Frame was ever written from.
 */
export type IngestQuarantine = { path: string; reason: string };

/** The two files a rejection moved aside: the Frame and the bytes it was made from. */
export type ReviewQuarantine = { frame: string; raw: string };

/**
 * The duplicate check's record of what it found.
 *
 * Absent from every row until the duplicate check runs. An empty list would
 * claim a check that never happened, which is the one thing an absent key is
 * for.
 */
export type DuplicateRecord = {
  algo: string;
  threshold: number;
  exact: { seed: number; where: DuplicateLocation; kind: DuplicateKind }[];
  perceptual: { seed: number; where: DuplicateLocation; distance: number }[];
  uncomparable: { seed: number; reason: string }[];
};

/**
 * One Seed sampled once: the Prompt that text built and the attributes that
 * filled it. The two travel together because they are two views of a single
 * draw, and a row that recorded one from one draw and the other from another
 * would describe a Portrait nobody ever asked for.
 */
export type SampledPortrait = {
  seed: number;
  /** The finished Prompt, lead-in and Negative list included. */
  prompt: string;
  /** The placeholder values that filled the template. */
  attributes: Record<string, string>;
  details: PortraitDetail[];
  /** The group the first ethnicity draw chose. */
  primaryGroup: string;
  /** The groups in the order they are named in the Prompt, which is not always this one first. */
  groups: string[];
  ethnicities: string[];
  photographyProfile: string;
  bands: SkinEyeBands;
};

/**
 * A generation or import row, as this work writes it.
 *
 * The fields a completed ingestion always carries are the ones every row below
 * that has bytes carries too. The rest are absent exactly when the attempt
 * could not know them: a Provider and a model that were never named, the bytes
 * and the QC record of an attempt that received none, and the duplicate record
 * of a check that has not run.
 */
export type GenerationRow = {
  schema: SchemaVersion;
  seed: number;
  /** The Prompt version tag. */
  version: string;
  salt: string;
  ts: string;
  status: GenerationStatus;
  /** Why it failed. Absent when it did not. */
  error?: string;
  source: FrameSource;
  /** `null` on a manual row. Absent when an api row did not say which Provider made it. */
  provider?: string | null;
  /** `null` on a manual row. Absent when an api row did not say which model made it. */
  model?: string | null;
  /** The name the downloaded file had, for a manual row. */
  file?: string;
  /** The exact Prompt used. */
  prompt: string;
  /** The first 12 hex characters of the sha256 of the template file text. */
  templateHash: string;
  /** The first 12 hex characters of the sha256 of the sampler's definition tables. */
  samplerHash: string;
  attributes?: Record<string, string>;
  details?: PortraitDetail[];
  primaryGroup?: string;
  groups?: string[];
  ethnicities?: string[];
  photographyProfile?: string;
  bands?: SkinEyeBands;
  attributesSource?: AttributesSource;
  params?: GenerationParams | null;
  /** The bytes as they arrived, hashed before anything touched them. */
  raw?: ImageDigest;
  /** The bytes written to the archive. Absent when no artifact was written. */
  normalized?: NormalizedDigest;
  qc?: QCResult;
  duplicates?: DuplicateRecord;
  /** Set when the Frame was refused as it arrived. */
  quarantine?: IngestQuarantine;
};

/** A review decision, appended as a row of its own. The Manifest is append-only. */
export type ReviewRow = {
  schema: SchemaVersion;
  seed: number;
  kind: "review";
  review: ReviewDecision;
  reason?: ReviewReason;
  note?: string;
  ts: string;
  quarantine?: ReviewQuarantine;
};

/**
 * Which build wrote a row. There is no fourth answer.
 *
 * `current` is every row this work writes. `legacy` predates the schema and
 * carries none of the fields below beyond what it was written with.
 * `interim` is the unfinished v6 build: it recorded the same facts under
 * several names at once, and the names that survive are the ones that were
 * right, which is not all of them.
 */
export type RowOrigin = "current" | "legacy" | "interim";

/**
 * One row as a reader hands it back.
 *
 * This is the shape every reader sees, whatever wrote the row. A field is
 * present when the row recorded it and absent when it did not, so a legacy row
 * reads with almost everything missing rather than with invented values. A
 * `rejected` legacy row reads as a review decision, because that is what a
 * rejection was written to mean.
 */
export type ManifestRow = {
  origin: RowOrigin;
  seed: number;
  schema?: SchemaVersion;
  version?: string;
  salt?: string;
  ts?: string;
  /** The generation or import outcome. A review row has none. */
  status?: GenerationStatus;
  error?: string;
  source?: FrameSource;
  provider?: string | null;
  model?: string | null;
  file?: string;
  prompt?: string;
  templateHash?: string;
  samplerHash?: string;
  attributes?: Record<string, string>;
  details?: PortraitDetail[];
  primaryGroup?: string;
  groups?: string[];
  ethnicities?: string[];
  photographyProfile?: string;
  bands?: SkinEyeBands;
  attributesSource?: AttributesSource;
  params?: GenerationParams | null;
  raw?: RecordedImageDigest;
  normalized?: RecordedNormalizedDigest;
  qc?: QCResult;
  duplicates?: DuplicateRecord;
  quarantine?: IngestQuarantine | ReviewQuarantine;
  review?: ReviewDecision;
  reason?: ReviewReason;
  note?: string;
};

/** The roll-up a FrameRecord shows, taken from the QC record rather than recomputed. */
export type { QCResult, QcFlag, QcStatus };
