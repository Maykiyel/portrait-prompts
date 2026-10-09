# Portrait Workbench

Builds a reproducible synthetic portrait dataset. Seeds fix the text sent to Gemini;
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
The append-only record of every Attempt: which Seed, which Prompt version, which salt, which model or route, the Prompt text, and how it ended.
_Avoid_: log, history, ledger

**Rejection**:
The decision to discard a Frame and return its Seed to waiting. The Manifest keeps the record that it happened.
_Avoid_: delete, undo, remove

### Images

**Portrait**:
The fictional adult a Prompt describes. Never a file. A portrait exists as text until a Frame realises it.
_Avoid_: subject, person, character

**Frame**:
The final 768x1152 image for one Seed, cropped and resized from whatever Gemini returned. The unit a dataset is built from. Distinct from the Portrait it depicts.
_Avoid_: image, picture, output, portrait

**Raw image**:
The untouched original Gemini returned, kept alongside the Frame.
_Avoid_: original, source file

**Thumbnail**:
A small cached copy of a Frame, used by the Gallery. Safe to delete; it is rebuilt on demand.
_Avoid_: preview, thumb, resize

### Prompts

**Prompt**:
The finished text sent to Gemini for one Seed: lead-in, the filled Prompt template, and optionally the Negative list.
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

**Negative list**:
The things to avoid. Gemini has no negative-prompt field, so it goes into the Prompt as an "Avoid:" line.
_Avoid_: negative prompt, exclusions

### Runs

**Job**:
One batch of images generated through the API. Seeds it fails stay waiting and run first next time.
_Avoid_: task, run, batch, session

**Free route**:
Getting images by pasting Prompts into the Gemini app by hand and importing the downloads. No API key needed.

**API route**:
Getting images by calling the Gemini API. Needs a paid key. Refused outright for quota errors such as "limit: 0", because retrying never clears them.
