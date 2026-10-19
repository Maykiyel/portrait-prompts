import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadStream } from "node:fs";
import sharp from "sharp";
import { ArchiveError, FrameQuarantined, type ArchiveErrorCode } from "./errors";
import { buildPrompt, composePrompt, samplePortrait, samplerHash, templateHash } from "./sampler";
import { qc, type QCResult, type QcFlag, type QcStatus } from "./qc";
import { readRow, sampledPortrait } from "./manifest-reader";
import type {
  AttributesSource, DuplicateRecord, FrameSource, GenerationParams, GenerationStatus,
  ImageDigest, IngestQuarantine, ManifestRow, NormalizedDigest, SampledPortrait, SchemaVersion,
} from "./manifest-types";

// The row shape is stated in the types module and the reading of it in the reader,
// and both are re-exported from here because this module is the only thing that
// owns the archive. Anything else asks this module for rows rather than reaching
// past it, and that claim is enforced over the whole tree rather than trusted.
export { FrameQuarantined };
export type {
  AttributesSource, DuplicateRecord, FrameSource, GenerationParams, GenerationRow, GenerationStatus,
  ImageDigest, IngestQuarantine, ManifestRow, NormalizedDigest, ReviewReason, ReviewRow,
  SampledPortrait, SchemaVersion, SkinEyeBands,
} from "./manifest-types";

/** The schema version stamped on every row this work writes. */
const SCHEMA = 2 as const satisfies SchemaVersion;

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The shape a Frame is normalized to, and the steps that make it.
 *
 * These are written down once, here, because they are used twice: once to build
 * the artifact and once to record what built it. A row that names steps nobody
 * ran is worse than no steps at all, so the two cannot come apart.
 */
const NORMALIZE = { width: 768, height: 1152, fit: "cover", position: "attention", format: "png" } as const;

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

/**
 * What the browser is told about a Frame, and nothing more.
 *
 * This is the whole per-Frame payload for a Gallery grid, so it holds the facts
 * a grid draws and nothing else. The QC record, the digests and the sampled
 * attributes stay in the archive: there is a route for one Frame's full record,
 * and sending all of it for every Frame in the list is what made the payload grow
 * with fields no reader used.
 */
export type FrameRecord = {
  seed: number;
  version: string;
  source: "api" | "manual" | "unknown";
  /** Which Provider made this. Absent when the row never named one. */
  provider?: string;
  model?: string;
  prompt: string;
  updatedAt: string;
  primaryGroup?: string;
  photographyProfile?: string;
  /** The roll-up the stored QC record reached. Absent when no QC record was stored. */
  qcStatus?: QcStatus;
  flags?: QcFlag[];
};

export type PromptItem = { seed: number; prompt: string };

/**
 * One Seed's full record, for a view that shows a single Frame in detail.
 *
 * The generation row and the review decision are kept apart rather than merged,
 * because they are two rows in an append-only archive and a merged object would
 * be a row nobody ever wrote.
 */
export type SeedRecord = {
  seed: number;
  /** The latest generation or import row for this Seed, as stored. */
  frame: ManifestRow;
  /** The latest review decision for this Seed, when one has been made. */
  review?: ManifestRow;
};

/**
 * A Frame offered to the archive, with the one sampling that built its Prompt.
 *
 * `sample` is how the Prompt and the stored attributes are guaranteed to agree:
 * hand the same sampling in and the row cannot describe two Portraits. A caller
 * that has not sampled asks for one below instead, and pays for exactly one
 * draw either way.
 */
export type FrameWrite = {
  seed: number;
  buffer: Buffer;
  sample?: SampledPortrait;
  prompt?: string;
  provider?: string;
  model?: string;
  source?: FrameSource;
  file?: string;
  attributesSource?: AttributesSource;
  params?: GenerationParams | null;
  ts?: string;
};

/** One generation or import attempt, as the caller reports it. */
export type GenerationRecord = {
  seed: number;
  status: GenerationStatus;
  provider?: string;
  model?: string;
  source?: FrameSource;
  file?: string;
  prompt?: string;
  error?: string;
  ts?: string;
  attributesSource?: AttributesSource;
  params?: GenerationParams | null;
  sample?: SampledPortrait;
  raw?: ImageDigest;
  normalized?: NormalizedDigest;
  qc?: QCResult;
  duplicates?: DuplicateRecord;
  quarantine?: IngestQuarantine;
};

export type ImportedFrame = { seed: number; file: string; ok: boolean; warning?: string; error?: string; qc?: QCResult };
export type FileForImport = { name: string; buffer: Buffer };

