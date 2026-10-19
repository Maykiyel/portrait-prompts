import { createHash } from "node:crypto";
import sharp from "sharp";

export const qcVersion = "1";
export const QC_VERSION = qcVersion;

export const FRAME_WIDTH = 768;
export const FRAME_HEIGHT = 1152;
export const frameWidth = FRAME_WIDTH;
export const frameHeight = FRAME_HEIGHT;

export const TARGET_ASPECT_RATIO = 2 / 3;
export const targetAspectRatio = TARGET_ASPECT_RATIO;
export const ASPECT_RATIO_TARGET = TARGET_ASPECT_RATIO;
export const aspectRatioTarget = TARGET_ASPECT_RATIO;

export const MATERIAL_CROP_TOLERANCE = 0.06;
export const materialCropTolerance = MATERIAL_CROP_TOLERANCE;
export const ASPECT_RATIO_TOLERANCE = MATERIAL_CROP_TOLERANCE;
export const aspectRatioTolerance = MATERIAL_CROP_TOLERANCE;
export const CROP_WARNING_THRESHOLD = MATERIAL_CROP_TOLERANCE;
export const cropWarningThreshold = MATERIAL_CROP_TOLERANCE;

export const NEAR_BLANK_STDDEV_THRESHOLD = 6;
export const nearBlankStdDevThreshold = NEAR_BLANK_STDDEV_THRESHOLD;
export const NEAR_BLANK_THRESHOLD = NEAR_BLANK_STDDEV_THRESHOLD;

export const EXTREME_LUMINANCE_LOW = 16;
export const extremeLuminanceLowThreshold = EXTREME_LUMINANCE_LOW;
export const EXTREME_LUMINANCE_HIGH = 239;
export const extremeLuminanceHighThreshold = EXTREME_LUMINANCE_HIGH;

export const PERCEPTUAL_HASH_SIZE = 8;
export const perceptualHashSize = PERCEPTUAL_HASH_SIZE;
export const FINGERPRINT_SIZE = PERCEPTUAL_HASH_SIZE;
export const fingerprintSize = PERCEPTUAL_HASH_SIZE;

export const PERCEPTUAL_FINGERPRINT_METHOD = "ahash-8x8-grayscale";
export const perceptualFingerprintMethod = PERCEPTUAL_FINGERPRINT_METHOD;
export const FINGERPRINT_METHOD = PERCEPTUAL_FINGERPRINT_METHOD;
export const fingerprintMethod = PERCEPTUAL_FINGERPRINT_METHOD;

export const PERCEPTUAL_FINGERPRINT_THRESHOLD = 10;
export const perceptualFingerprintThreshold = PERCEPTUAL_FINGERPRINT_THRESHOLD;
export const FINGERPRINT_THRESHOLD = PERCEPTUAL_FINGERPRINT_THRESHOLD;
export const fingerprintThreshold = PERCEPTUAL_FINGERPRINT_THRESHOLD;
export const HAMMING_THRESHOLD = PERCEPTUAL_FINGERPRINT_THRESHOLD;
export const hammingThreshold = PERCEPTUAL_FINGERPRINT_THRESHOLD;

export const FACE_DETECTOR_STATUS_NOT_RUN = "not_run";
export const faceDetectorStatusNotRun = FACE_DETECTOR_STATUS_NOT_RUN;
export const FACE_DETECTOR_NOT_RUN = FACE_DETECTOR_STATUS_NOT_RUN;
export const faceDetectorNotRun = FACE_DETECTOR_STATUS_NOT_RUN;

export const FACE_DETECTOR_REASON = "face detector is not installed";
export const faceDetectorReason = FACE_DETECTOR_REASON;

export type QcFlag =
  | "decode_failed"
  | "zero_dimensions"
  | "near_blank"
  | "extreme_luminance_low"
  | "extreme_luminance_high"
  | "aspect_ratio_mismatch"
  | "duplicate_exact"
  | "duplicate_perceptual"
  | "face_detector_not_run";
export type QCFlag = QcFlag;

export type BinaryInput = Buffer | Uint8Array | ArrayBuffer | { buffer: ArrayBuffer; byteOffset?: number; byteLength?: number };

