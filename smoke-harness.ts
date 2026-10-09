// The shared harness for the smoke test: the pass/check helper every
// section reports through, and the fakes and observers every section
// shares. No behaviour lives here.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { ArchiveError } from "./errors";

export const results: boolean[] = [];

export const check = (name: string, cond: boolean) => {
  console.log(cond ? `ok    ${name}` : `FAIL  ${name}`);
  return cond;
};

// The two fake generators: one that always lands a Frame, and one that
// fails the way a quota error would.
export const good = async () =>
  sharp({ create: { width: 848, height: 1264, channels: 3, background: "#7a8fa6" } }).png().toBuffer();
export const bad = async () => {
  throw new Error("fake quota error");
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

/** The Prompt files, read relative to the working directory. */
export const promptFiles = () => {
  const raw = readFileSync("template.txt", "utf8");
  return { version: raw.match(/^#\s*(.+)\n/)?.[1]?.trim() ?? "unversioned", template: raw.replace(/^#.*\n/, "") };
};
