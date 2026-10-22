import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import { GenerationFailure } from "./errors";
// Both imports are type-only: nothing here is needed to name the Provider or the
// Generator, and the run never loads this module.
import type { Generator } from "./generate";
import type { Provider, Readiness } from "./providers";

/**
 * The Codex CLI as an image Provider. It signs in with a ChatGPT plan, so there
 * is no key: readiness is whether `codex` is signed in. Its images land in the
 * dataset like any other Provider's, the Frame in out/ and the bytes ChatGPT sent
 * in out/raw, so it keeps no folder of its own. See the spec in docs/specs (local
 * only) and ADR 0004.
 *
 * What Codex does was measured on codex-cli 0.163.0 with a ChatGPT Go plan
 * (Phase 0 in the spec). `exec --json` prints only the thread, the agent's
 * messages and the turn, never the image. The image call is recorded in the
 * session log Codex keeps under its home folder, as an `item_completed` event of
 * kind `image_gen.generation` carrying `status`, `revisedPrompt`, `savedPath` and
 * `failure`, and the PNG itself is in `generated_images/<thread>/`. So the
 * generator reads the thread id from stdout and everything else from that log.
 * Both are Codex's internals rather than a published contract; when a new
 * version moves them, `readSession` is the one place to change.
 */

/**
 * The instruction around the Prompt. It may be reworded as often as it takes to
 * get Codex to make an image. The Prompt between the markers may not: it is the
 * Seed's, and the check below refuses any image made from other text. Bump the
 * version with every change: the Provider hands it to the run, and every Manifest
 * row it writes records it in `params.promptWrapper`.
 *
 * Version 1 asked Codex to save the file itself. It could not: the image tool
 * saves into Codex's own folder, and the agent spent its turn reporting that it
 * had failed. Version 2 asks for the image and nothing else.
 *
 * Version 2 put the Prompt between an opening and a closing marker, and the agent
 * sometimes sent "Generate an image. " before it and the closing marker after it.
 * Version 3 puts the Prompt last, so there is no closing marker to carry along,
 * and names both mistakes as forbidden.
 */
export const WRAPPER_VERSION = "codex-wrapper-3";
const PROMPT_MARKER = "=== PROMPT ===";
export const wrap = (prompt: string): string =>
  [
    "Generate exactly one image with your image generation tool, once.",
    `The image prompt is all of the text after the line ${PROMPT_MARKER}, to the very end of this message.`,
    "Pass that text to the image tool as its prompt exactly as written, character for character.",
    `Add nothing before or after it: no instruction such as "Generate an image.", no ${PROMPT_MARKER} line, no other words.`,
    "Make it a portrait image, 1024x1536. Do not save, move, copy or edit any file, and do nothing else.",
    PROMPT_MARKER,
    prompt,
  ].join("\n");

/**
 * The `exec` flags. The Prompt is not among them: it goes in on stdin (`-`), so
 * no shell ever sees it, which matters on Windows where `codex` may be a `.cmd`
 * that has to be started through one. Read-only, because the image tool writes
 * into Codex's own folder and the agent is asked to touch nothing.
 */
const EXEC_ARGS = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-"];

/** A Seed's whole budget. One image took 56 seconds in Phase 0; the rest is headroom. */
const TIMEOUT_MS = 5 * 60_000;
/** Readiness is asked on every Status, and asking means starting a process. */
const READY_TTL_MS = 15_000;

/** What one `exec` came to. Every field is absent when Codex did not say. */
export type CodexReading = {
  /** The thread `exec` ran, which names its session log and its image folder. */
  threadId?: string;
  /** The text the image was made from, as the image tool reported it. */
  toolPrompt?: string;
  /** Where the image tool saved the image. */
  imagePath?: string;
  /** Why it failed, when Codex said it failed. */
  failure?: { code: "usage-limit" | "signed-out" | "prompt-refused"; message: string; resetsAt?: string };
  /** The last thing the agent said, for a failure message. */
  lastMessage?: string;
};