export function toBuffer(input: BinaryInput): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (typeof input === "object" && input && "buffer" in input && input.buffer instanceof ArrayBuffer) {
    return Buffer.from(input.buffer, input.byteOffset ?? 0, input.byteLength ?? input.buffer.byteLength);
  }
  return Buffer.from(input as unknown as Parameters<typeof Buffer.from>[0]);
}

export type LuminanceStats = {
  width: number;
  height: number;
  count: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  normalizedMean: number;
};
export type QcStats = LuminanceStats;
export type ImageStats = LuminanceStats;
export type QcLuminance = LuminanceStats;

export type ExistingOutput = {
  seed?: number;
  file?: string;
  name?: string;
  rawHash?: string;
  rawSha256?: string;
  sha256?: string;
  frameHash?: string;
  normalizedFrameHash?: string;
  frameSha256?: string;
  perceptualFingerprint?: string;
  fingerprint?: string;
  width?: number;
  height?: number;
};

export type DuplicateMatch = {
  seed?: number;
  file?: string;
  name?: string;
  kind: "exact" | "perceptual";
  distance?: number;
};

export type DuplicateDetectionResult = {
  isDuplicate: boolean;
  exactDuplicate: boolean;
  perceptualDuplicate: boolean;
  matches: DuplicateMatch[];
  exactMatches: DuplicateMatch[];
  perceptualMatches: DuplicateMatch[];
};

export type QcOptions = {
  frameWidth?: number;
  frameHeight?: number;
  cropTolerance?: number;
  nearBlankStdDevThreshold?: number;
  extremeLuminanceLow?: number;
  extremeLuminanceHigh?: number;
  perceptualSize?: number;
  perceptualThreshold?: number;
  existingOutputs?: ExistingOutput[];
  includeDuplicates?: boolean;
  skipFaceDetector?: boolean;
};

export type FaceDetectorResult = {
  status: "not_run";
  installed: false;
  reason: string;
  method: "not_run";
};
export type FaceDetectorStatus = "not_run";

export interface QCResult {
  ok: boolean;
  valid: boolean;
  decodeOk: boolean;
  width: number;
  height: number;
  dimensions: { width: number; height: number };
  aspectRatio: number;
  targetAspectRatio: number;
  rawHash: string;
  rawSha256: string;
  sha256: string;
  hash: string;
  frameHash: string;
  normalizedFrameHash: string;
  frameSha256: string;
  fingerprint: string;
  perceptualFingerprint: string;
  method: string;
  threshold: number;
  fingerprintMethod: string;
  fingerprintThreshold: number;
  perceptualMethod: string;
  perceptualThreshold: number;
  perceptual: {
    fingerprint: string;
    method: string;
    threshold: number;
    size: number;
  };
  flags: QcFlag[];
  nearBlank: boolean;
  extremeLuminance: boolean;
  extremeLuminanceLow: boolean;
  extremeLuminanceHigh: boolean;
  materialCrop: boolean;
  materialCropWarning?: string;
  cropWarning?: string;
  hasMaterialCropWarning: boolean;
  hasMaterialCrop: boolean;
  faceDetector: FaceDetectorResult;
  faceDetectorStatus: "not_run";
  faceDetectorInstalled: false;
  stats: LuminanceStats;
  luminance: LuminanceStats;
  luminanceStats: LuminanceStats;
  version: string;
  duplicates?: DuplicateDetectionResult;
  isDuplicate?: boolean;
  exactDuplicate?: boolean;
  perceptualDuplicate?: boolean;
  duplicateMatches?: DuplicateMatch[];
  error?: string;
}
export type QcResult = QCResult;
export type QualityCheckResult = QCResult;
export type ImageQcResult = QCResult;

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256(input: BinaryInput): string {
  return sha256Buffer(toBuffer(input));
}

export function computeRawHash(input: BinaryInput): string {
  return sha256Buffer(toBuffer(input));
}
export const rawHash = computeRawHash;

function clampNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function decodeImage(input: BinaryInput): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
  metadata: Record<string, unknown>;
}> {
  const buffer = toBuffer(input);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("image has zero dimensions");
  }
  await sharp(buffer).raw().toBuffer();
  return { buffer, width: metadata.width, height: metadata.height, metadata: metadata as unknown as Record<string, unknown> };
}

export async function assertImageDecodes(input: BinaryInput): Promise<void> {
  await decodeImage(input);
}

export function computeAspectRatio(width: number, height: number): number {
  if (!height) return 0;
  return width / height;
}

