import type {
  AttributesSource, DuplicateRecord, FrameSource, GenerationParams, GenerationStatus,
  IngestQuarantine, ManifestRow, NormalizeSteps, PortraitDetail, RecordedImageDigest,
  RecordedNormalizedDigest, ReviewDecision, ReviewQuarantine, ReviewReason, RowOrigin,
  SampledPortrait, SkinEyeBands,
} from "./manifest-types";
import type { QCResult } from "./qc";

/**
 * One reader for every row in the archive, whatever wrote it.
 *
 * The archive is append-only, so its oldest rows are the ones a reader has the
 * least right to improve. This module therefore has one rule and no exception
 * to it: a field is returned when the row recorded it and left out when it did
 * not. Nothing is defaulted, nothing is back-filled from the current sampler and
 * nothing is guessed from a sibling row. A row written before a fact was
 * recorded reads without that fact, and that absence is the answer.
 */

/**
 * Every key the writer before schema 2 could put in a row.
 *
 * This list is what tells the three builds apart. A row with no `schema` whose
 * keys are all on it was written by that writer and reads as `legacy`. A row
 * with no `schema` carrying any key off it was written by the unfinished v6
 * build, which recorded the same facts under several names at once, and reads
 * as `interim`.
 *
 * The rule is a list of what the old writer could write rather than a list of
 * the names the unfinished build added, so a name it invented later is
 * classified by existing rather than by having been remembered here.
 */
const LEGACY_KEYS: ReadonlySet<string> = new Set([
  "seed", "status", "version", "provider", "model", "source", "prompt", "ts", "salt", "error", "file",
]);

