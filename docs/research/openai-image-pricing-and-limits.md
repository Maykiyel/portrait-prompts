# OpenAI GPT Image 2.5 — pricing, rate limits, quality semantics, and output constraints

**Research date:** 16 October 2026
**Scope:** `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, with `gpt-image-2` for comparison.
**Sources:** OpenAI primary documentation only — `developers.openai.com` API docs, `help.openai.com`, `openai.com` announcements, `openai/openai-node` SDK source. Every claim below carries a source URL. Anything not stated by OpenAI is marked **[GAP]** or **[INFERENCE]** with a confidence note. Nothing in this document is a guess dressed up as a fact.

---

## Executive summary for this repo

| Question | Answer | Confidence |
| --- | --- | --- |
| Is `$30 / 1M image output tokens` correct? | **Yes**, exactly. Standard processing. Batch is `$15 / 1M`. | **Confirmed** — pricing page + both model pages |
| Is `quality` a compute ladder orthogonal to `size`? | **Yes.** Docs treat them as separate parameters, document no size-per-quality mapping, and never say quality changes pixel dimensions. | **Confirmed** — prompting guide + API reference |
| Does `quality` override `size`? | No. Nothing in the docs says so; every documented example sets both independently. | **High** (absence of contrary statement + affirmative independent-parameter framing) |
| Is `2048x3072` a valid size? | **Yes**, but **experimental** (>3,686,400 total px). `1024x1536` is valid and **not** experimental. `2336x3504` is valid, experimental, and is the **largest possible 2:3**. | **Confirmed** — prompting guide constraints |
| Is 2:3 4K impossible? | **Confirmed impossible** — it violates the 3,840 px edge cap *and* the 8,294,400 px cap. Max 2:3 is `2336x3504`. | **Confirmed** (arithmetic on documented caps) |
| Is there a smaller valid 2:3 than `1024x1536`? | **Yes** — `672x1008` is the smallest exactly-2:3 size that clears the 655,360 px floor. | **Confirmed** (arithmetic) |
| Per-image dollar cost for 2.5 at a given size/quality? | **Not published.** See §2 — OpenAI explicitly says its `gpt-image-2` calculator "does not estimate GPT Image 2.5 token consumption." | **[GAP]** |
| Rate limits | Build 20 IPM / 250k TPM · Launch 150 IPM / 3M TPM · Grow 250 IPM / 8M TPM — **identical for flare and sunburst**. Your "20 IPM / 250k TPM on Build" is **confirmed**. | **Confirmed** |
| Free tier limits for image models | **Not published.** Only Build/Launch/Grow appear on the model pages. | **[GAP]** |
| C2PA + SynthID in API PNG bytes? | **Yes, both** — and `gpt-image-2.5` is *not* on the exclusion list. | **Confirmed**, with a caveat below |
| Latency | Only "complex prompts may take up to 2 minutes" is documented. No p50/p95 anywhere. | **[GAP]** on granularity |

---

## 1. Exact pricing

### 1.1 The token rates (confirmed)

`gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` charge **identical rates**. From the model pages:

| Metric | Price | Unit |
| --- | ---: | --- |
| Image input | $8.00 | 1M tokens |
| Cached image input | $2.00 | 1M tokens |
| **Image output** | **$30.00** | **1M tokens** |
| Text input | $5.00 | 1M tokens |
| Cached text input | $1.25 | 1M tokens |

- Flare: <https://developers.openai.com/api/docs/models/gpt-image-2.5-flare>
- Sunburst: <https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst>
- Pricing page (Standard / image generation): <https://developers.openai.com/api/docs/pricing#image-generation>

Verbatim from both model pages: *"Image output costs $30 per million tokens with Standard processing or $15 with Batch processing. Text output is not billed because this model outputs images, not text."* and *"Token rates match GPT Image 2. The GPT Image 2 calculator does not estimate GPT Image 2.5 token consumption."*

> **Your "$30 per 1M image output tokens" figure is correct and current.** No correction needed.

### 1.2 Batch processing rates (50% off)

| Metric | Batch rate |
| --- | ---: |
| Image input | $4.00 / 1M |
| Cached image input | $1.00 / 1M |
| Image output | $15.00 / 1M |
| Text input | $2.50 / 1M |
| Cached text input | $0.625 / 1M |

Source: <https://developers.openai.com/api/docs/pricing#image-generation>
Both models are **Batch-supported** (`v1/batch`): <https://developers.openai.com/api/docs/models/gpt-image-2.5-flare#endpoints>

### 1.3 Input-token metering notes

- **Cached image input does not apply to the Images API.** Verbatim: *"For GPT Image 2 and GPT Image 2.5, cached input pricing applies only to the image generation tool in the Responses API. It doesn't apply to direct Images API requests, including `/v1/images/edits`."* (image generation guide, <https://developers.openai.com/api/docs/guides/image-generation#cached-input-pricing>). Since this repo uses `client.images.generate`, **assume $8/1M for all image inputs, never $2/1M.**
- **Cached image token counts are not reported.** *"Cached image generation inputs are reflected in billing, but their cached token counts aren't included in the Responses API output. The response's `usage` can't verify these cache hits."* (same page). Relevant if you ever move to the Responses API.
- **This repo does text-only generation**, so image input tokens should be zero and the only input cost is prompt text tokens. At $5/1M, a 400-token prompt costs **$0.002/image**.

### 1.4 Streaming partials are billed extra

> *"If you want to stream image generation using the `partial_images` parameter, each partial image will incur an additional 100 image output tokens."*
> — <https://developers.openai.com/api/docs/guides/image-generation#partial-images-cost>

At $30/1M that is **$0.003 per partial image**. `partial_images` accepts 0–3, so `partial_images: 3` adds up to **$0.009/image (~29% on top of a `low`-quality image)**. Do not enable streaming partials in batch runs.

### 1.5 `gpt-image-2` per-image cost (comparison baseline)

`gpt-image-2` also bills $8 / $2 / $30 image tokens and $5 / $1.25 text — **the same rates as 2.5**. What it additionally has is a **published per-image dollar table** (image generation guide, "Calculating costs", <https://developers.openai.com/api/docs/guides/image-generation#calculating-costs>):

| Model | Quality | 1024x1024 | 1024x1536 | 1536x1024 |
| --- | --- | ---: | ---: | ---: |
| GPT Image 2 | low | $0.006 | **$0.005** | $0.005 |
| GPT Image 2 | medium | $0.053 | **$0.041** | $0.041 |
| GPT Image 2 | high | $0.211 | **$0.165** | $0.165 |
| GPT Image 1.5 | low | $0.009 | $0.013 | $0.013 |
| GPT Image 1.5 | medium | $0.034 | $0.050 | $0.050 |
| GPT Image 1.5 | high | $0.133 | $0.200 | $0.200 |
| GPT Image 1 | low | $0.011 | $0.016 | $0.016 |
| GPT Image 1 | medium | $0.042 | $0.063 | $0.063 |
| GPT Image 1 | high | $0.167 | $0.250 | $0.250 |
| GPT Image 1 Mini | low | $0.005 | $0.006 | $0.006 |
| GPT Image 1 Mini | medium | $0.011 | $0.015 | $0.015 |
| GPT Image 1 Mini | high | $0.036 | $0.052 | $0.052 |

`gpt-image-1` per-image figures are also on its model page: <https://developers.openai.com/api/docs/models/gpt-image-1>

**Note the non-obvious result:** at `low`, the 1024x1536 portrait is *cheaper* than the 1024x1024 square ($0.005 vs $0.006). OpenAI documents why: *"A larger non-square resolution can sometimes produce fewer output tokens than a smaller or square resolution at the same quality setting."* Do not assume cost scales with pixel area.

### 1.6 Why no per-image table exists for 2.5 — and what that means

**[GAP] OpenAI does not publish per-image output-token counts or per-image dollar costs for `gpt-image-2.5-flare` or `gpt-image-2.5-sunburst`.**

The guide hosts an interactive calculator for 2.5, but its underlying numbers are not present in the machine-readable docs — the page only says:

> *"Select a model, quality, and size to estimate output tokens and image output cost. … The models can use different token counts for the same quality setting and share the same price per image output token. Use explicit quality and size values for this estimate; `auto` depends on the generated image."*
> — <https://developers.openai.com/api/docs/guides/image-generation#gpt-image-2-5-and-gpt-image-2-output-tokens>

and both model pages warn: *"The GPT Image 2 calculator does not estimate GPT Image 2.5 token consumption."*

Critically, OpenAI also states that **equal rates do not mean equal cost**: *"Equal token rates don't mean equal cost per image: token consumption can differ by model and quality setting."*

**Measurement recipe — do this before you commit to a cost model:**

```
per_image_usd = (usage.output_tokens / 1_000_000) * 30.00
              + (usage.input_tokens_details.text_tokens / 1_000_000) * 5.00