const USAGE = /usage limit|rate limit|quota|too many requests|limit reached/i;
const SIGNED_OUT = /not (?:logged|signed) in|log ?in again|sign ?in again|unauthori[sz]ed|\b401\b/i;
const REFUSED = /(?:can(?:no|'|’)t|unable to|not able to|won't)\b[^.]*\b(?:create|generate|make)|content polic|safety|guideline|moderation/i;
const RESETS = /(?:try again|resets?)\s+(?:at|in|after)\s+([^.\n]+)/i;

const jsonLines = (text: string): Record<string, unknown>[] =>
  text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value: unknown = JSON.parse(line);
      return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });

/**
 * Reads what `exec --json` printed: the thread id, the agent's last message, and
 * any error text. Lines that are not JSON are kept as error text only when they
 * read like a limit or a sign-out, because those can arrive before Codex has
 * started a thread at all.
 */
export function readEvents(output: string): CodexReading {
  const reading: CodexReading = {};
  const errors: string[] = [];
  for (const event of jsonLines(output)) {
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "thread.started" && typeof event.thread_id === "string") reading.threadId = event.thread_id;
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") reading.lastMessage = item.text;
    if (/error|failed/i.test(type)) {
      const message = event.message ?? (event.error as Record<string, unknown> | undefined)?.message;
      if (typeof message === "string") errors.push(message);
    }
  }
  for (const line of output.split(/\r?\n/))
    if (!line.trim().startsWith("{") && (USAGE.test(line) || SIGNED_OUT.test(line))) errors.push(line.trim());
  const said = errors.join(" ");
  const resetsAt = RESETS.exec(said)?.[1]?.trim();
  if (USAGE.test(said)) reading.failure = { code: "usage-limit", message: said, ...(resetsAt ? { resetsAt } : {}) };
  else if (SIGNED_OUT.test(said)) reading.failure = { code: "signed-out", message: said };
  return reading;
}

/**
 * The session log for one thread, newest day first. Codex files it as
 * `sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl`, so only the name's ending
 * is known in advance. Only folders are walked, so a file Codex keeps beside
 * the dated folders is skipped rather than read as one.
 */
const sessionLog = (home: string, threadId: string): string | undefined => {
  const foldersNewestFirst = (dir: string) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
          .reverse()
          .map((name) => join(dir, name))
      : [];
  for (const year of foldersNewestFirst(join(home, "sessions")))
    for (const month of foldersNewestFirst(year))
      for (const day of foldersNewestFirst(month)) {
        const found = readdirSync(day).find((name) => name.endsWith(`-${threadId}.jsonl`));
        if (found) return join(day, found);
      }
  return undefined;
};

/**
 * Adds what the session log says about the image call to a reading: the text it
 * was made from, where it was saved, and whether the tool reported a failure.
 * The last image call wins, though the wrapper asks for exactly one.
 */
export function readSession(log: string, reading: CodexReading): CodexReading {
  const next = { ...reading };
  for (const row of jsonLines(log)) {
    const payload = row.payload as Record<string, unknown> | undefined;
    const item = payload?.item as Record<string, unknown> | undefined;
    if (payload?.type !== "item_completed" || item?.kind !== "image_gen.generation") continue;
    next.toolPrompt = typeof item.revisedPrompt === "string" ? item.revisedPrompt : undefined;
    next.imagePath = typeof item.savedPath === "string" && existsSync(item.savedPath) ? item.savedPath : undefined;
    const failure = item.failure;
    if (failure !== null && failure !== undefined) {
      const message = typeof failure === "string" ? failure : JSON.stringify(failure);
      const resetsAt = RESETS.exec(message)?.[1]?.trim();
      next.failure = USAGE.test(message)
        ? { code: "usage-limit", message, ...(resetsAt ? { resetsAt } : {}) }
        : SIGNED_OUT.test(message)
          ? { code: "signed-out", message }
          : REFUSED.test(message)
            ? { code: "prompt-refused", message }
            : next.failure;
    }
  }
  // The agent's own words are the last place a refusal shows, when the tool never ran.
  if (!next.failure && !next.imagePath && next.lastMessage && REFUSED.test(next.lastMessage))
    next.failure = { code: "prompt-refused", message: next.lastMessage };
  return next;
}

