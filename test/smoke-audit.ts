// The seam audit, in its own file because it changes for its own
// reason: the claim that nothing reaches the output folder except
// through output-folder.ts, and the claim that the browser's own
// layers only reach down. Every other check in the smoke test asks
// the output-folder module questions; these blocks read source text
// instead, and they are here because neither claim is visible from
// any one caller's point of view — a module's ownership and a folder's
// reach are both properties of everything at once. Anything that can
// name one of the archive's private names, or pick up a filesystem
// without a reason on record, fails the run.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { check, repoRoot, results } from "./smoke-harness";

/**
 * The files the probes below plant, and the one way they come back out.
 *
 * A probe has to put a file in the tree for the audit to have something to find,
 * and that file must not be there afterwards: the audit reads every source file
 * in the repo, so a planted one that survived would be audited as though it were
 * ours — and would turn the *next* run red, for a reason that has nothing to do
 * with whatever change is being tested.
 *
 * Every plant is recorded the moment it is written rather than in the cleanup
 * that follows, so the cleanup has something to find however far the run got.
 * A `finally` covers a probe whose reading throws and a run that reaches the
 * end; it does not cover Ctrl-C or a closed console, so the same list is emptied
 * on the way out too.
 */
const planted: string[] = [];

/** Writes a probe file, recording it and any folder it had to bring into being. */
const plant = (...files: { path: string; contents: string }[]) => {
  for (const { path, contents } of files) {
    const folder = dirname(path);
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true });
      planted.push(folder);
    }
    writeFileSync(path, contents);
    planted.push(path);
  }
};

/** Takes out everything `plant` put in, newest first so folders outlive nothing. */
const clearPlanted = () => {
  for (const path of planted.splice(0).reverse()) rmSync(path, { recursive: true, force: true });
};

process.on("exit", clearPlanted);
process.on("SIGINT", () => { clearPlanted(); process.exit(130); });
process.on("SIGTERM", () => { clearPlanted(); process.exit(143); });

