import type { GenerateRequest, JobState } from "../shared/api-types";
import { defaults, run } from "../generate";
import { MODELS } from "../gemini";
import { ApiError, OUT } from "./store";

const fresh = (): JobState => ({ status: "idle", total: 0, done: 0, failed: 0, log: [] });
let job: JobState = fresh();

export const getJob = () => job;

export function startJob(req: GenerateRequest, salt: string) {
  if (job.status === "running") throw new ApiError(409, "A job is already running");
  if (!process.env.GEMINI_API_KEY) throw new ApiError(400, "GEMINI_API_KEY is not set. Add it to .env and restart the server.");
  if (!Number.isInteger(req.count) || req.count < 1 || req.count > 500) throw new ApiError(400, "count must be a whole number from 1 to 500");
  const model = MODELS[req.model];
  if (!model) throw new ApiError(400, "Unknown model");
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
      outDir: OUT,
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