export type OutputFolder = Readonly<{
  status(): FolderStatus;
  waitingSeeds(): number[];
  issueSeeds(count: number): number[];
  claimSeeds(count: number, commit?: boolean): number[];
  listFrames(): FrameRecord[];
  /** One Seed's full record, for the detail view. */
  frameRecord(seed: number): SeedRecord | undefined;
  /** Read-only view of the Manifest's rows, for audit and reporting. */
  manifestRows(): ManifestRow[];
  hasFrame(seed: number): boolean;
  readFrame(seed: number, raw?: boolean): ReadStream;
  readThumbnail(seed: number, width: number): Promise<ReadStream>;
  writeFrame(frame: FrameWrite): Promise<void>;
  importFrames(files: FileForImport[], seeds: number[]): Promise<ImportedFrame[]>;
  rejectFrame(seed: number): void;
  recordAttempt(attempt: GenerationRecord): void;
  /** The Prompt and the attributes that built it, from a single sampling. */
  sampleFor(seed: number, useNegative?: boolean): SampledPortrait;
  promptFor(seed: number, useNegative?: boolean): string;
  promptsFor(seeds: number[], useNegative?: boolean): PromptItem[];
  quarantineDir(): string;
  quarantinedFiles(): string[];
  quarantinedSeeds(): number[];
  quarantineFrame(seed: number, buffer: Buffer, result?: QCResult): Promise<void>;
  qcFrame(seed: number): Promise<QCResult | undefined>;
}>;

