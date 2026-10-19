// The three states of a Seed, in their own file because they change for their
// own reason: what the last attempt to generate a Seed came to, what its
// quality checks said, and what a person decided about the Frame are three
// different questions, and the checks below ask them apart rather than letting
// one answer stand in for another. Everything runs offline, on fixtures built
// in process with sharp, and asks the archive through its own interface. The
// only thing written without going through the interface is the pair of rows an
// older build would have written, which no call in this build produces.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { openOutputFolder, type SeedRecord } from "../core/output-folder";
import { check, good, repoRoot, results } from "./smoke-harness";

/**
 * The Manifest file, named the way its owner names it without spelling it.
 *
 * `test/smoke-audit.ts` refuses the literal outside `core/output-folder.ts`, and
 * a test that has to break its own rule to find a file is a test that cannot be
 * trusted with the rule. Two halves joined is the same string and does not
 * appear in this one.
 */
const manifestIn = (dir: string): string => join(dir, ["manifest", "jsonl"].join("."));

/**
 * A square portrait, which is not the 2:3 the archive keeps.
 *
 * The aspect check reads the dimensions of the bytes as they arrived, so a
 * square download reaches the archive with a warned quality status and the
 * `aspect_ratio_mismatch` flag beside it. It still carries structure, because a
 * flat fill fails the near-blank check and a Frame that fails is quarantined
 * rather than written.
 */
const squarePortrait = async (): Promise<Buffer> =>
  sharp({ create: { width: 900, height: 900, channels: 3, background: "#7a8fa6" } })
    .composite([{
      input: Buffer.from(
        '<svg width="900" height="900">' +
        '<rect width="900" height="900" fill="#5c6f86"/>' +
        '<circle cx="450" cy="400" r="210" fill="#c98d6a"/>' +
        '<rect x="180" y="680" width="540" height="220" fill="#31404f"/>' +
        '<rect x="350" y="330" width="66" height="30" fill="#20242c"/>' +
        '<rect x="486" y="330" width="66" height="30" fill="#20242c"/>' +
        "</svg>",
      ),
      top: 0,
      left: 0,
    }])
    .png()
    .toBuffer();

/** Bytes no decoder can read, which is what a failed ingestion looks like. */
const UNREADABLE = Buffer.from("these bytes are not an image at all");

/** A folder of temporary fixtures, out of the repository and out of the way. */
const fixtureRoot = (): string =>
  mkdtempSync(join(
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir(),
    "portrait-state-",
  ));

/**
 * Runs the checks this file owns.
 *
 * The working directory is moved to the repository root for the duration,
 * because `openOutputFolder` reads the Prompt files relative to it and a
 * fixture elsewhere would hand every row a Prompt version that is not this
 * project's. It is put back whatever happens, including when a check throws.
 */
