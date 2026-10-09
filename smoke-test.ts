// Runs the pipeline with fake generators. No API key or network needed.
// The seam audit and the CLI byte-contract live in their own files, each
// changing for its own reason; this file holds the module interface and
// the HTTP contract. Every section reports through the shared harness.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { ArchiveError } from "./errors";
import { defaults, run } from "./generate";
import { importImages } from "./import-images";
import { openOutputFolder, seedLabel, type FileForImport } from "./output-folder";
import { buildPrompt, pools } from "./sampler";
import { runAudit } from "./smoke-audit";
import { runCliContract } from "./smoke-cli";
import {
  asyncCode, bad, check, errorCode, good, promptFiles, repoRoot, results, streamBytes,
} from "./smoke-harness";

const out = "out-smoke";
const inDir = "in-smoke";
rmSync(out, { recursive: true, force: true });
rmSync(inDir, { recursive: true, force: true });

// The seam audit, in its own file: it reads source text to keep the
// ownership claim global, while every other check here asks the module.
runAudit();

// The five-digit Seed label is stated twice: the module owns it for
// filenames and the command line, and the browser states it for display,
// because importing the module would drag the image library into the
// bundle. Nothing may let the two drift apart.
const { seedLabel: browserSeedLabel } = await import("./web/src/lib/text");
const labelSeeds = [1, 9, 10, 99, 100, 99999, 100000, 12345];
results.push(check(
  "the module and the browser label the same Seeds identically",
  labelSeeds.every((seed) => seedLabel(seed) === browserSeedLabel(seed)),
));

// API path with the counter. Every line below asks the module; none of them reads
// the counter file, lists the directory or opens a Frame by path.
const apiFolder = openOutputFolder(out, "");
await run({ ...defaults, count: 4, outDir: out, salt: "" }, good);
results.push(check(
  "first run makes seeds 1 to 4, counter at 5",
  apiFolder.status().next === 5 && apiFolder.listFrames().map((f) => f.seed).join() === "4,3,2,1",
));
await run({ ...defaults, count: 2, outDir: out, salt: "" }, good);
results.push(check("second run continues at 5 and 6", apiFolder.hasFrame(6) && apiFolder.status().next === 7));
await run({ ...defaults, count: 2, outDir: out, salt: "" }, bad);
results.push(check(
  "failed run uses 7 and 8, no images",
  !apiFolder.hasFrame(7) && !apiFolder.hasFrame(8) && apiFolder.status().next === 9,
));
results.push(check(
  "a failed run records an Attempt for every Seed it tried",
  apiFolder.status().failed === 2 && apiFolder.waitingSeeds().join() === "7,8",
));
await run({ ...defaults, count: 2, outDir: out, salt: "" }, good);
results.push(
  check(
    "next run retries 7 and 8 and does not advance",
    apiFolder.hasFrame(7) && apiFolder.hasFrame(8) && apiFolder.status().next === 9,
  ),
);
results.push(check(
  "the last Attempt is what counts, so the retry clears both failures",
  apiFolder.status().failed === 0 && apiFolder.status().done === 8 && apiFolder.waitingSeeds().join() === "",
));
const meta = await sharp(await streamBytes(apiFolder.readFrame(1))).metadata();
results.push(check("final image is 768x1152", meta.width === 768 && meta.height === 1152));
await run({ ...defaults, count: 3, outDir: out, dryRun: true, salt: "" }, good);
results.push(check(
  "dry run leaves counter alone",
  apiFolder.status().next === 9 && apiFolder.status().done === 8 && apiFolder.waitingSeeds().join() === "",
));

