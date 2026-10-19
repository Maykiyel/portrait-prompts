# OpenAI image generation: moderation behaviour on benign synthetic portrait prompts

**Research date:** 2026-10-16
**Scope:** primary sources only — `developers.openai.com` API docs, `openai.com` policies, OpenAI's Deployment Safety Hub system cards, the `openai-node` SDK source, `ai.google.dev` Gemini docs, and (clearly labelled) OpenAI Developer Community threads.
**Workload under study:** this repo's `core/sampler.ts` prompt generator — randomized adult age (21–76), gender, nationality/ethnicity, skin tone, eyes, face shape, hair, facial hair, facial feature, expression, pose, profession, wardrobe, background, lighting; plus a `Negative` list appended as `Avoid: <comma list>.` (`core/sampler.ts:126-129`).

---

## How to read this document

Three labels are used throughout, and they are not interchangeable:

| Label | Meaning |
|---|---|
| **[DOC]** | Stated in OpenAI or Google first-party documentation, policy, system card, or SDK source. |
| **[ANECDOTE]** | A user report on OpenAI's developer forum, a third-party blog, or a help-centre community. Not authoritative. May be wrong, outdated, or about a different model. |
| **[UNVERIFIED]** | My inference or a gap. Stated explicitly rather than smoothed over. |

Every claim carries a source URL. Where I could not find something, I say **"no published data"** rather than extrapolating.

---

## 0. Source ledger

| # | Source | URL | Used for |
|---|---|---|---|
| S1 | OpenAI — Image generation guide | https://developers.openai.com/api/docs/guides/image-generation | `moderation` parameter, `moderation_blocked` shape, error handling |
| S2 | OpenAI — Image prompting guide (GPT Image 2.5) | https://developers.openai.com/api/docs/guides/image-prompting | Prompt structure, exclusion phrasing, official example prompts |
| S3 | OpenAI — Images API reference | https://developers.openai.com/api/reference/resources/images | `moderation`, `safety_identifier`, `user` deprecation, response echo |
| S4 | OpenAI — Moderation guide | https://developers.openai.com/api/docs/guides/moderation | Category taxonomy, image-vs-text support |
| S5 | OpenAI — Error codes guide | https://developers.openai.com/api/docs/guides/error-codes | 400/429/500 taxonomy, retry policy |
| S6 | OpenAI — Safety best practices (`#implement-safety-identifiers`) | https://developers.openai.com/api/docs/guides/safety-best-practices | `safety_identifier` semantics for the Images API |
| S7 | OpenAI — Safety classifiers | https://developers.openai.com/api/docs/guides/safety-checks | Identifier blocking, org-level consequences |
| S8 | OpenAI — Batch API guide | https://developers.openai.com/api/docs/guides/batch | `/v1/images/generations` in Batch |
| S9 | OpenAI — Usage policies (effective 2025-10-29) | https://openai.com/policies/usage-policies | Likeness, minors, prohibited content |
| S10 | OpenAI — Policies index | https://openai.com/policies/ | Existence of a separate image/video guardrails policy |
| S11 | ChatGPT Images 2.5 System Card (2026-09-08) | https://deploymentsafety.openai.com/chatgpt-images-2-5/limitations | Safety-stack architecture; the only official block-rate numbers published |
| S12 | `openai-node` — `src/core/error.ts` | https://github.com/openai/openai-node/blob/master/src/core/error.ts | Error class mapping, which fields are lifted onto the exception |
| S13 | `openai-node` — `src/client.ts` | https://github.com/openai/openai-node/blob/master/src/client.ts | `shouldRetry()` — which HTTP statuses the SDK retries |
| S14 | OpenAI Developer Community — negative prompts thread (2023-08-25) | https://community.openai.com/t/moderation-api-does-not-understand-the-concept-of-negative-prompts/329187 | [ANECDOTE] only |
| S15 | OpenAI Developer Community — gpt-image-2 over-refusals thread (2026-08-04→2026-10-12) | https://community.openai.com/t/api-issue-moderation-over-refusals-on-gpt-image-2-with-moderation-low-where-chatgpt-always-succeeds/1388964 | [ANECDOTE] + one **[DOC-adjacent]** OpenAI staff reply |
| S16 | Google — Gemini image generation (Nano Banana) | https://ai.google.dev/gemini-api/docs/image-generation | Gemini negative-prompt guidance |
| S17 | Google — Gemini safety settings | https://ai.google.dev/gemini-api/docs/safety-settings | Gemini block semantics, configurability |

---

## 1. What actually triggers `moderation_blocked`, and on which stage?

### 1.1 The documented mechanism

**[DOC]** "All prompts and generated images are filtered in accordance with our content policy." — https://developers.openai.com/api/docs/guides/image-generation#content-moderation

**[DOC]** `moderation_details` is attached to the error when `error.code = "moderation_blocked"`:

```json
{
  "error": {
    "type": "image_generation_user_error",
    "code": "moderation_blocked",
    "moderation_details": {
      "moderation_stage": "input",
      "categories": ["harassment"]
    }
  }
}
```

— https://developers.openai.com/api/docs/guides/image-generation#content-moderation

**[DOC]** `moderation_stage` has exactly three documented values:

- `input` — "The block came from the prompt or request inputs."
- `output` — "The block came from a generated image or downstream output moderation stage."
- `unknown` — "A rare fallback when provenance is hard to determine."

— same source

**Answer to "input only, or output too?" — both.** Output-stage blocking is explicitly documented and explicitly enumerated. This matters for the `portrait-prompts` workload: a prompt can sail through input moderation and still fail on the rendered image.

**[DOC]** The system card describes the safety stack as *two separate layers*, which is the architectural reason `moderation_stage` exists:

> "**Upstream Refusals:** Before a request is sent to the image generation model, we run LLM-based policy checks to evaluate whether the request violates policy. Requests deemed to violate policy are refused at this stage.
> **Downstream Blocking:** After a request reaches the image generation system, we use a safety reasoning model as a monitor to moderate both image inputs to the image generation model and the generated output… **Input blocking:** …**Output blocking**: The monitor also checks the final output image before it is shown to the user."

— https://deploymentsafety.openai.com/chatgpt-images-2-5/limitations

The same system card states that "Safety-focused image and text classifiers have been part of our image safety stack since the original GPT-4o image generation launch", and that the monitor is "a safety-focused multimodal model trained to reason about prompt intent and content policies."

**Implication for a real risk you cannot see from the prompt:** because the output monitor is a *multimodal reasoning model* looking at the actual rendered portrait, the block surface is larger than your prompt vocabulary. A prompt that describes a clothed adult in a sunlit kitchen can render as something the monitor reads as sexualised, depending on how the model chose to light and frame the face and neck. **[DOC]** that the safety stack includes "multiple evaluation stacks for higher-risk categories around minors".

