import { openOutputFolder, type OutputFolder } from "../core/output-folder";
import type { ReviewReason } from "../core/output-folder";
import { ArchiveError } from "../core/errors";
import { maxConcurrencyFor, readiness, type Provider, type ProviderRegistry } from "../core/providers";
import type {
  ImageItem, ImportResult, PromptsResponse, ProviderInfo, SeedRecordItem, Status,
} from "../shared/api-types";

/**
 * An app is pointed at one dataset: an output folder root, and the Seed salt that
 * guards it. Both are injected rather than read here, so the routes cannot be
 * talked into serving a different folder by a process-wide variable, and a test
 * hands over a temporary root instead of rearranging the environment.
 */
export type Dataset = { outDir: string; salt: string };

/**
 * Whether a Provider can run, as the browser hears it: a boolean, the sentence
 * when it cannot, and whether a key is what it is waiting on. Never the key.
 */
const readyInfo = async (provider: Provider): Promise<Pick<ProviderInfo, "ready" | "notReady" | "needsKey">> => {
  const ready = await readiness(provider);
  return { ready: ready.ok, needsKey: provider.keyVar !== null, ...(ready.ok ? {} : { notReady: ready.message }) };
};

/** The module's stream type, taken from the interface rather than from node:fs. */
export type FrameStream = ReturnType<OutputFolder["readFrame"]>;

/** Everything the routes ask of one dataset. The folder's location never leaves it. */
export type Store = {
  getStatus(): Promise<Status>;
  getPending(useNegative?: boolean): PromptsResponse;
  addPrompts(count: number, useNegative?: boolean): PromptsResponse;
  listImages(): ImageItem[];
  /** One Seed's full record. Raises `missing-frame` when no row describes that Seed. */
  frameRecord(seed: number): SeedRecordItem;
  readFrame(seed: number, raw?: boolean): FrameStream;
  readQuarantinedFrame(seed: number): FrameStream;
  readThumbnail(seed: number, width: number): Promise<FrameStream>;
  acceptFrame(seed: number, note?: string): void;
  rejectFrame(seed: number, reason: string, note?: string): void;
  quarantinedFrames(): ReturnType<OutputFolder["quarantinedFrames"]>;
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
   * Readiness is reported as a boolean and a sentence, and a key never as itself.
   */
  const providerInfo = (): Promise<ProviderInfo[]> =>
    Promise.all(Object.values(registry).map(async (provider) => ({
      id: provider.id,
      label: provider.label,
      ...(await readyInfo(provider)),
      sizes: [...provider.sizes],
      models: provider.models.map(({ id, label, fixedSize }) => ({ id, label, fixedSize })),
      maxConcurrency: maxConcurrencyFor(provider),
    })));

  const getStatus = async (): Promise<Status> => {
    const { version, next, done, waiting, blocked, saltSet, problem } = archive().status();
    return { version, next, done, waiting, blocked, saltSet, problem, providers: await providerInfo() };
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

  /**
   * One Seed's full record for the detail view.
   *
   * The list route answers with a summary per Frame, so this is the only route
   * that carries the digests, the sampled attributes and the QC record. A Seed
   * no row describes is refused with the same code a missing Frame is, because
   * to a caller they are the same request: there is nothing here to show.
   */
  const frameRecord = (seed: number): SeedRecordItem => {
    const record = archive().frameRecord(seed);
    if (!record) throw new ArchiveError("missing-frame", `No record for Seed ${seed}`);
    return record;
  };

  const readFrame = (seed: number, raw = false): FrameStream => archive().readFrame(seed, raw);
  const readQuarantinedFrame = (seed: number): FrameStream => archive().readQuarantinedFrame(seed);

  const readThumbnail = (seed: number, width: number): Promise<FrameStream> => archive().readThumbnail(seed, width);

  /** Accepts a Frame, unless its QC status is fail. */
  const acceptFrame = (seed: number, note?: string): void => archive().acceptFrame(seed, note);

  /** Removes the Frame so its Seed goes back to waiting. The Manifest keeps a record. */
  const rejectFrame = (seed: number, reason: string, note?: string): void =>
    archive().rejectFrame(seed, reason as ReviewReason, note);

  const quarantinedFrames = () => archive().quarantinedFrames();

  /**
   * A batch that breaks an invariant is refused whole; a file that cannot be
   * read comes back as one failed result, so the rest of the batch still lands.
   */
  const importFiles = async (files: File[], seeds: number[]): Promise<ImportResult[]> =>
    archive().importFrames(
      await Promise.all(files.map(async (file) => ({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) }))),
      seeds,
    );

  return { getStatus, getPending, addPrompts, listImages, frameRecord, readFrame, readQuarantinedFrame, readThumbnail, acceptFrame, rejectFrame, quarantinedFrames, importFiles };
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
