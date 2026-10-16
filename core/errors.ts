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
  | "invalid-seed";

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
  | "no-image";

export class GenerationFailure extends Error {
  constructor(
    readonly code: GenerationFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "GenerationFailure";
  }
}