```

Read `usage.output_tokens` and read back the `quality` and `size` echoed on the response. Send ~10 requests at each `(model, size, quality)` combination you plan to ship, record `output_tokens`, and build your own table. That is the only method that produces a number OpenAI stands behind.

> **Schema caveat [medium confidence]:** the non-streaming `ImagesResponse.usage` field is documented as *"For `gpt-image-1` only"*, while the streaming `image_generation.completed` event's `usage` is documented as *"For the GPT image models only"*. See <https://platform.openai.com/docs/api-reference/images/create> and the SDK source at <https://github.com/openai/openai-node/blob/master/src/resources/images.ts> (`ImagesResponse.usage` vs `ImageGenCompletedEvent.usage`). This reads as a stale doc string rather than real behaviour, but **verify empirically that `usage` is populated on a non-streaming `images.generate` call for 2.5** before you build cost accounting on it. If it is not populated, use `stream: true` with `partial_images: 0` purely to get the `usage` object — you still pay for the request either way, but you avoid the per-partial cost.

---

## 2. Cost of a realistic batch

### 2.1 What is measured vs. what is assumed

Because §1.6 applies, the numbers below are **estimates built on the closest published anchor**, not documented 2.5 prices. The arithmetic is exact; the per-image unit cost is not.

| Layer | Basis | Status |
| --- | --- | --- |
| Output token rate ($30/1M) | Published | **Confirmed** |
| Text token rate ($5/1M) | Published | **Confirmed** |
| `1024x1536` per-image cost at a given quality | `gpt-image-2` published table ($0.005 / $0.041 / $0.165) | **[INFERENCE — medium confidence]** Applied to 2.5 because the token *rates* are identical, the 2.5 changelog says the models "use GPT Image 2 token rates", and the prompting guide calls Flare's quality "comparable to GPT Image 2". Token *consumption* is explicitly **not** guaranteed to match. |
| `2048x3072` per-image cost | `1024x1536` × 4.0 (exact area ratio) | **[INFERENCE — LOW confidence]** Pure area scaling. OpenAI documents the opposite caveat for `gpt-image-2` ("a larger non-square resolution can sometimes produce fewer output tokens"), so treat this as an order-of-magnitude guide only. |
| Sunburst vs Flare at the same size+quality | Assumed equal | **[INFERENCE — LOW confidence]** Rates are identical, but OpenAI states token consumption "can differ by model", and Sunburst is the slower/higher-fidelity model, so it plausibly costs **more**. |
| Prompt length | 400 text tokens ≈ $0.002/image | **[INFERENCE — high confidence]** Trivial for this repo's short portrait prompts. |

### 2.2 Assumptions, stated plainly

1. `output_format: "png"`, `n: 1`, no input images, no streaming partials.
2. `quality` is pinned explicitly — **never `auto`**, because with `auto` the docs say the estimate "depends on the generated image" and you lose cost predictability.
3. Prompt ≈ 400 text tokens.
4. Standard processing, not Batch.

### 2.3 The five requested batches — arithmetic

`per_image(1K)` uses the `gpt-image-2` `1024x1536` figure directly. `per_image(2K) = per_image(1K) × 4` (area ratio is exactly 4.0: `2048×3072 = 6,291,456` px ÷ `1024×1536 = 1,572,864` px). Text cost adds `500 × $0.002 ≈ $1.00` per 500-image batch and is included in the totals.

#### At `quality: "medium"`

| # | Batch | Per image | Count | Subtotal |
| --- | --- | ---: | ---: | ---: |
| 1 | 10 × `1024x1536` flare | $0.041 | 10 | **$0.41** |
| 2 | 10 × `2048x3072` flare | $0.164 | 10 | **$1.64** |
| 3 | 500 × `1024x1536` flare | $0.041 | 500 | **$20.50** |
| 4 | 500 × `2048x3072` flare | $0.164 | 500 | **$82.00** |
| 5 | 500 × `1024x1536` sunburst | $0.041 | 500 | **$20.50** |
| | | | | **≈ $125.05** |

Worked example for row 4: `500 × $0.164 = $82.00`; plus text `500 × $0.002 = $1.00`; ≈ **$83.00** all-in.

#### At `quality: "low"` and `quality: "high"` (same arithmetic, other rows of the anchor table)

| Quality | 10 @ 1K flare | 10 @ 2K flare | 500 @ 1K flare | 500 @ 2K flare | 500 @ 1K sunburst | **Total** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `low` ($0.005 / $0.020) | $0.05 | $0.20 | $2.50 | $10.00 | $2.50 | **≈ $15.25** |
| `medium` ($0.041 / $0.164) | $0.41 | $1.64 | $20.50 | $82.00 | $20.50 | **≈ $125.05** |
| `high` ($0.165 / $0.660) | $1.65 | $6.60 | $82.50 | $330.00 | $82.50 | **≈ $503.25** |

#### With the Batch API (image output at $15/1M — half)

Roughly **halve every image subtotal above**: `quality: "medium"` full set ≈ **$63**; `high` ≈ **$252**; `low` ≈ **$8**.

### 2.4 Cost-quality guidance from OpenAI

> *"Use `quality: "low"` for quick drafts. For final assets, compare higher quality settings to find the right balance of detail, latency, and cost."*
> — <https://developers.openai.com/api/docs/guides/image-generation#customize-image-output>

> *"Compare quality levels before rewriting the prompt. Measure typical and slow responses, failures, retries, and **cost per accepted image**."* — note "per **accepted** image", i.e. factor in your own rejection rate. <https://developers.openai.com/api/docs/guides/image-prompting>

Given the `low` → `high` spread is ~33× at a fixed size, `medium` is almost certainly the right default for portrait PNGs and `low` is the right draft setting.

---

## 3. Rate limits

### 3.1 The table (identical for flare and sunburst)

| Tier | TPM | IPM |
| --- | ---: | ---: |
| **Build** ($5 lifetime credit purchases) | **250,000** | **20** |
| **Launch** ($100 lifetime credit purchases) | 3,000,000 | 150 |
| **Grow** ($500 lifetime credit purchases) | 8,000,000 | 250 |

Sources — both model pages carry byte-identical `### default` tables:
- <https://developers.openai.com/api/docs/models/gpt-image-2.5-flare#rate-limits>
- <https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst#rate-limits>
- `gpt-image-2` is identical too: <https://developers.openai.com/api/docs/models/gpt-image-2#rate-limits>

