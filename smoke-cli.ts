// The CLI byte-contract, in its own file because it changes for its own
// reason: the four entry points' own output, byte for byte. These checks
// compare each command's own output with what it printed before the
// migration, and cross-check it against what the module says about the folder.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { defaults, run } from "./generate";
import { importImages } from "./import-images";
import { openOutputFolder } from "./output-folder";
import { asyncCode, bad, check, good, promptFiles, repoRoot, results, streamBytes } from "./smoke-harness";

export async function runCliContract(): Promise<void> {
  const cliVersion = promptFiles().version;
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
  const spawnCli = (script: string, args: string[], env: Record<string, string> = {}) =>
    new Promise<{ code: number; output: string; error: string }>((resolve) => {
      let text = "";
      let errText = "";
      const child = execFile(process.execPath, ["--import", "tsx", script, ...args], {
        cwd: repoRoot,
        env: { ...process.env, SEED_SALT: "", GEMINI_API_KEY: "", ...env },
      });
      child.stdout?.on("data", (c: Buffer) => (text += c.toString()));
      child.stderr?.on("data", (c: Buffer) => (errText += c.toString()));
      child.on("close", (code) => resolve({ code: code ?? 0, output: text, error: errText }));
    });

  // A fixture archive: two Frames, one failed Attempt, four Waiting Seeds.
  const cliOut = "out-smoke7";
  rmSync(cliOut, { recursive: true, force: true });
  const cliFolder = openOutputFolder(cliOut, "");
  cliFolder.issueSeeds(6);
  await cliFolder.writeFrame({ seed: 1, buffer: await good(), model: "fixture-model", prompt: cliFolder.promptFor(1, true) });
  await cliFolder.writeFrame({ seed: 2, buffer: await good(), model: "fixture-model", prompt: cliFolder.promptFor(2, true) });
  cliFolder.recordAttempt({ seed: 3, status: "failed", error: "fixture failure" });

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
    importImages({ inDir: impIn, outDir: impOut, dryRun: false, salt: "" }),
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
      // The Attempt is on the record: every Frame knows its Prompt version and text,
      // and nothing is counted as a failure.
      impFolder.status().failed === 0 &&
      impFolder.listFrames().every((f) => f.version === impFolder.status().version && f.prompt.length > 0),
  ));

  // import with nothing waiting is refused with the same words.
  const shortOut = "out-smoke10";
  rmSync(shortOut, { recursive: true, force: true });
  openOutputFolder(shortOut, "").issueSeeds(1);
  let refusal = "no error";
  await captureCli(async () => {
    try {
      await importImages({ inDir: impIn, outDir: shortOut, dryRun: false, salt: "" });
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
    importImages({ inDir: impIn, outDir: dryOut, dryRun: true, salt: "" }),
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

  // A salt mismatch is a report about the environment, not an unreadable
  // folder: the command says what is wrong and leaves the exit code alone.
  // An unreadable counter is the one problem that still stops it.
  const saltDir = "out-smoke12";
  rmSync(saltDir, { recursive: true, force: true });
  openOutputFolder(saltDir, "the-salt-it-started-with").claimSeeds(1);
  const mismatched = await spawnCli("status.ts", [saltDir], { SEED_SALT: "a-different-salt" });
  results.push(check(
    "a salt mismatch makes status print the problem and exit 0",
    mismatched.code === 0 && mismatched.error.includes("SEED_SALT does not match"),
  ));
  rmSync(saltDir, { recursive: true, force: true });

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
}
