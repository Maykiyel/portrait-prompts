import { FrameQuarantined, namedSeeds, openOutputFolder } from "./output-folder";
import { GenerationFailure, isStopping, type StoppingCode } from "./errors";

/**
 * The seam the run stands on: something that turns a Prompt into image bytes.
 * It is declared here rather than beside the vendor client on purpose. This
 * module names no vendor, so it cannot import one — which means the shape of
 * what it needs is stated here, and the vendor client implements it.
 */
export type GenOptions = {
  /**
   * The Seed this image is for. A Generator never decides anything with it; it
   * may name its own scratch files after it, and match them up in `afterAttempt`.
   */
  seed: number;
  model: string;
  aspectRatio: string;
  imageSize: string;
};

export type Generator = (prompt: string, opts: GenOptions) => Promise<Buffer>;

/** How the run reports one thing that happened. Read with `kind`. */
export type StartEvent = {
  kind: "start";
  /** Seeds this run will generate Frames for. */
  total: number;
  /** Seeds this run claimed that already had a Frame. */
  alreadyDone: number;
  /**
   * The Seeds it will generate, first and last. Absent when there is nothing
   * to generate: the range would be invented, and a caller that renders a
   * header has a real clause to leave out rather than a sentinel to hide.
   */
  range?: { first: number; last: number };
  /** The Prompt version every Frame this run writes will carry. */
  version: string;
};

/**
 * How the run reports one Seed's outcome.
 *
 * A failed Seed keeps a Seed of its own: it stays waiting, and the next run
 * tries it first. A blocked Seed is the other kind — the vendor refused the
 * Prompt itself, so retrying is pointless — and it is named rather than folded
 * into `ok: false`, because a caller showing these live has to tell a Seed worth
 * running again from one that is finished.
 */
export type SeedEvent = {
  kind: "seed";
  seed: number;
  ok: boolean;
  /** True when no run will ever generate this Seed, because its Prompt was refused. */
  blocked: boolean;
  /** Why it failed. Present when it did. */
  message?: string;
};

/**
 * How the run reports a Prompt it would have sent. A dry run has no outcome to
 * report, so the Prompt is the whole of what happened to that Seed.
 */
export type PromptEvent = {
  kind: "prompt";
  seed: number;
  prompt: string;
};

/**
 * How the run reports that it did not do quite what it was asked, because a limit
 * is not the caller's to lift: the request asked for more Frames at once than this
 * Provider will take, and the run took what it will take and said so. Reported only
 * when it actually clamps, so a run asked for something already under the ceiling
 * is not told about a clamp that did not happen — a note about a substitution that
 * did not take place is the same defect as a substitution that went unreported.
 */
export type ClampEvent = {
  kind: "clamp";
  /** What was reduced. Named because a run has more than one thing it could be. */
  what: "concurrency";
  /** What the caller asked for. */
  asked: number;
  /** What the run will do instead. */
  running: number;
};

/** Why a run halted before trying every Seed it claimed. */
export type StopInfo = {
  /**
   * `usage-limit` and `signed-out` are what the Provider said about the account.
   * `repeated-failure` is the run's own call, after the Provider's
   * `stopAfterFailures` failures in a row.
   */
  reason: StoppingCode | "repeated-failure";
  message: string;
  /** When the vendor said a usage limit clears, as it wrote it. */
  resetsAt?: string;
};

/**
 * How the run reports that it is halting. Reported once, before the run returns,
 * and only when it halts: the Seeds it never reached were claimed but not tried,
 * so they stay waiting, and a caller that did not hear this would show a run that
 * simply had fewer Seeds.
 */
export type StopEvent = { kind: "stop" } & StopInfo;

/** Everything the run reports, in the order it happened. */
export type ProgressEvent = StartEvent | ClampEvent | SeedEvent | PromptEvent | StopEvent;

/**
 * What one run was asked to do. Every value is concrete: the run never has to be
 * told what "ten" means. The default generation policy that callers start from
 * is stated once in `core/policy.ts`, beside this module, and each caller
 * overrides what it means to override — so a dry run is not a default of
 * anything's, and the run itself holds no opinion about any value. The one
 * exception is the concurrency, which the run does hold an opinion about, and
 * only because the Provider's rate is a fact about the vendor rather than about
 * the run: the ceiling is handed in and enforced here, so both callers inherit
 * it instead of each keeping a copy that can stop being true.
 */