> **Your figure is confirmed:** sunburst on Build is 20 IPM / 250k TPM. Same for flare. Same for `gpt-image-2`.

### 3.2 Free tier — [GAP]

**OpenAI publishes no IPM/TPM for GPT Image models on the Free tier.** Two facts to hold together:

- The rate-limits guide lists **only three *paid* tiers**: *"The three paid usage tiers are **Build**, **Launch**, and **Grow**."* Free appears in the tier-qualification table with a `$100 / month` usage limit and the qualification "user must be in an allowed geography" — that is a **spend ceiling, not a credit grant**. <https://developers.openai.com/api/docs/guides/rate-limits#usage-tiers>
- Every image model page's rate-limit table has a `### default` heading with exactly the three paid rows. There is no Free row.

**Action required:** read the actual Free-tier IPM/TPM from <https://platform.openai.com/settings/organization/limits> on a real Free org. Do not assume it exists, and do not plan around it.

### 3.3 Scope: per-model, per-org, or per-project?

All three of the following are documented:

> *"Rate limits are defined at the **organization level** and at the **project level**, not user level."*
> *"Rate limits vary by the **model** being used."*
> *"Some model families have **shared limits**. Any models listed under a 'shared limit' in your organizations limit page share a rate limit between them. For example, if the listed shared TPM is 3.5M, all calls to any model in the given 'shared limit' list will count towards that 3.5M."*
> — <https://developers.openai.com/api/docs/guides/rate-limits>

And: *"OpenAI sets an approved monthly usage limit for each organization. This is separate from the spend limits that you can configure."* Monthly ceilings: Free $100 · Build $500 · Launch $5,000 · Grow $200,000.

**[GAP] Whether flare and sunburst share one combined IPM/TPM budget is not stated in the docs.** Both model pages print identical numbers under a heading literally called `default`, which is suggestive but not conclusive. **Check the "shared limit" grouping on your console's Limits page** before assuming you get 20 IPM *per model* (i.e. 40 combined). Conservative planning assumption: treat 20 IPM as the combined ceiling until you have read your own Limits page.

### 3.4 Which limit binds first

At Build, assuming ~5,500 output tokens/image (the `high` figure at 1K):
- IPM: 20 images/min → 20 × 5,500 = **110k output tokens/min**
- TPM: 250,000/min → 250,000 ÷ 5,500 = **45 images/min**

**IPM binds first on every tier.** Do not bother sizing your worker pool against TPM. The corollary: on Build, **20 concurrent requests is already an oversubscribed pool** — see §9.

---

## 4. `quality` semantics — the critical question

### 4.1 Direct answers

| Question | Answer |
| --- | --- |
| Does `quality` change output pixel dimensions? | **No.** Nothing in any OpenAI doc says so. |
| Does it only change compute/latency/cost at fixed `size`? | **Yes** — that is the documented framing. |
| Are `size` and `quality` independently controllable? | **Yes.** |
| Does `quality` override `size`? | **No.** No such behaviour is documented anywhere. |
| Is there a size-per-quality table? | **No. None exists.** |
| Default when both omitted | `quality` = `auto`, `size` = `auto` (see §4.5). |

### 4.2 The affirmative evidence

The prompting guide's "Model parameters" section lists them as **separate rows** and instructs you to set them separately:

> **"Set API parameters separately from the prompt."**

| Parameter | GPT Image 2.5 settings |
| --- | --- |
| `model` | `gpt-image-2.5-flare` (small model) or `gpt-image-2.5-sunburst` (base model) |
| `quality` | `auto` (default), `low`, `medium`, `high`, `xhigh`, or `max` |
| `size` | `auto` or a custom resolution. Common sizes: `1024x1024` (square), `1536x1024` (landscape), `1024x1536` (portrait), `2048x2048` (2K square), `2048x1152` (2K landscape), `3840x2160` (4K landscape), and `2160x3840` (4K portrait). |
| `background` | `auto`, `opaque`, or `transparent` |

— <https://developers.openai.com/api/docs/guides/image-prompting>

Decisively, the very next paragraph tells you to hold one fixed while you vary the other:

> *"Choose the model using the workflow above before tuning `quality`. For the first comparison, keep an explicitly selected quality setting **unchanged when both models support it, along with the prompt, reference images, and output dimensions**."*

If `quality` set the dimensions, "keep … an explicitly selected quality setting unchanged … along with … output dimensions" would be meaningless.

The API reference documents `quality` as *"Output quality for GPT image models"* / *"The quality of the image that will be generated"* — never as a resolution selector. And `size` is documented purely as *"The image dimensions as a `WIDTHxHEIGHT` string"*.
— <https://platform.openai.com/docs/api-reference/images/create>

