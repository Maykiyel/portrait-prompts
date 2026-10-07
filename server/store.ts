import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { ImageItem, ImportResult, PromptsResponse, Status } from "../shared/api-types";
import {
  assertSalt, issueSeeds, loadTemplate, logManifest, pad, pendingSeeds, readCursor, saveImage,
} from "../common";
import { buildPrompt, composePrompt } from "../sampler";

export const OUT = process.env.OUT_DIR ?? "out";
export const OUT_W = 768;
export const OUT_H = 1152;

export class ApiError extends Error {
  constructor(public status: 400 | 404 | 409 | 500, message: string) {
    super(message);
  }
}

type ManifestRow = {
  seed: number;
  status: string;
  version?: string;
  model?: string;
  source?: string;
  prompt?: string;
  ts?: string;
};

function readManifest(): ManifestRow[] {
  const file = join(OUT, "manifest.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ManifestRow);
}

function finalSeeds(): number[] {
  if (!existsSync(OUT)) return [];
  return readdirSync(OUT)
    .map((f) => f.match(/^(\d{5})\.png$/)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .sort((a, b) => a - b);
}

export function getStatus(salt: string): Status {
  const { version } = loadTemplate();
  let problem: string | undefined;
  try {
    assertSalt(OUT, salt);
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  return {
    problem,
    version,
    next: readCursor(OUT),
    done: finalSeeds().length,
    waiting: pendingSeeds(OUT).length,
    saltSet: salt !== "",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  };
}

function promptsFor(seeds: number[], salt: string, useNegative: boolean): PromptsResponse {
  const { template, negative } = loadTemplate();
  return {
    items: seeds.map((seed) => ({ seed, prompt: composePrompt(template, negative, seed, salt, useNegative) })),
  };
}

export function getPending(salt: string, useNegative = false): PromptsResponse {
  assertSalt(OUT, salt);
  return promptsFor(pendingSeeds(OUT), salt, useNegative);
}

/** Issues `count` new seeds and returns every waiting prompt, new ones included. */
export function addPrompts(count: number, salt: string, useNegative = false): PromptsResponse {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new ApiError(400, "count must be a whole number from 1 to 500");
  issueSeeds(OUT, salt, count);
  return promptsFor(pendingSeeds(OUT), salt, useNegative);
}

export function getPrompt(seed: number, salt: string): string {
  const { template } = loadTemplate();
  return buildPrompt(template, seed, salt).trim();
}

export function listImages(): ImageItem[] {
  const latestOk = new Map<number, ManifestRow>();
  for (const r of readManifest()) {
    if (r.status === "ok") latestOk.set(r.seed, r);
    else if (r.status === "rejected") latestOk.delete(r.seed);
  }
  return finalSeeds()
    .reverse()
    .map((seed) => {
      const row = latestOk.get(seed);
      const mtime = statSync(join(OUT, `${pad(seed)}.png`)).mtime.toISOString();
      return {
        seed,
        version: row?.version ?? "unknown",
        source: row?.source === "manual" ? "manual" : row ? "api" : "unknown",
        model: row?.model,
        prompt: row?.prompt ?? "",
        updatedAt: mtime,
      } satisfies ImageItem;
    });
}

export function imagePath(seed: number, raw = false): string {
  const p = raw ? join(OUT, "raw", `${pad(seed)}.png`) : join(OUT, `${pad(seed)}.png`);
  if (!existsSync(p)) throw new ApiError(404, `No image for seed ${seed}`);
  return p;
}

export async function thumbnail(seed: number, width: number): Promise<string> {
  const src = imagePath(seed);
  const dir = join(OUT, "thumbs");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${pad(seed)}-${width}.webp`);
  if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) {
    await sharp(src).resize({ width }).webp({ quality: 80 }).toFile(dest);
  }
  return dest;
}

/** Removes the image so its seed goes back to waiting. The manifest keeps a record. */
export function rejectImage(seed: number) {
  imagePath(seed); // 404 if missing
  for (const p of [
    join(OUT, `${pad(seed)}.png`),
    join(OUT, "raw", `${pad(seed)}.png`),
  ]) rmSync(p, { force: true });
  for (const f of existsSync(join(OUT, "thumbs")) ? readdirSync(join(OUT, "thumbs")) : [])
    if (f.startsWith(`${pad(seed)}-`)) rmSync(join(OUT, "thumbs", f), { force: true });
  logManifest(OUT, { seed, status: "rejected", ts: new Date().toISOString() });
}

export async function importFiles(files: File[], seeds: number[], salt: string): Promise<ImportResult[]> {
  assertSalt(OUT, salt);
  if (files.length === 0) throw new ApiError(400, "No images were sent");
  if (seeds.length !== files.length) throw new ApiError(400, "Send one seed per image");
  if (new Set(seeds).size !== seeds.length) throw new ApiError(400, "Two images share a seed");
  const waiting = new Set(pendingSeeds(OUT));
  const bad = seeds.filter((s) => !waiting.has(s));
  if (bad.length) throw new ApiError(409, `Seeds not waiting for an image: ${bad.join(", ")}`);

  const { version } = loadTemplate();
  const results: ImportResult[] = [];
  for (const [i, file] of files.entries()) {
    const seed = seeds[i];
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const ratio = (meta.width ?? 1) / (meta.height ?? 1);
      const warning = Math.abs(ratio / (2 / 3) - 1) > 0.06 ? `${meta.width}x${meta.height} is not 2:3, so the crop cuts part of the image` : undefined;
      await saveImage(buf, seed, { outDir: OUT, width: OUT_W, height: OUT_H });
      logManifest(OUT, {
        seed, version, salt, source: "manual", file: file.name,
        prompt: getPrompt(seed, salt), status: "ok", ts: new Date().toISOString(),
      });
      results.push({ seed, file: file.name, ok: true, warning });
    } catch (err) {
      results.push({ seed, file: file.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
