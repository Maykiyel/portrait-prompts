import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadStream } from "node:fs";
import sharp from "sharp";
import { ArchiveError, type ArchiveErrorCode } from "./errors";
import { buildPrompt, composePrompt } from "./sampler";
import { qc, type QCResult, type QcFlag } from "./qc";

export type FolderStatus = {
  version: string;
  next: number | null;
  done: number;
  waiting: number | null;
  failed: number;
  /** Seeds whose last Attempt was a refusal no run will ever clear. Counted apart from `failed`, because they are finished rather than waiting. */
  blocked: number;
  saltSet: boolean;
  problem?: string;
  /** Which problem `problem` describes, so a caller can tell a report from a stop. */
  problemCode?: ArchiveErrorCode;
};

export type FrameRecord = {
  seed: number;
  version: string;
  source: "api" | "manual" | "unknown";
  /** Which Provider made this. Rows written before Providers existed name the only one that did. */
  provider?: string;
  model?: string;
  prompt: string;
  updatedAt: string;
  /** Quality check result for the stored Frame, mapped one-for-one from `core/qc.ts`. */
  qc?: QCResult;
  qcResult?: QCResult;
  qualityCheck?: QCResult;
  quality?: QCResult;
  rawHash?: string;
  rawSha256?: string;
  sha256?: string;
  hash?: string;
  frameHash?: string;
  normalizedFrameHash?: string;
  frameSha256?: string;
  perceptualFingerprint?: string;
  fingerprint?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  flags?: QcFlag[];
  qcVersion?: string;
  /** Where a Frame that failed the quality check was put instead of the archive. */
  quarantined?: boolean;
  quarantinePath?: string;
};

export type PromptItem = { seed: number; prompt: string };

export type Attempt = {
  seed: number;
  /** `blocked` is a refusal no run will ever clear, so the Seed is finished. `failed` is one a later run might clear. */
  status: "ok" | "failed" | "blocked" | "rejected";
  provider?: string;
  model?: string;
  source?: "manual" | "api";
  file?: string;
  prompt?: string;
  error?: string;
  ts?: string;
  qc?: QCResult;
  qcResult?: QCResult;
  qualityCheck?: QCResult;
  quality?: QCResult;
  rawHash?: string;
  rawSha256?: string;
  sha256?: string;
  hash?: string;
  frameHash?: string;
  normalizedFrameHash?: string;
  frameSha256?: string;
  perceptualFingerprint?: string;
  fingerprint?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  flags?: QcFlag[];
  quarantined?: boolean;
  quarantinePath?: string;
};

export type FrameWrite = {
  seed: number;
  buffer: Buffer;
  provider?: string;
  model?: string;
  source?: "manual" | "api";
  file?: string;
  prompt?: string;
  ts?: string;
  qc?: QCResult;
};

export type ImportedFrame = { seed: number; file: string; ok: boolean; warning?: string; error?: string; qc?: QCResult };
export type FileForImport = { name: string; buffer: Buffer };

export type OutputFolder = Readonly<{
  status(): FolderStatus;
  waitingSeeds(): number[];
  issueSeeds(count: number): number[];
  claimSeeds(count: number, commit?: boolean): number[];
  listFrames(): FrameRecord[];
  /** Read-only view of the Manifest's rows, for audit and reporting. */
  manifestRows(): ManifestRow[];
  /** Alias of `manifestRows`, for callers that think in Attempts. */
  listAttempts(): ManifestRow[];
  hasFrame(seed: number): boolean;
  readFrame(seed: number, raw?: boolean): ReadStream;
  readThumbnail(seed: number, width: number): Promise<ReadStream>;
  writeFrame(frame: FrameWrite): Promise<void>;
  importFrames(files: FileForImport[], seeds: number[]): Promise<ImportedFrame[]>;
  rejectFrame(seed: number): void;
  recordAttempt(attempt: Attempt): void;
  promptFor(seed: number, useNegative?: boolean): string;
  promptsFor(seeds: number[], useNegative?: boolean): PromptItem[];
  quarantineDir(): string;
  quarantinedFiles(): string[];
  quarantinedSeeds(): number[];
  quarantineFrame(seed: number, buffer: Buffer, result?: QCResult): Promise<void>;
  qcFrame(seed: number): Promise<QCResult | undefined>;
  supportedExtensions(): string[];
  extensions: string[];
}>;

