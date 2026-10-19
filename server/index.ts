import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import "dotenv/config";
import { providers, type ProviderRegistry } from "../core/providers";
import type { GenerateRequest } from "../shared/api-types";
import { ArchiveError, type ArchiveErrorCode } from "../core/errors";
import { seedLabel } from "../core/output-folder";
import { createJob, refusalFor } from "./jobs";
import {
  createStore, importRefusal, type Dataset, type FrameStream,
} from "./store";

/** The one table that turns a named code into a status. Nothing else chooses one. */
export const STATUS_BY_CODE: Record<ArchiveErrorCode, 400 | 404 | 409 | 500> = {
  "invalid-seed": 400,
  "invalid-count": 400,
  "missing-frame": 404,
  "seed-not-waiting": 409,
  "salt-mismatch": 409,
  "unreadable-counter": 500,
};

const send = (c: Context, stream: FrameStream) => c.body(Readable.toWeb(stream) as ReadableStream);

/**
 * An app serves exactly one dataset, handed to it rather than found: the root
 * says which output folder, the salt says which run of Seeds is legitimate there.
 * Nothing inside reads the environment, so every app in a process is its own
 * dataset and a test can point one at a temporary directory. The registry of
 * Providers is handed in with it rather than found either, so a route can start a
 * Job without naming an image vendor and a test can drive one with a fake.
 */
export function createApp(dataset: Dataset, registry: ProviderRegistry): Hono {
  const app = new Hono();
  const store = createStore(dataset, registry);
  // The Job belongs to this app and not to the process: built here and closed
  // over, so the routes below ask their own Job and no other app's, and a test
  // can hold one of its own.
  const job = createJob(dataset, registry);

  app.onError((err, c) => {
    if (err instanceof ArchiveError) return c.json({ error: err.message }, STATUS_BY_CODE[err.code]);
    console.error(err);
    return c.json({ error: err.message || "Something went wrong" }, 500);
  });

  const api = new Hono();
  api.get("/status", (c) => c.json(store.getStatus()));
  api.get("/prompts/pending", (c) => c.json(store.getPending(c.req.query("useNegative") === "1")));
  api.post("/prompts/new", async (c) => {
    const { count, useNegative } = await c.req.json<{ count: number; useNegative?: boolean }>();
    return c.json(store.addPrompts(count, useNegative === true));
  });

  api.get("/images", (c) => c.json(store.listImages()));
  // The one full record, for the view that opens a single Frame. The list above
  // answers with a summary per Frame on purpose, so this is where the digests,
  // the sampled attributes and the QC record are read.
  api.get("/images/:seed", (c) => c.json(store.frameRecord(Number(c.req.param("seed")))));
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
    const refused = refusalFor(job.state(), registry, req);
    if (refused) return c.json({ error: refused.message }, refused.status);
    return c.json(job.start(req));
  });
  api.get("/generate/job", (c) => c.json(job.state()));

  app.route("/api", api);
  return app;
}

// The composition root: the one place the environment names a dataset and the
// one place this process names a vendor. Both are read once here and handed on.
const dataset: Dataset = { outDir: process.env.OUT_DIR ?? "out", salt: (process.env.SEED_SALT ?? "").trim() };
const app = createApp(dataset, providers);

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
