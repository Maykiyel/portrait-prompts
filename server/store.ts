import { openOutputFolder, type OutputFolder } from "../core/output-folder";
import { hasKey, maxConcurrencyFor, type ProviderRegistry } from "../core/providers";
import type {
  ImageItem, ImportResult, PromptsResponse, ProviderInfo, Status,
} from "../shared/api-types";

/**
 * An app is pointed at one dataset: an output folder root, and the Seed salt that
 * guards it. Both are injected rather than read here, so the routes cannot be
 * talked into serving a different folder by a process-wide variable, and a test
 * hands over a temporary root instead of rearranging the environment.
 */
export type Dataset = { outDir: string; salt: string };

/** The module's stream type, taken from the interface rather than from node:fs. */
export type FrameStream = ReturnType<OutputFolder["readFrame"]>;

/** Everything the routes ask of one dataset. The folder's location never leaves it. */
export type Store = {
  getStatus(): Status;
  getPending(useNegative?: boolean): PromptsResponse;
  addPrompts(count: number, useNegative?: boolean): PromptsResponse;
  listImages(): ImageItem[];
  readFrame(seed: number, raw?: boolean): FrameStream;
  readThumbnail(seed: number, width: number): Promise<FrameStream>;
  rejectFrame(seed: number): void;
  importFiles(files: File[], seeds: number[]): Promise<ImportResult[]>;
};

/**
 * One dataset's archive, opened on first use so the Prompt files are read once
 * rather than on every request, and remembered here rather than in a module
 * global. A global would be one folder per process, shared by every app: two apps
 * would take turns re-opening each other's archive, and each would answer with
 * the Prompt files whichever app asked last.
 */
export function createStore({ outDir, salt }: Dataset, registry: ProviderRegistry): Store {
  let opened: OutputFolder | undefined;
  const archive = (): OutputFolder => (opened ??= openOutputFolder(outDir, salt));

  /**
   * Every Provider the registry knows, offered to the browser so it can draw the
   * same models and sizes the server would accept. The browser holds no list of
   * its own, so there is no second copy in the bundle to fall behind the server.
   * A key is reported as present or absent and never as itself.
   */
  const providerInfo = (): ProviderInfo[] =>
    Object.values(registry).map((provider) => ({
      id: provider.id,
      label: provider.label,
      hasApiKey: hasKey(provider),
      sizes: [...provider.sizes],
      models: provider.models.map(({ id, label, fixedSize }) => ({ id, label, fixedSize })),
      maxConcurrency: maxConcurrencyFor(provider),
    }));

  const getStatus = (): Status => {
    const { version, next, done, waiting, blocked, saltSet, problem } = archive().status();
    return { version, next, done, waiting, blocked, saltSet, problem, providers: providerInfo() };
  };

  const promptsFor = (seeds: number[], useNegative: boolean): PromptsResponse =>
    ({ items: archive().promptsFor(seeds, useNegative) });

  const getPending = (useNegative = false): PromptsResponse =>
    promptsFor(archive().waitingSeeds(), useNegative);

  /** Issues `count` new Seeds and returns every waiting prompt, new ones included. */
  const addPrompts = (count: number, useNegative = false): PromptsResponse => {
    archive().issueSeeds(count);
    return promptsFor(archive().waitingSeeds(), useNegative);
  };

  const listImages = (): ImageItem[] => archive().listFrames();

  const readFrame = (seed: number, raw = false): FrameStream => archive().readFrame(seed, raw);

  const readThumbnail = (seed: number, width: number): Promise<FrameStream> => archive().readThumbnail(seed, width);

  /** Removes the Frame so its Seed goes back to waiting. The Manifest keeps a record. */
  const rejectFrame = (seed: number): void => archive().rejectFrame(seed);

  /**
   * A batch that breaks an invariant is refused whole; a file that cannot be
   * read comes back as one failed result, so the rest of the batch still lands.
   */
  const importFiles = async (files: File[], seeds: number[]): Promise<ImportResult[]> =>
    archive().importFrames(
      await Promise.all(files.map(async (file) => ({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) }))),
      seeds,
    );

  return { getStatus, getPending, addPrompts, listImages, readFrame, readThumbnail, rejectFrame, importFiles };
}

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
