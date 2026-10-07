// Runs the pipeline with fake generators. No API key or network needed.
import { mkdirSync, readdirSync, readFileSync, rmSync, utimesSync } from "node:fs";
import sharp from "sharp";
import { claimSeeds, loadTemplate, readCursor } from "./common";
import { defaults, run } from "./generate";
import { importImages } from "./import-images";
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
await run({ ...defaults, count: 4, outDir: out }, good);
results.push(check("first run makes seeds 1 to 4, counter at 5", readCursor(out) === 5));
await run({ ...defaults, count: 2, outDir: out }, good);
results.push(check("second run continues at 5 and 6", readdirSync(out).includes("00006.png") && readCursor(out) === 7));
await run({ ...defaults, count: 2, outDir: out }, bad);
results.push(check("failed run uses 7 and 8, no images", !readdirSync(out).includes("00007.png") && readCursor(out) === 9));
await run({ ...defaults, count: 2, outDir: out }, good);
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
await run({ ...defaults, count: 3, outDir: out, dryRun: true }, good);
results.push(check("dry run leaves counter alone", readCursor(out) === 9));

// Manual path with the counter
const out2 = "out-smoke2";
rmSync(out2, { recursive: true, force: true });
claimSeeds(out2, 3); // what the prompts command does
mkdirSync(inDir);
for (const [i, name] of ["b.png", "a.png"].entries()) {
  const p = `${inDir}/${name}`;
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#a67a7a" } }).png().toFile(p);
  utimesSync(p, new Date(2026, 0, 1, 0, i), new Date(2026, 0, 1, 0, i)); // b is oldest
}
await importImages({ inDir, outDir: out2, width: 768, height: 1152, dryRun: false });
const rows = readFileSync(`${out2}/manifest.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
results.push(check("import fills seeds 1 and 2 by download time", rows[0].seed === 1 && rows[0].file === "b.png" && rows[1].seed === 2));
results.push(check("seed 3 still waiting", claimSeeds(out2, 2, false).join() === "3,4"));
let threw = false;
try {
  await importImages({ inDir, outDir: "out-smoke3", width: 768, height: 1152, dryRun: false });
} catch {
  threw = true;
}
results.push(check("import refuses images with no waiting seeds", threw));


// Salt
const { template } = loadTemplate();
delete process.env.SEED_SALT;
results.push(check("same seed and salt give the same prompt", buildPrompt(template, 5, "a") === buildPrompt(template, 5, "a")));
results.push(check("different salts give different prompts", buildPrompt(template, 5, "a") !== buildPrompt(template, 5, "b")));
const salted = Array.from({ length: 50 }, (_, i) => i + 1).filter((n) => buildPrompt(template, n, "x") !== buildPrompt(template, n, "")).length;
results.push(check("salt changes almost every seed", salted >= 48));
results.push(check("no salt matches the plain seed", buildPrompt(template, 9) === buildPrompt(template, 9, "")));
const guardDir = "out-smoke4";
rmSync(guardDir, { recursive: true, force: true });
claimSeeds(guardDir, 2); // started with no salt
process.env.SEED_SALT = "changed";
let guarded = false;
try {
  claimSeeds(guardDir, 2);
} catch {
  guarded = true;
}
delete process.env.SEED_SALT;
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

for (const d of [out, out2, inDir, "out-smoke3"]) rmSync(d, { recursive: true, force: true });
const pass = results.every(Boolean);
console.log(pass ? "\nsmoke test passed" : "\nsmoke test FAILED");
process.exit(pass ? 0 : 1);
