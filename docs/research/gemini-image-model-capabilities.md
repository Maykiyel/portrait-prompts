# Gemini image-generation model capabilities (research brief)

**Researched:** 2026-10-16. **Scope:** `gemini-3.1-flash-lite-image`, `gemini-3.1-flash-image`, `gemini-3-pro-image`.
**Sources:** primary only — `ai.google.dev` docs, the `interactions.openapi.json` spec Google publishes for the Interactions API, the `@google/genai` TypeScript SDK (v2.27.0, the version pinned in this repo), Google Cloud / Vertex AI docs, and DeepMind model cards.

Every claim below carries a source URL. Where I could not verify something from a primary source, the claim is marked **Confidence: …** and the gap is stated plainly rather than filled with an estimate. Nothing in this document is inferred from third-party write-ups, forum posts, or community claims.

---

## Headline findings (read these first)

1. **The repo's pixel-size guess is wrong.** At `aspect_ratio: "2:3"` the Gemini 3-family models emit **848×1264 (1K), 1696×2528 (2K), 3392×5056 (4K)** — not 832×1248 / 1664×2496 / 3648×5472. The guessed 832×1248 is the *Gemini 2.5 Flash Image* value, which is a different model and a different resolution ladder.
2. **`gemini-3.1-flash-image` now has a named successor**, `gemini-nano-banana-2.1` (released 2026-10-06). It has no announced shutdown date, but Google explicitly lists it as the "Recommended replacement".
3. **There is no negative-prompt field.** Google documents "semantic negative prompts" — i.e. writing the absence positively in the prompt — as the intended technique.
4. **There is a `seed` field in the API schema** (`generation_config.seed`, "Seed used in decoding for reproducibility"), but **nothing in Google's image-generation documentation says it is honoured by any image model**, and there is no documented determinism or per-prompt-variety guarantee of any kind.
5. **Structured error codes exist and are worth using.** The Interactions API returns `error.code` (e.g. `rate_limit_exceeded`, `quota_exceeded`, `payment_required`, `image_safety`, `no_image`). The JS SDK flattens it into `ApiError.message` as a JSON string, so `JSON.parse(err.message).error.code` is available — better than regexing prose.
6. **Per-model rate limits are no longer published.** The rate-limits page now defines the concepts (RPM/TPM/RPD, and IPM for image models) and defers actual numbers to AI Studio. See the honest gap in §8.

---

## 1. Exact output pixel dimensions at `aspect_ratio: "2:3"`

### 1a. The documented tables

Source for all three tables: **Nano Banana image generation → "Aspect ratios and image size"**, <https://ai.google.dev/gemini-api/docs/image-generation#aspect-ratios-and-image-size> (page last updated 2026-10-09).

These are **documented tables, not inference.**

| Model ID | Marketing name | `image_size` | Exact output (2:3) | Image tokens |
| --- | --- | --- | --- | --- |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | `1K` | **848×1264** | 1120 |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | `2K` | **not supported** | — |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | `4K` | **not supported** | — |
| `gemini-3.1-flash-image` | Nano Banana 2 | `512` | **424×632** | 747 |
| `gemini-3.1-flash-image` | Nano Banana 2 | `1K` | **848×1264** | 1120 |
| `gemini-3.1-flash-image` | Nano Banana 2 | `2K` | **1696×2528** | 1680 |
| `gemini-3.1-flash-image` | Nano Banana 2 | `4K` | **3392×5056** | 2520 |
| `gemini-3-pro-image` | Nano Banana Pro | `1K` | **848×1264** | 1120 |
| `gemini-3-pro-image` | Nano Banana Pro | `2K` | **1696×2528** | 1120 |
| `gemini-3-pro-image` | Nano Banana Pro | `4K` | **3392×5056** | 2000 |

### 1b. Where the 2:3 numbers come from, per model

- **`gemini-3.1-flash-image`** — the "3.1 Flash Image" table row `| **2:3** | 424x632 | 747 | 848x1264 | 1120 | 1696x2528 | 1680 | 3392x5056 | 2520 |`, same URL as above. Fully documented.
- **`gemini-3-pro-image`** — the "3.1 Pro Image" table row `| **2:3** | 848x1264 | 1120 | 1696x2528 | 1120 | 3392x5056 | 2000 |`, same URL as above. Fully documented.
- **`gemini-3.1-flash-lite-image`** — **there is no resolution table for this model anywhere in the docs.** The aspect-ratio/size page has tables for Nano Banana 2.1, 3.1 Flash Image, 3.1 Pro Image and (legacy) 2.5 Flash Image, but **none for the Lite model**.

  What *is* documented for Lite:
  - "Optimized for lower resolutions of **1K (1024x1024px)**" — <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image>
  - "Supported `image_size` values: `1024px` (1K). *(Note: 2K and 4K are unsupported).*" — same URL
  - "Gemini 3.1 Flash Lite Image **only supports 1K resolution**" — <https://ai.google.dev/gemini-api/docs/image-generation>
  - "Output images at 1K (1024x1024px) consume 1120 tokens" — <https://ai.google.dev/gemini-api/docs/pricing>

  So Lite's 2:3/1K is *some* pixel size in the "1K ≈ 1024 on the long edge" family, at 1120 image tokens. That Lite's 2:3/1K equals 848×1264 is a reasonable expectation (identical ladder to 3.1 Flash Image at the same `image_size`, same 1120-token cost, and the Lite model page advertises the same aspect-ratio set), **but it is not stated in any primary source I could find.**

  **Confidence: medium-high (inference from the 3.1 Flash Image 1K table plus matching token counts — not from a Lite-specific table).** The only way to close this gap is to generate one Lite image and read its header, which is outside a primary-source brief.

### 1c. Sanity checks that the tables are internally consistent

- For the 3.x family the ladder is exactly linear: 848×1264 → 1696×2528 → 3392×5056 (each ×2, then ×2 again). So 1K/2K/4K are **not** longest-edge-capped at a fixed value; they are exact 1×/2×/4× multiples of one base raster. Compare the legacy 2.5 Flash Image table, whose 2:3 row is a single `832x1248` — that is where the repo's guess came from.
- `848 × 1264 = 1,071,872 px` (~1.07 MP), `1696 × 2528 = 4,287,488 px`, `3392 × 5056 = 17,149,952 px`. Total pixels scale ×4 per step, exactly like the edge length scaling ×2.
- Aspect ratio check: 1264/848 = 1.4906 — **not** exactly 2/3 (0.6667). 848/1264 = 0.6710. Same for the legacy model: 832/1248 = 0.6667 exactly. **The 3.x 2:3 outputs are very slightly wider than 2:3.** If the repo crops or letterboxes to an exact 2:3, expect to lose ~0.4% of height. Same applies to 3:2, 4:3 etc. — this is a property of the documented tables, not a rounding artefact of one row (e.g. 4:3 1K is 1200×896, and 1200/896 = 1.3393, not 1.3333).

