import "dotenv/config";
import { geminiGenerator, MODELS, type Generator } from "./gemini";
import { openOutputFolder, type OutputFolder } from "./output-folder";

export type RunOptions = {
  /** Leave undefined to continue from the seed counter. */
  start?: number;
  count: number;
  concurrency: number;
  model: string;
  aspectRatio: string;
  imageSize: string;
  outDir: string;
  /** The module crops every Frame, so these no longer change the result. */
  width: number;
  height: number;
  useNegative: boolean;
  dryRun: boolean;
  /** Handed in by whoever started the run, never read from the environment here. */
  salt: string;
};

export const defaults: Omit<RunOptions, "salt"> = {
  count: 10,
  concurrency: 3,
  model: MODELS.flash,
  aspectRatio: "2:3",
  imageSize: "1K",
  outDir: "out",
  width: 768,
  height: 1152,
  useNegative: true,
  dryRun: false,
};

export type RunHooks = {
  onStart?: (total: number) => void;
  onResult?: (r: { seed: number; ok: boolean; message?: string }) => void;
};

/**
 * The Seeds named with --start. The module only hands a Frame to a waiting Seed,
 * so a run over Seeds the counter never issued asks it for the gap first. A dry
 * run writes nothing and moves nothing, exactly as it did before.
 */
function namedSeeds(folder: OutputFolder, start: number, count: number, commit: boolean): number[] {
  folder.waitingSeeds(); // the Seed salt guard, before any work
  const last = start + count;
  let next = folder.status().next ?? 1;
  if (commit) {
    while (next < last) {
      const take = Math.min(500, last - next);
      folder.issueSeeds(take);
      next += take;
    }
  }
  return Array.from({ length: count }, (_, i) => start + i);
}

export async function run(opts: RunOptions, generate: Generator = geminiGenerator, hooks: RunHooks = {}) {
  const folder = openOutputFolder(opts.outDir, opts.salt);

  const seeds =
    opts.start !== undefined
      ? namedSeeds(folder, opts.start, opts.count, !opts.dryRun)
      : folder.claimSeeds(opts.count, !opts.dryRun);
  const todo = seeds.filter((seed) => !folder.hasFrame(seed));
  console.log(
    `${folder.status().version} | ${opts.model} | ${todo.length} to generate, ${seeds.length - todo.length} already done` +
      (todo.length ? ` | seeds ${todo[0]} to ${todo[todo.length - 1]}` : ""),
  );

  hooks.onStart?.(todo.length);
  let done = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < todo.length) {
      const seed = todo[next++];
      const prompt = folder.promptFor(seed, opts.useNegative);

      try {
        if (opts.dryRun) {
          console.log(`\n[${seed}] ${prompt}`);
          continue;
        }
        const buffer = await generate(prompt, opts);
        await folder.writeFrame({ seed, buffer, model: opts.model, prompt });
        done++;
        hooks.onResult?.({ seed, ok: true });
        console.log(`[${seed}] ok (${done}/${todo.length})`);
      } catch (err) {
        failed++;
        const error = err instanceof Error ? err.message : String(err);
        folder.recordAttempt({ seed, model: opts.model, prompt, status: "failed", error });
        hooks.onResult?.({ seed, ok: false, message: error });
        console.error(`[${seed}] failed: ${error}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  if (!opts.dryRun) {
    console.log(`\nDone. ${done} ok, ${failed} failed. Output in ${opts.outDir}/`);
    if (failed) console.log("Failed seeds stay pending and run first next time.");
  }
  return { done, failed };
}

function parseArgs(argv: string[]): RunOptions {
  const o: RunOptions = { ...defaults, salt: (process.env.SEED_SALT ?? "").trim() };
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
  run(parseArgs(process.argv.slice(2))).then(({ failed }) => {
    if (failed > 0) process.exitCode = 1;
  });
}
