import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertSalt, claimSeeds, currentSalt, loadTemplate, logManifest, pad, saveImage } from "./common";
import { buildPrompt } from "./sampler";
import { geminiGenerator, MODELS, type Generator } from "./gemini";

export type RunOptions = {
  /** Leave undefined to continue from the seed counter. */
  start?: number;
  count: number;
  concurrency: number;
  model: string;
  aspectRatio: string;
  imageSize: string;
  outDir: string;
  width: number;
  height: number;
  useNegative: boolean;
  dryRun: boolean;
};

export const defaults: RunOptions = {
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

export async function run(opts: RunOptions, generate: Generator = geminiGenerator, hooks: RunHooks = {}) {
  assertSalt(opts.outDir);
  const { version, template, negative } = loadTemplate();

  const seeds =
    opts.start !== undefined
      ? Array.from({ length: opts.count }, (_, i) => opts.start! + i)
      : claimSeeds(opts.outDir, opts.count, !opts.dryRun);
  const todo = seeds.filter((s) => !existsSync(join(opts.outDir, `${pad(s)}.png`)));
  console.log(
    `${version} | ${opts.model} | ${todo.length} to generate, ${seeds.length - todo.length} already done` +
      (todo.length ? ` | seeds ${todo[0]} to ${todo[todo.length - 1]}` : ""),
  );

  hooks.onStart?.(todo.length);
  let done = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < todo.length) {
      const seed = todo[next++];
      let prompt = buildPrompt(template, seed).trim();
      // Gemini has no negative prompt field, so the list goes into the prompt text.
      if (opts.useNegative) prompt += `\n\nAvoid: ${negative}.`;

      const log = { seed, version, salt: currentSalt(), model: opts.model, prompt };
      try {
        if (opts.dryRun) {
          console.log(`\n[${seed}] ${prompt}`);
          continue;
        }
        const buf = await generate(prompt, opts);
        await saveImage(buf, seed, opts);
        logManifest(opts.outDir, { ...log, status: "ok" });
        done++;
        hooks.onResult?.({ seed, ok: true });
        console.log(`[${seed}] ok (${done}/${todo.length})`);
      } catch (err) {
        failed++;
        const error = err instanceof Error ? err.message : String(err);
        logManifest(opts.outDir, { ...log, status: "failed", error });
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
  const o = { ...defaults };
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