type Counter = { next: number; salt: string };
export type ManifestRow = {
  seed: number;
  status: string;
  version?: string;
  provider?: string;
  model?: string;
  source?: string;
  prompt?: string;
  ts?: string;
  qc?: QCResult;
  qcResult?: QCResult;
  qualityCheck?: QCResult;
  quality?: QCResult;
  rawHash?: string;
  rawSha256?: string;
  sha256?: string;
  hash?: string;
  frameHash?: string;
  normalizedFrameHash?: string;
  frameSha256?: string;
  perceptualFingerprint?: string;
  fingerprint?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  flags?: QcFlag[];
  qcVersion?: string;
  file?: string;
  error?: string;
  quarantined?: boolean;
  quarantinePath?: string;
};

const pad = (seed: number) => String(seed).padStart(5, "0");

/**
 * The five-digit Seed name, for the places that show one to a person or hand one
 * to a browser as a download. This module owns the form because it owns the Frame
 * filenames; nothing else gets to build one.
 */
export const seedLabel = (seed: number) => pad(seed);

/**
 * The Seeds named with --start. The module only hands a Frame to a
 * waiting Seed, so a command over Seeds the counter never issued asks
 * it for the gap first. A dry run writes nothing and moves nothing,
 * exactly as it did before.
 */
export function namedSeeds(folder: OutputFolder, start: number, count: number, commit: boolean): number[] {
  folder.waitingSeeds(); // the Seed salt guard, before any work
  const last = start + count;
  let next = folder.status().next ?? 1;
  if (commit) {
    while (next < last) {
      const take = Math.min(500, last - next);
      folder.issueSeeds(take);
      next += take;
    }
  }
  return Array.from({ length: count }, (_, i) => start + i);
}

const invalidSeed = () => new ArchiveError("invalid-seed", "Seed must be a positive whole number");
const validateSeed = (seed: number) => {
  if (!Number.isSafeInteger(seed) || seed < 1) throw invalidSeed();
};
const validateCount = (count: number) => {
  if (!Number.isInteger(count) || count < 1 || count > 500)
    throw new ArchiveError("invalid-count", "count must be a whole number from 1 to 500");
};

/**
 * Opens the one owner of the output folder. No path, row shape or filename escapes
 * its interface. The Prompt files are read at open time, not per Frame or Prompt.
 */
