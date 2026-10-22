/**
 * The one failure type raised by code that owns the output folder. Callers switch
 * on `code`, never on the message, so rewording a message cannot change behaviour.
 */
export type ArchiveErrorCode =
  | "unreadable-counter"
  | "salt-mismatch"
  | "missing-frame"
  | "seed-not-waiting"
  | "invalid-count"
  | "invalid-seed"
  | "quality-failed";

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

/**
 * Why a generation failed, as a code rather than a message.
 *
 * The run reduces a thrown value to a message string before it decides anything,
 * so without a type carrying a code there is no way to tell a failure that a
 * later run might clear from one that no run will clear. `prompt-refused` is the
 * second kind: the vendor refused the Prompt itself, so this Seed and every
 * Seed built from this Prompt are finished. Everything else is the first kind,
 * and the Seed keeps waiting.
 */
export type GenerationFailureCode =
  /** The vendor refused the Prompt itself. No run will ever generate this Seed. */
  | "prompt-refused"
  /** The call came back with no image in it. The Prompt is still usable. */
  | "no-image"
  /**
   * The app asked for a shape or a size of image the vendor client has no way to
   * request. Its own code rather than `no-image`, because nothing was called: a
   * call that came back empty is a render that lost the draw and the next run
   * may make, and this is a request no run will clear until it names another.
   */
  | "unsupported-size"
  /**
   * The vendor reworded the Prompt before making the image. The image describes
   * a different Portrait than the Seed names, so it is not filed, and the Seed
   * keeps waiting.
   */
  | "prompt-altered"
  /**
   * The vendor made an image but did not say what text it made it from, so
   * nothing can confirm the Seed's Prompt was the one used. Not filed, for the
   * same reason as an altered Prompt: an unchecked image would be recorded as
   * clean.
   */
  | "prompt-unverified"
  /**
   * The account has run out of images for now. Not a fact about this Seed, so
   * the Seed keeps waiting, and every Seed after it would fail the same way: the
   * run stops rather than spending the rest of the batch to find out.
   */
  | "usage-limit"
  /** The vendor's tool is not signed in. The run stops for the same reason as a usage limit. */
  | "signed-out";

/** The codes that end a run: what failed is the account, not the Seed. */
export const STOPPING_CODES = ["usage-limit", "signed-out"] as const;
export type StoppingCode = (typeof STOPPING_CODES)[number];

export const isStopping = (code: GenerationFailureCode): code is StoppingCode =>
  (STOPPING_CODES as readonly string[]).includes(code);

export class GenerationFailure extends Error {
  constructor(
    readonly code: GenerationFailureCode,
    message: string,
    /** When a usage limit says it clears, as the vendor wrote it. Absent when it did not say. */
    readonly resetsAt?: string,
  ) {
    super(message);
    this.name = "GenerationFailure";
  }
}

/**
 * A Frame refused as it arrived, rather than a call that failed.
 *
 * This is its own type rather than an `ArchiveError` because it is the one
 * failure in the run that has already been recorded. The folder writes the row
 * that says what happened, once, with the quarantine on it, and then raises this
 * so the caller learns about it. A caller that recorded the failure again on
 * catching it would append a second row describing the same attempt, and the
 * second one would be the latest: the archive would lose the quarantine and
 * report a plain failure instead.
 *
 * `ArchiveErrorCode` is untouched, because this is not a refusal about the
 * folder. Every code on it is a code a caller turns into an HTTP status, and
 * this one would be turned into a failure nobody can do anything about.
 */
export class FrameQuarantined extends Error {
  constructor(
    readonly seed: number,
    /** Where the bytes received were kept. */
    readonly path: string,
    /** Why the Frame was refused, in the words the quality checks used. */
    readonly reason: string,
  ) {
    super(`Seed ${seed} was quarantined on arrival: ${reason}`);
    this.name = "FrameQuarantined";
  }
}
