import "dotenv/config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import sharp from "sharp";
import { namedSeeds, openOutputFolder, seedLabel } from "./output-folder";

export type ImportOptions = {
  inDir: string;
  /** Leave undefined to fill the oldest seeds that still have no image. */
  start?: number;
  outDir: string;
  dryRun: boolean;
  salt: string;
};

const EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export async function importImages(o: ImportOptions) {
  const folder = openOutputFolder(o.outDir, o.salt);
  const waiting = folder.waitingSeeds();

  // Which download lands on which Seed is this command's decision: it sorts
  // filesystem timestamps, which the module has never seen.
  const files = readdirSync(o.inDir)
    .filter((f) => EXT.has(extname(f).toLowerCase()))
    .map((f) => ({ f, t: statSync(join(o.inDir, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t || a.f.localeCompare(b.f))
    .map((x) => x.f);

  let seeds: number[];
  if (o.start !== undefined) {
    seeds = namedSeeds(folder, o.start, files.length, !o.dryRun);
  } else {
    seeds = waiting;
    if (files.length > seeds.length) {
      throw new Error(
        `${files.length} images but only ${seeds.length} seeds waiting for one. Run "prompts" first.`,
      );
    }
  }
  console.log(`${files.length} images in ${o.inDir}, matched to seeds by download time\n`);

  let imported = 0;
  for (let i = 0; i < files.length; i++) {
    const seed = seeds[i];
    const src = join(o.inDir, files[i]);
    const meta = await sharp(src).metadata();
    const ratio = (meta.width ?? 1) / (meta.height ?? 1);
    const offRatio = Math.abs(ratio / (2 / 3) - 1) > 0.06;
    const note = offRatio ? "  <-- not 2:3, the crop will cut the sides or top" : "";
    console.log(`${seedLabel(seed)}  ${files[i]}  ${meta.width}x${meta.height}${note}`);

    if (o.dryRun) continue;
    if (folder.hasFrame(seed)) {
      console.log(`       skipped, ${seedLabel(seed)}.png already exists`);
      continue;
    }
    await folder.writeFrame({ seed, buffer: readFileSync(src), source: "manual", file: files[i] });
    imported++;
  }
  console.log(o.dryRun ? "\nDry run, nothing written." : `\nImported ${imported} into ${o.outDir}/`);
  return { imported, total: files.length };
}

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (process.argv[1]?.endsWith("import-images.ts")) {
  const inDir = arg("--in");
  if (!inDir) {
    console.error('Usage: import-images --in "<folder>" [--dry-run]');
    process.exit(1);
  }
  importImages({
    inDir,
    start: arg("--start") !== undefined ? Number(arg("--start")) : undefined,
    outDir: arg("--out", "out")!,
    dryRun: process.argv.includes("--dry-run"),
    salt: (process.env.SEED_SALT ?? "").trim(),
  });
}
