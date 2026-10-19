# Provider integration: change map

An investigation of the repo as it stands at commit-time, for adding a second
image-generation provider alongside Gemini. Every quote below is verbatim from
the file named, with the line numbers the file has today. Nothing here evaluates
the design; it only reports what is where.

Repo: `D:\Projects\portrait-prompts`. Files read: `shared/api-types.ts`,
`core/generate.ts`, `core/output-folder.ts`, `core/gemini.ts`, `core/policy.ts`,
`core/errors.ts`, `core/sampler.ts`, `server/index.ts`, `server/jobs.ts`,
`server/store.ts`, `cli/generate.ts`, `cli/status.ts`, `cli/import-images.ts`,
`test/smoke-test.ts`, `test/smoke-cli.ts`, `test/smoke-audit.ts`,
`test/smoke-harness.ts`, `test/no-network.ts`, the `web/src/` status consumers,
`.oxlintrc.json`, `.env.example`, `package.json`, `tsconfig.json`,
`vite.config.ts`, `README.md`, `GLOSSARY.md`, `.github/workflows/ci.yml`.

Note: `.tmp-research/interactions.openapi.json` exists in the working tree,
untracked, from an earlier session. It is a `.json`, so `test/smoke-audit.ts`'s
source-file walk (`/\.(?:tsx?|[cm]?js)$/`, smoke-audit.ts:73) does not read it and
it is invisible to the audit and the linter's `ignorePatterns`. It does not
constrain this work, but it should not be committed.

---

## 1. `shared/api-types.ts` in full (49 lines)

This is the whole HTTP contract. Four of the five exports are type-only aliases;
only `Status`, `GenerateRequest` and `JobState` are shapes the browser and server
agree on by hand.

```ts
// The module that owns the output folder defines its own types. The three below
// are the wire shapes that are genuinely identical to it, so they are named here
// rather than restated; nothing in the core imports anything from this file, and
// these are type-only imports, so the browser never pulls the module in and with
// it the image library.
import type { FrameRecord, ImportedFrame, PromptItem } from "../core/output-folder";

export type ImageItem = FrameRecord;
export type ImportResult = ImportedFrame;
export type { PromptItem };

export type Status = {
  version: string;
  /** Null when the folder cannot be read. Never a guess at Seed 1: see the ADR. */
  next: number | null;
  done: number;
  /** Null when the folder cannot be read, which is not the same as zero waiting. */
  waiting: number | null;
  saltSet: boolean;
  hasApiKey: boolean;
  /** Set when the saved output folder cannot be used, for example after the salt changed. */
  problem?: string;
};

export type PromptsResponse = {
  items: PromptItem[];
};

export type ImportResponse = { results: ImportResult[] };

export type GenerateRequest = {
  count: number;
  model: "lite" | "flash" | "pro";
  size: "1K" | "2K" | "4K";
  concurrency: number;
  useNegative: boolean;
};

export type JobState = {
  status: "idle" | "running" | "done" | "error";
  model?: string;
  total: number;
  done: number;
  failed: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  log: { seed: number; ok: boolean; message?: string }[];
};
```

Line index for the fields that matter here:

- `12` `export type Status = {`
- `20` `  hasApiKey: boolean;`
- `31-37` `GenerateRequest`, with `33` the hardcoded model union
  `"lite" | "flash" | "pro"` and `34` the size union `"1K" | "2K" | "4K"`.
- `39-49` `JobState`, with `41` `model?: string;` and `48` the per-Seed log entry
  `{ seed: number; ok: boolean; message?: string }[]`. There is no place on
  `JobState` or on a log entry to carry a third outcome today: `ok: boolean` plus
  a free-text `message` is the whole vocabulary on the wire.

---

## 2. `core/generate.ts` in full (175 lines)

```ts
import { namedSeeds, openOutputFolder } from "./output-folder";

/**
 * The seam the run stands on: something that turns a Prompt into image bytes.
 * It is declared here rather than beside the vendor client on purpose. This
 * module names no vendor, so it cannot import one — which means the shape of
 * what it needs is stated here, and the vendor client implements it.
 */
export type GenOptions = {
  model: string;
  aspectRatio: string;
  imageSize: string;
};

export type Generator = (prompt: string, opts: GenOptions) => Promise<Buffer>;

/** How the run reports one thing that happened. Read with `kind`. */
export type StartEvent = {
  kind: "start";
  /** Seeds this run will generate Frames for. */
  total: number;
  /** Seeds this run claimed that already had a Frame. */
  alreadyDone: number;
  /**
   * The Seeds it will generate, first and last. Absent when there is nothing
   * to generate: the range would be invented, and a caller that renders a
   * header has a real clause to leave out rather than a sentinel to hide.
   */
  range?: { first: number; last: number };
  /** The Prompt version every Frame this run writes will carry. */
  version: string;
};

/** How the run reports one Seed's outcome. A failed Seed keeps a Seed of its own: it stays waiting. */
export type SeedEvent = {
  kind: "seed";
  seed: number;
  ok: boolean;
  /** Why it failed. Present when it did. */
  message?: string;
};

/**
 * How the run reports a Prompt it would have sent. A dry run has no outcome to
 * report, so the Prompt is the whole of what happened to that Seed.
 */
export type PromptEvent = {
  kind: "prompt";
  seed: number;
  prompt: string;
};

/** Everything the run reports, in the order it happened. */
export type ProgressEvent = StartEvent | SeedEvent | PromptEvent;

/**
 * What one run was asked to do. Every value is concrete: the run never has to be
 * told what "ten" means. The default generation policy that callers start from
 * is stated once in `core/policy.ts`, beside this module, and each caller
 * overrides what it means to override — so a dry run is not a default of
 * anything's, and the run itself holds no opinion about any value.
 */
export type RunRequest = {
  /** How many Seeds to claim. Waiting Seeds are finished before fresh ones. */
  count: number;
  /** How many Frames to generate at once. At least one worker always runs. */
  concurrency: number;
  /** The model to generate with. Handed to the Generator and recorded in the Manifest. */
  model: string;
  /** Image shape, handed to the Generator. */
  aspectRatio: string;
  imageSize: string;
  /** Whether the Prompt carries the Negative list. */
  useNegative: boolean;
  /** The output folder to work in. */
  outDir: string;
  /** The Seed salt that folder was started with. */
  salt: string;
  /** What makes the images. Required, not defaulted: this module names no vendor. */
  generate: Generator;
  /** Name the first Seed by hand, filling the gap up to the last one. Absent follows the Seed counter. */
  start?: number;
  /**
   * Claim without committing: report the Prompts, write nothing, move nothing.
   * Absent means a real run. It is optional because a caller that never wants a
   * dry run should say nothing rather than say `false` and look as though it
   * had chosen — the Job, which has no dry run, names neither flag.
   */
  dryRun?: boolean;
  /**
   * Where progress goes. Optional, so a caller that wants only the result is
   * left alone and this module stays silent.
   */
  onEvent?: (event: ProgressEvent) => void;
};

/** What a run came to, for the caller to render or refuse on. */
export type RunResult = { done: number; failed: number };

/**
 * Claims Seeds, generates Frames, records Attempts, and reports what happened.
 *
 * Progress arrives as data through `onEvent` rather than as text, and that is
 * the whole reason this module is its own. It used to print every line itself,
 * so no caller could ask for quiet and a caller that wanted to know what had
 * happened had to read a terminal. The channel is a plain callback because a
 * promise cannot report anything before it resolves, a handle object would
 * exist only to be cancelled and nothing cancels it, and a second return value
 * would arrive after the work rather than during it. Events are delivered as
 * they happen and in the order they happened, so a caller rendering them live
 * sees what a person at a terminal would have.
 *
 * There is no `console.*` here and no terminal to catch output from. A check in
 * the suite watches the console across a run, because silence is a claim about
 * what a caller sees rather than about what this file says.
 */
export async function run(request: RunRequest): Promise<RunResult> {
  const folder = openOutputFolder(request.outDir, request.salt);
  const report = (event: ProgressEvent) => request.onEvent?.(event);

  // Which Seeds this run touches is answered here and nowhere else. The
  // explicit start fills the gap up to the last Seed it names; otherwise the
  // counter does the asking, which finishes Waiting Seeds first. A dry run
  // claims without committing, so looking at the work costs nothing.
  const seeds =
    request.start !== undefined
      ? namedSeeds(folder, request.start, request.count, !request.dryRun)
      : folder.claimSeeds(request.count, !request.dryRun);
  const todo = seeds.filter((seed) => !folder.hasFrame(seed));

  report({
    kind: "start",
    version: folder.status().version,
    total: todo.length,
    alreadyDone: seeds.length - todo.length,
    ...(todo.length ? { range: { first: todo[0], last: todo[todo.length - 1] } } : {}),
  });

  let done = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < todo.length) {
      const seed = todo[next++];
      const prompt = folder.promptFor(seed, request.useNegative);
      try {
        if (request.dryRun) {
          report({ kind: "prompt", seed, prompt });
          continue;
        }
        const buffer = await request.generate(prompt, {
          model: request.model,
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize,
        });
        // In this order, because it is the order a reader depends on: the Frame
        // is on disk before it is counted, and counted before it is reported.
        await folder.writeFrame({ seed, buffer, model: request.model, prompt });
        done++;
        report({ kind: "seed", seed, ok: true });
      } catch (err) {
        failed++;
        const error = err instanceof Error ? err.message : String(err);
        // Recorded before it is reported, so a Seed reported as failed is on
        // the record as failed and keeps waiting for the next run.
        folder.recordAttempt({ seed, model: request.model, prompt, status: "failed", error });
        report({ kind: "seed", seed, ok: false, message: error });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, request.concurrency) }, worker));
  return { done, failed };
}
```

### The five things asked for, pinpointed

**How Attempts are recorded.** Two sites, one per outcome, and they are not
symmetric:

- Success — `core/generate.ts:159`:
  `await folder.writeFrame({ seed, buffer, model: request.model, prompt });`
  The run never names a status. `writeFrame` appends the `ok` Attempt itself at
  `core/output-folder.ts:321` (`recordAttempt({ ...frame, status: "ok" });`).
- Failure — `core/generate.ts:167`:
  `folder.recordAttempt({ seed, model: request.model, prompt, status: "failed", error });`
  This is the only place in the whole run where a status literal appears.

**The exact status vocabulary used for an attempt by the run.** One literal,
`"failed"`, at `core/generate.ts:167`. Success is implicit via `writeFrame`. The
run has no third case: every `throw` from the Generator lands in the same `catch`
at `core/generate.ts:162` and becomes `"failed"`.

**How a per-seed failure is represented in the Manifest.** `core/generate.ts:167`
passes `{ seed, model, prompt, status: "failed", error }` to
`folder.recordAttempt`. `recordAttempt` then builds the row
(`core/output-folder.ts:300-309`), which adds `version` and `salt`, always
writes `prompt` (falling back to a freshly built Prompt if none was passed,
line 305) and writes `error` and `ts` only when present. Concrete row shape for
a failed generation Seed today:

```json
{"seed":7,"version":"portrait-v3","salt":"","model":"gemini-3.1-flash-image","prompt":"Generate an image. …","status":"failed","error":"GEMINI_API_KEY is not set. …","ts":"2026-10-16T09:12:34.567Z"}
```

**How `onEvent` / `ProgressEvent` reports failures.** `core/generate.ts:168`:
`report({ kind: "seed", seed, ok: false, message: error });` The word "failed"
never appears on the event; the shape is `ok: false` plus a message string. The
success counterpart at line 161 is `report({ kind: "seed", seed, ok: true });` —
note it carries no `message` key at all, which `test/smoke-test.ts:106` asserts
(`seedResults(first.events).every((e) => !("message" in e))`).

**The exact line where `model` is written into the Manifest.** Two:

- `core/generate.ts:159` — `model: request.model` inside the `writeFrame` call,
  which becomes an `ok` row.
- `core/generate.ts:167` — `model: request.model` inside the `recordAttempt` call,
  which becomes the `failed` row.

There is no third: `RunRequest.model` (`core/generate.ts:69`) is the only source
of that value on the run's path.

**Where a `provider` would have to enter this file.** `RunRequest` (63-95) if the
Manifest is to carry it, `GenOptions` (9-13) if the Generator is to receive it,
and both call sites that forward fields: lines 152-156 (into the Generator) and
159/167 (into the Manifest). Note `core/generate.ts:1` is the *only* import in
the file: `import { namedSeeds, openOutputFolder } from "./output-folder";`. The
audit in §11 reads that as a hard constraint.

---

## 3. `core/output-folder.ts` — the Manifest writer

### The Attempt parameter type, lines 31-40

```ts
export type Attempt = {
  seed: number;
  status: "ok" | "failed" | "rejected";
  model?: string;
  source?: "manual" | "api";
  file?: string;
  prompt?: string;
  error?: string;
  ts?: string;
};
```

`32` is the union a new `blocked` status would join. `33` is where a `provider`
would sit beside `model`. `34` `source?: "manual" | "api"` is a *different* axis
(provenance of the bytes: hand-imported vs made by a Generator) and is not a
provider — `FrameRecord.source` at line 23 is `"api" | "manual" | "unknown"`, and
it is derived, not stored per provider (see `listFrames` below).

The public interface declares the same name at line 67:

```ts
  recordAttempt(attempt: Attempt): void;
```

`FrameWrite` (42-50) is the sibling type `writeFrame` takes, and it is what the
`ok` row is built from:

```ts
export type FrameWrite = {
  seed: number;
  buffer: Buffer;
  model?: string;
  source?: "manual" | "api";
  file?: string;
  prompt?: string;
  ts?: string;
};
```

`FrameWrite` has no `status` field (line 321 supplies it) and no `error`.

### The Manifest row type, lines 73-81

```ts
type Counter = { next: number; salt: string };
type ManifestRow = {
  seed: number;
  status: string;
  version?: string;
  model?: string;
  source?: string;
  prompt?: string;
  ts?: string;
};
```

`ManifestRow` is module-private and is **not** `Attempt`: `status` is widened to
`string` (so `blocked` would parse without a type change), `error` and `file`
are missing from it entirely (they exist in the JSON but the reader ignores
them), and `salt` is present in the JSON but absent from the type. A `provider`
field would be added here at line 78-ish, after `model`.