// Manual path with the counter
const out2 = "out-smoke2";
rmSync(out2, { recursive: true, force: true });
const manual = openOutputFolder(out2, "");
manual.claimSeeds(3); // what the prompts command does
mkdirSync(inDir);
for (const [i, name] of ["b.png", "a.png"].entries()) {
  const p = `${inDir}/${name}`;
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#a67a7a" } }).png().toFile(p);
  utimesSync(p, new Date(2026, 0, 1, 0, i), new Date(2026, 0, 1, 0, i)); // b is oldest
}
await importImages({ inDir, outDir: out2, dryRun: false, salt: "" });
// Which download landed on which Seed is the command's own answer, and the Frame
// records confirm it: b.png is the older download, so it is Seed 1.
results.push(check(
  "import fills seeds 1 and 2 by download time",
  manual.listFrames().map((f) => f.seed).join() === "2,1" && manual.listFrames().every((f) => f.source === "manual"),
));
results.push(check("seed 3 still waiting", manual.claimSeeds(2, false).join() === "3,4"));
let threw = false;
try {
  await importImages({ inDir, outDir: "out-smoke3", dryRun: false, salt: "" });
} catch {
  threw = true;
}
results.push(check("import refuses images with no waiting seeds", threw));

// Seed counter: a missing one is a fresh run, an unreadable one is refused. The
// writes below are fixture setup; every assertion asks the module.
const counterDir = "out-smoke5";
rmSync(counterDir, { recursive: true, force: true });
mkdirSync(counterDir, { recursive: true });
const counter = openOutputFolder(counterDir, "");
results.push(check("a folder with no counter reads as seed 1", counter.status().next === 1));
results.push(check("a folder with no counter still hands out seed 1", counter.claimSeeds(1).join() === "1"));
writeFileSync(join(counterDir, "cursor.json"), "{ this is not json");
results.push(check(
  "an unreadable counter is refused by code",
  errorCode(() => counter.waitingSeeds()) === "unreadable-counter",
));
results.push(check(
  "the salt guard is not bypassed by a broken counter",
  errorCode(() => counter.claimSeeds(1)) === "unreadable-counter",
));
writeFileSync(join(counterDir, "cursor.json"), JSON.stringify({ next: "not a number" }));
results.push(check(
  "a counter with no usable next is refused",
  errorCode(() => counter.waitingSeeds()) === "unreadable-counter",
));
// A reader running against a folder that is being written to must never be told
// the folder has no state. Two readers, in their own processes and each holding
// its own open module, loop for three seconds while this process hands out Seeds.
// They ask the module for the status, so a torn counter shows up as a missing or
// unusable next Seed rather than as Seed 1.
const writerDir = "out-smoke6";
rmSync(writerDir, { recursive: true, force: true });
const writer = openOutputFolder(writerDir, "");
writer.claimSeeds(1); // the counter now exists for the readers to race against
const READER = `const { pathToFileURL } = require("node:url");
 void (async () => {
   const { openOutputFolder } = await import(pathToFileURL(process.argv[1]).href);
   const folder = openOutputFolder(process.argv[2], "");
   let reads = 0, broken = 0;
   const until = Date.now() + 3000;
   while (Date.now() < until) {
     reads++;
     const s = folder.status();
     if (!Number.isInteger(s.next) || (s.next ?? 0) < 1 || s.problem) broken++;
   }
   process.stdout.write(JSON.stringify({ reads, broken }));
 })();`;
