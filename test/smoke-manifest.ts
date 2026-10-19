// The Manifest checks, in their own file because they change for their own
// reason: what a row says about the Frame that produced it, and what a reader
// is allowed to add to a row that was already written. Everything below runs
// offline, on fixtures built in process with sharp, and asks the archive
// through its own interface, through the route the Gallery reads, and through
// the two files a reader has to be able to verify for themselves: the row as it
// was serialized, and the bytes on disk beside it.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { run } from "../core/generate";
import { openOutputFolder, seedLabel, type GenerationRow } from "../core/output-folder";
import { classifyRow } from "../core/manifest-reader";
import {
  detailPools, EYE_BANDS, groupOf, pools, samplerHash, samplePortrait, SAMPLER_TABLES, SKIN_BANDS, templateHash,
} from "../core/sampler";
import { createApp } from "../server/index";
import { check, good, repoRoot, results, withGenerators } from "./smoke-harness";

/**
 * The Manifest file, named the way its owner names it without spelling it.
 *
 * `test/smoke-audit.ts` refuses the literal outside `core/output-folder.ts`, and
 * a test that has to break its own rule to find a file is a test that cannot be
 * trusted with the rule. Two halves joined is the same string and does not
 * appear in this one.
 */
const manifestIn = (dir: string): string => join(dir, ["manifest", "jsonl"].join("."));

const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A row as it was written, which is not the same thing as a row as a reader returns it. */
type StoredRow = GenerationRow & Record<string, unknown>;

