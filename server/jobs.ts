import type { GenerateRequest, JobState } from "../shared/api-types";
import { MODELS } from "../core/gemini";
import { run, type Generator } from "../core/generate";
import { policy } from "../core/policy";
import type { Dataset } from "./store";

const fresh = (): JobState => ({ status: "idle", total: 0, done: 0, failed: 0, log: [] });
let job: JobState = fresh();

export const getJob = () => job;

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
 * The Job is a module global for now — one per process, and giving the app its
 * own is #32's work. Only the dataset and the Generator are injected: the Job
 * writes Frames into the same archive the routes serve, so it takes the same
 * pointed-at folder rather than reaching for the environment to find one, and
 * it is handed the thing that makes images rather than naming a vendor itself.
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
export function startJob(req: GenerateRequest, { outDir, salt }: Dataset, generate: Generator) {
  const model = MODELS[req.model];
  const size = req.model === "lite" ? "1K" : req.size;

  job = { ...fresh(), status: "running", model, startedAt: new Date().toISOString() };
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
      if (event.kind === "start") {
        job.total = event.total;
      } else if (event.kind === "seed") {
        if (event.ok) job.done++;
        else job.failed++;
        job.log = [{ seed: event.seed, ok: event.ok, message: event.message }, ...job.log].slice(0, 50);
      }
      // A dry run reports Prompts rather than results and never reaches here
      // from the browser: the Job sets no flags, so there is nothing to report.
    },
  })
    .then(() => {
      job.status = "done";
      job.finishedAt = new Date().toISOString();
    })
    .catch((err: unknown) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = new Date().toISOString();
    });
  return job;
}