const readers = [0, 1].map(() =>
  execFile(process.execPath, ["--import", "tsx", "-e", READER, join(repoRoot, "output-folder.ts"), writerDir], {
    cwd: repoRoot,
  }),
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
while (Date.now() < writingUntil) writer.issueSeeds(1);
const torn = await reports;
if (!torn.every((r) => r.reads > 100 && r.broken === 0))
  console.log(`      readers reported ${JSON.stringify(torn)}`);
// The bar is a hundred real reads per reader, not a thousand: a status call walks
// the folder, so it is far slower than reading one file, and the point is that
// every one of those reads agreed the folder had a usable next Seed.
results.push(check(
  "a reader racing the writer never sees a partial counter",
  torn.every((r) => r.reads > 100 && r.broken === 0),
));
rmSync(writerDir, { recursive: true, force: true });
rmSync(counterDir, { recursive: true, force: true });


// Salt and the Attribute pools. These drive sampler.ts, the sibling module that
// receives the salt rather than reading it, so they need the Prompt template as
// input. The Prompt files are not part of the archive: the archive checks below
// go through the module and never touch them.
const { template } = promptFiles();
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
openOutputFolder(guardDir, "").claimSeeds(2); // started with no salt
results.push(check(
  "changing the salt mid-run is blocked",
  errorCode(() => openOutputFolder(guardDir, "changed").claimSeeds(2)) === "salt-mismatch",
));
rmSync(guardDir, { recursive: true, force: true });

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

// The module's interface, on real files in a throwaway folder. Only the fixture
// setup below writes to disk; every assertion asks the module.
const tempBase = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir();
const fixture = mkdtempSync(join(tempBase, "portrait-prompts-"));
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
  // Which download lands on which Seed is the adapter's decision, so the module
  // has no download time to match on. These two lines are a compile-time check:
  // drop the error on the second and typecheck fails.
  const nameOnly: FileForImport = { name: "download.png", buffer: img };
  // @ts-expect-error the module must not accept a download time to match on
  const withTime: FileForImport = { name: "download.png", buffer: img, mtimeMs: Date.now() };
  results.push(check(
    "an import asks the module for Frames, never for a download time",
    nameOnly.name === "download.png" && withTime.name === "download.png",
  ));
  // A malformed counter is a fixture for the unreadable-state path; assertions
  // still ask the module, never inspect the on-disk representation.
  writeFileSync(join(fixture, "archive", "cursor.json"), "{ corrupt");
  results.push(check("unreadable counter refuses Seed issuance instead of resetting", errorCode(() => folder.issueSeeds(1)) === "unreadable-counter"));
  results.push(check("status reports an unusable folder without inventing a next Seed",
    folder.status().next === null && folder.status().waiting === null && !!folder.status().problem));
} finally {
  process.chdir(repoRoot);
  rmSync(fixture, { recursive: true, force: true });
}

// The free route receives finished Prompt text from the API. Compare it to
// the existing generator with a fake Buffer result: no key or remote call.
const promptDir = mkdtempSync(join(tempBase, "portrait-api-prompts-"));
const previousOut = process.env.OUT_DIR;
try {
  process.env.OUT_DIR = promptDir;
  const { getPending } = await import("./server/store");
  const promptFolder = openOutputFolder(promptDir, "");
  promptFolder.issueSeeds(1);
  const withoutNegative = getPending("", false);
  const withNegative = getPending("", true);
  results.push(check("API returns finished Prompt text, not parts for the browser",
    Object.keys(withNegative).join() === "items" &&
    withoutNegative.items[0].prompt === promptFolder.promptFor(1) &&
    withNegative.items[0].prompt === promptFolder.promptFor(1, true)));
  results.push(check("API appends the Negative list only when requested",
    !withoutNegative.items[0].prompt.includes("\n\nAvoid:") && withNegative.items[0].prompt.includes("\n\nAvoid:")));
  let sent = "";
  await run({ ...defaults, outDir: promptDir, count: 1, salt: "", useNegative: true }, async (prompt) => {
    sent = prompt;
    return good();
  });
  results.push(check("free and API routes send the exact same Prompt", sent === withNegative.items[0].prompt));
} finally {
  if (previousOut === undefined) delete process.env.OUT_DIR;
  else process.env.OUT_DIR = previousOut;
  rmSync(promptDir, { recursive: true, force: true });
}

