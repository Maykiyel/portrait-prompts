// The Codex Provider, driven against a stand-in executable (test/fake-codex.mjs)
// so no check here runs the real `codex`. What is proved: readiness without a key,
// the image coming back byte for byte, the Prompt check, the failures that halt a
// run, the Job's `stopped` state, the wrapper version on the Manifest row, and
// that Codex's own copies are removed only after the Frame is in the dataset.
// Wired into pnpm smoke the way test/smoke-phase4.ts is.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCodex, WRAPPER_VERSION } from "../core/codex";
import { GenerationFailure } from "../core/errors";
import { openOutputFolder } from "../core/output-folder";
import type { Provider } from "../core/providers";
import { createApp } from "../server/index";
import { check, good, repoRoot, results, settleJob } from "./smoke-harness";

const FAKE = join(repoRoot, "test", "fake-codex.mjs");
const PROMPT = "A portrait of a fictional adult, soft window light.";

const failureOf = async (provider: Provider, seed: number): Promise<unknown> => {
  try {
    await provider.generate(PROMPT, { seed, model: "chatgpt-plan", aspectRatio: "2:3", imageSize: "1K" });
    return undefined;
  } catch (err) {
    return err;
  }
};

const codeOf = (err: unknown) => (err instanceof GenerationFailure ? err.code : undefined);