export type RunRequest = {
  /** How many Seeds to claim. Waiting Seeds are finished before fresh ones. */
  count: number;
  /** How many Frames to generate at once. At least one worker always runs. */
  concurrency: number;
  /**
   * The most Frames this Provider will take at once. The run clamps to it and
   * says so when it clamps, so the ceiling is one line of output rather than a
   * wall of failures nobody can explain. Required rather than defaulted, for the
   * same reason `generate` is: this module names no vendor, so it cannot work out
   * a ceiling for one.
   */
  maxConcurrency: number;
  /**
   * How many failures in a row halt the run. Absent means it tries every Seed it
   * claimed. Handed in for the same reason as the ceiling: it is the Provider's.
   */
  stopAfterFailures?: number;
  /**
   * Called once each Seed's attempt is over, its Frame stored or its failure
   * recorded, so a Provider can remove files of its own only after the archive
   * holds what it needs. Never called for a dry run, which makes nothing.
   */
  afterAttempt?: (seed: number) => void;
  /** The Provider's wrapper version, recorded in each row's `params`. Absent when it sends the Prompt alone. */
  promptWrapper?: string;
  /**
   * Which Provider makes the Frames. Recorded in the Manifest beside the model,
   * which is the one place the run knows a Provider made anything at all: the
   * Generator is handed what to make and never who is making it.
   */
  provider: string;
  /** The model to generate with. Handed to the Generator and recorded in the Manifest. */
  model: string;
  /** Image shape, handed to the Generator. */
  aspectRatio: string;
  imageSize: string;
  /** Whether the Prompt carries the Negative list. */
  useNegative: boolean;
  /** The output folder to work in. */
  outDir: string;
  /** The Seed salt that folder was started with. */
  salt: string;
  /** What makes the images. Required, not defaulted: this module names no vendor. */
  generate: Generator;
  /** Name the first Seed by hand, filling the gap up to the last one. Absent follows the Seed counter. */
  start?: number;
  /**
   * Claim without committing: report the Prompts, write nothing, move nothing.
   * Absent means a real run. It is optional because a caller that never wants a
   * dry run should say nothing rather than say `false` and look as though it
   * had chosen — the Job, which has no dry run, names neither flag.
   */
  dryRun?: boolean;
  /**
   * Where progress goes. Optional, so a caller that wants only the result is
   * left alone and this module stays silent.
   */
  onEvent?: (event: ProgressEvent) => void;
};

/** What a run came to, for the caller to render or refuse on. */
export type RunResult = {
  done: number;
  failed: number;
  blocked: number;
  /** Why it halted early. Absent when it tried every Seed it claimed. */
  stopped?: StopInfo;
};

/**
 * Claims Seeds, generates Frames, records Attempts, and reports what happened.
 *
 * Progress arrives as data through `onEvent` rather than as text, and that is
 * the whole reason this module is its own. It used to print every line itself,
 * so no caller could ask for quiet and a caller that wanted to know what had
 * happened had to read a terminal. The channel is a plain callback because a
 * promise cannot report anything before it resolves, a handle object would
 * exist only to be cancelled and nothing cancels it, and a second return value
 * would arrive after the work rather than during it. Events are delivered as
 * they happen and in the order they happened, so a caller rendering them live
 * sees what a person at a terminal would have.
 *
 * There is no `console.*` here and no terminal to catch output from. A check in
 * the suite watches the console across a run, because silence is a claim about
 * what a caller sees rather than about what this file says.
 */