// Ticket #7: the routes read through the module. Frames arrive as streams, every
// failure arrives as a named code, and one table turns each code into a status.
const routeDir = mkdtempSync(join(tempBase, "portrait-routes-"));
const savedOut = process.env.OUT_DIR;
const savedKey = process.env.GEMINI_API_KEY;
try {
  process.env.OUT_DIR = routeDir;
  process.env.GEMINI_API_KEY = "";
  const { createApp, STATUS_BY_CODE } = await import("./server/index");
  const { refusalFor } = await import("./server/jobs");
  const codes = Object.keys(STATUS_BY_CODE) as import("./errors").ArchiveErrorCode[];
  const seeded = openOutputFolder(routeDir, "route-salt");
  seeded.issueSeeds(3); // Seeds 1 to 3 are waiting
  await seeded.importFrames([{ name: "one.png", buffer: await good() }], [1]);
  const api = createApp("route-salt");
  // A route that raises each code with a message nobody would ever write, so the
  // status can only have come from the code.
  for (const code of codes)
    api.get(`/reworded/${code}`, () => {
      throw new ArchiveError(code, `a message nobody wrote: ${code}`);
    });
  const post = (path: string, body: FormData) => api.request(path, { method: "POST", body });
  const images = async (files: { name: string; buffer: Buffer }[], seeds: number[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", new File([new Uint8Array(file.buffer)], file.name));
    form.append("seeds", JSON.stringify(seeds));
    return post("/api/import", form);
  };
  const request: import("./shared/api-types").GenerateRequest = { count: 1, model: "flash", size: "1K", concurrency: 1, useNegative: false };

  results.push(check("one table maps every ArchiveErrorCode to a status, and nothing keys on text",
    codes.length === 6 && codes.every((code) => typeof STATUS_BY_CODE[code] === "number")));
  for (const code of codes) {
    const reworded = await api.request(`/reworded/${code}`);
    const body = (await reworded.json()) as { error?: string };
    results.push(check(
      `a reworded ${code} message still answers ${STATUS_BY_CODE[code]}`,
      reworded.status === STATUS_BY_CODE[code] && body.error === `a message nobody wrote: ${code}`,
    ));
  }
  const raised = new ArchiveError("invalid-count", "a message nobody wrote");
  results.push(check(
    "the core failure carries a code and no HTTP status",
    "code" in raised && raised.code === "invalid-count" && !("status" in raised),
  ));

  const status = await api.request("/api/status");
  const told = (await status.json()) as { next: number | null; waiting: number | null; done: number; saltSet: boolean; hasApiKey: boolean; problem?: string };
  results.push(check("the status route reports the folder and still says whether an API key is set",
    status.status === 200 && told.next === 4 && told.waiting === 2 && told.done === 1 &&
    told.saltSet && told.hasApiKey === false && told.problem === undefined));

  const listed = (await (await api.request("/api/images")).json()) as { seed: number; source: string; version: string; prompt: string }[];
  results.push(check("the Frame list comes back through the route with its provenance",
    listed.length === 1 && listed[0].seed === 1 && listed[0].source === "manual" &&
    listed[0].version === seeded.status().version &&
    listed[0].prompt.length > 0 && seeded.promptFor(1).includes(listed[0].prompt)));

  const frame = await api.request("/api/images/1/file");
  const raw = await api.request("/api/images/1/file?raw=1");
  const frameMeta = await sharp(Buffer.from(await frame.arrayBuffer())).metadata();
  const rawMeta = await sharp(Buffer.from(await raw.arrayBuffer())).metadata();
  results.push(check("a Frame and a Raw image are served as streams, never as paths",
    frame.status === 200 && raw.status === 200 && frame.headers.get("Content-Type") === "image/png" &&
    frameMeta.width === 768 && frameMeta.height === 1152 && rawMeta.width === 848 && rawMeta.height === 1264));
  const thumb = await api.request("/api/images/1/thumb?w=160");
  results.push(check("a Thumbnail is served as a stream",
    thumb.status === 200 && thumb.headers.get("Content-Type") === "image/webp" &&
    (await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width === 160));

  results.push(check("a Seed with no Frame is refused with the missing-Frame status",
    (await api.request("/api/images/3/file")).status === STATUS_BY_CODE["missing-frame"]));
  results.push(check("an impossible Seed is refused with the invalid-Seed status",
    (await api.request("/api/images/0/file")).status === STATUS_BY_CODE["invalid-seed"]));
  results.push(check("a mismatched salt is refused with the salt-mismatch status",
    (await createApp("wrong-salt").request("/api/prompts/pending")).status === STATUS_BY_CODE["salt-mismatch"]));

  const partial = await images(
    [{ name: "corrupt.png", buffer: Buffer.from("not an image") }, { name: "three.png", buffer: await good() }], [2, 3],
  );
  const perFile = (await partial.json()) as { results: { seed: number; ok: boolean }[] };
  results.push(check("one corrupt download still answers per file, and the other Frame lands",
    partial.status === 200 && perFile.results.length === 2 && !perFile.results[0].ok && perFile.results[1].ok &&
    seeded.hasFrame(3) && !seeded.hasFrame(2)));
  results.push(check("an import onto a Seed that already has a Frame is refused with the not-waiting status",
    (await images([{ name: "again.png", buffer: await good() }], [1])).status === STATUS_BY_CODE["seed-not-waiting"]));
  const duplicate = await images(
    [{ name: "one-more.png", buffer: await good() }, { name: "two-more.png", buffer: await good() }], [2, 2],
  );
  const duplicateBody = (await duplicate.json()) as { error?: string };
  results.push(check(
    "a batch naming the same Seed twice is refused with 400 and says so",
    duplicate.status === 400 && duplicateBody.error === "Two images share a seed",
  ));
  results.push(check("an import with no Frames at all is refused with the invalid-count status",
    (await images([], [])).status === STATUS_BY_CODE["invalid-count"]));
  const notAnArray = async (seeds: string) =>
    (await post("/api/import", (() => { const f = new FormData(); f.append("seeds", seeds); return f; })())).status;
  results.push(check("seeds that are not a JSON array are refused with 400",
    (await notAnArray("not json")) === 400 &&
    // Parsed fine, but not a list: the route says so rather than crashing on it.
    (await notAnArray("5")) === 400));

  results.push(check("a Rejection through the route returns the Seed to waiting",
    (await api.request("/api/images/3/reject", { method: "POST" })).status === 200 &&
    !seeded.hasFrame(3) && seeded.waitingSeeds().join() === "2,3" &&
    (await api.request("/api/images/3/file")).status === STATUS_BY_CODE["missing-frame"]));
  results.push(check("a second Rejection is refused with the missing-Frame status",
    (await api.request("/api/images/3/reject", { method: "POST" })).status === STATUS_BY_CODE["missing-frame"]));

  const noKey = await api.request("/api/generate", { method: "POST", body: JSON.stringify(request) });
  results.push(check("the Job refuses to start without an API key",
    noKey.status === 400 && ((await noKey.json()) as { error: string }).error.includes("GEMINI_API_KEY")));
  const busy = refusalFor({ status: "running", total: 0, done: 0, failed: 0, log: [] }, true, request);
  results.push(check("the Job refuses to start while one is running",
    busy?.status === 409 && busy.message === "A job is already running"));
} finally {
  if (savedOut === undefined) delete process.env.OUT_DIR;
  else process.env.OUT_DIR = savedOut;
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
  rmSync(routeDir, { recursive: true, force: true });
}

for (const d of [out, out2, inDir, "out-smoke3"]) rmSync(d, { recursive: true, force: true });

// The CLI byte-contract, in its own file: each command's own output,
// byte for byte, cross-checked against what the module says about the folder.
await runCliContract();

const pass = results.every(Boolean);
console.log(pass ? "\nsmoke test passed" : "\nsmoke test FAILED");
process.exit(pass ? 0 : 1);
