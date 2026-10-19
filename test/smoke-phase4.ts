// Phase 4 checks: the audit CLI.
// Wired into pnpm smoke the way test/smoke-manifest.ts is.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { openOutputFolder } from "../core/output-folder";
import { check, good, repoRoot, results } from "./smoke-harness";

const execFileAsync = promisify(execFile);

async function spawnAudit(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", "tsx", "cli/dataset-audit.ts", ...args], {
      cwd: repoRoot,
      env: { ...process.env, SEED_SALT: "", GEMINI_API_KEY: "", OPENAI_API_KEY: "", ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

export async function runPhase4Checks(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "portrait-phase4-"));
  const startedIn = process.cwd();
  const SALT = "phase4-suite";
  try {
    process.chdir(repoRoot);

    const cleanDir = join(base, "clean");
    const cleanFolder = openOutputFolder(cleanDir, SALT);
    cleanFolder.issueSeeds(1);
    await cleanFolder.importFrames([{ name: "one.png", buffer: await good() }], [1]);

    const badDir = join(base, "bad");
    const badFolder = openOutputFolder(badDir, SALT);
    badFolder.issueSeeds(1);
    await badFolder.importFrames([{ name: "one.png", buffer: await good() }], [1]);
    rmSync(join(badDir, "00001.png"), { force: true });

    // Missing folder -> exit 2.
    const rMissing = await spawnAudit(["--dir", join(base, "nope")]);
    results.push(check("a missing folder exits 2", rMissing.code === 2));

    // Clean folder -> exit 0.
    const rClean = await spawnAudit(["--dir", cleanDir]);
    results.push(check("a clean folder exits 0", rClean.code === 0));

    // Bad folder -> exit 1.
    const rBad = await spawnAudit(["--dir", badDir]);
    results.push(check("a folder with integrity problems exits 1", rBad.code === 1));

    // Deterministic JSON.
    const r1 = await spawnAudit(["--dir", cleanDir, "--json"]);
    const r2 = await spawnAudit(["--dir", cleanDir, "--json"]);
    const j1 = JSON.parse(r1.stdout) as { timestamp: string; [k: string]: unknown };
    const j2 = JSON.parse(r2.stdout) as { timestamp: string; [k: string]: unknown };
    const { timestamp: _t1, ...rest1 } = j1;
    const { timestamp: _t2, ...rest2 } = j2;
    results.push(check("two audits produce identical JSON apart from the timestamp", JSON.stringify(rest1) === JSON.stringify(rest2)));

    // Salt mismatch does not change exit code of an otherwise clean folder.
    const rSalt = await spawnAudit(["--dir", cleanDir], { SEED_SALT: "different" });
    results.push(check("a salt mismatch does not change the exit code of a clean folder", rSalt.code === 0));
  } finally {
    process.chdir(startedIn);
    rmSync(base, { recursive: true, force: true });
  }
}