# portrait-prompts

A workbench for building a synthetic portrait dataset. It writes seeded prompts, you get the images from Gemini, and it files them as 768x1152 PNGs with a record of the exact prompt behind each one.

You can work in the web app or on the command line. Both share the same `out/` folder.

Each portrait is a fictional adult with randomized age, background, face, hair, clothing, job, setting and lighting. The same seed always gives the same prompt, so you can redo, resume and trace any image.

## Requirements

- Node 20.19 or newer, or Node 22.12 or newer.
- npm, pnpm or yarn. Any of them works, and nothing in the repo depends on one. See [Package managers](#package-managers).
- A Gemini API key, only for the paid API route. The Gemini API has no free tier for image models.

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

1. Set `GEMINI_API_KEY` in `.env` and restart the server.
2. Open **Generate**, pick a model, size and count, and start. Progress updates live.
3. Failed seeds stay waiting and run first next time.

### Pages

- **Overview** shows progress, the next step and your latest images.
- **Prompts** lists waiting prompts with copy buttons and a toggle for the "Avoid" line.
- **Import** matches downloaded images to prompts.
- **Generate** runs the Gemini API with a progress bar.
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
- `sampler.ts` holds the attribute pools. Each placeholder in the template, like `{hair}`, matches a pool.

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
| `npm run generate -- --count 10` | Generates images with the Gemini API. |
| `npm run status` | Shows the next seed, images done and seeds waiting. |

Flags worth knowing.

- `prompts` takes `--count` (default 20), `--start`, `--out`, `--dir` and `--no-negative`.
- `import-images` takes `--in` (required), `--start`, `--out` and `--dry-run`. Files are matched to the oldest waiting seeds by download time. Run it with `--dry-run` first.
- `generate` takes `--count` (default 10), `--model lite|flash|pro`, `--size 1K|2K|4K`, `--aspect`, `--concurrency`, `--start`, `--out`, `--no-negative` and `--dry-run`.
- `--start N` skips the counter and leaves it unchanged. Dry runs never move it.

Model names are `gemini-3.1-flash-lite-image` for `lite`, `gemini-3.1-flash-image` for `flash`, and `gemini-3-pro-image` for `pro`. The lite model supports 1K only. Rate limit and server errors retry up to 5 times with backoff. Quota errors such as "limit: 0" fail at once, because retrying never helps.

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

- `web/src/app/` is the wiring and nothing else: the router, the shell, the settings store, theme sync, and the boundary that keeps a fault in one page from blanking the app.
- `web/src/features/<route>/` is one page plus whatever only that page uses. To add a page, make the folder, write the page there, and add the route to `web/src/app/router.tsx`. Routes load lazily, one dynamic import each.
- `web/src/shared/` is what more than one page needs: the shadcn components in `shared/components/ui/`, the shared components in `shared/components/`, and the request helpers and query hooks in `shared/lib/`.
- `web/src/lib/text.ts` is the browser's own Seed label. It cannot come from `output-folder.ts` without dragging the image library into the bundle, so the rule sits there and `smoke-audit.ts` holds it to one implementation.
- `server/` is three modules: routes in `index.ts`, a thin client of the output folder in `store.ts`, API generation in `jobs.ts`. `shared/api-types.ts` holds the wire types both sides use.

The Seed, Frame and Prompt rules live in the core, not in the folders. `output-folder.ts` is the only code that reads or writes `out/`, and it owns the folder layout, the Seed counter, the manifest, Prompt wording, and the Frame and Seed rules, all behind the one interface `openOutputFolder` returns. `sampler.ts` holds the attribute pools and takes the salt as an argument, `template.txt` and `negative.txt` are the Prompt files, and `GLOSSARY.md` gives the vocabulary.

## Troubleshooting

- **The page loads but nothing shows.** Run `npm run build` before `npm start`, or use `npm run dev`.
- **A red banner says the output folder does not match.** The salt in `.env` differs from the one `out/` was started with. Restore the old value, or move `out/` aside.
- **429 "limit: 0 ... Free Tier".** Image models have no free API tier. Enable billing on the key's project, or use the free route.
- **Generate says no API key.** Set `GEMINI_API_KEY` in `.env` and restart the server.
- **The wrong image sits next to a prompt on Import.** Downloads were out of order. Change the seed in that row's dropdown. Dropping a seed another row uses swaps the two.
- **Images come out square.** The free Gemini app picks the size. Import crops them to 2:3 and flags them.
- **Port 3001 is busy.** Set `PORT` in `.env` and update the proxy target in `vite.config.ts` if you use `npm run dev`.

## Notes

- Gemini has no negative prompt field, so the negative list goes into the prompt as "Avoid: ...".
- Every Gemini image carries an invisible SynthID watermark.
- Free app images may also carry a visible Gemini logo. Check your first image and decide if that fits your dataset.
- Free app limits change often. Recent guides report about 20 images per day.
- Check Google's current pricing page before a large API run.
