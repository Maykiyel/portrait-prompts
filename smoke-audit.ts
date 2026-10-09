// The seam audit, in its own file because it changes for its own
// reason: the claim that nothing reaches the output folder except
// through output-folder.ts. Every other check in the smoke test asks
// the output-folder module questions; this block reads source text
// instead, and it is here to keep the ownership claim global. Anything
// that can name one of the archive's private names, or pick up a
// filesystem without a reason on record, fails the run.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, repoRoot, results } from "./smoke-harness";

export function runAudit(): void {
  const notSource = (name: string) =>
    name === "node_modules" || name === "dist" || name === "out" || name.startsWith("out-");
  const sourceFiles = (dir = repoRoot, into: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!notSource(entry.name)) sourceFiles(full, into);
      } else if (/\.(?:tsx?|[cm]?js)$/.test(entry.name)) into.push(full);
    }
    return into;
  };
  const repoPath = (file: string) => file.slice(repoRoot.length + 1).replace(/\\/g, "/");
  // The module that owns the folder, and the harness that audits it, are
  // exempt. The harness is the four smoke-* files: the runner, this audit,
  // the shared helpers and the CLI contract.
  const OWNER = "output-folder.ts";
  const HARNESS = new Set(["smoke-test.ts", "smoke-audit.ts", "smoke-cli.ts", "smoke-harness.ts"]);
  const audited = sourceFiles().filter((f) => {
    const path = repoPath(f);
    return path !== OWNER && !HARNESS.has(path);
  });
  const sourceText = new Map(audited.map((f) => [repoPath(f), readFileSync(f, "utf8")] as const));

  // The only files allowed to reach for a filesystem, each for a folder the module
  // does not own. A fourth one has to be added here on purpose, with a reason.
  const ALLOWED_FILESYSTEM_USERS: Record<string, string> = {
    "export-prompts.ts": "writes the HTML page the user opens in a browser",
    "import-images.ts": "reads the downloads the user hands it, and sorts their timestamps",
    "server/index.ts": "serves the built UI out of web/dist",
  };
  const reachesForFilesystem = (s: string) => /from\s+"node:(?:fs|path)"|from\s+"sharp"/.test(s);

  // A private name can only be in a file that is not the owner if that file knows
  // something about the archive's layout, which is exactly what it must not know.
  // The browser is the one exemption: it shows a Seed label and never names a
  // file, so it keeps its label in web/src/lib/text.ts rather than reaching the
  // module, which would drag the image library into the bundle.
  const BROWSER_LABEL_HOME = "web/src/lib/text.ts";
  // The core: the command line, the module and its siblings. The HTTP contract types
  // belong to the server, so nothing in here may name them.
  const CORE = ["generate.ts", "import-images.ts", "export-prompts.ts", "status.ts", "sampler.ts", "errors.ts", "gemini.ts"];
  const PRIVATE_NAMES: [what: string, appliesTo: (file: string) => boolean, pattern: RegExp][] = [
    ["the Seed counter file", () => true, /cursor\.json/],
    ["the Manifest file", () => true, /manifest\.jsonl/],
    ["the Thumbnail folder", () => true, /["'`]thumbs["'`]/],
    ["a Frame filename", () => true, /\.padStart\([^)]*\)\}\.(?:png|webp)/],
    ["a Seed label", (f) => f !== BROWSER_LABEL_HOME, /padStart\(/],
    ["the deleted filesystem helpers", () => true, /from\s+["'][^"']*\/common["']/],
    ["an error class carrying an HTTP status", () => true, /\bApiError\b/],
    ["the HTTP contract types", (f) => CORE.includes(f), /api-types/],
  ];
  const audit = (sources: Map<string, string>): string[] => [
    ...[...sources].filter(([, s]) => reachesForFilesystem(s)).map(([f]) => [f] as const)
      .filter(([f]) => !(f in ALLOWED_FILESYSTEM_USERS))
      .map(([f]) => `${f} reaches for a filesystem with no reason on record`),
    ...PRIVATE_NAMES.flatMap(([what, appliesTo, pattern]) =>
      [...sources].filter(([f, s]) => appliesTo(f) && pattern.test(s)).map(([f]) => `${f} names ${what}`)),
  ];
  const offenders = audit(sourceText);
  results.push(check("nothing reaches the output folder except through output-folder.ts", offenders.length === 0));
  for (const line of offenders) console.log(`      ${line}`);

  // The audit must not be vacuous: a .js file, and a source directory
  // whose name merely starts with "out", are still source. A filesystem
  // import in either one turns the run red.
  const probedSources = () => {
    const scratch = join(repoRoot, "outbound");
    const reach = join(repoRoot, "reach-around.js");
    try {
      mkdirSync(scratch, { recursive: true });
      writeFileSync(join(scratch, "reach-around.ts"), 'import { readFileSync } from "node:fs";\n');
      writeFileSync(reach, 'import { readFileSync } from "node:fs";\n');
      return new Map(sourceFiles().map((f) => [repoPath(f), readFileSync(f, "utf8")] as const));
    } finally {
      // The scratch never outlives the probe, even if reading it throws.
      rmSync(scratch, { recursive: true, force: true });
      rmSync(reach, { force: true });
    }
  };
  const probed = audit(probedSources());
  results.push(check(
    "the audit is not vacuous: a .js file with a filesystem import turns it red",
    probed.some((line) => line.startsWith("reach-around.js ")),
  ));
  results.push(check(
    "the audit is not vacuous: an out-prefixed source directory with a filesystem import turns it red",
    probed.some((line) => line.startsWith("outbound/reach-around.ts ")),
  ));

  // The four command-line entry points ask the module for the folder they work on.
  const ENTRY_POINTS = ["generate.ts", "import-images.ts", "export-prompts.ts", "status.ts"];
  results.push(check(
    "every command-line entry point opens the module",
    ENTRY_POINTS.every((f) => sourceText.get(f)?.includes("openOutputFolder(") === true),
  ));
}
