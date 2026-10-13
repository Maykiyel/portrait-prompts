import "dotenv/config";
import { geminiGenerator, MODELS } from "../core/gemini";
import {
  run, type Generator, type ProgressEvent, type RunResult,
} from "../core/generate";

/** What the command line was asked to do. `defaults` below is the policy. */
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

export const defaults: Omit<CliOptions, "salt"> = {
  count: 10,
  concurrency: 3,
  model: MODELS.flash,
  aspectRatio: "2:3",
  imageSize: "1K",
  outDir: "out",
  useNegative: true,
  dryRun: false,
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

function parseArgs(argv: string[]): CliOptions {
  const o: CliOptions = { ...defaults, salt: (process.env.SEED_SALT ?? "").trim() };
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