export function computeMaterialCropWarning(
  width: number,
  height: number,
  tolerance: number = MATERIAL_CROP_TOLERANCE,
): string | undefined {
  if (!width || !height) return undefined;
  const ratio = width / height;
  const warning =
    Math.abs(ratio / TARGET_ASPECT_RATIO - 1) > tolerance
      ? `${width}x${height} is not 2:3, so the crop cuts part of the image`
      : undefined;
  return warning;
}
export const materialCropWarning = computeMaterialCropWarning;

export function hasMaterialCropWarning(
  width: number,
  height: number,
  tolerance: number = MATERIAL_CROP_TOLERANCE,
): boolean {
  return computeMaterialCropWarning(width, height, tolerance) !== undefined;
}

export async function computeLuminanceStats(input: BinaryInput): Promise<LuminanceStats> {
  const buffer = toBuffer(input);
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const raw = await sharp(buffer).greyscale().raw().toBuffer();
  const count = raw.length;
  if (!count) {
    return { width, height, count: 0, min: 0, max: 0, mean: 0, stdDev: 0, normalizedMean: 0 };
  }
  let min = 255;
  let max = 0;
  let sum = 0;
  for (const value of raw) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  const mean = sum / count;
  let varianceSum = 0;
  for (const value of raw) {
    const delta = value - mean;
    varianceSum += delta * delta;
  }
  const stdDev = Math.sqrt(varianceSum / count);
  return {
    width: width || (metadata.width ?? 0),
    height: height || (metadata.height ?? 0),
    count,
    min,
    max,
    mean,
    stdDev,
    normalizedMean: mean / 255,
  };
}
export const computeStats = computeLuminanceStats;
export const luminanceStats = computeLuminanceStats;

export function isNearBlank(stats: LuminanceStats, threshold: number = NEAR_BLANK_STDDEV_THRESHOLD): boolean {
  return stats.stdDev < threshold;
}
export const nearBlank = isNearBlank;

export function isExtremeLuminance(
  stats: LuminanceStats,
  low: number = EXTREME_LUMINANCE_LOW,
  high: number = EXTREME_LUMINANCE_HIGH,
): { low: boolean; high: boolean; extreme: boolean } {
  const lowFlag = stats.mean < low;
  const highFlag = stats.mean > high;
  return { low: lowFlag, high: highFlag, extreme: lowFlag || highFlag };
}
export const extremeLuminance = isExtremeLuminance;

export async function computeNormalizedFrameHash(
  input: BinaryInput,
  width: number = FRAME_WIDTH,
  height: number = FRAME_HEIGHT,
): Promise<string> {
  const buffer = toBuffer(input);
  const normalized = await sharp(buffer)
    .resize(width, height, { fit: "cover", position: "center" })
    .png()
    .toBuffer();
  return sha256Buffer(normalized);
}
export const normalizedFrameHash = computeNormalizedFrameHash;
export const computeFrameHash = computeNormalizedFrameHash;
export const frameHashFor = computeNormalizedFrameHash;

export async function computePerceptualFingerprint(
  input: BinaryInput,
  size: number = PERCEPTUAL_HASH_SIZE,
): Promise<string> {
  const buffer = toBuffer(input);
  const raw = await sharp(buffer)
    .resize(size, size, { fit: "fill" })
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
    const chunk = bits.slice(i, i + 4).padEnd(4, "0");
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex;
}
export const perceptualFingerprint = computePerceptualFingerprint;
export const fingerprint = computePerceptualFingerprint;
export const computeFingerprint = computePerceptualFingerprint;

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    let distance = Math.abs(a.length - b.length) * 4;
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) {
      const av = parseInt(a[i], 16);
      const bv = parseInt(b[i], 16);
      let xor = (isNaN(av) ? 0 : av) ^ (isNaN(bv) ? 0 : bv);
      let bits = 0;
      for (let j = 0; j < 4; j++) {
        if (xor & (1 << j)) bits++;
      }
      distance += bits;
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
    let xor = av ^ bv;
    for (let j = 0; j < 4; j++) if (xor & (1 << j)) distance++;
  }
  return distance;
}
export const hamming = hammingDistance;
export const perceptualDistance = hammingDistance;

function exactKeyOf(item: ExistingOutput): string | undefined {
  return item.rawHash ?? item.rawSha256 ?? item.sha256 ?? item.frameHash ?? item.normalizedFrameHash ?? item.frameSha256;
}

