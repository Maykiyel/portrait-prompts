import sharp from "sharp";

/**
 * The version stamped on every QC record. It changes when the shape of the
 * record or the meaning of a check changes, not when a threshold is tuned.
 */
export const QC_VERSION = "1";

/**
 * The check names the canonical record carries, in a fixed order. Every frame
 * records every one of them, including the checks that did not run.
 */
export const QC_CHECK_NAMES = [
  "decode",
  "dimensions",
  "blank",
  "luminance",
  "aspect",
  "duplicate_exact",
  "duplicate_perceptual",
  "face_presence",
] as const;

/** The target the aspect check measures against. */
const TARGET_ASPECT_RATIO = 2 / 3;

/**
 * How far the raw aspect may sit from the target before the aspect check warns.
 * The condition this measures was once a separate `material_crop` flag. The
 * flag is gone: a frame that is not the target ratio is reported once, as
 * `aspect_ratio_mismatch`, so one condition carries one name.
 */
const ASPECT_TOLERANCE = 0.06;

/** Below this standard deviation a frame carries no detail and fails the blank check. */
const NEAR_BLANK_STDDEV = 6;

/** Mean greyscale below or above these bounds warns on the luminance check. */
const EXTREME_LUMINANCE_LOW = 16;
const EXTREME_LUMINANCE_HIGH = 239;

/**
 * The perceptual hash stays an 8x8 average hash in this phase. Phase 3
 * replaces it with the 16x16 gradient hash and moves this threshold to 12.
 * Changing it here would rewrite every hash already stored in an archive.
 */
const PERCEPTUAL_HASH_SIZE = 8;
const PERCEPTUAL_HASH_ALGO = "ahash-8x8-grayscale";

/** The bit distance at which two perceptual hashes are called near duplicates. */
export const PERCEPTUAL_FINGERPRINT_THRESHOLD = 10;

export type BinaryInput = Buffer | Uint8Array | ArrayBuffer | {
  buffer: ArrayBuffer;
  byteOffset?: number;
  byteLength?: number;
};

/** The state of one check. `not_run` means the check did not happen, not that it passed. */
export type QcCheckState = "pass" | "warn" | "fail" | "not_run";

export type QcCheckName = (typeof QC_CHECK_NAMES)[number];

/** Every check named in the record, mapped to the state it reached. */
export type QcChecks = Record<QcCheckName, QcCheckState>;

/** The rolled up state of a frame. It is the worst state any check reached. */
export type QcStatus = "pass" | "warn" | "fail" | "not_run";

/**
 * The complete list of flags a QC record may carry. There is no other flag, and
 * a flag is never written unless its check reached the matching state.
 */
export type QcFlag =
  | "decode_failed"
  | "zero_dimensions"
  | "near_blank"
  | "extreme_luminance_low"
  | "extreme_luminance_high"
  | "aspect_ratio_mismatch"
  | "duplicate_exact"
  | "duplicate_perceptual"
  | "duplicate_check_incomplete";

/**
 * Mean and standard deviation of the greyscale pixels the blank and luminance
 * checks read. Both are zero when neither check ran, so the checks map is the
 * authority on whether these numbers describe an image.
 */
export type QcStats = { mean: number; stdDev: number };

/** Which bytes the perceptual hash was taken from. */
export type QcPerceptualBasis = "normalized" | "raw";

export type QcPerceptual = {
  algo: string;
  hex: string;
  basis: QcPerceptualBasis;
};

/**
 * The canonical QC record. This is the whole shape, and every stored QC value
 * is one of these.
 */
export type QCResult = {
  version: string;
  status: QcStatus;
  checks: QcChecks;
  flags: QcFlag[];
  stats: QcStats;
  perceptual: QcPerceptual;
};

