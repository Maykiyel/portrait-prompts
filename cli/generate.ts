import "dotenv/config";
import { geminiGenerator, MODELS } from "../core/gemini";
import {
  run, type Generator, type ProgressEvent, type RunResult,
} from "../core/generate";
import { policy } from "../core/policy";

/**
 * What the command line was asked to do. Every generation value here is the
 * core's default until a flag says otherwise; see `core/policy.ts`, which the
 * Job reads too.
 */
export type CliOptions = {
  /** Leave undefined to continue from the seed counter. */
  start?: number;
  count: number;
  concurrency: number;
  model: string;
  aspectRatio: string;
  imageSize: string;
  outDir: string;
  useNegative: boolean;
  dryRun: boolean;
  /** Handed in by whoever started the run, never read from the environment here. */
  salt: string;
};

/**
 * The adapter: it renders what the run reports and sets the exit code, and it
 * owns nothing else. Every format string below is a byte contract, so they live
 * here where the lines are printed rather than in the module that does the work.
 */
export async function generateImages(options: CliOptions, generate: Generator): Promise<RunResult> {
  // The command line shows how many Frames have landed so far, which is a
  // rendering decision: the run reports which Seeds succeeded and in what
  // order, and the adapter counts them, so `ok (1/2)` exists nowhere in the core.
  let landed = 0;
  let total = 0;
  const render = (event: ProgressEvent) => {
    if (event.kind === "start") {
      total = event.total;
      const range = event.range ? ` | seeds ${event.range.first} to ${event.range.last}` : "";
      console.log(
        `${event.version} | ${options.model} | ${event.total} to generate, ${event.alreadyDone} already done${range}`,
      );
    } else if (event.kind === "prompt") {
      console.log(`\n[${event.seed}] ${event.prompt}`);
    } else if (event.ok) {
      landed++;
      console.log(`[${event.seed}] ok (${landed}/${total})`);
    } else {
      console.error(`[${event.seed}] failed: ${event.message}`);
    }
  };

  const result = await run({ ...options, generate, onEvent: render });
  // A dry run wrote nothing, so it has nothing to summarise.
  if (!options.dryRun) {
    console.log(`\nDone. ${result.done} ok, ${result.failed} failed. Output in ${options.outDir}/`);
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
 */
export function parseArgs(argv: string[]): CliOptions {
  const o: CliOptions = {
    ...policy,
    outDir: "out",
    dryRun: false,
    salt: (process.env.SEED_SALT ?? "").trim(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === "--") continue;
    else if (a === "--start") o.start = Number(v());
    else if (a === "--count") o.count = Number(v());
    else if (a === "--concurrency") o.concurrency = Number(v());
    else if (a === "--model") {
      const m = v();
      o.model = (MODELS as Record<string, string>)[m] ?? m;
    } else if (a === "--aspect") o.aspectRatio = v();
    else if (a === "--size") o.imageSize = v();
    else if (a === "--out") o.outDir = v();
    else if (a === "--no-negative") o.useNegative = false;
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`Unknown flag ${a}`);
  }
  return o;
}

// Only run the CLI when this file is the entry point.
if (process.argv[1]?.endsWith("generate.ts")) {
  generateImages(parseArgs(process.argv.slice(2)), geminiGenerator).then(({ failed }) => {
    if (failed > 0) process.exitCode = 1;
  });
}