function fingerprintOf(item: ExistingOutput): string | undefined {
  return item.perceptualFingerprint ?? item.fingerprint;
}

export function detectDuplicates(
  candidate: ExistingOutput,
  existing: ExistingOutput[] = [],
  options: { threshold?: number } = {},
): DuplicateDetectionResult {
  const threshold = clampNumber(options.threshold, PERCEPTUAL_FINGERPRINT_THRESHOLD);
  const candidateExact = exactKeyOf(candidate);
  const candidateFingerprint = fingerprintOf(candidate);

  const exactMatches: DuplicateMatch[] = [];
  const perceptualMatches: DuplicateMatch[] = [];

  for (const item of existing) {
    const itemExact = exactKeyOf(item);
    if (candidateExact && itemExact && candidateExact === itemExact) {
      exactMatches.push({ seed: item.seed, file: item.file ?? item.name, name: item.name ?? item.file, kind: "exact" });
    }
    const itemFingerprint = fingerprintOf(item);
    if (candidateFingerprint && itemFingerprint) {
      const distance = hammingDistance(candidateFingerprint, itemFingerprint);
      if (distance <= threshold) {
        perceptualMatches.push({ seed: item.seed, file: item.file ?? item.name, name: item.name ?? item.file, kind: "perceptual", distance });
      }
    }
  }

  const exactSeeds = new Set(exactMatches.map((m) => m.seed));
  const perceptualOnly = perceptualMatches.filter((m) => !exactSeeds.has(m.seed));

  const matches = [...exactMatches, ...perceptualOnly];
  return {
    isDuplicate: exactMatches.length > 0 || perceptualOnly.length > 0,
    exactDuplicate: exactMatches.length > 0,
    perceptualDuplicate: perceptualOnly.length > 0,
    matches,
    exactMatches,
    perceptualMatches,
  };
}
export const findDuplicates = detectDuplicates;
export const compareOutputs = detectDuplicates;

export class DuplicateIndex {
  private items: ExistingOutput[] = [];
  private threshold: number;

  constructor(initial?: Iterable<ExistingOutput>, threshold: number = PERCEPTUAL_FINGERPRINT_THRESHOLD) {
    this.threshold = threshold;
    if (initial) for (const item of initial) this.add(item);
  }