### 1d. Documentation inconsistency worth knowing (not in our three models' 2:3 rows)

On the same aspect-ratio page, the **Nano Banana 2.1** table lists 4K as `2520` image tokens, while the **pricing** page footnote for the same model says 4K "consume 3780 tokens and are equivalent to $0.113 per image". 2520 × $30/1e6 = $0.0756, so the two pages disagree about Nano Banana 2.1's 4K cost. For our three models the tables and pricing footnotes agree (3.1 Flash Image 4K = 2520 = $0.151; Pro Image 4K = 2000 = $0.24). Sources: <https://ai.google.dev/gemini-api/docs/image-generation#aspect-ratios-and-image-size> and <https://ai.google.dev/gemini-api/docs/pricing>.

---

## 2. Valid `aspect_ratio` values

### 2a. The API-level enum (14 values)

From the published OpenAPI spec for the Interactions API, schema `ImageResponseFormat.aspect_ratio`:
`"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:8", "8:1", "1:4", "4:1"`

- Spec: <https://ai.google.dev/static/api/interactions.openapi.json> (schema `components.schemas.ImageResponseFormat`)
- SDK type `ImageResponseFormatAspectRatio`: <https://github.com/googleapis/js-genai> — shipped in `node_modules/@google/genai/dist/node/node.d.ts:8825`, identical union plus `(string & {})`.
- The deprecated sibling schema `ImageConfig.aspect_ratio` has the same 14-value enum: `node_modules/@google/genai/dist/node/node.d.ts:8673`.

**`"2:3"` is a member of the enum, and it is the first entry of the Pro Image and 3.1 Flash Image resolution tables.** So it is valid on all three models as far as the API surface is concerned. See §3 for the Lite caveat on `image_size` and §2b for the Lite caveat on ratios.

### 2b. Per-model supported ratio sets

| Model | Ratios | Source |
| --- | --- | --- |
| `gemini-3.1-flash-lite-image` | `1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9` (10 values) | <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image> — "New `1:1`, `3:2`, `2:3`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9` aspect ratios." Repeated at <https://ai.google.dev/gemini-api/docs/image-generation>: "Gemini 3.1 Flash Lite Image adds `1:1`, `3:2`, `2:3`, … `21:9` aspect ratios." |
| `gemini-3.1-flash-image` | All 14 | "New 1:4, 4:1, 1:8 and 8:1 aspect ratios" — <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image>; full 14-row table at <https://ai.google.dev/gemini-api/docs/image-generation#aspect-ratios-and-image-size> |
| `gemini-3-pro-image` | 10 values: `1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9` — **no `1:8`, `8:1`, `1:4`, `4:1`** | 10-row "3.1 Pro Image" table at <https://ai.google.dev/gemini-api/docs/image-generation#aspect-ratios-and-image-size> |

So: **`2:3` is supported on all three models.** The narrower extreme-aspect ratios (`1:8`, `8:1`, `1:4`, `4:1`) exist only on `gemini-3.1-flash-image` and `gemini-nano-banana-2.1`.

**Confidence: the Lite ratio list is high confidence** (stated verbatim on two independent pages) **but its resolution table is absent, as flagged in §1b.**

### 2c. Default when `aspect_ratio` is omitted

"By default, the model matches the output image size to that of your input image, or otherwise generates 1:1 squares." — <https://ai.google.dev/gemini-api/docs/image-generation#aspect-ratios-and-image-size>. Note the spec's own field description says something slightly different ("the model will choose a default aspect ratio based on any reference images provided", <https://ai.google.dev/static/api/interactions.openapi.json>, `ImageConfig.aspect_ratio`). Consistent enough: text-only input ⇒ 1:1.

---

## 3. `image_size` semantics and compatibility

### 3a. What "1K/2K/4K" denotes

It is **not** a total-pixel budget and **not** a longest-edge cap. It is a **named resolution tier whose concrete W×H depends on the aspect ratio**, and within the 3.x family the tiers are exact 2× scalings of one base raster (848×1264 → 1696×2528 → 3392×5056 at 2:3). Evidence: the per-ratio, per-tier pixel tables at <https://ai.google.dev/gemini-api/docs/image-generation#aspect-ratios-and-image-size>, plus the API-level description "Specifies the size of generated images. Supported values are `1K`, `2K`, `4K`. If not specified, the model will use default value `1K`" (<https://ai.google.dev/static/api/interactions.openapi.json>, `ImageConfig.image_size`).

Naming convention visible in the tables: "1K" means roughly 1024px on the 1:1 side (1024×1024, 512×2048 for 1:4, 3072×384 for 8:1 — all with a ~1024px-ish extent on one side). "512" is the 0.5K tier (`image_size: "512"`, 512×512 at 1:1).

