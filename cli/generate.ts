import "dotenv/config";
import {
  aspectFor, providers, runPartsFor, sizeFor, type ProviderRegistry,
} from "../core/providers";
import {
  run, type ProgressEvent, type RunRequest, type RunResult,
} from "../core/generate";
import { policyFor } from "../core/policy";

/**
 * What the command line was asked to do. Every generation value here is the
 * core's default until a flag says otherwise; see `core/policy.ts`, which the
 * Job reads too.
 *
 * It is `Pick<RunRequest, ...>` for the same reason the policy is. The run's own
 * shape, so a field the run does not take cannot be declared here without the
 * typecheck turning red. The hand-written list of ten fields this replaces was
 * passed straight into `run()` by a spread, and TypeScript checks a spread for
 * what is missing but never for what is left over — so a field the run had
 * renamed away was quietly ignored rather than refused, and a field it had
 * retyped was refused for a reason pointing somewhere else.
 *
 * `generate` and `onEvent` are the adapter's own and are left out: the Provider
 * is chosen from a registry handed in by whoever called this, and the renderer
 * is this module. What remains is the generation policy plus the command line's
 * own four — where the dataset lives when nobody says, whether to look before
 * spending, the Seed salt and the starting Seed.
 */
export type CliOptions = Pick<
  RunRequest,
  | "start" | "count" | "concurrency" | "provider" | "model" | "aspectRatio" | "imageSize"
  | "outDir" | "useNegative" | "dryRun" | "salt"
>;

/**
 * The adapter: it renders what the run reports and sets the exit code, and it
 * owns nothing else. Every format string below is a byte contract, so they live
 * here where the lines are printed rather than in the module that does the work.
 *
 * The registry is handed in rather than imported here, so a test can run this
 * whole adapter against a Provider that makes images without a network.
 */
export async function generateImages(
  options: CliOptions,
  registry: ProviderRegistry,
): Promise<RunResult> {
  // Read from the registry that was handed in, not from the one the module
  // imports, so a test that hands over a Provider which makes images without a
  // network is the one that runs.
  const provider = registry[options.provider];
  if (!provider) throw new Error(`Unknown provider: ${options.provider}`);

  // The command line shows how many Frames have landed so far, which is a
  // rendering decision: the run reports which Seeds succeeded and in what
  // order, and the adapter counts them, so `ok (1/2)` exists nowhere in the core.
  // One branch per kind of event, the same dispatch the Job's own makes: `kind`
  // is what says which event this is, never the presence or absence of a field.
  // Anything that was not a start or a prompt used to fall through to the last
  // branch and be announced as a failed Seed, so a kind added later would have
  // been reported as a failure without anyone having decided it was one.
  let landed = 0;
  let total = 0;
  const render = (event: ProgressEvent) => {
    if (event.kind === "start") {
      total = event.total;
      const range = event.range ? ` | seeds ${event.range.first} to ${event.range.last}` : "";
      console.log(
        `${event.version} | ${options.model} | ${event.total} to generate, ${event.alreadyDone} already done${range}`,
      );
    } else if (event.kind === "clamp") {
      // Said here rather than where it happens, because this is the module that
      // owns every byte on a terminal: the run reports that it clamped and leaves
      // the wording to whoever is watching, and a person who asked for 100 at once
      // and got eight is owed the reason before the first Seed lands.
      console.log(`--concurrency ${event.asked} is more than this provider takes, so ${event.running} at a time.`);
    } else if (event.kind === "stop") {
      // On stderr, beside the failures that led to it, and before the summary,
      // so the last thing a person reads is how many Seeds are still waiting.
      const resets = event.resetsAt ? ` It clears ${event.resetsAt}.` : "";
      console.error(`Stopped (${event.reason}): ${event.message}${resets}`);
    } else if (event.kind === "prompt") {
      console.log(`\n[${event.seed}] ${event.prompt}`);
    } else if (event.kind === "seed") {
      if (event.ok) {
        landed++;
        console.log(`[${event.seed}] ok (${landed}/${total})`);
      } else if (event.blocked) {
        // Announced apart from a failure, because it is not one: nothing failed,
        // the Prompt was refused and will be refused again.
        console.error(`[${event.seed}] blocked: ${event.message}`);
      } else {
        console.error(`[${event.seed}] failed: ${event.message}`);
      }
    }
  };

  const result = await run({
    ...options,
    // The Provider's generator, ceiling, halt rule, cleanup and wrapper, handed to
    // the run rather than applied here. The run owns each rule and says when it
    // used one, and a second copy beside the flags is the copy that stops being true.
    ...runPartsFor(provider),
    onEvent: render,
  });
  // A dry run wrote nothing, so it has nothing to summarise.
  if (!options.dryRun) {
    console.log(`\nDone. ${result.done} ok, ${result.failed} failed. Output in ${options.outDir}/`);
    if (result.blocked)
      console.log(
        `${result.blocked} blocked: the Prompt was refused, so those Seeds will not be offered again.`,
      );
    if (result.failed) console.log("Failed seeds stay pending and run first next time.");
  }
  return result;
}

