import "dotenv/config";
import { createHash } from "node:crypto";
import { openOutputFolder, seedLabel } from "../core/output-folder";
import type { ManifestRow } from "../core/output-folder";
import { samplePortrait } from "../core/sampler";
import { qc, hammingDistance, PERCEPTUAL_FINGERPRINT_THRESHOLD } from "../core/qc";


function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function countOf(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function sortedEntries(obj: Record<string, number>): Array<[string, number]> {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function percent(n: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function toBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function latestStatuses(rows: ManifestRow[]): Map<number, ManifestRow> {
  const latest = new Map<number, ManifestRow>();
  for (const row of rows) latest.set(row.seed, row);
  return latest;
}

async function run() {
  const dir = arg("--dir", arg("--out", process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== "--")[0] ?? "out"))!;
  const json = process.argv.includes("--json");
  const minCell = Number(arg("--min-cell", "5"));
  const salt = (process.env.SEED_SALT ?? "").trim();

  let folder;
  try {
    folder = openOutputFolder(dir, salt);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    const code = (error as { code?: string })?.code;
    process.exit(code === "unreadable-counter" ? 1 : 0);
    return;
  }

  let rows: ManifestRow[] = [];
  let manifestError: string | null = null;
  try {
    rows = folder.manifestRows();
  } catch (error) {
    manifestError = error instanceof Error ? error.message : String(error);
  }

  const frames = folder.listFrames();
  const status = folder.status();
  const currentVersion = status.version;

  const lastBySeed = latestStatuses(rows);
  const generationStatusCounts = countOf([...lastBySeed.values()].map((r) => r.status ?? "unknown"));

  const accepted = frames.length;
  const rejectedSeeds = [...lastBySeed.values()].filter((r) => r.status === "rejected").length;
  const reviewStatusCounts = {
    accepted_frames: accepted,
    rejected_seeds: rejectedSeeds,
  };

  const providerCounts = countOf(frames.map((f) => f.provider ?? "unknown"));
  const modelCounts = countOf(frames.map((f) => f.model ?? "unknown"));
  const sourceCounts = countOf(frames.map((f) => f.source ?? "unknown"));
  const promptVersionCounts = countOf(frames.map((f) => f.version ?? "unknown"));
  const manifestPromptVersionCounts = countOf(rows.map((r) => r.version ?? "unknown"));

  const photographyCounts: Record<string, number> = {};
  const genderCounts: Record<string, number> = {};
  const primaryGroupCounts: Record<string, number> = {};
  const mixedCounts = { mixed: 0, single: 0 };
  const skinBandCounts: Record<string, number> = {};
  const eyeBandCounts: Record<string, number> = {};
  const ageCounts: Record<string, number> = {};
  const ageBandCounts: Record<string, number> = {};
  const detailCountDist: Record<string, number> = {};
  const cellCounts: Record<string, number> = {};

  const frameHashes: string[] = [];
  const frameFingerprints: string[] = [];
  const unreadableFrames: string[] = [];
  const frameMetadataMissing: string[] = [];
  const qcFlagCounts: Record<string, number> = {};
  const frameResults: Array<{ seed: number; sha256: string; fingerprint: string; flags: string[] }> = [];

  for (const frame of frames) {
    if (
      frame.version === "unknown" ||
      frame.source === "unknown" ||
      frame.provider === undefined ||
      frame.prompt === "" ||
      frame.model === undefined
    ) {
      frameMetadataMissing.push(String(frame.seed));
    }

    let buffer: Buffer;
    try {
      buffer = await toBuffer(folder.readFrame(frame.seed));
    } catch {
      unreadableFrames.push(String(frame.seed));
      qcFlagCounts["decode_failed"] = (qcFlagCounts["decode_failed"] ?? 0) + 1;
      continue;
    }

    const sha = createHash("sha256").update(buffer).digest("hex");
    let result;
    try {
      result = await qc(buffer);
    } catch {
      unreadableFrames.push(String(frame.seed));
      continue;
    }

    frameHashes.push(sha);
    frameFingerprints.push(result.fingerprint);
    frameResults.push({ seed: frame.seed, sha256: sha, fingerprint: result.fingerprint, flags: result.flags });

    for (const flag of result.flags) qcFlagCounts[flag] = (qcFlagCounts[flag] ?? 0) + 1;

    const sample = samplePortrait(frame.seed, salt);
    const profileId = sample.photographyProfile.id;
    photographyCounts[profileId] = (photographyCounts[profileId] ?? 0) + 1;

    const gender = sample.values.gender ?? "unknown";
    const primaryGroup = sample.groups[0] ?? "unknown";
    const mixed = sample.groups.length > 1;
    genderCounts[gender] = (genderCounts[gender] ?? 0) + 1;
    primaryGroupCounts[primaryGroup] = (primaryGroupCounts[primaryGroup] ?? 0) + 1;
    if (mixed) mixedCounts.mixed++; else mixedCounts.single++;
    skinBandCounts[sample.bands.skin] = (skinBandCounts[sample.bands.skin] ?? 0) + 1;
    eyeBandCounts[sample.bands.eye] = (eyeBandCounts[sample.bands.eye] ?? 0) + 1;
    ageCounts[sample.values.age] = (ageCounts[sample.values.age] ?? 0) + 1;
    const ageNum = Number(sample.values.age);
    const ageBand = `${Math.floor(ageNum / 10) * 10}s`;
    ageBandCounts[ageBand] = (ageBandCounts[ageBand] ?? 0) + 1;
    const dc = String(sample.details.length);
    detailCountDist[dc] = (detailCountDist[dc] ?? 0) + 1;

    const cellKey = `${gender} x ${primaryGroup}`;
    cellCounts[cellKey] = (cellCounts[cellKey] ?? 0) + 1;
  }

  const exactDuplicateGroups: Array<{ hash: string; seeds: number[] }> = [];
  const hashToSeeds = new Map<string, number[]>();
  for (const fr of frameResults) {
    if (!hashToSeeds.has(fr.sha256)) hashToSeeds.set(fr.sha256, []);
    hashToSeeds.get(fr.sha256)!.push(fr.seed);
  }
  for (const [hash, seeds] of hashToSeeds) {
    if (seeds.length > 1) exactDuplicateGroups.push({ hash, seeds: seeds.sort((a, b) => a - b) });
  }
  exactDuplicateGroups.sort((a, b) => b.seeds.length - a.seeds.length || a.hash.localeCompare(b.hash));

  const nearDuplicateGroups: Array<{ representative: string; seeds: number[] }> = [];
  const visited = new Set<number>();
  const seedsList = frameResults.map((fr) => fr.seed);
  for (let i = 0; i < frameResults.length; i++) {
    if (visited.has(frameResults[i].seed)) continue;
    const cluster: number[] = [frameResults[i].seed];
    visited.add(frameResults[i].seed);
    for (let j = i + 1; j < frameResults.length; j++) {
      if (visited.has(frameResults[j].seed)) continue;
      if (hammingDistance(frameResults[i].fingerprint, frameResults[j].fingerprint) <= PERCEPTUAL_FINGERPRINT_THRESHOLD) {
        cluster.push(frameResults[j].seed);
        visited.add(frameResults[j].seed);
      }
    }
    if (cluster.length > 1) {
      nearDuplicateGroups.push({
        representative: frameResults[i].fingerprint,
        seeds: cluster.sort((a, b) => a - b),
      });
    }
  }
  // Transitive closure: repeat clustering until stable
  {
    const clusters: number[][] = [];
    const seen = new Set<number>();
    for (let i = 0; i < frameResults.length; i++) {
      if (seen.has(frameResults[i].seed)) continue;
      const cluster = [frameResults[i].seed];
      seen.add(frameResults[i].seed);
      let changed = true;
      while (changed) {
        changed = false;
        for (let k = 0; k < frameResults.length; k++) {
          if (seen.has(frameResults[k].seed)) continue;
          if (cluster.some((s) => hammingDistance(
            frameResults[seedsList.indexOf(s)].fingerprint, frameResults[k].fingerprint) <= PERCEPTUAL_FINGERPRINT_THRESHOLD)) {
            cluster.push(frameResults[k].seed);
            seen.add(frameResults[k].seed);
            changed = true;
          }
        }
      }
      clusters.push(cluster);
    }
    nearDuplicateGroups.length = 0;
    for (const cluster of clusters) {
      if (cluster.length > 1) {
        nearDuplicateGroups.push({
          representative: frameResults[seedsList.indexOf(cluster[0])].fingerprint,
          seeds: cluster.sort((a, b) => a - b),
        });
      }
    }
  }
  nearDuplicateGroups.sort((a, b) => b.seeds.length - a.seeds.length || a.seeds[0] - b.seeds[0]);

  const lowCells = sortedEntries(cellCounts)
    .filter(([, c]) => c < minCell)
    .map(([key, count]) => ({ cell: key, count }));

  const fieldCounts: Record<string, number> = {};
  const rowFieldList = ["version", "provider", "model", "source", "file", "prompt", "error", "ts", "salt", "status"];
  for (const field of rowFieldList) {
    fieldCounts[field] = rows.filter((r) => (r as Record<string, unknown>)[field] !== undefined).length;
  }

  const legacyRows = rows.filter((r) => {
    const o = r as Record<string, unknown>;
    return o.provider === undefined || o.model === undefined || o.version === undefined || o.version !== currentVersion;
  }).length;

  const result = {
    dir,
    saltSet: salt !== "",
    templateVersion: currentVersion,
    manifestReadError: manifestError,
    generationStatusCounts,
    reviewStatusCounts,
    acceptedFrames: accepted,
    providerCounts,
    modelCounts,
    sourceCounts,
    promptVersionCountsAccepted: promptVersionCounts,
    promptVersionCountsManifest: manifestPromptVersionCounts,
    photographyProfileCounts: photographyCounts,
    demographicCounts: {
      gender: genderCounts,
      primaryEthnicityGroup: primaryGroupCounts,
      mixed: mixedCounts,
      skinBand: skinBandCounts,
      eyeBand: eyeBandCounts,
      age: ageCounts,
      ageBand: ageBandCounts,
      optionalDetailCount: detailCountDist,
    },
    shares: {
      gender: Object.fromEntries(Object.entries(genderCounts).map(([k, v]) => [k, v / Math.max(1, accepted)])),
    },
    missingMetadata: {
      framesMissingProvenance: frameMetadataMissing,
      frameCount: frameMetadataMissing.length,
    },
    unreadableFiles: unreadableFrames,
    unreadableFileCount: unreadableFrames.length,
    exactDuplicateGroups,
    nearDuplicateGroups,
    qcFlagCounts,
    qcFlagTotal: Object.values(qcFlagCounts).reduce((a, b) => a + b, 0),
    cellsWithTooFewExamples: {
      threshold: minCell,
      cells: lowCells,
    },
    legacyRowsAssessable: {
      legacyRowCount: legacyRows,
      fieldPresenceAcrossManifestRows: fieldCounts,
      manifestRowCount: rows.length,
      latestStatusRows: lastBySeed.size,
    },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const printSection = (title: string) => {
    console.log(`\n${title}`);
    console.log("-".repeat(title.length));
  };
  const printCounts = (label: string, obj: Record<string, number>, total?: number) => {
    console.log(label);
    for (const [k, v] of sortedEntries(obj)) {
      console.log(`  ${k}: ${v}${total !== undefined ? ` (${percent(v, total)})` : ""}`);
    }
  };

  console.log(`Dataset audit: ${dir}`);
  console.log(`Template version: ${currentVersion}`);
  console.log(`Salt: ${salt ? "set" : "not set"}`);
  if (manifestError) console.log(`Manifest read error: ${manifestError}`);

  printSection("Counts by generation status (latest per seed)");
  printCounts("status", generationStatusCounts, lastBySeed.size || undefined);

  printSection("Counts by review status");
  console.log(`  accepted frames: ${reviewStatusCounts.accepted_frames}`);
  console.log(`  rejected seeds: ${reviewStatusCounts.rejected_seeds}`);

  printSection("Counts by provider (accepted frames)");
  printCounts("provider", providerCounts, accepted);

  printSection("Counts by model (accepted frames)");
  printCounts("model", modelCounts, accepted);

  printSection("Counts by source (accepted frames)");
  printCounts("source", sourceCounts, accepted);

  printSection("Counts by prompt version (accepted frames)");
  printCounts("version", promptVersionCounts, accepted);

  printSection("Counts by prompt version (manifest rows)");
  printCounts("version", manifestPromptVersionCounts, rows.length || undefined);

  printSection("Counts by photography profile (accepted frames)");
  printCounts("profile", photographyCounts, accepted);

  printSection("Gender counts/shares");
  printCounts("gender", genderCounts, accepted);

  printSection("Primary ethnicity group counts/shares");
  printCounts("group", primaryGroupCounts, accepted);

  printSection("Mixed status counts");
  console.log(`  mixed: ${mixedCounts.mixed} (${percent(mixedCounts.mixed, accepted)})`);
  console.log(`  single: ${mixedCounts.single} (${percent(mixedCounts.single, accepted)})`);

  printSection("Skin band counts/shares");
  printCounts("skin band", skinBandCounts, accepted);

  printSection("Eye band counts/shares");
  printCounts("eye band", eyeBandCounts, accepted);

  printSection("Age counts");
  printCounts("age", ageCounts, accepted);

  printSection("Age band counts");
  printCounts("age band", ageBandCounts, accepted);

  printSection("Optional detail count distribution");
  printCounts("details", detailCountDist, accepted);

  printSection("Missing/malformed metadata");
  console.log(`  frames missing provenance: ${frameMetadataMissing.length}`);
  if (frameMetadataMissing.length) console.log(`    seeds: ${frameMetadataMissing.join(", ")}`);
  console.log(`  unreadable frame files: ${unreadableFrames.length}`);
  if (unreadableFrames.length) console.log(`    seeds: ${unreadableFrames.join(", ")}`);

  printSection("Exact duplicate hashes");
  console.log(`  groups: ${exactDuplicateGroups.length}`);
  for (const g of exactDuplicateGroups) console.log(`    ${g.seeds.map((s) => seedLabel(s)).join(", ")} (${g.hash.slice(0, 12)})`);

  printSection("Likely near-duplicate groups");
  console.log(`  groups: ${nearDuplicateGroups.length}`);
  for (const g of nearDuplicateGroups) console.log(`    ${g.seeds.map((s) => seedLabel(s)).join(", ")}`);

  printSection("QC flag counts");
  if (Object.keys(qcFlagCounts).length === 0) console.log("  none");
  for (const [k, v] of sortedEntries(qcFlagCounts)) console.log(`  ${k}: ${v}`);

  printSection(`Cells with fewer than ${minCell} examples`);
  if (lowCells.length === 0) console.log("  none");
  for (const c of lowCells) console.log(`  ${c.cell}: ${c.count}`);

  printSection("Legacy rows/fields assessable");
  console.log(`  manifest rows: ${rows.length}`);
  console.log(`  rows with missing/legacy fields: ${legacyRows}`);
  for (const [k, v] of sortedEntries(fieldCounts)) console.log(`  field ${k}: ${v}/${rows.length}`);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
 (void 0);
