# Portrait Workbench

Builds a reproducible synthetic portrait dataset. Seeds fix the text sent to a Provider;
images are filed back against the Seed that asked for them, so any image can be traced
back to the exact Prompt that produced it.

## Language

### Seeds

**Seed**:
An integer that fixes the Prompt for exactly one portrait. A Seed is handed out once and never reused.
_Avoid_: index, id, counter value

**Seed salt**:
Private text mixed into every Seed before its Prompt is built, so two people running the same workbench do not produce the same prompts.
_Avoid_: seed prefix, nonce

**Seed counter**:
The running count of Seeds handed out so far. Deleting it resets the run to Seed 1.
_Avoid_: cursor, last seed

**Waiting Seed**:
A Seed that has been handed out but has no Frame yet. Failed API calls, unimported downloads and Rejections all leave a Seed waiting.
_Avoid_: pending, missing, unfulfilled

### Attempts

**Attempt**:
One try at producing a Frame for a Seed, whether it succeeded or failed.

**Manifest**:
The append-only record of every Attempt: which Seed, which Prompt version, which salt, which Provider or route, the Prompt text, the sampled Portrait, both hashes, the quality record, and how it ended. Every row written today carries `schema: 2`. A row is appended and never rewritten, so it keeps saying what was true when it was written.
_Avoid_: log, history, ledger

**Absent key and null**:
The two ways a Manifest row can be missing something. An absent key means unknown: nobody recorded it. `null` means recorded as not applicable, which is what a Provider is on a row a person imported by hand. The string `"unknown"` is never written.
_Avoid_: empty string, unknown, n/a

**Legacy row**:
A Manifest row written before `schema: 2`, carrying only what the writer of that day could write. A field it did not record stays absent, so a legacy row reads with almost everything missing rather than with invented values, and it is never given the attributes today's sampler would draw. A legacy rejection reads as a Rejection with no reason and no quarantine path, because none was recorded.
_Avoid_: old row, backfilled row, unlabelled row

**Interim row**:
A Manifest row written by the unfinished v6 build, which recorded the same facts under several names at once and has no `schema`. Its `rawHash` is read as the Raw hash, because that one was right. Its other hash fields are ignored, because they were computed from a different crop and do not describe the stored bytes, and no normalized hash is ever reconstructed for it. Its quality record is left absent rather than translated, because it was recorded in another shape and relabelling it would claim a check nobody ran.
_Avoid_: v6 row, half-written row

**Rejection**:
The decision to discard a Frame and return its Seed to waiting. The Manifest keeps the record that it happened.
_Avoid_: delete, undo, remove

### Images

**Portrait**:
The fictional adult a Prompt describes. Never a file. A portrait exists as text until a Frame realises it.
_Avoid_: subject, person, character

**Frame**:
The final 768x1152 image for one Seed, cropped and resized from whatever the Provider returned. The unit a dataset is built from. Distinct from the Portrait it depicts.
_Avoid_: image, picture, output, portrait

**Raw image**:
The untouched original the Provider returned, kept byte for byte alongside the Frame so the vendor's own provenance signature survives.
_Avoid_: original, source file

**Thumbnail**:
A small cached copy of a Frame, used by the Gallery. Safe to delete; it is rebuilt on demand.
_Avoid_: preview, thumb, resize

**Quality check**:
One measurement about a Frame's pixels. The checks are `decode`, `dimensions`, `blank`, `luminance`, `aspect`, `duplicate_exact`, `duplicate_perceptual` and `face_presence`. Each is recorded as `pass`, `warn`, `fail` or `not_run`, and every Frame records every check, including the ones that did not run.
_Avoid_: test, validation, detector

**Quality status**:
The roll-up of a Frame's checks: `fail` if any check failed, otherwise `warn` if any warned, otherwise `pass`, and `not_run` only when every check is `not_run`. A check that did not run never pulls the status down.
_Avoid_: verdict, grade, score

**Quality flag**:
A label a Quality check attaches to a Frame, such as `near_blank`, `extreme_luminance_low` or `aspect_ratio_mismatch`. The whole list is `decode_failed`, `zero_dimensions`, `near_blank`, `extreme_luminance_low`, `extreme_luminance_high`, `aspect_ratio_mismatch`, `duplicate_exact`, `duplicate_perceptual` and `duplicate_check_incomplete`. A flag is written only when its check reached the matching state. Flags describe a possible problem; they do not by themselves remove a Frame.
_Avoid_: defect, issue

**Not run**:
The state of a Quality check that did not happen. It is not a pass. No face detector runs here, so `face_presence` is `not_run` on every Frame. `duplicate_exact` and `duplicate_perceptual` are `not_run` only when the duplicate check did not run; otherwise they are `pass`, `warn` or `fail`.
_Avoid_: skipped, skipped as fine, silently passed

**Raw hash**:
The sha256 of the bytes as they arrived, from a Provider or from an import file, hashed before anything touched them. A statement about what came back and nothing else.
_Avoid_: source hash, original hash

**Normalized hash**:
The sha256 of the exact bytes written to the Frame file. The artifact is built once, hashed, and then written from that same buffer, so the hash always matches the file on disk. A Frame refused at ingestion has a Raw hash and no normalized hash, because no artifact was written.
_Avoid_: frame hash, thumb hash, resized hash

