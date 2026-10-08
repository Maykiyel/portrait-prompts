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
  const store = await import("./server/store");
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
  results.push(check("the data module exports no error class carrying a status", !("ApiError" in store)));

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
  results.push(check("an import with no Frames at all is refused with the invalid-count status",
    (await images([], [])).status === STATUS_BY_CODE["invalid-count"]));
  results.push(check("seeds that are not a JSON array are refused with 400",
    (await post("/api/import", (() => { const f = new FormData(); f.append("seeds", "not json"); return f; })())).status === 400));

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

// The four entry points read through the module. These checks compare each
// command's own output, byte for byte, with what it printed before the
// migration, and cross-check it against what the module says about the folder.
const cliVersion = loadTemplate().version;
const captureCli = async (action: () => Promise<unknown> | unknown) => {
  const captured: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); };
  try {
    await action();
  } finally {
    console.log = log;
    console.error = err;
  }
  return captured;
};
// A command run as a real process, so its argv parsing and exit code are exercised.
const spawnCli = (script: string, args: string[]) =>
  new Promise<{ code: number; output: string }>((resolve) => {
    let text = "";
    const child = execFile(process.execPath, ["--import", "tsx", script, ...args], {
      cwd: originalCwd,
      env: { ...process.env, SEED_SALT: "", GEMINI_API_KEY: "" },
    });
    child.stdout?.on("data", (c: Buffer) => (text += c.toString()));
    child.on("close", (code) => resolve({ code: code ?? 0, output: text }));
  });

// A fixture archive: two Frames, one failed Attempt, four Waiting Seeds.
const cliOut = "out-smoke7";
rmSync(cliOut, { recursive: true, force: true });
const cliFolder = openOutputFolder(cliOut, "");
cliFolder.issueSeeds(6);
await cliFolder.writeFrame({ seed: 1, buffer: await good(), model: "fixture-model", prompt: cliFolder.promptFor(1, true) });
await cliFolder.writeFrame({ seed: 2, buffer: await good(), model: "fixture-model", prompt: cliFolder.promptFor(2, true) });
cliFolder.recordAttempt({ seed: 3, status: "failed", error: "fixture failure" });

// The entry points ask the module. Only the module asks the filesystem about a Frame.
const entryPoints = ["generate.ts", "import-images.ts", "export-prompts.ts", "status.ts"];
const entrySource = entryPoints.map((f) => readFileSync(join(originalCwd, f), "utf8"));
results.push(check(
  "every entry point goes through the module and none asks the filesystem about a Frame",
  entrySource.every((s) => s.includes("openOutputFolder(")) &&
    entrySource.every((s) => !s.includes("existsSync")) &&
    entrySource.every((s) => !/pendingSeeds|readCursor|saveImage|logManifest|assertSalt/.test(s)),
));

// status: the same lines, and the same failed count as the module.
const statusOut = await spawnCli("status.ts", [cliOut]);
results.push(check(
  "the status command prints the same lines it printed before the migration",
  statusOut.code === 0 && statusOut.output === [
    "Seed salt       not set",
    "Next new seed   7",
    "Images done     2",
    "Waiting         4  (00003 to 00006)",
    "Last attempt failed for 1 seeds, they run first next time",
    "",
  ].join("\n"),
));
results.push(check(
  "the status command and the module agree about the failed count",
  statusOut.output.includes(`Last attempt failed for ${cliFolder.status().failed} seeds`) &&
    statusOut.output.includes(`Next new seed   ${cliFolder.status().next}`) &&
    statusOut.output.includes(`Images done     ${cliFolder.status().done}`),
));
// prompts: the same line, and a file whose bytes are unchanged.
const promptsFile = "out-smoke7-prompts.html";
rmSync(promptsFile, { force: true });
const promptsRun = await spawnCli("export-prompts.ts", [
  "--dir", cliOut, "--count", "2", "--out", promptsFile, "--no-negative",
]);
const promptsHtml = readFileSync(promptsFile, "utf8");
results.push(check(
  "the prompt export prints the same line and writes the same bytes",
  promptsRun.code === 0 &&
    promptsRun.output === `Wrote 2 prompts to ${promptsFile} (${cliVersion}, seeds 3 to 4)\n` &&
    createHash("sha256").update(promptsHtml).digest("hex") ===
      "5f490677b2d56d21cdd28331822e85074cba23066363c3fe2d09753735e92a1d" &&
    promptsHtml.includes(`<b>00003</b>`) && promptsHtml.includes(cliFolder.promptFor(4)),
));

// import: the same lines, each file named with its Seed and its dimensions.
const impIn = "out-smoke8-in";
const impOut = "out-smoke8";
rmSync(impIn, { recursive: true, force: true });
rmSync(impOut, { recursive: true, force: true });
mkdirSync(impIn);
for (const [i, [name, w, h]] of ([["oldest.png", 900, 1350], ["square.png", 1024, 1024]] as [string, number, number][]).entries()) {
  const p = join(impIn, name);
  await sharp({ create: { width: w, height: h, channels: 3, background: "#a67a7a" } }).png().toFile(p);
  utimesSync(p, new Date(2026, 0, 1, 0, i), new Date(2026, 0, 1, 0, i)); // oldest.png is the older download
}
const impFolder = openOutputFolder(impOut, "");
impFolder.issueSeeds(3);
const imported = await captureCli(() =>
  importImages({ inDir: impIn, outDir: impOut, width: 768, height: 1152, dryRun: false, salt: "" }),
);
results.push(check(
  "import prints the same lines, each file with its Seed and its dimensions",
  imported.join("\n") === [
    `2 images in ${impIn}, matched to seeds by download time\n`,
    "00001  oldest.png  900x1350",
    "00002  square.png  1024x1024  <-- not 2:3, the crop will cut the sides or top",
    `\nImported 2 into ${impOut}/`,
  ].join("\n") &&
    impFolder.status().done === 2 && impFolder.waitingSeeds().join() === "3" &&
    impFolder.listFrames().map((f) => `${f.seed}:${f.source}`).join() === "2:manual,1:manual",
));
results.push(check(
  "an import leaves a 768x1152 Frame, keeps the Raw image and records the Attempt",
  (await sharp(await streamBytes(impFolder.readFrame(1))).metadata()).width === 768 &&
    (await sharp(await streamBytes(impFolder.readFrame(1, true))).metadata()).width === 900 &&
    readFileSync(join(impOut, "manifest.jsonl"), "utf8").trim().split("\n").length === 2,
));