/** Plants, reads the tree, and takes the plants out again — whatever happens in between. */
const whilePlanted = <T>(files: { path: string; contents: string }[], read: () => T): T => {
  try {
    plant(...files);
    return read();
  } finally {
    clearPlanted();
  }
};

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
  // Every source file in the tree, read. Four probes below want exactly this and
  // differ only in what they plant first, so it is written once.
  const readAll = () => new Map(sourceFiles().map((f) => [repoPath(f), readFileSync(f, "utf8")] as const));
  /** What two of the probes plant: a file whose only sin is reaching for a filesystem. */
  const FS_IMPORT = 'import { readFileSync } from "node:fs";\n';

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
  const probedSources = () =>
    whilePlanted(
      [
        { path: join(repoRoot, "outbound", "reach-around.ts"), contents: FS_IMPORT },
        { path: join(repoRoot, "reach-around.js"), contents: FS_IMPORT },
      ],
      readAll,
    );
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
  results.push(check(
    "the audit is not vacuous: a file added to core/ later is held to the core rules without a list edit",
    audit(whilePlanted(
      [{ path: join(repoRoot, "core", "reach-around-types.ts"),
        contents: 'import type { Status } from "../shared/api-types";\nvoid (0 as Status);\n' }],
      readAll,
    )).some((line) => line.startsWith("core/reach-around-types.ts names the HTTP contract types")),
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
  // Every module specifier a file names, alias or relative, whether a named
  // import or a dynamic one. The graph wants the relative half and the
  // layering claims want the alias half, so the shape of a specifier is settled
  // once here rather than by two regular expressions that have to agree.
  const specifiers = (text: string): string[] =>
    [...code(text).matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
      .map((m) => m[1] ?? m[2] ?? "");
  const localImports = (text: string): string[] => specifiers(text).filter((spec) => spec.startsWith("."));
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
  const withEntry = whilePlanted([{ path: plantedEntry, contents: PLANTED }], readAll);
  results.push(check(
    "the entry-point check is not vacuous: a file the old substring test accepted still fails it",
    PLANTED.includes("openOutputFolder(") &&
      !reachesThroughCore(repoPath(plantedEntry), withEntry) &&
      withEntry.has(repoPath(plantedEntry)),
  ));

  // The direction of the dependency between the two adapters. The command line
  // and the server are adapters over one core, and neither stands on the other:
  // a while ago the Job took its defaults from the command-line entry point,
  // which made the server depend on the command line for no reason a reader
  // could give. That is a property of the sources rather than of any value, so
  // it is asked of the sources here, over the folder.
  const importsFromCli = (sources: Map<string, string>): string[] =>
    [...sources.keys()].filter((f) => inFolder("server", f))
      .filter((f) => localImports(code(sources.get(f) ?? "")).some((spec) => resolveLocal(f, spec)?.startsWith("cli/")))
      .map((f) => `${f} imports the command line`);
  results.push(check(
    "the server imports nothing from the command line",
    // The server folder is read off disk rather than listed here, so a fourth
    // module is covered by landing in the folder.
    [...sourceText.keys()].some((f) => inFolder("server", f)) && importsFromCli(sourceText).length === 0,
  ));
  for (const line of importsFromCli(sourceText)) console.log(`      ${line}`);

  // And it is not vacuous: a server module that reaches into the command line
  // turns it red, and the file never outlives the probe.
  const plantedServer = join(repoRoot, "server", "reach-around-cli.ts");
  const PLANTED_SERVER = 'import { generateImages } from "../cli/generate";\nvoid generateImages;\n';
  const withServer = whilePlanted(
    [{ path: plantedServer, contents: PLANTED_SERVER }],
    readAll,
  );
  results.push(check(
    "the server-does-not-import-the-command-line check is not vacuous: a server module that does turns it red",
    withServer.has(repoPath(plantedServer)) &&
      importsFromCli(withServer).includes(`${repoPath(plantedServer)} imports the command line`) &&
      !importsFromCli(sourceText).includes(`${repoPath(plantedServer)} imports the command line`),
  ));

  // The generation run writes to no terminal and names no image vendor. Asked of
  // the run and of everything it stands on rather than of one file's text, so a
  // print that arrives through a module the run imports counts as the run
  // printing — and so the vendor client cannot come back in under the run's arm
  // without this turning red. A grep does the same job by hand; this does it on
  // every run, over the files as they are now.
  const RUN = "core/generate.ts";
  const textOf = (sources: Map<string, string>, file: string) =>
    sources.get(file) ?? readFileSync(join(repoRoot, file), "utf8");
  // The run's own text and every module it stands on. Comments are not code, so
  // a module that says in prose that it prints is not printing.
  const narrates = (sources: Map<string, string>, entry: string): string[] =>
    [entry, ...graphFrom(entry, sources)].filter((f) =>
      /console\.|@google\/genai/.test(code(textOf(sources, f))));
  const runGraph = graphFrom(RUN, sourceText);
  const narrators = narrates(sourceText, RUN);
  results.push(check(
    "the generation run writes to no terminal and stands on no vendor",
    // The graph has to be non-empty, or "nothing in it prints" is true of
    // nothing at all. Reaching the owner is what a run that touches the output
    // folder must do.
    known.has(RUN) && runGraph.has(OWNER) && runGraph.size > 1 && narrators.length === 0,
  ));
  for (const f of narrators) console.log(`      ${f} prints or names a vendor`);

  // And it is not vacuous: a print in the run's own text and a print in one of the
  // modules it stands on both turn it red. The planted text never reaches disk —
  // what is under test is that this check reaches a verdict about it.
  const own = new Map(sourceText);
  own.set(RUN, `${textOf(sourceText, RUN)}\nconsole.log("a print inside the run itself");\n`);
  const beneath = new Map(sourceText);
  beneath.set(OWNER, `${textOf(sourceText, OWNER)}\nconsole.warn("a print inside the module the run stands on");\n`);
  results.push(check(
    "the run's silence is not vacuous: a print in the run, or in a module it stands on, turns it red",
    narrates(own, RUN).includes(RUN) && narrates(beneath, RUN).includes(OWNER) &&
      !narrators.includes(RUN) && !narrators.includes(OWNER),
  ));

  // The browser has layers of its own under web/src: the composition root in
  // app/, a feature per screen in features/, the pieces more than one feature
  // stands on in shared/, and lib/ for what the browser cannot share with the
  // core. The folders only mean anything if each layer stands on what is
  // beneath it, and this used to be false: the settings store — shared state, a
  // theme and a generation preference — sat in the composition root, so a shared
  // primitive and two feature pages reached upward for it, and at folder
  // granularity app and features pointed at each other. The store has moved;
  // what is asked here is the claim that would have caught it.
  const WEB = "web/src";
  const APP = `${WEB}/app`;
  // A specifier in the browser's own words, as a repo path: `@/` is web/src, and
  // a relative one is anchored on the importing file's own folder. Anything else
  // is a package or the repo's HTTP contract types, which are not one of these
  // four layers — which is also why the two folders called shared cannot be
  // confused for one another here.
  const named = (from: string, spec: string): string | undefined =>
    spec.startsWith("@/") ? `${WEB}/${spec.slice(2)}`
      : spec.startsWith(".") ? repoPath(join(repoRoot, dirname(from), spec))
      : undefined;
  const inside = (file: string, folder: string) => file === folder || file.startsWith(`${folder}/`);
  // The root is the only layer allowed to stand on the features beneath it, and
  // the only layer anything may not stand on. Every file in the browser is asked,
  // so a file added to a layer tomorrow is covered by landing in it.
  const reachesUp = (sources: Map<string, string>): string[] =>
    [...sources].filter(([f]) => inFolder(WEB, f) && !inFolder(APP, f))
      .filter(([f, s]) => specifiers(s).some((spec) => inside(named(f, spec) ?? "", APP)))
      .map(([f]) => `${f} reaches up into the composition root`);
  const upward = reachesUp(sourceText);
  results.push(check("nothing below the composition root reaches up into it", upward.length === 0));
  for (const line of upward) console.log(`      ${line}`);

  // And it is not vacuous: a shared primitive reaching back up for the store is
  // the exact edge this move removed, so planting one has to turn the claim red,
  // and the file must not outlive the probe.
  const plantedUp = join(repoRoot, WEB, "shared", "components", "reach-around-app.ts");
  const PLANTED_UP = 'import { useSettings } from "@/app/settings-store";\nvoid useSettings;\n';
  const withUp = whilePlanted([{ path: plantedUp, contents: PLANTED_UP }], readAll);
  results.push(check(
    "the no-upward-reach claim is not vacuous: a shared primitive that reaches back up turns it red",
    withUp.has(repoPath(plantedUp)) &&
      reachesUp(withUp).includes(`${repoPath(plantedUp)} reaches up into the composition root`) &&
      !reachesUp(sourceText).includes(`${repoPath(plantedUp)} reaches up into the composition root`),
  ));

  // And the other way round inside the tree. A feature is a screen's own: the
  // Gallery reaching into the Prompts page means the two are one screen split in
  // two, and the next change to either one has to know about the other. Same
  // convention as everywhere else in the browser — a feature names its own
  // siblings relatively, or reaches down into shared/ — so an alias at another
  // feature is the only spelling this has to catch.
  const FEATURES = `${WEB}/features`;
  const featureOf = (file: string) => file.slice(FEATURES.length + 1).split("/")[0];
  const reachesFeature = (sources: Map<string, string>): string[] =>
    [...sources].filter(([f]) => inFolder(FEATURES, f))
      .filter(([f, s]) => specifiers(s).some((spec) => {
        const target = named(f, spec);
        return target !== undefined && inFolder(FEATURES, target) && featureOf(target) !== featureOf(f);
      }))
      .map(([f]) => `${f} imports another feature`);
  const sideways = reachesFeature(sourceText);
  results.push(check("no feature stands on a sibling feature", sideways.length === 0));
  for (const line of sideways) console.log(`      ${line}`);

  const plantedSideways = join(repoRoot, FEATURES, "gallery", "reach-around-feature.ts");
  const PLANTED_SIDEWAYS = 'import { useCopied } from "@/features/prompts/copied-store";\nvoid useCopied;\n';
  const withSideways = whilePlanted([{ path: plantedSideways, contents: PLANTED_SIDEWAYS }], readAll);
  results.push(check(
    "the no-sibling-feature claim is not vacuous: a feature that reaches sideways turns it red",
    withSideways.has(repoPath(plantedSideways)) &&
      reachesFeature(withSideways).includes(`${repoPath(plantedSideways)} imports another feature`) &&
      !reachesFeature(sourceText).includes(`${repoPath(plantedSideways)} imports another feature`),
  ));

  // What is left of the root once the store has left it: the one place that may
  // stand on a feature, standing on each of them lazily, so a route's code is
  // fetched when the user first goes there. The features are read off disk, so a
  // sixth one is covered by landing in the folder rather than by being added to
  // a list here — and a route that stopped being lazy would leave this with too
  // few imports rather than with a claim that quietly went quiet.
  const features = new Set(everyFileIn(FEATURES).map(featureOf));
  const ROUTER = `${APP}/router.tsx`;
  const lazyRoutes = (sources: Map<string, string>): string[] =>
    [...code(sources.get(ROUTER) ?? "").matchAll(/lazy\(\s*\(\s*\)\s*=>\s*import\(\s*["'](@\/features\/[^"']+)["']/g)]
      .map((m) => named(ROUTER, m[1]) ?? "");
  const routes = lazyRoutes(sourceText);
  results.push(check(
    "the composition root loads every feature route lazily, one chunk each",
    features.size > 0 && routes.length === features.size &&
      new Set(routes).size === routes.length &&
      routes.every((route) => inFolder(FEATURES, route) && features.has(featureOf(route))),
  ));

  // The one boundary above that this file does not hold itself: module cycles, which
  // are the linter's to refuse. Everything above is asked of the sources in this
  // process; this one is asked of the tool that guards every change after this, so
  // the honest way to ask is to run the tool and read what it says rather than to
  // re-implement the rule here and call that proof.
  //
  // The run is the one `pnpm lint` makes, from the repository root so the
  // configuration is found, and the assertion is on the rule name oxlint prints and
  // on nothing else — no path, no line, no column. Anything narrower would be a
  // claim about today's spelling of a file rather than about the rule.
  //
  // Note how the linter is spawned. On Windows `node_modules/.bin/oxlint` is a POSIX
  // shell script rather than an executable, so asking for it by name fails in a way a
  // linter that ran and found nothing does not — and the second of those two
  // failures is the one that ships a rule which has never once said anything. The
  // script is run through the node binary already in this process for that reason,
  // and a spawn that did not happen is reported below as itself rather than as a
  // clean run.
  const OXLINT = ["node_modules/oxlint/bin/oxlint", "-c", ".oxlintrc.json"];
  const CYCLE_RULE = "import(no-cycle)";
  /** What the linter said, and whether any of it was the cycle rule naming itself. */
  const lintSays = (): { exit: number | null; said: string; namedCycleRule: boolean } => {
    try {
      const said = execFileSync(process.execPath, OXLINT, {
        cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
      return { exit: 0, said, namedCycleRule: said.includes(CYCLE_RULE) };
    } catch (err) {
      // A non-zero exit is the linter's verdict rather than a failure to run: what it
      // found is on the stream either way. A spawn that never happened has no status
      // and no diagnostics, and is carried as itself so the checks below can tell the
      // two apart instead of reading a missing linter as a clean tree.
      const { status, stdout, stderr, message } = err as
        { status?: number | null; stdout?: string; stderr?: string; message?: string };
      const said = `${stdout ?? ""}${stderr ?? ""}`;
      return {
        exit: status ?? null, said: `${said}\n${message ?? ""}`, namedCycleRule: said.includes(CYCLE_RULE),
      };
    }
  };
  const speak = (report: { exit: number | null; said: string }) =>
    console.log(`      the linter exited ${report.exit} and said:\n      ${report.said.trim().replace(/\n/g, "\n      ")}`);

  // The tree as it stands, with nothing planted: the same command over the same
  // files. This has to be green, or the check below would go on passing against a
  // configuration that is red whatever anyone writes — a rule that has stopped
  // meaning anything and still looks installed.
  const asItStands = lintSays();
  results.push(check(
    "the browser's own tree lints clean with the cycle rule on: the run exits zero and names no cycle",
    asItStands.exit === 0 && !asItStands.namedCycleRule,
  ));
  if (asItStands.exit !== 0 || asItStands.namedCycleRule) speak(asItStands);

  // And the rule can actually fail, which is the half of it that decides whether
  // there is a rule here at all. Two files in two of the browser's real layer
  // folders — a shared lib and a feature — each reaching for the other by `@/`,
  // the spelling every module in this app uses for a cross-folder edge. The fixture
  // is in real folders on purpose: a pair planted in the root of web/src instead
  // would sit above all four layers, where no module in this codebase lives, and
  // would say nothing about the resolution path production code walks.
  const plantedCycle = whilePlanted(
    [
      { path: join(repoRoot, WEB, "shared", "lib", "cycle-probe-a.ts"),
        contents: 'import { probeB } from "@/features/overview/cycle-probe-b";\n' +
          "export const probeA = (): string => probeB();\n" },
      { path: join(repoRoot, WEB, "features", "overview", "cycle-probe-b.ts"),
        contents: 'import { probeA } from "@/shared/lib/cycle-probe-a";\n' +
          "export const probeB = (): string => probeA();\n" },
    ],
    lintSays,
  );
  results.push(check(
    "the cycle rule is not vacuous: a cycle planted between two of the browser's own folders turns it red by name",
    plantedCycle.namedCycleRule,
  ));
  if (!plantedCycle.namedCycleRule) speak(plantedCycle);
}
