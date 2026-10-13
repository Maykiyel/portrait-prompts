// The seam audit, in its own file because it changes for its own
// reason: the claim that nothing reaches the output folder except
// through output-folder.ts. Every other check in the smoke test asks
// the output-folder module questions; this block reads source text
// instead, and it is here to keep the ownership claim global. Anything
// that can name one of the archive's private names, or pick up a
// filesystem without a reason on record, fails the run.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  // Three of the four lists below are the folders themselves, read off disk rather
  // than written out here, so a file added to core/, test/ or cli/ is covered the
  // moment it lands. Only the owner stays a literal, for the reason on it.
  const inFolder = (folder: string, file: string) => file.startsWith(`${folder}/`);
  const everyFileIn = (folder: string): string[] =>
    sourceFiles(join(repoRoot, folder)).map(repoPath).sort();
  // The module that owns the folder, and the harness that audits it, are
  // exempt. The owner is named here as a literal on purpose: this check exists
  // to catch *other* files reaching past it, so it cannot be defined as "every
  // file in the folder the owner lives in" without going blind to a second file
  // claiming the same job. The literal is a repo path, like every other key in
  // this audit, so it names one module exactly and a basename match could not
  // quietly exempt a second owner planted anywhere else.
  const OWNER = "core/output-folder.ts";
  // The harness is everything under test/: the runner, this audit, the shared
  // helpers and the CLI contract. Scanned once, on purpose: an exemption this
  // audit grants itself must not be something a file can earn by appearing
  // while the run is in flight.
  const HARNESS = new Set(everyFileIn("test"));
  const audited = sourceFiles().filter((f) => {
    const path = repoPath(f);
    return path !== OWNER && !HARNESS.has(path);
  });
  const sourceText = new Map(audited.map((f) => [repoPath(f), readFileSync(f, "utf8")] as const));

  // The only files allowed to reach for a filesystem, each for a folder the module
  // does not own. A fourth one has to be added here on purpose, with a reason.
  const ALLOWED_FILESYSTEM_USERS: Record<string, string> = {
    "cli/export-prompts.ts": "writes the HTML page the user opens in a browser",
    "cli/import-images.ts": "reads the downloads the user hands it, and sorts their timestamps",
    "server/index.ts": "serves the built UI out of web/dist",
  };
  const reachesForFilesystem = (s: string) => /from\s+"node:(?:fs|path)"|from\s+"sharp"/.test(s);

  // A private name can only be in a file that is not the owner if that file knows
  // something about the archive's layout, which is exactly what it must not know.
  // The browser is the one exemption: it shows a Seed label and never names a
  // file, so it keeps its label in web/src/lib/text.ts rather than reaching the
  // module, which would drag the image library into the bundle.
  const BROWSER_LABEL_HOME = "web/src/lib/text.ts";
  // The core: every file under core/. The HTTP contract types belong to the
  // server, so nothing in here may name them. This asks where a file sits rather
  // than listing the folder's members, which is what makes it cover a core file
  // that did not exist when this file was written.
  const isCore = (file: string) => inFolder("core", file);
  const PRIVATE_NAMES: [what: string, appliesTo: (file: string) => boolean, pattern: RegExp][] = [
    ["the Seed counter file", () => true, /cursor\.json/],
    ["the Manifest file", () => true, /manifest\.jsonl/],
    ["the Thumbnail folder", () => true, /["'`]thumbs["'`]/],
    ["a Frame filename", () => true, /\.padStart\([^)]*\)\}\.(?:png|webp)/],
    ["a Seed label", (f) => f !== BROWSER_LABEL_HOME, /padStart\(/],
    ["the deleted filesystem helpers", () => true, /from\s+["'][^"']*\/common["']/],
    ["an error class carrying an HTTP status", () => true, /\bApiError\b/],
    ["the HTTP contract types", isCore, /api-types/],
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

  // The core list is derived from the folder, so it has to hold for a file that
  // was never written into a list here: a core file naming the HTTP contract
  // types is refused by where it lives, not by its name.
  const plantedTypes = join(repoRoot, "core", "reach-around-types.ts");
  const probedCore = () => {
    try {
      writeFileSync(plantedTypes, 'import type { Status } from "../shared/api-types";\nvoid (0 as Status);\n');
      return new Map(sourceFiles().map((f) => [repoPath(f), readFileSync(f, "utf8")] as const));
    } finally {
      rmSync(plantedTypes, { force: true });
    }
  };
  results.push(check(
    "the audit is not vacuous: a file added to core/ later is held to the core rules without a list edit",
    audit(probedCore()).some((line) => line.startsWith("core/reach-around-types.ts names the HTTP contract types")),
  ));

  // The command-line entry points reach the output folder through the core rather
  // than around it. This used to ask whether each file's own text held the
  // literal "openOutputFolder(", which only proved the file mentioned the
  // factory. So it walks each entry point's own local imports transitively
  // instead: the graph has to arrive at the owner, and every other module on
  // the way has to be a sibling in core/, because core/ is all the command line
  // is allowed to stand on. That is strictly more than the old test asked for,
  // and the probe below is what shows it.
  const known = new Set(sourceFiles().map(repoPath));
  // Comments are not code: the graph below is about what a file imports, not
  // about what a file says it once did.
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const localImports = (text: string): string[] =>
    [...code(text).matchAll(/\bfrom\s*["'](\.[^"']*)["']|\bimport\s*\(\s*["'](\.[^"']*)["']\s*\)/g)]
      .map((m) => m[1] ?? m[2] ?? "");
  // Paths here are repo-relative with forward slashes, so an anchor on the root
  // before the module's own folder and then back through repoPath normalises the
  // ".." out the same way on every platform.
  const resolveLocal = (from: string, spec: string): string | undefined => {
    const base = repoPath(join(repoRoot, dirname(from), spec));
    return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => known.has(c));
  };
  const graphFrom = (entry: string, sources: Map<string, string>): Set<string> => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      // Anything the audited set exempts, the owner above all, is still read from
      // disk, so the walk carries on past it instead of stopping at the first file
      // this audit does not police.
      const text = sources.get(file) ?? readFileSync(join(repoRoot, file), "utf8");
      for (const spec of localImports(text)) {
        const next = resolveLocal(file, spec);
        if (next && !seen.has(next)) { seen.add(next); walk(next); }
      }
    };
    walk(entry);
    return seen;
  };
  // Every module of ours an entry point can reach has to be the owner itself or
  // a sibling in core/. The entry point is not in its own graph: a cli/ file is
  // an adapter, and an adapter is allowed to be where it is.
  const reachesThroughCore = (entry: string, sources: Map<string, string>): boolean => {
    const graph = graphFrom(entry, sources);
    return graph.has(OWNER) && [...graph].every((m) => m === OWNER || inFolder("core", m));
  };

  // Every file under cli/, read off disk: a fifth entry point is covered by
  // landing in the folder, not by being added to a list here.
  const ENTRY_POINTS = everyFileIn("cli");
  results.push(check(
    "every command-line entry point reaches the output folder through the core",
    ENTRY_POINTS.length > 0 && ENTRY_POINTS.every((f) => reachesThroughCore(f, sourceText)),
  ));

  // The check must not be vacuous, and it must not have quietly gone weaker than
  // the text test it replaced. This planted entry point calls openOutputFolder( by
  // name, so the old check waved it through, but it gets the folder through
  // server/store.ts rather than from the core. The check here has to refuse it.
  const plantedEntry = join(repoRoot, "cli", "reach-around.ts");
  const PLANTED = 'import { openOutputFolder } from "../core/output-folder";\n' +
    'import { outDir } from "../server/store";\n' +
    'export const openOwnFolder = () => openOutputFolder(outDir(), "");\n';
  const probedEntry = () => {
    try {
      writeFileSync(plantedEntry, PLANTED);
      return new Map(sourceFiles().map((f) => [repoPath(f), readFileSync(f, "utf8")] as const));
    } finally {
      rmSync(plantedEntry, { force: true });
    }
  };
  const withEntry = probedEntry();
  results.push(check(
    "the entry-point check is not vacuous: a file the old substring test accepted still fails it",
    PLANTED.includes("openOutputFolder(") &&
      !reachesThroughCore(repoPath(plantedEntry), withEntry) &&
      withEntry.has(repoPath(plantedEntry)),
  ));
}