The reader type that matters for the Gallery is `FrameRecord`, lines 20-27:

```ts
export type FrameRecord = {
  seed: number;
  version: string;
  source: "api" | "manual" | "unknown";
  model?: string;
  prompt: string;
  updatedAt: string;
};
```

This is the type the browser receives as `ImageItem` (`shared/api-types.ts:8`).

### `recordAttempt` in full, lines 291-310

```ts
  const recordAttempt = (attempt: Attempt): void => {
    validateSeed(attempt.seed);
    const counter = readCounter();
    assertSalt(counter);
    mkdirSync(root, { recursive: true });
    if (attempt.status === "rejected") {
      appendFileSync(manifestFile, JSON.stringify({ seed: attempt.seed, status: "rejected", ts: attempt.ts ?? new Date().toISOString() }) + "\n");
      return;
    }
    const { seed, model, source, file, prompt, status: result, error, ts } = attempt;
    const row: Record<string, unknown> = { seed, version, salt };
    if (model !== undefined) row.model = model;
    if (source !== undefined) row.source = source;
    if (file !== undefined) row.file = file;
    row.prompt = prompt ?? buildPrompt(template, seed, salt).trim();
    row.status = result;
    if (error !== undefined) row.error = error;
    if (ts !== undefined) row.ts = ts;
    appendFileSync(manifestFile, JSON.stringify(row) + "\n");
  };
```

Exact insertion points for a `provider`:

- **Input**: the destructure at line 300 — `const { seed, model, source, file, prompt, status: result, error, ts } = attempt;` — would gain `provider`. Miss this line and the field is dropped on the floor, because every field below is destructured explicitly. There is no `...attempt` spread here.
- **Output**: immediately after line 302 (`if (model !== undefined) row.model = model;`) a `if (provider !== undefined) row.provider = provider;` would put it beside `model` in the JSON, which is what "beside `model`" in the design means for the on-disk line.
- Note the conditional-write style at 302-304: absent fields are simply **not written at all**. There is no `null` and no default. This is the mechanism that makes old and new lines coexist.
- The `rejected` short-circuit at 296-299 returns before any of that and writes a three-key row `{ seed, status: "rejected", ts }`. A `blocked` status, if it wants to record a provider, must not fall into this branch (it will not, since the branch tests `=== "rejected"`).

### How rows are serialised to `out/manifest.jsonl`

Three facts, all from the code above:

1. `manifestFile` is defined at line 134: `const manifestFile = join(root, "manifest.jsonl");`
2. Serialisation is `appendFileSync(manifestFile, JSON.stringify(row) + "\n")` — line 309 for normal rows, line 297 for rejections. One JSON object per line, appended, never rewritten.
3. Key order in the emitted JSON follows insertion order of the `row` object: `seed`, `version`, `salt`, then whichever of `model` / `provider` / `source` / `file` were present, then `prompt`, `status`, `error`, `ts`. So a `provider` written after `model` lands between `model` and `source`.

`writeFrame` calls `recordAttempt({ ...frame, status: "ok" });` at line 321 —
that spread means `writeFrame` inherits any new `FrameWrite` field automatically.

A real line from the working copy of `out/manifest.jsonl`, for the shape of what
an old line looks like on disk:

```json
{"seed":1,"version":"portrait-v3","salt":"david-172004","source":"manual","file":"Gemini_Generated_Image_8g1m7m8g1m7m8g1m.jpg","prompt":"Photorealistic portrait photograph of one fictional adult, …"}
```

No `provider` key. A reader must tolerate that.

### How rows are read back — `readManifest`, lines 200-203

```ts
  const readManifest = (): ManifestRow[] => {
    if (!existsSync(manifestFile)) return [];
    return readFileSync(manifestFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ManifestRow);
  };
```

This is the answer to "how would absent fields behave when parsing old lines":
**the parse is an unchecked `as` cast with no validation whatsoever.** A missing
`provider` key yields `undefined` on the row object at runtime, and nothing in
the read path dereferences it unless code is written to. Adding
`provider?: string` to `ManifestRow` makes the reader's access type-safe without
any migration, because `undefined` is exactly what a missing optional key gives
you. (Contrast `readCounter` at lines 137-158, which *does* validate, and which
has a precedent comment at line 156: `// Before salt was recorded, old folders had no salt property at all.` — that is the house precedent for a defaulted field, and `row.salt ?? ""` at line 157 is how it was handled.)

### Where the Gallery's view comes from — `listFrames`, lines 253-270

```ts
  const listFrames = (): FrameRecord[] => {
    const latestOk = new Map<number, ManifestRow>();
    for (const row of readManifest()) {
      if (row.status === "ok") latestOk.set(row.seed, row);
      else if (row.status === "rejected") latestOk.delete(row.seed);
    }
    return frameSeeds().map((seed) => {
      const row = latestOk.get(seed);
      return {
        seed,
        version: row?.version ?? "unknown",
        source: row?.source === "manual" ? "manual" : row ? "api" : "unknown",
        model: row?.model,
        prompt: row?.prompt ?? "",
        updatedAt: statSync(frameFile(seed)).mtime.toISOString(),
      };
    });
  };
```

The Gallery path is *not* `readManifest` alone: it intersects the manifest with
the directory. `frameSeeds()` (lines 205-212) is the disk truth; `latestOk` is the
provenance. The only three statuses that do anything here are `"ok"` (256) and
`"rejected"` (257). A new `blocked` row would fall through both branches: it
neither records provenance nor erases it. So for a Seed whose *latest* row is
blocked but which still has a PNG on disk (an impossible state today, since
`writeFrame` only writes on success, but reachable if a blocked retry followed a
successful Frame that was never rejected), `listFrames` keeps the older `ok` row.

This is where the `"gemini"` default for old lines would be applied, if it is to
be applied at all: line 265's neighbourhood, `provider: row?.provider ?? "gemini"`.
Two shapes are available and they differ:

- `provider: row?.provider` — absent stays absent on the wire, and every consumer
  carries its own default. Matches `model` today (line 265) and matches
  `FrameRecord.model?: string`.
- `provider: row?.provider ?? "gemini"` — the default lives in the one module
  that owns the Manifest, and the wire shape becomes non-optional.

`test/smoke-audit.ts:130` forbids the literal `manifest.jsonl` anywhere outside
`core/output-folder.ts`, so the default cannot be applied at the Gallery or in
the browser; it must be applied here or nowhere.

### The failed count a `blocked` status would or would not move — `status`, lines 214-231

```ts
  const status = (): FolderStatus => {
    const done = frameSeeds().length;
    const latest = new Map<number, string>();
    for (const row of readManifest()) latest.set(row.seed, row.status);
    const failed = [...latest.values()].filter((value) => value === "failed").length;
    const base = { version, done, failed, saltSet: salt !== "" };
    try {
      const counter = readCounter();
      assertSalt(counter);
      const next = counter?.next ?? 1;
      let waiting = 0;
      for (let seed = 1; seed < next; seed++) if (!hasFrame(seed)) waiting++;
      return { ...base, next, waiting };
    } catch (err) {
      if (!(err instanceof ArchiveError)) throw err;
      return { ...base, next: null, waiting: null, problem: err.message, problemCode: err.code };
    }
  };
```

Line 217 keeps the **last** row per Seed, whatever its status. Line 218 counts
only `"failed"`. Consequences a `blocked` status must decide:

- A `blocked` row is **not** counted in `FolderStatus.failed`, so
  `cli/status.ts:22` would not print it and `test/smoke-cli.ts:61`'s byte
  contract stays valid for folders that have no blocked rows.
- A `blocked` row **displaces** a `failed` row for the same Seed, because line
  217 overwrites. So a Seed that failed once and was then blocked stops counting
  as failed. That is arguably correct (the last attempt is what counts, per
  `docs/adr/0001-disk-is-authoritative-for-frame-existence.md`) but it is a
  behaviour change, not a no-op.
- `FolderStatus` (lines 8-18) has no `blocked` count field. `FolderStatus.failed`
  is consumed by `cli/status.ts:22` and by `test/smoke-test.ts:561` and
  `test/smoke-cli.ts:67`.

---

## 4. `server/jobs.ts` in full (111 lines)

```ts
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
```

### The five things asked for, pinpointed

**`refusalFor` in full** — lines 9-20. Four refusals, in this order, and the
order is load-bearing because `test/smoke-test.ts:732-734` asks for the running
refusal with `hasApiKey === true`:

| line | refusal | asserted by |
| --- | --- | --- |
| 14 | `409 "A job is already running"` | smoke-test.ts:734, smoke-test.ts:1073-1074 |
| 15 | `400 "GEMINI_API_KEY is not set. Add it to .env and restart the server."` | smoke-test.ts:731 (`.includes("GEMINI_API_KEY")`) |
| 16-17 | `400 "count must be a whole number from 1 to 500"` | — |
| 18 | `400 "Unknown model"` | — |

The signature at line 13 takes `hasApiKey: boolean` as a *parameter*, computed by
the caller. That is deliberate and it is the seam: `server/index.ts:99` computes
it from the environment. A per-provider key presence changes the parameter to
something the registry answers for, and line 15's message stops being a
hardcoded literal.

**`Job` interface** — lines 29-34, quoted above. Two operations, `state()` and
`start(req)`. Nothing else.

**`JobState`** — not declared here; it is imported from the wire types at line 1
and is `shared/api-types.ts:39-49`.

**`start`** — lines 68-108, quoted above.

**`MODELS[req.model]` and the `lite ⇒ 1K` rule, exactly** — three lines:

```ts
  const start = (req: GenerateRequest) => {
    const model = MODELS[req.model];
    const size = req.model === "lite" ? "1K" : req.size;
```

- `server/jobs.ts:69` — `const model = MODELS[req.model];` The `MODELS` value is
  imported at line 2 (`import { MODELS } from "../core/gemini";`). This is the
  only place the Job resolves a request's model key to a vendor model id.
- `server/jobs.ts:70` — `const size = req.model === "lite" ? "1K" : req.size;` The
  `lite ⇒ 1K` rule, keyed on the **request key**, not on the resolved model id.
- `server/jobs.ts:76-77` — `model,` / `imageSize: size,` forwards both into the
  run, overriding `...policy` spread at line 74.

There is a matching rule in the browser, duplicated by hand:
`web/src/features/generate/generate-page.tsx:72` sends
`size: model === "lite" ? "1K" : size`, and `generate-page.tsx:81` and `:100`
disable the size control for `lite`. So the `lite ⇒ 1K` fact currently lives in
**three** places (jobs.ts:70, generate-page.tsx:72, and generate-page.tsx:81/100),
none of which is the model catalog. A provider that refuses 4K has no such
duplication today, and would need at least the jobs.ts equivalent.

Note also `server/jobs.ts:72`: `current = { ...fresh(), status: "running", model, startedAt: … }` — `JobState.model` is set from the *resolved* model id (the vendor string), which is what `test/smoke-test.ts:753` asserts (`startedAtOnce.model === "gemini-3.1-flash-image"`) and what `test/smoke-test.ts:897` and `:928` assert. A `provider` field on `JobState` would be set here too if the browser is to show which provider ran.

---

## 5. `server/store.ts` — `getStatus` and every `process.env` read

### `getStatus`, lines 38-41

```ts
  const getStatus = (): Status => {
    const { version, next, done, waiting, saltSet, problem } = archive().status();
    return { version, next, done, waiting, saltSet, problem, hasApiKey: Boolean(process.env.GEMINI_API_KEY) };
  };
```

Line 39 destructures `FolderStatus` (which carries `failed` and `problemCode` —
neither of which reaches the wire; see `core/output-folder.ts:8-18`). Line 40
mixes the archive's answers with one environment read. This is the **only**
`process.env` read in the file and the only place `Status.hasApiKey` is produced.

### Every `process.env` read in the repo (exhaustive)

| file:line | read |
| --- | --- |
| `core/gemini.ts:31` | `if (!process.env.GEMINI_API_KEY) {` |
| `server/store.ts:40` | `Boolean(process.env.GEMINI_API_KEY)` |
| `server/index.ts:99` | `Boolean(process.env.GEMINI_API_KEY)` |
| `server/index.ts:111` | `process.env.OUT_DIR ?? "out"` and `process.env.SEED_SALT ?? ""` |
| `server/index.ts:123` | `Number(process.env.PORT ?? 3001)` |
| `cli/generate.ts:92` | `(process.env.SEED_SALT ?? "").trim()` |
| `cli/status.ts:5` | `(process.env.SEED_SALT ?? "").trim()` |
| `cli/import-images.ts:81` | `(process.env.SEED_SALT ?? "").trim()` |
| `cli/export-prompts.ts:14` | `(process.env.SEED_SALT ?? "").trim()` |
| `test/smoke-cli.ts:34` | `{ ...process.env, SEED_SALT: "", GEMINI_API_KEY: "", ...env }` |
| `test/smoke-test.ts:484, 488, 490, 518, 625, 627, 744, 804, 805, 849, 850, 852, 853, 938-941, 992, 1044, 1098, 1099` | fixture setup / teardown |

**Two production reads of an API key exist today, in two different modules**
(`server/store.ts:40` for the status route, `server/index.ts:99` for the start
route). They are not shared, and a per-provider key-presence check would
otherwise be duplicated in both. `core/gemini.ts:31` is the third read, and it
is the one the CLI byte contract in §12 depends on.

---

## 6. `server/index.ts`

### Composition root, lines 109-127

