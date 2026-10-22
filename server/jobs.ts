import type { GenerateRequest, JobState } from "../shared/api-types";
import {
  aspectFor, modelOf, readiness, runPartsFor, sizeFor, type ProviderRegistry,
} from "../core/providers";
import { run } from "../core/generate";
import { policyFor } from "../core/policy";
import type { Dataset } from "./store";

const fresh = (): JobState => ({ status: "idle", total: 0, done: 0, failed: 0, blocked: 0, log: [] });

/** Why the Job cannot start. The route turns this into a response, so no error here carries a status. */
export type Refusal = { status: 400 | 409; message: string };

/**
 * What the Job refuses, in the order it refuses it. Everything the module raises
 * arrives as a code instead.
 *
 * The Provider named by the request is asked all of it — does it exist, can it
 * run (for most, is its key present), does it offer this model, can it make this size or this shape —
 * because each of those is a fact about the vendor rather than about the run.
 * Nothing here knows what any vendor is called; a request for one that is not in
 * the registry is refused by name.
 */
export async function refusalFor(
  current: JobState,
  registry: ProviderRegistry,
  req: GenerateRequest,
): Promise<Refusal | undefined> {
  if (current.status === "running") return { status: 409, message: "A job is already running" };
  const provider = registry[req.provider];
  if (!provider) return { status: 400, message: `Unknown provider: ${req.provider}` };
  const ready = await readiness(provider);
  if (!ready.ok) return { status: 400, message: ready.message };
  if (!Number.isInteger(req.count) || req.count < 1 || req.count > 500)
    return { status: 400, message: "count must be a whole number from 1 to 500" };
  const model = modelOf(provider, req.model);
  if (!model) return { status: 400, message: `Unknown model for ${provider.label}` };
  const plan = sizeFor(provider, model, req.size);
  // Refused rather than quietly answered with a size this Provider cannot make.
  if (!plan.ok) return { status: 400, message: plan.refused };
  // The shape is the policy's, because the request carries no ratio at all: the
  // browser has no control for one, so asking the Provider about it here is the
  // one way a shape it cannot make is caught before a Frame is paid for. Should
  // the policy ever name a ratio a Provider cannot produce, this is the line that
  // says so rather than a wall of Frames that came back at the wrong shape.
  const shape = aspectFor(provider, policyFor(registry, provider.id).aspectRatio);
  if (!shape.ok) return { status: 400, message: shape.refused };
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
 * The dataset and the registry of Providers are taken at build time for the same
 * reason the routes close over theirs: the Job writes Frames into the same
 * archive the routes serve, so it takes the same pointed-at folder rather than
 * reaching for the environment to find one, and it is handed the thing that makes
 * images rather than naming a vendor itself. The registry rather than one
 * Generator, because a request names which Provider to use and the Job has to be
 * able to answer with that one rather than with whichever it was built holding.
 *
 * It starts from the core's generation policy and lets the request override
 * what the request names, the same way the command line starts from it and lets
 * its flags override. Neither declares its own, so the terminal and the browser
 * cannot drift apart on the model or the concurrency. The policy is asked for
 * against the registry this Job was built holding, because the default model is
 * a fact about the Provider that holds it.
 *
 * The one Job decision that stays here rather than becoming policy is the size,
 * because it is a question about the Provider rather than about the run: the size
 * is whatever the Provider says it can make with the model that was named. The
 * concurrency is no longer decided here at all — the run clamps to the ceiling
 * the Provider publishes and reports having done it, so this hands the number over
 * instead of applying it and leaving a second copy of the rule behind.
 *
 * It translates, and that is all it does. The total comes from the run's start
 * event, the counts and the log come from the per-Seed events, and none of it
 * arrives as text: the browser's progress bar and log are built from these
 * events, not from lines printed anywhere.
 */
export function createJob({ outDir, salt }: Dataset, registry: ProviderRegistry): Job {
  let current = fresh();

  const start = (req: GenerateRequest) => {
    // Unreachable through the route, which refuses all of these first.
    // Answered rather than assumed, because a Job that quietly started on a
    // different model would write a Manifest row naming one it was not asked to
    // make, and that row is the record of what made a Frame.
    const refuse = (error: string): JobState => {
      current = { ...fresh(), status: "error", error };
      return current;
    };

    const provider = registry[req.provider];
    if (!provider) return refuse(`Unknown provider: ${req.provider}`);
    const model = modelOf(provider, req.model);
    if (!model) return refuse(`Unknown model for ${provider.label}`);
    const plan = sizeFor(provider, model, req.size);
    if (!plan.ok) return refuse(plan.refused);

    current = {
      ...fresh(),
      status: "running",
      provider: provider.id,
      model: model.model,
      startedAt: new Date().toISOString(),
    };
    run({
      ...policyFor(registry, provider.id),
      count: req.count,
      concurrency: req.concurrency,
      model: model.model,
      imageSize: plan.size,
      useNegative: req.useNegative,
      outDir,
      salt,
      ...runPartsFor(provider),
      onEvent: (event) => {
        // One branch per kind of event, the same dispatch `cli/generate.ts` makes:
        // `kind` is what says which event this is, never the presence or absence
        // of one of its fields.
        if (event.kind === "start") {
          current.total = event.total;
        } else if (event.kind === "clamp") {
          // A limit that bit is one line beside the counts, and it is kept rather
          // than printed: this Job is watched through a route, so a clamp the
          // browser never hears about is the silent substitution the ADR refuses,
          // wearing the numbers of a run that simply went more slowly.
          current.notice =
            `Asked for ${event.asked} Frames at once, and this provider takes ` +
            `${event.running}, so ${event.running} run at a time.`;
        } else if (event.kind === "stop") {
          // Kept beside the counts like a clamp, and for the same reason: the
          // browser has to hear why a run ended early, or a halt reads as a run
          // that simply had fewer Seeds.
          current.stopped = { reason: event.reason, message: event.message, ...(event.resetsAt ? { resetsAt: event.resetsAt } : {}) };
        } else if (event.kind === "seed") {
          // Three outcomes, because they are three things. A Seed made is done, a
          // Seed refused is finished, and a Seed that failed keeps waiting.
          if (event.ok) current.done++;
          else if (event.blocked) current.blocked++;
          else current.failed++;
          current.log = [
            { seed: event.seed, ok: event.ok, blocked: event.blocked, message: event.message },
            ...current.log,
          ].slice(0, 50);
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