  get size(): number {
    return this.items.length;
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  add(item: ExistingOutput): void {
    this.items.push(item);
  }

  addAll(items: Iterable<ExistingOutput>): void {
    for (const item of items) this.add(item);
  }

  check(candidate: ExistingOutput, threshold?: number): DuplicateDetectionResult {
    return detectDuplicates(candidate, this.items, { threshold: threshold ?? this.threshold });
  }

  find(candidate: ExistingOutput, threshold?: number): DuplicateDetectionResult {
    return this.check(candidate, threshold);
  }

  has(candidate: ExistingOutput, threshold?: number): boolean {
    return this.check(candidate, threshold).isDuplicate;
  }

  clear(): void {
    this.items = [];
  }

  toArray(): ExistingOutput[] {
    return [...this.items];
  }
}
export function createDuplicateIndex(initial?: Iterable<ExistingOutput>, threshold?: number): DuplicateIndex {
  return new DuplicateIndex(initial, threshold ?? PERCEPTUAL_FINGERPRINT_THRESHOLD);
}
export function buildDuplicateIndex(initial?: Iterable<ExistingOutput>, threshold?: number): DuplicateIndex {
  return createDuplicateIndex(initial, threshold);
}

const FACE_DETECTOR_RESULT: FaceDetectorResult = Object.freeze({
  status: "not_run",
  installed: false,
  reason: FACE_DETECTOR_REASON,
  method: "not_run",
}) as FaceDetectorResult;

export function faceDetector(): FaceDetectorResult {
  return FACE_DETECTOR_RESULT;
}
export const FACE_DETECTOR = FACE_DETECTOR_RESULT;
export const faceDetectorStatus = FACE_DETECTOR_STATUS_NOT_RUN;

async function qcCore(input: BinaryInput, options: QcOptions = {}): Promise<QCResult> {
  const frameWidth = clampNumber(options.frameWidth, FRAME_WIDTH);
  const frameHeight = clampNumber(options.frameHeight, FRAME_HEIGHT);
  const cropTolerance = clampNumber(options.cropTolerance, MATERIAL_CROP_TOLERANCE);
  const nearBlankThreshold = clampNumber(options.nearBlankStdDevThreshold, NEAR_BLANK_STDDEV_THRESHOLD);
  const extremeLow = clampNumber(options.extremeLuminanceLow, EXTREME_LUMINANCE_LOW);
  const extremeHigh = clampNumber(options.extremeLuminanceHigh, EXTREME_LUMINANCE_HIGH);
  const perceptualSize = clampNumber(options.perceptualSize, PERCEPTUAL_HASH_SIZE);
  const perceptualThreshold = clampNumber(options.perceptualThreshold, PERCEPTUAL_FINGERPRINT_THRESHOLD);

  let buffer: Buffer;
  let width = 0;
  let height = 0;
  try {
    const decoded = await decodeImage(input);
    buffer = decoded.buffer;
    width = decoded.width;
    height = decoded.height;
  } catch (err) {
    const rawBuffer = toBuffer(input);
    const rawHash = sha256Buffer(rawBuffer);
    return makeResult({
      ok: false,
      valid: false,
      decodeOk: false,
      width: 0,
      height: 0,
      rawHash,
      frameHash: rawHash,
      normalizedFrameHash: rawHash,
      fingerprint: "",
      flags: ["decode_failed"],
      stats: { width: 0, height: 0, count: 0, min: 0, max: 0, mean: 0, stdDev: 0, normalizedMean: 0 },
      options: { frameWidth, frameHeight, cropTolerance, extremeLow, extremeHigh, perceptualThreshold },
      error: err instanceof Error ? err.message : String(err),
      materialCrop: false,
      materialCropWarning: undefined,
      nearBlank: false,
      extremeLuminance: false,
      extremeLowFlag: false,
      extremeHighFlag: false,
    });
  }

  if (!width || !height) {
    const rawHash = sha256Buffer(buffer);
    return makeResult({
      ok: false,
      valid: false,
      decodeOk: false,
      width: 0,
      height: 0,
      rawHash,
      frameHash: rawHash,
      normalizedFrameHash: rawHash,
      fingerprint: "",
      flags: ["zero_dimensions"],
      stats: { width: 0, height: 0, count: 0, min: 0, max: 0, mean: 0, stdDev: 0, normalizedMean: 0 },
      options: { frameWidth, frameHeight, cropTolerance, extremeLow, extremeHigh, perceptualThreshold },
      materialCrop: false,
      materialCropWarning: undefined,
      nearBlank: false,
      extremeLuminance: false,
      extremeLowFlag: false,
      extremeHighFlag: false,
    });
  }

  const rawHash = sha256Buffer(buffer);
  const normalizedFrameHashValue = await computeNormalizedFrameHash(buffer, frameWidth, frameHeight);
  const stats = await computeLuminanceStats(buffer);
  const fingerprintValue = await computePerceptualFingerprint(buffer, perceptualSize);

  const materialCropWarningValue = computeMaterialCropWarning(width, height, cropTolerance);
  const materialCrop = materialCropWarningValue !== undefined;

  const nearBlankFlag = stats.stdDev < nearBlankThreshold;
  const extreme = isExtremeLuminance(stats, extremeLow, extremeHigh);

  const flags: QcFlag[] = [];
  if (nearBlankFlag) flags.push("near_blank");
  if (extreme.low) flags.push("extreme_luminance_low");
  if (extreme.high) flags.push("extreme_luminance_high");
  if (materialCrop) flags.push("aspect_ratio_mismatch");

  const result = makeResult({
    ok: flags.length === 0,
    valid: true,
    decodeOk: true,
    width,
    height,
    rawHash,
    frameHash: normalizedFrameHashValue,
    normalizedFrameHash: normalizedFrameHashValue,
    fingerprint: fingerprintValue,
    flags,
    stats,
    options: { frameWidth, frameHeight, cropTolerance, extremeLow, extremeHigh, perceptualThreshold, perceptualSize },
    materialCrop,
    materialCropWarning: materialCropWarningValue,
    nearBlank: nearBlankFlag,
    extremeLuminance: extreme.extreme,
    extremeLowFlag: extreme.low,
    extremeHighFlag: extreme.high,
  });

  if (options.includeDuplicates || options.existingOutputs?.length) {
    const existing = options.existingOutputs ?? [];
    const dup = detectDuplicates(
      {
        rawHash,
        frameHash: normalizedFrameHashValue,
        perceptualFingerprint: fingerprintValue,
        width,
        height,
      },
      existing,
      { threshold: perceptualThreshold },
    );
    if (dup.isDuplicate) {
      if (dup.exactDuplicate) result.flags.push("duplicate_exact");
      if (dup.perceptualDuplicate) result.flags.push("duplicate_perceptual");
    }
    result.duplicates = dup;
    result.isDuplicate = dup.isDuplicate;
    result.exactDuplicate = dup.exactDuplicate;
    result.perceptualDuplicate = dup.perceptualDuplicate;
    result.duplicateMatches = dup.matches;
    result.ok = result.valid && result.flags.filter((flag) => flag !== "face_detector_not_run").length === 0;
  }

  return result;
}

function makeResult(input: {
  ok: boolean;
  valid: boolean;
  decodeOk: boolean;
  width: number;
  height: number;
  rawHash: string;
  frameHash: string;
  normalizedFrameHash: string;
  fingerprint: string;
  flags: QcFlag[];
  stats: LuminanceStats;
  options: { frameWidth: number; frameHeight: number; cropTolerance: number; extremeLow: number; extremeHigh: number; perceptualThreshold: number; perceptualSize?: number };
  materialCrop: boolean;
  materialCropWarning?: string;
  nearBlank: boolean;
  extremeLuminance: boolean;
  extremeLowFlag: boolean;
  extremeHighFlag: boolean;
  error?: string;
}): QCResult {
  const perceptualSize = input.options.perceptualSize ?? PERCEPTUAL_HASH_SIZE;
  const aspectRatio = input.height ? input.width / input.height : 0;
  const cropWarning = input.materialCropWarning;
  const faceDetectorResult = FACE_DETECTOR_RESULT;
  const stats = { ...input.stats, width: input.stats.width || input.width, height: input.stats.height || input.height };
  return {
    ok: input.ok,
    valid: input.valid,
    decodeOk: input.decodeOk,
    width: input.width,
    height: input.height,
    dimensions: { width: input.width, height: input.height },
    aspectRatio,
    targetAspectRatio: TARGET_ASPECT_RATIO,
    rawHash: input.rawHash,
    rawSha256: input.rawHash,
    sha256: input.rawHash,
    hash: input.rawHash,
    frameHash: input.frameHash,
    normalizedFrameHash: input.normalizedFrameHash,
    frameSha256: input.frameHash,
    fingerprint: input.fingerprint,
    perceptualFingerprint: input.fingerprint,
    method: PERCEPTUAL_FINGERPRINT_METHOD,
    threshold: input.options.perceptualThreshold,
    fingerprintMethod: PERCEPTUAL_FINGERPRINT_METHOD,
    fingerprintThreshold: input.options.perceptualThreshold,
    perceptualMethod: PERCEPTUAL_FINGERPRINT_METHOD,
    perceptualThreshold: input.options.perceptualThreshold,
    perceptual: {
      fingerprint: input.fingerprint,
      method: PERCEPTUAL_FINGERPRINT_METHOD,
      threshold: input.options.perceptualThreshold,
      size: perceptualSize,
    },
    flags: input.flags,
    nearBlank: input.nearBlank,
    extremeLuminance: input.extremeLuminance,
    extremeLuminanceLow: input.extremeLowFlag,
    extremeLuminanceHigh: input.extremeHighFlag,
    materialCrop: input.materialCrop,
    materialCropWarning: input.materialCropWarning,
    cropWarning,
    hasMaterialCropWarning: input.materialCropWarning !== undefined,
    hasMaterialCrop: input.materialCrop,
    faceDetector: faceDetectorResult,
    faceDetectorStatus: "not_run",
    faceDetectorInstalled: false,
    stats,
    luminance: stats,
    luminanceStats: stats,
    version: qcVersion,
    ...(input.error ? { error: input.error } : {}),
  };
}

export const qc = qcCore;
export const qcImage = qcCore;
export const qcFrame = qcCore;
export const qcBuffer = qcCore;
export const checkImage = qcCore;
export const analyzeImage = qcCore;
export const qualityCheck = qcCore;
export const runQc = qcCore;
export const validateImage = qcCore;
export const computeQc = qcCore;
export const assessImage = qcCore;

export default qcCore;