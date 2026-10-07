import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, appendFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ArchiveError } from "./errors";

export const pad = (n: number) => String(n).padStart(5, "0");

/** Optional private text mixed into every seed so your prompts differ from other users'. */
export const currentSalt = () => (process.env.SEED_SALT ?? "").trim();

export function loadTemplate() {
  const raw = readFileSync("template.txt", "utf8");
  return {
    version: raw.match(/^#\s*(.+)\n/)?.[1]?.trim() ?? "unversioned",
    template: raw.replace(/^#.*\n/, ""),
    negative: readFileSync("negative.txt", "utf8").trim(),
  };
}

export type SaveOptions = { outDir: string; width: number; height: number };

/** Saves the untouched image to out/raw and a resized copy to out/. */
export async function saveImage(buf: Buffer, seed: number, o: SaveOptions) {
  mkdirSync(join(o.outDir, "raw"), { recursive: true });
  await sharp(buf).png().toFile(join(o.outDir, "raw", `${pad(seed)}.png`));
  await sharp(buf)
    .resize(o.width, o.height, { fit: "cover", position: "attention" })
    .png()
    .toFile(join(o.outDir, `${pad(seed)}.png`));
}

export function logManifest(outDir: string, row: Record<string, unknown>) {
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, "manifest.jsonl"), JSON.stringify(row) + "\n");
}

// Seed counter. Every command that hands out prompts shares it, so you never pick a start number.
const cursorFile = (outDir: string) => join(outDir, "cursor.json");

export function readCursor(outDir: string): number {
  return readCursorState(outDir)?.next ?? 1;
}

/** The counter as stored, or undefined when this folder has never handed out a Seed. */
function readCursorState(outDir: string): { next: number; salt: string } | undefined {
  const file = cursorFile(outDir);
  if (!existsSync(file)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw unreadable(outDir, err);
  }
  let parsed: { next?: unknown; salt?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw unreadable(outDir, err);
  }
  const next = Number(parsed.next);
  if (!Number.isInteger(next) || next < 1) {
    throw unreadable(outDir, new Error(`next is ${String(parsed.next)}`));
  }
  return { next, salt: String(parsed.salt ?? "") };
}

/** I cannot read your state is not the same as you have no state, so it is an error. */
function unreadable(outDir: string, cause: unknown): ArchiveError {
  const why = cause instanceof Error ? cause.message : String(cause);
  return new ArchiveError(
    "unreadable-counter",
    `Cannot read the Seed counter in ${outDir}/, so I cannot tell which Seeds were already handed out. ` +
      `Fix or remove ${outDir}/cursor.json to continue. (${why})`,
  );
}

/** Windows refuses the rename while another process has the counter open for reading. */
const wouldBlockRename = (err: unknown) =>
  ["EACCES", "EBUSY", "EPERM"].includes((err as NodeJS.ErrnoException).code ?? "");

/**
 * Written to a temporary file and renamed into place, so a reader running at the
 * same time sees either the old counter or the new one, never half of either.
 */
function writeCursor(outDir: string, next: number) {
  mkdirSync(outDir, { recursive: true });
  const dest = cursorFile(outDir);
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ next, salt: currentSalt() }));
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, dest);
        return;
      } catch (err) {
        if (attempt >= 200 || !wouldBlockRename(err)) throw err;
        sleep(1);
      }
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

const sleep = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Stops the run if SEED_SALT differs from the one this output folder was started with. */
export function assertSalt(outDir: string) {
  const recorded = readCursorState(outDir)?.salt;
  if (recorded === undefined) return; // no counter yet, nothing to protect
  if (recorded !== currentSalt()) {
    throw new Error(
      `SEED_SALT does not match ${outDir}/. It was started with ${recorded ? "a different salt" : "no salt"}, ` +
        `so the same seeds would now make different prompts. Restore the old SEED_SALT in .env, or move ${outDir}/ aside to start fresh.`,
    );
  }
}

/** Seeds already handed out that still have no final image, lowest first. */
export function pendingSeeds(outDir: string): number[] {
  const next = readCursor(outDir);
  const out: number[] = [];
  for (let s = 1; s < next; s++) if (!existsSync(join(outDir, `${pad(s)}.png`))) out.push(s);
  return out;
}

/**
 * Returns `count` seeds. Pending ones come first, so failed or unimported seeds get
 * finished before new ones are used. Pass commit=false to preview without advancing.
 */
export function claimSeeds(outDir: string, count: number, commit = true): number[] {
  assertSalt(outDir);
  const pending = pendingSeeds(outDir).slice(0, count);
  const next = readCursor(outDir);
  const fresh = count - pending.length;
  const seeds = [...pending, ...Array.from({ length: fresh }, (_, i) => next + i)];
  if (commit && fresh > 0) writeCursor(outDir, next + fresh);
  return seeds;
}

/** Hands out `count` brand new seeds, skipping any that are still waiting. */
export function issueSeeds(outDir: string, count: number): number[] {
  assertSalt(outDir);
  const next = readCursor(outDir);
  writeCursor(outDir, next + count);
  return Array.from({ length: count }, (_, i) => next + i);
}