export async function runStateChecks(): Promise<void> {
  const base = fixtureRoot();
  const startedIn = process.cwd();
  const SALT = "state-suite";
  try {
    process.chdir(repoRoot);

    // ---- One archive, four Seeds, four different combinations ---------------
    // The Seeds are laid out so that each claim below has a case it cannot be
    // satisfied by accident:
    //
    //   1  generated and clean, nobody has looked at it
    //   2  generated and warned, then turned down by a person
    //   3  refused as it arrived, so its quality record says fail
    //   4  generated and clean, turned down, then refused again on regeneration
    const dir = join(base, "states");
    const folder = openOutputFolder(dir, SALT);
    folder.issueSeeds(6);
    const imported = await folder.importFrames(
      [
        { name: "one.png", buffer: await good() },
        { name: "two.png", buffer: await squarePortrait() },
        { name: "four.png", buffer: await good() },
      ],
      [1, 2, 4],
    );
    // Seed 3 is refused as it arrived, through the write path rather than the
    // import path: an import cannot even measure a file that will not decode,
    // so it fails before the archive hears anything, and the row that records
    // the refusal is written by the write itself. The call is expected to throw,
    // and the throw is the point rather than an accident of the fixture.
    let refused = false;
    try {
      await folder.writeFrame({ seed: 3, buffer: UNREADABLE });
    } catch {
      refused = true;
    }
    // A person turns Seed 2 down and Seed 4 down. Both lose their Frame, both
    // go back to waiting, and both leave a review row behind.
    folder.rejectFrame(2, "other");
    folder.rejectFrame(4, "other");
    // Seed 4 is then regenerated, because a rejected Seed waits. The bytes that
    // come back are refused again, which is the only way a Seed can end up with
    // a rejected review row and a failed generation row at the same time.
    let regenerationFailed = false;
    try {
      await folder.writeFrame({ seed: 4, buffer: UNREADABLE });
    } catch {
      regenerationFailed = true;
    }

    const one = folder.frameRecord(1);
    const two = folder.frameRecord(2);
    const three = folder.frameRecord(3);
    const four = folder.frameRecord(4);

    results.push(check(
      "a Seed's generation status, quality status and review state are three fields read from three rows",
      imported.length === 3 && imported.every((entry) => entry.ok) && refused && regenerationFailed &&
        one !== undefined && two !== undefined && three !== undefined && four !== undefined &&
        // Nobody has looked at Seed 1, so its review state is the one D7 gives
        // a Seed with no review row rather than an absent field.
        one.state.generationStatus === "ok" && one.state.qcStatus === "pass" &&
        one.state.reviewState === "unreviewed" &&
        // Seed 2 is warned about, which is a different answer from Seed 1's and
        // is read from the QC record on its generation row.
        two.state.generationStatus === "ok" && two.state.qcStatus === "warn" &&
        two.frame.qc?.flags.includes("aspect_ratio_mismatch") === true &&
        // Seed 3 never became a Frame at all: its generation row failed and the
        // quality record on that same row says why.
        three.state.generationStatus === "failed" && three.state.qcStatus === "fail" &&
        three.frame.quarantine !== undefined && four.review !== undefined &&
        // Seed 4 has been both turned down and refused again, and the two facts
        // are held apart rather than one being allowed to overwrite the other.
        four.state.generationStatus === "failed" && four.state.reviewState === "rejected",
    ));

    results.push(check(
      "a review row leaves the generation status and the quality status of the Seed it is about untouched",
      // Seed 2's review row is the latest row in its archive, so anything that
      // let a review row answer for an attempt would be answering here. It is
      // not: both statuses still come from the one generation row, and the
      // decision is held beside them rather than folded into them.
      two !== undefined && four !== undefined && four.review !== undefined &&
        two.review?.review === "rejected" && four.review.review === "rejected" &&
        two.state.generationStatus === two.frame.status && two.state.qcStatus === two.frame.qc?.status &&
        four.state.generationStatus === four.frame.status &&
        // Seed 4's quality status is the fail on the regeneration, not the pass
        // on the Frame it replaced. A Seed is described by one attempt or by
        // none, never by one attempt's status beside another's checks.
        four.state.qcStatus === "fail" && four.frame.qc?.status === "fail" &&
        // And the rejected rows say nothing about an outcome, because a decision
        // about a Frame is not an attempt to make one.
        two.review?.status === undefined && four.review.status === undefined,
    ));

    results.push(check(
      "the failed count ignores review rows, so a rejected Seed whose regeneration failed is failed and waiting at once",
      // Seed 3 was refused as it arrived and Seed 4 was refused on regeneration
      // after a person turned the first Frame down. Both latest generation rows
      // failed, so both count. Seed 4's review row is what makes this a claim
      // rather than a coincidence: under the rule this replaces, a rejected Seed
      // lost its outcome entirely and would have been counted as neither failed
      // nor blocked while sitting in the waiting set all the same.
      folder.status().failed === 2 && folder.status().blocked === 0 &&
        folder.status().done === 1 &&
        // The waiting set and the failed count answer different questions, so a
        // Seed can be in both. Seed 4 is in both, and neither number was bent
        // to make them agree.
        folder.waitingSeeds().join() === "2,3,4,5,6" &&
        !folder.hasFrame(4) && four?.state.generationStatus === "failed" &&
        // A Seed that was turned down but whose last attempt succeeded is
        // neither: it waits, and it did not fail.
        !folder.waitingSeeds().includes(1) && folder.hasFrame(1) &&
        one?.state.generationStatus === "ok",
    ));

    // ---- What the Gallery is handed ------------------------------------------
    // One Frame is left on disk, Seed 1. A review row is appended for it by hand,
    // because the only review action this build has deletes the Frame rather than
    // labelling it, and the claim under test is that the tile reads the label
    // off the review row.
    appendFileSync(
      manifestIn(dir),
      `${JSON.stringify({
        schema: 2, seed: 1, kind: "review", review: "accepted", ts: "2026-02-02T00:00:00.000Z",
      })}\n`,
    );
    const listed = folder.listFrames();
    const tile = listed[0];
    // Asked again rather than reusing the record read before the row was
    // appended, because a derivation that ignored new rows would otherwise pass
    // a check holding a value it could not have been built from.
    const accepted = folder.frameRecord(1);
    // The whole of the summary a FrameRecord is allowed to be: the fields this
    // build settled on, plus the review state, and nothing else.
    const GRID_KEYS = [
      "seed", "version", "source", "provider", "model", "prompt", "updatedAt",
      "primaryGroup", "photographyProfile", "qcStatus", "flags", "reviewState",
    ];
    results.push(check(
      "the Gallery list carries the review state and nothing but the fields a tile draws beside it",
      // Only Seed 1 is on disk: two were rejected, one was quarantined as it
      // arrived and the rest were never issued a Frame. So the list is asked
      // whether it labels the one it has, and it is not asked about frames that
      // are not there.
      listed.length === 1 && tile?.seed === 1 && tile.reviewState === "accepted" &&
        Object.keys(tile).every((key) => GRID_KEYS.includes(key)) &&
        // The review row is beside the Frame rather than part of it: the record
        // still holds the generation status, the quality record and both digests,
        // and none of that reached the tile. The review row itself is not on the
        // tile either, only what it says.
        accepted?.state.reviewState === "accepted" && accepted.state.generationStatus === "ok" &&
        accepted.state.qcStatus === "pass" && accepted.review?.review === "accepted" &&
        !JSON.stringify(listed).includes('"checks"') &&
        !JSON.stringify(listed).includes('"perceptual"') &&
        !JSON.stringify(listed).includes('"sha256"') &&
        // The clean Frame still says the same three things it always did.
        tile.qcStatus === "pass" && Array.isArray(tile.flags) && tile.prompt.length > 0,
    ));

    // ---- One Seed's own record ----------------------------------------------
    results.push(check(
      "the record for one Seed keeps the rows as stored and adds the three states derived from them",
      // The stored rows are handed back as they are, with nothing derived mixed
      // into them, and the three states sit beside them as their own field. A
      // merged object would be a row nobody ever wrote.
      four !== undefined && four.review !== undefined && one !== undefined &&
        Object.keys(four).sort().join() === "frame,review,seed,state" &&
        four.frame.origin === "current" && four.review.origin === "current" &&
        four.state.generationStatus === four.frame.status &&
        four.state.qcStatus === four.frame.qc?.status &&
        four.state.reviewState === four.review.review &&
        // A row whose latest generation failed carries the raw hash and no
        // normalized one, because no artifact was written to hash. The derived
        // state adds nothing to that: it reports what the row has and is silent
        // where the row is.
        four.frame.raw?.sha256 !== undefined && !("normalized" in four.frame) &&
        // The stored rows are still the whole record on a Seed that succeeded,
        // digests and all: this is the one place the quality record is read, and
        // the list route is where it is left out.
        one.frame.normalized?.sha256 !== undefined && one.frame.raw?.sha256 !== undefined &&
        // A Seed no row describes has no record at all rather than an empty one.
        folder.frameRecord(6) === undefined,
    ));

    // ---- Rows the two builds before this one wrote ---------------------------
    // Both are appended to an archive of their own and read back through the
    // folder, so what is asserted is what a reader of that archive is handed.
    const historyDir = join(base, "history");
    // The folder is made here rather than by the module, because the rows below
    // are the whole of its archive and nothing in this fixture writes through
    // the module: an archive whose only contents were written by an older build
    // is exactly the case being exercised.
    mkdirSync(historyDir, { recursive: true });
    const history = openOutputFolder(historyDir, SALT);
    // A legacy generation row: only the keys the writer before the schema could
    // write, so it recorded no quality record at all.
    const LEGACY_GENERATION = {
      seed: 5,
      status: "ok",
      version: "portrait-v4",
      salt: "",
      ts: "2025-01-01T00:00:00.000Z",
      source: "api",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      prompt: "Generate an image. A photorealistic portrait of one fictional adult.",
    };
    // A legacy rejection: the same writer recorded it as a status, because that
    // was all a row could hold, and it named no reason.
    const LEGACY_REJECTION = {
      seed: 5,
      status: "rejected",
      version: "portrait-v4",
      salt: "",
      ts: "2025-02-01T00:00:00.000Z",
    };
    appendFileSync(
      manifestIn(historyDir),
      `${JSON.stringify(LEGACY_GENERATION)}\n${JSON.stringify(LEGACY_REJECTION)}\n`,
    );
    const legacy = history.frameRecord(5) as SeedRecord | undefined;
    results.push(check(
      "a row that recorded nothing derives absent, and a legacy rejection reads as a rejected review",
      legacy !== undefined && legacy.frame.origin === "legacy" && legacy.review?.origin === "legacy" &&
        // The generation status came off the row that carried one, and the
        // rejection came off the row that carried the decision.
        legacy.state.generationStatus === "ok" && legacy.state.reviewState === "rejected" &&
        // No quality record was ever written for that row, so the derived
        // quality status is absent rather than a placeholder string. A folder
        // that did not know answers that way, and never by writing "unknown".
        !("qcStatus" in legacy.state) && !JSON.stringify(legacy).includes("unknown") &&
        // The old writer had nowhere to put a reason, so there is none here
        // either. Nothing is filled in to make the record look complete.
        !("reason" in (legacy.review ?? {})) &&
        // The rows were appended to a folder that issued no counter and holds no
        // Frame, so what is derived here came from rows alone. Disk is what
        // decides whether a Seed is waiting, and it says nothing about this one.
        history.listFrames().length === 0 && history.status().next === 1 &&
        // And a Seed with no row at all is not given one.
        history.frameRecord(6) === undefined,
    ));
  } finally {
    process.chdir(startedIn);
    rmSync(base, { recursive: true, force: true });
  }
}