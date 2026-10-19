# The Manifest is append-only, with separate generation and review rows

A row is appended and never rewritten. Generation and import attempts are recorded as generation rows, one per attempt, and a human decision about a Frame is recorded as a separate review row carrying `kind: "review"`. Review rows never change a Seed's generation status, and state is derived from the latest generation row together with the latest review row per Seed.

We considered folding a review into the generation row it was about, rewriting the row with the new status, and rejected it: the Manifest would stop being a record of what happened and become a record of the latest opinion, and an interrupted rewrite would leave two rows claiming to be the current one. We also considered recording a review as another generation row with a `rejected` status, which is what the writer before schema 2 did, and rejected it for the same reason: a rejection is a decision about a Frame, not an attempt to make one, and calling it a status makes the failed count and the waiting set say things they should not.

## Absent versus null

A field that was never recorded is absent. A field recorded as `null` means recorded as not applicable, which is what a Provider is on a row a person imported by hand. The string `"unknown"` is never written for either case. We considered defaulting missing fields to `"unknown"` or to a zero so every row has every key, and rejected it: a default is a value someone has to remember is a default, and it cannot be told apart from a value that was really measured, which is exactly the confusion a reader of an old row must not have. Absence is the only sentinel that survives a copy and paste, because it is the absence of a key rather than a value that looks like the others.

## Consequences

A Seed's state has three independent answers, read from three places: the latest generation row says what the last attempt came to and what its quality checks said, and the latest review row says what a person decided. None of them is the other, and a reader that needs one asks for it by name rather than reading whichever row happened to be last.

Legacy rows, which predate the schema, and interim rows, which came from the unfinished v6 build, are read with their missing fields left absent. A legacy rejection reads as a rejected review with no reason and no quarantine path, because none was recorded. An interim row's `rawHash` is read as the Raw hash, because that one was right; its other hash fields are ignored, because they were computed from a different crop and do not describe the stored bytes. No field is ever back-filled from the current sampler, because a row that kept no attributes never described the Portrait today's tables would draw.