export type QcOptions = {
  /**
   * The bytes of the normalized artifact written to disk. When they are given,
   * and they decode, the blank and luminance checks read them and the
   * perceptual hash is taken from them. The aspect check always reads the raw
   * dimensions, because the crop is what the aspect check is about.
   */
  normalized?: BinaryInput | null;
  aspectTolerance?: number;
  nearBlankStdDev?: number;
  extremeLuminanceLow?: number;
  extremeLuminanceHigh?: number;
};

function toBuffer(input: BinaryInput): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (typeof input === "object" && input && "buffer" in input && input.buffer instanceof ArrayBuffer) {
    return Buffer.from(input.buffer, input.byteOffset ?? 0, input.byteLength ?? input.buffer.byteLength);
  }
  return Buffer.from(input as unknown as Parameters<typeof Buffer.from>[0]);
}

function clampNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function emptyChecks(): QcChecks {
  return {
    decode: "not_run",
    dimensions: "not_run",
    blank: "not_run",
    luminance: "not_run",
    aspect: "not_run",
    duplicate_exact: "not_run",
    duplicate_perceptual: "not_run",
    face_presence: "not_run",
  };
}

type DecodedImage = {
  width: number;
  height: number;
  greyscale: Buffer;
};

/**
 * Decode an image to its dimensions and its greyscale pixels. A buffer sharp
 * cannot read at all throws, and the caller turns that into a decode failure.
 */
async function decodeImage(buffer: Buffer): Promise<DecodedImage> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) {
    // sharp refuses every malformed image it recognises, so a zero dimension
    // has not been observed reaching this branch. The guard stays because the
    // dimensions check and the zero_dimensions flag are part of the record.
    return { width, height, greyscale: Buffer.alloc(0) };
  }
  const greyscale = await sharp(buffer).greyscale().raw().toBuffer();
  return { width, height, greyscale };
}

function statsOf(greyscale: Buffer): QcStats {
  if (greyscale.length === 0) return { mean: 0, stdDev: 0 };
  let sum = 0;
  for (const value of greyscale) sum += value;
  const mean = sum / greyscale.length;
  let varianceSum = 0;
  for (const value of greyscale) {
    const delta = value - mean;
    varianceSum += delta * delta;
  }
  return { mean, stdDev: Math.sqrt(varianceSum / greyscale.length) };
}

/** The 8x8 average hash, unchanged from the phase this ticket lands in. */
async function computePerceptualHash(buffer: Buffer): Promise<string> {
  const raw = await sharp(buffer)
    .resize(PERCEPTUAL_HASH_SIZE, PERCEPTUAL_HASH_SIZE, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const count = raw.length || 1;
  let sum = 0;
  for (const value of raw) sum += value;
  const average = sum / count;
  let bits = "";
  for (const value of raw) bits += value >= average ? "1" : "0";
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4).padEnd(4, "0"), 2).toString(16);
  }
  return hex;
}

/**
 * The bit distance between two perceptual hashes, counted over nibbles. This
 * is what the audit calls, and it keeps working for the 8x8 hash that this
 * phase still writes.
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    let distance = Math.abs(a.length - b.length) * 4;
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) {
      const av = parseInt(a[i], 16);
      const bv = parseInt(b[i], 16);
      const xor = (isNaN(av) ? 0 : av) ^ (isNaN(bv) ? 0 : bv);
      for (let j = 0; j < 4; j++) if (xor & (1 << j)) distance++;
    }
    return distance;
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const av = parseInt(a[i], 16);
    const bv = parseInt(b[i], 16);
    if (isNaN(av) || isNaN(bv)) {
      if (a[i] !== b[i]) distance += 4;
      continue;
    }
    const xor = av ^ bv;
    for (let j = 0; j < 4; j++) if (xor & (1 << j)) distance++;
  }
  return distance;
}

/**
 * The rolled up status of a frame. A failure anywhere wins, then a warning,
 * then a clean pass. A check that did not run never pulls the status down, so
 * the record says `not_run` only when nothing ran at all.
 */
