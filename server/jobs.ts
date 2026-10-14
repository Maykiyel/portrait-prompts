import type { GenerateRequest, JobState } from "../shared/api-types";
import { MODELS } from "../core/gemini";
import { run, type Generator } from "../core/generate";
import { policy } from "../core/policy";
import type { Dataset } from "./store";

const fresh = (): JobState => ({ status: "idle", total: 0, done: 0, failed: 0, log: [] });

/** Why the Job cannot start. The route turns this into a response, so no error here carries a status. */
export type Refusal = { status: 400 | 409; message: string };

/** What the Job refuses, in the order it refuses it. Everything the module raises arrives as a code instead. */
export function refusalFor(current: JobState, hasApiKey: boolean, req: GenerateRequest): Refusal | undefined {
  if (current.status === "running") return { status: 409, message: "A job is already running" };
  if (!hasApiKey) return { status: 400, message: "GEMINI_API_KEY is not set. Add it to .env and restart the server." };
  if (!Number.isInteger(req.count) || req.count < 1 || req.count > 500)
    return { status: 400, message: "count must be a whole number from 1 to 500" };
  if (!MODELS[req.model]) return { status: 400, message: "Unknown model" };
  return undefined;
}

/**
 * What one app can ask of the Job it holds. Two operations, because those are
 * the two routes there are: the state the browser polls, and the start it asks
 * for. The refusal is not among them — it is a question about a request rather
 * than an action, and `refusalFor` answers it without knowing which app is
 * asking.
 */
export type Job = {
  /** The Job as it stands. The same value until something happens to it. */
  state: () => JobState;
  /** Begins one. Refuse first: see `refusalFor`. Answers at once, before the run has finished. */
  start: (req: GenerateRequest) => JobState;
};

/**
 * The Job one app holds, built here and closed over rather than kept at module
 * scope. A module global would be one Job for every app in the process, so two
 * apps would take turns writing over each other's counts and one app's start
 * would be refused as a second start by another app. Held here, it belongs to
 * the app that serves it: still one at a time, still reset on restart because
 * nothing is written down, and still nothing persisted — the Manifest already
 * records every Attempt, so a lost progress display after a restart costs
 * nothing that was not already on disk.
 *
 * The dataset and the Generator are taken at build time for the same reason the
 * routes close over theirs: the Job writes Frames into the same archive the
 * routes serve, so it takes the same pointed-at folder rather than reaching for
 * the environment to find one, and it is handed the thing that makes images
 * rather than naming a vendor itself.
 *
 * It starts from the core's generation policy and lets the request override
 * what the request names, the same way the command line starts from it and lets
 * its flags override. Neither declares its own, so the terminal and the browser
 * cannot drift apart on the model or the concurrency. Two of the Job's own
 * decisions stay here because they are Job rules rather than policy: the
 * concurrency is clamped to what the server will run at once, and the lite
 * model gets 1K because that is the only size it supports.
 *
 * It translates, and that is all it does. The total comes from the run's start
 * event, the counts and the log come from the per-Seed events, and none of it
 * arrives as text: the browser's progress bar and log are built from these
 * events, not from lines printed anywhere.
 */
export function createJob({ outDir, salt }: Dataset, generate: Generator): Job {
  let current = fresh();

  const start = (req: GenerateRequest) => {
    const model = MODELS[req.model];
    const size = req.model === "lite" ? "1K" : req.size;

    current = { ...fresh(), status: "running", model, startedAt: new Date().toISOString() };
    run({
      ...policy,
      count: req.count,
      model,
      imageSize: size,
      concurrency: Math.min(Math.max(1, req.concurrency), 8),
      useNegative: req.useNegative,
      outDir,
      salt,
      generate,
      onEvent: (event) => {
        // One branch per kind of event, the same dispatch `cli/generate.ts` makes:
        // `kind` is what says which event this is, never the presence or absence
        // of one of its fields.
        if (event.kind === "start") {
          current.total = event.total;
        } else if (event.kind === "seed") {
          if (event.ok) current.done++;
          else current.failed++;
          current.log = [{ seed: event.seed, ok: event.ok, message: event.message }, ...current.log].slice(0, 50);
        }
        // A dry run reports Prompts rather than results and never reaches here
        // from the browser: the Job sets no flags, so there is nothing to report.
      },
    })
      .then(() => {
        current.status = "done";
        current.finishedAt = new Date().toISOString();
      })
      .catch((err: unknown) => {
        current.status = "error";
        current.error = err instanceof Error ? err.message : String(err);
        current.finishedAt = new Date().toISOString();
      });
    return current;
  };

  return { state: () => current, start };
}
