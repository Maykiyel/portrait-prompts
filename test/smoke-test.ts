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
import { ArchiveError } from "../core/errors";
import {
  run, type GenOptions, type Generator, type PromptEvent, type ProgressEvent, type RunRequest, type SeedEvent,
  type StartEvent,
} from "../core/generate";
import { MODELS } from "../core/gemini";
import { policy } from "../core/policy";
import { generateImages, parseArgs } from "../cli/generate";
import { importImages } from "../cli/import-images";
import { openOutputFolder, seedLabel, type FileForImport } from "../core/output-folder";
import { buildPrompt, pools } from "../core/sampler";
import { createApp, STATUS_BY_CODE } from "../server/index";
import type { GenerateRequest, JobState } from "../shared/api-types";
import { refusalFor } from "../server/jobs";
import { createStore } from "../server/store";
import { runAudit } from "./smoke-audit";
import { runCliContract } from "./smoke-cli";
import {
  asyncCode, bad, captureOutput, check, errorCode, good, jobOf, promptFiles, repoRoot, results,
  settleJob, streamBytes,
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
const { seedLabel: browserSeedLabel } = await import("../web/src/lib/text");
const labelSeeds = [1, 9, 10, 99, 100, 99999, 100000, 12345];
results.push(check(
  "the module and the browser label the same Seeds identically",
  labelSeeds.every((seed) => seedLabel(seed) === browserSeedLabel(seed)),
));

// The generation run, on its own: it claims Seeds, writes Frames, records
// Attempts and reports progress as data. No terminal is involved anywhere in
// this section — the run is asked what it did, the folder answers everything
// else, and one check at the end watches the console to hold it silent.
const apiFolder = openOutputFolder(out, "");
// This section drives the run directly, so it names its own concrete values:
// one Seed at a time, one worker, and a model no vendor has. The two it does
// not care about are the core's defaults rather than a second copy of them,
// because nothing in this section asserts on either.
const apiRequest = (over: Partial<RunRequest>, generate: Generator = good): RunRequest => ({
  count: 1,
  concurrency: 1,
  model: "fake-model",
  aspectRatio: policy.aspectRatio,
  imageSize: policy.imageSize,
  useNegative: true,
  dryRun: false,
  outDir: out,
  salt: "",
  generate,
  ...over,
});
const apiRun = async (over: Partial<RunRequest>, generate: Generator = good) => {
  const events: ProgressEvent[] = [];
  const result = await run({ ...apiRequest(over, generate), onEvent: (event) => events.push(event) });
  return { events, result };
};
const starts = (events: ProgressEvent[]): StartEvent[] =>
  events.filter((e): e is StartEvent => e.kind === "start");
const seedResults = (events: ProgressEvent[]): SeedEvent[] =>
  events.filter((e): e is SeedEvent => e.kind === "seed");
const prompted = (events: ProgressEvent[]): PromptEvent[] =>
  events.filter((e): e is PromptEvent => e.kind === "prompt");

const first = await apiRun({ count: 4 });
results.push(check(
  "first run makes seeds 1 to 4, counter at 5",
  apiFolder.status().next === 5 && apiFolder.listFrames().map((f) => f.seed).join() === "4,3,2,1",
));
const opened = starts(first.events)[0];
results.push(check(
  "the start event carries the five facts the run learned from the folder",
  !!opened && opened.version === apiFolder.status().version && opened.total === 4 &&
    opened.alreadyDone === 0 && opened.range?.first === 1 && opened.range?.last === 4 &&
    // Exactly those five, and nothing else. The model, the root and the salt
    // are on this list too, and the run must not hand them back: the caller
    // supplied every one of them and would only be told what it already knew.
    Object.keys(opened ?? {}).sort().join() === "alreadyDone,kind,range,total,version" &&
    starts(first.events).length === 1 && first.events[0] === opened,
));
results.push(check(
  "one Seed event per Seed touched, and every Frame is on disk when it arrives",
  seedResults(first.events).map((e) => `${e.seed}:${e.ok}`).join() === "1:true,2:true,3:true,4:true" &&
    seedResults(first.events).every((e) => !("message" in e)) &&
    first.result.done === 4 && first.result.failed === 0 &&
    apiFolder.listFrames().map((f) => f.seed).join() === "4,3,2,1",
));
await apiRun({ count: 2 });
results.push(check("second run continues at 5 and 6", apiFolder.hasFrame(6) && apiFolder.status().next === 7));
const fated = await apiRun({ count: 2 }, bad);
results.push(check(
  "failed run uses 7 and 8, no images",
  !apiFolder.hasFrame(7) && !apiFolder.hasFrame(8) && apiFolder.status().next === 9,
));
results.push(check(
  "a failed Seed is reported with the message it failed with, and only a failure carries one",
  seedResults(fated.events).map((e) => `${e.seed}:${e.ok}:${e.message}`).join() ===
    "7:false:fake quota error,8:false:fake quota error" && fated.result.done === 0 && fated.result.failed === 2,
));
results.push(check(
  "a failed run records an Attempt for every Seed it tried",
  apiFolder.status().failed === 2 && apiFolder.waitingSeeds().join() === "7,8",
));
await apiRun({ count: 2 });
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
const dry = await apiRun({ count: 3, dryRun: true });
results.push(check(
  "a dry run reports the Prompt for every Seed and no result at all",
  // Seeds 1 to 8 all have Frames by now, so all three are fresh ones: 9, 10, 11.
  dry.events.length === 4 && starts(dry.events)[0].total === 3 && seedResults(dry.events).length === 0 &&
    prompted(dry.events).map((e) => `${e.seed}:${e.prompt === apiFolder.promptFor(e.seed, true)}`).join() ===
      "9:true,10:true,11:true" && dry.result.done === 0 && dry.result.failed === 0,
));
results.push(check(
  "dry run leaves counter alone",
  apiFolder.status().next === 9 && apiFolder.status().done === 8 && apiFolder.waitingSeeds().join() === "",
));
const nothing = await apiRun({ start: 1, count: 8 });
const barren = starts(nothing.events)[0];
results.push(check(
  "a run with nothing left to generate reports no Seed range at all",
  !!barren && barren.total === 0 && barren.alreadyDone === 8 && !("range" in barren) &&
    nothing.events.length === 1 && nothing.result.done === 0 && nothing.result.failed === 0 &&
    apiFolder.status().next === 9,
));
const named = await apiRun({ start: 20, count: 2 });
results.push(check(
  "an explicit start fills the gap up to the last Seed it names",
  apiFolder.status().next === 22 && apiFolder.hasFrame(20) && apiFolder.hasFrame(21) &&
    starts(named.events)[0].range?.first === 20 && starts(named.events)[0].range?.last === 21 &&
    seedResults(named.events).map((e) => e.seed).join() === "20,21",
));
const namedDry = await apiRun({ start: 30, count: 2, dryRun: true });
results.push(check(
  "a dry run names Seeds by hand without committing or moving the counter",
  apiFolder.status().next === 22 && prompted(namedDry.events).map((e) => e.seed).join() === "30,31" &&
    !apiFolder.hasFrame(30) && !apiFolder.hasFrame(31),
));
const narrated = await captureOutput(() => apiRun({ count: 1 }));
results.push(check("the generation run writes nothing to a terminal", narrated.length === 0));
// There is nothing to pass but a request and nothing to receive but a result: a
// caller who names no channel at all gets the Frames written and a plain value
// back, and still hears nothing.
const framesBefore = apiFolder.status().done;
let result: { done: number; failed: number } = { done: 0, failed: 0 };
const hush = await captureOutput(async () => { result = await run(apiRequest({ count: 1 })); });
results.push(check(
  "a caller that names no channel gets a plain result, the Frame, and no output",
  result.done === 1 && result.failed === 0 && apiFolder.status().done === framesBefore + 1 && hush.length === 0,
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
// its own open module, read in a loop while this process hands out Seeds. They
// ask the module for the status, so what they were told is what is under test,
// not what is on disk.
//
// Three questions per read, counted apart, because they are three different
// failures and the report used to collapse them into one number:
//
//   noNext     the read came back without a usable next Seed.
//   problem    the read came back saying the folder has a problem, and the reader
//              records the code and the message, so a red line can say which one
//              it was told rather than only that it was told something. A read
//              with a problem is also a read with no next Seed — the module
//              reports one without the other — so this count is never the one
//              that decides; it is what says why.
//   backwards  the read came back with a next Seed below one this reader had
//              already seen. This is the third question because it is the one a
//              count of broken reads cannot see: a counter that has reset is a
//              perfectly good integer. Seed 1 would have passed the old check
//              silently, which is the shape of the bug the atomic write exists to
//              prevent (docs/adr/0001), and a guard that cannot see it is not the
//              guard this block was written to be.
//
// Whether a torn counter is real on this platform was measured rather than
// assumed, since that is the half of this that matters. About 200k reads across
// some 200 reader processes have never come back partial, and a direct
// experiment — 90k reads against four thousand replace-renames — found no failed
// read, no partial content and no counter that went backwards. What Windows does
// refuse, 94 times in 100 here, is the *writer's* rename while a reader holds the
// file open, which is what the retry loop in core/output-folder.ts is for; the
// same denial never reached a reader's open in any of that. So the rename is the
// atomicity the module relies on, and the one broken read this block ever
// reported could not be reproduced: the branches above are here so that if it
// ever happens again, the line says which one it was.
//
// The three are asked together and reported as two checks, because there are two
// claims here and they fail for unrelated reasons. The first is what a reader is
// never shown. The second is that the race happened at all: a reader that never
// watched the counter move has not tested anything, and that is a different
// failure from a torn read.
const writerDir = "out-smoke6";
rmSync(writerDir, { recursive: true, force: true });
const writer = openOutputFolder(writerDir, "");
writer.claimSeeds(1); // the counter now exists for the readers to race against
// The two bars a reader reads under, handed in rather than written into the
// reader below so the numbers this block reasons about are spelled once and the
// reader cannot drift from them.
//
// The read floor is not a pass condition — nothing here turns red because a
// reader did too few — it is how a slow machine is given the exposure a fast one
// gets instead of failing for its speed. It used to be exactly that: a bar of a
// hundred reads in the same condition as the broken count, which is the half of
// the old red line that had nothing to do with atomicity. A status call walks the
// folder, so how many a reader manages in three seconds is a fact about the
// machine; how many it is entitled to is a fact about the counter.
const READ_FOR_MS = 3000;
const READS_FLOOR = 100;
// And a backstop, for a reader that has stopped answering altogether: without one
// the loop below would rewrite the counter for as long as it waited for a process
// that is never coming back. The readers closing is what normally ends it.
const GIVE_UP_AFTER_MS = 30000;
// One reader, reporting on itself. It says `ready` on the line before it starts
// reading, so this process knows it is in the race rather than guessing; the
// counts are its own tally of what the module told it, and the two Seed numbers
// are what let it say afterwards that the counter moved under it.
const READER = `const { pathToFileURL } = require("node:url");
 void (async () => {
   const { openOutputFolder } = await import(pathToFileURL(process.argv[1]).href);
   const folder = openOutputFolder(process.argv[2], "");
   const report = { reads: 0, noNext: 0, problem: 0, backwards: 0, first: null, last: null, told: [] };
   const until = Date.now() + Number(process.argv[3]);
   const floor = Number(process.argv[4]);
   const giveUpAt = Date.now() + Number(process.argv[5]);
   process.stdout.write("ready\\n");
   // Both bars have to be met, not either: the window, and enough reads to have
   // seen something. A reader on a slow machine reads on past its window rather
   // than stopping short and being failed for it, which is the whole difference
   // from the read count this replaces.
   while ((Date.now() < until || report.reads < floor) && Date.now() < giveUpAt) {
     report.reads++;
     const s = folder.status();
     const usable = Number.isInteger(s.next) && (s.next ?? 0) >= 1;
     if (!usable) report.noNext++;
     if (s.problem) {
       report.problem++;
       const said = String(s.problemCode) + ": " + s.problem;
       if (report.told.length < 3 && !report.told.includes(said)) report.told.push(said);
     }
     if (usable) {
       if (report.last === null) report.first = s.next;
       else if (s.next < report.last) report.backwards++;
       report.last = s.next;
     }
   }
   process.stdout.write(JSON.stringify(report) + "\\n");
 })();`;
/** What a reader prints: its own tally of what the module told it. */
type ReaderTally = {
  reads: number;
  noNext: number;
  problem: number;
  backwards: number;
  first: number | null;
  last: number | null;
  told: string[];
};
/** That tally, plus the three facts only the reader's own process knows. */
type ReaderReport = ReaderTally & { name: string; exited: number | null; stderr: string };
/** One reader: when it is in the race, and what it has to say afterwards. */
const racingReader = (name: string, dir: string): { ready: Promise<void>; report: Promise<ReaderReport> } => {
  let startReading = () => {};
  const ready = new Promise<void>((resolve) => { startReading = resolve; });
  const report = new Promise<ReaderReport>((resolve) => {
    const reader = execFile(process.execPath, [
      "--import", "tsx", "-e", READER, join(repoRoot, "core/output-folder.ts"), dir,
      String(READ_FOR_MS), String(READS_FLOOR), String(GIVE_UP_AFTER_MS),
    ], { cwd: repoRoot });
    let text = "", stderrText = "", inRace = false;
    reader.stdout?.on("data", (c: Buffer) => {
      text += c.toString();
      if (!inRace && /^ready$/m.test(text)) { inRace = true; startReading(); }
    });
    reader.stderr?.on("data", (c: Buffer) => (stderrText += c.toString()));
    reader.on("close", (code) => {
      // A reader that never said it was ready is one that died on the way in, so
      // it stops waiting for a race it is not in. And a reader that printed no
      // tally has not reported a clean run: it has reported nothing, which is a
      // fact about the reader rather than about the counter. Both are carried as
      // a report, so they land on a check that says so, rather than throwing out
      // of this file with nothing left to read.
      //
      // The zeroed tally is spelled out rather than shared with the reader above,
      // which is the same shape of value written twice: it is a literal in another
      // process's source, and two processes cannot share one declaration.
      const saidNothing: ReaderTally = { reads: 0, noNext: 0, problem: 0, backwards: 0, first: null, last: null, told: [] };
      let tally: ReaderTally | undefined;
      try {
        tally = JSON.parse(text.trim().split("\n").pop() ?? "") as ReaderTally;
      } catch {
        tally = undefined;
      }
      // The name, the exit status and the stderr are added here rather than asked
      // for: they are facts about the reader's process, which is the only thing
      // here that knows them.
      startReading();
      resolve({ name, ...(tally ?? saidNothing), exited: code, stderr: stderrText });
    });
  });
  return { ready, report };
};
// Both readers are asked at once, because the point is that they are racing this
// process and not each other: started one after the other, the second would be
// racing the first and the whole block would be measuring nothing.
const readers = [racingReader("reader 1", writerDir), racingReader("reader 2", writerDir)];
const closed = Promise.all(readers.map((r) => r.report));
// The writing opens when the first reader is in and closes when the last one is
// out, so that every read either reader makes is inside it. Waiting for both
// before the first write is what this used to do, and it is wrong in a way only a
// slow boot shows: each reader's window starts when *it* is ready, so a reader
// that boots late leaves the early one finishing its whole window against a
// counter this process has not touched yet. Before that it was a fixed 2800ms
// from the spawn, which is worse — under load both readers could boot after the
// writer had finished, and the block reported a race that never happened as a red
// line about the counter.
await Promise.race(readers.map((r) => r.ready));
// What the counter read before this process started rewriting it, and what it
// reads after. Both are asked of the module, like everything else here.
const beforeTheRace = writer.status().next;
let finished = 0;
void closed.then(() => { finished = readers.length; });
// One turn of the event loop, which is what lets the readers' exit events in: the
// loop below is synchronous work, and nothing else runs while it is going.
const eventLoopTurn = () => new Promise((resolve) => setImmediate(resolve));
const stopWritingAt = Date.now() + GIVE_UP_AFTER_MS;
while (finished < readers.length && Date.now() < stopWritingAt) {
  writer.issueSeeds(1);
  await eventLoopTurn();
}
const afterTheRace = writer.status().next;
const torn = await closed;
/** Whether a Seed counter was watched to rise: the one shape both halves ask. */
const rose = (before: number | null, after: number | null) =>
  before !== null && after !== null && after > before;
/** One reader, as a line someone can act on: every count, and what it was told. */
const describeReader = (r: ReaderReport) =>
  `${r.name}: reads=${r.reads} noNext=${r.noNext} problem=${r.problem} backwards=${r.backwards} ` +
  `next=${r.first}..${r.last}` +
  (r.told.length ? ` told ${r.told.join(" / ")}` : "") +
  (r.exited ? ` exited=${r.exited}${r.stderr ? ` ${r.stderr.trim().split("\n")[0]}` : ""}` : "");

const wholeCounter = torn.every((r) => r.noNext === 0 && r.problem === 0 && r.backwards === 0);
if (!wholeCounter) torn.forEach((r) => console.log(`      ${describeReader(r)}`));
results.push(check(
  "a reader racing the writer never sees a partial counter or one that has gone backwards",
  wholeCounter,
));

// The check above only says something if the counter really was moving under the
// readers, so that is asked separately, and by fact rather than by count: every
// reader has to have watched it move, and this process has to have moved it.
// Watching the counter move is what a real race implies on its own, and it holds
// however slow the machine is, so a reader that never watched one is reported
// here and not above — a different failure from a torn read, and one this block
// cannot make happen by asking for more of it.
const moved = rose(beforeTheRace, afterTheRace);
const watched = (r: ReaderReport) => r.exited === 0 && rose(r.first, r.last);
const raced = moved && torn.every(watched);
if (!raced) {
  if (!moved) console.log(`      this process moved the counter from ${beforeTheRace} to ${afterTheRace}`);
  torn.filter((r) => !watched(r)).forEach((r) => console.log(`      ${describeReader(r)}`));
}
results.push(check("both readers raced a counter that was really moving", raced));

// And the third question, proved rather than argued. The claim above is that a
// counter which has reset cannot pass for Seed 1, and a reader that has never
// seen one go backwards cannot say whether it would catch one — so this is a
// second and much shorter race, in a folder of its own, where the fixture resets
// the counter on purpose. It is the shape of the bug the atomic write exists to
// prevent, planted so that the counting is known to work, and it is the only
// place in the suite that writes a counter by hand.
const probeDir = "out-smoke7";
rmSync(probeDir, { recursive: true, force: true });
const probeWriter = openOutputFolder(probeDir, "");
probeWriter.claimSeeds(1);
const probe = racingReader("probe reader", probeDir);
await probe.ready;
const climbingUntil = Date.now() + READ_FOR_MS / 2;
while (Date.now() < climbingUntil) probeWriter.issueSeeds(1);
writeFileSync(join(probeDir, "cursor.json"), JSON.stringify({ next: 1, salt: "" }));
const probed = await probe.report;
// One backwards read is the whole claim, and it cannot be vacuous: the reader
// counts one only against a higher Seed it had already been given, so a zero here
// means it never watched the counter rise before the reset rather than that the
// counting is broken.
if (probed.backwards === 0) console.log(`      ${describeReader(probed)}`);
results.push(check(
  "a reader counts a Seed counter that has gone backwards, so a reset one cannot pass for Seed 1",
  probed.backwards > 0,
));
rmSync(probeDir, { recursive: true, force: true });
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
// the existing generator with a fake Buffer result: no key or remote call. The
// store is handed the folder it serves, so this block needs no environment and
// no import ordering: the two lines below could sit in any order.
const promptDir = mkdtempSync(join(tempBase, "portrait-api-prompts-"));
try {
  const store = createStore({ outDir: promptDir, salt: "" });
  const promptFolder = openOutputFolder(promptDir, "");
  promptFolder.issueSeeds(1);
  const withoutNegative = store.getPending(false);
  const withNegative = store.getPending(true);
  results.push(check("API returns finished Prompt text, not parts for the browser",
    Object.keys(withNegative).join() === "items" &&
    withoutNegative.items[0].prompt === promptFolder.promptFor(1) &&
    withNegative.items[0].prompt === promptFolder.promptFor(1, true)));
  results.push(check("API appends the Negative list only when requested",
    !withoutNegative.items[0].prompt.includes("\n\nAvoid:") && withNegative.items[0].prompt.includes("\n\nAvoid:")));
  let sent = "";
  await apiRun({ outDir: promptDir, count: 1, useNegative: true }, async (prompt) => {
    sent = prompt;
    return good();
  });
  results.push(check("free and API routes send the exact same Prompt", sent === withNegative.items[0].prompt));
} finally {
  rmSync(promptDir, { recursive: true, force: true });
}

// Ticket #7: the routes read through the module. Frames arrive as streams, every
// failure arrives as a named code, and one table turns each code into a status.
// The app is pointed at the temporary folder rather than the environment naming
// it, so this block sets nothing up for a later one and restores nothing.
const routeDir = mkdtempSync(join(tempBase, "portrait-routes-"));
// GEMINI_API_KEY is the exception, and not about the dataset: the Job asks
// whether one is set on every start and the status route reports it, and both
// read the process. So it is still cleared here and put back afterwards.
const savedKey = process.env.GEMINI_API_KEY;
try {
  process.env.GEMINI_API_KEY = "";
  const codes = Object.keys(STATUS_BY_CODE) as import("../core/errors").ArchiveErrorCode[];
  const seeded = openOutputFolder(routeDir, "route-salt");
  seeded.issueSeeds(3); // Seeds 1 to 3 are waiting
  await seeded.importFrames([{ name: "one.png", buffer: await good() }], [1]);
  const api = createApp({ outDir: routeDir, salt: "route-salt" }, good);
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
  const request: import("../shared/api-types").GenerateRequest = { count: 1, model: "flash", size: "1K", concurrency: 1, useNegative: false };

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
    (await createApp({ outDir: routeDir, salt: "wrong-salt" }, good)
      .request("/api/prompts/pending")).status === STATUS_BY_CODE["salt-mismatch"]));

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

  // The Job, started through the route, driven by a fake Generator. This is the
  // highest seam in the suite: one request reaches the route, the archive, the
  // Job state the browser polls and the run underneath them, with no API key in
  // use and no network. The key below is only what the refusal check looks for —
  // the Job asks the process whether one is set, and the fake never asks for one.
  const start = (body: unknown) =>
    api.request("/api/generate", { method: "POST", body: JSON.stringify(body) });
  results.push(check("a Job that has not started reports idle", (await jobOf(api)).status === "idle"));
  process.env.GEMINI_API_KEY = "a-key-the-fake-Generator-never-uses";
  // One worker throughout: the log is newest-first, so which Seed arrives last is
  // the order of the work, and with more than one worker that is a race rather
  // than a fact about the Job. Concurrency itself is the run's business and is
  // exercised where a result is what matters, not an order.
  const startedAtOnce = (await (await start({ count: 2, model: "flash", size: "1K", concurrency: 1, useNegative: false })).json()) as JobState;
  results.push(check(
    "starting a Job answers at once, running, with the total the run reported",
    startedAtOnce.status === "running" && startedAtOnce.total === 2 && startedAtOnce.done === 0 &&
      startedAtOnce.failed === 0 && startedAtOnce.model === "gemini-3.1-flash-image" &&
      startedAtOnce.log.length === 0 && typeof startedAtOnce.startedAt === "string",
  ));
  const landed = await settleJob(api);
  const landedFrames = (await (await api.request("/api/images")).json()) as import("../shared/api-types").ImageItem[];
  results.push(check(
    "a finished Job left its Frames in the archive and its per-Seed log newest-first",
    landed.status === "done" && landed.total === 2 && landed.done === 2 && landed.failed === 0 &&
      landed.log.map((entry) => `${entry.seed}:${entry.ok}`).join() === "3:true,2:true" &&
      landedFrames.map((one) => one.seed).join() === "3,2,1" &&
      typeof landed.finishedAt === "string" && landed.error === undefined,
  ));

  // A second app over the same dataset, with a Generator that fails. Two apps
  // over one dataset are legitimate, and each holds its own Job, so this one is
  // polled through its own route: what is under test here is the translation,
  // and a Job is asked about through the app that owns it.
  const failingApi = createApp({ outDir: routeDir, salt: "route-salt" }, bad);
  const startFailing = (body: unknown) =>
    failingApi.request("/api/generate", { method: "POST", body: JSON.stringify(body) });
  await startFailing({ count: 2, model: "flash", size: "1K", concurrency: 1, useNegative: false });
  const faulted = await settleJob(failingApi);
  results.push(check(
    "a Job that fails counts the failures and logs the Seeds that failed, which stay waiting",
    faulted.status === "done" && faulted.total === 2 && faulted.done === 0 && faulted.failed === 2 &&
      faulted.log.map((entry) => `${entry.seed}:${entry.ok}:${entry.message}`).join() ===
        "5:false:fake quota error,4:false:fake quota error" &&
      seeded.waitingSeeds().join() === "4,5" && seeded.status().next === 6,
  ));
  await startFailing({ count: 60, model: "flash", size: "1K", concurrency: 1, useNegative: false });
  const capped = await settleJob(failingApi);
  results.push(check(
    "the per-Seed log keeps the newest fifty entries and lets the rest go",
    // Seeds 4 and 5 are still waiting from the failed Job above, so this run
    // finishes those two first and then takes 58 fresh ones: 6 to 63.
    capped.total === 60 && capped.done === 0 && capped.failed === 60 && capped.log.length === 50 &&
      capped.log[0].seed === 63 && capped.log[49].seed === 14 && seeded.status().next === 64,
  ));

  // The fourth status: a run that cannot start at all. An unreadable counter is
  // refused by the folder, so the run never gets going and the Job says so
  // rather than reporting a Job that quietly did nothing.
  writeFileSync(join(routeDir, "cursor.json"), "{ corrupt");
  await start({ count: 1, model: "flash", size: "1K", concurrency: 1, useNegative: false });
  const broken = await settleJob(api);
  results.push(check(
    "a run that cannot start leaves the Job in error with what went wrong",
    broken.status === "error" && typeof broken.error === "string" && broken.error.includes("counter") &&
      typeof broken.finishedAt === "string",
  ));
} finally {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
  rmSync(routeDir, { recursive: true, force: true });
}

// One policy, two adapters. Both are asked to do the same thing — the command
// line with no flags at all, the Job from a request that repeats the policy —
// and what the Generator was handed is compared value by value.
//
// Nothing here compares the two adapters' imported symbols. Two imports of one
// object are the same object by construction, so that check would still pass
// with only one adapter reading the policy, which is the failure it is here to
// catch. What is compared is what each adapter's own path — argv, the wire
// request, the run, the Generator — actually produced, because that is the
// only place a second policy could come from.
//
// The values the Generator is handed, plus the two the policy fixes that it is
// not handed: the Negative list shows up in the Prompt, and the pool size in
// how many calls were in flight at once.
const policySpy = () => {
  const seen: { prompt: string; opts: GenOptions }[] = [];
  const calls = { inFlight: 0, most: 0 };
  const generate: Generator = async (prompt, opts) => {
    seen.push({ prompt, opts });
    calls.inFlight++;
    calls.most = Math.max(calls.most, calls.inFlight);
    // The pause is what makes the pool size observable at all: every worker
    // reaches the Generator before any of them comes back, so the number of
    // calls in flight is the number of workers rather than a race.
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls.inFlight--;
    return good();
  };
  return { seen, calls, generate };
};
const asRun = (spy: ReturnType<typeof policySpy>) => ({
  ...spy.seen[0].opts,
  negative: spy.seen[0].prompt.includes("\n\nAvoid:"),
  pool: spy.calls.most,
  seeds: spy.seen.length,
});
const genOptions: (keyof GenOptions)[] = ["model", "aspectRatio", "imageSize"];
const policyBase = mkdtempSync(join(tempBase, "portrait-policy-"));
writeFileSync(join(policyBase, "template.txt"), "# policy-v1\nPortrait of {age}.");
writeFileSync(join(policyBase, "negative.txt"), "policy exclusions");
const policySalt = process.env.SEED_SALT;
const policyKey = process.env.GEMINI_API_KEY;
try {
  delete process.env.SEED_SALT;
  process.env.GEMINI_API_KEY = "a-key-the-fake-Generator-never-uses";
  // The Prompt files are read from the working directory, so the command line
  // runs from a folder of its own: with no flags it writes to `out`, and this
  // is its real no-flag path rather than a fixture standing in for one.
  process.chdir(policyBase);

  const cliSpy = policySpy();
  const cliLines = await captureOutput(() => generateImages(parseArgs([]), cliSpy.generate));
  const cliRun = asRun(cliSpy);

  // The wire request names a model key rather than a vendor name, so it can
  // only repeat the policy by looking the key up. And it carries no aspect
  // ratio at all, which is what leaves that one value to the Job's policy.
  const modelKey = (Object.keys(MODELS) as GenerateRequest["model"][]).find(
    (key) => MODELS[key] === policy.model,
  );
  if (modelKey === undefined)
    throw new Error(`the policy names a model a request cannot ask for: ${policy.model}`);
  const repeating: GenerateRequest = {
    count: policy.count,
    model: modelKey,
    size: policy.imageSize as GenerateRequest["size"],
    concurrency: policy.concurrency,
    useNegative: policy.useNegative,
  };
  const jobSpy = policySpy();
  const jobApp = createApp({ outDir: join(policyBase, "job-archive"), salt: "" }, jobSpy.generate);
  await jobApp.request("/api/generate", { method: "POST", body: JSON.stringify(repeating) });
  const jobState = await settleJob(jobApp);
  const jobRun = asRun(jobSpy);

  results.push(check(
    "the two adapters start from one policy: what the Generator was told is the same either way",
    // Both runs were told the same thing, and it was the policy. If either
    // adapter carried one of its own, the first clause is where they part.
    genOptions.every((k) => cliRun[k] === jobRun[k] && cliRun[k] === policy[k]) &&
      cliRun.negative === jobRun.negative && cliRun.negative === policy.useNegative &&
      cliRun.pool === jobRun.pool && cliRun.pool === policy.concurrency &&
      cliRun.seeds === jobRun.seeds && cliRun.seeds === policy.count &&
      // The command line's own line says which model and how many Seeds it ran,
      // and the Job's own state says the same, so both are checked where their
      // callers see them and not only where the vendor is told.
      cliLines[0].includes(`| ${policy.model} | ${policy.count} to generate, `) &&
      jobState.status === "done" && jobState.total === policy.count && jobState.done === policy.count &&
      jobState.model === policy.model,
  ));

  const allFlags = parseArgs([
    "--start", "5", "--count", "3", "--concurrency", "7", "--model", "lite", "--aspect", "3:4",
    "--size", "2K", "--out", "somewhere-else", "--no-negative", "--dry-run",
  ]);
  const oneFlag = parseArgs(["--count", "3"]);
  results.push(check(
    "each command-line flag overrides the one value it names and leaves the rest on the policy",
    allFlags.start === 5 && allFlags.count === 3 && allFlags.concurrency === 7 &&
      allFlags.model === MODELS.lite && allFlags.aspectRatio === "3:4" && allFlags.imageSize === "2K" &&
      allFlags.outDir === "somewhere-else" && allFlags.useNegative === false && allFlags.dryRun === true &&
      // One flag on its own, which is the case that matters: everything it does
      // not name is still the policy's, because the command line starts from
      // the policy rather than from a copy of it. The two values it does own
      // are its own — where the dataset lives, and whether to look before
      // spending — and neither is generation policy.
      genOptions.every((k) => oneFlag[k] === policy[k]) && oneFlag.count === 3 &&
      oneFlag.outDir === "out" && oneFlag.dryRun === false && oneFlag.start === undefined,
  ));

  const overSpy = policySpy();
  const overApp = createApp({ outDir: join(policyBase, "override-archive"), salt: "" }, overSpy.generate);
  await overApp.request("/api/generate", {
    method: "POST",
    body: JSON.stringify({ count: 2, model: "pro", size: "2K", concurrency: 1, useNegative: false }),
  });
  const overState = await settleJob(overApp);
  results.push(check(
    "the Job lets the request override what it names and takes the policy for what it cannot",
    overState.status === "done" && overState.total === 2 && overState.model === MODELS.pro &&
      overSpy.seen.length === 2 && overSpy.calls.most === 1 &&
      overSpy.seen[0].opts.model === MODELS.pro && overSpy.seen[0].opts.imageSize === "2K" &&
      !overSpy.seen[0].prompt.includes("\n\nAvoid:") &&
      // The aspect ratio is the one value a request has no way to name, so it
      // is the one value here that can only have come from the policy.
      overSpy.seen[0].opts.aspectRatio === policy.aspectRatio,
  ));
} finally {
  process.chdir(repoRoot);
  if (policySalt === undefined) delete process.env.SEED_SALT;
  else process.env.SEED_SALT = policySalt;
  if (policyKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = policyKey;
  rmSync(policyBase, { recursive: true, force: true });
}

// Two apps in one process, each pointed at its own dataset. That is what the
// injected pair buys: the routes never ask the environment where the folder is,
// so no app can be answered out of another's Seed counter, Frames or Prompt
// version. The Prompt files are read when a folder is opened and are named
// relative to the working directory, so each app is built under its own — if the
// archive were remembered per module instead of per app, the first app's second
// request would reopen its folder under the second app's Prompt files and answer
// with the wrong Prompt version.
const pairBase = mkdtempSync(join(tempBase, "portrait-pair-"));
const alphaDir = join(pairBase, "alpha-archive");
const betaDir = join(pairBase, "beta-archive");
for (const [dir, version, noun] of [
  [join(pairBase, "alpha-prompt-files"), "alpha-v1", "Alpha"],
  [join(pairBase, "beta-prompt-files"), "beta-v1", "Beta"],
] as const) {
  mkdirSync(dir);
  writeFileSync(join(dir, "template.txt"), `# ${version}\n${noun} portrait of {age}.`);
  writeFileSync(join(dir, "negative.txt"), `${noun} exclusions`);
}
const statusOf = async (api: ReturnType<typeof createApp>) =>
  (await (await api.request("/api/status")).json()) as import("../shared/api-types").Status;
const framesOf = async (api: ReturnType<typeof createApp>) =>
  (await (await api.request("/api/images")).json()) as import("../shared/api-types").ImageItem[];

// The Jobs these two apps hold are independent too, and that cannot be shown by
// looking inside anything: it is asked of each app through its own polling route
// while the other's Job is running.
//
// The Generator is held rather than immediate, because the claim is about two
// Jobs at one moment. Starting a Job answers `running` before the run has
// finished — the route does not await the run, which is exactly what lets the
// browser poll it — but a Generator that resolves at once lets the Job finish in
// a later tick, so "the other app is idle" would be a race against a background
// promise this check cannot see. This one waits for the checks below to open the
// gate, and opens the gate itself a few seconds in so that a failing assertion
// cannot leave the suite waiting on a promise that will never land.
const gate = { open: false };
const attempted = { calls: 0 };
const held: Generator = async () => {
  attempted.calls++;
  for (let waited = 0; !gate.open && waited < 5000; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return good();
};
// A Job asks the process whether an API key is set on every start, and nothing
// else does; the fake Generator never uses one. Put back below.
const savedJobKey = process.env.GEMINI_API_KEY;
try {
  // Fixture setup asks the module directly; every assertion below is an HTTP
  // response from an app.
  process.chdir(join(pairBase, "alpha-prompt-files"));
  const alpha = createApp({ outDir: alphaDir, salt: "alpha" }, good);
  const alphaFolder = openOutputFolder(alphaDir, "alpha");
  alphaFolder.issueSeeds(2);
  await alphaFolder.importFrames([{ name: "alpha.png", buffer: await good() }], [1]);
  const alphaBefore = await statusOf(alpha);
  results.push(check(
    "an app pointed at a dataset answers for that dataset",
    alphaBefore.version === "alpha-v1" && alphaBefore.next === 3 && alphaBefore.waiting === 1 &&
    alphaBefore.done === 1 && alphaBefore.saltSet && alphaBefore.problem === undefined,
  ));

  // The second app gets a different root, a different Seed salt and different
  // Prompt files. Nothing about the first app may move.
  process.chdir(join(pairBase, "beta-prompt-files"));
  const beta = createApp({ outDir: betaDir, salt: "" }, good);
  openOutputFolder(betaDir, "").issueSeeds(1); // Seed 1 waiting, no Frame
  // The second app is asked first, on purpose: if the archive were one per
  // process, answering the beta app would be what moved the alpha app, and the
  // alpha status below would come back rebuilt under beta's Prompt files.
  const betaStatus = await statusOf(beta);
  const alphaAfter = await statusOf(alpha);
  results.push(check(
    "two apps keep their own Seed counter, Seed salt and Prompt version",
    alphaAfter.version === "alpha-v1" && alphaAfter.next === 3 && alphaAfter.waiting === 1 &&
    alphaAfter.done === 1 && alphaAfter.saltSet &&
    betaStatus.version === "beta-v1" && betaStatus.next === 2 && betaStatus.waiting === 1 &&
    betaStatus.done === 0 && !betaStatus.saltSet,
  ));
  const [alphaFrames, betaFrames] = await Promise.all([framesOf(alpha), framesOf(beta)]);
  results.push(check(
    "two apps do not see each other's Frames",
    alphaFrames.length === 1 && alphaFrames[0].seed === 1 && alphaFrames[0].version === "alpha-v1" &&
    betaFrames.length === 0,
  ));

  // Two more apps over the same two datasets, one each, both driven by the held
  // Generator, so that a Job can be started against one while the other is
  // running. The alpha and beta apps above are the control: alpha shares a
  // dataset with the first of these two and beta with the second, and neither
  // is ever given a Job at all.
  const alphaJob = createApp({ outDir: alphaDir, salt: "alpha" }, held);
  const betaJob = createApp({ outDir: betaDir, salt: "" }, held);
  const startOn = (app: ReturnType<typeof createApp>) =>
    app.request("/api/generate", {
      method: "POST",
      body: JSON.stringify({ count: 1, model: "flash", size: "1K", concurrency: 1, useNegative: false }),
    });
  process.env.GEMINI_API_KEY = "a-key-the-fake-Generator-never-uses";
  const answeredAtOnce = await startOn(alphaJob);
  const alphaStarted = await jobOf(alphaJob);
  results.push(check(
    "a Job started on one app leaves every other app's Job idle",
    answeredAtOnce.status === 200 &&
      ((await answeredAtOnce.json()) as JobState).status === "running" &&
      alphaStarted.status === "running" && alphaStarted.total === 1 && alphaStarted.done === 0 &&
      (await jobOf(betaJob)).status === "idle" &&
      (await jobOf(alpha)).status === "idle" && (await jobOf(beta)).status === "idle",
  ));
  // That the Job above is observably still running is not left to the timing of
  // a background promise: the gate is shut, so the run cannot have finished, and
  // the Generator having been asked for a Frame is proof that it got going rather
  // than sitting queued. Without this the check would also pass against a Job
  // that was merely slow, and would stop passing against one that was never
  // running at all.
  results.push(check(
    "the Job above is running and holding on its Generator, not merely unfinished",
    gate.open === false && attempted.calls === 1 && alphaStarted.status === "running" &&
      alphaStarted.log.length === 0 && openOutputFolder(alphaDir, "alpha").hasFrame(2) === false,
  ));
  // The refusal belongs to the Job that refuses, so it is asked of two apps in
  // the same breath: a second start where one is running, and the same start on
  // the app that has none.
  const secondOnAlpha = await startOn(alphaJob);
  const firstOnBeta = await startOn(betaJob);
  results.push(check(
    "a running Job refuses a second start on its own app and on no other",
    secondOnAlpha.status === 409 &&
      ((await secondOnAlpha.json()) as { error: string }).error === "A job is already running" &&
      firstOnBeta.status === 200 &&
      ((await firstOnBeta.json()) as JobState).status === "running" &&
      (await jobOf(alphaJob)).status === "running" && (await jobOf(betaJob)).status === "running",
  ));
  // Both Jobs finish on their own datasets: alpha's waiting Seed 2, beta's 1.
  gate.open = true;
  const [alphaLanded, betaLanded] = await Promise.all([settleJob(alphaJob), settleJob(betaJob)]);
  results.push(check(
    "each app's polling route reports its own Job and only its own",
    alphaLanded.status === "done" && alphaLanded.total === 1 && alphaLanded.done === 1 &&
      alphaLanded.log.map((entry) => `${entry.seed}:${entry.ok}`).join() === "2:true" &&
      betaLanded.status === "done" && betaLanded.total === 1 && betaLanded.done === 1 &&
      betaLanded.log.map((entry) => `${entry.seed}:${entry.ok}`).join() === "1:true" &&
      // The apps that were never given a Job still report idle, one over a
      // dataset that now holds a second Frame and one over a dataset that never
      // held any.
      (await jobOf(alpha)).status === "idle" && (await jobOf(beta)).status === "idle" &&
      (await framesOf(alpha)).map((frame) => frame.seed).join() === "2,1" &&
      (await framesOf(beta)).map((frame) => frame.seed).join() === "1",
  ));
} finally {
  process.chdir(repoRoot);
  gate.open = true;
  if (savedJobKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedJobKey;
  rmSync(pairBase, { recursive: true, force: true });
}

for (const d of [out, out2, inDir, "out-smoke3"]) rmSync(d, { recursive: true, force: true });

// The CLI byte-contract, in its own file: each command's own output,
// byte for byte, cross-checked against what the module says about the folder.
await runCliContract();

const pass = results.every(Boolean);
console.log(pass ? "\nsmoke test passed" : "\nsmoke test FAILED");
process.exit(pass ? 0 : 1);