export async function run(request: RunRequest): Promise<RunResult> {
  const folder = openOutputFolder(request.outDir, request.salt);
  const report = (event: ProgressEvent) => request.onEvent?.(event);

  // Which Seeds this run touches is answered here and nowhere else. The
  // explicit start fills the gap up to the last Seed it names; otherwise the
  // counter does the asking, which finishes Waiting Seeds first. A dry run
  // claims without committing, so looking at the work costs nothing.
  const seeds =
    request.start !== undefined
      ? namedSeeds(folder, request.start, request.count, !request.dryRun)
      : folder.claimSeeds(request.count, !request.dryRun);
  const todo = seeds.filter((seed) => !folder.hasFrame(seed));

  report({
    kind: "start",
    version: folder.status().version,
    total: todo.length,
    alreadyDone: seeds.length - todo.length,
    ...(todo.length ? { range: { first: todo[0], last: todo[todo.length - 1] } } : {}),
  });

  // How many Frames this run makes at once. Clamped here rather than in either
  // caller, because a ceiling is the Provider's and there are two callers: the
  // copy one of them keeps is the copy that stops being true. The floor of one
  // worker is not a ceiling and is not announced, since a request for none of
  // them was never asking for the rate to be honoured.
  const running = Math.min(Math.max(1, request.concurrency), Math.max(1, request.maxConcurrency));
  if (running < request.concurrency)
    report({ kind: "clamp", what: "concurrency", asked: request.concurrency, running });

  // What every row this run writes says about how it asked, built once.
  const params = {
    aspectRatio: request.aspectRatio,
    imageSize: request.imageSize,
    useNegative: request.useNegative,
    ...(request.promptWrapper ? { promptWrapper: request.promptWrapper } : {}),
  };

  let done = 0;
  let failed = 0;
  let blocked = 0;
  let next = 0;
  // Failures since the last Seed that landed or was refused. A refusal resets it,
  // because a vendor that refuses a Prompt is answering, which is not the
  // tool-has-stopped-working pattern this counts.
  let inARow = 0;
  let stopped: StopInfo | undefined;
  const halt = (info: StopInfo) => {
    // The first reason wins. A second worker failing the same way while the first
    // was halting is the same halt, not a new one.
    if (stopped) return;
    stopped = info;
    report({ kind: "stop", ...info });
  };

  // Read through a call so the loop sees a halt another worker made while this one was waiting.
  const halted = () => stopped !== undefined;

  async function worker() {
    while (next < todo.length && !halted()) {
      const seed = todo[next++];
      // One sampling, asked for once, and everything the row about this Seed
      // comes from it: the Prompt that is sent and the attributes that are
      // recorded. Drawing twice would let the two describe different Portraits,
      // and the row would say so.
      const sample = folder.sampleFor(seed, request.useNegative);
      try {
        if (request.dryRun) {
          report({ kind: "prompt", seed, prompt: sample.prompt });
          continue;
        }
        const buffer = await request.generate(sample.prompt, {
          seed,
          model: request.model,
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize,
        });
        // In this order, because it is the order a reader depends on: the Frame
        // is on disk before it is counted, and counted before it is reported.
        // The provenance goes down with the bytes, because a row that records
        // what was asked for and not who asked it is half a record.
        await folder.writeFrame({
          seed,
          buffer,
          sample,
          source: "api",
          provider: request.provider,
          model: request.model,
          attributesSource: "run",
          params,
        });
        done++;
        inARow = 0;
        report({ kind: "seed", seed, ok: true, blocked: false });
      } catch (err) {
        // A Frame refused as it arrived is not a call that failed: the folder has
        // already written the one row that says what happened, with the
        // quarantine on it, and recording it again here would append a second
        // plain failure that became the latest and lost all of that. So the run
        // reports it and leaves the record alone.
        if (err instanceof FrameQuarantined) {
          failed++;
          report({ kind: "seed", seed, ok: false, blocked: false, message: err.message });
          countFailure(err.message);
          continue;
        }
        // A Provider reports a refusal as a code rather than as prose, so this
        // decision cannot be changed by rewording a message. Everything else is
        // a failure the next run might clear, and the Seed keeps waiting.
        const isBlocked = err instanceof GenerationFailure && err.code === "prompt-refused";
        const error = err instanceof Error ? err.message : String(err);
        if (isBlocked) blocked++;
        else failed++;
        // Recorded before it is reported, so a Seed reported as finished is on
        // the record as finished, and one reported as failed keeps waiting. The
        // sampling goes on the row even here: the Prompt was sent, so what it
        // was made of is a fact about the attempt rather than a thing that
        // happened only on success.
        folder.recordAttempt({
          seed,
          sample,
          source: "api",
          provider: request.provider,
          model: request.model,
          attributesSource: "run",
          params,
          status: isBlocked ? "blocked" : "failed",
          error,
        });
        report({ kind: "seed", seed, ok: false, blocked: isBlocked, message: error });
        // A failure about the account rather than the Seed ends the run here. The
        // Seed itself was recorded as failed above, so it keeps waiting.
        if (err instanceof GenerationFailure && isStopping(err.code)) {
          halt({ reason: err.code, message: error, ...(err.resetsAt ? { resetsAt: err.resetsAt } : {}) });
        } else if (isBlocked) {
          inARow = 0;
        } else {
          countFailure(error);
        }
      } finally {
        // After the row, whichever way it went: the Provider's own files go last.
        if (!request.dryRun) request.afterAttempt?.(seed);
      }
    }
  }

  function countFailure(message: string) {
    inARow++;
    if (request.stopAfterFailures !== undefined && inARow >= request.stopAfterFailures)
      halt({
        reason: "repeated-failure",
        message: `${inARow} Seeds failed in a row. The last one said: ${message}`,
      });
  }

  await Promise.all(Array.from({ length: running }, worker));
  return { done, failed, blocked, ...(stopped ? { stopped } : {}) };
}
