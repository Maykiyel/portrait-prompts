// The CLI byte-contract, in its own file because it changes for its own
// reason: the four entry points' own output, byte for byte. These checks
// compare each command's own output with what it printed before the
// migration, and cross-check it against what the module says about the folder.
// The generate checks wrap the command line's adapter, not the run underneath
// it: the contract being defended is still what a person sees on a terminal,
// and the run has no terminal left to be seen on.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { generateImages } from "../cli/generate";
import { importImages } from "../cli/import-images";
import { openOutputFolder } from "../core/output-folder";
import { policyFor } from "../core/policy";
const policy = policyFor(providers);
import { providers } from "../core/providers";
import { asyncCode, bad, captureOutput, check, good, promptFiles, repoRoot, results, streamBytes, withGenerators } from "./smoke-harness";

export async function runCliContract(): Promise<void> {
  const cliVersion = promptFiles().version;
  // A command run as a real process, so its argv parsing and exit code are exercised.
  // `preloads` are loaded into the child ahead of the command itself, which is how
  // the tripwire in `test/no-network.ts` gets in without the command knowing.
  const spawnCli = (
    script: string, args: string[], env: Record<string, string> = {}, preloads: string[] = [],
  ) =>
    new Promise<{ code: number; output: string; error: string }>((resolve) => {
      let text = "";
      let errText = "";
      const child = execFile(
        process.execPath,
        ["--import", "tsx", ...preloads.flatMap((p) => ["--import", p]), script, ...args],
        { cwd: repoRoot, env: { ...process.env, SEED_SALT: "", GEMINI_API_KEY: "", OPENAI_API_KEY: "", ...env } },
      );
      child.stdout?.on("data", (c: Buffer) => (text += c.toString()));
      child.stderr?.on("data", (c: Buffer) => (errText += c.toString()));
      child.on("close", (code) => resolve({ code: code ?? 0, output: text, error: errText }));
    });
  // A file:// URL, because `--import` will not take a bare Windows path.
  const noNetwork = pathToFileURL(join(repoRoot, "test", "no-network.ts")).href;

  // A fixture archive: two Frames, one failed Attempt, four Waiting Seeds.
  const cliOut = "out-smoke7";
  rmSync(cliOut, { recursive: true, force: true });
  const cliFolder = openOutputFolder(cliOut, "");
  cliFolder.issueSeeds(6);
  await cliFolder.writeFrame({ seed: 1, buffer: await good(), model: "fixture-model", prompt: cliFolder.promptFor(1, true) });
  await cliFolder.writeFrame({ seed: 2, buffer: await good(), model: "fixture-model", prompt: cliFolder.promptFor(2, true) });
  cliFolder.recordAttempt({ seed: 3, status: "failed", error: "fixture failure" });

  // status: the same lines, and the same failed count as the module.
  const statusOut = await spawnCli("cli/status.ts", [cliOut]);
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
  const promptsRun = await spawnCli("cli/export-prompts.ts", [
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
  const imported = await captureOutput(() =>
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
  await captureOutput(async () => {
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
  const dryRun = await captureOutput(() =>
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
  // The model in the header is now the core's policy rather than a copy beside
  // the command line, so this still compares against the model the bytes were
  // first captured with, and still fails if either moves away from it.
  const runOut = "out-smoke11";
  rmSync(runOut, { recursive: true, force: true });
  // One worker, so the order of these lines is fixed rather than a race.
  const failLines = await captureOutput(() =>
    generateImages({ ...policy, count: 3, concurrency: 1, outDir: runOut, dryRun: false, salt: "" }, withGenerators({ gemini: bad })));
  const runFolder = openOutputFolder(runOut, "");
  results.push(check(
    "a failing run prints the same lines and leaves every Seed waiting",
    failLines.join("\n") === [
      `${cliVersion} | ${policy.model} | 3 to generate, 0 already done | seeds 1 to 3`,
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
  const retryLines = await captureOutput(() =>
    generateImages({ ...policy, count: 2, concurrency: 1, outDir: runOut, dryRun: false, salt: "" }, withGenerators({ gemini: good })));
  results.push(check(
    "the next run finishes Waiting Seeds first and does not advance the counter",
    retryLines.join("\n") === [
      `${cliVersion} | ${policy.model} | 2 to generate, 0 already done | seeds 1 to 2`,
      "[1] ok (1/2)",
      "[2] ok (2/2)",
      `\nDone. 2 ok, 0 failed. Output in ${runOut}/`,
    ].join("\n") &&
      runFolder.waitingSeeds().join() === "3" && runFolder.status().next === 4 &&
      runFolder.status().done === 2 && runFolder.status().failed === 1,
  ));
  const dryRunLines = await captureOutput(() =>
    generateImages({ ...policy, count: 2, outDir: runOut, dryRun: true, salt: "" }, withGenerators({ gemini: good })),
  );
  results.push(check(
    "a dry run prints the Prompt, moves no counter and writes no Frame",
    dryRunLines.length === 3 && dryRunLines[1] === `\n[3] ${runFolder.promptFor(3, true)}` &&
      dryRunLines[2] === `\n[4] ${runFolder.promptFor(4, true)}` &&
      dryRunLines[0].endsWith("| seeds 3 to 4") &&
      runFolder.status().next === 4 && runFolder.status().done === 2 && !runFolder.hasFrame(3),
  ));

  // The generate entry point as a real process, which is the only way its argv
  // parsing and its exit code can be reached: in-process, both are the caller's
  // own decision rather than the command's. The dry run first, because it can
  // be spawned with nothing but a folder: it parses every flag before a single
  // Frame is asked for, and it has no failure to report.
  const spawnOut = "out-smoke13";
  rmSync(spawnOut, { recursive: true, force: true });
  const spawnFolder = openOutputFolder(spawnOut, "");
  const spawned = await spawnCli("cli/generate.ts", [
    "--count", "2", "--model", "lite", "--out", spawnOut, "--dry-run",
  ]);
  results.push(check(
    "the generate command parses its flags and prints the same lines as a process",
    // `lite` is the short key, so the header carries the model id it resolved to
    // rather than the word that was typed, and `--count 2` is the whole range.
    spawned.output === [
      `${cliVersion} | gemini-3.1-flash-lite-image | 2 to generate, 0 already done | seeds 1 to 2`,
      `\n[1] ${spawnFolder.promptFor(1, true)}`,
      `\n[2] ${spawnFolder.promptFor(2, true)}`,
      "",
    ].join("\n"),
  ));
  results.push(check(
    "a spawned dry run exits 0 and writes nothing to the folder it was pointed at",
    spawned.code === 0 &&
      // A dry run claims Seeds without committing them, so the folder the
      // `--out` flag named is not even created and no counter has moved.
      !existsSync(spawnOut) &&
      spawnFolder.status().next === 1 && spawnFolder.status().done === 0,
  ));
  rmSync(spawnOut, { recursive: true, force: true });

  // And then the half of the exit code a dry run cannot reach: a real run that
  // fails. This is the exit code that says a run went wrong, as against the ones
  // that report a problem with the folder the run was pointed at.
  //
  // The suite has no API key and no network, which reads like it rules this out
  // and does not. `core/gemini.ts` checks for the key before it constructs a
  // client at all, so with no key a real run fails every Seed the same
  // deterministic way, records the failed Attempts and comes back with failures
  // in it — having never asked the network for anything. `test/no-network.ts` is
  // preloaded into the child to make that last clause an observation rather than
  // a claim: every socket, DNS lookup, TLS handshake and fetch is turned into a
  // named failure, and the check below fails if the child's stderr carries one.
  const failOut = "out-smoke14";
  rmSync(failOut, { recursive: true, force: true });
  const failFolder = openOutputFolder(failOut, "");
  try {
    const noKey = await spawnCli(
      "cli/generate.ts",
      ["--count", "2", "--concurrency", "1", "--out", failOut],
      {},
      [noNetwork],
    );
    results.push(check(
      "a spawned run that fails exits 1, with the summary on stdout and the failures on stderr",
      noKey.code === 1 &&
        // No `--model`, so the header carries the model id the core's policy
        // names rather than a key a flag would have resolved: the argv half of
        // this check as much as the exit code half is.
        noKey.output === [
          `${cliVersion} | ${policy.model} | 2 to generate, 0 already done | seeds 1 to 2`,
          "",
          `Done. 0 ok, 2 failed. Output in ${failOut}/`,
          "Failed seeds stay pending and run first next time.",
          "",
        ].join("\n") &&
        // The failures go to stderr, as they did before the seam, and the reason
        // is the one the vendor client gives without a key — which is also the
        // reason no request was made.
        noKey.error === [
          "[1] failed: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
          "[2] failed: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
          "",
        ].join("\n") &&
        !noKey.error.includes("the smoke suite must not use the network"),
    ));
    // The same contract for the second Provider, byte for byte apart from the
    // name of its key. It cannot be asserted in process, because every test here
    // passes a fake Generator that never reads a key: only a spawned command
    // reaches the real client, and only the real client has a key message.
    const openAiOut = "out-smoke15";
    rmSync(openAiOut, { recursive: true, force: true });
    const openAiFolder = openOutputFolder(openAiOut, "");
    const openAiNoKey = await spawnCli(
      "cli/generate.ts",
      ["--provider", "openai", "--model", "flare", "--count", "2", "--concurrency", "1", "--out", openAiOut],
      {},
      [noNetwork],
    );
    results.push(check(
      "a Provider with no key of its own fails the same way, and says which key",
      openAiNoKey.code === 1 &&
        // The header carries the model the flag named, resolved through that
        // Provider's catalog rather than Gemini's.
        openAiNoKey.output === [
          `${cliVersion} | ${providers.openai.models.find((m) => m.id === "flare")?.model} | 2 to generate, 0 already done | seeds 1 to 2`,
          "",
          `Done. 0 ok, 2 failed. Output in ${openAiOut}/`,
          "Failed seeds stay pending and run first next time.",
          "",
        ].join("\n") &&
        openAiNoKey.error === [
          "[1] failed: OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.",
          "[2] failed: OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.",
          "",
        ].join("\n") &&
        // The Gemini key being set in the environment would not help here: the
        // Provider asks for its own, and the child's environment has neither.
        !openAiNoKey.error.includes("GEMINI_API_KEY") &&
        !openAiNoKey.error.includes("the smoke suite must not use the network"),
    ));
    results.push(check(
      "both no-key runs left every Seed waiting, so neither spent a Seed to find out",
      openAiFolder.waitingSeeds().join() === "1,2" && openAiFolder.status().failed === 2,
    ));
    rmSync(openAiOut, { recursive: true, force: true });

    results.push(check(
      "the non-zero exit is the run's own verdict: every Seed stays waiting and every failure is recorded",
      // Nothing was thrown out of the command: the run caught each failure,
      // counted it, and reported it, so the archive says what the exit code says
      // and the next run starts from exactly these Seeds.
      failFolder.waitingSeeds().join() === "1,2" && failFolder.status().failed === 2 &&
        failFolder.status().done === 0 && failFolder.status().next === 3 &&
        failFolder.listFrames().length === 0,
    ));
  } finally {
    // The scratch goes even if a check above threw, so a failed run cannot leave
    // a folder behind for the next one to find.
    rmSync(failOut, { recursive: true, force: true });
  }
  // A salt mismatch is a report about the environment, not an unreadable
  // folder: the command says what is wrong and leaves the exit code alone.
  // An unreadable counter is the one problem that still stops it.
  const saltDir = "out-smoke12";
  rmSync(saltDir, { recursive: true, force: true });
  openOutputFolder(saltDir, "the-salt-it-started-with").claimSeeds(1);
  const mismatched = await spawnCli("cli/status.ts", [saltDir], { SEED_SALT: "a-different-salt" });
  results.push(check(
    "a salt mismatch makes status print the problem and exit 0",
    mismatched.code === 0 && mismatched.error.includes("SEED_SALT does not match"),
  ));
  rmSync(saltDir, { recursive: true, force: true });

  // An unreadable counter is still refused by every command.
  writeFileSync(join(cliOut, "cursor.json"), "{ corrupt");
  results.push(check(
    "the status command still refuses an unreadable counter",
    (await spawnCli("cli/status.ts", [cliOut])).code === 1,
  ));
  results.push(check(
    "the run still refuses an unreadable counter instead of starting again",
    await asyncCode(() =>
      generateImages({ ...policy, count: 1, outDir: cliOut, dryRun: true, salt: "" }, withGenerators({ gemini: good }))) ===
      "unreadable-counter",
  ));

  for (const d of [cliOut, impOut, impIn, dryOut, shortOut, runOut]) rmSync(d, { recursive: true, force: true });
  rmSync(promptsFile, { force: true });
}
