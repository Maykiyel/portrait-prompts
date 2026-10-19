import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { readArchive, seedLabel } from "../core/output-folder";
import type { ManifestRow } from "../core/output-folder";
import { distanceBits, perceptualHash, PHASH_ALGO, PHASH_THRESHOLD } from "../core/duplicates";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function countOf(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = sortObjectKeys(obj[key]);
    return sorted;
  }
  return value;
}

function sha256File(path: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

async function run() {
  const dir = arg("--dir", arg("--out", process.argv.slice(2).filter((a) => !a.startsWith("--"))[0] ?? "out"))!;
  const json = process.argv.includes("--json");
  void arg("--min-cell", "5");
  const phashThreshold = Number(arg("--phash-threshold", String(PHASH_THRESHOLD)));
  const salt = (process.env.SEED_SALT ?? "").trim();

  if (!existsSync(dir)) {
    console.error(`Cannot read folder: ${dir}`);
    process.exit(2);
    return;
  }

  const view = readArchive(dir);
  const rows = view.rows;
  const genRows = rows.filter((r) => r.status !== undefined);
  const diagnostics = view.diagnostics;
  const frames = view.frames;
  const quarantineFiles = view.quarantineFiles;

  const reportTimestamp = new Date().toISOString();
  const auditVersion = 1;

  // Generation outcomes from latest generation row per Seed.
  const latestGen = new Map<number, ManifestRow>();
  for (const row of rows) if (row.status !== undefined) latestGen.set(row.seed, row);

  const genStatusCounts = countOf([...latestGen.values()].map((r) => r.status ?? "unknown"));

  // Review counts.
  const reviewCounts = { unreviewed: 0, accepted: 0, rejected: 0 };
  const latestReview = new Map<number, ManifestRow>();
  for (const row of rows) if (row.review !== undefined) latestReview.set(row.seed, row);
  const allSeeds = new Set([...latestGen.keys(), ...latestReview.keys()]);
  for (const seed of allSeeds) {
    const r = latestReview.get(seed);
    if (!r) reviewCounts.unreviewed++;
    else if (r.review === "accepted") reviewCounts.accepted++;
    else if (r.review === "rejected") reviewCounts.rejected++;
  }

  // Quarantine split.
  const ingestQuarantine: number[] = [];
  const reviewQuarantine: number[] = [];
  for (const row of rows) {
    if (row.quarantine && "path" in (row.quarantine as object) && "reason" in (row.quarantine as object)) ingestQuarantine.push(row.seed);
  }
  for (const row of rows) {
    if (row.quarantine && "frame" in (row.quarantine as object)) reviewQuarantine.push(row.seed);
  }
  // dedupe
  const ingestSet = [...new Set(ingestQuarantine)];
  const reviewSet = [...new Set(reviewQuarantine)];

  // QC status counts and per-check counts, from the latest generation row per Seed.
  const latestGenRows = [...latestGen.values()];
  const qcStatusCounts = countOf(latestGenRows.map((r) => r.qc?.status ?? "unknown"));
  const checkCounts: Record<string, Record<string, number>> = {};
  const checkNames = ["decode", "dimensions", "blank", "luminance", "aspect", "duplicate_exact", "duplicate_perceptual", "face_presence"];
  for (const name of checkNames) checkCounts[name] = { pass: 0, warn: 0, fail: 0, not_run: 0 };
  for (const row of latestGenRows) {
    if (row.qc?.checks) {
      for (const name of checkNames) {
        const state = (row.qc.checks as Record<string, string>)[name];
        if (state && checkCounts[name][state] !== undefined) checkCounts[name][state]++;
      }
    }
  }

  // Distributions from persisted fields (generation rows only).
  const primaryGroupCounts = countOf(genRows.map((r) => r.primaryGroup ?? "unknown"));
  const mixedCounts = { mixed: 0, single: 0 };
  const photographyCounts = countOf(genRows.map((r) => r.photographyProfile ?? "unknown"));
  const providerCounts = countOf(genRows.map((r) => (r.provider ?? "unknown") as string));
  const modelCounts = countOf(genRows.map((r) => (r.model ?? "unknown") as string));
  const genderCounts = countOf(genRows.map((r) => (r.attributes?.gender ?? "unknown")));
  const ageBandCounts: Record<string, number> = {};
  for (const r of genRows) {
    const age = Number(r.attributes?.age);
    const band = Number.isFinite(age) ? `${Math.floor(age / 10) * 10}s` : "unknown";
    ageBandCounts[band] = (ageBandCounts[band] ?? 0) + 1;
  }
  const skinBandCounts = countOf(genRows.map((r) => (r.bands?.skin ?? "unknown")));
  const eyeBandCounts = countOf(genRows.map((r) => (r.bands?.eye ?? "unknown")));
  for (const r of genRows) {
    if (r.groups && r.groups.length > 1) mixedCounts.mixed++;
    else if (r.groups) mixedCounts.single++;
  }

  // Missing provenance.
  const missingByField: Record<string, number> = {};
  const provenanceFields = ["version", "provider", "model", "source", "prompt", "primaryGroup", "photographyProfile", "templateHash", "samplerHash"];
  for (const field of provenanceFields) {
    const n = genRows.filter((r) => (r as Record<string, unknown>)[field] === undefined).length;
    if (n > 0) missingByField[field] = n;
  }

  // Legacy/interim counts.
  const legacyCount = rows.filter((r) => r.origin === "legacy").length;
  const interimCount = rows.filter((r) => r.origin === "interim").length;

  // Integrity problems.
  const integrity: string[] = [];
  // missing files: frame row but no file
  for (const row of rows) {
    if (row.status === "ok") {
      const p = join(dir, `${seedLabel(row.seed)}.png`);
      if (!existsSync(p)) integrity.push(`Seed ${row.seed}: row says ok but Frame file is missing`);
    }
  }
  // files with no row
  const rowSeeds = new Set(rows.map((r) => r.seed));
  for (const f of frames) {
    if (!rowSeeds.has(f.seed)) integrity.push(`Seed ${f.seed}: Frame file exists but no manifest row`);
  }
  // malformed rows
  for (const d of diagnostics) integrity.push(`line ${d.line}: malformed row (${d.message})`);
  // hash mismatches
  for (const row of rows) {
    if (row.raw?.sha256) {
      const rawPath = join(dir, "raw", `${seedLabel(row.seed)}.png`);
      if (existsSync(rawPath)) {
        const actual = sha256File(rawPath);
        if (actual && actual !== row.raw.sha256) integrity.push(`Seed ${row.seed}: stored raw hash does not match file`);
      }
    }
    if (row.normalized?.sha256) {
      const normPath = join(dir, `${seedLabel(row.seed)}.png`);
      if (existsSync(normPath)) {
        const actual = sha256File(normPath);
        if (actual && actual !== row.normalized.sha256) integrity.push(`Seed ${row.seed}: stored normalized hash does not match file`);
      }
    }
  }
  // quarantine paths
  for (const row of rows) {
    if (row.quarantine && "path" in (row.quarantine as object)) {
      const p = (row.quarantine as { path: string }).path;
      if (!existsSync(p)) integrity.push(`Seed ${row.seed}: quarantine path does not exist (${p})`);
    }
    if (row.quarantine && "frame" in (row.quarantine as object)) {
      const q = row.quarantine as { frame: string; raw: string };
      if (!existsSync(q.frame)) integrity.push(`Seed ${row.seed}: quarantined frame path does not exist`);
      if (!existsSync(q.raw)) integrity.push(`Seed ${row.seed}: quarantined raw path does not exist`);
    }
  }
  // unreadable images
  for (const f of frames) {
    const p = join(dir, `${seedLabel(f.seed)}.png`);
    try {
      await sharp(p).metadata();
    } catch {
      integrity.push(`Seed ${f.seed}: unreadable image`);
    }
  }

  // Exact duplicates as groups, by raw or normalized hash.
  const hashToSeeds = new Map<string, number[]>();
  for (const row of rows) {
    if (row.raw?.sha256) {
      const key = `raw:${row.raw.sha256}`;
      if (!hashToSeeds.has(key)) hashToSeeds.set(key, []);
      hashToSeeds.get(key)!.push(row.seed);
    }
    if (row.normalized?.sha256) {
      const key = `normalized:${row.normalized.sha256}`;
      if (!hashToSeeds.has(key)) hashToSeeds.set(key, []);
      hashToSeeds.get(key)!.push(row.seed);
    }
  }
  const exactDupGroups: { hash: string; seeds: number[] }[] = [];
  for (const [key, seeds] of hashToSeeds) {
    if (seeds.length > 1) exactDupGroups.push({ hash: key, seeds: [...new Set(seeds)].sort((a, b) => a - b) });
  }
  exactDupGroups.sort((a, b) => a.hash.localeCompare(b.hash));

  // Perceptual candidates as pairs (no clustering).
  const perceptualPairs: { a: number; b: number; distance: number }[] = [];
  const phashBySeed = new Map<number, { algo: string; hex: string }>();
  for (const row of rows) {
    if (row.qc?.perceptual?.hex && row.qc.perceptual.algo === PHASH_ALGO) {
      phashBySeed.set(row.seed, { algo: row.qc.perceptual.algo, hex: row.qc.perceptual.hex });
    } else {
      // recompute from file in memory
      const p = join(dir, `${seedLabel(row.seed)}.png`);
      if (existsSync(p)) {
        try {
          const buf = readFileSync(p);
          const hex = await perceptualHash(buf);
          phashBySeed.set(row.seed, { algo: PHASH_ALGO, hex });
        } catch {
          // skip
        }
      }
    }
  }
  const seedList = [...phashBySeed.keys()].sort((a, b) => a - b);
  for (let i = 0; i < seedList.length; i++) {
    for (let j = i + 1; j < seedList.length; j++) {
      const a = seedList[i], b = seedList[j];
      const ha = phashBySeed.get(a)!, hb = phashBySeed.get(b)!;
      const d = distanceBits({ algo: ha.algo, hex: ha.hex }, { algo: hb.algo, hex: hb.hex });
      if (d !== null && d <= phashThreshold) perceptualPairs.push({ a, b, distance: d });
    }
  }
  perceptualPairs.sort((x, y) => x.a - y.a || x.b - y.b);
  const flaggedImages = new Set<number>();
  for (const p of perceptualPairs) { flaggedImages.add(p.a); flaggedImages.add(p.b); }

  // Distributions: primary group, mixed/single, gender, age band, skin, eye, photography, detail count, provider, model.
  // Use persisted fields where available; legacy rows land in unknown.
  const detailCountDist: Record<string, number> = {};
  for (const row of rows) {
    const dc = row.details ? String(row.details.length) : "unknown";
    detailCountDist[dc] = (detailCountDist[dc] ?? 0) + 1;
  }

  const result = {
    auditVersion,
    timestamp: reportTimestamp,
    dir,
    saltSet: salt !== "",
    saltMismatch: view.counter ? view.counter.salt !== salt && view.counter.salt !== "" : false,
    templateVersion: view.version,
    manifestReadError: view.counterError,
    totals: {
      manifestRows: rows.length,
      manifestRowsByKind: countOf(rows.map((r) => (r.review !== undefined ? "review" : "generation"))),
      manifestRowsBySchema: countOf(rows.map((r) => (r.schema ? String(r.schema) : "legacy"))),
      framesInOutput: frames.length,
      quarantineFiles: quarantineFiles.length,
    },
    generationOutcomes: genStatusCounts,
    qcStatusCounts,
    qcCheckCounts: checkCounts,
    reviewCounts,
    quarantineCounts: { ingestion: ingestSet.length, review: reviewSet.length },
    exactDuplicates: exactDupGroups,
    perceptualCandidates: {
      pairs: perceptualPairs,
      pairCount: perceptualPairs.length,
      flaggedImageCount: flaggedImages.size,
      threshold: phashThreshold,
      algorithm: PHASH_ALGO,
    },
    distributions: {
      primaryGroup: primaryGroupCounts,
      mixed: mixedCounts,
      gender: genderCounts,
      ageBand: ageBandCounts,
      skinBand: skinBandCounts,
      eyeBand: eyeBandCounts,
      photographyProfile: photographyCounts,
      provider: providerCounts,
      model: modelCounts,
      detailCount: detailCountDist,
    },
    missingProvenance: missingByField,
    legacyRowCount: legacyCount,
    interimRowCount: interimCount,
    integrityProblems: integrity,
    diagnostics,
  };

  const sortedResult = sortObjectKeys(result);
  if (json) {
    console.log(JSON.stringify(sortedResult, null, 2));
  } else {
    console.log(`Dataset audit: ${dir}`);
    console.log(`Audit version: ${auditVersion}`);
    console.log(`Timestamp: ${reportTimestamp}`);
    console.log(`Template version: ${view.version}`);
    console.log(`Salt: ${salt ? "set" : "not set"}`);
    if (view.counter && view.counter.salt && view.counter.salt !== salt) console.log(`Salt mismatch: folder started with a different salt (informational)`);
    if (view.counterError) console.log(`Counter error: ${view.counterError}`);
    console.log(`\nTotals`);
    console.log(`  manifest rows: ${rows.length}`);
    console.log(`  frames in out/: ${frames.length}`);
    console.log(`  quarantine files: ${quarantineFiles.length}`);
    console.log(`\nGeneration outcomes`);
    for (const [k, v] of Object.entries(genStatusCounts).sort()) console.log(`  ${k}: ${v}`);
    console.log(`\nQC status`);
    for (const [k, v] of Object.entries(qcStatusCounts).sort()) console.log(`  ${k}: ${v}`);
    console.log(`\nReview`);
    console.log(`  unreviewed: ${reviewCounts.unreviewed}`);
    console.log(`  accepted: ${reviewCounts.accepted}`);
    console.log(`  rejected: ${reviewCounts.rejected}`);
    console.log(`\nQuarantine`);
    console.log(`  ingestion: ${ingestSet.length}`);
    console.log(`  review: ${reviewSet.length}`);
    console.log(`\nExact duplicates: ${exactDupGroups.length} groups`);
    for (const g of exactDupGroups) console.log(`  ${g.seeds.map(seedLabel).join(", ")} (${g.hash.slice(0, 12)})`);
    console.log(`\nPerceptual candidates: ${perceptualPairs.length} pairs, ${flaggedImages.size} images flagged, threshold ${phashThreshold}`);
    for (const p of perceptualPairs) console.log(`  ${seedLabel(p.a)} - ${seedLabel(p.b)}: ${p.distance} bits`);
    console.log(`\nPrimary group distribution`);
    for (const [k, v] of Object.entries(primaryGroupCounts).sort()) console.log(`  ${k}: ${v}`);
    console.log(`\nMissing provenance`);
    for (const [k, v] of Object.entries(missingByField).sort()) console.log(`  ${k}: ${v}`);
    console.log(`\nLegacy rows: ${legacyCount}, interim rows: ${interimCount}`);
    console.log(`\nIntegrity problems: ${integrity.length}`);
    for (const p of integrity) console.log(`  - ${p}`);
    if (diagnostics.length) {
      console.log(`\nMalformed rows: ${diagnostics.length}`);
      for (const d of diagnostics) console.log(`  line ${d.line}: ${d.message}`);
    }
  }

  process.exit(integrity.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(2);
});