type Counter = { next: number; salt: string };

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
  // The two fingerprints of the definitions this folder prompts from, hashed once
  // here and stamped on every row it writes. A reader can then tell which Prompt
  // text and which sampler tables built a Seed without trusting the version tag
  // alone, which is a thing a person can forget to bump.
  const templateFingerprint = templateHash(rawTemplate);
  const samplerFingerprint = samplerHash();

  const frameFile = (seed: number) => join(root, `${pad(seed)}.png`);
  const rawFile = (seed: number) => join(root, "raw", `${pad(seed)}.png`);
  const counterFile = join(root, "cursor.json");
  const manifestFile = join(root, "manifest.jsonl");
  const thumbDir = join(root, "thumbs");
  const quarantineDirPath = join(root, "quarantine");

  /**
   * The Prompt for a Seed and the sample that filled it, from one draw.
   *
   * These are two views of a single sampling, and a row that held one from each
   * would describe a Portrait nobody asked for. Everything that writes a row
   * asks here, so there is one call that answers both rather than two that can
   * disagree.
   */
  const sampleFor = (seed: number, useNegative = false): SampledPortrait => {
    validateSeed(seed);
    return sampledPortrait(seed, composePrompt(template, negative, seed, salt, useNegative), samplePortrait(seed, salt));
  };

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

  /** Every row on disk, each one read by the one reader that knows all three builds. */
  const readManifest = (): ManifestRow[] =>
    existsSync(manifestFile)
      ? readFileSync(manifestFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => readRow(JSON.parse(line)))
        .filter((row): row is ManifestRow => row !== undefined)
      : [];

  /** What each Seed's rows add up to: its latest generation attempt and its latest review decision. */
  type SeedState = { generation?: ManifestRow; review?: ManifestRow };

  const latestBySeed = (): Map<number, SeedState> => {
    const latest = new Map<number, SeedState>();
    for (const row of readManifest()) {
      const state = latest.get(row.seed) ?? {};
      if (row.review !== undefined) state.review = row;
      else if (row.status !== undefined) state.generation = row;
      latest.set(row.seed, state);
    }
    return latest;
  };

  /**
   * What each Seed's last generation attempt came to, once review has had its say.
   *
   * A review row is never an outcome of its own: it is a decision about a Frame,
   * not an attempt to make one. It does clear the outcome, because a rejected
   * Frame puts its Seed back to waiting and a waiting Seed is not a failed one.
   * That is what the Manifest always did, where the rejection was itself a row
   * carrying a status, and keeping it is what makes the failed count say which
   * Seeds a later run will actually try.
   */
  const latestOutcomes = (): Map<number, GenerationStatus> => {
    const outcomes = new Map<number, GenerationStatus>();
    for (const [seed, state] of latestBySeed()) {
      if (state.review?.review === "rejected" || state.generation?.status === undefined) outcomes.delete(seed);
      else outcomes.set(seed, state.generation.status);
    }
    return outcomes;
  };

  /** The row a Frame on disk is described by, when it has one that still stands. */
  const frameRowFor = (latest: Map<number, SeedState>, seed: number): ManifestRow | undefined => {
    const state = latest.get(seed);
    return state && state.review?.review !== "rejected" && state.generation?.status === "ok"
      ? state.generation
      : undefined;
  };

  const waitingSeeds = (): number[] => {
    const counter = readCounter();
    assertSalt(counter);
    const latest = latestOutcomes();
    const waiting: number[] = [];
    // A Seed whose Prompt was refused is finished, not waiting. It has no Frame
    // and will never get one, so handing it out again would spend a run on a
    // Prompt the vendor has already refused once and will refuse every time.
    for (let seed = 1; seed < (counter?.next ?? 1); seed++)
      if (!hasFrame(seed) && latest.get(seed) !== "blocked") waiting.push(seed);
    return waiting;
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
    const latest = latestOutcomes();
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

  /**
   * What the archive knows about every Frame on disk, and nothing else.
   *
   * Read off disk rather than off the Manifest, because the file is the fact: a
   * Seed with a Frame is in the Gallery whether or not a row survives, and a row
   * that survives for a Seed whose Frame was deleted describes nothing.
   */
  const listFrames = (): FrameRecord[] => {
    const latest = latestBySeed();
    return frameSeeds().map((seed) => {
      const row = frameRowFor(latest, seed);
      return {
        seed,
        version: row?.version ?? "unknown",
        source: row?.source ?? "unknown",
        // Whatever the row said, and nothing said on its behalf. An older row that
        // never named a Provider leaves this absent rather than guessing the one
        // that happened to be available when it was written.
        provider: row?.provider ?? undefined,
        model: row?.model ?? undefined,
        prompt: row?.prompt ?? "",
        updatedAt: statSync(frameFile(seed)).mtime.toISOString(),
        ...(row?.primaryGroup === undefined ? {} : { primaryGroup: row.primaryGroup }),
        ...(row?.photographyProfile === undefined ? {} : { photographyProfile: row.photographyProfile }),
        ...(row?.qc === undefined ? {} : { qcStatus: row.qc.status, flags: row.qc.flags }),
      };
    });
  };

  /**
   * One Seed's full record, for the detail view.
   *
   * The grid gets a summary per Frame and this gets the row as stored, which is
   * the only place the digests, the sampled attributes and the QC record are
   * read. Nothing about it is derived here: a field the row does not carry is
   * not on the answer.
   */
  const frameRecord = (seed: number): SeedRecord | undefined => {
    validateSeed(seed);
    const state = latestBySeed().get(seed);
    if (!state?.generation) return undefined;
    return { seed, frame: state.generation, ...(state.review === undefined ? {} : { review: state.review }) };
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

  /**
   * Appends one row. The archive is append-only and a row is never rewritten, so
   * this is the only way anything lands in it.
   *
   * Fields that came out undefined are dropped rather than written, because an
   * absent key is how this archive says it does not know, and writing the key
   * anyway would say something else.
   */
  const appendRow = (row: Record<string, unknown>): void => {
    mkdirSync(root, { recursive: true });
    for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
    appendFileSync(manifestFile, JSON.stringify(row) + "\n");
  };

  /**
   * Records one generation or import attempt, with nothing filled in on the
   * caller's behalf.
   *
   * The two fields a caller can be wrong about are settled here rather than
   * above. A row naming no source was not a manual import, because a manual
   * import is the only ingestion here that has a file to name, so the source
   * defaults to `api`. Everything else that is missing is left missing: a
   * Provider, a model, the bytes and the QC record of an attempt that received
   * none, and the sampled attributes of a Seed nobody sampled.
   */
  const recordAttempt = (attempt: GenerationRecord): void => {
    validateSeed(attempt.seed);
    const counter = readCounter();
    assertSalt(counter);
    const manual = attempt.source === "manual";
    const sample = attempt.sample;
    appendRow({
      schema: SCHEMA,
      seed: attempt.seed,
      version,
      salt,
      ts: attempt.ts ?? new Date().toISOString(),
      status: attempt.status,
      error: attempt.error,
      source: attempt.source ?? "api",
      // `null` on a manual row, because no Provider was asked for anything. On
      // an api row a Provider that was never named stays absent: null there would
      // claim one does not apply, and it very much does.
      provider: manual ? null : attempt.provider,
      model: manual ? null : attempt.model,
      file: attempt.file,
      prompt: attempt.prompt ?? sample?.prompt ?? buildPrompt(template, attempt.seed, salt).trim(),
      templateHash: templateFingerprint,
      samplerHash: samplerFingerprint,
      attributes: sample?.attributes,
      details: sample?.details,
      primaryGroup: sample?.primaryGroup,
      groups: sample?.groups,
      ethnicities: sample?.ethnicities,
      photographyProfile: sample?.photographyProfile,
      bands: sample?.bands,
      attributesSource: attempt.attributesSource,
      params: manual ? null : attempt.params,
      raw: attempt.raw,
      normalized: attempt.normalized,
      qc: attempt.qc,
      // Absent until the duplicate check runs. An empty list would claim a check
      // that never happened, which is the one thing an absent key is for.
      duplicates: attempt.duplicates,
      quarantine: attempt.quarantine,
    });
  };

  /** The measured size of some bytes, or zeroes when they will not read at all. */
  const measure = async (bytes: Buffer): Promise<{ width: number; height: number }> => {
    try {
      const meta = await sharp(bytes).metadata();
      return { width: meta.width ?? 0, height: meta.height ?? 0 };
    } catch {
      return { width: 0, height: 0 };
    }
  };

  const writeFrame = async (frame: FrameWrite): Promise<void> => {
    validateSeed(frame.seed);
    const counter = readCounter();
    assertSalt(counter);
    if (!counter || frame.seed >= counter.next || hasFrame(frame.seed))
      throw new ArchiveError("seed-not-waiting", `Seed ${frame.seed} is not waiting for a Frame`);

    // One sampling answers for the Prompt and the attributes together. A caller
    // that already drew it hands that draw in rather than paying for a second
    // one, which is the whole point of asking for both at once.
    const sample = frame.sample ?? sampleFor(frame.seed);
    const source = frame.source ?? "api";
    const provenance = {
      ...frame,
      source,
      prompt: frame.sample?.prompt ?? frame.prompt ?? sample.prompt,
      sample,
      attributesSource: frame.attributesSource ?? (source === "manual" ? "import" as const : "run" as const),
      params: frame.params === undefined && source === "manual" ? null : frame.params,
    };

    // The bytes as they arrived, hashed before anything has looked at them. The
    // raw hash is a statement about what came back and nothing else.
    const rawBytes = frame.buffer;
    const rawSize = await measure(rawBytes);
    const raw: ImageDigest = { sha256: sha256(rawBytes), bytes: rawBytes.length, ...rawSize };

    // The artifact is built once, hashed and then written from that one buffer.
    // Hashing one pipeline's output while writing another's was the defect: the
    // two were built with different crops, so the recorded hash described bytes
    // that were never stored, and nothing could check it against the Frame.
    let normalizedBytes: Buffer | undefined;
    let normalized: NormalizedDigest | undefined;
    if (rawSize.width > 0 && rawSize.height > 0) {
      normalizedBytes = await sharp(rawBytes)
        .resize(NORMALIZE.width, NORMALIZE.height, { fit: NORMALIZE.fit, position: NORMALIZE.position })
        .png()
        .toBuffer();
      const written = await measure(normalizedBytes);
      normalized = {
        sha256: sha256(normalizedBytes),
        bytes: normalizedBytes.length,
        ...written,
        steps: { fit: NORMALIZE.fit, position: NORMALIZE.position, format: NORMALIZE.format },
      };
    }

    // Every Frame is checked with the module that owns image quality before it is
    // accepted, so a corrupt or undecodable download is not mistaken for a
    // finished Frame. The checks read the artifact when there is one, because
    // blank and luminance are questions about the Frame rather than about the
    // bytes it was cut from.
    const quality = await qc(rawBytes, normalizedBytes ? { normalized: normalizedBytes } : {});

    // Any check that fails sends the Frame to quarantine rather than the archive.
    // That is the whole of the rule: a Frame whose status is `fail` is not a Frame
    // this dataset keeps, whether it failed because the bytes would not decode,
    // because they reported no dimensions, or because the picture is blank enough
    // to carry no portrait. Naming two checks here instead of reading the status
    // let a near-blank image through into the archive while its own record said
    // `fail`, so the status is what decides.
    if (quality.status === "fail") {
      mkdirSync(quarantineDirPath, { recursive: true });
      const destination = join(quarantineDirPath, `${pad(frame.seed)}.png`);
      writeFileSync(destination, rawBytes);
      const reason = quality.flags.join(", ") || "failed the quality record";
      // Exactly one row for this attempt, and it carries the raw hash of the
      // bytes that arrived with no normalized hash beside it, because no
      // artifact was written for anyone to check one against.
      recordAttempt({
        ...provenance,
        status: "failed",
        raw,
        qc: quality,
        error: `qc: ${reason}`,
        quarantine: { path: destination, reason },
      });
      // A typed error, so the run's own catch can tell this from a call that
      // failed and leave the row above as the one and only record of it.
      throw new FrameQuarantined(frame.seed, destination, reason);
    }

    mkdirSync(join(root, "raw"), { recursive: true });
    // The bytes the vendor sent, written as they arrived. Both vendors sign their
    // images with C2PA content credentials, and re-encoding through sharp would
    // strip that signature. The Frame below is still resized, because a Frame is a
    // fixed size by definition and carries no such claim.
    writeFileSync(rawFile(frame.seed), rawBytes);
    writeFileSync(frameFile(frame.seed), normalizedBytes as Buffer);
    recordAttempt({ ...provenance, status: "ok", raw, normalized, qc: quality });
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
        // The attributes come from a fresh sampling, taken now, describing an
        // image that was made somewhere else. That is what `import` on the row
        // says, and it is why the row records the sampler hash beside them.
        await writeFrame({
          seed,
          buffer: file.buffer,
          sample: sampleFor(seed),
          source: "manual",
          file: file.name,
          attributesSource: "import",
          params: null,
          ts: new Date().toISOString(),
        });
        results.push({ seed, file: file.name, ok: true, warning });
      } catch (err) {
        results.push({ seed, file: file.name, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  };

  /**
   * Removes a Frame so its Seed goes back to waiting, and records the decision.
   *
   * The decision is a row of its own, with `kind: "review"`, rather than another
   * attempt: nothing was generated, so there is no outcome to record. The
   * archive is append-only, so this is the only way to say it.
   */
  const rejectFrame = (seed: number): void => {
    validateSeed(seed);
    const counter = readCounter();
    assertSalt(counter);
    if (!hasFrame(seed)) throw new ArchiveError("missing-frame", `No Frame for Seed ${seed}`);
    rmSync(frameFile(seed), { force: true });
    rmSync(rawFile(seed), { force: true });
    for (const file of existsSync(thumbDir) ? readdirSync(thumbDir) : [])
      if (file.startsWith(`${pad(seed)}-`)) rmSync(join(thumbDir, file), { force: true });
    appendRow({ schema: SCHEMA, seed, kind: "review", review: "rejected", ts: new Date().toISOString() });
  };

  const promptFor = (seed: number, useNegative = false): string => sampleFor(seed, useNegative).prompt;
  const promptsFor = (seeds: number[], useNegative = false): PromptItem[] =>
    seeds.map((seed) => ({ seed, prompt: promptFor(seed, useNegative) }));

  const quarantineDir = (): string => quarantineDirPath;
  const quarantinedFiles = (): string[] =>
    existsSync(quarantineDirPath) ? readdirSync(quarantineDirPath).sort() : [];
  const quarantinedSeeds = (): number[] =>
    quarantinedFiles()
      .map((name) => name.match(/^(\d{5})/)?.[1])
      .filter((match): match is string => !!match)
      .map(Number);

  /**
   * Puts bytes aside as a quarantine, for a Frame that was kept out of the
   * archive by a decision rather than by what arrived. The row is the same one
   * the ingestion path writes, with the raw hash of the bytes that were kept.
   */
  const quarantineFrame = async (seed: number, buffer: Buffer, result?: QCResult): Promise<void> => {
    validateSeed(seed);
    const quality = result ?? await qc(buffer);
    mkdirSync(quarantineDirPath, { recursive: true });
    const destination = join(quarantineDirPath, `${pad(seed)}.png`);
    writeFileSync(destination, buffer);
    const reason = quality.flags.join(", ") || "quarantined";
    recordAttempt({
      seed,
      status: "failed",
      raw: { sha256: sha256(buffer), bytes: buffer.length, ...(await measure(buffer)) },
      qc: quality,
      error: `qc: ${reason}`,
      quarantine: { path: destination, reason },
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
    status, waitingSeeds, issueSeeds, claimSeeds, listFrames, frameRecord, hasFrame, readFrame,
    readThumbnail, writeFrame, importFrames, rejectFrame, recordAttempt,
    sampleFor, promptFor, promptsFor,
    quarantineDir, quarantinedFiles, quarantinedSeeds, quarantineFrame, qcFrame,
    manifestRows: readManifest,
  });
}
