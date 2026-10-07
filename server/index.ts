import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import "dotenv/config";
import type { GenerateRequest } from "../shared/api-types";
import { getJob, startJob } from "./jobs";
import {
  ApiError, addPrompts, getPending, getStatus, imagePath, importFiles, listImages, rejectImage, thumbnail,
} from "./store";

const salt = (process.env.SEED_SALT ?? "").trim();
const app = new Hono();

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  if (err.message.startsWith("SEED_SALT")) return c.json({ error: err.message }, 409);
  console.error(err);
  return c.json({ error: err.message || "Something went wrong" }, 500);
});

const seedParam = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "Invalid seed");
  return n;
};

const api = new Hono();
api.get("/status", (c) => c.json(getStatus(salt)));
api.get("/prompts/pending", (c) => c.json(getPending(salt, c.req.query("useNegative") === "1")));
api.post("/prompts/new", async (c) => {
  const { count, useNegative } = await c.req.json<{ count: number; useNegative?: boolean }>();
  return c.json(addPrompts(count, salt, useNegative === true));
});

api.get("/images", (c) => c.json(listImages()));
api.get("/images/:seed/thumb", async (c) => {
  const width = Math.min(Math.max(Number(c.req.query("w") ?? 320), 80), 768);
  const file = await thumbnail(seedParam(c.req.param("seed")), width);
  c.header("Content-Type", "image/webp");
  c.header("Cache-Control", "no-cache");
  return c.body(Readable.toWeb(createReadStream(file)) as ReadableStream);
});
api.get("/images/:seed/file", (c) => {
  const file = imagePath(seedParam(c.req.param("seed")), c.req.query("raw") === "1");
  c.header("Content-Type", "image/png");
  c.header("Cache-Control", "no-cache");
  if (c.req.query("download") === "1") c.header("Content-Disposition", `attachment; filename="${c.req.param("seed").padStart(5, "0")}.png"`);
  return c.body(Readable.toWeb(createReadStream(file)) as ReadableStream);
});
api.post("/images/:seed/reject", (c) => {
  rejectImage(seedParam(c.req.param("seed")));
  return c.json({ ok: true });
});

api.post("/import", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body.files;
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File);
  let seeds: number[];
  try {
    seeds = JSON.parse(String(body.seeds ?? "[]")) as number[];
  } catch {
    throw new ApiError(400, "seeds must be a JSON array");
  }
  return c.json({ results: await importFiles(files, seeds, salt) });
});

api.post("/generate", async (c) => c.json(startJob(await c.req.json<GenerateRequest>(), salt)));
api.get("/generate/job", (c) => c.json(getJob()));

app.route("/api", api);

// Built UI, when it exists. In development Vite serves the UI instead.
const dist = "./web/dist";
if (existsSync(`${dist}/index.html`)) {
  app.use("/*", serveStatic({ root: dist }));
  app.get("*", (c) => c.html(readFileSync(`${dist}/index.html`, "utf8")));
}

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`API on http://127.0.0.1:${port}${existsSync(`${dist}/index.html`) ? " (serving the built UI)" : ""}`);
});