/**
 * argv in, the options the run is asked for. Exported so the no-flag start can
 * be observed without spawning this file as a process, which is what proves
 * the command line begins from the core's policy rather than from a copy of it.
 *
 * The policy supplies every generation value. The two that are not generation
 * policy are the command line's own: where the dataset lives when nobody says,
 * and whether to look before spending. Both are a flag away from being anything
 * else, and neither is a default the Job would want.
 *
 * The registry is handed in rather than imported, the same one `generateImages` is
 * given, so the flags resolve against the Providers this caller actually has: a
 * module that resolved them against its own import would be answering with a
 * vendor's catalog in a test that asked about a different one, and would name a
 * Provider nobody running this command has.
 *
 * `--model` and `--provider` are resolved after the loop, not where they are
 * found, because a model key only means something beside a Provider and the two
 * flags may be written in either order. The same is true of the default model: a
 * request that names another Provider gets that Provider's default rather than
 * the one it inherited, because a Gemini model id handed to OpenAI fails every
 * Seed instead of making the wrong picture. A model may be named by its key or by
 * the vendor's own string, so `--model gpt-image-2.5-flare` still works.
 */
export function parseArgs(argv: string[], registry: ProviderRegistry): CliOptions {
  const o: CliOptions = {
    ...policyFor(registry),
    outDir: "out",
    dryRun: false,
    salt: (process.env.SEED_SALT ?? "").trim(),
  };
  let modelKey: string | undefined;
  let namedProvider = o.provider;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === "--") continue;
    else if (a === "--start") o.start = Number(v());
    else if (a === "--count") o.count = Number(v());
    else if (a === "--concurrency") o.concurrency = Number(v());
    else if (a === "--model") modelKey = v();
    else if (a === "--provider") namedProvider = v() ?? namedProvider;
    else if (a === "--aspect") o.aspectRatio = v();
    else if (a === "--size") o.imageSize = v();
    else if (a === "--out") o.outDir = v();
    else if (a === "--no-negative") o.useNegative = false;
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`Unknown flag ${a}`);
  }

  const provider = registry[namedProvider];
  // Refused by name, with the same words the route uses, because a Provider id
  // that is in no registry cannot become a run and a flag that quietly falls back
  // to the default is a run nobody asked for.
  if (!provider) throw new Error(`Unknown provider: ${namedProvider}`);
  const model =
    (modelKey && provider.models.find((m) => m.id === modelKey || m.model === modelKey)) ||
    // No `--model`: the default is this Provider's own, asked of the catalog that
    // holds it rather than of the provider named in the flags.
    provider.models.find((m) => m.model === policyFor(registry, namedProvider).model);
  if (!model) throw new Error(`Unknown model for ${provider.label}`);
  o.provider = namedProvider;
  o.model = model.model;
  // Both limits refused here rather than at the API, so an image that cannot be
  // made costs nothing to discover. The size resolves first because a model with
  // exactly one size answers it rather than refusing it.
  const plan = sizeFor(provider, model, o.imageSize);
  if (!plan.ok) throw new Error(plan.refused);
  o.imageSize = plan.size;
  const shape = aspectFor(provider, o.aspectRatio);
  if (!shape.ok) throw new Error(shape.refused);
  return o;
}

// Only run the CLI when this file is the entry point.
if (process.argv[1]?.endsWith("generate.ts")) {
  generateImages(parseArgs(process.argv.slice(2), providers), providers).then(({ failed, blocked }) => {
    if (failed > 0 || blocked > 0) process.exitCode = 1;
  });
}