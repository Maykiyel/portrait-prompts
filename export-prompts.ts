import "dotenv/config";
import { writeFileSync } from "node:fs";
import { buildPrompt } from "./sampler";
import { claimSeeds, loadTemplate, pad } from "./common";

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const startArg = arg("--start", "");
const count = Number(arg("--count", "20"));
const useNegative = !process.argv.includes("--no-negative");
const outFile = arg("--out", "prompts.html");
const salt = (process.env.SEED_SALT ?? "").trim();

const { version, template, negative } = loadTemplate();

// Without --start, continue from the seed counter. Seeds with no image yet come first.
const seeds =
  startArg !== ""
    ? Array.from({ length: count }, (_, i) => Number(startArg) + i)
    : claimSeeds(arg("--dir", "out"), salt, count);
const first = seeds[0];
const last = seeds[seeds.length - 1];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const cards = seeds.map((seed) => {
  let p = "Generate an image. " + buildPrompt(template, seed, salt).trim();
  if (useNegative) p += `\n\nAvoid: ${negative}.`;
  return `<article data-seed="${seed}">
  <header><label><input type="checkbox"> <b>${pad(seed)}</b></label><button type="button">Copy</button></header>
  <pre>${esc(p)}</pre>
</article>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(version)} prompts ${first}-${last}</title>
<style>
  :root { --bg:#fff; --fg:#1a1a1a; --card:#f4f4f5; --line:#d4d4d8; --ok:#15803d; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121212; --fg:#e8e8e8; --card:#1c1c1e; --line:#3a3a3d; --ok:#4ade80; } }
  body { font:15px/1.5 system-ui,sans-serif; background:var(--bg); color:var(--fg); max-width:820px; margin:0 auto; padding:16px; }
  h1 { font-size:18px; } p.hint { opacity:.75; margin-top:-8px; }
  article { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; margin:12px 0; }
  article.done { opacity:.5; border-color:var(--ok); }
  header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
  button { font:inherit; padding:4px 14px; border-radius:6px; border:1px solid var(--line); background:var(--bg); color:var(--fg); cursor:pointer; }
  pre { white-space:pre-wrap; word-break:break-word; margin:0; font:13px/1.45 ui-monospace,monospace; }
</style></head><body>
<h1>${esc(version)} &middot; seeds ${first} to ${last}</h1>
<p class="hint">Open a new Gemini chat for each prompt. Copy, paste, download the image, tick the box. Ticks are saved in this browser.</p>
${cards}
<script>
  const KEY = ${JSON.stringify("done:" + version)};
  let done = {};
  try { done = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) {} };
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t);
    t.select(); document.execCommand("copy"); t.remove(); return Promise.resolve();
  }
  document.querySelectorAll("article").forEach((a) => {
    const seed = a.dataset.seed, box = a.querySelector("input"), btn = a.querySelector("button");
    box.checked = !!done[seed]; a.classList.toggle("done", box.checked);
    box.onchange = () => { done[seed] = box.checked; a.classList.toggle("done", box.checked); save(); };
    btn.onclick = () => copy(a.querySelector("pre").textContent).then(() => {
      btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy"), 1200);
    });
  });
</script></body></html>`;

writeFileSync(outFile, html);
console.log(`Wrote ${seeds.length} prompts to ${outFile} (${version}, seeds ${first} to ${last})`);
