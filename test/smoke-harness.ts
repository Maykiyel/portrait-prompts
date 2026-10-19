// The shared harness for the smoke test: the pass/check helper every
// section reports through, and the fakes and observers every section
// shares. No behaviour lives here.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { ArchiveError, GenerationFailure } from "../core/errors";
import { providers, type ProviderRegistry } from "../core/providers";
import type { Generator } from "../core/generate";
import type { createApp } from "../server/index";
import type { JobState } from "../shared/api-types";

export const results: boolean[] = [];

export const check = (name: string, cond: boolean) => {
  console.log(cond ? `ok    ${name}` : `FAIL  ${name}`);
  return cond;
};

// The three fake generators: one that always lands a Frame, one that fails the
// way a quota error would, and one that refuses the Prompt the way a vendor's
// moderation would. The third is what makes `blocked` observable at all.
// A frame that passes every check. It carries real structure on purpose: a flat
// fill has a luminance standard deviation of zero, which the `near_blank` check
// reads as a fail, so a solid rectangle is not a healthy frame but an empty one.
export const good = async () =>
  sharp({
    create: { width: 848, height: 1264, channels: 3, background: "#7a8fa6" },
  })
    .composite([{
      input: Buffer.from(
        '<svg width="848" height="1264">' +
        '<rect width="848" height="1264" fill="#5c6f86"/>' +
        '<circle cx="424" cy="470" r="230" fill="#c98d6a"/>' +
        '<rect x="150" y="820" width="548" height="440" fill="#31404f"/>' +
        '<rect x="330" y="380" width="70" height="34" fill="#20242c"/>' +
        '<rect x="450" y="380" width="70" height="34" fill="#20242c"/>' +
        '<rect x="360" y="560" width="130" height="18" fill="#7d4a3c"/>' +
        '</svg>',
      ),
      top: 0,
      left: 0,
    }])
    .png()
    .toBuffer();
export const bad = async () => {
  throw new Error("fake quota error");
};
export const refused = async () => {
  throw new GenerationFailure("prompt-refused", "fake moderation refusal");
};

/**
 * The registry a test drives instead of the real one: every Provider is kept,
 * with its catalog and its key check intact, and only the thing that makes an
 * image is swapped. A test can then ask for a model and a size exactly as a
 * browser would, and be refused by the same rules, without reaching a network.
 */
export const withGenerators = (swaps: Record<string, Generator>): ProviderRegistry =>
  Object.fromEntries(
    Object.entries(providers).map(([id, provider]) => [
      id,
      swaps[id] ? { ...provider, generate: swaps[id] } : provider,
    ]),
  );

/**
 * Everything a block of code writes to the terminal, captured rather than shown.
 * The byte-contract checks compare what came out, and a silence check wants it
 * empty. Patching every console method rather than the two the command line
 * uses: a stray print is a stray print whatever it is called.
 */
export const captureOutput = async (action: () => Promise<unknown> | unknown): Promise<string[]> => {
  const captured: string[] = [];
  const take = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); };
  const original = {
    log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug,
  };
  console.log = take; console.error = take; console.warn = take; console.info = take; console.debug = take;
  try {
    await action();
  } finally {
    Object.assign(console, original);
  }
  return captured;
};

// The three ways a check observes the module: a stream it was handed, the code on
// an error it raised, or a value it returned. Nothing here reads the archive.
export const streamBytes = async (stream: NodeJS.ReadableStream) => {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
};
export const errorCode = (action: () => unknown) => {
  try {
    action();
    return "no error";
  } catch (err) {
    return err instanceof ArchiveError ? err.code : `not an ArchiveError: ${String(err)}`;
  }
};
export const asyncCode = async (action: () => Promise<unknown>) => {
  try {
    await action();
    return "no error";
  } catch (err) {
    return err instanceof ArchiveError ? err.code : String(err);
  }
};

export const repoRoot = process.cwd();

/**
 * The Job one app is holding, and the wait for it to stop holding one.
 *
 * The route that starts a Job answers at once and does not await the run, so the
 * only way to see a finished Job is the way a browser sees one: ask the polling
 * route, and ask it again until the Job has left running. Both take the app
 * rather than a reader of one route, because each app holds its own Job —
 * settling one by watching another's route would be waiting for a state that
 * app is never going to reach.
 *
 * The bounds are what they have always been: fifteen seconds' worth of asking
 * at twenty milliseconds, and then the last state seen, which is a Job that is
 * still running and says so rather than a check that quietly gives up.
 */
export const jobOf = async (app: ReturnType<typeof createApp>): Promise<JobState> =>
  (await (await app.request("/api/generate/job")).json()) as JobState;

export const settleJob = async (app: ReturnType<typeof createApp>): Promise<JobState> => {
  for (let attempt = 0; attempt < 750; attempt++) {
    const state = await jobOf(app);
    if (state.status !== "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return jobOf(app);
};

/** The Prompt files, read relative to the working directory. */
export const promptFiles = () => {
  const raw = readFileSync("template.txt", "utf8");
  return { version: raw.match(/^#\s*(.+)\n/)?.[1]?.trim() ?? "unversioned", template: raw.replace(/^#.*\n/, "") };
};