// import with nothing waiting is refused with the same words.
const shortOut = "out-smoke10";
rmSync(shortOut, { recursive: true, force: true });
openOutputFolder(shortOut, "").issueSeeds(1);
let refusal = "no error";
await captureCli(async () => {
  try {
    await importImages({ inDir: impIn, outDir: shortOut, width: 768, height: 1152, dryRun: false, salt: "" });
  } catch (err) {
    refusal = err instanceof Error ? err.message : String(err);
  }
});
results.push(check(
  "import still refuses images when no Seeds are waiting",
  refusal === `2 images but only 1 seeds waiting for one. Run "prompts" first.`,
));

// A dry run reports the same lines and writes nothing.
const dryOut = "out-smoke9";
rmSync(dryOut, { recursive: true, force: true });
openOutputFolder(dryOut, "").issueSeeds(3);
const dryRun = await captureCli(() =>
  importImages({ inDir: impIn, outDir: dryOut, width: 768, height: 1152, dryRun: true, salt: "" }),
);
results.push(check(
  "a dry import prints the same lines and leaves the archive untouched",
  dryRun.join("\n") === [
    `2 images in ${impIn}, matched to seeds by download time\n`,
    "00001  oldest.png  900x1350",
    "00002  square.png  1024x1024  <-- not 2:3, the crop will cut the sides or top",
    "\nDry run, nothing written.",
  ].join("\n") &&
    openOutputFolder(dryOut, "").status().done === 0 &&
    openOutputFolder(dryOut, "").status().next === 4,
));

// The run: the same lines, Waiting Seeds finished first, failed Seeds left waiting.
const runOut = "out-smoke11";
rmSync(runOut, { recursive: true, force: true });
// One worker, so the order of these lines is fixed rather than a race.
const failLines = await captureCli(() => run({ ...defaults, count: 3, concurrency: 1, outDir: runOut, salt: "" }, bad));
const runFolder = openOutputFolder(runOut, "");
results.push(check(
  "a failing run prints the same lines and leaves every Seed waiting",
  failLines.join("\n") === [
    `${cliVersion} | ${defaults.model} | 3 to generate, 0 already done | seeds 1 to 3`,
    "[1] failed: fake quota error",
    "[2] failed: fake quota error",
    "[3] failed: fake quota error",
    `\nDone. 0 ok, 3 failed. Output in ${runOut}/`,
    "Failed seeds stay pending and run first next time.",
  ].join("\n") &&
    runFolder.waitingSeeds().join() === "1,2,3" && runFolder.status().next === 4 &&
    runFolder.status().failed === 3,
));
// One worker, so the order of these lines is fixed rather than a race.
const retryLines = await captureCli(() => run({ ...defaults, count: 2, concurrency: 1, outDir: runOut, salt: "" }, good));
results.push(check(
  "the next run finishes Waiting Seeds first and does not advance the counter",
  retryLines.join("\n") === [
    `${cliVersion} | ${defaults.model} | 2 to generate, 0 already done | seeds 1 to 2`,
    "[1] ok (1/2)",
    "[2] ok (2/2)",
    `\nDone. 2 ok, 0 failed. Output in ${runOut}/`,
  ].join("\n") &&
    runFolder.waitingSeeds().join() === "3" && runFolder.status().next === 4 &&
    runFolder.status().done === 2 && runFolder.status().failed === 1,
));
const dryRunLines = await captureCli(() =>
  run({ ...defaults, count: 2, outDir: runOut, dryRun: true, salt: "" }, good),
);
results.push(check(
  "a dry run prints the Prompt, moves no counter and writes no Frame",
  dryRunLines.length === 3 && dryRunLines[1] === `\n[3] ${runFolder.promptFor(3, true)}` &&
    dryRunLines[2] === `\n[4] ${runFolder.promptFor(4, true)}` &&
    dryRunLines[0].endsWith("| seeds 3 to 4") &&
    runFolder.status().next === 4 && runFolder.status().done === 2 && !runFolder.hasFrame(3),
));

// An unreadable counter is still refused by every command.
writeFileSync(join(cliOut, "cursor.json"), "{ corrupt");
results.push(check(
  "the status command still refuses an unreadable counter",
  (await spawnCli("status.ts", [cliOut])).code === 1,
));
results.push(check(
  "the run still refuses an unreadable counter instead of starting again",
  await asyncCode(() => run({ ...defaults, count: 1, outDir: cliOut, dryRun: true, salt: "" }, good)) ===
    "unreadable-counter",
));

for (const d of [cliOut, impOut, impIn, dryOut, shortOut, runOut]) rmSync(d, { recursive: true, force: true });
rmSync(promptsFile, { force: true });

const pass = results.every(Boolean);
console.log(pass ? "\nsmoke test passed" : "\nsmoke test FAILED");
process.exit(pass ? 0 : 1);

