import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

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
  try {
    return Number(JSON.parse(readFileSync(cursorFile(outDir), "utf8")).next) || 1;
  } catch {
    return 1;
  }
}

function writeCursor(outDir: string, next: number) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(cursorFile(outDir), JSON.stringify({ next, salt: currentSalt() }));
}

/** Stops the run if SEED_SALT differs from the one this output folder was started with. */
export function assertSalt(outDir: string) {
  let recorded: string;
  try {
    recorded = String(JSON.parse(readFileSync(cursorFile(outDir), "utf8")).salt ?? "");
  } catch {
    return; // no counter yet, nothing to protect
  }
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