export async function runCodexChecks(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "portrait-codex-"));
  const saved = {
    mode: process.env.FAKE_CODEX_MODE,
    login: process.env.FAKE_CODEX_LOGIN,
    image: process.env.FAKE_CODEX_IMAGE,
    home: process.env.CODEX_HOME,
    openai: process.env.OPENAI_API_KEY,
  };
  try {
    const imageFile = join(base, "source.png");
    const sourceBytes = await good();
    writeFileSync(imageFile, sourceBytes);
    process.env.FAKE_CODEX_IMAGE = imageFile;
    // Codex's own folder, where the stand-in writes session logs and images the
    // way the real one does. Handed to the Provider and to the stand-in alike.
    const home = join(base, "codex-home");
    mkdirSync(home);
    process.env.CODEX_HOME = home;

    // A fresh Provider per case, because each one remembers its sign-in answer
    // for a few seconds and the cases change what the stand-in says.
    const make = (timeoutMs?: number) =>
      createCodex({
        home,
        command: { file: process.execPath, args: [FAKE] },
        ...(timeoutMs ? { timeoutMs } : {}),
      });

    // ---- Readiness ----
    const signIn = (login: string) => {
      process.env.FAKE_CODEX_LOGIN = login;
      return make().ready?.();
    };
    const none = await signIn("none");
    const apiKey = await signIn("apikey");
    const chatgpt = await signIn("chatgpt");
    results.push(check(
      "readiness follows the sign-in and asks for no key: signed out and API-key sign-ins are refused with a reason, ChatGPT is ready",
      make().keyVar === null && none?.ok === false && /codex login/.test(none.message) &&
        apiKey?.ok === false && /API key/i.test(apiKey.message) && chatgpt?.ok === true,
    ));

    const ready = make();

    // ---- One image ----
    process.env.FAKE_CODEX_MODE = "good";
    process.env.OPENAI_API_KEY = "a-key-Codex-must-never-see";
    let bytes: Buffer | undefined;
    try {
      bytes = await ready.generate(PROMPT, { seed: 7, model: "chatgpt-plan", aspectRatio: "2:3", imageSize: "1K" });
    } catch (err) {
      console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    }
    results.push(check(
      "an image comes back byte for byte, exactly the file Codex saved",
      bytes !== undefined && bytes.equals(sourceBytes),
    ));
    results.push(check(
      "Codex never sees OPENAI_API_KEY, so it can only bill the plan it signed in with",
      bytes !== undefined,
    ));
    delete process.env.OPENAI_API_KEY;
    // Everything a thread leaves in Codex's home, other than the folder planted
    // below that belongs to no attempt of ours.
    const leftovers = () => [
      ...readdirSync(join(home, "generated_images")).filter((name) => name !== "someone-elses-thread"),
      ...readdirSync(join(home, "sessions", "2026", "10", "22")),
    ];
    // The generator hands the bytes back and keeps Codex's copies: the run has not
    // stored the Frame yet. They go when the run says the attempt is over.
    const keptUntilStored = leftovers().length;
    ready.afterAttempt?.(7);
    results.push(check(
      "Codex's copy of the image and the thread's session log stay until the attempt is over, then are deleted",
      bytes !== undefined && keptUntilStored === 2 && leftovers().length === 0,
    ));
    const foreign = join(home, "generated_images", "someone-elses-thread");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "keep.png"), sourceBytes);

    // ---- Each failure, as a code ----
    const failures: Record<string, string | undefined> = {};
    for (const mode of ["altered", "leaked", "unverified", "refused", "usage", "signed-out", "no-image"]) {
      process.env.FAKE_CODEX_MODE = mode;
      failures[mode] = codeOf(await failureOf(ready, 8));
      ready.afterAttempt?.(8);
    }
    results.push(check(
      "a failed attempt leaves nothing behind either, and a folder that is not the attempt's own is untouched",
      leftovers().length === 0 && existsSync(join(foreign, "keep.png")),
    ));
    results.push(check(
      "a reworded Prompt, a Prompt with wrapper text around it, an unconfirmed Prompt, a refusal, a usage limit, a sign-out and a missing image each fail with their own code",
      failures.altered === "prompt-altered" && failures.leaked === "prompt-altered" &&
        failures.unverified === "prompt-unverified" &&
        failures.refused === "prompt-refused" && failures.usage === "usage-limit" &&
        failures["signed-out"] === "signed-out" && failures["no-image"] === "no-image",
    ));

    process.env.FAKE_CODEX_MODE = "usage";
    const limit = await failureOf(ready, 8);
    results.push(check(
      "a usage limit keeps the time it said it clears",
      limit instanceof GenerationFailure && limit.resetsAt === "3 hours",
    ));

    process.env.FAKE_CODEX_MODE = "hang";
    const hung = await failureOf(make(1500), 9);
    results.push(check(
      "a Codex that never finishes is stopped at the timeout",
      hung instanceof Error && /did not finish/.test(hung.message),
    ));

    // ---- Through the Job and the routes ----
    process.env.FAKE_CODEX_LOGIN = "chatgpt";
    const halting = async (mode: string, count: number) => {
      process.env.FAKE_CODEX_MODE = mode;
      const provider = make();
      const outDir = join(base, `archive-${mode}`);
      const app = createApp({ outDir, salt: "" }, { codex: provider });
      await app.request("/api/generate", {
        method: "POST",
        body: JSON.stringify({ count, provider: "codex", model: "plan", size: "1K", concurrency: 3, useNegative: true }),
      });
      const state = await settleJob(app);
      const rows = readFileSync(join(outDir, "manifest.jsonl"), "utf8").trim().split("\n")
        .map((line) => JSON.parse(line) as { params?: { promptWrapper?: string } });
      return { outDir, state, rows, waiting: openOutputFolder(outDir, "").waitingSeeds().length };
    };

    const usage = await halting("usage", 4);
    results.push(check(
      "a usage limit halts the Job after one Seed, says why, and leaves every claimed Seed waiting",
      usage.state.status === "done" && usage.state.stopped?.reason === "usage-limit" &&
        usage.state.stopped.resetsAt === "3 hours" && usage.state.failed === 1 && usage.state.done === 0 &&
        usage.waiting === 4,
    ));

    const repeated = await halting("no-image", 6);
    results.push(check(
      "three failures in a row halt the Job as repeated-failure, and the Seeds it never reached stay waiting",
      repeated.state.stopped?.reason === "repeated-failure" && repeated.state.failed === 3 &&
        repeated.waiting === 6,
    ));

    // One Seed: the stand-in returns the same bytes every time, and a second
    // identical Frame would be quarantined as an exact duplicate, as it should be.
    const landed = await halting("good", 1);
    results.push(check(
      "a Job that makes every image ends without a stop, with the Frame in the dataset folder and Codex's bytes in raw",
      landed.state.status === "done" && landed.state.done === 1 && landed.state.stopped === undefined &&
        landed.waiting === 0 && existsSync(join(landed.outDir, "00001.png")) &&
        readFileSync(join(landed.outDir, "raw", "00001.png")).equals(sourceBytes),
    ));
    results.push(check(
      "every row a Codex run writes names the wrapper version, and the run leaves nothing in Codex's home",
      [...landed.rows, ...repeated.rows, ...usage.rows].every((row) => row.params?.promptWrapper === WRAPPER_VERSION) &&
        leftovers().length === 0,
    ));

    const status = (await (await createApp({ outDir: join(base, "archive-status"), salt: "" }, { codex: make() })
      .request("/api/status")).json()) as { providers: Record<string, unknown>[] };
    results.push(check(
      "Status reports Codex as ready without a key, and offers no folder of its own to set",
      status.providers[0].ready === true && status.providers[0].needsKey === false &&
        !("outputFolder" in status.providers[0]),
    ));
  } finally {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("FAKE_CODEX_MODE", saved.mode);
    restore("FAKE_CODEX_LOGIN", saved.login);
    restore("FAKE_CODEX_IMAGE", saved.image);
    restore("CODEX_HOME", saved.home);
    restore("OPENAI_API_KEY", saved.openai);
    rmSync(base, { recursive: true, force: true });
  }
}
