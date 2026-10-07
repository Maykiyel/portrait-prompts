import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pad, pendingSeeds, readCursor } from "./common";

const outDir = process.argv.slice(2).filter((a) => a !== "--")[0] ?? "out";
const next = readCursor(outDir);
const pending = pendingSeeds(outDir);
const done = next - 1 - pending.length;

let failed = 0;
const manifest = join(outDir, "manifest.jsonl");
if (existsSync(manifest)) {
  const last = new Map<number, string>();
  for (const l of readFileSync(manifest, "utf8").trim().split("\n"))
    if (l) {
      const r = JSON.parse(l);
      last.set(r.seed, r.status);
    }
  failed = [...last.values()].filter((s) => s === "failed").length;
}

console.log(`Seed salt       ${(process.env.SEED_SALT ?? "").trim() ? "set" : "not set"}`);
console.log(`Next new seed   ${next}`);
console.log(`Images done     ${done}`);
console.log(`Waiting         ${pending.length}${pending.length ? `  (${pad(pending[0])} to ${pad(pending[pending.length - 1])})` : ""}`);
if (failed) console.log(`Last attempt failed for ${failed} seeds, they run first next time`);