### 1.2 The `categories` values OpenAI actually returns

**[DOC]** The docs are deliberately vague here:

> "`categories` contains coarse public labels. **For example**, you might see values like `harassment`, `self-harm`, `sexual`, or `violence`."
> "The `moderation_details` object provides coarse debugging context without exposing internal classifier labels or scores."

— https://developers.openai.com/api/docs/guides/image-generation#content-moderation

**So: there is no published enumeration of the `categories` array for image generation.** Four values are named as examples (`harassment`, `self-harm`, `sexual`, `violence`); the array is explicitly a coarse, non-exhaustive public label set. **[UNVERIFIED]** Do not build a switch that assumes this is the complete list.

**[ANECDOTE]** Observed in the wild on the image-generation path:

| Value | Where seen |
|---|---|
| `sexual` | S15 — `moderation_details: {"moderation_stage": "output", "categories": ["sexual"]}` |
| `harassment` | S1 — the documented example |

**[ANECDOTE]** A separate, older error-message format carries an extra field not in the documented `moderation_details` shape — `safety_violations=[sexual]` — appended to the human-readable `message`. See S15. Treat it as message text, not as API surface.

### 1.3 The categories you would *expect* — and why they are not the same list

**[DOC]** The `omni-moderation-latest` **Moderation endpoint** has a different, richer taxonomy (S4). Do not conflate the two:

| Category | Inputs |
|---|---|
| `harassment`, `harassment/threatening` | **Text only** |
| `hate`, `hate/threatening` | **Text only** |
| `illicit`, `illicit/violent` | **Text only** |
| `self-harm`, `self-harm/intent`, `self-harm/instructions` | Text and images |
| `sexual` | Text and images |
| `sexual/minors` | **Text only** |
| `violence`, `violence/graphic` | Text and images |

— https://developers.openai.com/api/docs/guides/moderation#review-supported-categories

**[DOC]** The system card reports blocks by a *third* taxonomy entirely, because it measures policy areas rather than classifier labels: `Sexual`, `Hate`, `Violence / Gore`, `Extremism`, `Self-harm`, `Political`, `Abuse`, `Nonviolent & Violent Wrongdoing`, and `Other (e.g., religious figures)` — the last covering "religious figures, religious satire, fabricated or compromising depictions of real people, jailbreak attempts, and image-based requests" (S11).

**Three different taxonomies. None of them is documented as a superset of the others.** Treat any mapping between them as **[UNVERIFIED]**.

---

## 2. How common is blocking on benign portrait prompts?

### **No published data exists. This is the headline finding.**

I searched the OpenAI API docs, the policies site, the Deployment Safety Hub, and the developer blog. **There is no published figure — no percentage, no incident report, no telemetry summary — for the rate of `moderation_blocked` on benign, innocuous, photographic human prompts.** Any number you see quoted for "benign prompts getting blocked" comes from a third-party blog or a forum post, and none of those is a measurement.

### 2.1 The closest official data, and why it does not transfer

**[DOC]** The only official block-rate numbers OpenAI publishes for image models are in the ChatGPT Images 2.5 System Card (S11), Table 1:

| Total Prompts | Model | Safe Generated | Unsafe Generation Blocked | Unsafe Generation Presented |
|---|---|---|---|---|
| — | GPT-Image-2.5-Sunburst | 77.0% | 21.9% | 1.09% |
| — | GPT-Image-2.5-Flare | 79.4% | 19.2% | 1.41% |
| — | ChatGPT Images 2.0 (baseline) | 75.2% | 23.1% | 1.64% |

**These numbers do not apply to this workload, and OpenAI says so explicitly:**

> "We tested our end-to-end safety system using challenging prompts we specifically designed to generate images that would violate our policy broadly across all safety categories we track… **so the numbers below are not representative of how often such prompts arise in production traffic.**"

— https://deploymentsafety.openai.com/chatgpt-images-2-5/limitations

The denominator is *adversarial* prompts. The 21.9% "blocked" figure is the block rate **on prompts designed to be blocked**, not the false-positive rate on benign prompts. Reading it as the latter would be a serious error. The system card also carries its own limitations note: "Automated policy labels may contain errors… The findings apply to a fixed adversarial test set."

The only sub-number with any bearing on this workload is the `Unsafe Generation Presented` column — 1.09% / 1.41% — which is the rate at which *adversarial* generations slipped through. It says nothing about over-blocking, and nothing about portraits.

### 2.2 What the community reports actually claim

**[ANECDOTE]** — no measurement, no controlled prompt set, no denominator, different models:

