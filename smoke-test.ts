// Runs the pipeline with fake generators. No API key or network needed.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { claimSeeds, issueSeeds, loadTemplate, readCursor } from "./common";
import { ArchiveError } from "./errors";
import { defaults, run } from "./generate";
import { importImages } from "./import-images";
import { openOutputFolder } from "./output-folder";
import { buildPrompt, pools } from "./sampler";

const good = async () =>
  sharp({ create: { width: 848, height: 1264, channels: 3, background: "#7a8fa6" } }).png().toBuffer();
const bad = async () => {
  throw new Error("fake quota error");
};
const check = (name: string, cond: boolean) => {
  console.log(cond ? `ok    ${name}` : `FAIL  ${name}`);
  return cond;
};

const out = "out-smoke";
const inDir = "in-smoke";
rmSync(out, { recursive: true, force: true });
rmSync(inDir, { recursive: true, force: true });
const results: boolean[] = [];

// API path with the counter
await run({ ...defaults, count: 4, outDir: out, salt: "" }, good);
results.push(check("first run makes seeds 1 to 4, counter at 5", readCursor(out) === 5));
await run({ ...defaults, count: 2, outDir: out, salt: "" }, good);
results.push(check("second run continues at 5 and 6", readdirSync(out).includes("00006.png") && readCursor(out) === 7));
await run({ ...defaults, count: 2, outDir: out, salt: "" }, bad);
results.push(check("failed run uses 7 and 8, no images", !readdirSync(out).includes("00007.png") && readCursor(out) === 9));
await run({ ...defaults, count: 2, outDir: out, salt: "" }, good);
results.push(
  check(
    "next run retries 7 and 8 and does not advance",
    readdirSync(out).includes("00007.png") && readdirSync(out).includes("00008.png") && readCursor(out) === 9,
  ),
);
const meta = await sharp(`${out}/00001.png`).metadata();
results.push(check("final image is 768x1152", meta.width === 768 && meta.height === 1152));
const lines = readFileSync(`${out}/manifest.jsonl`, "utf8").trim().split("\n");
results.push(check("manifest logs every attempt", lines.length === 10));
await run({ ...defaults, count: 3, outDir: out, dryRun: true, salt: "" }, good);
results.push(check("dry run leaves counter alone", readCursor(out) === 9));