export function openOutputFolder(root: string, salt: string): OutputFolder {
  const rawTemplate = readFileSync("template.txt", "utf8");
  const version = rawTemplate.match(/^#\s*(.+)\n/)?.[1]?.trim() ?? "unversioned";
  const template = rawTemplate.replace(/^#.*\n/, "");
  const negative = readFileSync("negative.txt", "utf8").trim();

  const frameFile = (seed: number) => join(root, `${pad(seed)}.png`);
  const rawFile = (seed: number) => join(root, "raw", `${pad(seed)}.png`);
  const counterFile = join(root, "cursor.json");
  const manifestFile = join(root, "manifest.jsonl");
  const thumbDir = join(root, "thumbs");
  const quarantineDirPath = join(root, "quarantine");

  const readCounter = (): Counter | undefined => {
    if (!existsSync(counterFile)) return undefined;
    let raw: string;
    try {
      raw = readFileSync(counterFile, "utf8");
    } catch (err) {
      throw new ArchiveError("unreadable-counter", `Cannot read the Seed counter in ${root}/: ${String(err)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ArchiveError("unreadable-counter", `Cannot read the Seed counter in ${root}/: ${String(err)}`);
    }
    const row = parsed as { next?: unknown; salt?: unknown } | null;
    if (!row || !Number.isSafeInteger(row.next) || (row.next as number) < 1 ||
      (row.salt !== undefined && typeof row.salt !== "string")) {
      throw new ArchiveError("unreadable-counter", `Cannot read the Seed counter in ${root}/: invalid counter`);
    }
    // Before salt was recorded, old folders had no salt property at all.
    return { next: row.next as number, salt: row.salt ?? "" };
  };

  const assertSalt = (counter: Counter | undefined) => {
    if (counter && counter.salt !== salt) {
      throw new ArchiveError("salt-mismatch", `SEED_SALT does not match ${root}/. It was started with ${counter.salt ? "a different salt" : "no salt"}, so the same seeds would now make different prompts. Restore the old SEED_SALT in .env, or move ${root}/ aside to start fresh.`);
    }
  };

  const writeCounter = (next: number) => {
    mkdirSync(root, { recursive: true });
    const temp = `${counterFile}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ next, salt }));
      for (let attempt = 0; ; attempt++) {
        try {
          renameSync(temp, counterFile);
          return;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (attempt >= 200 || !["EACCES", "EBUSY", "EPERM"].includes(code ?? "")) throw err;
          // Windows refuses a rename while another process has the old file open.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
        }
      }
    } finally {
      if (existsSync(temp)) rmSync(temp, { force: true });
    }
  };

  const hasFrame = (seed: number): boolean => {
    validateSeed(seed);
    return existsSync(frameFile(seed));
  };

  const waitingSeeds = (): number[] => {
    const counter = readCounter();
    assertSalt(counter);
    const latest = latestStatuses();
    const waiting: number[] = [];
    // A Seed whose Prompt was refused is finished, not waiting. It has no Frame
    // and will never get one, so handing it out again would spend a run on a
    // Prompt the vendor has already refused once and will refuse every time.
    for (let seed = 1; seed < (counter?.next ?? 1); seed++)
      if (!hasFrame(seed) && latest.get(seed) !== "blocked") waiting.push(seed);
    return waiting;
  };

  const readManifest = (): ManifestRow[] => {
    if (!existsSync(manifestFile)) return [];
    return readFileSync(manifestFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ManifestRow);
  };

  /**
   * The last Attempt for every Seed, which is what "what happened to this Seed"
   * is answered by. The Manifest is append-only, so the last row written wins.
   */
  const latestStatuses = (): Map<number, string> => {
    const latest = new Map<number, string>();
    for (const row of readManifest()) latest.set(row.seed, row.status);
    return latest;
  };

  const frameSeeds = (): number[] => {
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .map((name) => name.match(/^(\d{5})\.png$/)?.[1])
      .filter((match): match is string => !!match)
      .map(Number)
      .sort((a, b) => b - a);
  };

  const status = (): FolderStatus => {
    const done = frameSeeds().length;
    const latest = latestStatuses();
    const failed = [...latest.values()].filter((value) => value === "failed").length;
    const blocked = [...latest.values()].filter((value) => value === "blocked").length;
    const base = { version, done, failed, blocked, saltSet: salt !== "" };
    try {
      const counter = readCounter();
      assertSalt(counter);
      const next = counter?.next ?? 1;
      let waiting = 0;
      for (let seed = 1; seed < next; seed++)
        if (!hasFrame(seed) && latest.get(seed) !== "blocked") waiting++;
      return { ...base, next, waiting };
    } catch (err) {
      if (!(err instanceof ArchiveError)) throw err;
      return { ...base, next: null, waiting: null, problem: err.message, problemCode: err.code };
    }
  };

  const issueSeeds = (count: number): number[] => {
    validateCount(count);
    const counter = readCounter();
    assertSalt(counter);
    const next = counter?.next ?? 1;
    writeCounter(next + count);
    return Array.from({ length: count }, (_, i) => next + i);
  };

  const claimSeeds = (count: number, commit = true): number[] => {
    validateCount(count);
    const counter = readCounter();
    assertSalt(counter);
    const next = counter?.next ?? 1;
    const waiting = waitingSeeds().slice(0, count);
    const fresh = count - waiting.length;
    if (commit && fresh) writeCounter(next + fresh);
    return [...waiting, ...Array.from({ length: fresh }, (_, i) => next + i)];
  };

  const listFrames = (): FrameRecord[] => {
    const latestOk = new Map<number, ManifestRow>();
    for (const row of readManifest()) {
      if (row.status === "ok") latestOk.set(row.seed, row);
      else if (row.status === "rejected") latestOk.delete(row.seed);
    }
    return frameSeeds().map((seed) => {
      const row = latestOk.get(seed);
      const qcResult = row?.qc ?? row?.qcResult ?? row?.qualityCheck ?? row?.quality;
      const flags = row?.flags ?? qcResult?.flags;
      const quarantined = row?.quarantined ?? false;
      return {
        seed,
        version: row?.version ?? "unknown",
        source: row?.source === "manual" ? "manual" : row ? "api" : "unknown",
        // Rows written before a Manifest carried a provider name one that was
        // available at the time, so this reads a fact about the row rather than
        // guessing at it. The default is stated here and nowhere else, because
        // this is the only module that reads the Manifest.
        provider: row ? (row.provider ?? "gemini") : undefined,
        model: row?.model,
        prompt: row?.prompt ?? "",
        updatedAt: statSync(frameFile(seed)).mtime.toISOString(),
        qc: qcResult,
        qcResult,
        qualityCheck: qcResult,
        quality: qcResult,
        rawHash: row?.rawHash ?? row?.rawSha256 ?? qcResult?.rawHash ?? qcResult?.rawSha256,
        rawSha256: row?.rawSha256 ?? row?.rawHash ?? qcResult?.rawSha256 ?? qcResult?.rawHash,
        sha256: row?.sha256 ?? row?.rawHash ?? row?.rawSha256 ?? qcResult?.sha256 ?? qcResult?.rawHash,
        hash: row?.hash ?? row?.rawHash ?? row?.rawSha256 ?? qcResult?.hash ?? qcResult?.rawHash,
        frameHash: row?.frameHash ?? row?.frameSha256 ?? row?.normalizedFrameHash ?? qcResult?.frameHash ?? qcResult?.normalizedFrameHash,
        normalizedFrameHash: row?.normalizedFrameHash ?? row?.frameHash ?? qcResult?.normalizedFrameHash ?? qcResult?.frameHash,
        frameSha256: row?.frameSha256 ?? row?.frameHash ?? qcResult?.frameSha256 ?? qcResult?.frameHash,
        perceptualFingerprint: row?.perceptualFingerprint ?? row?.fingerprint ?? qcResult?.perceptualFingerprint ?? qcResult?.fingerprint,
        fingerprint: row?.fingerprint ?? row?.perceptualFingerprint ?? qcResult?.fingerprint ?? qcResult?.perceptualFingerprint,
        width: row?.width ?? qcResult?.width ?? qcResult?.dimensions?.width,
        height: row?.height ?? qcResult?.height ?? qcResult?.dimensions?.height,
        aspectRatio: row?.aspectRatio ?? qcResult?.aspectRatio,
        flags: flags ?? qcResult?.flags,
        qcVersion: row?.qcVersion ?? qcResult?.version,
        quarantined,
        quarantinePath: row?.quarantinePath,
      };
    });
  };

  const readFrame = (seed: number, raw = false): ReadStream => {
    validateSeed(seed);
    const file = raw ? rawFile(seed) : frameFile(seed);
    if (!existsSync(file)) throw new ArchiveError("missing-frame", `No Frame for Seed ${seed}`);
    return createReadStream(file);
  };

  const readThumbnail = async (seed: number, width: number): Promise<ReadStream> => {
    validateSeed(seed);
    if (!Number.isInteger(width) || width < 1) throw new ArchiveError("invalid-count", "Thumbnail width must be a positive whole number");
    if (!hasFrame(seed)) throw new ArchiveError("missing-frame", `No Frame for Seed ${seed}`);
    const src = frameFile(seed);
    mkdirSync(thumbDir, { recursive: true });
    const dest = join(thumbDir, `${pad(seed)}-${width}.webp`);
    if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs)
      await sharp(src).resize({ width }).webp({ quality: 80 }).toFile(dest);
    return createReadStream(dest);
  };

  const recordAttempt = (attempt: Attempt): void => {
    validateSeed(attempt.seed);
    const counter = readCounter();
    assertSalt(counter);
    mkdirSync(root, { recursive: true });
    if (attempt.status === "rejected") {
      appendFileSync(manifestFile, JSON.stringify({ seed: attempt.seed, status: "rejected", ts: attempt.ts ?? new Date().toISOString() }) + "\n");
      return;
    }
    const { seed, provider, model, source, file, prompt, status: result, error, ts, qc: qcResult } = attempt;
    const effectiveQc = qcResult ?? attempt.qcResult ?? attempt.qualityCheck ?? attempt.quality;
    const row: Record<string, unknown> = { seed, version, salt };
    if (provider !== undefined) row.provider = provider;
    if (model !== undefined) row.model = model;
    if (source !== undefined) row.source = source;
    if (file !== undefined) row.file = file;
    row.prompt = prompt ?? buildPrompt(template, seed, salt).trim();
    row.status = result;
    if (error !== undefined) row.error = error;
    if (ts !== undefined) row.ts = ts;
    if (effectiveQc !== undefined) {
      row.qc = effectiveQc;
      row.qcResult = effectiveQc;
      row.qualityCheck = effectiveQc;
      row.quality = effectiveQc;
      row.rawHash = attempt.rawHash ?? attempt.rawSha256 ?? effectiveQc.rawHash ?? effectiveQc.rawSha256;
      row.rawSha256 = attempt.rawSha256 ?? attempt.rawHash ?? effectiveQc.rawSha256 ?? effectiveQc.rawHash;
      row.sha256 = attempt.sha256 ?? attempt.rawHash ?? attempt.rawSha256 ?? effectiveQc.sha256 ?? effectiveQc.rawHash;
      row.hash = attempt.hash ?? attempt.rawHash ?? attempt.rawSha256 ?? effectiveQc.hash ?? effectiveQc.rawHash;
      row.frameHash = attempt.frameHash ?? attempt.frameSha256 ?? attempt.normalizedFrameHash ?? effectiveQc.frameHash ?? effectiveQc.normalizedFrameHash;
      row.normalizedFrameHash = attempt.normalizedFrameHash ?? attempt.frameHash ?? effectiveQc.normalizedFrameHash ?? effectiveQc.frameHash;
      row.frameSha256 = attempt.frameSha256 ?? attempt.frameHash ?? effectiveQc.frameSha256 ?? effectiveQc.frameHash;
      row.perceptualFingerprint = attempt.perceptualFingerprint ?? attempt.fingerprint ?? effectiveQc.perceptualFingerprint ?? effectiveQc.fingerprint;
      row.fingerprint = attempt.fingerprint ?? attempt.perceptualFingerprint ?? effectiveQc.fingerprint ?? effectiveQc.perceptualFingerprint;
      row.width = attempt.width ?? effectiveQc.width ?? effectiveQc.dimensions?.width;
      row.height = attempt.height ?? effectiveQc.height ?? effectiveQc.dimensions?.height;
      row.aspectRatio = attempt.aspectRatio ?? effectiveQc.aspectRatio;
      row.flags = attempt.flags ?? effectiveQc.flags;
      row.qcVersion = effectiveQc.version;
    } else if (attempt.rawHash !== undefined || attempt.flags !== undefined) {
      if (attempt.rawHash !== undefined) row.rawHash = attempt.rawHash;
      if (attempt.rawSha256 !== undefined) row.rawSha256 = attempt.rawSha256;
      if (attempt.sha256 !== undefined) row.sha256 = attempt.sha256;
      if (attempt.hash !== undefined) row.hash = attempt.hash;
      if (attempt.frameHash !== undefined) row.frameHash = attempt.frameHash;
      if (attempt.normalizedFrameHash !== undefined) row.normalizedFrameHash = attempt.normalizedFrameHash;
      if (attempt.frameSha256 !== undefined) row.frameSha256 = attempt.frameSha256;
      if (attempt.perceptualFingerprint !== undefined) row.perceptualFingerprint = attempt.perceptualFingerprint;
      if (attempt.fingerprint !== undefined) row.fingerprint = attempt.fingerprint;
      if (attempt.width !== undefined) row.width = attempt.width;
      if (attempt.height !== undefined) row.height = attempt.height;
      if (attempt.aspectRatio !== undefined) row.aspectRatio = attempt.aspectRatio;
      if (attempt.flags !== undefined) row.flags = attempt.flags;
    }
    if (attempt.quarantined !== undefined) row.quarantined = attempt.quarantined;
    if (attempt.quarantinePath !== undefined) row.quarantinePath = attempt.quarantinePath;
    appendFileSync(manifestFile, JSON.stringify(row) + "\n");
  };

  const writeFrame = async (frame: FrameWrite): Promise<void> => {
    validateSeed(frame.seed);
    const counter = readCounter();
    assertSalt(counter);
    if (!counter || frame.seed >= counter.next || hasFrame(frame.seed))
      throw new ArchiveError("seed-not-waiting", `Seed ${frame.seed} is not waiting for a Frame`);

    // Every Frame is checked with the module that owns image quality before it
    // is accepted, so a corrupt or undecodable download is not mistaken for a
    // finished Frame. A Frame that fails the check is quarantined with its
    // original bytes rather than written into the archive.
    const quality = frame.qc ?? await qc(frame.buffer);
    const decodeFailed = !quality.decodeOk || quality.width === 0 || quality.height === 0;
    if (decodeFailed) {
      mkdirSync(quarantineDirPath, { recursive: true });
      const destination = join(quarantineDirPath, `${pad(frame.seed)}.png`);
      writeFileSync(destination, frame.buffer);
      recordAttempt({
        ...frame,
        status: "failed",
        qc: quality,
        quarantined: true,
        quarantinePath: destination,
        error: `qc: ${quality.flags.join(", ") || "unreadable image"}`,
      });
      throw new Error(`qc: ${quality.flags.join(", ") || "unreadable image"}`);
    }

    mkdirSync(join(root, "raw"), { recursive: true });
    // The bytes the vendor sent, written as they arrived. Both vendors sign their
    // images with C2PA content credentials, and re-encoding through sharp would
    // strip that signature — Google documents any non-C2PA modification as
    // tampering. The Frame below is still resized, because a Frame is a fixed
    // size by definition and carries no such claim.
    writeFileSync(rawFile(frame.seed), frame.buffer);
    await sharp(frame.buffer).resize(768, 1152, { fit: "cover", position: "attention" }).png().toFile(frameFile(frame.seed));
    recordAttempt({ ...frame, status: "ok", qc: quality });
  };

  const importFrames = async (files: FileForImport[], seeds: number[]): Promise<ImportedFrame[]> => {
    const counter = readCounter();
    assertSalt(counter);
    if (!files.length || files.length !== seeds.length)
      throw new ArchiveError("invalid-count", files.length ? "Send one Seed per Frame" : "No Frames were sent");
    if (new Set(seeds).size !== seeds.length)
      throw new ArchiveError("seed-not-waiting", "Two Frames share a Seed");
    const waiting = new Set(waitingSeeds());
    if (seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 1)) throw invalidSeed();
    if (seeds.some((seed) => !waiting.has(seed)))
      throw new ArchiveError("seed-not-waiting", `Seeds not waiting for a Frame: ${seeds.filter((seed) => !waiting.has(seed)).join(", ")}`);
    const results: ImportedFrame[] = [];
    for (const [i, file] of files.entries()) {
      const seed = seeds[i];
      try {
        const meta = await sharp(file.buffer).metadata();
        const ratio = (meta.width ?? 1) / (meta.height ?? 1);
        const warning = Math.abs(ratio / (2 / 3) - 1) > 0.06
          ? `${meta.width}x${meta.height} is not 2:3, so the crop cuts part of the image` : undefined;
        await writeFrame({ seed, buffer: file.buffer, source: "manual", file: file.name, ts: new Date().toISOString() });
        results.push({ seed, file: file.name, ok: true, warning });
      } catch (err) {
        results.push({ seed, file: file.name, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  };

  const rejectFrame = (seed: number): void => {
    validateSeed(seed);
    const counter = readCounter();
    assertSalt(counter);
    if (!hasFrame(seed)) throw new ArchiveError("missing-frame", `No Frame for Seed ${seed}`);
    rmSync(frameFile(seed), { force: true });
    rmSync(rawFile(seed), { force: true });
    for (const file of existsSync(thumbDir) ? readdirSync(thumbDir) : [])
      if (file.startsWith(`${pad(seed)}-`)) rmSync(join(thumbDir, file), { force: true });
    recordAttempt({ seed, status: "rejected" });
  };

  const promptFor = (seed: number, useNegative = false): string => {
    validateSeed(seed);
    return composePrompt(template, negative, seed, salt, useNegative);
  };
  const promptsFor = (seeds: number[], useNegative = false): PromptItem[] =>
    seeds.map((seed) => ({ seed, prompt: promptFor(seed, useNegative) }));

  const supportedExtensions = (): string[] => [".png", ".jpg", ".jpeg", ".webp"];
  const quarantineDir = (): string => quarantineDirPath;
  const quarantinedFiles = (): string[] =>
    existsSync(quarantineDirPath) ? readdirSync(quarantineDirPath).sort() : [];
  const quarantinedSeeds = (): number[] =>
    quarantinedFiles()
      .map((name) => name.match(/^(\d{5})/)?.[1])
      .filter((match): match is string => !!match)
      .map(Number);
  const quarantineFrame = async (seed: number, buffer: Buffer, result?: QCResult): Promise<void> => {
    validateSeed(seed);
    const quality = result ?? await qc(buffer);
    mkdirSync(quarantineDirPath, { recursive: true });
    writeFileSync(join(quarantineDirPath, `${pad(seed)}.png`), buffer);
    recordAttempt({
      seed,
      status: "failed",
      qc: quality,
      quarantined: true,
      quarantinePath: join(quarantineDirPath, `${pad(seed)}.png`),
      error: `qc: ${quality.flags.join(", ") || "quarantined"}`,
    });
  };
  const qcFrame = async (seed: number): Promise<QCResult | undefined> => {
    validateSeed(seed);
    const file = frameFile(seed);
    if (!existsSync(file)) return undefined;
    try {
      return await qc(readFileSync(file));
    } catch {
      return undefined;
    }
  };

  return Object.freeze({
    status, waitingSeeds, issueSeeds, claimSeeds, listFrames, hasFrame, readFrame,
    readThumbnail, writeFrame, importFrames, rejectFrame, recordAttempt, promptFor, promptsFor,
    quarantineDir, quarantinedFiles, quarantinedSeeds, quarantineFrame, qcFrame,
    supportedExtensions, extensions: supportedExtensions(),
    manifestRows: readManifest,
    listAttempts: readManifest,
    attempts: readManifest,
  });
}