/** How a Codex process is started. The real one is `codex`; the suite hands in a stand-in. */
export type CodexCommand = { file: string; args: string[] };

export type CodexOptions = {
  command: CodexCommand;
  /** A Seed's whole budget. Defaults to five minutes; the suite shortens it to prove the timeout. */
  timeoutMs?: number;
  /** Codex's home folder, where it keeps session logs and images. Defaults to CODEX_HOME, then ~/.codex. */
  home?: string;
};

/**
 * `codex` from the PATH, except where OpenAI's Windows installer put it and the
 * PATH has not caught up: the installer edits the user PATH, which a server
 * started from an older terminal never sees.
 */
const defaultCommand = (): CodexCommand => {
  const installed = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe")
    : undefined;
  return { file: installed && existsSync(installed) ? installed : "codex", args: [] };
};

// On Windows an npm-installed `codex` is a `.cmd`, which Node will only start
// through a shell. Only the fixed flags pass through it; the Prompt goes on stdin.
const needsShell = (file: string) => process.platform === "win32" && !extname(file);

/**
 * The child's environment: the server's, without any key Codex could bill
 * instead of the ChatGPT plan it signed in with. `OPENAI_API_KEY` is the OpenAI
 * Provider's; `CODEX_API_KEY` is the one Codex reads for runs without a sign-in.
 */
const childEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
};

/**
 * Ends a child and everything it started. Through a shell on Windows the child
 * is `cmd.exe`, and killing it alone would leave Codex running, still spending
 * the plan, so the whole tree goes.
 */
const killTree = (pid: number | undefined, kill: () => void) => {
  if (process.platform === "win32" && pid !== undefined)
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else kill();
};

type Finished = { stdout: string; stderr: string; code: number | null; timedOut: boolean };

/**
 * Starts Codex with `args`, writes `stdin` to it, and resolves once it exits or
 * the time runs out. Never blocks the server while it waits.
 */
const runCodex = (command: CodexCommand, args: string[], options: { cwd?: string; stdin?: string; timeoutMs: number }) =>
  new Promise<Finished>((done, fail) => {
    const child = spawn(command.file, [...command.args, ...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: childEnv(),
      shell: needsShell(command.file),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, () => child.kill());
    }, options.timeoutMs);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ stdout, stderr, code, timedOut });
    });
    child.stdin.end(options.stdin ?? "");
  });