**The `image_size` string is `"512"`, not `"0.5K"`.** Spec enum: `"512", "1K", "2K", "4K"` (<https://ai.google.dev/static/api/interactions.openapi.json>, `ImageResponseFormat.image_size`).

### 3b. Valid (model × image_size) combinations

| Model | `512` | `1K` | `2K` | `4K` | Source |
| --- | --- | --- | --- | --- | --- |
| `gemini-3.1-flash-lite-image` | not listed | ✅ | ❌ unsupported | ❌ unsupported | <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image>; <https://ai.google.dev/gemini-api/docs/image-generation>; <https://ai.google.dev/gemini-api/docs/pricing> |
| `gemini-3.1-flash-image` | ✅ (3.1-Flash-image only) | ✅ | ✅ | ✅ | <https://ai.google.dev/gemini-api/docs/image-generation#aspect-ratios-and-image-size>; "Gemini 3.1 Flash Image adds the smaller 512px (0.5K) resolution (not supported on Gemini Nano Banana 2.1)" |
| `gemini-3-pro-image` | ❌ not in its table | ✅ | ✅ | ✅ | Pro table has no 512 column; 1K/2K/4K only |

Note also that `gemini-nano-banana-2.1` (the new model) does **not** support `512` even though it supports 1K/2K/4K — <https://ai.google.dev/gemini-api/docs/image-generation>.

### 3c. Is `4K` on Lite rejected outright or silently ignored?

**Unknown. I could not find any primary source that says.** Here is exactly what is and is not documented:

- Documented: Lite "only supports 1K resolution"; "2K and 4K are unsupported".
- **Not documented anywhere:** whether an unsupported `image_size` produces an error, a warning, or is silently downgraded.
- The API-level enum **accepts** `"4K"` regardless of model — `ImageResponseFormat.image_size` has no per-model validation at the schema level (<https://ai.google.dev/static/api/interactions.openapi.json>). The type is `"512" | "1K" | "2K" | "4K" | (string & {})`, so TypeScript will not catch a Lite+4K combination either (`node_modules/@google/genai/dist/node/node.d.ts:8835`).
- The error vocabulary that *could* express a rejection exists: `invalid_request` (400) and `out_of_range` (416) are documented codes (<https://ai.google.dev/gemini-api/docs/api-errors>), but Google does not say which one (if either) applies to an unsupported `image_size`.

**Confidence: this is an open gap. Do not rely on either behaviour.** The safe engineering answer is to never send `2K`/`4K` to Lite — which is what the repo's model config already does.

### 3d. Interaction between `aspect_ratio` and `image_size`

- **Yes, there is a hard interaction**: an unsupported *ratio* can invalidate an otherwise-valid *size* combination, because the size ladders are published per ratio. Concretely, `1:8`, `8:1`, `1:4`, `4:1` exist only on `gemini-3.1-flash-image` and `gemini-nano-banana-2.1` (§2b), so e.g. `aspect_ratio: "8:1"` + `model: "gemini-3-pro-image"` has no documented raster.
- **No evidence of any ratio being size-gated** beyond the model-level ones above (e.g. nothing suggests 4K is offered only at some ratios). Every one of the 14 ratios appears in the `gemini-3.1-flash-image` table with a 1K, 2K and 4K column populated.

**Confidence: medium.** This is a reading of the published tables (rows absent per model), not a documented statement about validation behaviour.

---

## 4. Negative prompts

### 4a. No dedicated field — confirmed

There is no `negative_prompt`, `exclude`, or equivalent anywhere in the Gemini image request surface. Verified against:

- The full Interactions API OpenAPI spec — <https://ai.google.dev/static/api/interactions.openapi.json>. Searching the entire spec for a negative/exclusion field on `ImageResponseFormat`, `GenerationConfig`, `ImageConfig`, or the create-interaction body returns nothing. `GenerationConfig`'s full property list is `["image_config","max_output_tokens","seed","speech_config","stop_sequences","temperature","thinking_level","thinking_summaries","tool_choice","top_p","transcription_config","video_config"]` — no negative prompt.
- The SDK types for `ImageResponseFormat_2`: `aspect_ratio`, `delivery`, `image_size`, `mime_type`, `type` only (`node_modules/@google/genai/dist/node/node.d.ts:8795-8815`).
- The docs, which never mention a negative-prompt parameter.

`stop_sequences` exists but is a token-decoding control, not an image exclusion list, and is not documented for image models.

### 4b. The documented technique instead: "semantic negative prompts"

> **Use "semantic negative prompts":** Instead of saying "no cars," describe the intended scene positively: "an empty, deserted street with no signs of traffic."

— <https://ai.google.dev/gemini-api/docs/image-generation#best-practices>

This is the only guidance Google gives on exclusions for these models. Note the irony for this repo: the image-generation docs use "negative space" (§ "Minimalist & negative space design") as a compositional term, so keyword-matching on "negative" over prompts would be noisy.

### 4c. Does the API rewrite or expand the prompt internally?

**No primary source states either way.** The request is a plain `input` string; there is no documented prompt-rewriting, prompt-expansion, or prompt-optimizer layer in the `interactions.create` path. Google *does* publish separate, explicitly opt-in prompt-rewriting products (the Vertex/Gemini Enterprise prompt optimizers, "Zero-shot optimizer" / "Few-shot optimizer", <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/prompts/prompt-optimizer>) — but nothing indicates these run implicitly on `interactions.create`.

The one documented server-side transformation is **thinking**: these models "utilize a 'thinking' process to reason through complex prompts" and "generate interim 'thought images' (visible in the backend but not charged) to refine the composition before producing the final high-quality output" (<https://ai.google.dev/gemini-api/docs/image-generation>). So the pipeline reasons internally before rendering — that is a documented model behaviour, not a documented prompt rewrite.

**Confidence: high that no prompt rewriting is documented; I cannot *prove* the prompt is consumed verbatim.** The honest statement is: *no primary source documents any rewriting, and none documents verbatim consumption either.* I found no Google statement either way, so "verbatim" is an assumption, not a verified fact.

---

## 5. Determinism

### 5a. `seed` — the honest answer is nuanced

- **There IS a `seed` field in the API.** `generation_config.seed`, type `integer`/`int32`, described as **"Seed used in decoding for reproducibility."** Source: <https://ai.google.dev/static/api/interactions.openapi.json>, `components.schemas.GenerationConfig.properties.seed`. It is the only `seed` in the spec.
- **Google never mentions `seed` anywhere in the image-generation documentation.** The string "seed" does not appear on <https://ai.google.dev/gemini-api/docs/image-generation>. So it is *not* documented as supported by any of the three image models.
- Adjacent decoding knobs (`temperature`, `top_p`) are explicitly marked `"deprecated": true` in the same schema, and the troubleshooting page warns that "Gemini 4 and Gemini 3.6+ models ignore custom values for `temperature`, `top_p`, and `top_k` and return deprecation warning headers (and will return `400` errors in a future release)" (<https://ai.google.dev/gemini-api/docs/troubleshooting>). `seed` carries **no** such deprecation marker in the spec — but absence of a marker is not a guarantee.

**Confidence: the field exists (high, verified in the published spec). Whether any image model honours it is unknown and undocumented (no primary source).** Do not build reproducibility on it. It is cheap to test empirically with one fixed prompt + fixed seed, but that is not a primary source.

### 5b. Any documented statement about same-prompt reproducibility or variety?

**No. Nothing.** I searched the image-generation guide, all three model pages, the three model cards' contents, the Interactions overview, the API reference, the pricing page and the troubleshooting page. There is **no** Google statement — in either direction — about whether the same prompt yields the same image, and **no** published per-prompt variety/stability metric.

The only adjacent, load-bearing statement is a limitation that presupposes non-determinism and is relevant to any "generate N variants" workflow:

> "The model won't always follow the exact number of image outputs that the user explicitly asks for."

— <https://ai.google.dev/gemini-api/docs/image-generation> (§ Limitations)

That is the closest thing Google publishes, and it is about *count*, not about repeatability.

**Confidence: this is a documented absence, stated as such. There is no primary source to cite for determinism behaviour, because none exists.**

---

## 6. Watermarking / provenance metadata

### 6a. SynthID — confirmed, all models, on every image

- "All generated images include a [SynthID watermark](https://ai.google.dev/responsible/docs/safeguards/synthid)." — <https://ai.google.dev/gemini-api/docs/image-generation>, stated twice (once in the model-selection section, once under § Limitations).
- "**SynthID watermarking (Always On) + C2PA**." — <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image>.

The "all generated images" phrasing covers the whole Nano Banana family, so it applies to `gemini-3.1-flash-image` and `gemini-3-pro-image` as well as Lite. Lite additionally documents the "Always On" behaviour explicitly and notes it **cannot be disabled**.

### 6b. Visible, invisible, or both? — **not documented**

**Honest gap.** No primary source I could reach states whether the SynthID image watermark on these models is visible, invisible, or a combination.

- The link the image-generation docs point to, <https://ai.google.dev/responsible/docs/safeguards/synthid>, now resolves to a page titled **"SynthID: Tools for watermarking and detecting LLM-generated Text"** (last updated 2025-04-09). It no longer documents the image watermark at all. Its only general statement is: *"Watermarks that are imperceptible to humans can be applied to AI-generated content, and detection models can score arbitrary content to indicate the likelihood that it has been watermarked."* That is a statement about watermarking in general, in a text-specific document — it is **not** a claim about what the image models do.
- Nothing on the three model pages or in the model cards that I fetched says "invisible" or "imperceptible" for images.

**Confidence: unknown. Do not assert either way.** Practically: if an image arrives with a visibly overlaid mark, that is not documented as expected behaviour, and if you need to know, test one returned PNG.

### 6c. C2PA Content Credentials — confirmed, all three models

"Content Credentials provide a transparent look into the origin and history of media files… C2PA… utilizes cryptographically signed metadata to provide secure and verifiable records of a media file's origin and any changes it's undergone." … "If you generate a media file, such as an image, using a supported Google model, Content Credentials are **automatically added and signed by Google LLC**."

The supported-models list explicitly includes **`gemini-3.1-flash-lite-image`**, **`gemini-3-pro-image`**, **`gemini-3.1-flash-image`** (and `gemini-nano-banana-2.1`, `gemini-2.5-flash-image`, the Veo and Lyria models).

- Source: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/content-credentials>
- Verification tool named by Google: <https://verify.contentauthenticity.org/>

Two details that matter for an archive:

1. The credential declares the app/device as **"Google Media Processing Services"**.
2. **Any modification with a non-C2PA tool invalidates it.** Google: *"Any modification to a C2PA-compliant media file using a non-C2PA tool is considered tampering, resulting in a validation failure."* So re-encoding, resizing, or metadata-stripping the archived PNG with `sharp` will break credential verification. (C2PA manifests live in a CAIFFE/CBOR box embedded in the file; that is exactly the kind of byte-level rewrite that trips validation. **Confidence: high on the policy statement, medium on the mechanism detail — Google does not document the container format on this page.**)

### 6d. Anything embedded in the returned PNG bytes?

- **EXIF:** no primary source states that Google writes EXIF into returned images.
- **iTXt / PNG text chunks:** no primary source states anything about PNG text chunks.
- **C2PA manifest:** yes, in substance — cryptographically signed C2PA metadata is attached to the output (§6c), and by C2PA's design it is embedded in the file. **Confidence: high that a manifest is present; the exact byte layout is not documented by Google on these pages.**

Net: **the raw PNG bytes are not a clean image.** They carry (at minimum) a C2PA credential, and plausibly the SynthID signal. If this repo archives the raw returned bytes, that is provenance-bearing data and is worth preserving unmodified; if it re-encodes with `sharp`, provenance breaks and the watermark may not survive.

---

## 7. Response shape for `response_format.type: "image"`

### 7a. What `interactions.create` returns

An `Interaction` resource. Relevant fields (spec: <https://ai.google.dev/api/interactions-api> and <https://ai.google.dev/static/api/interactions.openapi.json>):

```
{
  "id": "v1_...",
  "object": "interaction",
  "created": "...", "updated": "...",
  "model": "gemini-3.1-flash-image",
  "status": "completed" | "in_progress" | "requires_action" | "failed"
            | "cancelled" | "incomplete" | "queued",
  "steps": [ { "type": "model_output", "content": [ … ] } ],
  "usage": { … },
  "errors": [ … ]
}
```

### 7b. Fields on `output_image`

`output_image` is an `ImageContent` block. Its complete field set (spec schema `ImageContent`; SDK type `ImageContent`, `node_modules/@google/genai/dist/node/node.d.ts:8694`):

| Field | Type | Notes |
| --- | --- | --- |
| `type` | `"image"` | const |
| `data` | `string` (base64) | spec: `"format": "byte"` — the bytes of the image |
| `mime_type` | enum | `image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/heif`, `image/gif`, `image/bmp`, `image/tiff` |
| `uri` | `string` | "The URI of the image." |
| `resolution` | `MediaResolution` | "The resolution of the media." |

`output_image` and `output_text` are **SDK-added convenience properties, not wire fields.** The docs are explicit: `output_image` "returns the last generated image block", `output_text` is "added by the SDK", and *"Note: this is added by the SDK"* (`node_modules/@google/genai/dist/node/node.d.ts:9075`). The SDK derives them by walking `steps` backwards for the last `model_output` step containing an `image` content block (`node_modules/@google/genai/dist/node/index.mjs:24721-24745`). Also documented: for "complex, interleaved text-and-image outputs … convenience properties will not capture all parts. You must manually iterate over the steps instead" (<https://ai.google.dev/gemini-api/docs/image-generation>).

### 7c. Is image data always base64? Is a URL ever returned instead?

- **Inline base64 is the default and the only mode the docs demonstrate.** Every image example does `Buffer.from(interaction.output_image.data, "base64")` (<https://ai.google.dev/gemini-api/docs/image-generation>).
- **Yes, a URI mode exists.** `ImageResponseFormat.delivery` has enum `["inline", "uri"]`, described as "Image data is returned inline in the response." / "Image data is returned as a URI." (spec: <https://ai.google.dev/static/api/interactions.openapi.json>, `ImageResponseFormat.delivery`). The `VideoResponseFormat` docs show `delivery` in use.
- **`delivery` is undocumented on the human-readable docs pages** — the aspect-ratio page and the API reference examples never show `delivery` for images, even though the schema has it. (`delivery` for *video* is shown in the API reference example; for image it is only in the schema.) **Confidence: high that the field exists (spec + SDK type); low on any documented semantics, expiry, or auth behaviour for image URIs.**

### 7d. Judging the repo's current access pattern

The repo does `interaction.output_image.data` and falls back to `interaction.output_text` when there's no image. Against the docs that is **correct for the inline default**:

- `data` is the base64 string; `Buffer.from(data, "base64")` is the documented pattern.
- When `response_format` is `{ type: "image" }` (image-only), the docs say you "can configure the response to return only the generated images (omitting the conversational text)". So `output_text` being absent is expected, not an error — <https://ai.google.dev/gemini-api/docs/image-generation>.
- The SDK only sets `output_text` when there is text (`(output_text && { output_text })`, `node_modules/@google/genai/dist/node/index.mjs:24745`), so `undefined` is the natural "no text" signal. Falling back to it is safe and matches the documented multi-modal case.

Two gaps worth knowing:

1. **`output_image.data` is typed `data?: string | undefined`** (optional) while `type: "image"` is required. So `img.data` can legitimately be `undefined` even when `output_image` exists. The repo's `if (!img?.data)` guard already handles this correctly.
2. **`output_image.uri` is not checked.** If `delivery: "uri"` were ever used, `.data` would be absent and the repo would fall through to the "no image" path with a misleading message. Today the repo never sets `delivery`, so this is latent, not live.

### 7e. One API-surface detail: default API version

The Gemini API (API-key) path defaults to **`v1beta`**; the Vertex path defaults to `v1beta1` (`GOOGLE_AI_API_DEFAULT_VERSION = 'v1beta'`, `VERTEX_AI_API_DEFAULT_VERSION = 'v1beta1'`, `node_modules/@google/genai/dist/node/index.mjs:13398-13399`). The reference page notes "The stable v1 version is also available" (<https://ai.google.dev/api/interactions-api>). All schema claims in this document are from the **v1beta** spec, which is what this repo's SDK uses by default.

---

## 8. Rate limits and pricing

### 8a. Per-model per-minute / per-day image limits — **no longer published. Honest gap.**

Source: <https://ai.google.dev/gemini-api/docs/rate-limits> (last updated 2026-10-15). I fetched and searched this page directly; here is the complete picture of what it does and does not say:

**Documented:**
- Limits are evaluated across three dimensions: **Requests per minute (RPM)**, **Tokens per minute, input (TPM)**, **Requests per day (RPD)**.
- "Rate limits are applied **per project, not per API key**."
- "Requests per day (RPD) quotas reset at **midnight Pacific time**."
- "**Images per minute, or IPM**, is only calculated for models capable of generating images (Nano Banana), but is conceptually similar to TPM. Other models might have a token per day limit (TPD)." ← *so IPM is the image-model-specific limiter, and it exists.*
- Spend-based limits on a rolling 10-minute window: **Free N/A; Tier 1 $10; Tier 2 $50; Tier 3 $200**. Hitting one returns **`429 RESOURCE_EXHAUSTED`**.
- Tier qualifications: Free = active project/free trial; Tier 1 = billing linked, $250 cap; Tier 2 = $100 + 3 days, $2,000 cap; Tier 3 = $1,000 + 30 days, $20,000–$100,000+ cap.
- **Priority inference: "0.3× the standard rate limit for each model and tier"** — note this is *lower* throughput at higher price.
- Batch: 100 concurrent batch requests, 2GB input file, 20GB stored; plus **per-model batch enqueued-token caps** (these *are* published, see below).
- "Specified rate limits are **not guaranteed** and actual capacity may vary."
- "For details on those rate limits, see the [AI Studio Rate Limit page](https://aistudio.google.com/rate-limit)."

**Not documented:** per-model RPM, IPM, TPM or RPD numbers for `gemini-3.1-flash-lite-image`, `gemini-3.1-flash-image`, `gemini-3-pro-image`, or anything else. The page contains **no per-model limit table** — the only per-model tables are batch enqueued-token caps.

The published batch enqueued-token caps (the only per-model numbers on the page) for the "Multi-modal generation models" group:

| Model | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| Gemini 3.1 Flash Image Preview 🍌 | 1,000,000 | 250,000,000 | 750,000,000 |
| Gemini 3.1 Flash Lite Image 🍌 | 2,000,000 | 270,000,000 | 1,000,000,000 |
| Gemini 3 Pro Image Preview 🍌 | 2,000,000 | 270,000,000 | 1,000,000,000 |

**Confidence: this is a documented absence.** Anyone needing real IPM/RPD numbers must read them from their own project at <https://aistudio.google.com/rate-limit> (login-walled, per-project, therefore not a primary source I can cite). **I will not guess numbers.**

### 8b. Per-image pricing (paid tier, Standard / Batch)

Source: <https://ai.google.dev/gemini-api/docs/pricing>. All three are **token-priced**, and image output is charged as image tokens — the per-image prices below are Google's own worked equivalents.

**`gemini-3.1-flash-lite-image` (Nano Banana 2 Lite)** — input $0.25/1M; image output $30/1M:

| Tier | Cost per 1K image |
| --- | --- |
| Standard | **$0.0336** |
| Batch | $0.0168 |

**`gemini-3.1-flash-image` (Nano Banana 2)** — input $0.50/1M; image output $60/1M:

| Tier | 0.5K | 1K | 2K | 4K |
| --- | --- | --- | --- | --- |
| Standard | $0.045 | **$0.067** | **$0.101** | **$0.151** |
| Batch | $0.022 | $0.034 | $0.050 | $0.076 |

**`gemini-3-pro-image` (Nano Banana Pro)** — input $2.00/1M ($0.0011/image); image output $120/1M:

| Tier | 1K & 2K | 4K |
| --- | --- | --- |
| Standard | **$0.134** | **$0.24** |
| Batch / Flex | $0.067 | $0.12 |

Note **Pro prices 1K and 2K identically** (both consume 1120 tokens) — a 2× linear resolution increase is free on that model. Flash prices 2K above 1K (1120 → 1680 tokens).

**Free tier:** none of the three is available on the Gemini Developer API free tier — every Free Tier cell in their pricing tables reads "Not available". (`gemini-3-pro-image`'s "Used to improve our products" row is also "Not available"/"No".) So there is **no free-tier image access at all** for these models via the Gemini API — the "Free" column for Flash/Lite models says input/output price "Not available" too.

Also worth knowing for cost modelling: **"thought images" are "visible in the backend but not charged"** (<https://ai.google.dev/gemini-api/docs/image-generation>), and the price is bucketed by `image_size`, **not** by actual pixel count — every aspect ratio in a size tier costs the same token count (e.g. all 1K = 1120 tokens regardless of ratio). So **2:3 costs the same as 1:1 at the same `image_size`.**

### 8c. Comparison with OpenAI's ~20 images-per-minute

**A direct comparison is not possible from primary sources, because the Gemini side of the number does not exist in published form.** What can be said:

- Google's docs confirm an **IPM (images-per-minute) limiter exists for Nano Banana models** and is "conceptually similar to TPM" — i.e. it is a per-minute image counter, structurally the same kind of limit as OpenAI's per-minute image cap. Source: <https://ai.google.dev/gemini-api/docs/rate-limits>.
- Google's docs also confirm limits are **per project** and that "Specified rate limits are not guaranteed and actual capacity may vary".
- There is **no published Gemini image-per-minute figure for any of the three models, on any tier.** I am not going to manufacture one or imply one is "roughly 20".

Indirect signal only (**Confidence: low, do not plan against it**): the Lite model targets "sub-2 second end-to-end latency" and is "engineered for velocity and scale where speed and cost are the primary operational constraints" (<https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image>), and at $0.0336/image Standard a 20-images-per-minute budget would cost ~$0.67/min — well inside the Tier 1 $10/10-min spend limit.

### 8d. A note on Batch

All three models support the Batch API; Gemini 3 Pro Image also has Flex and Priority consumption options, while Flash and Flash Lite Image do not (<https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image>, <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image>, <https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image>). But note: **the Interactions API does not support Batch** — "Batch API … supported by the `generateContent` API but **not yet available** in the Interactions API" (<https://ai.google.dev/gemini-api/docs/interactions-overview#limitations>). So Batch pricing is only reachable via `generateContent`, not via the surface this repo uses.

---

## 9. Error and quota behaviour

### 9a. Structured error codes — yes, and they replace message-regex

Every Interactions API error returns:

```json
{ "error": { "code": "<machine-readable snake_case>", "message": "<human prose>" } }
```

Source: <https://ai.google.dev/gemini-api/docs/api-errors> (last updated 2026-09-20). The docs say plainly: *"Use the `code` field in your application logic to handle errors programmatically."*

**Standard codes** (`code` → HTTP status):

| `error.code` | HTTP | Meaning |
| --- | --- | --- |
| `invalid_request` | 400 | malformed payload / invalid parameter |
| `failed_precondition` | 400 | prerequisite unmet — **docs explicitly cite "disabled billing"** |
| `parameter_unknown` | 400 | unknown parameter |
| `out_of_range` | **416** | parameter outside valid range |
| `authentication` | 401 | key missing/invalid/expired |
| `payment_required` | **402** | **"Your Prepay credit balance is depleted"** — "Don't retry" |
| `permission_denied` | 403 | key lacks permission |
| `not_found` / `model_not_found` | 404 | bad resource / bad model name |
| `already_exists` / `aborted` | 409 | |
| **`rate_limit_exceeded`** | **429** | **"exceeded the per-minute or per-second request or token limit"** — retry with backoff |
| **`quota_exceeded`** | **429** | **"exceeded your daily quota"** — wait for reset or request an increase |
| `too_many_requests` | 429 | too many in a short window |
| `cancelled` | 499 | client disconnected |
| `api_error` | 500 | unexpected server error |
| `unimplemented` | 501 | feature not supported |
| `service_unavailable` | 503 | overloaded/down |
| `deadline_exceeded` | 504 | deadline hit |

Note the precise split that matters for the repo's fail-fast logic: **`rate_limit_exceeded` = per-minute (worth retrying), `quota_exceeded` = per-day (not worth retrying).** That is exactly the distinction the current regex is trying to approximate by matching `per day`.

**Generation blocked codes** (policy/safety): `safety`, `recitation`, `language`, `prohibited_content`, `spii`, `blocklist`, and the image-specific ones **`image_safety`, `image_prohibited_content`, `image_recitation`, `image_other`**, plus `content_blocked` ("an unspecified policy reason"). Docs: "These error codes indicate that policy, safety, or content restrictions **blocked the model's output**. When you receive one of these codes, modify your input and retry."

**Generation error codes**: `no_image` ("The model was unable to generate an image") — directly relevant to this repo — plus `malformed_function_call`, `malformed_tool_call`, `unexpected_tool_call`, `too_many_tool_calls`, `missing_thought_signature`.

Fallback rule documented by Google: *"Any error code not listed above falls back to the `snake_case` version of the HTTP status."*

### 9b. How the JS SDK surfaces them — and how to get at `code`

This is the part that matters practically, because `ApiError` does **not** expose the code as a field.

`ApiError` has exactly two fields: `message: string` and `status: number` (`node_modules/@google/genai/dist/node/node.d.ts:553-556`). But the SDK constructs it as:

```js
const errorMessage = JSON.stringify(errorBody);
const apiError = new ApiError({ message: errorMessage, status });
throw apiError;
```

(`node_modules/@google/genai/dist/node/index.mjs:14052-14079`, `throwErrorIfNotOK`.)

So **the structured code is present, inside `message`, as a JSON string.** Extraction:

```js
function apiCode(err) {
  if (!(err instanceof Error)) return undefined;
  try { return JSON.parse(err.message)?.error?.code; } catch { return undefined; }
}
```

**Confidence: high** — this is verified SDK behaviour at the pinned version (`@google/genai` 2.27.0). **Caveat:** this is a private-ish detail of the SDK's error construction, not a documented contract; a future SDK version could change the message format, so guard the parse with try/catch and fall back to the existing regexes.

### 9c. Billing failure

- **`payment_required` / 402** — "Your **Prepay credit balance is depleted**. Add credits … or turn on auto-reload. **Don't retry**: the request won't succeed until credits are added."
- **`failed_precondition` / 400** — "The request cannot be processed because a prerequisite is not met (**for example, disabled billing**). Verify project billing status."

Both are hard, non-retryable. Together they replace any need to match prose.

### 9d. Content-policy refusal

Two distinct shapes, documented on the Cloud side:

- **Model refusal (not an error):** "If a prompt is potentially unsafe, the model might refuse to process the request. If this happens, the model usually gives a **text response** saying it can't generate unsafe images. The `FinishReason` is `STOP`." → the call *succeeds*, `status: "completed"`, and you get text with no image. This is exactly the case the repo's `output_text` fallback surfaces. Source: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/gemini-image-responsible-ai>.
- **Safety filter blocking (an error):** "If the prompt is identified as potentially harmful by a safety filter, the API returns `BlockedReason` in `PromptFeedback`." / "If the response is identified as potentially harmful by a safety filter, the API response includes a `FinishReason` of `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, or similar." Same source.
- **Interactions API equivalent:** the `image_safety` / `image_prohibited_content` / `image_recitation` / `image_other` codes (<https://ai.google.dev/gemini-api/docs/api-errors>).
- Numeric per-category safety codes (e.g. `56562880` = Violence, output/image; `63429089`, `43188360` = Sexual, output) are documented in a table on the same Cloud page. **Confidence: high** for the Gemini API surface being `image_*` codes; **medium** for the numeric codes being what a Gemini-API (rather than Vertex) caller actually receives, since that table is on the Vertex/Agent Platform page.

### 9e. Rate-limit retry behaviour, and one important SDK caveat

- Docs recommend exponential backoff with jitter on 429/408/5xx, and "Do not retry on client errors (like 400, 402, or 403)". <https://ai.google.dev/gemini-api/docs/troubleshooting>
- **The `@google/genai` JS SDK retries automatically** by default: `maxRetries: 4`, backoff initial 500ms → max 8000ms, `retry_codes: ["408","409","429","5XX"]`, `retryConnectionErrors: true` (`node_modules/@google/genai/dist/node/index.mjs:22242-22258`).

**This is directly relevant to the repo's retry loop in `core/gemini.ts`:** the SDK already burns up to 4 internal retries with up to 30s of backoff before the error ever reaches `isRetryable`, and then the repo's own `maxAttempts = 5` multiplies on top. With `maxElapsedTime: 30000` in the SDK's retry config, a single repo attempt can take ~30s+ of hidden retries. For a quota-exhausted project this is pure added latency, and since 429 is in the SDK's `retry_codes` it will retry `quota_exceeded` four times before the repo's fail-fast regex ever runs. Worth knowing when tuning timeouts.

### 9f. Are the repo's current regex targets documented anywhere?

The repo matches `limit: 0`, `upgrade your tier`, `per day`. **None of these three strings appears in any current Google documentation I searched** (rate limits, troubleshooting, billing, API errors). They look like observed free-tier/zero-quota message text.

That is doubly moot: these three models have **no Free tier at all** (§8b), so the "free tier has limit: 0" situation cannot arise for them. The structured codes `quota_exceeded` (daily) and `payment_required` (no credits) cover the same ground properly. **Confidence: high that the strings are undocumented; I cannot confirm the exact conditions that produce them, only that no current doc does.**

---

## 10. API surface currency

### 10a. `client.interactions.create` — current and recommended

> "The Interactions API is the best way to build with Gemini models and agents. **As of June 2026, it is Generally Available and recommended for all new projects.** While it is now considered legacy, the original `generateContent` API remains fully supported."

— <https://ai.google.dev/gemini-api/docs/interactions-overview>

Also from that page: *"Going forward, all new models, multimodal capabilities, tools, and agentic features will launch on the Interactions API."* So the repo is on the right surface. `generateContent` is legacy-but-supported, and it is the only surface with Batch support (§8d).

One behavioural note the repo should know: interactions are **stored by default** (`store=true`) — 55 days retention on Paid tier, 1 day on Free tier — for server-side `previous_interaction_id` state and observability. `store=false` opts out, but "prevents using `previous_interaction_id`". Same source. The repo's single-turn generator does not currently set `store`, so its prompts and outputs are being retained by Google for up to 55 days on a paid project. Flagging as a data-handling consideration, not a defect.

### 10b. Model currency

From <https://ai.google.dev/gemini-api/docs/deprecations> (last updated 2026-10-12), Nano Banana section:

| Model | Released | Shutdown date | Recommended replacement |
| --- | --- | --- | --- |
| `gemini-nano-banana-2.1` | **2026-10-06** | No shutdown date announced | — |
| `gemini-3.1-flash-lite-image` | 2026-06-30 | No shutdown date announced | — |
| **`gemini-3.1-flash-image`** | 2026-05-28 | **No shutdown date announced** | **`gemini-nano-banana-2.1`** |
| `gemini-3-pro-image` | 2026-05-28 | No shutdown date announced | — |
| `gemini-2.5-flash-image` | 2025-10-02 | 2027-03-15 | `gemini-3.1-flash-lite-image` |

Answering precisely:

- **`gemini-3.1-flash-lite-image`** — current, GA, no deprecation, no successor. Explicitly "recommended migration path" target from `gemini-2.5-flash-image`.
- **`gemini-3.1-flash-image`** — **not deprecated**, but **superseded**. Google names `gemini-nano-banana-2.1` as the recommended replacement, and the image-generation page calls `gemini-3.1-flash-image` "the previous-generation high-efficiency workhorse model" and says **"Recommended for all new projects to use Nano Banana 2.1"** (<https://ai.google.dev/gemini-api/docs/image-generation>). The repo's *default* model is the superseded one.
- **`gemini-3-pro-image`** — current, GA, no deprecation, no replacement named. "Latest update: November 2025" on its model page. Still the "premium choice for the most complex visual tasks".
- **Successor worth knowing:** `gemini-nano-banana-2.1` — the new default workhorse. "Maintains Flash-level speed and cost efficiency while delivering improved visual quality, text rendering, multi-turn consistency, and Google Search grounding across **1K, 2K, and 4K** resolutions." It is **cheaper than `gemini-3.1-flash-image` at every size** ($0.0336 / $0.0504 / $0.113 vs $0.067 / $0.101 / $0.151 Standard). It does **not** support `512`. Its 2:3 pixel dimensions are identical to `gemini-3.1-flash-image` (848×1264 / 1696×2528 / 3392×5056), so it is a drop-in replacement dimensionally.

Other, incidental: **Imagen is shut down** — "Imagen models are shut down. Use Nano Banana models for all image generation tasks." (<https://ai.google.dev/gemini-api/docs/image-generation>). If any legacy code path referenced Imagen, it is dead.

### 10c. One doc gap that affects the repo's "is Lite a legal target" question

The Interactions API's own **Supported models & agents** table lists `gemini-3-pro-image` and `gemini-3.1-flash-image` — but **does not list `gemini-3.1-flash-lite-image`**, even though the image-generation guide documents Lite extensively and the model page exists (<https://ai.google.dev/gemini-api/docs/interactions-overview>). The guide's "New aspect ratios" bullet is even written specifically about Lite ("Gemini 3.1 Flash Lite Image adds … aspect ratios").

**Confidence: the omission is verified in the docs; whether it reflects a real endpoint restriction or just a stale table is unknown.** The repo already calls Lite successfully, so this is a doc inconsistency rather than a functional finding — but it means the supported-models table should not be used as the authority on which image models work over `interactions.create`.

---

## Consolidated confidence ledger

| # | Claim | Confidence | Why |
| --- | --- | --- | --- |
| 1 | 2:3 pixel dimensions for Flash Image and Pro Image | **High** | Published per-ratio, per-size tables |
| 1 | 2:3/1K = 848×1264 on Lite | **Medium-high** | No Lite table exists; inferred from Lite's "1K (1024x1024px)" + 1120-token equivalence + identical ratio set |
| 1 | Repo guess (832×1248 etc.) is wrong for these models | **High** | That value is 2.5 Flash Image's, per the same page's 2.5 table |
| 2 | 14-value ratio enum; `2:3` valid on all three | **High** | OpenAPI enum + model pages + resolution tables |
| 2 | Lite has 10 ratios, Pro has 10 ratios | **High** | Stated verbatim on docs pages |
| 3 | `1K/2K/4K` = named tiers, ratio-dependent, exact 2× scalings | **High** | Published tables |
| 3 | Lite + `2K`/`4K` is rejected rather than ignored | **Unknown — gap** | Not documented either way |
| 3 | Extreme ratios absent on Pro | **Medium** | Reading absent rows in the tables |
| 4 | No negative-prompt field | **High** | Full-spec + SDK-type audit |
| 4 | Prompt is used verbatim | **Unknown — no doc either way** | No primary source states it |
| 5 | `generation_config.seed` exists in the schema | **High** | Published OpenAPI spec |
| 5 | Any image model honours `seed` | **Unknown — undocumented** | Never mentioned in image docs |
| 5 | Same prompt ⇒ different image | **Unknown — undocumented** | No Google statement in either direction |
| 6 | SynthID on all three, always on | **High** | Stated on image-generation + Lite model page |
| 6 | Watermark visible or invisible | **Unknown — gap** | The SynthID doc now covers text only |
| 6 | C2PA on all three | **High** | Explicit supported-models list |
| 6 | EXIF / iTXt behaviour | **Unknown — undocumented** | No source |
| 6 | Re-encoding breaks C2PA | **High** (policy) / **medium** (mechanism) | Google's tampering statement; container format not documented |
| 7 | `output_image` = `{data, mime_type, resolution, type, uri}` | **High** | Spec + SDK types |
| 7 | Inline base64 is the default; `delivery: "uri"` exists | **High** (exists) / **low** (semantics undocumented) | Schema only |
| 8 | Per-model IPM/RPD numbers | **Unknown — no longer published** | Rate-limits page has no per-model table |
| 8 | All per-image prices | **High** | Pricing page worked examples |
| 8 | Free tier unavailable for all three | **High** | Every Free cell reads "Not available" |
| 9 | Structured `error.code` values | **High** | Dedicated API-errors reference |
| 9 | SDK exposes `code` inside `ApiError.message` | **High at v2.27.0** | Read from SDK source; private-ish detail |
| 9 | `limit: 0` / `upgrade your tier` undocumented | **High that they're undocumented** | Absent from all current docs |
| 10 | Interactions API GA + recommended | **High** | Interactions overview |
| 10 | Flash Image superseded by Nano Banana 2.1, not deprecated | **High** | Deprecations table + image-generation page |
| 10 | Lite missing from Interactions supported-models table | **High** (that it's missing) | Table content |

---

## Practical implications for this repo

1. **Fix the expected-dimension constants.** 2:3 is 848×1264 / 1696×2528 / 3392×5056, and the raster is ~0.6710 wide, not exactly 0.6667 — anything that assumes exact 2:3 (hard crops, grid maths, mosaic layout) needs to account for ~0.4% slack.
2. **Never send `2K`/`4K` to the Lite model.** Behaviour is undocumented; enforce it in your own config, which the repo already does.
3. **Consider `gemini-nano-banana-2.1` as the new default** in place of `gemini-3.1-flash-image`: same 2:3 dimensions, cheaper at every size, and Google-named as the successor. `gemini-3-pro-image` stays as the quality tier; Lite stays as the cheap tier.
4. **Swap the message regex for `error.code`.** `JSON.parse(err.message).error.code` gives you `quota_exceeded` (per-day, fail fast), `rate_limit_exceeded` (per-minute, retry), `payment_required` (402, no retry), `failed_precondition` (billing disabled), and `image_safety` / `no_image` — exactly the distinctions the regex approximates, with none of the prose fragility. Keep the regex as a fallback behind a try/catch.
5. **Budget the SDK's internal retries.** 429 is auto-retried up to 4× inside `@google/genai` before the repo sees anything, so a quota-exhausted project pays ~30s of hidden backoff per attempt on top of the repo's own 5 attempts.
6. **Archive the raw returned bytes, unmodified.** They carry a C2PA credential that `sharp` re-encoding will invalidate. If the gallery needs a derived size, keep the original alongside it.
7. **Decide about `store`.** Interactions are stored by default for up to 55 days on paid projects. For a bulk prompt-generation pipeline that is probably not what you want; `store: false` is the opt-out (at the cost of `previous_interaction_id`, which the repo doesn't use).
8. **No negative prompts and no seed.** Variety must come from the prompt text itself. The repo's existing variation strategy is the only lever available — and if it currently retries the same prompt on retryable errors, be aware that retrying an identical prompt may well return an identical image, which would look like a cache hit rather than a success.