- **[ANECDOTE]** "My false positive rate is roughly 100 out of 22,000" (~0.5%) — https://community.openai.com/t/image-fine-tuning-false-positive-content-policy-violation/965280. This is **vision fine-tuning dataset labelling**, not image generation. Not transferable. A second participant in the same thread reports ~80%, which is a good illustration of how unanchored these numbers are.
- **[ANECDOTE]** Multiple 2026 threads report blocking on prompts a reasonable person would call benign — swimwear ("ordinary adult swimwear repeatedly classified as sexual", https://community.openai.com/t/…, Sept 2026), "a woman getting ready for a party", "two women whispering secrets to each other" (S15). All of S15's examples are people-adjacent and body-conscious — not neutral portraits, but the closest thing to this workload that exists in the public record.
- **[ANECDOTE]** A widely-circulated third-party blog asserts "the current false positive rate for legitimate commercial use cases is a known limitation" (https://apipass.dev/blogs/how-to-avoid-content-policy-violations-gpt-image-2). **This is a reseller marketing page, not a measurement. Discard it.**

### 2.3 What this means for shipping a supported route

**There is no defensible published number to put in a design doc.** The honest position is:

> OpenAI does not publish a false-positive rate for benign photographic prompts, and the published system-card figures are measured on adversarial prompts and explicitly disclaimed as unrepresentative of production traffic. We have no data.

If you need an empirical number, **the only way to get one is to measure it yourself** on your own prompt distribution. That is a legitimate engineering task, not a research gap — and given §7 and §8, a cheap A/B is possible: generate N seeds twice, once with the `Avoid:` suffix and once without, and diff the block rates. Given the repo's deterministic seeding (`buildPrompt(template, seed, salt)`), that experiment is reproducible and does not require new prompt engineering. **Recommended before shipping.**

---

## 3. Do the `Avoid:` negative lists backfire?

**This is the highest-value question and the evidence is genuinely mixed. Read the three subsections carefully — they point different ways.**

### 3.1 First: a correction to the brief

The brief describes the negative list as:

> `Avoid: nudity, revealing clothing, weapons, blur, watermark`

**That is not what this repo sends.** The actual contents of `negative.txt` are:

```
multiple people, children, group shot, cartoon, illustration, painting, stylized art,
distorted anatomy, malformed eyes, malformed ears, malformed teeth, malformed hands,
text, logos, watermark, interface overlay, blur, low resolution, celebrity likeness
```

(One line in the repo; reformatted here for readability.) **There is no `nudity`, no `revealing clothing`, and no `weapons` in it.** The risk profile of this repo is materially lower than the brief assumed, and the highest-risk tokens present are different from the ones named in the brief:

- **`children`** — the single most policy-adjacent token in the file. See §4.
- **`celebrity likeness`** — sits directly on the likeness provision in the usage policies (§4).
- **`group shot`, `multiple people`** — low risk, but they do co-occur with `children` in one list.

`core/sampler.ts:128` appends it as: `` `${prompt}\n\nAvoid: ${negative}.` `` — a bare comma-separated noun list with no instruction verb, which is exactly the shape that provokes the complaints in §3.3.

**[UNVERIFIED]** I have not run the API. Everything below is inference from documentation and anecdote, and it has not been tested against this repo's actual prompts.

### 3.2 The hard documentation says exclusion phrasing is *recommended*, not penalised

**[DOC]** OpenAI's own image prompting guide instructs developers to include exclusions:

> "**Separate changes from constraints.** For edits, say 'change only X' and list the details to preserve… **State exclusions such as unwanted text, logos, or watermarks.**"
> — https://developers.openai.com/api/docs/guides/image-prompting#prompting-fundamentals

**[DOC]** And its own worked examples use exactly the construction this repo uses — **including the literal `Avoid:` token**:

> `Avoid tiny text, extra decoration, or anything that makes the diagram hard to understand.`
> — cellular-respiration diagram example, S2

> `Avoid clip art, stock photography, gradients, shadows, decorative elements, or anything that feels generic or overdesigned.`
> — pitch-deck slide example, S2

> `Avoid cinematic lighting, dramatic color grading, or stylized composition.`
> — campsite/bear scene example, S2

Other examples in the same guide use the same shape: `No glamorization, no heavy retouching.` / `No extra text, no watermarks, no unrelated logos.` / `no solid backdrop, scenery, checkerboard, or watermark.` / `Do not add new elements/text.`

**[UNVERIFIED — but a strong signal]** These are documented, published, reproducible prompts against `gpt-image-2.5-sunburst` and `-flare`, with example outputs attached. That is the closest thing to a controlled demonstration that a trailing `Avoid: …` clause does not trip the safety stack. **I have not verified the outputs were actually produced by the API rather than staged for the page**, and I have not counted how many images the guide shows versus how many prompts it lists.

**Conclusion from documentation alone: there is no documented basis for believing that naming prohibited concepts in an exclusion clause is treated as a risk signal. OpenAI's own documentation demonstrates the pattern.**

### 3.3 The anecdote says the opposite, and it is old

**[ANECDOTE]** The thread that this exact pattern generates complaints about is from **25 August 2023** — three years old, and about **DALL·E 2 and the standalone Moderations endpoint**, not the current GPT Image stack:

> *"I am trying to get the OpenAI Moderation API to rate positive AND negative prompts that are entered into an image generator. This proves to be difficult or maybe even impossible, as the Moderation API does not understand the concept of negative prompts. In extreme cases, negative prompts can be interpreted as the exact opposite, which results in Moderation API scores that are completely wrong."*
> — https://community.openai.com/t/moderation-api-does-not-understand-the-concept-of-negative-prompts/329187

The poster's example is `Positive prompt: Photorealistic image of two people kissing / Negative prompt: adults, clothes` — an argument that a moderation classifier scoring a *standalone text blob* cannot reconstruct that "negative" means "exclude", and so scores the string `"adults, clothes"` in isolation as if it were an instruction to remove adults and clothing.

**Three reasons not to over-weight this:**

1. **[DOC-adjacent]** The thread's own conclusion is that this is a *caller-side scoping bug*, not an OpenAI bug: the poster explains "I am not trying to use negative prompts on LLM. I want to evaluate a set of prompts that is always consisting of a positive as well as a negative prompt." They were concatenating two separately-scored blobs into one moderation call. Nobody from OpenAI confirmed a defect; the advice offered was "concentrate on the positive traits of the image you're wanting" — i.e. rewrite the prompt, not "negation is unsafe".
2. **Scope mismatch.** This concerns `POST /v1/moderations`, a *developer-facing* classifier you call yourself. The Images API's `moderation_blocked` comes from a different, undisclosed internal stack (S11). No evidence links the two.
3. **Staleness.** DALL·E 2, 2023. The current stack is "based on the same foundations as our ChatGPT Images 2.0 safety stack" with a **safety reasoning model** that is explicitly "trained to reason about prompt intent" (S11). A model that reasons about intent is exactly the component that would handle negation correctly.

### 3.4 Where the honest answer lands

| Claim | Status |
|---|---|
| OpenAI's official image prompting guide recommends stating exclusions and demonstrates `Avoid: …` clauses | **[DOC]** — strong |
| No OpenAI documentation says naming prohibited terms in a prompt triggers `moderation_blocked` | **[DOC]** absence — strong |
| OpenAI's upstream check is "LLM-based policy checks [that] evaluate whether the request violates policy" (S11) and the monitor is a model "trained to reason about prompt intent" | **[DOC]** — suggests negation-aware handling, but does **not** guarantee it |
| A 2023 forum user reports the standalone Moderations endpoint mishandling negation | **[ANECDOTE]** — real, old, different endpoint, self-diagnosed as caller-side |
| No one has demonstrated `Avoid: …` causing a `moderation_blocked` on the current Images API | **[UNVERIFIED]** — I found no such report. Absence of evidence, not evidence of absence |

**Recommendation:** keep the exclusion clause. The documentation endorses it and there is no primary-source evidence against it. But note two things:

1. **The output stage is the bigger risk, and the negative list does not protect you there.** The `Avoid:` clause constrains generation; it does not constrain the safety monitor. If the block is `moderation_stage: "output"`, rewriting the negative list is close to pointless.
2. **Two tokens in the actual list are worth re-examining on their own merits**, independent of negation: `children` and `celebrity likeness`. See §4.

### 3.5 A cross-vendor data point worth having

**[DOC]** Google states the opposite policy, explicitly and for images:

> "Use **'semantic negative prompts'**: Instead of saying 'no cars,' describe the intended scene positively: 'an empty, deserted street with no signs of traffic.'"
> — https://ai.google.dev/gemini-api/docs/image-generation#best-practices

This is a *generation-quality* recommendation from Google, not a safety one. But it is the only vendor-published guidance on this question, and it is the pattern OpenAI's docs do **not** recommend. **[UNVERIFIED]** Whether Gemini's safety filters also punish negation is not addressed anywhere in Google's docs; the guidance is presented as a quality tip. If you A/B the negative list (§2.3), test the "describe positively" variant too — it is the third arm of the experiment and it costs nothing to add.

---

## 4. Realistic portrait vocabulary vs. policy

### 4.1 What the usage policies actually restrict

**[DOC]** https://openai.com/policies/usage-policies (effective 2025-10-29). Nothing in this document is image-specific, but four clauses touch a portrait generator:

| Clause | Verbatim | Relevance |
|---|---|---|
| **Likeness** | "use of someone's likeness, including their photorealistic image or voice, without their consent in ways that could confuse authenticity" | The `celebrity likeness` token in `negative.txt` names this exact policy area. |
| **Minors** | "exposing minors to age-inappropriate content, such as graphic self-harm, sexual, or violent content"; "shaming or otherwise stigmatizing the body type or appearance of minors" | The `children` token in `negative.txt`. |
| **Weapons** | "weapons development, procurement, or use, including conventional weapons or CBRNE" | Not present in the repo's vocabulary or negative list. `ship welder`, `construction site fence`, `workshop with hanging tools` are the closest — all ordinary. |
| **Biometric / inference** | "facial recognition databases without data subject consent"; "real-time remote biometric identification in public spaces"; "evaluation or classification of individuals based on their social behavior, personal traits, or biometric data"; "inference regarding an individual's emotions in the workplace and educational settings, except when necessary for medical or safety reasons" | Generating portraits is not any of these. But note the **emotion-in-workplace** clause and the `profession` pool below. |
| **High-stakes automation** | "automation of high-stakes decisions in sensitive areas without human review" — listed under education, housing, employment, financial activities, legal, medical, insurance, essential government services, law enforcement | Generating fictional portraits is not a decision about a real person. |

### 4.2 Walking the actual pools in `core/sampler.ts`

**Age (`21`–`76`)** — adults only. **This is the single most valuable thing the repo does** and it should be said out loud in any design doc: the lowest possible age token is `21`, and the template binds it as `"a {gender} aged {age}"`. The system card flags that OpenAI "run[s] multiple evaluation stacks for higher-risk categories around minors" (S11), and that is exactly the stack a portrait generator must stay clear of. **Keep the adult-only floor. Do not lower it.** Note the risk is not the age token alone — it is an age token *co-occurring with* `children` in the same prompt, which §3.1 identified as the sharpest edge in the current negative list.

**Ethnicity (30 nationalities)** — Nigerian, Filipino, Brazilian, Korean, Norwegian, Iranian, Mexican, Indian, Ethiopian, Japanese, Egyptian, Polish, Vietnamese, Colombian, Turkish, Kenyan, Indonesian, Peruvian, Lebanese, Irish, Pakistani, Ghanaian, Thai, Italian, Chinese, Greek, Samoan, Mongolian, Moroccan, Swedish.

**[DOC]** `hate` is defined as content "based on race, gender, ethnicity, religion, nationality, sexual orientation, disability status, or caste" (S4). **Neutral demographic descriptors are not hate.** Every one of these is a nationality or ethnicity paired with a neutral occupation and neutral expression — the structure is as far from targeted content as a prompt can get. **[UNVERIFIED]** I found no report of nationality descriptors in benign portrait prompts triggering blocks. Treat as low risk.

**Skin (15 descriptors)** — `deep brown` … `pale`. Benign appearance descriptors. Low risk.

**Profession (30)** — the most interesting pool, because it is the only place where occupation meets policy. `an ER nurse`, `a dentist`, `a pharmacist`, `a physical therapist`, `a retired pilot`, `a museum guard`, `a ship welder`, `a farmer`, `a civil engineer`. None are restricted. Two adjacent observations:

- **[UNVERIFIED]** No military or police occupations are in the pool, and no uniforms are in the wardrobe pool. Good — those are exactly where `Other (e.g., …)`-adjacent long-tail categories would live, and where a fictional-adult portrait generator has no reason to go.
- **[UNVERIFIED]** `a ship welder` + `a workshop with hanging tools` is the pool's nearest approach to a weapons-adjacency read, but it is nowhere near the `illicit/violent` definition, "advice or instruction on how to commit illicit acts… references to violence or procuring a weapon" (S4). **Low risk, flagged only for completeness.**

**Wardrobe (24)** — `a green scrub top`, `a chef's white jacket`, `a high-visibility work jacket`, `a plain navy cap and a gray tee`, `a leather jacket over a t-shirt`. **All fully covering.** This is the highest-leverage defence in the whole prompt, and it is a structural property of the pool rather than a negative-list assertion. Two community threads (S15 and the swimwear thread) both attribute over-blocking to **output-stage** judgements about exposed skin — which a wardrobe pool with no revealing garments makes structurally unlikely. `a floral blouse`, `a black turtleneck`, `a patterned silk scarf and a dark jacket` are the closest to anything that could render as skin-forward, and all are conservative.

**Background (22)** — `a hospital corridor`, `a bright classroom`, `a quiet library aisle`, `a construction site fence`, `a workshop with hanging tools`. `a hospital corridor` and `a bright classroom` place an adult in a **medical** and an **educational** setting. Neither is restricted, and the medical clause in the usage policies is about *giving medical advice*, not *depicting a corridor*. **[UNVERIFIED]** no reports found of these blocking. Note though that `a hospital corridor` will co-occur with `an ER nurse` in ~1/660 of seeds — a nurse in a corridor, which is as benign as it sounds.

**Expression (16)** — `a calm half smile`, `a tired but kind smile`, `a confident smirk`, `a worried frown`, `a distracted glance to the side`. **[DOC]** The usage policies prohibit "inference regarding an individual's emotions in the workplace and educational settings" — but that is about *inferring a real person's emotions*, not *depicting a fictional one*. `a confident smirk` with `a retired pilot` is the nearest thing to the clause in the whole space. **[UNVERIFIED]** low risk, and worth noting because it is the only place where two pools could plausibly combine into something the monitor reads pointedly.

**Lighting, face, hair, eyes, feature, pose** — pure photographic vocabulary (`soft window light from the left`, `shot on an 85mm lens at f/1.8`). No policy contact whatsoever.

### 4.3 The separate image/video guardrails policy

**[DOC]** The policies index lists a distinct policy — "Creating images and videos in line with our policies: Respecting our image and video generation guardrails" — https://openai.com/policies/

**I could not retrieve its text.** The linked URL (`/policies/creating-sora-videos-in-line-with-our-policies/`) currently resolves to a Help Centre article about the Sora discontinuation, not to the guardrails policy. **[UNVERIFIED]** — its actual content is unknown to this research. **This is a real gap** and worth retrying before you rely on the usage policies alone as the complete picture for image generation. It is likely where image-specific rules (public figures, likeness, style imitation) live in detail.

### 4.4 Verdict for this vocabulary

**Low risk, with two specific caveats.** Nothing in the pools is restricted content. The two things I would change on policy-risk grounds alone:

1. **`children` in `negative.txt`.** It is the only minors-adjacent token in the entire prompt, and it sits in the same string as `group shot` and `multiple people`. The intent — "no group shots" — is fully expressible without it. **Recommended: drop it.**
2. **`celebrity likeness` in `negative.txt`.** The intent is "don't produce a recognisable person", which is a real and correct goal, but the token names the exact policy area. Positive framing — the Gemini pattern from §3.5 — would express it without naming likeness: e.g. `a completely original face that resembles no known person`. **[UNVERIFIED]** whether this matters; it is a low-cost hedge.

Neither is documented as a trigger. Both are cheap to remove. **Recommendation: treat this as risk reduction, not as a documented requirement.**

---

## 5. Comparison point: Google Gemini

**Yes — Google's documentation is more specific and more configurable on this exact point than OpenAI's, and on paper Gemini is the *less* strict of the two for a benign workload.**

### 5.1 Block semantics

**[DOC]** Google documents the input/output distinction explicitly and separately:

- `promptFeedback.blockReason` set → "the content of the prompt was blocked"
- `Candidate.finishReason = SAFETY` plus `safetyRatings` → "the response was blocked. The content that was blocked is not returned."

— https://ai.google.dev/gemini-api/docs/safety-settings#when-content-is-blocked

**[DOC]** Blocked requests fail with **HTTP 400**, and the error code is diagnostic:

> "If a safety filter blocks the input or the model's response, the interaction fails with an HTTP 400 error. The blocked content isn't returned."
> - `safety`: the input or response was blocked by a safety filter
> - `jailbreak`, `prohibited_content`, or `blocklist`: the input was blocked for that reason
> ```json
> {"error":{"code":"safety","message":"Request blocked due to safety violations (harmful content). Please modify your input and retry."}}
> ```

**[DOC]** Adjustable categories: `harassment`, `hate_speech`, `sexually_explicit`, `dangerous_content`, `jailbreak` (S17).

**[DOC]** Thresholds: `off`, `block_only_high`, `block_medium_and_above`, `block_low_and_above` (S17).

**[DOC]** Critically: "Due to the model's inherent safety, additional filters are **Off by default**. The default model behavior covers most use cases, so you should only adjust these settings if it's consistently required for your application." — S17.

### 5.2 Contrast

| | **OpenAI (GPT Image)** | **Google Gemini (Nano Banana)** |
|---|---|---|
| Filter strictness control | Binary: `moderation: "low" \| "auto"`. Documented as "Less restrictive filtering" vs "Standard filtering that seeks to limit creating certain categories of potentially age-inappropriate content" (S1). **No published criteria for when to use `low`.** | Five thresholds × five categories, with a stated default (`off`) and a stated rationale (S17) |
| Input/output distinction | `moderation_stage: input \| output \| unknown` (S1) | `promptFeedback.blockReason` vs `finishReason` + `safetyRatings` (S17) |
| Non-adjustable core harms | Not separately documented for images | "content that endangers child safety… **always blocked and cannot be adjusted**" (S17) |
| Review risk of loosening | Not stated | "Applications that use less restrictive safety settings **may be subject to review**" (S17) |
| Retry on block | 400, not retried (S5, S13) | 400, not retried (S17) |
| **Published false-positive rate on benign prompts** | **None** | **None** |

**Is one meaningfully stricter for this use case?** **[UNVERIFIED] — and I want to be blunt about the limits of what I found.**

- On the *documented* surface, OpenAI gives you one coarse knob; Google gives you a matrix. For a benign workload, Google's defaults (`off` for the adjustable filters) look more permissive in configuration terms.
- **[ANECDOTE]** cuts the other way, and strongly: the Gemini Apps community has persistent reports of benign prompts blocked — including a Gemini developer forum thread on false-positive "Content Filtered" errors (https://discuss.ai.google.dev/t/.../113754), and Gemini Apps community threads on Veo's "hard-coded guardrails—particularly regarding 'Violence' and 'Dangerous Content'—that are currently much more restrictive". **[ANECDOTE]** — and note the Veo comments are about *video*, not Nano Banana.
- **[ANECDOTE]** One Gemini Apps community report describes safety checks that "seem to confuse my AI-generated image of a woman to be a celebrity and thus refuses to process it" — which, if accurate, is a **likeness false positive on a synthetic portrait**, i.e. exactly this repo's failure mode, on the *other* vendor.
- The community thread at S15 documents the **opposite** asymmetry for OpenAI: identical prompts succeeding in ChatGPT while the API rejects them.

**Bottom line:** there is **no reliable public evidence that either vendor is meaningfully stricter for benign portrait prompts.** Both have credible anecdotal complaint volume. Both publish no false-positive rate. **Do not migrate on the strength of this research** — the correct response is to measure both on your own prompt distribution.

---

## 6. Error mechanics

### 6.1 The exact shape

**[DOC]** `error.code = "moderation_blocked"`, `error.type = "image_generation_user_error"`, status **HTTP 400** (S1). Confirmed by OpenAI staff in the wild: *"moderation_details: {"moderation_stage": "output", "categories": ["sexual"]} / Type: image_generation_user_error / Code: moderation_blocked"* alongside `HTTP 400 Bad Request` (S15).

### 6.2 Where the fields actually live in `openai-node`

**[DOC]** From the SDK source (S12), `APIError` lifts exactly three fields off the body:

```ts
const data = error as Record<string, any>;
this.code  = data?.['code'];
this.param = data?.['param'];
this.type  = data?.['type'];
```

**`moderation_details` is *not* lifted.** It stays on the raw body. So in JavaScript/TypeScript the correct read is `error.error.moderation_details` (note the doubled `error`), which is exactly what OpenAI's own documented example does (S1):

```js
const moderationDetails = error.error?.moderation_details;
const categories       = moderationDetails?.categories ?? [];
const stage            = moderationDetails?.moderation_stage;
```

**[DOC]** In Python the SDK surfaces `.code`, `.type`, `.param`, `.request_id` and the raw body; OpenAI's documented Python example reads `error.body.get("moderation_details")` (S1).

**[DOC]** Status → exception class mapping (S12): `400 → BadRequestError`, `429 → RateLimitError`, `>=500 → InternalServerError`, `403 → PermissionDeniedError`.

### 6.3 The `n` parameter hazard

**[ANECDOTE]** — but operationally important. From S15: `n: 6` was requested and **zero** images were returned; the whole request failed. **[UNVERIFIED]** that a partial-block scenario exists for `n > 1`. **Recommendation: use `n: 1` in the batch generator.** If a moderation block fails the entire request, `n: 10` means ten lost images for one block, and you get no partial credit.

### 6.4 Distinguishing "your wording tripped it" from "the output tripped it"

**[DOC]** Yes — via `moderation_stage`. `input` means the prompt or request inputs; `output` means the generated image or a downstream output stage; `unknown` is "a rare fallback when provenance is hard to determine" (S1).

**How much it tells you is the caveat.** OpenAI's own remediation hint for `stage === "output"` is *"The generated result was blocked by a safety check. Try changing the prompt and generating again."* — i.e. OpenAI acknowledges that an output-stage block still requires a prompt-side fix, which is exactly the frustrating loop S15 documents. And on the limits of the signal, OpenAI staff wrote:

> "Your `moderation_stage: "output"` errors identify a generated-image or downstream output check. **That identifies where the block occurred, but doesn't explain the difference with ChatGPT or establish whether the flag was incorrect.**"
> — `OpenAI_Support`, 12 Oct 2026, https://community.openai.com/t/api-issue-moderation-over-refusals-on-gpt-image-2-with-moderation-low-where-chatgpt-always-succeeds/1388964

**[DOC]** `moderation_details` is explicitly "coarse debugging context **without exposing internal classifier labels or scores**" (S1). **You cannot tell which word tripped it.** You cannot see a score. You get a stage and a coarse category label.

### 6.5 Appeal / regeneration path

**There is no programmatic appeal or re-generation path. This is confirmed.**

**[DOC]** "Some image generation failures are user-correctable and may return `error.type = "image_generation_user_error"`. **Don't automatically retry these errors without modifying the prompt or input images.** For programmatic handling, use `error.code` as the stable discriminator." — S1

**[DOC]** "Don't automatically retry quota errors or image generation user errors that require changing the request. Retry transient rate-limit and server failures with backoff." — S1

**[DOC]** The moderation-blocked handler in the docs does exactly three things: rethrow if the code isn't `moderation_blocked`, map `moderation_stage` + `categories` to a hint string, and log `{request_id, code, moderation_details}`. **No retry, no escalation, no appeal call.** — S1

**[ANECDOTE]** The appeal path is human. The standard error message says "If you believe this is an error, contact us at help.openai.com and include the request ID." A forum thread titled *"Moderation cannot be appealed, is this an OpenAI trick?"* documents a user being bounced between an AI support agent and a help centre with no form — https://community.openai.com/t/moderation-cannot-be-appealed-is-this-an-openai-trick-is-it-even-legal/1374813. **[DOC]** The Usage Policies do promise a general appeal: "You can appeal if you think we have made a mistake enforcing policy, and we will work to make things right." (S9) — but that is for **account-level enforcement**, not for individual request-level blocks.

**[UNVERIFIED]** Whether a *pattern* of spurious blocks on a benign workload can be escalated as a systemic issue is not documented. S15's thread shows an OpenAI staffer engaging, which suggests it is at least possible. **[DOC]** `request_id` (available as `error.requestID` in the Node SDK, S12) is the artifact to capture in logs — it is what makes a human escalation actionable.

---

## 7. Mitigation options

### 7.1 What OpenAI officially recommends

**[DOC]** The documented remediations are, in full (S1):

| Condition | Documented hint |
|---|---|
| `categories` includes `harassment` | "Try removing abusive or targeting language and focus on neutral visual details instead." |
| `stage === "input"` | "Try revising the prompt or input images and submit the request again." |
| `stage === "output"` | "The generated result was blocked by a safety check. Try changing the prompt and generating again." |

**[DOC]** And the framing: "For most apps, keep the primary end-user message generic. Use `moderation_details` for developer logs, support workflows, analytics, and light remediation hints." — S1

**[DOC]** OpenAI does **not** document any automatic remediation, prompt-rewriting service, or classifier-suggestion API for image generation. There is no documented "safe rewrite" endpoint.

### 7.2 Prompt-rewriting guidance — does "state things positively" apply to images?

**[DOC]** OpenAI's image prompting guide's core structural advice is the opposite of blanket positivity. It says: "State exclusions such as unwanted text, logos, or watermarks" (S2), and demonstrates `Avoid: …` clauses in three separate worked examples (S2). §3.2 covers this in full.

**[DOC]** The general [Prompt engineering guide](https://developers.openai.com/api/docs/guides/prompt-engineering) and the [GPT-6 prompting guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra) contain **no** general "state desired things positively / avoid negation" instruction. I read both in full. **The premise in the brief — that OpenAI's general advice is to state things positively — is not supported by OpenAI's current documentation.** It is Google's advice (§3.5), stated explicitly for images, and nowhere in OpenAI's.

**[UNVERIFIED]** There may be older OpenAI text-model prompting guidance with that advice that has since been revised. I did not find it in the current docs.

### 7.3 Is `moderation: "low"` a real mitigation?

**It is real, documented, and explicitly not a bypass.**

**[DOC]** The parameter exists on **both** `/v1/images/generations` and `/v1/images/edits` (S3):

> `moderation: optional "low" or "auto" or null` — "Control the content-moderation level for images generated by the GPT image models. Must be either `low` for less restrictive filtering or `auto` (default value)."

**[DOC]** The guide's description (S1):

> - `auto` (default): "Standard filtering that seeks to limit creating certain categories of potentially age-inappropriate content."
> - `low`: "Less restrictive filtering."

**[DOC]** What OpenAI says about *when* it is appropriate: **essentially nothing.** The docs define the two values and stop. There is no stated use-case guidance, no eligibility criterion, no review requirement, and no warning. Contrast Google, which states a default rationale and a review caveat (S17).

**[DOC]** The clearest official statement of its limits is from OpenAI support staff (S15, 12 Oct 2026):

> "The image-generation documentation describes `moderation: "low"` as less restrictive filtering; **prompts and generated images still undergo safety checks.**"

**[ANECDOTE]** — and this is the important caveat for your decision — in S15 the reporter *was already using* `"moderation": "low"` in the request body when they hit `moderation_blocked` with `categories: ["sexual"]`, and a second reporter in the same thread says "This is what I've been experiencing lately so many times… way too easily." One participant found no problem at all ("I have not experienced that issue. And I only use the API — never ChatGPT."). **[UNVERIFIED]** — but the practical reading is that `low` reduces but does not eliminate blocks, and in S15 it did not prevent an output-stage `sexual` block.

**Recommendation:** set `moderation: "low"` as the default for this route. It is documented as strictly less restrictive, costs nothing, and the workload is unambiguously in the benign category it is designed for. **Do not treat it as a safety margin** — §8 shows a block is unrecoverable, so the design must tolerate blocks at whatever rate `low` leaves.

### 7.4 Mitigations that are actually in your control

1. **`moderation: "low"`** — S3. Free, documented, set it.
2. **`n: 1`** — §6.3. Limits blast radius of a single block.
3. **Record `request_id` + `moderation_details` on every failure** — S1's documented logging pattern; `error.requestID` in the Node SDK (S12). Without it you cannot escalate, and without a log you cannot measure the rate that §2 says is unmeasured.
4. **Treat `moderation_blocked` as terminal for that seed and move on** — S1 + S5 + S13 (§8). Do not retry. Advance the seed.
5. **Prune `children` and `celebrity likeness` from `negative.txt`** — §4.4. Policy-risk reduction, cheap, no downside.
6. **Structure the wardrobe pool as the primary defence** — it already is. Fully-covering garments are what makes output-stage `sexual` blocks structurally unlikely. **Do not add revealing garments to widen the pool.**
7. **Batch API** — **[DOC]** `/v1/images/generations` and `/v1/images/edits` are supported Batch endpoints (S8), and "GPT Image 2.5 supports batch image generation and editing with `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst`". Benefits: 50% cost discount, a separate rate-limit pool ("using the Batch API will not consume tokens from your standard per-model rate limits"), 24-hour turnaround, up to 50,000 requests per batch. **Caveat:** failed requests go to a separate `error_file_id`, so blocks are isolated per-line rather than killing a run — which is a genuine structural win for a large dataset. **[UNVERIFIED]** whether moderation-blocked lines in a Batch still fail fast or consume the 24-hour window; not documented.
8. **Measure the actual block rate before promising a supported route** — §2.3. This is the only way to answer the question you actually asked.

---

## 8. Rate-limit vs. moderation separation

**Confirmed, definitively, from three independent primary sources.**

**[DOC] Source 1 — the guide.** "Retry transient rate-limit and server failures with backoff. **Don't automatically retry quota errors or image generation user errors that require changing the request.**" And: "**Don't automatically retry these errors without modifying the prompt or input images.**" (S1)

**[DOC] Source 2 — the error taxonomy.** The [Error codes guide](https://developers.openai.com/api/docs/guides/error-codes) enumerates 429s (`credit_balance_exhausted`, plain rate limit, `slow_down`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded`) and 5xx (`server_is_overloaded`) as the retryable set. `400` appears exactly once in the table, for an unrelated cause: *"400 - Invalid `service_tier` argument"*. **`moderation_blocked` is not in the retryable set.**

**[DOC] Source 3 — the SDK source.** `openai-node`'s `shouldRetry()` (S13) returns true only for:

```ts
if (response.status === 408) return true;   // request timeout
if (response.status === 409) return true;   // lock timeout
if (response.status === 429) return true;   // rate limit
if (response.status >= 500) return true;    // internal error
return false;                                // ← 400 lands here
```

**`400` is not retried by the official Node SDK.** The SDK will not burn a retry on a moderation block even with `maxRetries` set high.

**Can retrying a 400 ever succeed?** For an identical request: **no**, and the docs say so directly — "Don't automatically retry these errors **without modifying the prompt or input images**" (S1). A 400 moderation block is **permanent for that prompt**; the only thing that changes it is a changed prompt. **[ANECDOTE]** a reseller page phrases this as "you could retry ten thousand times and still get blocked" (https://help.apiyi.com/en/fix-gpt-image-2-moderation-blocked-400-error-en.html) — third-party, but consistent with the docs.

**One important exception to "permanent":** `moderation_stage: "output"` blocks are **not** logically permanent, even though the docs still tell you not to retry them. The block is on a *stochastic render*, not on the prompt. A different render of the same prompt could pass. **[DOC]** OpenAI's own hint for `output` is "Try changing the prompt and generating again" — a prompt change, but the implication is that the render is the variable. **[UNVERIFIED]** whether an identical retry of the same `output`-stage prompt has any chance. **[ANECDOTE]** the S15 reporter's *rewritten* prompt did eventually succeed, and the same prompt succeeded in ChatGPT — so the render/path is clearly not deterministic. **Practical rule for the generator: treat `input` as terminal for that seed; treat `output` as terminal for that attempt but eligible for a different seed.** The repo's seed-indexed structure makes this a one-line policy change.

**Do you get billed for a moderation block?** **[ANECDOTE]** conflicting. One community post asserts "if you ask for a picture of a naked woman, that prompt itself is rejected, and you won't get billed, the whole call fails. But if the prompt passes moderation, you are billed, no matter what" (https://community.openai.com/t/api-error-400-on-image-generation-with-gpt-image-1-2025-04-23-but-still-paying-the-cost-of-generation/1245636). Reseller blogs assert no charge. **[UNVERIFIED]** — I found no billing documentation on this. **Confirm against your own usage dashboard before relying on it.**

---

## 9. Safety identifier

### 9.1 What it is

**[DOC]** On `/v1/images/generations` and `/v1/images/edits` (S3):

> `safety_identifier: optional string or null` — "A stable identifier for an end user in your organization, used for safety monitoring and abuse detection. Hash a username or email address to avoid sending identifying information. A non-empty value takes precedence over the deprecated `user` parameter. If omitted, null, or empty, the API uses `user` when available."

**[DOC]** The response echoes it back: `safety_identifier` on `ImagesResponse` is "The effective safety identifier used for safety monitoring and abuse detection" (S3) — useful for confirming what the API actually attributed the request to.

**[DOC]** Guidance for the Images API specifically (S6):

> "For the Images API, include `safety_identifier` on each image generation and image edit request. Send it as a JSON property for JSON requests or a form field for multipart image edits. Use the same stable identifier for an end user across requests within your organization, and **keep it to 128 characters or fewer**."
> "Safety identifiers do not carry over between APIs or sessions."

### 9.2 Is there official guidance for a batch dataset generator?

**No. The guidance is framed entirely around end users, and the answer for this repo follows from that framing.**

**[DOC]** "Safety identifiers are **recommended for products where individual users interact with a model, but they are not required.**" (S6) — bold emphasis on "individual users".

**[DOC]** What it is for (S6):

> "Sending safety identifiers in your requests can help OpenAI monitor and detect abuse. This allows OpenAI to provide your team with **more actionable feedback in the event that we detect any policy violations in your application**."
> "They create a stable way to trace activity back to an individual end user and **reduce the chance that one user's misuse disrupts access for your broader organization**."

**[DOC]** The risk of supplying one (S7):

> "In a high confidence policy violation, the associated `safety_identifier` is completely blocked from OpenAI model access. The safety identifier receives an `identifier blocked` error on all future GPT-5 requests for the same identifier. **OpenAI cannot currently unblock an individual identifier.**"

**[DOC]** And org-level escalation (S7): "If your org hits high thresholds repeatedly, OpenAI returns an error and sends a warning email… If the requests continue past the stated time threshold (usually seven days), we stop your org's access."

### 9.3 Documented effect on rate limits or moderation outcomes for the request itself

**None. Explicitly none.**

- **Rate limits:** nothing in S3, S6, or S7 links `safety_identifier` to rate limits. **[DOC]** rate limits are documented as per-project/per-model and, for Batch, as "a separate rate-limit pool" (S8). No identifier effect is documented.
- **Moderation outcome for that request:** nothing documents that supplying an identifier changes whether *this* request passes or fails. The identifier is described purely as an *observability and enforcement-attribution* mechanism — something OpenAI uses afterwards to decide whom to warn or block, not a per-request input to the classifier.
- **Rate-limit interaction via enforcement:** **[UNVERIFIED but worth stating** — S7 describes "delayed streaming responses" as a possible low-consequence intervention, and identifier-level blocking as a high-consequence one. Neither is a *rate limit*, but both degrade throughput for the affected identifier.

### 9.4 Recommendation for `portrait-prompts`

**Omit it.** Reasoning, each leg sourced:

1. **The documented use case is end-user products; this is not one** (S6). There is no individual user to trace activity back to.
2. **Every documented benefit is one-directional and matters only when there *is* a user to protect** (S6): actionable feedback to *your team*, containment so one user's misuse doesn't harm *your broader org*. With a single operator and a deterministic synthetic workload, both are vacuous.
3. **Every documented cost is real and asymmetric** (S7): a wrongly-attributed block is **permanent and unappealable** for that identifier, and identifier blocks are a *lower* threshold than org-level action but still a hard stop.
4. **The "one identifier for the whole batch" version makes the risk worse, not better.** With 30 nationalities × 30 professions × ~1.5M combinations, you will occasionally get an unlucky render that trips the output monitor. Concentrating the entire dataset under one identifier means **one such block potentially halts the whole run permanently**, when the non-identifier default would have left you only with per-request 400s that you already handle. That inverts the purpose of the parameter, which is explicitly to *reduce* collateral damage.
5. **Never generate a per-seed identifier.** That would manufacture thousands of pseudo-users under your org, which is the exact pattern S7's org-level threshold logic is designed to catch. **[UNVERIFIED]** but the failure mode is obvious enough not to test.

If you later expose this as a service to end users, revisit this section — at that point S6's guidance applies in full and the identifier becomes genuinely useful.

**However:** the response echoes back the effective identifier (S3). **Log it.** It is the cheapest possible correlation handle between a request and anything OpenAI later tells you, and it costs nothing if you never send one.

---

## 10. Bottom line for shipping

| Question | Answer | Confidence |
|---|---|---|
| Does `moderation_blocked` happen on benign portrait prompts? | Yes, it is documented to be possible and community reports are credible — but **no published rate exists** | Anecdotal on occurrence; **no data** on rate |
| Is it input-stage or output-stage? | **Both**, documented; output-stage is the harder case | **[DOC]** |
| Can I measure the rate? | Yes — and you must, since nobody published one | **[DOC]** (Batch/sync both available) |
| Do the `Avoid:` lists backfire? | **No evidence for it.** OpenAI's own docs demonstrate `Avoid:` clauses. The one complaint thread is from 2023, about a different endpoint, and self-diagnosed as caller-side | **[DOC]** against; **[ANECDOTE]** for |
| Is the repo's vocabulary risky? | No. Adult-only floor, fully-covering wardrobe, no restricted professions | **[DOC]** + **[UNVERIFIED]** |
| Should I remove `children` / `celebrity likeness`? | Yes, as cheap risk reduction. Not documented as required | **[UNVERIFIED]** recommendation |
| Is `moderation: "low"` worth setting? | Yes. Strictly less restrictive, free, documented | **[DOC]** |
| Can a blocked prompt ever succeed on retry? | `input`: no. `output`: possibly on a different render, but docs say don't retry | **[DOC]** (don't retry) + **[UNVERIFIED]** (whether identical retry works) |
| Should I supply `safety_identifier`? | **No** — no documented benefit for a non-user-facing batch tool, and a permanent-block risk that scales with the whole dataset | **[DOC]** basis, **[UNVERIFIED]** inference |
| Is Gemini safer? | **Unknown.** No published rates either way; Google documents *more* configuration, community reports *more* complaints | **[UNVERIFIED]** |

### Before shipping this as a supported route

1. **Measure the block rate on your own distribution.** Two arms minimum: with and without the `Avoid:` suffix (§2.3). This is the deliverable that does not exist anywhere else. The repo's deterministic seeding makes it reproducible.
2. **Treat `moderation_blocked` as a first-class, non-retryable outcome** in the `Generator` seam (`core/generate.ts`), surfaced through the existing `SeedEvent` shape, keyed by `code` not message — consistent with the existing `ArchiveError` convention in `core/errors.ts`.
3. **Separate `input` from `output` in policy** (§8). They are different failure modes with different retry semantics.
4. **Set `moderation: "low"`, `n: 1`, and capture `request_id` + `moderation_details` on every failure.**
5. **Prune `children` and `celebrity likeness` from `negative.txt`** and bump the template version line, per the comment in `core/sampler.ts:20-21`.
6. **Retry the image/video guardrails policy** (§4.3). I could not retrieve its text and it is likely where the image-specific rules live.

---

## Appendix: claims I could not verify

Recorded plainly rather than smoothed over.

| # | Claim | Why unresolved |
|---|---|---|
| 1 | Block rate on benign photographic prompts | **No published data exists.** Not a search failure — OpenAI publishes no such metric |
| 2 | Complete list of `categories` values | Docs say "for example" and describe the set as "coarse public labels" |
| 3 | Whether `Avoid:` negation affects the GPT Image safety stack | No primary-source evidence either way. The one complaint is 2023, different endpoint |
| 4 | Text of the image/video generation guardrails policy | Linked URL on the policies index resolves to a Sora discontinuation help article |
| 5 | Effect of `safety_identifier` on per-request moderation | Not documented; inferred from its described purpose |
| 6 | Whether an identical retry of an `output`-stage blocked prompt can succeed | Not documented. Logically a render lottery; empirically untested here |
| 7 | Billing behaviour for moderation-blocked requests | Community and reseller sources conflict; no billing documentation found |
| 8 | Whether moderation-blocked lines consume a Batch window | Batch docs describe the error file but not blocked-line timing |
| 9 | Whether OpenAI's image prompting guide's example outputs were API-produced | Unverifiable from the page; images are shown without provenance |
| 10 | Any relative strictness comparison between OpenAI and Gemini for this workload | No data on either side; anecdote conflicts on both |

**I ran no API calls. Every behavioural statement in this document is documentation, source code, or clearly-labelled anecdote — never an experiment.**