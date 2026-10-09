import { openOutputFolder, type OutputFolder } from "../output-folder";
import type { ImageItem, ImportResult, PromptsResponse, Status } from "../shared/api-types";

/** Where the output folder is. OUT_DIR still decides, as it always has. */
export const outDir = () => process.env.OUT_DIR ?? "out";

/** The module's stream type, taken from the interface rather than from node:fs. */
export type FrameStream = ReturnType<OutputFolder["readFrame"]>;

let opened: { root: string; salt: string; folder: OutputFolder } | undefined;

/**
 * The one owner of the output folder, opened once per root and salt so the Prompt
 * files are read once rather than on every request. The salt arrives from the
 * composition root on every call, so a test or a second dataset can open its own.
 */
const archive = (salt: string): OutputFolder => {
  const root = outDir();
  if (opened?.root !== root || opened.salt !== salt)
    opened = { root, salt, folder: openOutputFolder(root, salt) };
  return opened.folder;
};

export function getStatus(salt: string): Status {
  const { version, next, done, waiting, saltSet, problem } = archive(salt).status();
  return { version, next, done, waiting, saltSet, problem, hasApiKey: Boolean(process.env.GEMINI_API_KEY) };
}

const promptsFor = (salt: string, seeds: number[], useNegative: boolean): PromptsResponse =>
  ({ items: archive(salt).promptsFor(seeds, useNegative) });

export function getPending(salt: string, useNegative = false): PromptsResponse {
  return promptsFor(salt, archive(salt).waitingSeeds(), useNegative);
}

/** Issues `count` new Seeds and returns every waiting prompt, new ones included. */
export function addPrompts(salt: string, count: number, useNegative = false): PromptsResponse {
  archive(salt).issueSeeds(count);
  return promptsFor(salt, archive(salt).waitingSeeds(), useNegative);
}

export const listImages = (salt: string): ImageItem[] => archive(salt).listFrames();

/** A Frame or its Raw image, as a stream. The folder's location never leaves the module. */
export const readFrame = (salt: string, seed: number, raw = false): FrameStream =>
  archive(salt).readFrame(seed, raw);

export const readThumbnail = (salt: string, seed: number, width: number): Promise<FrameStream> =>
  archive(salt).readThumbnail(seed, width);

/** Removes the Frame so its Seed goes back to waiting. The Manifest keeps a record. */
export const rejectFrame = (salt: string, seed: number): void => archive(salt).rejectFrame(seed);

/**
 * A batch that breaks an invariant is refused whole; a file that cannot be read
 * comes back as one failed result, so the rest of the batch still lands.
 */
export const importFiles = async (salt: string, files: File[], seeds: number[]): Promise<ImportResult[]> =>
  archive(salt).importFrames(
    await Promise.all(files.map(async (file) => ({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) }))),
    seeds,
  );

/** Why an import is refused before it reaches the module. The route turns this into a response, so no refusal here carries a status from the module. */
export type ImportRefusal = { status: 400; message: string };

/**
 * The one batch-validity refusal: a Seed named twice in one batch is a
 * bad request, not a Seed that is not waiting. The module still raises
 * for callers that go straight to it.
 */
export function importRefusal(seeds: number[]): ImportRefusal | undefined {
  return new Set(seeds).size !== seeds.length
    ? { status: 400, message: "Two images share a seed" }
    : undefined;
}
