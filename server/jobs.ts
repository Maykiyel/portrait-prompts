import type { GenerateRequest, JobState } from "../shared/api-types";
import { defaults, run } from "../generate";
import { MODELS } from "../gemini";
import { outDir } from "./store";

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

export function startJob(req: GenerateRequest, salt: string) {
  const model = MODELS[req.model];
  const size = req.model === "lite" ? "1K" : req.size;

  job = { ...fresh(), status: "running", model, startedAt: new Date().toISOString() };
  run(
    {
      ...defaults,
      count: req.count,
      model,
      imageSize: size,
      concurrency: Math.min(Math.max(1, req.concurrency), 8),
      useNegative: req.useNegative,
      outDir: outDir(),
      salt,
    },
    undefined,
    {
      onStart: (total) => (job.total = total),
      onResult: (r) => {
        if (r.ok) job.done++;
        else job.failed++;
        job.log = [{ seed: r.seed, ok: r.ok, message: r.message }, ...job.log].slice(0, 50);
      },
    },
  )
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