```ts
// The composition root: the one place the environment names a dataset and the
// one place this process names a vendor. Both are read once here and handed on.
const dataset: Dataset = { outDir: process.env.OUT_DIR ?? "out", salt: (process.env.SEED_SALT ?? "").trim() };
const app = createApp(dataset, geminiGenerator);

// Built UI, when it exists. In development Vite serves the UI instead.
const dist = "./web/dist";
if (existsSync(`${dist}/index.html`)) {
  app.use("/*", serveStatic({ root: dist }));
  app.get("*", (c) => c.html(readFileSync(`${dist}/index.html`, "utf8")));
}

// Only listen when this file is the entry point, so importing it costs no port.
if (process.argv[1]?.endsWith("index.ts")) {
  const port = Number(process.env.PORT ?? 3001);
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    console.log(`API on http://127.0.0.1:${port}${existsSync(`${dist}/index.html`) ? " (serving the built UI)" : ""}`);
  });
}
```

The comment at 109-110 is the load-bearing one: *"the one place the environment
names a dataset and the one place this process names a vendor."* Line 7 is the
vendor import:

```ts
import { geminiGenerator } from "../core/gemini";
```

Line 112 is where `createApp` receives the Generator — **one argument, one
Generator, baked in.** A per-provider registry has to be resolved here (or handed
to `createApp`) for the `/generate` route to be able to start a job on the
non-default provider.

### `createApp` and how it receives the Generator, lines 29-49

```ts
/**
 * An app serves exactly one dataset, handed to it rather than found: the root
 * says which output folder, the salt says which run of Seeds is legitimate there.
 * Nothing inside reads the environment, so every app in a process is its own
 * dataset and a test can point one at a temporary directory. The Generator is
 * handed in with it rather than found either, so a route can start a Job without
 * naming an image vendor and a test can drive one with a fake.
 */
export function createApp(dataset: Dataset, generate: Generator): Hono {
  const app = new Hono();
  const store = createStore(dataset);
  // The Job belongs to this app and not to the process: built here and closed
  // over, so the routes below ask their own Job and no other app's, and a test
  // can hold one of its own.
  const job = createJob(dataset, generate);

  app.onError((err, c) => {
    if (err instanceof ArchiveError) return c.json({ error: err.message }, STATUS_BY_CODE[err.code]);
    console.error(err);
    return c.json({ error: err.message || "Something went wrong" }, 500);
  });
```

Line 37 signature, line 43 the single `createJob(dataset, generate)` call. The
doc comment at 33-35 states the rule the whole test suite leans on: a route can
start a Job without naming an image vendor, and a test can drive one with a
fake. **Every** app in `test/smoke-test.ts` is built with `good`, `bad` or
`held` — lines 632, 693, 770, 879, 920, 997, 1011, 1037, 1038. If the
Generator becomes a per-provider lookup, that second parameter is where the
tests' fakes go, and all nine call sites are affected.

Also in the composition root: `STATUS_BY_CODE` at lines 18-25 is the complete,
exhaustive `Record<ArchiveErrorCode, 400 | 404 | 409 | 500>`:

```ts
export const STATUS_BY_CODE: Record<ArchiveErrorCode, 400 | 404 | 409 | 500> = {
  "invalid-seed": 400,
  "invalid-count": 400,
  "missing-frame": 404,
  "seed-not-waiting": 409,
  "salt-mismatch": 409,
  "unreadable-counter": 500,
};
```

`test/smoke-test.ts:649` asserts `codes.length === 6` against this table's keys,
so **adding an `ArchiveErrorCode` breaks that assertion.** Generation failures do
not belong here — see §9.

### Every route, verbatim, lines 51-107

```ts
  const api = new Hono();
  api.get("/status", (c) => c.json(store.getStatus()));
  api.get("/prompts/pending", (c) => c.json(store.getPending(c.req.query("useNegative") === "1")));
  api.post("/prompts/new", async (c) => {
    const { count, useNegative } = await c.req.json<{ count: number; useNegative?: boolean }>();
    return c.json(store.addPrompts(count, useNegative === true));
  });

  api.get("/images", (c) => c.json(store.listImages()));
  api.get("/images/:seed/thumb", async (c) => {
    const width = Math.min(Math.max(Number(c.req.query("w") ?? 320), 80), 768);
    c.header("Content-Type", "image/webp");
    c.header("Cache-Control", "no-cache");
    return send(c, await store.readThumbnail(Number(c.req.param("seed")), width));
  });
  api.get("/images/:seed/file", (c) => {
    const seed = Number(c.req.param("seed"));
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "no-cache");
    if (c.req.query("download") === "1") c.header("Content-Disposition", `attachment; filename="${seedLabel(seed)}.png"`);
    return send(c, store.readFrame(seed, c.req.query("raw") === "1"));
  });
  api.post("/images/:seed/reject", (c) => {
    store.rejectFrame(Number(c.req.param("seed")));
    return c.json({ ok: true });
  });

  api.post("/import", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const raw = body.files;
    const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File);
    let seeds: number[];
    try {
      // The batch is checked as an array here, before anything reads it: a Seed
      // list that parsed into something else is a bad request, not a crash.
      const parsed: unknown = JSON.parse(String(body.seeds ?? "[]"));
      if (!Array.isArray(parsed)) return c.json({ error: "seeds must be a JSON array" }, 400);
      seeds = parsed as number[];
    } catch {
      return c.json({ error: "seeds must be a JSON array" }, 400);
    }
    const refused = importRefusal(seeds);
    if (refused) return c.json({ error: refused.message }, refused.status);
    return c.json({ results: await store.importFiles(files, seeds) });
  });

  api.post("/generate", async (c) => {
    const req = await c.req.json<GenerateRequest>();
    const refused = refusalFor(job.state(), Boolean(process.env.GEMINI_API_KEY), req);
    if (refused) return c.json({ error: refused.message }, refused.status);
    return c.json(job.start(req));
  });
  api.get("/generate/job", (c) => c.json(job.state()));

  app.route("/api", api);
  return app;
}
```

**`/generate` (97-102)** — line 98 takes the body as `GenerateRequest` with no
validation of its own, line 99 computes key presence from the environment
inline and hands it to `refusalFor`, line 101 starts the Job. Three provider
touch points: the request shape, the key presence, and the Generator the Job
holds.

**`/status` (52)** — `api.get("/status", (c) => c.json(store.getStatus()));` One
line. It has no idea a key exists; the shape comes from `server/store.ts:40`.

---

## 7. `cli/generate.ts` in full (119 lines)

```ts
import "dotenv/config";
import { geminiGenerator, MODELS } from "../core/gemini";
import {
  run, type Generator, type ProgressEvent, type RunRequest, type RunResult,
} from "../core/generate";
import { policy } from "../core/policy";

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
 * `generate` and `onEvent` are the adapter's own and are left out: the Generator
 * is handed in by whoever called this, and the renderer is this module. What
 * remains is the generation policy plus the command line's own four — where the
 * dataset lives when nobody says, whether to look before spending, the Seed salt
 * and the starting Seed.
 */
export type CliOptions = Pick<
  RunRequest,
  | "start" | "count" | "concurrency" | "model" | "aspectRatio" | "imageSize"
  | "outDir" | "useNegative" | "dryRun" | "salt"
>;

/**
 * The adapter: it renders what the run reports and sets the exit code, and it
 * owns nothing else. Every format string below is a byte contract, so they live
 * here where the lines are printed rather than in the module that does the work.
 */
