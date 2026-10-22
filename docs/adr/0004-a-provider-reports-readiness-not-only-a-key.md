# A Provider reports whether it can run, not only whether its key is set

ADR 0002 gave every Provider a key: an environment variable it names, and a boolean the browser reads to know whether the Provider can run. Codex has no key. It runs on the ChatGPT plan the person signed in with through `codex login`. "Is the key set" was the only readiness question the app knew how to ask, and for Codex it has no answer.

A Provider's `keyVar` is now `string | null`, and a Provider may supply `ready()`, which resolves to `{ ok: true }` or `{ ok: false, message }`. One function, `readiness`, answers for every Provider: its own `ready()` when it has one, otherwise the key check that was there before, now with the sentence the Job's refusal already used. The Job refuses a run with that sentence, and the browser gets `ready`, `notReady` and `needsKey` in place of `hasApiKey`. The key itself still never leaves the server.

We considered keeping `hasApiKey` and adding a second field beside it for Providers without a key. We rejected it, because the browser would then have two booleans meaning "can this run" and every screen that shows a Provider would have to know which one to read. We also considered giving Codex a fake key variable that the server sets once sign-in succeeds. We rejected that too: it puts a value in the environment that is not a key, and the check behind it would still have to live somewhere.

## Consequences

Readiness can now cost something. A key check reads the environment. Codex's check starts `codex login status`, a process, and Status is read on every page load. So `ready()` and `readiness` are asynchronous, and the Status route and the Job's refusal await them instead of blocking the server while a process runs. The Codex Provider also caches its answer for 15 seconds and shares one check between requests that arrive together. A Provider that adds an expensive check must do the same, because the route will not.

Codex does not get a folder of its own. An early version let the person pick one for a second copy of every image, and it was removed: the dataset already keeps the bytes Codex returned, unchanged, in `out/raw`, so a second folder only duplicated them and gave the person a path to get wrong.

More facts about a vendor moved onto the Provider for the same reason as its rate limit: `maxConcurrency`, for a vendor that can only make one image at a time; `stopAfterFailures`, the number of failures in a row that end a run; `afterAttempt`, which the run calls once a Seed's Frame is stored or its failure recorded, so a Provider can remove files of its own only after the archive holds what it needs; and `promptWrapper`, the version of any instruction the Provider wraps the Prompt in, which the run records in each row's `params`. Both callers hand all of them over through `runPartsFor`, so neither keeps its own copy.

The smoke audit's vendor guard now treats importing `child_process` as naming a vendor. Codex is reached by starting a process rather than through an SDK, so that import is what has to stay out of the run.