const THREAD_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function createCodex({
  command,
  timeoutMs = TIMEOUT_MS,
  home = process.env.CODEX_HOME ?? join(homedir(), ".codex"),
}: CodexOptions): Provider {
  let signIn: { at: number; answer: Readiness } | undefined;
  let checking: Promise<Readiness> | undefined;
  /**
   * Whether Codex is signed in with ChatGPT, asked of `codex login status` and
   * remembered for a few seconds. Asked without blocking, and asked once however
   * many requests arrive while the answer is on its way.
   */
  const signedIn = (): Promise<Readiness> => {
    if (signIn && Date.now() - signIn.at < READY_TTL_MS) return Promise.resolve(signIn.answer);
    checking ??= runCodex(command, ["login", "status"], { timeoutMs: 10_000 })
      .then(({ stdout, stderr, code, timedOut }): Readiness => {
        const said = `${stdout}${stderr}`;
        // Through a shell, a missing `codex` is the shell's own complaint rather than a spawn error.
        if (timedOut || code === null || /not recognized|not found|no such file/i.test(said))
          return { ok: false, message: "Codex is not installed, or `codex` is not on the PATH. Install it, then run `codex login`." };
        if (code !== 0 || /not logged in/i.test(said))
          return { ok: false, message: "Codex is not signed in. Run `codex login` and choose ChatGPT." };
        if (/api key/i.test(said))
          return { ok: false, message: "Codex is signed in with an API key. Run `codex logout`, then `codex login` and choose ChatGPT." };
        return { ok: true };
      })
      .catch((): Readiness => ({
        ok: false,
        message: "Codex is not installed, or `codex` is not on the PATH. Install it, then run `codex login`.",
      }))
      .then((answer) => {
        signIn = { at: Date.now(), answer };
        checking = undefined;
        return answer;
      });
    return checking;
  };

  /**
   * The thread each Seed's attempt ran, kept until the run says the attempt is
   * over. Codex's copy is deleted only then, so the image is already in out/
   * (or the failure is on the record) before the last other copy goes.
   */
  const threads = new Map<number, string>();

  const generate: Generator = async (prompt, opts) => {
    // An empty folder per attempt to run Codex in, so the agent starts somewhere
    // with nothing in it to read or change.
    const work = mkdtempSync(join(tmpdir(), `portrait-codex-${opts.seed}-`));
    try {
      const { stdout, stderr, code, timedOut } = await runCodex(command, EXEC_ARGS, {
        cwd: work,
        stdin: wrap(prompt),
        timeoutMs,
      });
      let reading = readEvents(`${stdout}\n${stderr}`);
      if (reading.threadId) threads.set(opts.seed, reading.threadId);
      if (timedOut) throw new Error(`Codex did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
      // The image call is only in the session log, which `exec` names by its thread.
      const log = reading.threadId ? sessionLog(home, reading.threadId) : undefined;
      // Read even when there is no log: a refusal before the tool ran is only in the agent's words.
      reading = readSession(log ? readFileSync(log, "utf8") : "", reading);
      if (reading.failure)
        throw new GenerationFailure(reading.failure.code, reading.failure.message, reading.failure.resetsAt);

      const image = reading.imagePath;
      if (!image) {
        const said = reading.lastMessage ?? stderr.trim().split(/\r?\n/).pop() ?? `exit ${code}`;
        throw new GenerationFailure("no-image", `Codex wrote no image. It said: ${said}`);
      }
      // The Seed fixes the Prompt, so an image made from any other text is not
      // this Seed's. Whitespace at either end is the only difference allowed.
      if (reading.toolPrompt === undefined)
        throw new GenerationFailure("prompt-unverified", "Codex made an image but its session log did not show the text it used, so the Prompt cannot be confirmed.");
      if (reading.toolPrompt.trim() !== prompt.trim())
        throw new GenerationFailure("prompt-altered", `Codex changed the Prompt before making the image. It sent: ${reading.toolPrompt}`);

      // Returned untouched, so out/raw holds exactly the bytes ChatGPT sent.
      return readFileSync(image);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  };

  /**
   * Removes what one attempt left in Codex's home: the image folder for its
   * thread and its session log, which holds the image a second time as base64.
   * Called by the run once the Frame is stored or the failure recorded. A thread
   * id that is not a UUID is left alone, so a malformed one can never widen what
   * gets deleted, and cleaning up never fails the attempt it follows.
   */
  const afterAttempt = (seed: number) => {
    const thread = threads.get(seed);
    threads.delete(seed);
    if (!thread || !THREAD_ID.test(thread)) return;
    try {
      rmSync(join(home, "generated_images", thread), { recursive: true, force: true });
      const log = sessionLog(home, thread);
      if (log) rmSync(log, { force: true });
    } catch {
      // A file Codex still holds open stays behind; the next attempt is unaffected.
    }
  };

  return {
    id: "codex",
    label: "ChatGPT (Codex)",
    keyVar: null,
    ready: signedIn,
    afterAttempt,
    promptWrapper: WRAPPER_VERSION,
    sizes: ["1K"],
    // The wrapper asks for 1024x1536. Codex may answer with another shape, and the
    // archive crops it to 2:3 and records the warning as it does for any Frame.
    aspectRatios: ["2:3"],
    // Codex chooses the image model. The plan is what is known about it.
    models: [{ id: "plan", label: "Your ChatGPT plan", model: "chatgpt-plan", fixedSize: null }],
    imagesPerMinute: null,
    maxConcurrency: 1,
    stopAfterFailures: 3,
    refuseSize: (size) => `Codex is asked for 1024x1536 only, so ${size} cannot be requested.`,
    generate,
  };
}

export const codex: Provider = createCodex({ command: defaultCommand() });