export async function generateImages(options: CliOptions, generate: Generator): Promise<RunResult> {
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
    } else if (event.kind === "prompt") {
      console.log(`\n[${event.seed}] ${event.prompt}`);
    } else if (event.kind === "seed") {
      if (event.ok) {
        landed++;
        console.log(`[${event.seed}] ok (${landed}/${total})`);
      } else {
        console.error(`[${event.seed}] failed: ${event.message}`);
      }
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
    salt: (process.env.SED_SALT ?? "").trim(),
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
```

### The three things asked for, pinpointed

**The complete argument parser** — `parseArgs`, lines 87-112. Line 89 spreads
`...policy` as the base, so every generation value is the core's default until a
flag says otherwise. Lines 94-110 are a flat `if / else if` chain over `argv`,
one flag per branch, with `const v = () => argv[++i];` at line 96 as the value
reader. Line 109 is the catch-all: `throw new Error(\`Unknown flag ${a}\`);` — an
unknown flag **kills the process with an uncaught throw** before any Frame is
asked for, which is what `test/smoke-cli.ts:212-218` relies on to say "it parses
every flag before a single Frame is asked for".

**`--model` handling** — lines 101-103:

```ts
    else if (a === "--model") {
      const m = v();
      o.model = (MODELS as Record<string, string>)[m] ?? m;
    }
```

It is a two-way lookup: a short key resolves through `MODELS` (imported at line
2), anything else passes through untouched as a literal model id. So
`--model lite` becomes `gemini-3.1-flash-lite-image`, and `--model gemini-3-pro-image`
stays as typed. `test/smoke-cli.ts:224` asserts exactly the resolved form in the
header; `test/smoke-test.ts:908` asserts `allFlags.model === MODELS.lite`. Note
that the lookup is done at *parse* time and the resulting vendor string is what
lands in `CliOptions.model` — which is also what gets written into the Manifest
(`core/generate.ts:159`/`:167`). There is no record of whether the user typed
`lite` or the full id; only the resolved string survives.

**The entry-point guard** — lines 114-119, verbatim above:

```ts
if (process.argv[1]?.endsWith("generate.ts")) {
  generateImages(parseArgs(process.argv.slice(2)), geminiGenerator).then(({ failed }) => {
    if (failed > 0) process.exitCode = 1;
  });
}
```

`process.argv[1]?.endsWith("generate.ts")` — a basename-suffix test, so
importing this module for tests costs nothing (`test/smoke-cli.ts:14` and
`test/smoke-test.ts:18` both import it in-process). Line 116 passes
`geminiGenerator` as a literal argument; a `--provider` flag would have to change
what is passed there, since the Generator is now chosen by provider.

**The header line** — lines 53-55 build
`` `${event.version} | ${options.model} | ${event.total} to generate, ${event.alreadyDone} already done${range}` ``.
Five byte contracts in `test/smoke-cli.ts` assert on this exact string (see §12).

---

## 8. `core/policy.ts` (43 lines) and `core/gemini.ts` (63 lines), in full

### `core/policy.ts`

```ts
import { MODELS } from "./gemini";
import type { RunRequest } from "./generate";

/**
 * What a generation run does when nobody has said otherwise: which model, how
 * many Seeds, how many at a time, what shape, how big, and whether the Prompt
 * carries the Negative list.
 *
 * It is stated once, here, beside the run rather than in either of the callers.
 * The command line reads it and lets its flags override the relevant value; the
 * Job reads it and lets the request override the relevant values. Neither
 * declares its own, so the terminal and the browser cannot come to disagree
 * about the model or the concurrency.
 *
 * It is `Pick<RunRequest, ...>` on purpose. That is the run's own shape, so the
 * policy cannot state a value the run would not take, and the excess-property
 * check on an object literal means a value the run does *not* take — a dry run,
 * a folder, a salt — cannot be added here without the typecheck turning red.
 * Those three are not generation policy and do not belong here: a dry run has no
 * business being the server's default, a dataset's root is where the data lives
 * and is injected by whoever owns the dataset, and a Seed salt is never a
 * default at all — it is handed in by whoever starts a run, so that two people
 * running the same workbench get different Prompts rather than the same ones.
 *
 * This is a module of its own beside `core/generate.ts` rather than a line in
 * it, for one reason: naming the default model means naming a vendor, and
 * `core/generate.ts` deliberately names no vendor and stands on nothing but the
 * module that owns the output folder. Putting the model string here keeps the
 * run's import graph free of the vendor client — `MODELS` lives in the module
 * that owns the model names, so this file reads them rather than repeating them.
 */
export type GenerationPolicy = Pick<
  RunRequest,
  "count" | "concurrency" | "model" | "aspectRatio" | "imageSize" | "useNegative"
>;

export const policy: GenerationPolicy = {
  count: 10,
  concurrency: 3,
  model: MODELS.flash,
  aspectRatio: "2:3",
  imageSize: "1K",
  useNegative: true,
};
```

Two facts that constrain any provider work here:

- Line 1 `import { MODELS } from "./gemini";` is a **value** import, so
  `core/policy.ts` transitively loads `@google/genai` at module load. That is why
  `test/smoke-cli.ts:17` can import `policy` and get the model string without a
  network call, and it is why the audit in §11 has to exempt `core/policy.ts` by
  graph reasoning (it is not in the run's graph at all).
- Line 34 is a `Pick<RunRequest, …>` over exactly six fields. `RunRequest` is at
  `core/generate.ts:63-95`. Adding `provider` to `RunRequest` **without** adding
  it to this `Pick` is legal TypeScript and would leave the policy unable to
  name a default provider; adding it to the `Pick` forces the object literal at
  37-44 to supply one. The excess-property-check rationale in the comment
  (lines 16-18) is the reason this is a `Pick` and not a hand-written type.

### `core/gemini.ts`

```ts
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
// The seam is declared by the module that stands on it, so this file is the
// implementation of a shape it does not own. It is a type-only import: nothing
// here is needed to name the Generator, and the run never loads this module.
import type { Generator } from "./generate";

export const MODELS = {
  lite: "gemini-3.1-flash-lite-image", // fastest and cheapest, 1K only
  flash: "gemini-3.1-flash-image", // default, general use
  pro: "gemini-3-pro-image", // highest quality
} as const;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const msg = e?.message ?? "";
  // Quota blocks never clear on a retry, so fail fast.
  if (/limit: 0|upgrade your tier|per day/i.test(msg)) return false;
  const status = e?.status ?? e?.statusCode;
  if (status && RETRYABLE.has(status)) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|overloaded/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let client: GoogleGenAI | undefined;

export const geminiGenerator: Generator = async (prompt, opts) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
  }
  client ??= new GoogleGenAI({});

  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      const interaction = await client.interactions.create({
        model: opts.model,
        input: prompt,
        response_format: {
          type: "image",
          aspect_ratio: opts.aspectRatio,
          image_size: opts.imageSize,
        },
      });
      const img = interaction.output_image;
      if (!img?.data) {
        const text = interaction.output_text ?? "no text returned";
        throw new NoImageError(`No image in response. Model said: ${text}`);
      }
      return Buffer.from(img.data, "base64");
    } catch (err) {
      if (err instanceof NoImageError || attempt >= maxAttempts || !isRetryable(err)) throw err;
      const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      console.warn(`  retry ${attempt}/${maxAttempts - 1} in ${Math.round(wait)}ms`);
      await sleep(wait);
    }
  }
};

export class NoImageError extends Error {}
```

Points a second provider has to answer for, all in this one file:

- **31-33** — the key check happens **before** the client is constructed, and the
  message is a plain `Error` with a fixed string. That ordering is what makes
  `test/smoke-cli.ts:255-284` work offline, and the message is the byte contract.
- **34** — `client ??= new GoogleGenAI({})` is a module-level lazy singleton
  (declared line 28).
- **14-24** — the retryability policy is a regex over messages
  (`/limit: 0|upgrade your tier|per day/i`, `/fetch failed|ECONNRESET|ETIMEDOUT|overloaded/i`)
  plus a status-code set. **This is the closest thing to a classification of
  "retrying cannot fix" that exists today**, and it is expressed as *message
  matching inside the vendor client*, not as a signal that crosses the seam. A
  `blocked` status needs this classification to become data.
- **57** — `console.warn(...)` on retry. Legal here only because this file is
  **not** in `core/generate.ts`'s import graph. See §11.
- **63** — `export class NoImageError extends Error {}` — the only error type in
  the generation path, and it is exported, local, and never caught outside this
  file (only at line 55). It carries no code and no status; its entire identity is
  `instanceof`, used to opt out of retrying.

---

## 9. Is there an error-code vocabulary for generation failures?

**No.** Confirmed by reading and by grepping. The complete vocabulary of codes in
the repo is `ArchiveErrorCode` in `core/errors.ts:5-11`:

```ts
export type ArchiveErrorCode =
  | "unreadable-counter"
  | "salt-mismatch"
  | "missing-frame"
  | "seed-not-waiting"
  | "invalid-count"
  | "invalid-seed";
```

Its only producer is `core/output-folder.ts` (lines 112, 118, 143, 149, 154, 162,
275, 281, 282, 317, 328, 330, 334, 356). Its only consumers are
`core/output-folder.ts:17`/`:229` (`problemCode` on `FolderStatus`) and
`server/index.ts:18-25` (`STATUS_BY_CODE`) / `:46`.

Generation failures are **message strings only**, and they lose their type
immediately:

| produced at | type | survives to |
| --- | --- | --- |
| `core/gemini.ts:32` no key | `Error` | message string |
| `core/gemini.ts:51` no image | `NoImageError` | message string (rethrown at `:55`, caught by the run, `err.message` at `core/generate.ts:164`) |
| `core/gemini.ts:54` vendor error | whatever the SDK throws | message string |
| anything from `request.generate` | whatever | `core/generate.ts:164` `const error = err instanceof Error ? err.message : String(err);` |
| run could not start at all | `ArchiveError` from the folder | `server/jobs.ts:102-106` → `JobState.error: string` |

`core/generate.ts:164` is the single place the type is discarded. Everything
downstream of it — `SeedEvent.message` (`core/generate.ts:40`), the Manifest's
`error` field (`core/output-folder.ts:307`), the `JobState.log[].message`
(`server/jobs.ts:92`), `JobState.error` (`server/jobs.ts:104`) — is a string.

Consequences for a `blocked` status:

- **`blocked` cannot be produced by the run today** without a change at or above
  `core/generate.ts:164`, because the run has no way to tell one failure from
  another once it has a message. Options visible in the code: an error subclass
  the run `instanceof`-checks (the `NoImageError` precedent, which the run does
  *not* use today), or a `GenOptions`→result change so the Generator returns a
  discriminated outcome instead of throwing.
- **`blocked` is not in `ArchiveErrorCode`, and should not be.** Adding it would
  break `test/smoke-test.ts:648-649`, which asserts
  `codes.length === 6 && codes.every((code) => typeof STATUS_BY_CODE[code] === "number")`
  over `Object.keys(STATUS_BY_CODE)`, and it would demand a row in
  `server/index.ts:18-25`. A generation failure never reaches the route's error
  handler: it is caught per-Seed inside the run (`core/generate.ts:162`) and the
  route has already answered 200 (`server/jobs.ts:101`).
- The `Attempt["status"]` union (`core/output-folder.ts:33`) is where `blocked`
  belongs on disk, and `FolderStatus.failed`'s filter
  (`core/output-folder.ts:218`) is where it becomes visible to `cli/status.ts`.

---

## 10. The `Status` consumers in the browser

### Who calls `useStatus`

| site | what it reads |
| --- | --- |
| `web/src/shared/lib/status-api.ts:9` | the hook itself; typed `Status` at `:2`/`:6` |
| `web/src/app/app-shell.tsx:22` | `const { data: status } = useStatus();` then `status.waiting` (`:47-48`) and `status.problem` (`:67`, `:72`) |
| `web/src/features/overview/overview-page.tsx:14` | full page: `version`, `next`, `done`, `waiting`, `saltSet`, `problem`, **`hasApiKey`** |
| `web/src/features/generate/generate-page.tsx:21` | **`hasApiKey`** only |

`web/src/shared/lib/status-api.ts` in full (9 lines):

```ts
import { useQuery } from "@tanstack/react-query";
import type { Status } from "@shared/api-types";
import { http } from "./http";
import { keys } from "./query-keys";

const status = () => http.get<Status>("/status").then((r) => r.data);

// Read by the Overview and Generate pages and by the shell's waiting badge.
export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: status });
```

### `hasApiKey` — both sites, quoted

`web/src/features/generate/generate-page.tsx:44`:

```ts
  const noKey = status.data ? !status.data.hasApiKey : false;
```

and its two uses in the same file — `:55-66` (the warning alert) and `:129`
(disabling the submit button):

```tsx
      {noKey && (
        <Alert variant="warning" className="mb-6">
          <KeyRound />
          <AlertTitle>No API key found</AlertTitle>
          <AlertDescription>
            <p>Add GEMINI_API_KEY to .env and restart the server. Image models have no free API tier.</p>
            <Button asChild size="sm" variant="outline" className="mt-1 text-foreground">
              <Link to="/prompts">Use the free route instead</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
```

```tsx
          <Button type="submit" disabled={!valid || noKey || running || start.isPending}>
            {running ? "Generating" : `Generate ${valid ? n : ""} images`}
          </Button>
```

The vendor name is written out in three places in this one file: `:52` (the
page description "Make images through the Gemini API"), `:58` ("No API key
found"), `:60` ("Add GEMINI_API_KEY to .env…").

`web/src/features/overview/overview-page.tsx:106-107`:

```tsx
        <dt className="text-muted-foreground">Gemini API key</dt>
        <dd>{s.hasApiKey ? "Set" : "Not set"}</dd>
```

A per-provider record would need a `<dl>` row per provider here, and this file's
other two rows (`:99-105`) are the house style for it.

### Other `/api/status` fields read in the browser

- `app-shell.tsx:47-48` — `!!status?.waiting` and `status.waiting` (a number).
- `app-shell.tsx:67-72` — `status.problem`.
- `overview-page.tsx:30` — `s.done`, `s.waiting`; `:33` `s.saltSet && s.next === 1`;
  `:99-105` `s.version`, `s.next`, `s.saltSet`; `:584`-equivalent `s.problem`.
- `generate-page.tsx:44` — `hasApiKey`.

Nothing in the browser reads `next`, `done`, `waiting`, `saltSet` or `problem`
from anywhere else; `Status` has exactly one fetch site
(`status-api.ts:6`) and one query key (`query-keys.ts:5`, `status: ["status"]`,
invalidated by `useRefreshAll` at `query-keys.ts:17`).

### `web/src/features/generate/models.ts` in full (5 lines)

```ts
export const models = [
  { value: "flash", label: "Flash (default)" },
  { value: "lite", label: "Flash Lite (cheapest, 1K only)" },
  { value: "pro", label: "Pro (best quality)" },
] as const;
```

This is a **hand-maintained duplicate of `core/gemini.ts:8-12`'s `MODELS`** —
same three keys, in a different order, with display labels that the catalog does
not carry. It is not asserted against `MODELS` by any test. Its only consumer is
`generate-page.tsx:88-92`, and its `value`s must satisfy
`GenerateRequest["model"]` through the cast at `generate-page.tsx:80`
(`setModel(v as GenerateRequest["model"])`). Two providers means either two
lists plus a provider picker, or one list fed from a new endpoint.

### `web/src/features/generate/start-job.ts` in full (14 lines)

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { GenerateRequest, JobState } from "@shared/api-types";
import { http } from "@/shared/lib/http";
import { keys } from "@/shared/lib/query-keys";

const startJob = (req: GenerateRequest) => http.post<JobState>("/generate", req).then((r) => r.data);

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: GenerateRequest) => startJob(req),
    onSuccess: (job) => qc.setQueryData(keys.job, job),
  });
}
```

Nothing provider-shaped here: the request is passed straight through, so a new
`GenerateRequest` field is a type-level change only (the caller in
`generate-page.tsx:72` is what constructs it).

### `web/src/features/generate/generate-page.tsx` in full (173 lines)

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertCircle, KeyRound } from "lucide-react";
import type { GenerateRequest } from "@shared/api-types";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Progress } from "@/shared/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { PageHeader } from "@/shared/components/page-header";
import { useJob } from "@/shared/lib/job-api";
import { useRefreshAll } from "@/shared/lib/query-keys";
import { useStatus } from "@/shared/lib/status-api";
import { seedLabel } from "@/lib/text";
import { models } from "./models";
import { useStartJob } from "./start-job";

export function Generate() {
  const status = useStatus();
  const job = useJob();
  const start = useStartJob();
  const refresh = useRefreshAll();

  const [count, setCount] = useState("10");
  const [model, setModel] = useState<GenerateRequest["model"]>("flash");
  const [size, setSize] = useState<GenerateRequest["size"]>("1K");
  const [concurrency, setConcurrency] = useState("3");
  const [useNegative, setUseNegative] = useState(true);

  const state = job.data;
  const running = state?.status === "running";
  const finished = state?.status === "done" || state?.status === "error";

  // Refresh counts and the gallery once a job ends.
  useEffect(() => {
    if (finished) void refresh();
  }, [finished, refresh]);

  const n = Number(count);
  const c = Number(concurrency);
  const valid = Number.isInteger(n) && n >= 1 && n <= 500 && Number.isInteger(c) && c >= 1 && c <= 8;
  const noKey = status.data ? !status.data.hasApiKey : false;
  const handled = state ? state.done + state.failed : 0;
  const percent = state && state.total > 0 ? Math.round((handled / state.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Generate"
        description="Make images through the Gemini API. This needs a paid key. Without one, use the Prompts and Import pages."
      />

      {noKey && (
        <Alert variant="warning" className="mb-6">
          <KeyRound />
          <AlertTitle>No API key found</AlertTitle>
          <AlertDescription>
            <p>Add GEMINI_API_KEY to .env and restart the server. Image models have no free API tier.</p>
            <Button asChild size="sm" variant="outline" className="mt-1 text-foreground">
              <Link to="/prompts">Use the free route instead</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <form
        className="grid max-w-xl gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) start.mutate({ count: n, model, size: model === "lite" ? "1K" : size, concurrency: c, useNegative });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="model">Model</Label>
          <Select
            value={model}
            onValueChange={(v) => {
              setModel(v as GenerateRequest["model"]);
              if (v === "lite") setSize("1K");
            }}
          >
            <SelectTrigger id="model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="size">Size</Label>
            <Select value={model === "lite" ? "1K" : size} onValueChange={(v) => setSize(v as GenerateRequest["size"])} disabled={model === "lite"}>
              <SelectTrigger id="size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1K", "2K", "4K"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="n">Images</Label>
            <Input id="n" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c">At once</Label>
            <Input id="c" type="number" min={1} max={8} value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch id="avoid" checked={useNegative} onCheckedChange={setUseNegative} />
          <Label htmlFor="avoid">Add the "Avoid" line to each prompt</Label>
        </div>

        <div>
          <Button type="submit" disabled={!valid || noKey || running || start.isPending}>
            {running ? "Generating" : `Generate ${valid ? n : ""} images`}
          </Button>
        </div>
      </form>

      {state && state.status !== "idle" && (
        <section className="mt-8 max-w-xl">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-medium">
              {running ? "Generating" : state.status === "done" ? "Finished" : "Stopped"}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {handled} of {state.total}
              {state.failed > 0 && `, ${state.failed} failed`}
            </span>
          </div>
          <Progress value={percent} aria-label="Generation progress" />

          {state.error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle />
              <AlertTitle>The job stopped</AlertTitle>
              <AlertDescription>
                <p>{state.error}</p>
              </AlertDescription>
            </Alert>
          )}

          {state.log.length > 0 && (
            <ul className="mt-4 divide-y text-sm">
              {state.log.map((l) => (
                <li key={`${l.seed}-${l.ok}`} className="flex gap-3 py-1.5">
                  <span className="w-14 shrink-0 tabular-nums">{seedLabel(l.seed)}</span>
                  <span className={l.ok ? "text-done" : "text-destructive"}>{l.ok ? "Done" : (l.message ?? "Failed")}</span>
                </li>
              ))}
            </ul>
          )}
          {state.failed > 0 && !running && <p className="mt-3 text-sm text-muted-foreground">Failed seeds stay waiting and run first next time.</p>}
        </section>
      )}
    </>
  );
}
```

Provider-relevant lines, all in one file:

| line | what |
| --- | --- |
| 27 | `useState<GenerateRequest["model"]>("flash")` — the default model key is hardcoded in the browser |
| 28 | `useState<GenerateRequest["size"]>("1K")` |
| 44 | `!status.data.hasApiKey` |
| 52 | page description names Gemini |
| 58, 60 | the alert names the key env var |
| 72 | the request literal: `{ count: n, model, size: model === "lite" ? "1K" : size, concurrency: c, useNegative }` — **no `provider`** |
| 77-94 | the model `<Select>`, options from `./models` |
| 81 | `if (v === "lite") setSize("1K");` |
| 100 | `<Select value={model === "lite" ? "1K" : size} … disabled={model === "lite"}>` |
| 105 | `{["1K", "2K", "4K"].map(...)}` — **the size list is hardcoded here**, so a provider that refuses 4K needs this list to come from the provider |
| 129 | submit disabled on `noKey` |
| 143 | `, ${state.failed} failed` |
| 163 | `l.ok ? "Done" : (l.message ?? "Failed")` — the only render of a per-Seed outcome, and it has two branches for three states |
| 168 | "Failed seeds stay waiting and run first next time." |