// Manual path with the counter
const out2 = "out-smoke2";
rmSync(out2, { recursive: true, force: true });
claimSeeds(out2, "", 3); // what the prompts command does
mkdirSync(inDir);
for (const [i, name] of ["b.png", "a.png"].entries()) {
  const p = `${inDir}/${name}`;
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#a67a7a" } }).png().toFile(p);
  utimesSync(p, new Date(2026, 0, 1, 0, i), new Date(2026, 0, 1, 0, i)); // b is oldest
}
await importImages({ inDir, outDir: out2, width: 768, height: 1152, dryRun: false, salt: "" });
const rows = readFileSync(`${out2}/manifest.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
results.push(check("import fills seeds 1 and 2 by download time", rows[0].seed === 1 && rows[0].file === "b.png" && rows[1].seed === 2));
results.push(check("seed 3 still waiting", claimSeeds(out2, "", 2, false).join() === "3,4"));
let threw = false;
try {
  await importImages({ inDir, outDir: "out-smoke3", width: 768, height: 1152, dryRun: false, salt: "" });
} catch {
  threw = true;
}
results.push(check("import refuses images with no waiting seeds", threw));

// Seed counter: a missing one is a fresh run, an unreadable one is refused.
const counterDir = "out-smoke5";
rmSync(counterDir, { recursive: true, force: true });
mkdirSync(counterDir, { recursive: true });
results.push(check("a folder with no counter reads as seed 1", readCursor(counterDir) === 1));
results.push(check("a folder with no counter still hands out seed 1", claimSeeds(counterDir, "", 1).join() === "1"));
writeFileSync(join(counterDir, "cursor.json"), "{ this is not json");
const readCounter = (dir: string) => {
  try {
    readCursor(dir);
    return "";
  } catch (err) {
    return err instanceof ArchiveError ? err.code : `not an ArchiveError: ${String(err)}`;
  }
};
results.push(check("an unreadable counter is refused by code", readCounter(counterDir) === "unreadable-counter"));
let claimedFromBroken: string;
try {
  claimedFromBroken = claimSeeds(counterDir, "", 1).join();
} catch (err) {
  claimedFromBroken = err instanceof ArchiveError ? err.code : `not an ArchiveError: ${String(err)}`;
}
results.push(check("the salt guard is not bypassed by a broken counter", claimedFromBroken === "unreadable-counter"));
writeFileSync(join(counterDir, "cursor.json"), JSON.stringify({ next: "not a number" }));
results.push(check("a counter with no usable next is refused", readCounter(counterDir) === "unreadable-counter"));
// A reader running against a folder that is being written to must never see half a counter.
// Two readers loop for three seconds while this process keeps handing out Seeds.
const writerDir = "out-smoke6";
rmSync(writerDir, { recursive: true, force: true });
claimSeeds(writerDir, "", 1); // the counter now exists for the readers to race against
const readers = [0, 1].map(() =>
  execFile(process.execPath, [
    "-e",
    `const { readFileSync } = require("node:fs");
     const file = process.argv[1];
     let reads = 0, broken = 0;
     const until = Date.now() + 3000;
     while (Date.now() < until) {
       reads++;
       try {
         const v = JSON.parse(readFileSync(file, "utf8"));
         if (!Number.isInteger(v.next) || v.next < 1) broken++;
       } catch {
         broken++;
       }
     }
     process.stdout.write(JSON.stringify({ reads, broken }));`,
    join(writerDir, "cursor.json"),
  ]),
);
const reports = Promise.all(
  readers.map(
    (r) =>
      new Promise<{ reads: number; broken: number }>((resolve) => {
        let text = "";
        r.stdout?.on("data", (c: Buffer) => (text += c.toString()));
        r.on("close", () => resolve(JSON.parse(text)));
      }),
  ),
);
const writingUntil = Date.now() + 2800;
while (Date.now() < writingUntil) issueSeeds(writerDir, "", 1);
const torn = await reports;
results.push(check(
  "a reader racing the writer never sees a partial counter",
  torn.every((r) => r.reads > 1000 && r.broken === 0),
));
rmSync(writerDir, { recursive: true, force: true });
rmSync(counterDir, { recursive: true, force: true });


// Salt
const { template } = loadTemplate();
delete process.env.SEED_SALT;
results.push(check("same seed and salt give the same prompt", buildPrompt(template, 5, "a") === buildPrompt(template, 5, "a")));
results.push(check("different salts give different prompts", buildPrompt(template, 5, "a") !== buildPrompt(template, 5, "b")));
const explicit = buildPrompt(template, 5, "a");
process.env.SEED_SALT = "the environment cannot change this Prompt";
results.push(check("a caller supplies the salt, not the environment", buildPrompt(template, 5, "a") === explicit));
delete process.env.SEED_SALT;
const salted = Array.from({ length: 50 }, (_, i) => i + 1).filter((n) => buildPrompt(template, n, "x") !== buildPrompt(template, n, "")).length;
results.push(check("salt changes almost every seed", salted >= 48));
// Unsalted Seed 9's Prompt before this change: preserves the plain-seed PRNG path.
const plain = createHash("sha256").update(buildPrompt(template, 9, "")).digest("hex");
results.push(check("no salt matches the plain seed", plain === "210a57d95ba0d439294b0ea609484ea277514f5353b877097d8f96423df558ab"));
const guardDir = "out-smoke4";
rmSync(guardDir, { recursive: true, force: true });
claimSeeds(guardDir, "", 2); // started with no salt
let guarded = false;
try {
  claimSeeds(guardDir, "changed", 2);
} catch {
  guarded = true;
}
rmSync(guardDir, { recursive: true, force: true });
results.push(check("changing the salt mid-run is blocked", guarded));

// Template and pools
const placeholders = new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
results.push(check("every placeholder has a pool and every pool is used", [...placeholders].sort().join() === Object.keys(pools).sort().join()));
const small = Object.entries(pools).filter(([k, xs]) => k !== "gender" && xs.length < 10).map(([k]) => k);
results.push(check("each pool has 10 or more entries except gender", small.length === 0));
const prompts = Array.from({ length: 500 }, (_, i) => buildPrompt(template, i + 1, "t"));
results.push(check("500 prompts are almost all unique", new Set(prompts).size >= 495));
const slips = prompts.filter((p) => /\{|\}|  | \.|,,|\b(a|an) (a|an)\b|\ba [aeiou]|\ban [^aeiou\s\d]/i.test(p));
results.push(check("no grammar or placeholder slips in 500 prompts", slips.length === 0));
if (slips.length) console.log("  e.g.", slips[0].split("\n")[0]);

// The new output-folder interface, on real files in a throwaway folder. Existing
// callers above are intentionally unchanged until the migration tickets.
const tempBase = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir();
const fixture = mkdtempSync(join(tempBase, "portrait-prompts-"));
const originalCwd = process.cwd();
const streamBytes = async (stream: NodeJS.ReadableStream) => {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
};
const errorCode = (action: () => unknown) => {
  try {
    action();
    return "no error";
  } catch (err) {
    return err instanceof ArchiveError ? err.code : String(err);
  }
};
const asyncCode = async (action: () => Promise<unknown>) => {
  try {
    await action();
    return "no error";
  } catch (err) {
    return err instanceof ArchiveError ? err.code : String(err);
  }
};
try {
  // Only fixture setup writes these files; the assertions below read through the module.
  writeFileSync(join(fixture, "template.txt"), "# fixture-v1\nPortrait {age}.");
  writeFileSync(join(fixture, "negative.txt"), "fixture exclusions");
  process.chdir(fixture);
  const folder = openOutputFolder(join(fixture, "archive"), "alpha");
  results.push(check("opening the output folder returns a frozen interface", Object.isFrozen(folder)));
  results.push(check("a new output folder reports Seed 1", folder.status().next === 1 && folder.status().waiting === 0));
  results.push(check("a claim preview does not commit", folder.claimSeeds(2, false).join() === "1,2" && folder.status().next === 1));
  results.push(check("claiming Seeds commits and puts Waiting Seeds first", folder.claimSeeds(3).join() === "1,2,3" && folder.claimSeeds(2).join() === "1,2"));
  results.push(check("issuing fresh Seeds skips Waiting Seeds", folder.issueSeeds(2).join() === "4,5"));
  results.push(check("invalid count and Seed raise named codes", errorCode(() => folder.claimSeeds(0)) === "invalid-count" && errorCode(() => folder.hasFrame(-1)) === "invalid-seed"));
  results.push(check("no Frame is a missing-Frame code", errorCode(() => folder.readFrame(1)) === "missing-frame"));
  results.push(check("an unissued Seed is not waiting", await asyncCode(() => folder.writeFrame({ seed: 6, buffer: Buffer.from("not a Frame") })) === "seed-not-waiting"));
  const prompt = folder.promptFor(1);
  results.push(check("finished Prompt is deterministic and Negative list is optional",
    prompt.startsWith("Generate an image. Portrait ") && prompt === folder.promptFor(1) &&
    folder.promptFor(1, true) === `${prompt}\n\nAvoid: fixture exclusions.` && folder.promptsFor([1])[0].prompt === prompt));
  writeFileSync(join(fixture, "template.txt"), "# fixture-v2\nChanged {age}.");
  writeFileSync(join(fixture, "negative.txt"), "changed exclusions");
  results.push(check("Prompt files are cached for the life of the module",
    folder.status().version === "fixture-v1" && folder.promptFor(1, true) === `${prompt}\n\nAvoid: fixture exclusions.` &&
    openOutputFolder(join(fixture, "other"), "alpha").status().version === "fixture-v2"));
  const img = await good();
  const imports = await folder.importFrames(
    [{ name: "corrupt.png", buffer: Buffer.from("bad") }, { name: "good.png", buffer: img }], [1, 2],
  );
  results.push(check("one corrupt download does not lose the other Frame", !imports[0].ok && imports[1].ok && folder.hasFrame(2) && folder.waitingSeeds().includes(1)));
  results.push(check("batch invalidity is refused before writing", await asyncCode(() => folder.importFrames([{ name: "repeat.png", buffer: img }], [2])) === "seed-not-waiting"));
  const framed = await streamBytes(folder.readFrame(2));
  const raw = await streamBytes(folder.readFrame(2, true));
  const frameMeta = await sharp(framed).metadata();
  const rawMeta = await sharp(raw).metadata();
  results.push(check("Frame and Raw image are streams with their original dimensions",
    frameMeta.width === 768 && frameMeta.height === 1152 && rawMeta.width === 848 && rawMeta.height === 1264));
  const thumbs = await streamBytes(await folder.readThumbnail(2, 160));
  results.push(check("Thumbnail is a stream", (await sharp(thumbs).metadata()).width === 160));
  results.push(check("Frame records and status come through the interface",
    folder.listFrames().map((frame) => frame.seed).join() === "2" && folder.status().done === 1 && folder.status().waiting === 4));
  results.push(check("a different salt cannot claim this folder", errorCode(() => openOutputFolder(join(fixture, "archive"), "beta").claimSeeds(1)) === "salt-mismatch"));
  folder.recordAttempt({ seed: 1, status: "failed", error: "fixture failure" });
  results.push(check("status counts a Seed whose last Attempt failed", folder.status().failed === 1));
  await folder.writeFrame({ seed: 5, buffer: img, model: "fixture-model", prompt: folder.promptFor(5, true) });
  results.push(check("Frame records are newest-first with Attempt provenance",
    folder.listFrames().map((frame) => frame.seed).join() === "5,2" &&
    folder.listFrames()[0].model === "fixture-model" && folder.listFrames()[0].prompt === folder.promptFor(5, true)));
  folder.rejectFrame(2);
  results.push(check("Rejection returns a Seed to waiting", !folder.hasFrame(2) && folder.waitingSeeds().includes(2) && folder.listFrames().map((frame) => frame.seed).join() === "5"));
  results.push(check("a second Rejection raises the missing-Frame code", errorCode(() => folder.rejectFrame(2)) === "missing-frame"));
  // A malformed counter is a fixture for the unreadable-state path; assertions
  // still ask the module, never inspect the on-disk representation.
  writeFileSync(join(fixture, "archive", "cursor.json"), "{ corrupt");
  results.push(check("unreadable counter refuses Seed issuance instead of resetting", errorCode(() => folder.issueSeeds(1)) === "unreadable-counter"));
  results.push(check("status reports an unusable folder without inventing a next Seed",
    folder.status().next === null && folder.status().waiting === null && !!folder.status().problem));
} finally {
  process.chdir(originalCwd);
  rmSync(fixture, { recursive: true, force: true });
}

for (const d of [out, out2, inDir, "out-smoke3"]) rmSync(d, { recursive: true, force: true });
const pass = results.every(Boolean);
console.log(pass ? "\nsmoke test passed" : "\nsmoke test FAILED");
process.exit(pass ? 0 : 1);
