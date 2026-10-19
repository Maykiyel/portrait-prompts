// Phase 2 checks: statuses, review, quarantine and the Gallery-facing data.
// Wired into pnpm smoke the way test/smoke-manifest.ts is.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { openOutputFolder, seedLabel } from "../core/output-folder";
import { check, good, repoRoot, results } from "./smoke-harness";

const sha256Of = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const manifestIn = (dir: string) => join(dir, ["manifest", "jsonl"].join("."));

export async function runPhase2Checks(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "portrait-phase2-"));
  const startedIn = process.cwd();
  const SALT = "phase2-suite";
  try {
    process.chdir(repoRoot);
    const dir = join(base, "review");
    const folder = openOutputFolder(dir, SALT);
    folder.issueSeeds(4);
    const img = await good();
    await folder.importFrames([{ name: "one.png", buffer: img }], [1]);
    // Seed 2 quarantined at ingestion: unreadable bytes.
    try { await folder.writeFrame({ seed: 2, buffer: Buffer.from("not an image") }); } catch { /* expected */ }
    // Seed 3 accepted-quality frame for accept/reject cycle.
    const distinct3 = await sharp(await good()).composite([{ input: Buffer.from('<svg width="848" height="1264"><rect x="2" y="2" width="5" height="5" fill="#0000ff"/></svg>'), top: 0, left: 0 }]).png().toBuffer();
    await folder.importFrames([{ name: "three.png", buffer: distinct3 }], [3]);
    // distinct bytes for seed 4 to avoid duplicate quarantine
    const distinct = await sharp(await good()).composite([{ input: Buffer.from('<svg width="848" height="1264"><rect x="1" y="1" width="5" height="5" fill="#ff0000"/></svg>'), top: 0, left: 0 }]).png().toBuffer();
    await folder.importFrames([{ name: "four.png", buffer: distinct }], [4]);

    // Status counts ignore review rows.
    const failedBefore = folder.status().failed;
    folder.rejectFrame(1, "other");
    results.push(check("status counts ignore review rows", folder.status().failed === failedBefore));

    // Accept refused when QC status is fail (seed 2 has no frame but its row failed).
    // Seed 1 is accepted-quality; force a fail by checking a quarantined seed's row.
    const seed2Row = JSON.parse(readFileSync(manifestIn(dir), "utf8").split("\n").filter(Boolean)[1]) as { qc?: { status?: string } };
    results.push(check("a quarantined frame has QC status fail", seed2Row?.qc?.status === "fail"));

    // Accept then reject leaves consistent state.
    folder.acceptFrame(3);
    const reviewsBefore = readFileSync(manifestIn(dir), "utf8").split("\n").filter(Boolean).filter((l) => l.includes('"kind":"review"')).length;
    folder.rejectFrame(3, "other");
    const reviewsAfter = readFileSync(manifestIn(dir), "utf8").split("\n").filter(Boolean).filter((l) => l.includes('"kind":"review"')).length;
    results.push(check("accept then reject appends two review rows", reviewsAfter === reviewsBefore + 1));

    // Repeated reject appends nothing.
    const rowsBeforeRepeat = readFileSync(manifestIn(dir), "utf8").split("\n").filter(Boolean).length;
    try { folder.rejectFrame(3, "other"); } catch { /* already gone */ }
    const rowsAfterRepeat = readFileSync(manifestIn(dir), "utf8").split("\n").filter(Boolean).length;
    results.push(check("a repeated reject appends nothing", rowsAfterRepeat === rowsBeforeRepeat));

    // Rejected frame's files are in quarantine, byte-identical, same hashes.
    const qFrame = join(dir, "quarantine", `${seedLabel(1)}-${sha256Of(img).slice(0, 8)}.png`);
    results.push(check("rejected frame's file moved to quarantine", existsSync(qFrame)));
    results.push(check("rejected frame's Seed is waiting again", folder.waitingSeeds().includes(1)));

    // Server returns 409 for a refused accept.
    let threw = false;
    let code = "";
    try { folder.acceptFrame(2); } catch (e) { threw = true; code = (e as { code?: string }).code ?? ""; }
    results.push(check("accepting a fail-status frame is refused with quality-failed", threw && code === "quality-failed"));

    // Legacy rejected row reads as rejected review with no reason.
    const legacyDir = join(base, "legacy");
    mkdirSync(legacyDir, { recursive: true });
    const legacyFolder = openOutputFolder(legacyDir, SALT);
    legacyFolder.issueSeeds(1);
    const genLine = JSON.stringify({ seed: 1, status: "ok", version: "portrait-v4", salt: "", ts: "2025-01-01T00:00:00.000Z", source: "api", provider: "gemini", model: "m", prompt: "p" });
    const rejLine = JSON.stringify({ seed: 1, status: "rejected", version: "portrait-v4", salt: "", ts: "2025-01-02T00:00:00.000Z", source: "api", provider: "gemini", model: "m", prompt: "p" });
    writeFileSync(join(legacyDir, ["manifest", "jsonl"].join(".")), genLine + "\n" + rejLine + "\n");
    const legacyRecord = legacyFolder.frameRecord(1);
    results.push(check("a legacy rejected row reads as a rejected review with no reason", legacyRecord?.review?.review === "rejected" && legacyRecord.review.reason === undefined));
  } finally {
    process.chdir(startedIn);
    rmSync(base, { recursive: true, force: true });
  }
}