---

## 11. `test/smoke-audit.ts` — the checks that constrain the integration

`runAudit()` is called once, at `test/smoke-test.ts:40`. Everything it checks is
asked of **source text on disk**, walked fresh, with `HARNESS` (everything under
`test/`) and `OWNER` exempt from being *audited* but not from being *read*
(`smoke-audit.ts:212-219`).

### The one that constrains the design most: "the generation run writes to no terminal and stands on no vendor", lines 289-325

```ts
  // The generation run writes to no terminal and names no image vendor. Asked of
  // the run and of everything it stands on rather than of one file's text, so a
  // print that arrives through a module the run imports counts as the run's
  // printing — and so the vendor client cannot come back in under the run's arm
  // without this turning red. A grep does the same job by hand; this does it on
  // every run, over the files as they are now.
  const RUN = "core/generate.ts";
  const textOf = (sources: Map<string, string>, file: string) =>
    sources.get(file) ?? readFileSync(join(repoRoot, file), "utf8");
  // The run's own text and every module it stands on. Comments are not code, so
  // a module that says in prose that it prints is not printing.
  const narrates = (sources: Map<string, string>, entry: string): string[] =>
    [entry, ...graphFrom(entry, sources)].filter((f) =>
      /console\.|@google\/genai/.test(code(textOf(sources, f))));
  const runGraph = graphFrom(RUN, sourceText);
  const narrators = narrates(sourceText, RUN);
  results.push(check(
    "the generation run writes to no terminal and stands on no vendor",
    // The graph has to be non-empty, or "nothing in it prints" is true of
    // nothing at all. Reaching the owner is what a run that touches the output
    // folder must do.
    known.has(RUN) && runGraph.has(OWNER) && runGraph.size > 1 && narrators.length === 0,
  ));
  for (const f of narrators) console.log(`      ${f} prints or names a vendor`);
```

What this means concretely for a provider registry:

- `graphFrom("core/generate.ts")` (209-223) walks **local relative imports
  transitively** (`localImports` = specifiers starting with `.`, line 201). A
  bare specifier like `openai` is not followed. Today the graph is exactly
  `{core/output-folder.ts}` (+ `core/sampler.ts`, which `output-folder.ts:6`
  imports) — `runGraph.size > 1` is satisfied at 310.
- If `core/generate.ts` gained **any** relative import of a provider module —
  including a registry — that module joins the graph, and the regex at 302 then
  reads its text. `core/gemini.ts:57`'s `console.warn` and line 2's `@google/genai`
  would both trip it. **This is the machine that enforces the design's "the
  registry lives in its own file that `core/generate.ts` never imports."**
- The regex is `/console\.|@google\/genai/` — **it names Google specifically.**
  A new `core/openai.ts` containing `console.warn` and `import OpenAI from "openai"`
  would *not* trip the vendor half of the regex, but it would trip the `console\.`
  half if it were in the graph. If the intent is "no vendor at all", the regex
  needs extending; if the intent is "no printing and no Google", it does not.
  Either way the graph must not include it.
- The vacuity proof at 317-325 plants a `console.log` into `RUN` and a
  `console.warn` into `OWNER` in memory and requires both to be named, while
  requiring neither to be named in the real tree:
  ```ts
  const own = new Map(sourceText);
  own.set(RUN, `${textOf(sourceText, RUN)}\nconsole.log("a print inside the run itself");\n`);
  const beneath = new Map(sourceText);
  beneath.set(OWNER, `${textOf(sourceText, OWNER)}\nconsole.warn("a print inside the module the run stands on");\n`);
  ```
  Extending the vendor half of the regex (e.g. to `|openai`) does **not** break
  this proof, which only exercises `console.`.

### The import-restriction checks that could catch a misfiled registry

**"every command-line entry point reaches the output folder through the core", lines 224-238:**

```ts
  const reachesThroughCore = (entry: string, sources: Map<string, string>): boolean => {
    const graph = graphFrom(entry, sources);
    return graph.has(OWNER) && [...graph].every((m) => m === OWNER || inFolder("core", m));
  };

  // Every file under cli/, read off disk: a fifth entry point is covered by
  // landing in the folder, not by being added to a list here.
  const ENTRY_POINTS = everyFileIn("cli");
  results.push(check(
    "every command-line entry point reaches the output folder through the core",
    ENTRY_POINTS.length > 0 && ENTRY_POINTS.every((f) => reachesThroughCore(f, sourceText)),
  ));
```

`ENTRY_POINTS` is `everyFileIn("cli")` — read off disk, so all four (and any
fifth) are covered automatically. **Every module transitively reachable from
`cli/generate.ts` must be `core/output-folder.ts` or under `core/`.** A registry
placed at `shared/providers.ts`, `server/providers.ts` or `providers/index.ts`
turns this red the moment `cli/generate.ts` imports it. A registry at
`core/providers.ts` is fine. This is the second machine enforcing the design's
file placement.

**"the server imports nothing from the command line", lines 256-272:**

```ts
  const importsFromCli = (sources: Map<string, string>): string[] =>
    [...sources.keys()].filter((f) => inFolder("server", f))
      .filter((f) => localImports(code(sources.get(f) ?? "")).some((spec) => resolveLocal(f, spec)?.startsWith("cli/")))
      .map((f) => `${f} imports the command line`);
```

Asymmetric: nothing forbids a **core** module from naming a cli/ module, only
the reverse. A registry in `core/` that imports `cli/generate.ts` would pass this
audit and would break the CLI-entry check at 229 instead.

**The private-name list, lines 128-137** — the one that constrains what a
`core/` provider file may import:

```ts
  const PRIVATE_NAMES: [what: string, appliesTo: (file: string) => boolean, pattern: RegExp][] = [
    ["the Seed counter file", () => true, /cursor\.json/],
    ["the Manifest file", () => true, /manifest\.jsonl/],
    ["the Thumbnail folder", () => true, /["'`]thumbs["'`]/],
    ["a Frame filename", () => true, /\.padStart\([^)]*\)\}\.(?:png|webp)/],
    ["a Seed label", (f) => f !== BROWSER_LABEL_HOME, /padStart\(/],
    ["the deleted filesystem helpers", () => true, /from\s+["'][^"']*\/common["']/],
    ["an error class carrying an HTTP status", () => true, /\bApiError\b/],
    ["the HTTP contract types", isCore, /api-types/],
  ];
```

Line 136 + 127: **any file under `core/` that so much as mentions `api-types`
fails** ("`core/…` names the HTTP contract types"). So a `core/providers.ts` may
not import `shared/api-types.ts`, which rules out typing the registry's model
keys or its capability rules with `GenerateRequest`. The vacuity proof for this
is at 173-180 and it plants a file in `core/` specifically because the rule is
derived from the folder:

```ts
  results.push(check(
    "the audit is not vacuous: a file added to core/ later is held to the core rules without a list edit",
    audit(whilePlanted(
      [{ path: join(repoRoot, "core", "reach-around-types.ts"),
        contents: 'import type { Status } from "../shared/api-types";\nvoid (0 as Status);\n' }],
      readAll,
    )).some((line) => line.startsWith("core/reach-around-types.ts names the HTTP contract types")),
  ));
```

Also `["an error class carrying an HTTP status", () => true, /\bApiError\b/]` at
135: no file outside `test/` may name a class called `ApiError`. A provider
refusal type must not be called that.

**The filesystem-user list, lines 108-115:**

```ts
  const ALLOWED_FILESYSTEM_USERS: Record<string, string> = {
    "cli/export-prompts.ts": "writes the HTML page the user opens in a browser",
    "cli/import-images.ts": "reads the downloads the user hands it, and sorts their timestamps",
    "server/index.ts": "serves the built UI out of web/dist",
  };
  const reachesForFilesystem = (s: string) => /from\s+"node:(?:fs|path)"|from\s+"sharp"/.test(s);
```

The comment at 108-109 says "A fourth one has to be added here on purpose, with a
reason." A provider module that reads a local file (a config, a PEM) would need
an entry. Reading `process.env` is not a filesystem reach and needs no entry.

**The lint checks, lines 494-652.** Four of them run oxlint over the whole repo
with a planted fixture each: `import(no-cycle)` (494-561), and the two
`no-restricted-imports` / `import/no-relative-parent-imports` fixtures for the
browser (591-652). Plus the standing claim at 533-537:

```ts
  results.push(check(
    "the whole repository lints clean with the cycle rule on: the run exits zero and names no cycle",
    asItStands.exit === 0 && !namedRule(asItStands, CYCLE_RULE),
  ));
