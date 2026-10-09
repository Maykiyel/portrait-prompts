# Disk is authoritative for whether a Seed has a Frame

A Seed has a Frame if and only if the file exists in the output folder. The Manifest is authoritative only for provenance — which Prompt version, which salt, which model or route, the Prompt text — and for the count of Seeds whose last Attempt failed. We considered making the Manifest authoritative for existence, so that a Seed with no `ok` row is waiting regardless of what is on disk, and rejected it: an interrupted Manifest write can leave the two disagreeing, while the filesystem cannot lie about whether a file exists. Rejection already works by deleting the file, not by flipping a status, so this keeps the mechanism and the rule the same thing.

## Consequences

Two derived answers must therefore be computed from different sources, and both are named rather than inferred: *does this Seed have a Frame* is answered by disk, *what was the last Attempt* is answered by the Manifest. Code that needs both asks the module that owns the output folder for both, rather than folding the Manifest itself and cross-referencing the directory.

Any derived cache of the Frame list is disposable. It may be deleted and rebuilt at will, exactly like the thumbnails, because it is never the answer to any question — only a way to avoid re-walking the directory to find one.

A consequence worth stating explicitly, because it is a bug we found while making this decision: a Cursor write is atomic (written to a temporary file, then renamed into place), and an unreadable Cursor is an error rather than an assumption that no run has started. Previously a torn read looked identical to a fresh folder, which both reset the counter to Seed 1 and bypassed the Seed salt guard.