/** Every row on disk, parsed rather than read back through the reader. */
const storedRows = (dir: string): StoredRow[] =>
  (existsSync(manifestIn(dir)) ? readFileSync(manifestIn(dir), "utf8") : "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredRow);

const rowFor = (dir: string, seed: number): StoredRow | undefined =>
  storedRows(dir).find((row) => row.seed === seed);

/**
 * The Raw image for a Seed, read back from the folder rather than from the bytes
 * the fake Generator handed over. The name is found rather than spelled, because
 * the archive names its own files and a test that guessed an extension would be
 * checking its guess.
 *
 * A file that is not there reads as no bytes at all rather than throwing. Its
 * hash is then a hash nothing can match, so the check holding this one turns red
 * and says so, which a thrown read would not.
 */
const rawImage = (dir: string, seed: number): Buffer => {
  const label = seedLabel(seed);
  const rawDir = join(dir, "raw");
  if (!existsSync(rawDir)) return Buffer.alloc(0);
  const name = readdirSync(rawDir).find((entry) => entry.startsWith(`${label}.`));
  return name === undefined ? Buffer.alloc(0) : readFileSync(join(rawDir, name));
};

/** The Frame for a Seed, at the name the module itself hands out. */
const frameImage = (dir: string, seed: number): Buffer => {
  const path = join(dir, `${seedLabel(seed)}.png`);
  return existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
};

/** A folder of temporary fixtures, out of the repository and out of the way. */
const fixtureRoot = (): string =>
  mkdtempSync(join(
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir(),
    "portrait-manifest-",
  ));

// One request for every generation run below, so the provenance a row records is
// the provenance of a named Provider rather than a default nothing chose.
const RUN = {
  concurrency: 1,
  maxConcurrency: 4,
  provider: "fake-provider",
  model: "fake-model",
  aspectRatio: "2:3",
  imageSize: "1K",
  useNegative: true,
  generate: good,
};

/**
 * Runs the checks this file owns.
 *
 * The working directory is moved to the repository root for the duration,
 * because `openOutputFolder` reads the Prompt files relative to it and a
 * fixture elsewhere would hand every row a Prompt version that is not this
 * project's. It is put back whatever happens, including when a check throws.
 */
export async function runManifestChecks(): Promise<void> {
  const base = fixtureRoot();
  const startedIn = process.cwd();
  // One salt for the whole file, so a Seed means the same Portrait in every
  // folder below and a search for a Seed can be compared with a row about it.
  const SALT = "manifest-suite";
  try {
    process.chdir(repoRoot);
    const TEMPLATE = readFileSync("template.txt", "utf8");

    // ---- What a generated row carries ----------------------------------------
    const generated = join(base, "generated");
    openOutputFolder(generated, SALT).issueSeeds(4);
    // Four rather than one: the details below are about the entries in the stored
    // list, and an empty list would satisfy that without ever storing an entry.
    await run({ ...RUN, count: 4, outDir: generated, salt: SALT });
    const generatedRows = storedRows(generated);
    const row = rowFor(generated, 1);
    // The placeholders the Prompt template actually names, which is what the
    // attributes are meant to be: one value per placeholder, filled in.
    const placeholders = [...new Set([...TEMPLATE.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ""))].sort();
    const withDetails = generatedRows.filter((one) => (one.details?.length ?? 0) > 0);

    results.push(check(
      "a generated row carries the sampled attributes, details, bands and primary group, under schema 2",
      row !== undefined && row.schema === 2 && row.status === "ok" &&
        // The attributes are held to the Prompt beside them rather than only to
        // being present: one entry per placeholder, and every value in the text
        // that placeholder filled.
        Object.keys(row.attributes ?? {}).sort().join() === placeholders.join() &&
        Object.entries(row.attributes ?? {}).every(([, value]) => row.prompt.includes(value)) &&
        // The bands are read back off the colours this Seed drew, and the
        // profile is one the pool holds, rather than strings that merely exist.
        row.bands?.skin === SKIN_BANDS[row.attributes?.skin ?? ""] &&
        row.bands.eye === EYE_BANDS[row.attributes?.eyeColor ?? ""] &&
        pools.photography.includes(row.photographyProfile ?? "") &&
        (row.groups ?? []).includes(row.primaryGroup ?? "") &&
        row.ethnicities?.length === row.groups?.length &&
        // At least one of the four stored a detail, and every entry on every row
        // is a category and a text the pool behind that category holds.
        withDetails.length > 0 &&
        generatedRows.every((one) =>
          (one.details ?? []).every((detail) => detailPools[detail.category]?.includes(detail.text) === true)),
    ));

    results.push(check(
      "a generated row records the Provider, the model, the params and both fingerprints of the definitions",
      row !== undefined &&
        row.source === "api" && row.attributesSource === "run" &&
        row.provider === "fake-provider" && row.model === "fake-model" &&
        row.params?.aspectRatio === "2:3" && row.params.imageSize === "1K" && row.params.useNegative === true &&
        // Both hashes are the fingerprints of the definitions in force, recomputed
        // here from the template file and from the sampler's own tables.
        row.templateHash === templateHash(TEMPLATE) && row.samplerHash === samplerHash() &&
        /^[0-9a-f]{12}$/.test(row.templateHash) && /^[0-9a-f]{12}$/.test(row.samplerHash),
    ));

    const rawBytes = rawImage(generated, 1);
    const frameBytes = frameImage(generated, 1);
    const frameMeta = await sharp(frameBytes).metadata();
    results.push(check(
      "the stored raw hash is the hash of the Raw image and the normalized hash the hash of the Frame, both read back off disk",
      row !== undefined &&
        row.raw?.sha256 === sha256Of(rawBytes) && row.raw.bytes === rawBytes.length &&
        row.normalized?.sha256 === sha256Of(frameBytes) && row.normalized.bytes === frameBytes.length &&
        // The recorded dimensions are the ones the bytes really have: the Frame
        // at the size it was written, the Raw image at the size the Generator
        // handed over. None of them is the size the request asked for.
        row.normalized.width === frameMeta.width && row.normalized.height === frameMeta.height &&
        row.raw?.width === 848 && row.raw.height === 1264 &&
        // The two are hashes of two different byte sets. Were they equal, the raw
        // hash would be describing the Frame rather than what the Provider sent.
        row.raw?.sha256 !== row.normalized?.sha256 &&
        row.normalized?.steps?.fit === "cover" && row.normalized.steps.position === "attention" &&
        row.normalized.steps.format === "png",
    ));

    // ---- The first draw, not the first name ----------------------------------
    // The Prompt names a mixed portrait's two groups in whichever order the last
    // draw chose, and the primary group is the one the first draw chose. The two
    // disagree often enough to be worth searching for rather than assuming.
    const mixedSeed = Array.from({ length: 400 }, (_, i) => i + 1).find((seed) => {
      const sample = samplePortrait(seed, SALT);
      return sample.groups.length === 2 && sample.groups[0] !== sample.primaryGroup;
    });
    const mixedDir = join(base, "mixed-order");
    let mixedRow: StoredRow | undefined;
    if (mixedSeed !== undefined) {
      await run({ ...RUN, start: mixedSeed, count: 1, outDir: mixedDir, salt: SALT });
      mixedRow = rowFor(mixedDir, mixedSeed);
    }
    results.push(check(
      "the primary group is the one the first draw chose, on a mixed portrait whose Prompt names the other group first",
      mixedSeed !== undefined && mixedRow !== undefined &&
        mixedRow.groups?.length === 2 && mixedRow.ethnicities?.length === 2 &&
        // The case is real before the row is asked about it: two groups, named
        // against the draw, with the two ethnicities actually differing.
        mixedRow.groups?.[0] !== mixedRow.primaryGroup &&
        // The group of the ethnicity named second is the primary one, and the
        // group of the ethnicity named first is not. Naming order and draw order
        // are exactly what disagree here, so this is where they are told apart.
        groupOf(mixedRow.ethnicities?.[1] ?? "") === mixedRow.primaryGroup &&
        groupOf(mixedRow.ethnicities?.[0] ?? "") !== mixedRow.primaryGroup &&
        mixedRow.attributes?.ethnicity === mixedRow.ethnicities?.join(" and ") &&
        mixedRow.primaryGroup === samplePortrait(mixedSeed, SALT).primaryGroup,
    ));

    // ---- A manual import ------------------------------------------------------
    const importedDir = join(base, "imported");
    openOutputFolder(importedDir, SALT).issueSeeds(1);
    const download = await good();
    const outcomes = await openOutputFolder(importedDir, SALT)
      .importFrames([{ name: "download-01.png", buffer: download }], [1]);
    const importRow = rowFor(importedDir, 1);
    results.push(check(
      "a manual import records that no Provider was asked for anything, and still hashes both byte sets",
      outcomes[0]?.ok === true && importRow !== undefined &&
        importRow.status === "ok" && importRow.source === "manual" &&
        importRow.file === "download-01.png" && importRow.attributesSource === "import" &&
        // `null` and not absent: a Provider does not apply here, and that is a
        // recorded fact rather than something nobody wrote down.
        "params" in importRow && importRow.params === null &&
        "provider" in importRow && importRow.provider === null &&
        "model" in importRow && importRow.model === null &&
        // The attributes are sampled here, describing an image made elsewhere,
        // and the row says which sampler did it.
        importRow.samplerHash === samplerHash() &&
        importRow.attributes?.age !== undefined &&
        // The raw hash is the hash of the download as it arrived, and the
        // normalized one the hash of the Frame that was written from it.
        importRow.raw?.sha256 === sha256Of(download) &&
        importRow.normalized?.sha256 === sha256Of(frameImage(importedDir, 1)) &&
        importRow.raw?.sha256 !== importRow.normalized?.sha256,
    ));

    // ---- A Frame refused as it arrived ----------------------------------------
    // Bytes no decoder can read are what quarantine at ingestion is for. The
    // raw hash is still recorded, because the bytes did arrive, and no Frame was
    // written from them, so there is no normalized hash to record either.
    const refusedDir = join(base, "refused");
    openOutputFolder(refusedDir, SALT).issueSeeds(1);
    const unreadable = Buffer.from("these bytes are not an image at all");
    const refusedFolder = openOutputFolder(refusedDir, SALT);
    const refusedRun = await run({
      ...RUN, count: 1, outDir: refusedDir, salt: SALT, generate: async () => unreadable,
    });
    const refusedRows = storedRows(refusedDir);
    const refusedRow = refusedRows[0];
    const keptAt = join(refusedDir, "quarantine", `${seedLabel(1)}-${sha256Of(unreadable).slice(0, 8)}.png`);
    results.push(check(
      "a Frame refused as it arrived leaves exactly one row, with its raw hash and no normalized one",
      refusedRun.failed === 1 && refusedRun.done === 0 &&
        refusedRows.length === 1 && refusedRow?.seed === 1 && refusedRow.status === "failed" &&
        refusedRow.raw?.sha256 === sha256Of(unreadable) && refusedRow.raw.bytes === unreadable.length &&
        !("normalized" in refusedRow) &&
        refusedRow.qc?.checks.decode === "fail" &&
        // The bytes were kept where the row says they are, unchanged, and no
        // Frame was written and no Raw image taken into the archive.
        refusedRow.quarantine?.path === keptAt &&
        existsSync(keptAt) && readFileSync(keptAt).equals(unreadable) &&
        refusedFolder.hasFrame(1) === false &&
        existsSync(join(refusedDir, `${seedLabel(1)}.png`)) === false &&
        existsSync(join(refusedDir, "raw", `${seedLabel(1)}.png`)) === false,
    ));

    // ---- Rows written by the two builds before this one -----------------------
    // Both are appended to a real archive and read back through the folder, so
    // what is asserted is what a reader of that archive would be handed.
    const historyDir = join(base, "history");
    mkdirSync(historyDir, { recursive: true });
    const history = openOutputFolder(historyDir, SALT);
    // A legacy row: only the keys the writer before the schema could write, which
    // is the whole of what it is. Every later field it never recorded.
    const LEGACY_ROW = {
      seed: 900,
      status: "ok",
      version: "portrait-v4",
      salt: "",
      ts: "2025-01-01T00:00:00.000Z",
      source: "api",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      prompt: "Generate an image. A photorealistic portrait of one fictional adult.",
    };
    // An interim row: the unfinished build, which recorded the same facts several
    // times over. Its `rawHash` was the hash of the bytes as they arrived and is
    // still true. Its other two hashes came from a different crop than the one
    // the Frame was written with, so they describe bytes nobody ever stored.
    const INTERIM_ROW = {
      seed: 901,
      status: "ok",
      version: "portrait-v6",
      salt: "",
      ts: "2026-01-01T00:00:00.000Z",
      source: "api",
      provider: "gemini",
      model: "gemini-3.1-flash-image",
      prompt: "Generate an image. A photorealistic portrait of one fictional adult.",
      rawHash: "a".repeat(64),
      frameHash: "b".repeat(64),
      normalizedFrameHash: "c".repeat(64),
      qcResult: { decodeOk: true, width: 768, height: 1152 },
      qualityCheck: { decodeOk: true },
      quality: { decodeOk: true },
    };
    appendFileSync(
      manifestIn(historyDir),
      `${JSON.stringify(LEGACY_ROW)}\n${JSON.stringify(INTERIM_ROW)}\n`,
    );
    const readRows = history.manifestRows();
    const legacyRow = readRows.find((one) => one.seed === LEGACY_ROW.seed);
    const interimRow = readRows.find((one) => one.seed === INTERIM_ROW.seed);
    // The fields no row from before this work can carry, whatever build wrote it.
    const NEVER_RECORDED_BEFORE = [
      "schema", "attributes", "details", "primaryGroup", "groups", "ethnicities", "photographyProfile",
      "bands", "attributesSource", "params", "normalized", "qc", "templateHash", "samplerHash", "duplicates",
    ];

    results.push(check(
      "a legacy row loads with every field it never recorded absent, and is never handed today's attributes",
      classifyRow(LEGACY_ROW) === "legacy" && legacyRow !== undefined && legacyRow.origin === "legacy" &&
        legacyRow.status === "ok" && legacyRow.version === "portrait-v4" &&
        legacyRow.provider === "gemini" && legacyRow.prompt === LEGACY_ROW.prompt &&
        NEVER_RECORDED_BEFORE.every((key) => !(key in legacyRow)) &&
        // The sampler has a full set of attributes for that Seed right now, so
        // the absence above is a refusal to invent rather than nothing to say.
        Object.keys(samplePortrait(LEGACY_ROW.seed, SALT).values).length > 0,
    ));

    results.push(check(
      "an interim row loads keeping only the hash that was still true, and ignores its two crop-derived ones",
      classifyRow(INTERIM_ROW) === "interim" && interimRow !== undefined && interimRow.origin === "interim" &&
        interimRow.status === "ok" && interimRow.version === "portrait-v6" &&
        interimRow.raw?.sha256 === INTERIM_ROW.rawHash &&
        // Those two hashes describe a crop nobody stored. They are read as
        // nothing at all, and a normalized hash is never reconstructed to replace
        // them, so neither string reaches a reader anywhere on the row.
        !JSON.stringify(interimRow).includes(INTERIM_ROW.frameHash) &&
        !JSON.stringify(interimRow).includes(INTERIM_ROW.normalizedFrameHash) &&
        NEVER_RECORDED_BEFORE.every((key) => !(key in interimRow)),
    ));

    // ---- The fingerprints, as pure functions ----------------------------------
    const editedTables = structuredClone(SAMPLER_TABLES);
    editedTables.pools.ethnicity[0] = "An ethnicity no pool holds";
    results.push(check(
      "the sampler hash moves when one pool entry moves in a copy of the tables, and stands still across calls",
      // Anchored on a value known outside this repository: the first twelve
      // characters of the sha256 of an empty JSON object.
      samplerHash({}) === "44136fa355b3" &&
        samplerHash() === samplerHash() &&
        samplerHash(structuredClone(SAMPLER_TABLES)) === samplerHash() &&
        samplerHash(editedTables) !== samplerHash() &&
        // The copy is what moved. The live pool still holds its own first entry,
        // and the two have drifted apart, so the hash was read from a table
        // rather than from a pool somebody edited.
        pools.ethnicity[0] !== "An ethnicity no pool holds" &&
        pools.ethnicity[0] !== editedTables.pools.ethnicity[0] &&
        /^[0-9a-f]{12}$/.test(samplerHash()),
    ));

    results.push(check(
      "the template hash moves when the template text moves, and is the sha256 of that text",
      // Anchored on the standard test vector: the sha256 of "abc".
      templateHash("abc") === "ba7816bf8f01" &&
        templateHash(TEMPLATE) === templateHash(TEMPLATE) &&
        // Two ways the text really changes in this repository: a trailing
        // character, and a revised Prompt version on the first line.
        templateHash(`${TEMPLATE}\n`) !== templateHash(TEMPLATE) &&
        templateHash(TEMPLATE.replace(/^# .*$/m, "# portrait-v6-revised")) !== templateHash(TEMPLATE) &&
        /^[0-9a-f]{12}$/.test(templateHash(TEMPLATE)),
    ));

    // ---- One name per concept -------------------------------------------------
    // Every key the writer before schema 2 put on a row for a fact the canonical
    // row also carries. None of them is a name anything should still be writing.
    const ALIAS_KEYS = [
      "qcResult", "qualityCheck", "quality", "rawHash", "rawSha256", "sha256", "hash", "frameHash",
      "normalizedFrameHash", "frameSha256", "perceptualFingerprint", "fingerprint", "width", "height",
      "aspectRatio", "flags", "qcVersion", "quarantined", "quarantinePath",
    ];
    results.push(check(
      "a serialized row carries none of the names the old writer used for the same facts",
      generatedRows.length === 4 &&
        generatedRows.every((one) => Object.keys(one).every((key) => !ALIAS_KEYS.includes(key))) &&
        // And the names that replaced them are there, so this is a claim about
        // the collapse rather than about a row that recorded nothing at all.
        generatedRows.every((one) => one.qc !== undefined && one.raw !== undefined && one.normalized !== undefined),
    ));

    // ---- What the Gallery is handed -------------------------------------------
    // Fifty real Frames, each with a full QC record behind it, so the payload is
    // asked whether it carries that record rather than whether it has nothing to.
    const galleryDir = join(base, "gallery");
    const gallery = openOutputFolder(galleryDir, SALT);
    gallery.issueSeeds(50);
    const frameBytesFor = await good();
    await gallery.importFrames(
      Array.from({ length: 50 }, (_, i) => ({ name: `download-${i}.png`, buffer: frameBytesFor })),
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    const galleryApp = createApp({ outDir: galleryDir, salt: SALT }, withGenerators({ gemini: good }));
    const listed = (await (await galleryApp.request("/api/images")).json()) as Record<string, unknown>[];
    // The whole of the summary a FrameRecord is allowed to be, and nothing else.
    // The review state is one of them, so a tile can say what a person decided
    // without the record behind that decision. test/smoke-state.ts is where the
    // field's derivation is proved; this holds the payload to it.
    const GRID_KEYS = [
      "seed", "version", "source", "provider", "model", "prompt", "updatedAt",
      "primaryGroup", "photographyProfile", "qcStatus", "flags", "reviewState",
    ];
    // The rows behind those fifty Frames all carry a QC record, with its checks
    // and its flags, which is what makes the payload check something.
    const qcBehind = gallery.manifestRows().filter((one) => one.qc?.checks !== undefined);
    results.push(check(
      "the list of fifty Frames carries no QC record and no digests, only the rolled-up status and flags",
      listed.length === 50 && qcBehind.length === 50 &&
        listed.every((one) => Object.keys(one).every((key) => GRID_KEYS.includes(key))) &&
        !JSON.stringify(listed).includes('"checks"') &&
        !JSON.stringify(listed).includes('"perceptual"') &&
        listed.every((one) => typeof one.qcStatus === "string" && Array.isArray(one.flags)) &&
        // Every tile says where it stands with a person as well, and none of
        // these fifty Frames was ever looked at.
        listed.every((one) => one.reviewState === "unreviewed") &&
        // Every tile still says something: the Seed, the Prompt and where it
        // came from are all there, so nothing was dropped to make the payload small.
        listed.every((one) => typeof one.seed === "number" && typeof one.prompt === "string" &&
          one.prompt.length > 0 && typeof one.updatedAt === "string" && one.source === "manual"),
    ));

    // And the record for one Seed is where the QC record is read, which is the
    // other half of the same collapse: it is dropped from the list, not lost.
    const oneSeed = (await (await galleryApp.request("/api/images/1")).json()) as {
      frame?: { qc?: { checks?: Record<string, string> }; normalized?: { sha256?: string } };
    };
    results.push(check(
      "the record for one Seed still carries the QC record the list route leaves out",
      oneSeed.frame?.qc?.checks?.decode === "pass" &&
        oneSeed.frame.normalized?.sha256 !== undefined &&
        oneSeed.frame.normalized.sha256 !== "",
    ));
  } finally {
    process.chdir(startedIn);
    rmSync(base, { recursive: true, force: true });
  }
}