```

`CYCLE_RULE = "import/no-cycle"` at line 495, `.oxlintrc.json:50` sets it to
`error` repo-wide. **A provider registry imported by both `core/policy.ts` and
`core/gemini.ts` is not a cycle, but the registry importing back into
`core/generate.ts` would be.** Note the audit walks `import ... from` and
`import("…")` forms only (line 199), so `require()` is invisible to the audit
*and* to oxlint's `no-cycle` here.

The browser-layering checks (336-455) are irrelevant to this work: they key on
`@/app/**`, `@/features/**` and `web/src/**` prefixes, and the backend has no
path aliases at all (see the `.oxlintrc.json:29-38` comment).

### Which existing audit assertions would need to change vs. stay green

**Would go red or need editing:**

1. `smoke-audit.ts:302` — the `/console\.|@google\/genai/` regex, **only** if the
   intent is to make it vendor-general rather than Google-specific. Green as
   written unless that is a chosen change.
2. `smoke-audit.ts:229` — `reachesThroughCore`, **only** if the registry is filed
   outside `core/`. Green if it is `core/providers.ts`.
3. `smoke-audit.ts:110-114` — `ALLOWED_FILESYSTEM_USERS`, **only** if a provider
   module reaches for `node:fs`/`node:path`/`sharp`. Green otherwise.
4. `smoke-audit.ts:229` also assumes `graph.size > 1` only for the **run** graph
   (line 310), so a provider in the run graph does not fail that clause — it
   fails `narrators.length === 0`.

**Stay green, no edit:**

- `146` "nothing reaches the output folder except through output-folder.ts" — a
  provider file that touches neither `manifest.jsonl`, `cursor.json`, `thumbs`,
  `padStart(`, `ApiError` nor `api-types` is invisible to it.
- `161-180` all three vacuity proofs — they plant files in `outbound/`,
  `core/`, `cli/`, `server/` and assert the *probe* fires; adding real files
  elsewhere cannot change them.
- `236` entry-point check *passes* for a new `core/` provider (see 2 above).
- `266-271` server-does-not-import-cli — unaffected.
- `371`, `402`, `434-437` browser layering — unaffected.
- `533-652` all four lint checks, **provided** the new files keep the repo
  linting clean. `lintSays()` runs `node_modules/oxlint/bin/oxlint -c
  .oxlintrc.json` from `repoRoot` with **no path argument** (494-501), so a new
  `core/openai.ts` is linted as part of the standing claim at 533.

---

## 12. Every test that breaks or needs updating, by change

### (a) `GenerateRequest` gains a `provider` field

**Breaks at typecheck (`pnpm run typecheck` → `tsc --noEmit`):**

| site | code |
| --- | --- |
| `test/smoke-test.ts:646` | `const request: import("../shared/api-types").GenerateRequest = { count: 1, model: "flash", size: "1K", concurrency: 1, useNegative: false };` |
| `test/smoke-test.ts:871-877` | `const repeating: GenerateRequest = { count: policy.count, model: modelKey, size: policy.imageSize as GenerateRequest["size"], concurrency: policy.concurrency, useNegative: policy.useNegative };` |
| `web/src/features/generate/generate-page.tsx:72` | `start.mutate({ count: n, model, size: model === "lite" ? "1K" : size, concurrency: c, useNegative })` |
| `core/policy.ts:37-44` | only if `provider` is added to the `Pick` at line 34 |

These break only if `provider` is **required**. If it is optional with a
default, they all still compile and none of the four changes.

**Runtime behaviour changes even if optional** — raw JSON bodies sent to
`/api/generate` that name no provider, in `test/smoke-test.ts`:

| line | body |
| --- | --- |
| 749 | `{ count: 2, model: "flash", size: "1K", concurrency: 1, useNegative: false }` |
| 773 | same |
| 782 | `{ count: 60, model: "flash", … }` |
| 796 | `{ count: 1, model: "flash", … }` |
| 923 | `{ count: 2, model: "pro", size: "2K", concurrency: 1, useNegative: false }` |
| 1042 | `{ count: 1, model: "flash", size: "1K", concurrency: 1, useNegative: false }` |

Each of those is followed by an assertion that reads the resolved model back —
`startedAtOnce.model === "gemini-3.1-flash-image"` (753), `jobState.model ===
policy.model` (897), `overState.model === MODELS.pro` (928). If the default
provider is not gemini, or if `refusalFor` refuses an unknown/absent provider,
these fail at runtime.

Also affected, type-level: `test/smoke-test.ts:866-868`

```ts
  const modelKey = (Object.keys(MODELS) as GenerateRequest["model"][]).find(
    (key) => MODELS[key] === policy.model,
  );
  if (modelKey === undefined)
    throw new Error(`the policy names a model a request cannot ask for: ${policy.model}`);
```

The `as GenerateRequest["model"][]` cast from `string[]` stays legal for any
string-literal union, but `MODELS` must still be importable from wherever the
catalog lands, and this import (`test/smoke-test.ts:16`) plus the two
`MODELS.lite` / `MODELS.pro` assertions at 908 and 928/930 are three more
references that must be repointed if `MODELS` moves out of `core/gemini.ts`.

### (b) `Status.hasApiKey` becomes a per-provider record

**Breaks:**

| site | code | why |
| --- | --- | --- |
| `shared/api-types.ts:20` | `hasApiKey: boolean;` | the declaration itself |
| `server/store.ts:40` | `hasApiKey: Boolean(process.env.GEMINI_API_KEY) }` | producer |
| `server/jobs.ts:13` | `refusalFor(current: JobState, hasApiKey: boolean, req: GenerateRequest)` | parameter |
| `server/jobs.ts:15` | `if (!hasApiKey) return { status: 400, message: "GEMINI_API_KEY is not set. Add it to .env and restart the server." };` | one hardcoded vendor message |
| `server/index.ts:99` | `refusalFor(job.state(), Boolean(process.env.GEMINI_API_KEY), req)` | the only caller |
| `test/smoke-test.ts:665` | `const told = (await status.json()) as { next: number | null; waiting: number | null; done: number; saltSet: boolean; hasApiKey: boolean; problem?: string };` | the check's own inline cast of the wire shape |
| `test/smoke-test.ts:668` | `told.saltSet && told.hasApiKey === false && told.problem === undefined));` | the assertion — inside the check named *"the status route reports the folder and still says whether an API key is set"* (666) |
| `test/smoke-test.ts:729-731` | `const noKey = await api.request("/api/generate", …); results.push(check("the Job refuses to start without an API key", noKey.status === 400 && ((await noKey.json()) as { error: string }).error.includes("GEMINI_API_KEY")));` | asserts both a 400 and the literal substring `"GEMINI_API_KEY"` in the refusal |
| `test/smoke-test.ts:732` | `const busy = refusalFor({ status: "running", total: 0, done: 0, failed: 0, log: [] }, true, request);` | passes `true` positionally for `hasApiKey`; a record-shaped parameter breaks this call |
| `web/src/features/generate/generate-page.tsx:44` | `const noKey = status.data ? !status.data.hasApiKey : false;` | consumer |
| `web/src/features/overview/overview-page.tsx:106-107` | `<dt …>Gemini API key</dt>` / `<dd>{s.hasApiKey ? "Set" : "Not set"}</dd>` | consumer |

**Stays green:**

- `test/smoke-test.ts:964-965` — `statusOf` is typed `Status`, and the assertions
  at 1002-1006 and 1018-1024 read only `version`, `next`, `waiting`, `done`,
  `saltSet`, `problem`. They typecheck against any `Status`.
- `test/smoke-test.ts:964`'s callers never set the key before those two status
  reads, and never assert on it afterwards.

### (c) The Manifest gains a `provider` field

**Nothing in `test/` breaks at runtime.** Verified:

- No test reads `out/manifest.jsonl` as text — `test/smoke-audit.ts:130`
  forbids the literal outside `core/output-folder.ts`, and no test asserts on
  the archive's on-disk JSON at all.
- The `FrameRecord`-shaped casts are partial and tolerate a new optional field:
  `test/smoke-test.ts:670`
  (`as { seed: number; source: string; version: string; prompt: string }[]`),
  `test/smoke-test.ts:757` (`as ImageItem[]` — a widening, so still fine),
  `test/smoke-test.ts:604` (`promptsFor` results, unrelated).
- The `prompts.html` hash contract (`test/smoke-cli.ts:82-83`) hashes an HTML
  file, not the manifest.
- `test/smoke-cli.ts:112` (`2:manual,1:manual`) and
  `test/smoke-test.ts:201` (`f.source === "manual"`) read `source`, a different
  field, and are untouched by a `provider`.

**Type-level only:** `core/output-folder.ts:20-27` (`FrameRecord`), `:31-40`
(`Attempt`), `:42-50` (`FrameWrite`), `:73-81` (`ManifestRow`), `:300` (the
destructure), `:265` (the `listFrames` projection). `shared/api-types.ts:8`
(`ImageItem = FrameRecord`) inherits it for free. If `provider` is made
**required** on `FrameRecord`, then `test/smoke-test.ts:670`'s cast is still fine
(a cast to a shape with fewer fields is allowed) but any literal construction of
a `FrameRecord` would break — there are none in the tests.

### (d) Generation attempts gain a `blocked` status

**Breaks nothing by itself.** Checked each candidate:

| site | code | verdict |
| --- | --- | --- |
| `core/output-folder.ts:33` | `status: "ok" \| "failed" \| "rejected";` | must gain `"blocked"` or a blocked row will not typecheck as an `Attempt` |
| `core/output-folder.ts:218` | `filter((value) => value === "failed").length` | a `blocked` row is not counted as failed; decide whether it should be |
| `core/output-folder.ts:256-257` | `if (row.status === "ok") … else if (row.status === "rejected") …` | a `blocked` row is inert here |
| `test/smoke-test.ts:560-561` | `folder.recordAttempt({ seed: 1, status: "failed", error: "fixture failure" }); … folder.status().failed === 1` | **stays green** — nothing in that block mentions blocked |
| `test/smoke-cli.ts:50` | `cliFolder.recordAttempt({ seed: 3, status: "failed", error: "fixture failure" });` | stays green |
| `test/smoke-cli.ts:54-64` | the `status` byte contract, incl. line 61 `"Last attempt failed for 1 seeds, they run first next time"` | stays green while no blocked rows exist in `out-smoke7` |
| `test/smoke-test.ts:648-649` | `codes.length === 6 && codes.every((code) => typeof STATUS_BY_CODE[code] === "number")` | **stays green only if `blocked` is *not* an `ArchiveErrorCode`.** Adding a code breaks it, and would also force a row in `server/index.ts:18-25`. |
| `test/smoke-test.ts:100` | `Object.keys(opened ?? {}).sort().join() === "alreadyDone,kind,range,total,version"` | **This is the one exhaustive-shape assertion.** Adding a field to `StartEvent` breaks it. Adding a field to `SeedEvent` or `PromptEvent` does **not** — no equivalent `Object.keys` check exists for them. |
| `test/smoke-test.ts:106` | `seedResults(first.events).every((e) => !("message" in e))` | a success `SeedEvent` must still carry **no** `message` key at all (not `message: undefined`) |
| `test/smoke-test.ts:117-121` | `"7:false:fake quota error,8:false:fake quota error"` | built from explicit `${e.seed}:${e.ok}:${e.message}`, so a new field on `SeedEvent` does not change it |
| `server/jobs.ts:89-92` | `if (event.ok) current.done++; else current.failed++; … { seed, ok, message }` | a blocked seed increments `failed` unless this changes; `JobState.log[]` (`shared/api-types.ts:48`) has no field to carry "blocked" |
| `web/src/features/generate/generate-page.tsx:163` | `l.ok ? "Done" : (l.message ?? "Failed")` | two branches for what becomes three states |

### The byte-exact `GEMINI_API_KEY` contract — every place it is asserted

There is exactly **one** assertion of that literal string, plus one place that
asserts a *substring* of the sibling message. Full inventory:

**1. The full literal, `test/smoke-cli.ts:278-282`** — inside the check named
*"a spawned run that fails exits 1, with the summary on stdout and the failures
on stderr"* (262-284):

```ts
        noKey.error === [
          "[1] failed: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
          "[2] failed: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
          "",
        ].join("\n") &&
```

Byte-for-byte, with the `[N] failed: ` prefix produced by `cli/generate.ts:63`
(`console.error(\`[${event.seed}] failed: ${event.message}\`)`) and the message
produced by `core/gemini.ts:32`. The trailing `""` is the final newline. Same
check also asserts `noKey.code === 1` (264), the stdout array (268-274), and
`!noKey.error.includes("the smoke suite must not use the network")` (283).

The child that produces it is spawned at `test/smoke-cli.ts:256-261`:

```ts
    const noKey = await spawnCli(
      "cli/generate.ts",
      ["--count", "2", "--concurrency", "1", "--out", failOut],
      {},
      [noNetwork],
    );
```

No `--model` and no `--provider` flag, so **whatever the default provider is,
this contract pins that provider's no-key message.** Lines 243-251 explain why
the offline path exists at all:

```ts
  // The suite has no API key and no network, which reads like it rules this out
  // and does not. `core/gemini.ts` checks for the key before it constructs a
  // client at all, so with no key a real run fails every Seed the same
  // deterministic way, records the failed Attempts and comes back with failures
  // in it — having never asked the network for anything.
```

**Would an equivalent OpenAI string need its own contract?** Yes, and it would
have to be *spawned*, because `generateImages` cannot exercise the real key
check: `test/smoke-cli.ts:168`, `:185`, `:198` and `:321` all pass `good`, `bad`
or nothing at all as the Generator, bypassing `core/gemini.ts` entirely. The
pattern to copy is lines 252-298 in full: `rmSync(failOut)`, `openOutputFolder`,
`spawnCli(..., [noNetwork])`, assert the exact stderr array, assert the exit code,
then assert the archive's own view in the second check (285-293). It would also
need its own `rmSync` in the `finally` at 294-298 and its own folder in the
cleanup list at 325.

**2. The substring, `test/smoke-test.ts:729-731`** — a *different* string, the
`refusalFor` message from `server/jobs.ts:15`:

```ts
  const noKey = await api.request("/api/generate", { method: "POST", body: JSON.stringify(request) });
  results.push(check("the Job refuses to start without an API key",
    noKey.status === 400 && ((await noKey.json()) as { error: string }).error.includes("GEMINI_API_KEY")));
```

`.includes("GEMINI_API_KEY")` is a substring test, so it survives rewording the
rest of the message but not renaming the variable.

**3. The child environment, `test/smoke-cli.ts:34`** — the source of both:

```ts
        { cwd: repoRoot, env: { ...process.env, SEED_SALT: "", GEMINI_API_KEY: "", ...env } },
```

**`OPENAI_API_KEY` is not cleared here**, so every spawned CLI inherits the
developer's real OpenAI key. If the default provider is chosen by which key is
present, or if the entry point constructs a client eagerly, this line must gain
`OPENAI_API_KEY: ""`. This is the single most likely source of a CI/local
divergence in this whole change.

**4. Not an assertion, but a contract: the header line.** `cli/generate.ts:53-55`
builds

```
`${event.version} | ${options.model} | ${event.total} to generate, ${event.alreadyDone} already done${range}`
```

and **four** byte contracts assert on it, plus a fifth tolerant one:

| site | assertion | tolerant to a prefix? |
| --- | --- | --- |
| `test/smoke-cli.ts:173` | `${cliVersion} \| ${policy.model} \| 3 to generate, 0 already done \| seeds 1 to 3` | **no** — exact array element |
| `test/smoke-cli.ts:189` | `${cliVersion} \| ${policy.model} \| 2 to generate, 0 already done \| seeds 1 to 2` | **no** |
| `test/smoke-cli.ts:224` | `${cliVersion} \| gemini-3.1-flash-lite-image \| 2 to generate, 0 already done \| seeds 1 to 2` | **no** — the literal vendor model id |
| `test/smoke-cli.ts:269` | `${cliVersion} \| ${policy.model} \| 2 to generate, 0 already done \| seeds 1 to 2` | **no** |
| `test/smoke-cli.ts:204` | `dryRunLines[0].endsWith("\| seeds 3 to 4")` | yes (suffix only) |
| `test/smoke-test.ts:895` | `cliLines[0].includes(\`\| ${policy.model} \| ${policy.count} to generate, \`)` | yes to a **prefix**, no to an insertion between model and count |

So inserting a provider into the header (`version | provider | model | …`) breaks
173/189/224/269 and keeps 204/895. Prefixing it (`version | model (provider) | …`)
breaks all four too. Leaving the header alone breaks none.

### Summary table: what each of the four changes costs the suite

| change | runtime breaks | typecheck breaks | new contract needed |
| --- | --- | --- | --- |
| (a) `GenerateRequest.provider` | 0 if optional+defaulted; 6 JSON bodies + 3 model assertions if the default moves | smoke-test:646, :871; generate-page:72 | a request-shape test asserting the default |
| (b) `Status` key record | smoke-test:668, :731, :732 | smoke-test:665; generate-page:44; overview-page:107 | one per-provider assertion replacing 668 |
| (c) Manifest `provider` | **none** | none in `test/` | one old-line-parses-as-`"gemini"` assertion (there is no manifest-reader test today) |
| (d) `blocked` status | none by itself | `core/output-folder.ts:33` only | blocked-vs-failed for `FolderStatus.failed`; a third branch in `generate-page.tsx:163`; `smoke-test.ts:648-649` must **not** gain a code |

---

## 13. `test/no-network.ts` in full (63 lines)

```ts
// Preloaded into a spawned command with `--import`, before the command's own
// modules are evaluated. The smoke suite has no API key and must stay offline;
// this is what makes that an observation rather than an intention. Every way
// out of the process that could reach another machine turns into a loud,
// self-naming failure, so a command that reached for one would either die on the
// tripwire or — if the run caught the error and reported it the way it
// reports any other failure — fail the byte contract that names the reason.
//
// Nothing here is imported by the suite itself. It is a side effect on load.
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";

/** Every attempt made, so the exit can name them all rather than the first. */
const attempts: string[] = [];

/**
 * The one failure this module raises. It is thrown rather than returned so it
 * arrives the way any other failure inside a command's work arrives, and it
 * names the call that tried, because "something reached out" is not a finding.
 * The CLI contract greps for this phrase, so it is also how a run that reached
 * out and was caught anyway shows up on the child's stderr.
 */
const trip = (what: string): never => {
  attempts.push(what);
  throw new Error(`the smoke suite must not use the network: ${what}`);
};

// Sockets first, because they are the way out every HTTP client ends up using,
// whichever API it was written against. Name resolution is next: a lookup is
// reaching for another machine even though it opens nothing itself. `fetch` is
// last, because a runtime may replace it and any code that cached the original
// is covered by one of the two above.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function tripwiredConnect(...args: unknown[]): net.Socket {
  trip(`net.connect(${String(args[0])})`);
  // Unreachable, but the replacement has to be assignable to what it replaces.
  return (connect as unknown as (...a: unknown[]) => net.Socket).apply(this, args);
};
tls.connect = ((...args: unknown[]) =>
  trip(`tls.connect(${String(args[0])})`)) as unknown as typeof tls.connect;
for (const level of ["lookup", "resolve", "resolve4", "resolve6"] as const) {
  (dns as unknown as Record<string, unknown>)[level] = (...args: unknown[]) =>
    trip(`dns.${level}(${String(args[0])})`);
}
globalThis.fetch = ((input: unknown) =>
  trip(`fetch(${typeof input === "string" ? input : String(input)})`)) as typeof fetch;

