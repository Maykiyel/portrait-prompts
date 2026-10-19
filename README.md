# portrait-prompts

A workbench for building a synthetic portrait dataset. It writes seeded prompts, you get the images from an image vendor, and it files them as 768x1152 PNGs with a record of the exact prompt behind each one.

You can work in the web app or on the command line. Both share the same `out/` folder.

Each portrait is a fictional adult with randomized age, background, face, hair, clothing, job, setting and lighting. The same seed always gives the same prompt, so you can redo, resume and trace any image.

## Requirements

- Node 22.12 or newer.
- npm, pnpm or yarn. Any of them works, and nothing in the repo depends on one. See [Package managers](#package-managers).
- An API key for at least one provider, only for the paid API route. Gemini's image models have no free tier. OpenAI's need a card with at least $5 on it, and may ask you to verify your organisation first.

## Package managers

Pick whichever you already use. There is no `packageManager` field in `package.json`, so corepack will not override your choice, and no script shells out to a specific package manager.

| | install | a script | `build` |
| --- | --- | --- | --- |
| npm | `npm install` | `npm run prompts -- --count 20` | `npm run build` |
| pnpm | `pnpm install` | `pnpm run prompts -- --count 20` | `pnpm run build` |
| yarn | `yarn install` | `yarn run prompts --count 20` | `yarn build` |

Two things differ. `pnpm-lock.yaml` is the committed lockfile, so `pnpm install` is the reproducible path; npm and yarn generate their own lockfile, and those are gitignored so your install never shows up as a change. Yarn also drops the `--` separator, npm and pnpm need it. `npm start` is `pnpm start` or `yarn start`, and `npm run <script>` is `pnpm run <script>` or `yarn run <script>` everywhere else.

`pnpm-workspace.yaml` holds pnpm settings for a single-package repo. npm and yarn ignore it.

## Install and run

Examples below use npm. Substitute your own, as above.

```bash
npm install
cp .env.example .env
npm run build
npm start
```

On Windows Command Prompt, use `copy .env.example .env`.

Open http://127.0.0.1:3001. Before your first batch, open `.env` and set `SEED_SALT` to any private text. See [Seed salt](#seed-salt).

For development, run `npm run dev`. The app opens on http://127.0.0.1:5173 with hot reload, and it talks to the API on port 3001. Restart after editing `.env`.

The server listens on 127.0.0.1 only and has no login. Do not expose it to a network. Your API key stays on the server and never reaches the browser.

## Using the app

### Free route with the Gemini app

1. Open **Prompts** and add a batch of prompts.
2. For each prompt, click Copy, open a new Gemini chat, paste, and send. A shared chat can carry faces over between images.
3. Download each image into one folder. Download them in order.
4. Open **Import** and drop the downloads in. Oldest download goes to the lowest waiting prompt. The page shows each prompt next to its image, so you can check every match and change a seed from its dropdown.
5. Click Import. Images are cropped to 2:3 and resized to 768x1152.
6. Open **Gallery** to review. Open a frame to read its prompt, download it, or reject it if the hands, teeth or eyes look wrong. Rejecting deletes the image and puts that prompt back in the waiting list.

### API route, paid

1. Set `GEMINI_API_KEY` or `OPENAI_API_KEY` in `.env` and restart the server.
2. Open **Generate**, pick a provider, a model, a size and a count, and start. Progress updates live.
3. Failed seeds stay waiting and run first next time. A seed whose *prompt* a vendor refused outright is blocked instead: it will not be offered again, because retrying it would only be refused again.

### Pages

- **Overview** shows progress, the next step and your latest images.
- **Prompts** lists waiting prompts with copy buttons and a toggle for the "Avoid" line.
- **Import** matches downloaded images to prompts.
- **Generate** runs the chosen provider's API with a progress bar.
- **Gallery** is a contact sheet of every image, with detail, download and reject.

## Seed salt

The same template, pools and seed always give the same prompt, for everyone. Without a salt, every user of this repo starts with the same prompt at seed 1. Gemini tends to return the same-looking person for the same prompt, so two people's datasets would share near-duplicate portraits.

`SEED_SALT` fixes that. It is private text in `.env` that gets mixed into every seed. Any text works, such as `david-2026`.

- Set it before your first run and never change it. A different salt makes every seed produce a different prompt.
- If the salt changes, the app and the commands stop with an error instead of mixing two sequences. Restore the old salt, or move `out/` aside to start fresh.
- Back it up somewhere safe. The manifest records it for each image, but deleting `out/` loses that record.
- Leaving it empty works, and you get the default sequence that every unsalted user shares.

## Seed counter

Every prompt comes from a seed. A counter in `out/cursor.json` hands seeds out in order, so you never pick a start number.

- Adding prompts takes the next unused seeds.
- Seeds that were handed out but still have no final image come first. A failed API call, an unimported download or a rejected image is finished before any new seed is used.
- Deleting `out/` resets the counter to 1 and removes your images.
- Seeds fix the prompt, not the image. In testing, the same prompt in fresh chats gave the same-looking person, with small changes in crop, zoom and background. The variety in your dataset comes almost entirely from the prompts.

## Output

- `out/00001.png` is the final 768x1152 image. Images are cropped to fit, centered on the most detailed area.
- `out/raw/00001.png` is the untouched original.
- `out/cursor.json` holds the seed counter and the salt it was started with.
- `out/thumbs/` holds gallery thumbnails. It is safe to delete.
- `out/quarantine/` holds the bytes of Frames refused as they arrived, kept exactly as they arrived. See the quality record below for the only condition that puts a Frame there.

### The Manifest

`out/manifest.jsonl` has one line per Attempt. It is append-only: a row is appended and never rewritten, so each row keeps saying what was true when it was written. Every row written today carries `schema: 2`, which is how a current row is told apart from one an older build wrote.

A row records the attempt itself: `seed`, `version` (the tag on the first line of `template.txt`), `salt`, `ts`, `status`, `error` when it failed, `source` (`api` or `manual`), `provider` and `model`, and `file` for a manual row. On a manual row `provider` and `model` are `null`, because no Provider was asked for anything.

A row records the sampled Portrait too: `prompt`, `attributes` (the values that filled the template), `details`, `primaryGroup`, `groups`, `ethnicities`, `photographyProfile`, `bands`, and `attributesSource`. `attributesSource` is `run` when a generation run sampled it, and `import` when a manual import sampled it at import time to describe an image that was made elsewhere. The Prompt and the attributes come from one sampling, so a row cannot describe two Portraits.

Two hashes cover the bytes:

- `raw` is `{ sha256, bytes, width, height }` of the bytes as they arrived, from the Provider or from the import file, hashed before anything else touched them.
- `normalized` is the same shape plus `steps`, and is the sha256 of the exact bytes written to `out/00001.png`. The artifact is built once, hashed, and then written from that same buffer, so the hash always matches the file on disk. `steps` records the `fit`, `position` and `format` used, which are `cover`, `attention` and `png`. A Frame refused at ingestion has a `raw` and no `normalized`, because no artifact was written for anyone to check one against.

`primaryGroup` is the group the first ethnicity draw chose. It is stored separately from `groups`, and `groups` keeps the order the ethnicities are named in, so a mixed Portrait that names its second ethnicity first still records the group the draw started from.

The remaining fields: `params` is `{ aspectRatio, imageSize, useNegative }` on an api row and `null` on a manual one. `templateHash` and `samplerHash` are the first 12 hex characters of the sha256 of the template text and of the sampler's definition tables, so a reader can tell which text and which tables built a Frame. `qc` is the quality record below. `duplicates` is absent, because duplicate detection does not run yet. `quarantine` holds the path and the reason for a Frame refused at ingestion.

An absent key means unknown. `null` means recorded as not applicable. The string `"unknown"` is never written.

Rows written before `schema: 2` are read without invention: a field the row did not record stays absent rather than being filled in from today's tables, because a row that kept no attributes never described the Portrait today's sampler would give that Seed.

### The quality record

Every Frame is checked with `core/qc.ts` before it is accepted. The record is `{ version, status, checks, flags, stats, perceptual }`. `checks` names every check whether or not it ran. `stats` is `{ mean, stdDev }` of the greyscale pixels those checks read. `perceptual` is `{ algo, hex, basis }`, where `basis` says whether the fingerprint came from the normalized artifact or from the raw bytes.

The check names are `decode`, `dimensions`, `blank`, `luminance`, `aspect`, `duplicate_exact`, `duplicate_perceptual` and `face_presence`. Each is `pass`, `warn`, `fail` or `not_run`, and `not_run` means the check did not happen. It never means the check passed. `status` is `fail` if any check failed, otherwise `warn` if any warned, otherwise `pass`, and `not_run` only when every check is `not_run`. A check in the `not_run` state never pulls the status down.

The flags are `decode_failed`, `zero_dimensions`, `near_blank`, `extreme_luminance_low`, `extreme_luminance_high`, `aspect_ratio_mismatch`, `duplicate_exact`, `duplicate_perceptual` and `duplicate_check_incomplete`. A flag is written only when its check reached the matching state.

Two checks do not run, and neither has a flag:

- `face_presence` is `not_run` on every Frame. No face detector runs in this repo, so nothing about a face is measured or claimed.
- `duplicate_exact` and `duplicate_perceptual` are `not_run` on every Frame. Duplicate detection is not built yet, so no Frame is compared against any other at write time and the three duplicate flags are never written. The `perceptual.hex` fingerprint is still recorded, and the audit CLI recomputes the same fingerprint when it reports near-duplicates of its own.

A Frame whose bytes will not decode, or that reports zero dimensions, is not written into the archive. Its bytes go to `out/quarantine/` and exactly one row records the Attempt, with the `quarantine` path and the reason. Every other outcome is accepted and flagged. Review status is separate from generation status: a Rejected Seed returns to waiting, and an accepted Frame stays in `out/`.

## Customize the prompts

- `template.txt` is the prompt. The first line is a version tag like `# portrait-v6`. It is stripped before use and saved in the manifest. For v6 the tag is `portrait-v6`.
- `negative.txt` is the list of things to avoid.
- `core/sampler.ts` holds the attribute pools. Each placeholder in the template, like `{hair}`, matches a pool.

Two rules keep your dataset consistent.

- Add new pool entries at the end of a pool. Inserting or reordering entries moves existing entries. Even an append changes the prompt some old seeds produce, because the draw depends on the pool's length.
- Bump the version tag in `template.txt` whenever you change the template or pools. The manifest then shows which prompt version made each image.

Each pool holds 10 to 30 entries, except gender with 3 entries, ethnicity with 47 entries spread across 11 groups, and the new photography pool with 6 profiles. Pools that change the face matter most, because they decide who the person is. These are age, gender, ethnicity, skin, eye color, eye shape, face shape, nose, lips, eyebrows, hair, facial hair and the optional details. Wardrobe, background, lighting, pose and expression only change the surroundings and mood. Facial hair applies to men only, and its pool has several empty entries so about half of them are clean-shaven.

The optional details live in `detailPools` and fill the `{features}` placeholder. They are skin details, distinctive marks, facial details, accessories and age details. Each portrait gets zero to three of them, at most one per category, so a portrait can have freckles and glasses but never two accessories. With none selected the prompt says `no prominent additional marks or accessories`. A few rules keep the result coherent. Age details need an age of 30 or more, acne marks need 45 or less, freckles are skipped for freckled skin, and the asymmetry detail is skipped for asymmetrical lips. The details are drawn after all the pools, from the same seeded random source, so a seed and salt still give one prompt.

About a quarter of portraits get two ethnicities, as in `of Filipino and Brazilian background`. The share is `MIX_RATE` in `core/sampler.ts`. Six random draws are made for ethnicity whether or not a portrait is mixed, and the second ethnicity is drawn before any later pool, so mixing changes the ethnicity text and the draws that depend on the groups, and no other trait. Mixed portraits blend skin and eye tone bands across both ethnicity groups, and blend hair the same way. The group the first draw chose is recorded as `primaryGroup`, separately from `groups`, which keeps the order the ethnicities are named in, so naming the second ethnicity first does not change what `primaryGroup` says.

### Gender weights

Gender is drawn with weights from `GENDER_WEIGHTS` in `core/sampler.ts`: man 48, woman 48, person with an androgynous look 4. These are judgment-based synthetic sampling controls, not measured population statistics. They only affect how often each gender appears; the gender pool still has three entries.

### Ethnicity groups

An ethnicity is chosen in two steps. First a group is chosen with equal weight from 11 groups: europe, east_asia, southeast_asia, south_asia, central_asia, west_asia_north_africa, sub_saharan_africa, latin_america, caribbean, pacific, indigenous_americas. Then a specific ethnicity is chosen inside that group. Every group has the same weight, so smaller groups are not drowned out by larger ones. `ethnicityGroups` and `GROUP_WEIGHTS` hold this in `core/sampler.ts`.

### Mixed blending

Mixed portraits use both ethnicity groups for skin and eye color. `blendWeights` averages the group band weights across both groups, so a mixed portrait can land between the typical tone ranges of its two groups. Hair is also blended: light natural hair entries (auburn, blond, red, platinum) use group factors from `LIGHT_NATURAL_HAIR_FACTORS`, averaged across both groups.

### Tone bands

Skin entries map to five skin tone bands: deep, medium_dark, medium, light, very_light. Eye colors map to four eye bands: dark, brown, hazel_amber, light. Each group has band weights in `SKIN_BAND_WEIGHTS` and `EYE_BAND_WEIGHTS`. When a band is chosen its entries are weighted evenly inside it, so band totals follow the group weights rather than pool counts.

### Hard rules

Some trait combinations are guarded so prompts stay coherent.

- Age rules in `AGE_RULES` steer entries to suitable ages. Weathered faces need 40 or more, gray and salt-and-pepper hair need 42 to 62, retired pilots need 60, and bike messengers are capped at 50. Several professions need 24 or 27.
- Thin pale eyebrows are limited to light and very light skin.
- Facial hair applies to men only. Empty entries make about half of men clean-shaven.
- Gray hair prevents a full dark beard.
- Detail rules: age details need an age of 30 or more, acne marks need 45 or less, freckles are skipped on freckled skin, and asymmetry is skipped on asymmetrical lips.
- Photography profile filters background and lighting by setting, and by allowed or excluded lighting entries. Each profile only picks backgrounds and lighting from its allowed settings.

### Soft weights for skin details and hair

Some weights change how often a trait appears without forbidding it.

- Freckles and sun spots are weighted down on deep and medium-dark skin bands through `SKIN_DETAIL_WEIGHTS`.
- Light natural hair is weighted by group through `LIGHT_NATURAL_HAIR_FACTORS`. Mixed portraits average the factors of both groups.

### Photography profiles and tuning

Six photography profiles make up the photography pool: professional headshot, casual smartphone, webcam portrait, environmental portrait, candid available light, and low light portrait. Each has equal base weight and an allowed-settings list for indoor, outdoor and studio settings. Low light portrait additionally allows or excludes specific lighting entries. The profile is drawn before background and lighting, so it can tune both. Profile descriptions go into the prompt through the `{photography}` placeholder.

## Command line

The command line does the same work without the app.

| Command | What it does |
| --- | --- |
| `npm run prompts -- --count 20` | Writes `prompts.html` with copy buttons. |
| `npm run import-images -- --in "D:/Downloads/gemini"` | Resizes and files a folder of downloads. |
| `npm run generate -- --count 10` | Generates images through the default provider. |
| `npm run status` | Shows the next seed, images done and seeds waiting. |
| `npm run dataset-audit -- --dir out` | Audits an output folder and prints demographic, duplicate, QC, sparse-cell, and legacy-row counts. |

Flags worth knowing.

- `prompts` takes `--count` (default 20), `--start`, `--out`, `--dir` and `--no-negative`.
- `import-images` takes `--in` (required), `--start`, `--out` and `--dry-run`. Files are matched to the oldest waiting seeds by download time. Run it with `--dry-run` first.
- `generate` takes `--count` (default 10), `--provider gemini|openai`, `--model`, `--size`, `--aspect`, `--concurrency`, `--start`, `--out`, `--no-negative` and `--dry-run`. `--provider` and `--model` may come in either order.
- `dataset-audit` takes `--dir` (default `out`), `--min-cell` (default 5) and `--json`. Use `pnpm run dataset-audit -- --dir out` for a plain-text report. A dry run is not needed, because the audit reads files only and moves nothing.
- `--model` takes a key or the vendor's own model string, so both `--model flash` and `--model gemini-3.1-flash-image` work.
- `--start N` names the Seeds by hand instead of following the counter. `generate` and `import-images` still record them, so the counter moves past them and the same Seed is never handed out twice. `prompts` only writes the HTML page, so it leaves the counter alone. A dry run never moves it.

### Providers

Each provider owns its models, its key and its limits, so nothing above it needs to know which vendor it is talking to. Adding one is a new file, an entry in the registry in `core/providers.ts`, and, if it is to answer the no-flag defaults, a key in the default-model map in `core/policy.ts`. The vendor guard in `test/smoke-audit.ts` must then learn its name, because a guard that stops naming the moment it matters is no guard at all.

| | key | models | sizes | notes |
| --- | --- | --- | --- | --- |
| **Gemini** | `GEMINI_API_KEY` | `flash` (default), `lite`, `pro` | 1K, 2K, 4K | `lite` is 1K only. No free tier. |
| **OpenAI** | `OPENAI_API_KEY` | `flare` (default), `sunburst` | 1K, 2K | No 4K and 2:3 only, so any other aspect ratio is refused before a request is made. See below. |

Gemini model ids are `gemini-3.1-flash-lite-image`, `gemini-3.1-flash-image` and `gemini-3-pro-image`. OpenAI's are `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst`; `gpt-image-1` is deprecated and its shutdown is 23 October 2026.

**OpenAI cannot make a 4K portrait**, and the app refuses the request rather than quietly returning something smaller. Its largest 2:3 image is 1536x2304, which is *below* Gemini's 2K, so a switch from Gemini to OpenAI costs detail in `out/raw/` even at the same size setting. Gemini's own sizes at 2:3 are 848x1264, 1696x2528 and 3392x5056.

Rate limit and server errors retry up to 5 times with backoff on both. Quota, billing and credit errors fail at once, because retrying never helps — on OpenAI these arrive as a 429 just like a real rate limit, so they are told apart by the error code rather than the status or the message. Vendor SDKs retry underneath this loop, and are switched off so the two policies do not multiply into 25 requests.

Concurrency is clamped to what a provider publishes: OpenAI takes 20 images a minute on its Build tier, Gemini publishes no current limit. Neither clamp bites at the default concurrency.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API with auto restart plus Vite with hot reload. |
| `npm run build` | Builds the web app into `web/dist`. |
| `npm start` | Runs the API and serves the built app. |
| `npm run lint` | Lints with oxlint. |
| `npm run typecheck` | Type checks the server and the web app. |
| `npm run smoke` | Offline test of prompts, salt, counter, resizing and import. |
| `npm run dataset-audit` | Audits `out/` for counts, duplicates, QC flags, and sparse cells. |

## Stack

- Web app in `web/`. React 19, TypeScript, Vite, React Compiler, Tailwind CSS 4 and shadcn/ui components.
- React Router for routes, which load lazily, TanStack Query for server data, Zustand for local state, axios for requests.
- API in `server/`. Hono on Node. It wraps the same modules the command line uses.
- Lint with oxlint. `components.json` is set up so `npx shadcn add <component>` works.

## Project layout

A page's own actions stay in that page's folder, and anything more than one page needs is shared. No feature imports a sibling feature, and there are no barrel files: imports name the file directly, so the bundler drops what is unused.

- `web/src/app/` is the wiring and nothing else: the router, the shell, theme sync, and the boundary that keeps a fault in one page from blanking the app.
- `web/src/features/<route>/` is one page plus whatever only that page uses. To add a page, make the folder, write the page there, and add the route to `web/src/app/router.tsx`. Routes load lazily, one dynamic import each.
- `web/src/shared/` is what more than one page needs: the shadcn components in `shared/components/ui/`, the shared components in `shared/components/`, and the request helpers, query hooks and the settings store in `shared/lib/`. The store lives here because it is shared state consumed from three layers, and the layer below `app/` is the only one all three can stand on.
- `web/src/lib/text.ts` is the browser's own Seed label. It cannot come from `core/output-folder.ts` without dragging the image library into the bundle, so the rule sits there and `test/smoke-audit.ts` holds it to one implementation.
- `server/` is three modules: routes in `index.ts`, a thin client of the output folder in `store.ts`, API generation in `jobs.ts`. It reaches the core and the wire types and nothing else, and in particular nothing under `cli/`. `shared/api-types.ts` holds the wire types both sides use, and nothing else, because the browser imports from it and anything heavier would come along.
- `cli/` is the four command-line entry points, `generate.ts`, `import-images.ts`, `export-prompts.ts` and `status.ts`. They are adapters and nothing more: each reaches the output folder through the core and stands on nothing else of ours.
- `test/` is the offline suite, which needs no API key and no network: `smoke-test.ts` runs the pipeline with a fake Generator, `smoke-cli.ts` holds each command's own bytes, `smoke-audit.ts` holds the architectural claims — that nothing reaches `out/` except through `core/output-folder.ts`, that the command line and the server are adapters over the core and neither stands on the other, and that the browser's own layers only reach down — and the proof beside each one that it cannot pass vacuously. Four of those proofs plant a file and run oxlint over it, so each of the four lint rules guarding this layering is shown still able to fail, and `smoke-harness.ts` is the pass/fail helper they share.

The Seed, Frame and Prompt rules live in the core, not in the folders. `core/output-folder.ts` is the only code that reads or writes `out/`, and it owns the folder layout, the Seed counter, the manifest, Prompt wording, and the Frame and Seed rules, all behind the one interface `openOutputFolder` returns. Its siblings are `core/sampler.ts`, which holds the attribute pools and takes the salt as an argument, `core/generate.ts`, which claims Seeds, generates Frames, records Attempts and reports progress as data without printing any of it, `core/providers.ts` and its `gemini.ts` and `openai.ts`, which between them describe every vendor and are reached only from the two composition roots, so the run is handed a Provider rather than reaching for one, `core/policy.ts`, which holds the default generation policy the command line and the browser both start from so they cannot drift apart, and `core/errors.ts`, the failure that carries a code rather than an HTTP status.

The root holds configuration and the two Prompt files, not code: `template.txt` and `negative.txt` are read from the working directory, so every command finds them wherever you run it, and `GLOSSARY.md` gives the vocabulary.

## Downstream dataset use

A dataset is built from accepted Frames only, meaning files present in `out/`. Rejected Seeds leave no file and quarantine files were never accepted.

- Filter by prompt version before comparing or training. Mixed versions in one dataset confuse both counting and training.
- Use `pnpm run dataset-audit -- --dir out` to check gender, primary ethnicity group, mixed status, skin band, eye band, age band, photography profile, optional detail counts, duplicates, QC flags, sparse cells, and legacy rows.
- Treat QC flags as data quality signals. `aspect_ratio_mismatch` often means a free-app image was not 2:3 and was cropped. `near_blank` and the two `extreme_luminance` flags mark a frame with almost no detail or an implausible brightness. The duplicate flags are never written yet, because no duplicate check runs at write time; use `npm run dataset-audit` if you want near-duplicates reported.
- Do not include files under `out/quarantine/` in a dataset. They are the bytes of frames that would not decode or reported zero dimensions.
- Keep one salt per dataset. Switching salts mid-collection breaks traceability and changes every prompt.
- Ethnicity group weights are synthetic controls for balance, not population statistics. Check audit counts before claiming coverage.
- Prompt text in the Manifest lets you re-read or re-run any Portrait later, but re-running requires the same template, pools, salt, and version.

## Troubleshooting

- **The page loads but nothing shows.** Run `npm run build` before `npm start`, or use `npm run dev`.
- **A red banner says the output folder does not match.** The salt in `.env` differs from the one `out/` was started with. Restore the old value, or move `out/` aside.
- **429 "limit: 0 ... Free Tier".** Gemini's image models have no free API tier. Enable billing on the key's project, or use the free route.
- **A 429 from OpenAI.** Check the error code. `credit_balance_exhausted` or a spend limit means the card needs topping up and retrying will not help; `slow_down` is a real rate limit and is retried.
- **Generate says no API key.** That provider's key is not set. Add it to `.env` and restart the server; the other provider's key does not stand in for it.
- **The wrong image sits next to a prompt on Import.** Downloads were out of order. Change the seed in that row's dropdown. Dropping a seed another row uses swaps the two.
- **Images come out square.** The free Gemini app picks the size. Import crops them to 2:3 and flags them.
- **Port 3001 is busy.** Set `PORT` in `.env` and update the proxy target in `vite.config.ts` if you use `npm run dev`.

## Notes

- Neither provider has a negative prompt field, so the negative list goes into the prompt as "Avoid: ...". OpenAI's own prompting guide recommends exactly this.
- Every Gemini image carries an invisible SynthID watermark, and every OpenAI image carries both SynthID and C2PA content credentials. `out/raw/` holds the vendor's bytes untouched so those signatures survive; only the Frame is resized.
- **OpenAI's block rate on these prompts is unmeasured.** Nobody publishes an over-block rate for benign photographic prompts, so the route ships without a parity claim and your first run is the measurement: the run summary reports how many seeds were blocked.
- Free app images may also carry a visible Gemini logo. Check your first image and decide if that fits your dataset.
- Free app limits change often. Recent guides report about 20 images per day.
- Check Google's current pricing page before a large API run.