function rollUpStatus(checks: QcChecks): QcStatus {
  const states = Object.values(checks);
  if (states.includes("fail")) return "fail";
  if (states.includes("warn")) return "warn";
  if (states.every((state) => state === "not_run")) return "not_run";
  return "pass";
}

/**
 * Run the quality checks over one frame's bytes and return the canonical QC
 * record.
 *
 * The record is the whole return value. There is no second shape and no alias
 * for it. Checks that cannot be measured, because the bytes did not decode or
 * because the check arrives in a later phase, are recorded as `not_run`.
 *
 * Blank and luminance read the normalized artifact when one is supplied and
 * the aspect check reads the raw dimensions, because a crop is exactly the
 * thing the aspect check is about.
 */
export async function qc(input: BinaryInput, options: QcOptions = {}): Promise<QCResult> {
  const aspectTolerance = clampNumber(options.aspectTolerance, ASPECT_TOLERANCE);
  const nearBlankStdDev = clampNumber(options.nearBlankStdDev, NEAR_BLANK_STDDEV);
  const extremeLow = clampNumber(options.extremeLuminanceLow, EXTREME_LUMINANCE_LOW);
  const extremeHigh = clampNumber(options.extremeLuminanceHigh, EXTREME_LUMINANCE_HIGH);

  const checks = emptyChecks();
  const flags: QcFlag[] = [];
  const rawBuffer = toBuffer(input);

  let raw: DecodedImage | undefined;
  try {
    raw = await decodeImage(rawBuffer);
    checks.decode = "pass";
  } catch {
    checks.decode = "fail";
    flags.push("decode_failed");
  }

  let measured = false;
  if (raw) {
    if (raw.width > 0 && raw.height > 0) {
      checks.dimensions = "pass";
      measured = true;
    } else {
      checks.dimensions = "fail";
      flags.push("zero_dimensions");
    }
  }

  // Blank, luminance and the perceptual hash all read the normalized artifact
  // when one is supplied and decodes, and the raw bytes otherwise. The aspect
  // check does not take part, because it reads the raw dimensions.
  let subject: { buffer: Buffer; greyscale: Buffer } | undefined = measured && raw
    ? { buffer: rawBuffer, greyscale: raw.greyscale }
    : undefined;
  let basis: QcPerceptualBasis = "raw";
  if (subject && options.normalized) {
    const normalizedBuffer = toBuffer(options.normalized);
    try {
      const normalized = await decodeImage(normalizedBuffer);
      subject = { buffer: normalizedBuffer, greyscale: normalized.greyscale };
      basis = "normalized";
    } catch {
      // A normalized artifact that will not decode leaves the checks reading
      // the raw bytes, and the basis stays `raw` so the record still says
      // which pixels produced the numbers it holds.
    }
  }

  let stats: QcStats = { mean: 0, stdDev: 0 };
  if (subject && subject.greyscale.length > 0) {
    stats = statsOf(subject.greyscale);
    if (stats.stdDev < nearBlankStdDev) {
      checks.blank = "fail";
      flags.push("near_blank");
    } else {
      checks.blank = "pass";
    }
    if (stats.mean < extremeLow) {
      checks.luminance = "warn";
      flags.push("extreme_luminance_low");
    } else if (stats.mean > extremeHigh) {
      checks.luminance = "warn";
      flags.push("extreme_luminance_high");
    } else {
      checks.luminance = "pass";
    }
  }

  if (raw && raw.width > 0 && raw.height > 0) {
    if (Math.abs(raw.width / raw.height / TARGET_ASPECT_RATIO - 1) > aspectTolerance) {
      checks.aspect = "warn";
      flags.push("aspect_ratio_mismatch");
    } else {
      checks.aspect = "pass";
    }
  }

  const perceptual: QcPerceptual = {
    algo: PERCEPTUAL_HASH_ALGO,
    hex: subject ? await computePerceptualHash(subject.buffer) : "",
    basis,
  };

  return {
    version: QC_VERSION,
    status: rollUpStatus(checks),
    checks,
    flags,
    stats,
    perceptual,
  };
}