/** Which build wrote this row. There is no fourth answer. */
export function classifyRow(row: Record<string, unknown>): RowOrigin {
  if (row.schema === 2) return "current";
  return Object.keys(row).some((key) => !LEGACY_KEYS.has(key)) ? "interim" : "legacy";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (row: Record<string, unknown>, key: string): string | undefined =>
  typeof row[key] === "string" ? (row[key] as string) : undefined;

/** A field that records a Provider or a model on a manual row: `null` is its own answer. */
const nullableText = (row: Record<string, unknown>, key: string): string | null | undefined =>
  row[key] === null ? null : text(row, key);

const count = (row: Record<string, unknown>, key: string): number | undefined =>
  typeof row[key] === "number" && Number.isFinite(row[key]) ? (row[key] as number) : undefined;

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? (value as string[]) : undefined;

/** Only the three outcomes this work writes. Any other name is one we do not know. */
const asStatus = (value: unknown): GenerationStatus | undefined =>
  value === "ok" || value === "failed" || value === "blocked" ? value : undefined;

const asSource = (value: unknown): FrameSource | undefined =>
  value === "api" || value === "manual" ? value : undefined;

const asAttributesSource = (value: unknown): AttributesSource | undefined =>
  value === "run" || value === "import" ? value : undefined;

const asReview = (value: unknown): ReviewDecision | undefined =>
  value === "accepted" || value === "rejected" ? value : undefined;

import { REVIEW_REASONS } from "./manifest-types";

const asReason = (value: unknown): ReviewReason | undefined =>
  REVIEW_REASONS.find((reason) => reason === value);

/** The optional details, kept only when every entry carries the two fields a row writes. */
function asDetails(value: unknown): PortraitDetail[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.every((entry) => isObject(entry) && typeof entry.category === "string" && typeof entry.text === "string")
    ? (value as PortraitDetail[])
    : undefined;
}

function asBands(value: unknown): SkinEyeBands | undefined {
  return isObject(value) && typeof value.skin === "string" && typeof value.eye === "string"
    ? { skin: value.skin, eye: value.eye }
    : undefined;
}

function asParams(value: unknown): GenerationParams | null | undefined {
  // `null` is read back as itself: on a manual import no Provider was asked for
  // anything, and that is a recorded fact rather than a missing one.
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  return typeof value.aspectRatio === "string" && typeof value.imageSize === "string" &&
    typeof value.useNegative === "boolean"
    ? { aspectRatio: value.aspectRatio, imageSize: value.imageSize, useNegative: value.useNegative }
    : undefined;
}

function asDigest(value: unknown): RecordedImageDigest | undefined {
  if (!isObject(value) || typeof value.sha256 !== "string") return undefined;
  const bytes = count(value, "bytes");
  const width = count(value, "width");
  const height = count(value, "height");
  return {
    sha256: value.sha256,
    ...(bytes === undefined ? {} : { bytes }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

function asSteps(value: unknown): NormalizeSteps | undefined {
  if (!isObject(value)) return undefined;
  const { fit, position, format } = value;
  return typeof fit === "string" && typeof position === "string" && typeof format === "string"
    ? { fit, position, format }
    : undefined;
}

function asNormalized(value: unknown): RecordedNormalizedDigest | undefined {
  const digest = asDigest(value);
  if (!digest) return undefined;
  const steps = asSteps(isObject(value) ? value.steps : undefined);
  return steps ? { ...digest, steps } : { ...digest };
}

/** The quarantine a Frame refused as it arrived was put into. */
function asIngestQuarantine(value: unknown): IngestQuarantine | undefined {
  return isObject(value) && typeof value.path === "string" && typeof value.reason === "string"
    ? { path: value.path, reason: value.reason }
    : undefined;
}

/** The pair of files a rejected Frame was moved aside into. */
function asReviewQuarantine(value: unknown): ReviewQuarantine | undefined {
  return isObject(value) && typeof value.frame === "string" && typeof value.raw === "string"
    ? { frame: value.frame, raw: value.raw }
    : undefined;
}

/** The duplicate record, kept only when the whole shape is there rather than part of it. */
function asDuplicates(value: unknown): DuplicateRecord | undefined {
  if (!isObject(value) || typeof value.algo !== "string" || typeof value.threshold !== "number") return undefined;
  const { exact, perceptual, uncomparable } = value;
  if (!Array.isArray(exact) || !Array.isArray(perceptual) || !Array.isArray(uncomparable)) return undefined;
  return {
    algo: value.algo,
    threshold: value.threshold,
    exact: exact.filter(isObject) as DuplicateRecord["exact"],
    perceptual: perceptual.filter(isObject) as DuplicateRecord["perceptual"],
    uncomparable: uncomparable.filter(isObject) as DuplicateRecord["uncomparable"],
  };
}

/** The QC record, kept only when it is the canonical shape rather than part of one. */
function asQc(value: unknown): QCResult | undefined {
  if (!isObject(value)) return undefined;
  const { version, status, checks, flags, stats, perceptual } = value;
  return typeof version === "string" && typeof status === "string" && isObject(checks) &&
    Array.isArray(flags) && isObject(stats) && isObject(perceptual)
    ? (value as unknown as QCResult)
    : undefined;
}

/**
 * One row as a reader hands it back.
 *
 * Nothing is returned for a line that is not a row at all, so a caller reading a
 * file of rows skips whatever is in it that is not one, instead of being handed
 * an object with no Seed.
 *
 * The row is built field by field rather than spread from the parsed line,
 * because a spread would carry through every name the row happened to use, and
 * leaving those names out is the whole of what this reader is for. Fields that
 * came out undefined are removed rather than written, so an absent key stays
 * absent all the way to whoever reads the row rather than arriving as a key
 * holding nothing.
 */
export function readRow(value: unknown): ManifestRow | undefined {
  if (!isObject(value) || !Number.isSafeInteger(value.seed) || (value.seed as number) < 1) return undefined;
  const origin = classifyRow(value);
  const seed = value.seed as number;

  // A rejection is a review decision whichever build wrote it. The writer
  // before schema 2 recorded one as a status, because that was all a row could
  // hold, so the decision is read back out of the status and the status itself
  // is dropped: `status` is the outcome of an attempt to make a Frame, and a
  // person turning one down is not an attempt. Nothing is invented to fill the
  // gap, and an old rejection carries neither a reason nor a quarantine path, so
  // neither appears.
  const isReview = value.kind === "review" || value.status === "rejected";
  const review = isReview ? (asReview(value.review) ?? "rejected") : undefined;
  const status = isReview ? undefined : asStatus(value.status);

  // The raw hash is read from the key the build that wrote the row kept it
  // under. The unfinished build recorded the same bytes under several names and
  // only one of them was ever right: `frameHash` and `normalizedFrameHash` came
  // from a different crop than the one the artifact was written with, so they do
  // not describe these bytes and are not read. A normalized hash is never
  // reconstructed for a row that did not record one.
  const recordedRawHash = text(value, "rawHash");
  const raw = asDigest(value.raw) ?? (recordedRawHash === undefined ? undefined : { sha256: recordedRawHash });

  // The attributes are read when the row recorded them and never otherwise. The
  // sampler tables are the current ones by definition, so nothing here reads
  // them: filling in a row that kept no attributes from today's tables would
  // describe a Portrait that row never named, and every one of those values
  // would be a guess dressed as a record.
  const attributes = isObject(value.attributes)
    ? Object.fromEntries(
      Object.entries(value.attributes).filter(([, entry]) => typeof entry === "string"),
    ) as Record<string, string>
    : undefined;

  const row: Record<string, unknown> = {
    origin,
    seed,
    schema: value.schema === 2 ? 2 : undefined,
    review,
    status,
    version: text(value, "version"),
    salt: text(value, "salt"),
    ts: text(value, "ts"),
    error: text(value, "error"),
    source: asSource(value.source),
    provider: nullableText(value, "provider"),
    model: nullableText(value, "model"),
    file: text(value, "file"),
    prompt: text(value, "prompt"),
    templateHash: text(value, "templateHash"),
    samplerHash: text(value, "samplerHash"),
    attributes,
    details: asDetails(value.details),
    primaryGroup: text(value, "primaryGroup"),
    groups: stringList(value.groups),
    ethnicities: stringList(value.ethnicities),
    photographyProfile: text(value, "photographyProfile"),
    bands: asBands(value.bands),
    attributesSource: asAttributesSource(value.attributesSource),
    params: asParams(value.params),
    raw,
    normalized: asNormalized(value.normalized),
    // The QC record is read only from a row storing the canonical shape. The
    // unfinished build stored a different shape under three names, and
    // re-labelling that record as the canonical one would claim a check that was
    // recorded in another form. It is left absent rather than translated.
    qc: origin === "current" ? asQc(value.qc) : undefined,
    duplicates: asDuplicates(value.duplicates),
    quarantine: asIngestQuarantine(value.quarantine) ?? asReviewQuarantine(value.quarantine),
    reason: asReason(value.reason),
    note: text(value, "note"),
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return row as ManifestRow;
}

/**
 * The Prompt and the attributes that built it, as the writer needs them.
 *
 * Both come from one draw, so the two cannot describe different Portraits.
 * Kept beside the row shape because they travel together: a row holding a
 * Prompt from one sampling and attributes from another would describe a Portrait
 * nobody asked for, and this is what stops that being two separate calls at the
 * call site.
 */
export function sampledPortrait(seed: number, prompt: string, sample: {
  values: Record<string, string>;
  details: { category: string; text: string }[];
  primaryGroup: string;
  groups: string[];
  ethnicities: string[];
  photographyProfile: { id: string };
  bands: { skin: string; eye: string };
}): SampledPortrait {
  return {
    seed,
    prompt,
    attributes: sample.values,
    details: sample.details,
    primaryGroup: sample.primaryGroup,
    groups: sample.groups,
    ethnicities: sample.ethnicities,
    photographyProfile: sample.photographyProfile.id,
    bands: sample.bands,
  };
}
