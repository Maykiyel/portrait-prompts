# portrait-prompts

A workbench for building a synthetic portrait dataset. It writes seeded prompts, you get the images from an image vendor, and it files them as 768x1152 PNGs with a record of the exact prompt behind each one.

You can work in the web app or on the command line. Both share the same `out/` folder.

Each portrait is a fictional adult with randomized age, background, face, hair, clothing, job, setting and lighting. The same seed always gives the same prompt, so you can redo, resume and trace any image.

## Requirements

- Node 20.19 or newer, or Node 22.12 or newer.
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
- `out/manifest.jsonl` has one line per attempt with seed, prompt version, salt, model or source, prompt text and status.
- `out/cursor.json` holds the seed counter and the salt it was started with.
- `out/thumbs/` holds gallery thumbnails. It is safe to delete.

## Customize the prompts

- `template.txt` is the prompt. The first line is a version tag like `# portrait-v3`. It is stripped before use and saved in the manifest.
- `negative.txt` is the list of things to avoid.
- `core/sampler.ts` holds the attribute pools. Each placeholder in the template, like `{hair}`, matches a pool.

Two rules keep your dataset consistent.

- Add new pool entries at the end of a pool. Inserting or reordering entries changes which prompt some old seeds produce.
- Bump the version tag in `template.txt` whenever you change the template or pools. The manifest then shows which prompt version made each image.

Each pool holds 10 to 30 entries, except gender, which has 3. Pools that change the face matter most, because they decide who the person is. These are age, gender, ethnicity, skin, eyes, face shape, hair, facial hair and the visible detail. Wardrobe, background, lighting, pose and expression only change the surroundings and mood. Facial hair applies to men only, and its pool has several empty entries so about half of them are clean-shaven.

## Command line

The command line does the same work without the app.

| Command | What it does |
| --- | --- |
| `npm run prompts -- --count 20` | Writes `prompts.html` with copy buttons. |
| `npm run import-images -- --in "D:/Downloads/gemini"` | Resizes and files a folder of downloads. |
| `npm run generate -- --count 10` | Generates images through the default provider. |
| `npm run status` | Shows the next seed, images done and seeds waiting. |

Flags worth knowing.

- `prompts` takes `--count` (default 20), `--start`, `--out`, `--dir` and `--no-negative`.
- `import-images` takes `--in` (required), `--start`, `--out` and `--dry-run`. Files are matched to the oldest waiting seeds by download time. Run it with `--dry-run` first.
- `generate` takes `--count` (default 10), `--provider gemini|openai`, `--model`, `--size`, `--aspect`, `--concurrency`, `--start`, `--out`, `--no-negative` and `--dry-run`. `--provider` and `--model` may come in either order.
- `--model` takes a key or the vendor's own model string, so both `--model flash` and `--model gemini-3.1-flash-image` work.
- `--start N` names the Seeds by hand instead of following the counter. `generate` and `import-images` still record them, so the counter moves past them and the same Seed is never handed out twice. `prompts` only writes the HTML page, so it leaves the counter alone. A dry run never moves it.

### Providers

Each provider owns its models, its key and its limits, so nothing above it needs to know which vendor it is talking to. Adding one is a file and an entry in `core/providers.ts`.

| | key | models | sizes | notes |
| --- | --- | --- | --- | --- |
| **Gemini** | `GEMINI_API_KEY` | `flash` (default), `lite`, `pro` | 1K, 2K, 4K | `lite` is 1K only. No free tier. |
| **OpenAI** | `OPENAI_API_KEY` | `flare` (default), `sunburst` | 1K, 2K | No 4K at 2:3 — see below. |

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