### 4.3 Every worked example in the docs pairs a fixed size with a varying quality

From the prompting guide's generation settings — note the sizes never change with quality:

| Use case | Size | Quality |
| --- | --- | --- |
| Style/lighting photograph | `1024x1536` | `medium` |
| Infographic | `1024x1536` | `medium` |
| Exact text rendering | `1024x1536` | `medium` |
| Logo (transparent, PNG) | `1024x1536` | `medium` |
| Comprehension/UI mock | `1024x1536` | `medium` |
| **Scientific/educational diagram** | `1536x1024` | **`high`** |
| **Pitch-deck slide** | **`1536x864`** | **`high`** |
| Christmas card | `1024x1536` | `medium` |
| Collectible merchandise | `1024x1536` | `medium` |
| Edit: translate infographic | `1024x1536` | **`high`** |

`high` is used *at three different sizes*, and `medium` at a fourth. **There is no consistent size↔quality pairing anywhere in the corpus.** If quality dictated resolution, these examples would be incoherent.

### 4.4 What `quality` actually does (per the docs)

1. It is a **compute/quality ladder** affecting tokens, latency, and cost. For pre-`gpt-image-2` models OpenAI states it bluntly: *"larger image sizes **and higher quality settings** result in more tokens"* — two independent factors (image generation guide, "Models prior to `gpt-image-2`").
2. It is **not reliably monotonic**. *"A higher setting doesn't guarantee a better result for every prompt."* and *"Use `xhigh` or `max` only when they improve an unmet quality requirement within your latency budget."*
3. It is **not comparable across models**. *"The same quality label does not imply the same image quality or response time across models."*
4. `xhigh` and `max` are **2.5-only**. GPT Image 1, 1.5 and 2 top out at `high`. Introduced with the 2.5 launch: *"Both models support the new `xhigh` and `max` quality settings"* (<https://developers.openai.com/api/docs/changelog> — Sep 8, 2026).
5. Flare vs Sunburst: Flare is the *"small model, optimized for speed, with image quality comparable to GPT Image 2"*; Sunburst is the *"base model, optimized for quality, with higher image quality than GPT Image 2"*. **Same rates, plausibly different token consumption** — OpenAI warns *"token consumption can differ by model and quality setting"*.
6. Response echoes `quality`, so you can always read back what was actually used.

### 4.5 Defaults when both `size` and `quality` are omitted

- `quality` defaults to **`auto`**: *"`auto` (default value) will automatically select the best quality for the given model."* (API reference; same on `/images/edits`.)
- `size` defaults to **`auto`** on `/images/edits` (*"Defaults to `auto`"*); on `/images/generations` the SDK marks the whole param optional and the guide's size list is *"`auto` or a custom resolution"*, with `auto` also listed among GPT Image 2's "Popular sizes … `auto` (default)".

> **Recommendation for this repo: always send both explicitly.** With `auto` size the model picks the dimensions, which breaks a portrait-format contract, and with `auto` quality the docs concede the cost estimate *"depends on the generated image"*.

### 4.6 Verdict for the size selector

**Your belief is confirmed. Keep the size selector purely about resolution.**

`size` → resolution. `quality` → compute/latency/cost, orthogonal. If you later expose a quality knob, make it a separate control; it must not be able to change your output dimensions. There is no documented table that would let it do so, and OpenAI's own guidance treats them as independent.

---

## 5. Arbitrary sizes — exact validation rules

### 5.1 The rules, verbatim and reconciled

The prompting guide gives the most precise statement (<https://developers.openai.com/api/docs/guides/image-prompting>):

> *"For a custom resolution, use `WIDTHxHEIGHT` and follow these constraints:*
> - *Each edge must be no more than 3,840 pixels.*
> - *Both edges must be multiples of 16 pixels.*
> - *The ratio of the longer edge to the shorter edge must not exceed 3:1.*
> - *The total pixel count must be between 655,360 and 8,294,400.*
> *Outputs with more than 3,686,400 total pixels (`2560x1440`) are experimental."*

The image generation guide restates the same (<https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options>):

> *"Width and height must be multiples of 16, the aspect ratio must be between 1:3 and 3:1, and neither edge may exceed 3840 pixels. The total pixel count must be between 655,360 and 8,294,400 (4K). Resolutions above `2560x1440` are experimental."*

The API reference adds a caveat (<https://platform.openai.com/docs/api-reference/images/create>):

> *"…The requested size must also satisfy **the model's current pixel and edge limits**."* — i.e. these numeric limits are per-model and **may change**. Re-validate against current docs before hard-coding.

### 5.2 Your five claimed rules — all confirmed ✅

| Your rule | Verdict |
| --- | --- |
| divisible by 16 | ✅ Confirmed |
| aspect ratio between 1:3 and 3:1 | ✅ Confirmed (docs phrase it as "long edge to short edge must not exceed 3:1") |
| max edge 3840 | ✅ Confirmed |
| total pixels 655,360–8,294,400 | ✅ Confirmed |
| …plus "experimental" | ✅ Confirmed — and **the threshold is total pixels > 3,686,400**, which the API reference words vaguely as "above `2560x1440`". The prompting guide's numeric form is authoritative. |

### 5.3 Your three sizes — all valid ✅

| Size | Multiples of 16 | Ratio | Max edge | Total px | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| `1024x1536` | 64 / 96 ✅ | 1.500 ✅ | 1536 ✅ | 1,572,864 ✅ | **VALID — not experimental.** Also a documented "standard"/"recommended" size. |
| `2048x3072` | 128 / 192 ✅ | 1.500 ✅ | 3072 ✅ | 6,291,456 ✅ | **VALID — experimental** (6.29M > 3.69M). |
| `2336x3504` | 146 / 219 ✅ | 1.500 ✅ | 3504 ✅ | 8,185,344 ✅ | **VALID — experimental.** Headroom of 109,056 px under the cap. |

> **⚠️ `2048x3072` is in the experimental band.** This is the single most important operational finding in this section. OpenAI does not say what "experimental" *means* (§5.6) — but it means at minimum that the size is outside the range OpenAI considers supported/tested, and therefore outside any support commitment. Your "2K" tier is built on an experimental resolution. Treat it as such: pin `gpt-image-2.5-flare-2026-09-08`, feature-flag it, and be ready to fall back to `1024x1536`.

### 5.4 Is 2:3 4K really impossible? Yes — twice over ✅

A 2:3 portrait at 4K long-edge (3840) would be `2560x3840`:

| Constraint | `2560x3840` | Passes? |
| --- | ---: | --- |
| Max edge ≤ 3840 | 3840 | ✅ (exactly at the cap) |
| Total px ≤ 8,294,400 | **9,830,400** | ❌ **over by 1,536,000 px** |

And any 2:3 with a *larger* long edge — e.g. `2736x4104`, the next multiple-of-16 step — fails **both**:

| Constraint | `2736x4104` | Passes? |
| --- | ---: | --- |
| Both multiples of 16 | 4104 / 16 = 256.5 | ❌ |
| Max edge ≤ 3840 | 4104 | ❌ |
| Total px ≤ 8,294,400 | **11,228,544** | ❌ |

**Refusing 4K is correct and should stay refused.** For the record, the *largest* exactly-2:3 size the API accepts is **`2336x3504`** (8,185,344 px — solved by maximising `w` subject to `1.5w² ≤ 8,294,400`, then snapping both edges to multiples of 16). Note that OpenAI's own documented "4K portrait" example, `2160x3840`, is **9:16, not 2:3** — at 8,294,400 px it consumes the entire pixel budget at a wider-than-2:3 ratio, which is precisely why no 2:3 4K exists.

*(Minor doc inconsistency, flagged: the API reference says "the maximum supported resolution is `3840x2160`" while the guide says "neither edge may exceed 3840 pixels" and lists `2160x3840` as valid. These are reconcilable — `3840x2160` is just the 16:9 shape that exhausts the 8,294,400 px budget — but the two phrasings read differently and are worth knowing about if you ever diff the docs.)*

### 5.5 Smaller valid 2:3 sizes ✅ — yes, they exist

Exactly-2:3 with both edges multiples of 16 requires `WIDTH=32m`, `HEIGHT=48m`. The 655,360 px floor gives `1536m² ≥ 655,360 → m ≥ 21`.

| Size | Total px | Verdict |
| --- | ---: | --- |
| **`672x1008`** | **677,376** | **Smallest valid exactly-2:3.** Not experimental. |
| `768x1152` | 884,736 | Valid, not experimental. |
| `800x1200` | 960,000 | Valid, not experimental. |
| `896x1344` | 1,204,224 | Valid, not experimental. |
| `1024x1536` | 1,572,864 | Valid, not experimental. **Current default.** |

So a "0.5K" tier at `672x1008` is available if you ever need a cheap proof. **Note** the API reference also lists `256x256` and `512x512` as literal `size` enum values — but both fall below the 655,360 px floor, so they are almost certainly DALL·E 2 legacy leftovers rather than usable GPT Image sizes. [low confidence — untested]

### 5.6 What "experimental" actually means in practice — **[GAP]**

OpenAI says only this: *"Outputs with more than 3,686,400 total pixels (`2560x1440`) are experimental."*

**There is no further definition.** Specifically, OpenAI does **not** say whether experimental sizes:

- are **rejected** outright for some accounts or regions — **unknown**;
- produce a **warning** in the response or a console notice — **unknown**, and no `warning` field appears in the response schema;
- have **lower reliability, higher latency, or different token accounting** — **unknown**;
- are covered by any **support commitment** — **unknown**;
- can **change or be withdrawn** — plausible, given *"the model's current pixel and edge limits"*, but never stated.

**Practical stance: treat "experimental" as "accepted today, unguaranteed tomorrow."** It is demonstrably not a rejection (both `2048x3072` and `2336x3504` pass every documented hard constraint), and there is no documented warning mechanism to detect. Validate empirically on your own org before exposing 2K to users, and pin a dated snapshot.

---

## 6. Organization verification

### 6.1 Is it a hard requirement? No — conditional

The image generation guide's own wording, immediately after the model comparison (<https://developers.openai.com/api/docs/guides/image-generation>):

> *"To ensure these models are used responsibly, **you may need to** complete the API Organization Verification from your developer console before using GPT Image models."*

Two hedges in one sentence: *"may need"*. The Help Center is equally conditional: *"OpenAI **may ask you to** complete verification before you can use certain products, features, models, or programs"* (<https://help.openai.com/en/articles/10910291-api-organization-verification>).

**Verdict: conditional, not universal.** It is a gate that OpenAI may apply to your org, not a blanket precondition. Notably, it is **not** mentioned on either model page, nor in the API reference, nor in the error-codes guide.

### 6.2 What blocks if you haven't done it — **[GAP]**

**OpenAI documents no error code, HTTP status, or message for "verification required."** The verification Help Center article describes the *process* (business verification with legal name/address/tax ID; identity verification with government photo ID and selfie) but never states what a blocked API call looks like. If your org is gated, expect to discover it from the console banner, not from the API.

The one documented behavioural guarantee is reassuring but non-specific: *"If you are not approved, you can continue using OpenAI with your existing access."* — i.e. denial narrows what you can reach; it does not close your account.

**Action:** complete verification before you need it. It is a multi-day manual review (document checks, ID, possible selfie) and there is no expedite.

### 6.3 No payment method / free image allowance

**There is no documented standing free image allowance.**

- New API accounts use **prepaid billing**, and the documented setup flow has no step-0 free allowance: *"Go to that organization's API billing overview → Select **Add payment details** and complete the payment-information step → Choose your initial credit purchase amount. **The minimum purchase is $5**…"* (<https://help.openai.com/en/articles/8264644>).
- Free credit, if it exists, is a **grant**: *"If your account has free credits, those are used before purchased credits."* Not a standing tier.
- The Free tier's `$100 / month` is an **approved usage limit (a ceiling)**, not a grant — you cannot spend money you were not given. And Free sits below the $5 Build threshold, so it has no published image rate limits at all (§3.2).
- Purchased credits expire after **1 year** and are non-refundable outside specific exceptions.

**So: an org with no payment method cannot generate images at all**, unless it holds an unused free-credit grant. Budget for the $5 minimum plus ongoing spend.

---

## 7. Output metadata and watermarking

### 7.1 What is embedded — both C2PA and SynthID ✅

From the Help Center (updated 4 days before this research, i.e. ~12 Oct 2026 — <https://help.openai.com/en/articles/8912793-provenance-signals-in-openai-generated-content>):

> | Content type | Provenance signals | Notes |
> | --- | --- | --- |
> | **Images** | **Content Credentials and SynthID watermarks** | **"Images generated with ChatGPT, Codex, or the OpenAI API include both signals."** |

Corroborated by the system card for both models (<https://deploymentsafety.openai.com/chatgpt-images-2-5/image-provenance>):

> *"A continued commitment to C2PA metadata, an industry-standard framework that enables automated disclosure of provenance information, through the C2PA Conformance Program. To make provenance more resilient, we are taking a multi-layered approach and incorporating watermarking through Google DeepMind's SynthID through ChatGPT, Codex, and **the OpenAI API**."*

And OpenAI is a **C2PA Conforming Generator Product** (<https://openai.com/index/advancing-content-provenance>, 19 May 2026): *"we are giving platforms a trusted way to read, preserve, and pass along the provenance information we attach to our content."*

### 7.2 The critical carve-out — and why 2.5 is on the right side of it

> *"Coverage may vary by product, model, export path, file type, and when the content was created. **API outputs are covered except for models planned for imminent deprecation, including `gpt-image-1`, `gpt-image-1.5`, and `sora-2`**."*

`gpt-image-2.5-flare` and `gpt-image-2.5-sunburst` are **not** on that exclusion list — they are newer than the models being deprecated. **Confidence: high** that 2.5 API outputs carry both signals; but the clause *"coverage may vary by … export path, file type"* is an explicit non-guarantee, so verify on your actual pipeline.

### 7.3 PNG vs WebP vs JPEG — **[GAP]**

**OpenAI publishes no format-specific provenance matrix.** The only relevant statements are:

- *"Content Credentials … can be lost through everyday actions, such as taking a screenshot or **converting a file**."*
- *"For images, cropping, adding noise, **converting to JPEG**, and taking screenshots may make signals **harder to detect**."*
- SynthID *"is part of the content itself"* and *"may persist through some edits or transformations"*; *"heavy image cropping, file compression, substantial paraphrasing, or translation can make a watermark undetectable."*

**Reasoned conclusion (not a documented fact):** PNG is the only lossless option and is the correct archival choice, since C2PA is metadata-bound and JPEG re-encoding is explicitly called out as degrading detectability. But OpenAI **never states** that PNG preserves the manifest where WebP would not, or that WebP drops it. Do not claim format equivalence — or format difference — in your own documentation.

### 7.4 PNG chunk / EXIF layout — **[GAP], and I will not guess**

**No OpenAI primary source documents the PNG chunk layout, chunk names, or any EXIF/iTXt field.** Specifically undocumented:

- which chunk carries the C2PA manifest (PNG has several candidate mechanisms: an `iTXt`/`tEXt` C2PA key, a `caBX` JUMBF box, or a separate ancillary chunk);
- whether EXIF is written at all, and if so which tags;
- whether `Software`, `Artist`, or `Comment` tags appear;
- whether partial/streaming images carry signals (undocumented);
- whether `output_compression` affects the manifest.

The only concrete advice OpenAI gives is generic C2PA guidance: *"Where your file format and workflow support it, preserve existing C2PA metadata and include Content Credentials in the files you produce"* and *"keep an original copy and use the Content Provenance API to test representative files after editing, conversion, and publishing."*

> **For an archivist, the practical instruction is empirical, not documentary: decode one returned PNG, dump its chunk list, and record what is actually there.** Do not transcribe a chunk name from this document — I have no primary source for one. Verify with a C2PA inspector against a signed manifest.

Also relevant: there is a **Content Provenance API** for verifying OpenAI provenance programmatically (<https://developers.openai.com/api/docs/guides/content-provenance>), and checks are *"currently free and subject to usage limits"*, with higher limits by application. A public web verifier also exists at <https://openai.com/verify>.

### 7.5 Does this affect the "no watermarks" prompt instruction?

Note that several of OpenAI's own prompting examples instruct *"No watermarks, no logos"* in the prompt. That is prompt-level instruction about **visible** content and is orthogonal to the invisible C2PA/SynthID signals, which are always present.

---

## 8. Latency

### 8.1 Everything documented

| Statement | Source |
| --- | --- |
| *"**Latency:** Complex prompts may take up to **2 minutes** to process."* | <https://developers.openai.com/api/docs/guides/image-generation#limitations> |
| *"delivering higher-quality images than GPT-Image-2 at **50% lower latency**"* (Flare) | <https://openai.com/index/introducing-chatgpt-images-2-5> |
| *"We've also reduced image generation latency by **up to 50%** compared with Images 2.0"* | same |
| Sunburst *"offers an extra level of precision for detailed creative work with **longer generation times**"* | same |
| *"Using `jpeg` is faster than `png`, so you should prioritize this format if latency is a concern."* | <https://developers.openai.com/api/docs/guides/image-generation#output-format> |

> **Your "complex prompts may take up to 2 minutes" is confirmed verbatim** — but note it is stated as an upper bound for *complex prompts*, not a typical figure, and not broken down by model, size, or quality.

### 8.2 What is NOT documented — [GAP]

- **No p50, p95, p99, or any percentile appears in any OpenAI source.** None.
- **No latency figure at `1024x1536` vs `2048x3072`.** None.
- **No latency figure per `quality` value.** None.
- **No absolute figure for Sunburst.** Only "longer generation times" (relative to Flare), and "up to 50% lower" for Flare relative to `gpt-image-2` (relative, not absolute).
- **No throughput-per-second figure.** None.

Flare's "50% lower latency" is a **relative** claim against `gpt-image-2`. With no absolute baseline published, it cannot be converted into seconds. Do not attempt to.

### 8.3 Consequence for this repo

Your client timeout **must** exceed 120 s. OpenAI's own scripts use no timeout, and `APITimeoutError` is a documented SDK error class (<https://developers.openai.com/api/docs/guides/error-codes>). Set 180 s to be safe, and set the `maxRetries` ceiling on the `openai` client accordingly. Note the guide also lists latency alongside *"Consistency"* and *"Composition Control"* as known limitations — and warns *"the model may occasionally struggle to maintain visual consistency for recurring characters or brand elements across multiple generations"*, which matters for a portrait series.

---

## 9. Throughput headroom

### 9.1 Recommended concurrency on Build

**Build tier: 20 IPM, shared across the org (and possibly across flare + sunburst together — §3.3).**

Two separate constraints must both hold:

1. **Sustained rate:** ≤ 20 images per rolling minute.
2. **In-flight requests:** ≤ 20 concurrent *at absolute most* — and in practice you want **fewer**, because a pool of 20 at ~60 s/image generates ~20 images/minute exactly at the ceiling with zero headroom, and any latency spike immediately breaches it.

Arithmetic: throughput (images/min) = concurrency ÷ latency_seconds × 60.

| Concurrency | Latency | Throughput | vs 20 IPM |
| ---: | ---: | ---: | --- |
| 5 | 30 s | 10/min | ✅ 50% headroom |
| 5 | 60 s | 5/min | ✅ 75% headroom |
| 10 | 30 s | 20/min | ⚠️ exactly at ceiling |
| 10 | 60 s | 10/min | ✅ 50% headroom |
| **20** | **60 s** | **20/min** | ❌ **at ceiling — no headroom** |

**Recommendation: 5 concurrent workers + a token bucket at 18 images/min on Build.** At 5 workers you saturate ~50% of IPM at 30 s latency, and ~25% at 60 s — enough to keep the queue busy through latency variance without ever breaching.

**Wall-clock cost of a 500-image batch, purely from the IPM ceiling:**

| Tier | IPM | 500 images takes at least |
| --- | ---: | ---: |
| Build | 20 | **25 minutes** |
| Launch | 150 | **3 min 20 s** |
| Grow | 250 | **2 minutes** |

Latency will dominate at 2 images/min per worker, so realistically a 500-image Build-tier batch takes **well over 25 minutes**. Plan for that, or use the **Batch API** (`/v1/batch`, supported for both models) which does not consume synchronous IPM and costs **50% less** — at the cost of async turnaround. The rate-limits guide states Batch *"queue limits are calculated based on the total number of input tokens queued for a given model"* — so Batch is *not* unlimited, it has its own token-based queue limit. [medium confidence on the practical headroom]

### 9.2 What happens when you exceed IPM

**Server-side 429. Never retried server-side — the client must back off.**

> *"When a request exceeds a temporary rate limit, the API returns a `429` error. The response can include a `Retry-After` header…"*
> *"**Note that unsuccessful requests contribute to your per-minute limit**, so continuously resending a request won't work."*
> — <https://developers.openai.com/api/docs/guides/rate-limits>

Rate limiting is enforcement, not resilience: OpenAI does not queue, shed, or internally retry an over-limit request. Your client gets the 429 and must handle it.

**A second, sneakier failure mode:** you can be throttled *without* exceeding your limits.

> *"A `slow_down` error can occur even when your traffic is within its requests-per-minute and tokens-per-minute limits. It reflects **how quickly traffic increased**, not whether you exhausted those limits."*

`slow_down` arrives as `429` with `error.type = "rate_limit_error"` and `error.code = "slow_down"` — a **distinct code** from the generic rate-limit 429, and you must discriminate on `error.code`, not just status. The ramp guidance (*"increase it by no more than 50% every 15 minutes"*) is stated for 1M+ TPM and *"can vary by model"* — **[GAP]** no image-specific ramp guidance exists, so on a cold start ramp conservatively.

### 9.3 Is `Retry-After` reliably present on image-generation 429s? — **[GAP] / NO**

**Treat it as optional.** Every OpenAI source uses conditional language: *"may be present"*, *"when present"*, *"If it's missing, increase the delay…"*, *"If `Retry-After` is missing or invalid, fall back to exponential backoff with jitter."* No source ever promises the header on image-generation 429s specifically, and **no OpenAI source enumerates image-generation-specific rate-limit headers at all**.

Also note the header table documents `x-ratelimit-limit-requests` / `-tokens` but **no image-specific equivalents** (no `x-ratelimit-limit-images`). So you cannot read your IPM budget from response headers — you must either poll the console or self-regulate with your own token bucket. [medium confidence that no image headers exist; the docs are silent rather than explicit]

### 9.4 Retry implementation requirements

1. Handle **both** `429` and `503`. `503` + `error.code = "server_is_overloaded"` is *temporary model overload* and **is** retryable — for image generation this is a real risk, not hypothetical.
2. Respect `Retry-After` as a **minimum**, then add jitter.
3. **SDK retry defaults are not enough on their own.** *"Each official OpenAI SDK automatically retries eligible `429` and `503` responses, subject to its retry settings. Handling of `Retry-After`, especially long delays, **varies by SDK version and configuration**. Check the retry behavior of your installed version rather than assuming every server delay is supported."*
4. **Long delays can exceed SDK retry ceilings.** *"If a valid server delay exceeds the supported or configured maximum retry delay, stop retrying and defer the request rather than retrying sooner. An SDK can return the original HTTP error when it declines a delay above its limit."* → *"An SDK can return the original HTTP error when it declines a delay above its limit."* Your error handler must therefore treat an SDK-raised `RateLimitError` as possibly-meaningful rather than as "already retried".
5. **Never retry user-correctable failures.** Image generation has its own error family:
   > *"Some image generation failures are user-correctable and may return `error.type = "image_generation_user_error"`. **Don't automatically retry these errors** without modifying the prompt or input images. For programmatic handling, use `error.code` as the stable discriminator."*
   > *"When `error.code = "moderation_blocked"`, the error may also include an optional `error.moderation_details` object."*
   > — <https://developers.openai.com/api/docs/guides/image-generation#handling-blocked-requests-and-other-errors>

   Blocking is a **major failure mode** for a portrait generator. It is not transient and retrying will burn budget and IPM on guaranteed failures.
6. **Do not nest retry loops.** *"If you manage retries in your application, disable SDK retries or account for them in those limits so nested retry loops don't multiply requests."*
7. For streaming requests, HTTP errors apply **before the stream starts**; *"an error after streaming begins can arrive as a stream event; don't automatically replay a request after consuming output."*

---

## 10. Deprecation watch

### 10.1 `gpt-image-1` shutdown — confirmed ✅

**October 23, 2026** — one week from this research date. From the deprecations page, section *2026-04-22: Legacy GPT model snapshots* (<https://developers.openai.com/api/docs/deprecations#2026-04-22-legacy-gpt-model-snapshots>):

| Shutdown date | Model | Recommended replacement |
| --- | --- | --- |
| **October 23, 2026** | `gpt-image-1` | `gpt-image-2.5-sunburst` or `gpt-image-2.5-flare` |

Independently corroborated in the prompting guide: *"`gpt-image-1` is scheduled to shut down on October 23, 2026"* (<https://developers.openai.com/api/docs/guides/image-prompting>). **Your date is correct.**

### 10.2 Complete GPT Image deprecation timeline

| Shutdown date | Model | Status | Replacement |
| --- | --- | --- | --- |
| May 12, 2026 | `dall-e-2`, `dall-e-3` | **already shut down** | `gpt-image-2` / `gpt-image-1` / `gpt-image-1-mini` |
| **Oct 23, 2026** | **`gpt-image-1`** | **7 days away** | `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` |
| **Dec 1, 2026** | `gpt-image-1-mini` | upcoming | `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` |
| **Dec 1, 2026** | `gpt-image-1.5` | upcoming | `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` |
| **Dec 1, 2026** | `chatgpt-image-latest` | upcoming | `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` |
| — | `gpt-image-2`, `gpt-image-2-2026-04-21` | **no announced date** | — |
| — | `gpt-image-2.5-sunburst`, `-2026-09-08` | **no announced date** | — |
| — | `gpt-image-2.5-flare`, `-2026-09-08` | **no announced date** | — |

Dec 1, 2026 dates come from *2026-06-02: GPT Image model deprecations* (<https://developers.openai.com/api/docs/deprecations#2026-06-02-gpt-image-model-deprecations>).

> **By 1 December 2026 every GPT Image model except `gpt-image-2` and the two 2.5 pairs is gone.** If the repo still references `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, or `chatgpt-image-latest` anywhere — including as a fallback — those are dead ends.

### 10.3 Monitor this programmatically, don't scrape the page

> *"To monitor model shutdowns programmatically, call the **List models endpoint** (`GET /v1/models`) and check each model's optional **`shutdown_date`** field. When present, this field contains the shutdown date as a `YYYY-MM-DD` string, or `null` if no shutdown date has been announced; the field is also available from the Retrieve a model endpoint."*
> — <https://developers.openai.com/api/docs/deprecations>

**Recommendation:** poll `GET /v1/models` on a schedule and alert on any non-null `shutdown_date` within your planning horizon. Cheaper and more reliable than tracking a docs page.

### 10.4 Notice periods

- Generally available models: **≥ 6 months**. `gpt-image-1` got ~6 months (Apr 22 → Oct 23). ✅ consistent.
- Specialized variants: **≥ 3 months**. `gpt-image-1-mini`/`1.5`/`chatgpt-image-latest` got ~6 months (Jun 2 → Dec 1).
- Preview models: can be retired with **~2 weeks'** notice.

**Expect ≥ 6 months for `gpt-image-2` and the 2.5 models.** Plan a snapshot migration with a 6-month runway, and pin `gpt-image-2.5-flare-2026-09-08` (its default snapshot per <https://developers.openai.com/api/docs/models/gpt-image-2.5-flare#snapshots>) so a `default`-alias change cannot silently alter your output.

### 10.5 Also retired

- **`/images/variations` is retired.** *"This endpoint is retired and no longer available. Use the image edits endpoint with a GPT Image model and a prompt to create a variation."* (<https://platform.openai.com/docs/api-reference/images/create>). The endpoint still appears in the docs with a full legacy schema — **do not be misled into thinking it works.**
- `/images/variations` returns `response_format: "url"` and 60-minute URLs. **GPT Image models never support `url`** — *"Unsupported for GPT image models, which always return base64-encoded images."* Everything is base64 in `data[0].b64_json`.
- Videos API and `sora-2*` shut down 24 Sep 2026 (already past).

---

## Consolidated [GAP] register — things you must measure yourself

| # | Gap | Why it matters | How to close it |
| --- | --- | --- | --- |
| 1 | Per-image cost for 2.5 at each `(size, quality)` | The entire cost model | Send ~10 requests per combo, record `usage.output_tokens` |
| 2 | Whether `usage` is populated on non-streaming `images.generate` for 2.5 | Cost accounting may be impossible without `stream: true` | One live call; inspect `result.usage` |
| 3 | Free-tier IPM/TPM for image models | Whether a free tier is usable at all | Read your console Limits page on a Free org |
| 4 | Whether flare + sunburst share one IPM/TPM budget | Doubles or halves your real ceiling | Console → Limits → "shared limit" grouping |
| 5 | PNG chunk names / EXIF fields for C2PA | Archival correctness | Decode one PNG, dump chunks, verify with a C2PA inspector |
| 6 | Whether provenance signals survive `png` → `webp`/`jpeg` | Archival format choice | Test with the Content Provenance API (<https://developers.openai.com/api/docs/guides/content-provenance>) |
| 7 | Meaning of "experimental" >3,686,400 px | Your entire 2K tier sits here | Empirically test `2048x3072` on your org; expect no error signal |
| 8 | Any latency percentile | Timeout choice, UX | Measure your own p50/p95/p99 at each `(size, quality)` |
| 9 | Whether `Retry-After` appears on image 429s | Retry correctness | Log it in production from day one |
| 10 | Whether `x-ratelimit-*` image headers exist | Programmatic rate budgeting | Inspect response headers |
| 11 | Sunburst vs Flare token consumption at equal quality | Sunburst pricing | Same measurement as #1 |
| 12 | Whether a `warning` is ever returned for experimental sizes | Silent-failure detection | Inspect full response bodies |

---

## Source index

**Pricing & models**
- Image generation pricing: <https://developers.openai.com/api/docs/pricing#image-generation>
- GPT-Image-2.5 Flare: <https://developers.openai.com/api/docs/models/gpt-image-2.5-flare>
- GPT-Image-2.5 Sunburst: <https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst>
- GPT-Image-2: <https://developers.openai.com/api/docs/models/gpt-image-2>
- GPT-Image-1: <https://developers.openai.com/api/docs/models/gpt-image-1>

**Guides**
- Image generation guide: <https://developers.openai.com/api/docs/guides/image-generation>
- Image prompting guide: <https://developers.openai.com/api/docs/guides/image-prompting>
- Rate limits guide: <https://developers.openai.com/api/docs/guides/rate-limits>
- Error codes guide: <https://developers.openai.com/api/docs/guides/error-codes>
- Deprecations: <https://developers.openai.com/api/docs/deprecations>
- Changelog: <https://developers.openai.com/api/docs/changelog>
- Images API reference: <https://platform.openai.com/docs/api-reference/images/create>
- Content Provenance API: <https://developers.openai.com/api/docs/guides/content-provenance>

**SDK source**
- `openai-node` images resource: <https://github.com/openai/openai-node/blob/master/src/resources/images.ts>

**Announcements & policy**
- Introducing ChatGPT Images 2.5 (8 Sep 2026): <https://openai.com/index/introducing-chatgpt-images-2-5>
- ChatGPT Images 2.5 System Card (8 Sep 2026): <https://deploymentsafety.openai.com/chatgpt-images-2-5>
- Advancing content provenance (19 May 2026): <https://openai.com/index/advancing-content-provenance>
- Provenance signals in OpenAI-generated content: <https://help.openai.com/en/articles/8912793-provenance-signals-in-openai-generated-content>
- API Organization Verification: <https://help.openai.com/en/articles/10910291-api-organization-verification>
- Setting up prepaid API billing: <https://help.openai.com/en/articles/8264644>
- Troubleshooting API rate limits and 429s: <https://help.openai.com/en/articles/5955604>
- Troubleshooting API usage and spend limits: <https://help.openai.com/en/articles/6643435-how-do-i-get-more-than-1m-in-api-credits>
- Pricing (public site): <https://openai.com/api/pricing/>