// A throw from a socket call inside an async chain arrives as a rejected
// promise, and Node's own wording for one of those says nothing about the
// tripwire. Saying it here keeps the phrase findable wherever it lands.
process.on("unhandledRejection", (reason) => {
  console.error(reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

// And on the way out, so an attempt that was caught somewhere and survived
// still cannot pass for a clean run: the checks below look for the phrase on
// stderr, and a command that exited 0 after reaching out is not one either.
process.on("exit", (code) => {
  if (!attempts.length) return;
  for (const what of attempts) console.error(`the smoke suite must not use the network: ${what}`);
  if (code === 0) process.exitCode = 1;
});
```

### Would adding the `openai` package trip it?

**No, on the evidence in this file, provided the constructor is not called at
module load.**

What this file actually instruments, exhaustively:

| line | instrumented |
| --- | --- |
| 35-39 | `net.Socket.prototype.connect` |
| 40-41 | `tls.connect` |
| 42-45 | `dns.lookup`, `dns.resolve`, `dns.resolve4`, `dns.resolve6` |
| 46-47 | `globalThis.fetch` |
| 52-55 | `unhandledRejection` |
| 60-63 | `process.on("exit")` — prints every recorded attempt and forces a non-zero exit |

Four things follow:

1. **The OpenAI constructor opens nothing.** It reads `OPENAI_API_KEY` from the
   environment and builds an object graph. No socket, no DNS, no `fetch`. So
   `new OpenAI({ apiKey })` at module scope or inside a lazy singleton (the
   `client ??= new GoogleGenAI({})` shape at `core/gemini.ts:34`/`:28`) trips
   nothing.
2. **Module *import* is safe.** The tripwires are patched as a side effect of
   loading this file, which `--import` runs **before** the command's own modules
   (`test/smoke-cli.ts:33`: `["--import", "tsx", ...preloads.flatMap((p) =>
   ["--import", p]), script, ...args]`). Any package the command imports is
   therefore evaluated with the tripwires already in place — so if the `openai`
   package did any top-level network work, this would catch it. That is the
   point of the comment at lines 1-7.
3. **What *would* trip it** is a real request: `client.images.generate(...)`
   issues one, and it would be caught whichever transport it chose (fetch is
   replaced; a `http`/`https` request would go through `net.Socket.prototype.connect`).
   So the OpenAI path must fail before its first call in the spawned tests —
   exactly the way `core/gemini.ts:31-33` does — or the check at
   `test/smoke-cli.ts:283` (`!noKey.error.includes("the smoke suite must not use
   the network")`) goes red, and if the run *catches* the error instead, lines
   60-63 force the child's exit code non-zero and the byte contract fails.
4. **`no-network.ts` is only preloaded into spawned children**, never into the
   test process itself — `test/smoke-cli.ts:41` builds its file:// URL and only
   `spawnCli` receives it (line 33). `test/smoke-test.ts` imports
   `server/index.ts` (line 22), which imports `core/gemini.ts`, which imports
   `@google/genai` — **in-process, unobserved by this tripwire.** So a new
   `openai` import reaching the test process the same way is equally
   unobserved. That is a gap worth knowing about, not a reason not to add the
   dependency.

Nothing in `no-network.ts` is provider-specific and nothing in it needs to
change.

---

## 14. Everything else that would break — exhaustive hit list

Every reference, by symbol, with file and line. `README.md`, `GLOSSARY.md`,
`package.json`, `.env.example` and `.github/workflows/ci.yml` are included
because they are files that ship.

### `MODELS`

| file:line | text |
| --- | --- |
| `core/gemini.ts:8` | `export const MODELS = {` (definition; `:12` closes it `} as const;`) |
| `core/policy.ts:1` | `import { MODELS } from "./gemini";` |
| `core/policy.ts:29` | comment: `` * the run's import graph free of the vendor client — `MODELS` lives in the module `` |
| `core/policy.ts:40` | `model: MODELS.flash,` |
| `server/jobs.ts:2` | `import { MODELS } from "../core/gemini";` |
| `server/jobs.ts:18` | `if (!MODELS[req.model]) return { status: 400, message: "Unknown model" };` |
| `server/jobs.ts:69` | `const model = MODELS[req.model];` |
| `cli/generate.ts:2` | `import { geminiGenerator, MODELS } from "../core/gemini";` |
| `cli/generate.ts:103` | `o.model = (MODELS as Record<string, string>)[m] ?? m;` |
| `test/smoke-test.ts:16` | `import { MODELS } from "../core/gemini";` |
| `test/smoke-test.ts:866-868` | the `Object.keys(MODELS)` → `GenerateRequest["model"]` lookup |
| `test/smoke-test.ts:908` | `allFlags.model === MODELS.lite && …` |
| `test/smoke-test.ts:928` | `overState.status === "done" && overState.total === 2 && overState.model === MODELS.pro &&` |
| `test/smoke-test.ts:930` | `overSpy.seen[0].opts.model === MODELS.pro && overSpy.seen[0].opts.imageSize === "2K" &&` |

### `geminiGenerator`

| file:line |
| --- |
| `core/gemini.ts:30` — `export const geminiGenerator: Generator = async (prompt, opts) => {` |
| `server/index.ts:7` — `import { geminiGenerator } from "../core/gemini";` |
| `server/index.ts:112` — `const app = createApp(dataset, geminiGenerator);` |
| `cli/generate.ts:2` — `import { geminiGenerator, MODELS } from "../core/gemini";` |
| `cli/generate.ts:116` — `generateImages(parseArgs(process.argv.slice(2)), geminiGenerator).then(…)` |

Exactly **two** composition roots name a Generator: the server and the CLI. Both
pass it as a single positional argument.

### `GEMINI_API_KEY`

| file:line | text |
| --- | --- |
| `core/gemini.ts:31` | `if (!process.env.GEMINI_API_KEY) {` |
| `core/gemini.ts:32` | `throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");` |
| `server/store.ts:40` | `hasApiKey: Boolean(process.env.GEMINI_API_KEY) }` |
| `server/index.ts:99` | `refusalFor(job.state(), Boolean(process.env.GEMINI_API_KEY), req)` |
| `shared/api-types.ts:20` | `hasApiKey: boolean;` (the wire field this implies) |
| `.env.example:6` | `GEMINI_API_KEY=` |
| `README.md:61` | ``1. Set `GEMINI_API_KEY` in `.env` and restart the server.`` |
| `README.md:173` | ``- **Generate says no API key.** Set `GEMINI_API_KEY` in `.env` and restart the server.`` |
| `test/smoke-cli.ts:34` | `env: { ...process.env, SEED_SALT: "", GEMINI_API_KEY: "", ...env }` |
| `test/smoke-cli.ts:279` | the byte-contract literal |
| `test/smoke-cli.ts:280` | the byte-contract literal |
| `test/smoke-test.ts:622` | comment: `// GEMINI_API_KEY is the exception, and not about the dataset: …` |
| `test/smoke-test.ts:625, 627, 744, 804, 805, 850, 853, 940, 941, 992, 1044, 1098, 1099` | fixture set / restore |
| `web/src/features/generate/generate-page.tsx:60` | `<p>Add GEMINI_API_KEY to .env and restart the server. …</p>` |

### `hasApiKey`

| file:line | text |
| --- | --- |
| `shared/api-types.ts:20` | `hasApiKey: boolean;` |
| `server/store.ts:40` | `hasApiKey: Boolean(process.env.GEMINI_API_KEY) }` |
| `server/jobs.ts:13` | `refusalFor(current: JobState, hasApiKey: boolean, req: GenerateRequest)` (parameter name) |
| `server/jobs.ts:15` | `if (!hasApiKey) return …` |
| `web/src/features/generate/generate-page.tsx:44` | `const noKey = status.data ? !status.data.hasApiKey : false;` |
| `web/src/features/overview/overview-page.tsx:107` | `<dd>{s.hasApiKey ? "Set" : "Not set"}</dd>` |
| `test/smoke-test.ts:665` | the inline cast `… hasApiKey: boolean; problem?: string }` |
| `test/smoke-test.ts:668` | `told.saltSet && told.hasApiKey === false && told.problem === undefined` |

### `NoImageError`

| file:line | text |
| --- | --- |
| `core/gemini.ts:51` | `throw new NoImageError(\`No image in response. Model said: ${text}\`);` |
| `core/gemini.ts:55` | `if (err instanceof NoImageError \|\| attempt >= maxAttempts \|\| !isRetryable(err)) throw err;` |
| `core/gemini.ts:63` | `export class NoImageError extends Error {}` |

Three references, all inside one file. Nothing anywhere catches it by type.

### `GenOptions`

| file:line | text |
| --- | --- |
| `core/generate.ts:9` | `export type GenOptions = {` (the type; `:10` `model: string;`, `:11` `aspectRatio: string;`, `:12` `imageSize: string;`) |
| `core/generate.ts:15` | `export type Generator = (prompt: string, opts: GenOptions) => Promise<Buffer>;` |
| `core/gemini.ts:6` | `import type { Generator } from "./generate";` |
| `server/jobs.ts:3` | `import { run, type Generator } from "../core/generate";` |
| `server/index.ts:10` | `import type { Generator } from "../core/generate";` |
| `cli/generate.ts:4` | `run, type Generator, type ProgressEvent, type RunRequest, type RunResult,` |
| `test/smoke-harness.ts:…` | no import; `good`/`bad` are inferred and passed positionally |
| `test/smoke-test.ts:13` | `run, type GenOptions, type Generator, …` |
| `test/smoke-test.ts:824` | `const seen: { prompt: string; opts: GenOptions }[] = [];` |
| `test/smoke-test.ts:826` | `const generate: Generator = async (prompt, opts) => {` |
| `test/smoke-test.ts:845` | `const genOptions: (keyof GenOptions)[] = ["model", "aspectRatio", "imageSize"];` |

`test/smoke-test.ts:845` is the one to watch: it is an **explicit list of
`GenOptions` keys** compared value-by-value against the policy at `:888` and
`:915`. A new key added to `GenOptions` is *not* automatically covered — it has
to be added to this array, or the "two adapters start from one policy" claim
silently stops covering it.

### `Generator`

| file:line |
| --- |
| `core/generate.ts:15` (definition) |
| `core/gemini.ts:6`, `core/gemini.ts:30` |
| `core/policy.ts:2` (no — that is `RunRequest`) |
| `server/jobs.ts:3`, `server/jobs.ts:46` (comment), `server/jobs.ts:65` |
| `server/index.ts:10`, `:33` (comment), `:37` |
| `cli/generate.ts:4`, `:21` (comment), `:38` |
| `test/smoke-harness.ts:19` (`good`), `:21` (`bad`) — no type import |
| `test/smoke-test.ts:13`, `:62`, `:75`, `:736` (comment), `:766` (comment), `:811`/`:817`/`:820` (comments), `:826`, `:844`, `:885`, `:973`/`:976` (comments), `:983`, `:1033` (comment), `:1057` (comment), `:1062` |
| `README.md:162` ("runs the pipeline with a fake Generator"), `README.md:164` ("`core/gemini.ts`, the one Generator, …"), `README.md:160` |

Nine `createApp` call sites pass a Generator: `test/smoke-test.ts:632, 693,
770, 879, 920, 997, 1011, 1037, 1038`. Plus `server/index.ts:112`.

### `imageSize`

| file:line | text |
| --- | --- |
| `core/generate.ts:12` | `  imageSize: string;` (`GenOptions`) |
| `core/generate.ts:72` | `  imageSize: string;` (`RunRequest`) |
| `core/generate.ts:155` | `          imageSize: request.imageSize,` |
| `core/gemini.ts:45` | `          image_size: opts.imageSize,` |
| `core/policy.ts:34` | the `Pick` union |
| `core/policy.ts:42` | `  imageSize: "1K",` |
| `server/jobs.ts:77` | `      imageSize: size,` |
| `cli/generate.ts:29` | the `Pick` union |
| `cli/generate.ts:105` | `else if (a === "--size") o.imageSize = v();` |
| `test/smoke-test.ts:67` | `  imageSize: policy.imageSize,` |
| `test/smoke-test.ts:845` | in `genOptions` |
| `test/smoke-test.ts:874` | `size: policy.imageSize as GenerateRequest["size"],` |
| `test/smoke-test.ts:908` | `allFlags.imageSize === "2K"` |
| `test/smoke-test.ts:930` | `overSpy.seen[0].opts.imageSize === "2K"` |

`test/smoke-test.ts:874` is a **cast from `"1K"` to
`GenerateRequest["size"]`**. If the size union becomes provider-derived (or
narrowed), this cast is where the typecheck bites.

### `aspectRatio`

| file:line | text |
| --- | --- |
| `core/generate.ts:11` | `  aspectRatio: string;` (`GenOptions`) |
| `core/generate.ts:71` | `  aspectRatio: string;` (`RunRequest`) |
| `core/generate.ts:154` | `          aspectRatio: request.aspectRatio,` |
| `core/gemini.ts:44` | `          aspect_ratio: opts.aspectRatio,` |
| `core/policy.ts:34` | the `Pick` union |
| `core/policy.ts:41` | `  aspectRatio: "2:3",` |
| `cli/generate.ts:29` | the `Pick` union |
| `cli/generate.ts:104` | `else if (a === "--aspect") o.aspectRatio = v();` |
| `test/smoke-test.ts:66` | `  aspectRatio: policy.aspectRatio,` |
| `test/smoke-test.ts:845` | in `genOptions` |
| `test/smoke-test.ts:934` | `overSpy.seen[0].opts.aspectRatio === policy.aspectRatio` |

`GenerateRequest` has **no** `aspectRatio` field at all — the comment at
`test/smoke-test.ts:932-934` says so explicitly: *"The aspect ratio is the one
value a request has no way to name."* That asymmetry is asserted.

### `source: "api"`

| file:line | text |
| --- | --- |
| `core/output-folder.ts:23` | `  source: "api" \| "manual" \| "unknown";` (`FrameRecord`) |
| `core/output-folder.ts:35` | `  source?: "manual" \| "api";` (`Attempt`) |
| `core/output-folder.ts:46` | `  source?: "manual" \| "api";` (`FrameWrite`) |
| `core/output-folder.ts:264` | `        source: row?.source === "manual" ? "manual" : row ? "api" : "unknown",` |
| `core/output-folder.ts:343` | `await writeFrame({ seed, buffer: file.buffer, source: "manual", file: file.name, ts: new Date().toISOString() });` |
| `cli/import-images.ts:58` | `await folder.writeFrame({ seed, buffer: readFileSync(src), source: "manual", file: files[i] });` |
| `web/src/features/gallery/frame-detail.tsx:22` | `{image.source === "manual" ? "Imported by hand" : image.source === "api" ? \`Made with ${image.model ?? "the API"}\` : "Source unknown"}, prompt template {image.version}.` |
| `test/smoke-test.ts:201` | `manual.listFrames().every((f) => f.source === "manual")` |
| `test/smoke-cli.ts:112` | `impFolder.listFrames().map((f) => \`${f.seed}:${f.source}\`).join() === "2:manual,1:manual"` |

Note what is **absent**: no production code ever writes `source: "api"`. It is
only ever *derived* — `core/output-folder.ts:264` produces `"api"` for any
Frame whose latest `ok` row exists but is not `"manual"`. Generation writes no
`source` at all (`core/generate.ts:159` and `:167` pass no `source`), so the
condition at line 302 (`if (source !== undefined) row.source = source;`) is
skipped and the line has no `source` key; `row` is then truthy at 264, so the
projection says `"api"`. That inference is what makes a `provider` field worth
adding beside it: `"api"` currently conflates two providers, and
`web/src/features/gallery/frame-detail.tsx:22` renders it as
`` `Made with ${image.model ?? "the API"}` `` — a sentence whose subject is
currently always Gemini.

### Files with **no** hits for any of the above (verified provider-neutral)

`core/sampler.ts` (129 lines, quoted in full earlier — pools, `buildPrompt`,
`composePrompt`, no vendor, no model, no env), `core/errors.ts`, `cli/status.ts`,
`cli/import-images.ts` (only `source: "manual"` and `SEED_SALT`),
`cli/export-prompts.ts`, `server/store.ts` (outside line 40),
`web/src/app/*`, `web/src/features/{gallery,import,prompts,overview}/*` (outside
`overview-page.tsx:107`), `web/src/shared/lib/{http,job-api,frames-api,prompts-api,query-keys,settings-store,utils}.ts`,
`web/src/shared/components/*`, `web/src/lib/text.ts`, `docs/adr/*`,
`docs/agents/*`.

---

## Files that must change

Definitive, numbered. "Must" means: with the design as settled, the settled
behaviour is not obtainable without editing this file.

1. **`shared/api-types.ts`** — `Status.hasApiKey` (20) → per-provider record;
   `GenerateRequest.model` (33) → a provider-scoped key set; `GenerateRequest`
   (31-37) gains `provider`; `JobState` (39-49) gains a way to carry a provider
   and a third per-Seed outcome beyond `ok: boolean` + `message?: string` (48).
2. **`core/output-folder.ts`** — `Attempt` (31-40) gains `provider` and joins
   `"blocked"` to the status union (33); `FrameWrite` (42-50) gains `provider`;
   `ManifestRow` (73-81) gains `provider`; `recordAttempt`'s destructure (300) and
   row construction (301-309) write it, conditional-write style, after `model`;
   `listFrames` (253-270) projects it, with the `"gemini"` default for old lines
   decided at 265; `status()` (217-218) decides whether a `blocked` row counts as
   `failed` and whether it displaces an earlier `failed` row.
3. **`core/generate.ts`** — `GenOptions` (9-13) and/or `RunRequest` (63-95) gain
   `provider`, forwarded at 152-156 and recorded at 159/167; `SeedEvent` (35-41)
   needs a third outcome so `core/generate.ts:167` can record `blocked` and
   `:168` can report it. **Must keep line 1 as its only import** — see the audit
   at `test/smoke-audit.ts:305-311`.
4. **`core/gemini.ts`** — becomes one implementation of the `Provider` shape
   rather than a standalone `MODELS` + `Generator` pair. Key check (31-33),
   `MODELS` (8-12), retry classification (14-24), the `console.warn` (57) and
   `NoImageError` (63) all move behind that shape. `MODELS` moves out unless the
   registry re-exports it.
5. **A new `core/providers.ts`** (or equivalent, **must be under `core/`** — see
   item 11 and the CLI-entry check) — the registry, the `Provider` interface
   (model catalog, key-presence check, capability rules), and the OpenAI
   implementation. Whether it is one file or a folder of provider modules, every
   module it reaches must satisfy `test/smoke-audit.ts:128-137` (no `api-types`
   from `core/`, no `ApiError`, no `manifest.jsonl`) and 110-115 (no
   `node:fs`/`node:path`/`sharp` unless listed with a reason).
6. **`server/jobs.ts`** — `refusalFor` (13-20): the `hasApiKey: boolean`
   parameter and the hardcoded Gemini message (15), plus the
   `MODELS[req.model]` unknown-model check (18) → the registry's catalog; `start`
   (68-108): `MODELS[req.model]` (69) and the `lite ⇒ 1K` rule (70) become the
   provider's capability rules, `imageSize: size` (77), `JobState.model` (72) and
   the per-Seed log entry (92) if blocked needs to reach the browser.
7. **`server/index.ts`** — the composition root: the single `geminiGenerator`
   import (7) and `createApp(dataset, geminiGenerator)` (112) become a registry
   lookup; `createApp`'s signature (37) and `createJob(dataset, generate)` (43)
   must be able to resolve a per-provider Generator; `/generate`'s inline
   `Boolean(process.env.GEMINI_API_KEY)` (99) becomes the registry's per-provider
   key check.
8. **`server/store.ts`** — `getStatus` (38-41): the `hasApiKey` field (40) and
   its single `process.env` read.
9. **`cli/generate.ts`** — `--provider` parsing in the loop (94-110) and the
   `--model` two-way lookup (101-103) becoming catalog-scoped; the Generator
   chosen by provider at the entry point (116); `CliOptions` (27-31) if
   `provider` joins `RunRequest`; the header line (53-55) only if the provider is
   printed.
10. **`core/policy.ts`** — the `MODELS` import (1) and `model: MODELS.flash`
    (40) become a default from the default provider's catalog; the `Pick` union
    (34) gains `provider` if `RunRequest` has it.
11. **`web/src/features/generate/models.ts`** — the hardcoded three-key list (1-5)
    becomes per-provider, or becomes model-capable data fetched from the server.
12. **`web/src/features/generate/generate-page.tsx`** — `hasApiKey` (44), the
    vendor-named copy (52, 58, 60), the request literal (72), the model `<Select>`
    (77-94) and the `lite` special-cases (81, 100), the hardcoded size list (105),
    the submit-disabled `noKey` (129), and the two-branch per-Seed render (163).
13. **`web/src/features/overview/overview-page.tsx`** — the `Gemini API key`
    `<dt>`/`<dd>` pair (106-107) becomes one row per provider.
14. **`test/smoke-test.ts`** — `test/smoke-test.ts:16` (`MODELS` import), `:66-67`
    (`apiRequest`'s literal), `:646` (`GenerateRequest` literal), `:665`/`:668`
    (`hasApiKey`), `:731` (`.includes("GEMINI_API_KEY")`), `:732` (`refusalFor`'s
    positional `true`), `:845` (`genOptions`' explicit key list), `:866-868`
    (`Object.keys(MODELS)` lookup), `:871-877` (`repeating` literal), `:908`,
    `:928`, `:930` (`MODELS.lite` / `MODELS.pro`), `:1044` and the fixtures that
    set `GEMINI_API_KEY` (`:625/627/744/804/805/850/853/940/941/992/1098/1099`).
    New coverage needed: blocked attempts, an old manifest line parsing as
    `"gemini"`, and the per-provider key record.
15. **`test/smoke-cli.ts`** — `test/smoke-cli.ts:34` (clear `OPENAI_API_KEY` in
    the spawned env — **required** or every spawned CLI inherits the developer's
    real key), and a new OpenAI no-key byte contract alongside 255-298. The four
    header byte contracts at 173/189/224/269 only change if the header changes.
16. **`test/smoke-audit.ts`** — only if the vendor regex at line 302 is
    generalised (`|openai`) and/or a filesystem user is added at 110-114.
    **Not** required for the design as settled; listed because it is the file
    that will go red if the registry is misfiled or generate.ts grows an import.
17. **`package.json`** — `openai` under `dependencies` (36-55), alongside
    `@google/genai` (38). `pnpm-lock.yaml` follows.
18. **`.env.example`** — an `OPENAI_API_KEY=` line beside line 6.
19. **`README.md`** — `:61`, `:129`, `:132` (model names and flags), `:164`
    (project layout: "`core/gemini.ts`, the one Generator"), `:170-176`
    (troubleshooting, incl. the Gemini-specific entries at 172-173), `:180-184`
    (Notes). Line 164's "the one Generator" is now false and the sentence has to
    be rewritten.
20. **`GLOSSARY.md`** — the **Manifest** entry (`:33`, "which model or route") and
    **API route** (`:96-97`, "calling the Gemini API… refused outright for quota
    errors") are the two that become untrue; a **Provider** term is the
    conventional addition (`docs/agents/domain.md` governs where it goes).
21. **`.oxlintrc.json`** — only if a new browser import edge is introduced; the
    current rules are already correct for a `core/` addition. Listed for
    completeness because `test/smoke-audit.ts:533-537` lints the whole repo and a
    new file is inside that claim.

## Files that must NOT change

Verified provider-neutral by reading, not by inference.

| file | why it is safe |
| --- | --- |
| **`core/sampler.ts`** (129 lines) | pools, `buildPrompt` (117), `composePrompt` (126). Takes the salt as an argument (`:122`, `:126`). No vendor, no model, no env, no filesystem. The one comment naming Gemini (`:125`) is prose and is stripped by `smoke-audit.ts:193` (`code()`). |
| **`core/errors.ts`** (20 lines) | `ArchiveErrorCode` is the *archive's* vocabulary; `test/smoke-test.ts:649` pins it at six. Generation failures are message strings (§9), and adding a code here would break that check and demand a row in `STATUS_BY_CODE`. |
| **`cli/status.ts`** (22 lines) | reads `SEED_SALT` (`:5`) and the folder; prints only `version`/`next`/`done`/`waiting`/`failed` (`:18-22`). No key, no model, no provider. Its byte contract (`test/smoke-cli.ts:54-64`) stays valid. |
| **`cli/import-images.ts`** (83 lines) | the free route. Writes `source: "manual"` (`:58`) and nothing else about provenance; reads `SEED_SALT` (`:81`). Its four byte contracts (`smoke-cli.ts:103-158`) are untouched. |
| **`cli/export-prompts.ts`** (77 lines) | reads `SEED_SALT` (`:14`) and writes HTML. No generation path. |
| **`test/no-network.ts`** (63 lines) | instruments sockets/DNS/tls/fetch generically (`:35-47`); nothing provider-specific, nothing to add or amend. §13. |
| **`test/smoke-harness.ts`** (102 lines) | `good`/`bad` (`:19-23`) are `Generator`-shaped by inference and need no change even if `GenOptions` grows a key; `captureOutput` (`:31`), `jobOf`/`settleJob` (`:86-96`) are transport-agnostic. |
| **`web/src/features/generate/start-job.ts`** (14 lines) | passes `GenerateRequest` straight through (`:6`, `:11`); no field is constructed here. |
| **`web/src/shared/lib/status-api.ts`** (9 lines) | typed `Status` (`:2`, `:6`) — a shape change is a type-level change only. |
| **`web/src/shared/lib/job-api.ts`** (15 lines) | typed `JobState`; polls on `status === "running"` (`:14`), which is orthogonal. |
| **`web/src/shared/lib/query-keys.ts`** (20 lines) | `status`, `job`, `images`, `pending` keys; nothing provider-shaped. |
| **`web/src/app/app-shell.tsx`** (82 lines) | reads `status.waiting` (`:47-48`) and `status.problem` (`:67-72`) only — both provider-neutral fields. |
| **`web/src/features/gallery/gallery-page.tsx`** (82 lines) | lists seeds and thumbs; never reads `model` or `source`. |
| **`web/src/features/import/*`**, **`web/src/features/prompts/*`**, **`web/src/shared/components/*`**, **`web/src/lib/text.ts`**, **`web/src/shared/lib/{http,frames-api,prompts-api,settings-store,utils}.ts`** | free route / shared UI / shared primitives; no key, model, size or Attempt status anywhere. `text.ts` exists precisely so the browser does not import `core/output-folder.ts` (`smoke-audit.ts:122`, `test/smoke-test.ts:46-51`). |
| **`server/index.ts`'s `/status`, `/prompts/*`, `/images*`, `/import`** (52-95) | all pure archive operations. Only `/generate` (97-102) touches a key or a Generator. |
| **`core/output-folder.ts`'s Frame pipeline** (205-289, 312-369) | sharp resizing, thumbnails, imports, rejection. `writeFrame` (312-322) takes `FrameWrite` and appends `status: "ok"` (`:321`) — the `...frame` spread means a new `FrameWrite` field is recorded with no edit here. |
| **`vite.config.ts`**, **`tsconfig.json`**, **`web/tsconfig.json`**, **`components.json`**, **`pnpm-workspace.yaml`**, **`.github/workflows/ci.yml`** | aliases, include globs and the CI matrix. `tsconfig.json:15` already includes `core/**/*.ts`, so a new `core/` file is typechecked; CI needs no new step. |
| **`docs/adr/0001-disk-is-authoritative-for-frame-existence.md`** | the rule "Manifest is authoritative only for provenance… and for the count of Seeds whose last Attempt failed" is exactly what a `provider` column and a `blocked` row extend without contradicting. Worth an *addendum* if `blocked` changes what `failed` means, but the decision itself stands. |
| **`negative.txt`**, **`template.txt`**, **`.gitignore`**, **`LICENSE`**, **`AGENTS.md`** | unrelated. |