**Quarantine**:
The place unaccepted Frame bytes are kept, under `out/quarantine/`. A Frame whose bytes will not decode, or that reports zero dimensions, or that is an exact duplicate, is quarantined at ingestion instead of written into the archive, and its Manifest row marks it as failed and quarantined, with its quarantine path. A Frame moved aside by a Rejection is also kept here, byte-identical, under `NNNNN-<rawhash8>.png` and `raw/NNNNN-<rawhash8>.png`. A Rejection is a decision and is not the same thing as an ingestion quarantine.
_Avoid_: rejected, discarded

**Review status**:
What a person decided about a Frame: `unreviewed` when no decision has been made, `accepted` or `rejected`. It is a separate row from the generation row, so a Rejection never rewrites an Attempt. Accepting a Frame whose Quality status is `fail` is refused. Accepting a Frame whose Quality status is `not_run` is allowed.

**Exact duplicate**:
A Frame whose raw or normalized hash matches an archived or quarantined Frame. It is a `fail` on `duplicate_exact` and is quarantined at ingestion, with the matching Seed and location recorded. A perceptual candidate never rejects anything.

**Perceptual candidate**:
A Frame whose perceptual hash is within the threshold of an archived or quarantined Frame. It is a `warn` on `duplicate_perceptual` and is accepted into the archive, with each match's Seed, location and distance recorded. It never auto-rejects a Frame.

### Prompts

**Prompt**:
The finished text sent to a Provider for one Seed: lead-in, the filled Prompt template, and optionally the Negative list.
_Avoid_: template, description, subject

**Prompt template**:
The text with `{placeholders}` that a Prompt is built from. Changing it changes which Prompt a Seed produces, so it carries a Prompt version.
_Avoid_: prompt, master prompt

**Prompt version**:
The tag naming one revision of the Prompt template and the Attribute pools. Recorded in the Manifest so every image can be traced to the text that made it.
_Avoid_: version, template version

**Attribute pool**:
The ordered list of values one placeholder draws from. Entries are only ever added at the end, because inserting or reordering changes what old Seeds produce.
_Avoid_: options, choices, variants, list

**Ethnicity group**:
One of eleven named groups of ethnicities, such as `europe` or `sub_saharan_africa`. A Portrait's ethnicity is chosen by picking a group with equal weight, then picking an ethnicity inside it, so small groups are not drowned out by large ones. Mixed portraits can carry two groups.
_Avoid_: ethnicity family, region

**Primary group**:
The ethnicity group the first ethnicity draw chose. Recorded on its own in `primaryGroup`, separately from `groups`, because a mixed Portrait may name its second ethnicity first and the draw still began from one group. It is not the first group named in the Prompt.
_Avoid_: main group, first group, dominant group

**Tone band**:
A coarsened value for a visual trait. Skin tone bands are deep, medium_dark, medium, light, and very_light. Eye tone bands are dark, brown, hazel_amber, and light. Groups carry band weights, and mixed portraits average those weights across both groups.
_Avoid_: skin tone, color band

**Template hash**:
The first 12 hex characters of the sha256 of the Prompt template's text. Recorded beside each Frame, so a reader can tell which template built it without having to trust the version tag.
_Avoid_: prompt hash, template id

**Sampler hash**:
The first 12 hex characters of the sha256 of the sampler's definition tables, serialized canonically with sorted keys. Recorded beside each Frame, so a reader can tell which pools built it. It moves when a table or a constant changes, not when the random draw differs.
_Avoid_: pool hash, seed hash

**Photography profile**:
One of six profiles in the photography pool, such as `professional_headshot` or `low_light_portrait`. It controls allowed background settings and lighting, and its description fills the `{photography}` placeholder.
_Avoid_: photo style, camera profile

**Negative list**:
The things to avoid. No provider has a negative-prompt field, so it goes into the Prompt as an "Avoid:" line.
_Avoid_: negative prompt, exclusions

### Runs

A Job and a generation run are two different things, and the code depends on the difference in more than one place. A generation run does the work; a Job is what one app holds while it does, and the command line is a third thing again that drives the same run and then walks away.

**Generation run**:
One pass of `core/generate.ts` over some Seeds: claim them, generate their Frames, record the Attempts, report what happened. It names no Provider and writes to no terminal, so what it reports is decided by whoever asked for it. It keeps nothing between passes — the Manifest already records every Attempt.
_Avoid_: batch, job, execution

**Job**:
One batch of images generated through the API. Seeds it fails stay waiting and run first next time.
What one app holds over such a generation run: one at a time per app, refused without that Provider's API key, and forgotten on a restart, because the Manifest is what survives. The command line drives the same run and renders it to a terminal with an exit code, where the Job keeps the totals and the per-Seed log the browser polls. Neither has a dry run of its own — only the command line offers one, because looking at the work before paying for it is something a person does, and there is nobody at a terminal to do it for a Job.
_Avoid_: task, run, batch, session

**Free route**:
Getting images by pasting Prompts into the Gemini app by hand and importing the downloads. No API key needed.

**API route**:
Getting images by calling a Provider's API. Needs that Provider's paid key. Quota, billing and credit errors are refused outright, because retrying never clears them.

**Provider**:
One image vendor, described by the three things only it knows: the models it offers, the environment variable holding its key, and which image sizes it can produce. A generation run is handed a Provider and names none itself, and the Manifest records which Provider made each image beside which model — a model id on its own implies its vendor by string convention rather than by data.

**Blocked**:
An Attempt that ended because the vendor refused the Prompt itself rather than because the call failed. Its Seed is finished, not waiting, and is never offered again. Distinct from a failure, which keeps waiting for the next run — a call that ran out of quota may succeed tomorrow, and a Prompt that was refused will be refused tomorrow too.
