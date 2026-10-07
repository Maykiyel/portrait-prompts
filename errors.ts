/**
 * The one failure type raised by code that owns the output folder. Callers switch
 * on `code`, never on the message, so rewording a message cannot change behaviour.
 */
export type ArchiveErrorCode = "unreadable-counter";

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}