/**
 * Decides what the unit shards and the path-gated jobs run for one CI event
 * and prints the answer for checks.yml and e2e.yml (docs/ci.md has the
 * table). Usage:
 *   bun scripts/ci/test-scope.ts             writes mode=, dirs=, always=, plugins=, go=, deck=, e2e=, glitter=, website= to $GITHUB_OUTPUT
 *   bun scripts/ci/test-scope.ts --explain   prints the decision and its reason only
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { basename, dirname, extname, join, relative, resolve } from "path";

export const ROOT = resolve(import.meta.dirname, "..", "..");

export type Mode = "full" | "changed" | "skip";
// extra: tests a changed run adds by path, because --changed cannot select
// them from the diff (a snapshot's own test).
export type Decision = { mode: Mode; reason: string; extra?: string[] };
export type ScopeInput = {
  event: string;
  changed: string[];
  sources: Map<string, string>;
  preloadImports: Set<string>;
};

const PRELOAD = "test-setup.ts";

// A leading "./" scopes bun test's substring filter to that directory (a bare
// name matches anywhere in the tree), so unitDirs returns the tokens as
// written in the script, "./" included: the CI dirs= output line needs them
// verbatim. Anything that walks the filesystem strips the prefix itself via
// unitDirPath below.
export function unitDirs(pkg: { scripts: Record<string, string> } = readPackage()): string[] {
  const script = pkg.scripts.test ?? "";
  const dirs = /^bun test ([\w./][\w./-]*(?: [\w./][\w./-]*)*)$/.exec(script)?.[1]?.trim();
  if (!dirs) throw new Error(`package.json test script is not a bare bun test run over directories: ${script}`);
  return dirs.split(/\s+/);
}

function unitDirPath(dir: string): string {
  return join(ROOT, dir.replace(/^\.\//, ""));
}

export function alwaysRun(): string[] {
  const files = unitDirs().flatMap((dir) => testFiles(unitDirPath(dir)));
  return files.filter((f) => /^no-.*\.test\.tsx?$/.test(basename(f))).sort();
}

// The always= GITHUB_OUTPUT line: "./" prefixed for the same reason as
// unitDirs, a bare path there is a substring filter over the whole tree.
export function alwaysRunPaths(): string[] {
  return alwaysRun().map((f) => `./${f}`);
}

function readPackage() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

function isDocs(f: string): boolean {
  return f.startsWith("docs/") || (/\.mdx?$/.test(f) && !f.startsWith("skills/"));
}

// The docs site's own tree. The unit tests that read it are no-* guards,
// which the guards job runs on every PR the shards skip, and static's
// docs:check covers the generated reference, so no source is checked
// against it: a test that names a page as data (docs-impact.test.ts) would
// otherwise send every page edit through the full suite.
function isWebsiteTree(f: string): boolean {
  return f.startsWith("website/");
}

function isProse(f: string): boolean {
  return isDocs(f) || isWebsiteTree(f);
}

const CHECKS_WORKFLOW = ".github/workflows/checks.yml";
const E2E_WORKFLOW = ".github/workflows/e2e.yml";
const SCOPE_SCRIPT = "scripts/ci/test-scope.ts";

function isOtherCiConfig(f: string): boolean {
  return f.startsWith(".github/") && f !== CHECKS_WORKFLOW;
}

// The tray's tree outside the two directories the unit suite runs.
function isTrayTree(f: string): boolean {
  return f.startsWith("rt-tray/") && !f.startsWith("rt-tray/Tests/stub-rt/") && !f.startsWith("rt-tray/vm/run/helpers/");
}

// Repo metadata no test runs: what git and editors read.
const META_FILES = new Set([".gitignore", ".gitattributes", ".editorconfig", "LICENSE"]);

// Names common enough that a quoted basename is more often a fixture's
// own file than a read of this one.
const GENERIC_NAMES = new Set(["README.md", "index.md", "index.mdx", "CHANGELOG.md", "package.json"]);

function snapshotTest(f: string): string | undefined {
  const m = /^(.*\/)?__snapshots__\/(.+\.test\.tsx?)\.snap$/.exec(f);
  return m ? `${m[1] ?? ""}${m[2]}` : undefined;
}

function isFixture(f: string): boolean {
  return /(^|\/)(fixtures|__fixtures__)\//.test(f);
}

const APPS_PACKAGES = ["gate-kit", "server", "tokens", "tokyo", "tui-kit", "ui", "glance-react", "typescript-config"];
const APPS_ROOT_FILES = new Set([
  "turbo.json",
  "eslint.config.mjs",
  ".prettierrc",
  ".prettierignore",
  "tsconfig.tools.json",
  "vitest.config.ts",
  "scripts/turbo.sh",
  "scripts/set-platform-version.ts",
]);

// The apps' trees run under turbo in `static`; the unit shards never read
// them. Safe to skip only because //#turbo:test (scripts/turbo.sh, run every
// static) covers the rt tests that read apps/packages content
// (scripts/__tests__/turbo-inputs.test.ts, turbo-graph.test.ts, and the
// apps/*/skills guard in lib/__tests__/deps-lock-live.test.ts) -- without
// that root task, an apps-only PR would bypass the guards written for it.
function isAppsTree(f: string): boolean {
  return (
    f.startsWith("apps/") ||
    APPS_PACKAGES.some((p) => f.startsWith(`packages/${p}/`)) ||
    f.startsWith("docs/apps/") ||
    f.startsWith("stories/") ||
    f.startsWith(".storybook/") ||
    f.startsWith("probe/") ||
    f.startsWith("docs/glance/") ||
    APPS_ROOT_FILES.has(f)
  );
}

// Imported plugins build and test in their own checks.yml jobs, keyed on
// the plugins= output; the unit shards run only for an rt test that reads
// a plugin file by repo path.
export function isPluginTree(f: string): boolean {
  return /^plugins\/[^/]+\//.test(f);
}

export function pluginDirs(changed: string[]): string[] {
  const out = new Set<string>();
  for (const f of changed) {
    const m = /^(plugins\/[^/]+)\//.exec(f);
    if (m) out.add(m[1]!);
  }
  return [...out].sort();
}

// rt paths a plugin's own checks read through `rt`: plugin-mattstack runs
// `rt skills check` and diffs its mcp-tools reference against `rt mcp tools`,
// so a change to either surface can turn it red with no plugin file touched.
// Keys are repo path prefixes.
export const RT_PLUGIN_TRIGGERS: Record<string, string> = {
  "lib/mcp/": "plugins/mattstack",
  "commands/mcp.ts": "plugins/mattstack",
  "lib/skills/": "plugins/mattstack",
  "commands/skills": "plugins/mattstack",
  "lib/command-tree": "plugins/mattstack",
  "cli.ts": "plugins/mattstack",
};

export function rtTriggeredPluginDirs(changed: string[], root: string = ROOT): string[] {
  const out = new Set<string>();
  for (const f of changed) {
    for (const [prefix, dir] of Object.entries(RT_PLUGIN_TRIGGERS)) {
      if (f.startsWith(prefix) && existsSync(join(root, dir))) out.add(dir);
    }
  }
  return [...out].sort();
}

// The workflow that defines every plugin job, and this script that routes
// to them, can break any plugin job without touching a plugin file.
export const ALL_PLUGIN_TRIGGERS = [CHECKS_WORKFLOW, SCOPE_SCRIPT];

export function prPluginDirs(changed: string[], root: string = ROOT): string[] {
  if (changed.some((f) => ALL_PLUGIN_TRIGGERS.includes(f))) return existingPluginDirs(root);
  return [...new Set([...pluginDirs(changed), ...rtTriggeredPluginDirs(changed, root)])].sort();
}

const WEBSITE_TRIGGERS = [
  "website/",
  "scripts/gen-docs.ts",
  "scripts/check-docs.ts",
  "scripts/gen-rt-cool-redirects.ts",
  "scripts/check-rt-cool-redirects.ts",
  "scripts/lib/docs-",
  "lib/command-tree-def.ts",
  ...ALL_PLUGIN_TRIGGERS,
];

export function websiteChanged(changed: string[]): boolean {
  return changed.some((f) => WEBSITE_TRIGGERS.some((t) => f.startsWith(t)));
}

// The Go module cannot read outside ui/, and ui:test lives in package.json.
function goReads(f: string): boolean {
  return f.startsWith("ui/") || f === "package.json" || f === CHECKS_WORKFLOW || f === SCOPE_SCRIPT;
}

// deck's suite sees its own tree, the workspace packages it links and the
// root files turbo hashes for every task; turbo --affected narrows it from
// there. A root file is one with no directory.
function deckReads(f: string): boolean {
  if (f.startsWith("apps/deck/")) return true;
  if (f === "scripts/turbo.sh" || f === CHECKS_WORKFLOW || f === SCOPE_SCRIPT) return true;
  return (f.startsWith("packages/") || !f.includes("/")) && !isProse(f);
}

function isGoSource(f: string): boolean {
  return f.startsWith("ui/") && (f.endsWith(".go") || f === "ui/go.mod" || f === "ui/go.sum");
}

// rt's own TypeScript, outside the workspace packages: cli.ts reaches the
// packages through bare imports the relative walk does not follow, so only
// these can be judged by e2eReach.
function isRootPackageTs(f: string): boolean {
  return /\.tsx?$/.test(f) && !f.startsWith("packages/") && !f.startsWith("apps/") && f !== SCOPE_SCRIPT;
}

// What the e2e job cannot see: it compiles cli.ts, which imports nothing
// from the apps, plugins, tray or Go trees, and builds no rt-ui, so rt
// TypeScript cli.ts and the e2e tree never reach (a unit test, a script)
// cannot change it either. An apps package manifest still counts, since
// e2e/setup.ts rebuilds the binary on any packages/*/package.json change.
function e2eIgnores(f: string, reach?: ReadonlySet<string>): boolean {
  if (/^packages\/[^/]+\/package\.json$/.test(f)) return false;
  // A deleted module is in no walk, but a stale importer may still need it.
  if (reach && isRootPackageTs(f) && existsSync(join(ROOT, f)) && !reach.has(f)) return true;
  return (
    isProse(f) ||
    isAppsTree(f) ||
    isPluginTree(f) ||
    f.startsWith("rt-tray/") ||
    isGoSource(f) ||
    (f.startsWith(".github/") && f !== E2E_WORKFLOW)
  );
}

// Every input the glitter pty gate paints from, not just ui/: the driver,
// the command and git-core are TypeScript, and the two bugs the gate was
// written after (RT-221) had no Go diff.
export const GLITTER_TRIGGERS = [
  "cli.ts",
  "ui/",
  "lib/mission/",
  "lib/ui/",
  "lib/setup/",
  "commands/setup.ts",
  "lib/errors.ts",
  "lib/cli-logger.ts",
  "lib/secrets/",
  "commands/glitter.ts",
  "commands/settings",
  "lib/settings/",
  "packages/rt-client/src/settings/write.ts",
  "packages/git-core/",
  "e2e/pty/",
  "e2e/glitter-repo.ts",
  "e2e/interactive.ts",
  "e2e/harness.ts",
  "e2e/setup.ts",
  "e2e/socket-path.ts",
  "test-setup.ts",
  E2E_WORKFLOW,
  "package.json",
  "commands/repos-reidentify.ts",
  "lib/command-tree.ts",
  "lib/plugins.ts",
  SCOPE_SCRIPT,
];

export type Jobs = { go: boolean; deck: boolean; e2e: boolean; glitter: boolean; website: boolean };

// Which path-gated jobs a CI event runs. Anything but a pull request runs
// them all: main is what releases cut from, so a wrong rule fails there
// rather than ships. Without e2eReach, every rt TypeScript file counts.
export function jobsFor(event: string, changed: string[], reach?: ReadonlySet<string>): Jobs {
  if (event !== "pull_request") return { go: true, deck: true, e2e: true, glitter: true, website: true };
  return {
    go: changed.some(goReads),
    deck: changed.some(deckReads),
    e2e: changed.some((f) => !e2eIgnores(f, reach)),
    glitter: changed.some((f) => GLITTER_TRIGGERS.some((t) => f.startsWith(t))),
    website: websiteChanged(changed),
  };
}

export function existingPluginDirs(root: string = ROOT): string[] {
  const dir = join(root, "plugins");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .map((name) => `plugins/${name}`)
    .sort();
}

// A file counts as read when its full repo path appears quoted (after a
// quote, a "../" prefix or `${ROOT}/`), or its name appears as a whole
// quoted segment (join(ROOT, ".github", "workflows", "release.yml")), so
// prose that mentions a file ("read AGENTS.md") or a longer path ending in
// its name ("apps/AGENTS.md") does not. Plugin files, generic names and
// ordinary apps files count by full path only: their basenames (SKILL.md,
// README.md, index.ts) are common enough to false-positive. A no-* guard
// never counts: the guards job runs every one whenever the shards do not
// run in full.
function readBy(sources: Map<string, string>, f: string, opts: { fullPathOnly?: boolean } = {}): string | undefined {
  const fullOnly = opts.fullPathOnly || isPluginTree(f) || GENERIC_NAMES.has(basename(f));
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [new RegExp(`(["'\`]|\\}/|\\.\\./)${escape(f)}["'\`]`)];
  // The full path spelled as join() segments: "apps", "board", "server.ts".
  const segments = f.split("/");
  if (segments.length > 1) {
    patterns.push(new RegExp(`["'\`]${segments.map(escape).join(`["'\`]\\s*,\\s*["'\`]`)}["'\`]`));
  }
  if (!fullOnly) patterns.push(new RegExp(`(["'\`]|\\}/)${escape(basename(f))}["'\`]`));
  for (const [source, text] of sources) {
    if (/^no-.*\.test\.tsx?$/.test(basename(source))) continue;
    if (patterns.some((p) => p.test(text))) return source;
  }
  return undefined;
}

function invisible(input: ScopeInput, f: string): string | undefined {
  if (extname(f) !== ".ts") return "not typescript";
  if (f === PRELOAD) return "the preload";
  if (input.preloadImports.has(f)) return "imported by the preload";
  if (isFixture(f)) return "a fixture";
  if (f.startsWith("scripts/ci/")) return "the scope script";
  if (f.startsWith("packages/glance/")) return "a workspace package --changed cannot trace through a bare import";
  return undefined;
}

// A file in a tree the shards never run: docs, the docs site, the tray, the
// apps and plugin trees, workflows other than checks.yml, repo metadata, and
// the e2e tree where no unit test imports it.
function outsideShards(input: ScopeInput, f: string): boolean {
  return (
    isAppsTree(f) ||
    isPluginTree(f) ||
    isWebsiteTree(f) ||
    isOtherCiConfig(f) ||
    META_FILES.has(f) ||
    (f.startsWith("e2e/") && !input.sources.has(f)) ||
    ((isDocs(f) || isTrayTree(f)) && !isFixture(f))
  );
}

// Only the finite named apps root files are ever read by hardcoded path; an
// ordinary apps source file's basename (index.ts, README.md) is common
// enough to false-positive against unrelated rt tests.
// Repo metadata is never checked either: tests that name ".gitignore" write
// their own.
// An ordinary apps file counts only by its full repo path.
function readerOf(input: ScopeInput, f: string): string | undefined {
  if (isWebsiteTree(f) || META_FILES.has(f)) return undefined;
  if (isAppsTree(f) && !APPS_ROOT_FILES.has(f)) return readBy(input.sources, f, { fullPathOnly: true });
  return readBy(input.sources, f);
}

// Files outside the shards that no unit test reads drop out before the
// rest decides, so a TypeScript change that also edits AGENTS.md still runs
// --changed rather than the full suite.
export function decide(input: ScopeInput): Decision {
  if (input.event !== "pull_request") return { mode: "full", reason: `${input.event} is not a pull request` };
  if (input.changed.length === 0) return { mode: "skip", reason: "no changed files" };
  // checks.yml defines the shards, and the scope test pins both gates'
  // wiring; that test reads them but is left out of the read set.
  const workflow = input.changed.find((f) => f === CHECKS_WORKFLOW || f === E2E_WORKFLOW);
  if (workflow) return { mode: "full", reason: `${workflow} is pinned by the scope test` };

  const rest: string[] = [];
  const extra: string[] = [];
  for (const f of input.changed) {
    const test = snapshotTest(f);
    if (test && input.sources.has(test)) {
      extra.push(test);
      continue;
    }
    if (input.sources.has(f) || !outsideShards(input, f)) {
      rest.push(f);
      continue;
    }
    const by = readerOf(input, f);
    if (by) return { mode: "full", reason: `${f} is read by ${by}` };
  }
  if (rest.length === 0 && extra.length === 0) {
    return { mode: "skip", reason: "only docs, the docs site, tray, apps, plugin, e2e or workflow files, none of it read by a unit test" };
  }

  for (const f of rest) {
    const why = invisible(input, f);
    if (why) return { mode: "full", reason: `${f} is ${why}, which --changed cannot see` };
  }
  const dropped = input.changed.length - rest.length - extra.length;
  const also = dropped ? `, plus ${dropped} file(s) no unit test reads` : "";
  const snaps = extra.length ? `, plus the tests of ${extra.length} snapshot(s)` : "";
  return { mode: "changed", reason: `typescript only${also}${snaps}; --changed selects the importers`, extra };
}

const UNTIMED_TEST_MS = 1000;

// How many shards a --changed run needs: the selected tests' recorded
// weight against a full shard's, so a small change pays for one macOS
// runner rather than three. The estimate only sets wall time; bun's own
// --changed still picks the tests.
export function shardCount(mode: Mode, selected: string[], timings: Record<string, number>): number {
  if (mode !== "changed") return 3;
  const total = Object.values(timings).reduce((a, b) => a + b, 0);
  const weight = selected.reduce((sum, f) => sum + (timings[f] ?? UNTIMED_TEST_MS), 0);
  if (total === 0) return 3;
  return Math.min(3, Math.max(1, Math.ceil(weight / (total / 3))));
}

// The unit tests whose relative-import closure reaches a changed file.
export function selectedTests(changed: string[], tests: string[], graph: Map<string, string[]>): string[] {
  const importers = new Map<string, string[]>();
  for (const [file, imports] of graph) {
    for (const imp of imports) (importers.get(imp) ?? importers.set(imp, []).get(imp)!).push(file);
  }
  const reached = new Set<string>();
  const queue = [...changed];
  while (queue.length) {
    const f = queue.shift()!;
    if (reached.has(f)) continue;
    reached.add(f);
    queue.push(...(importers.get(f) ?? []));
  }
  return tests.filter((t) => reached.has(t));
}

function readTimings(): Record<string, number> {
  const path = join(ROOT, "test-timings.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")).files ?? {};
}

// The unit test sources: every test file under the unit directories plus
// the preload, and the relative imports both reach. String presence in
// this text is what "a test reads this file" means. scripts/ci is left
// out so this script's own test, which names files on purpose, never
// widens the read set.
export function collectSources(): {
  sources: Map<string, string>;
  preloadImports: Set<string>;
  tests: string[];
  graph: Map<string, string[]>;
} {
  const preloadImports = new Set(walk([PRELOAD]).keys());
  preloadImports.delete(PRELOAD);
  const tests: string[] = [];
  for (const dir of unitDirs()) tests.push(...testFiles(unitDirPath(dir)));
  const graph = walk([PRELOAD, ...tests]);
  const sources = new Map<string, string>();
  for (const rel of graph.keys()) sources.set(rel, readFileSync(join(ROOT, rel), "utf8"));
  return { sources, preloadImports, tests, graph };
}

// Every TypeScript file the e2e job's compiled binary and its test run can
// reach: cli.ts, the e2e tree, and the bunfig preload bun test also loads.
export function e2eReach(): Set<string> {
  const roots = ["cli.ts", PRELOAD, ...e2eFiles(join(ROOT, "e2e"))];
  return new Set(walk(roots).keys());
}

function e2eFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...e2eFiles(abs));
    else if (/\.tsx?$/.test(entry)) out.push(relative(ROOT, abs));
  }
  return out;
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

// Every file the roots reach through relative imports, roots included, with
// each one's direct relative imports. Only TypeScript is scanned; a JSON or
// shell file that a test imports is kept as text but has no imports of its
// own. The shebang some command modules start with is not syntax the
// transpiler accepts.
function walk(roots: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift()!;
    if (graph.has(rel)) continue;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const imports: string[] = [];
    graph.set(rel, imports);
    if (!/\.tsx?$/.test(rel)) continue;
    const text = readFileSync(abs, "utf8").replace(/^#!.*/, "");
    const transpiler = rel.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
    for (const imp of transpiler.scanImports(text)) {
      if (!imp.path.startsWith(".")) continue;
      const target = relative(ROOT, resolve(dirname(abs), imp.path));
      const file = existsSync(join(ROOT, target)) && statSync(join(ROOT, target)).isFile() ? target : `${target}.ts`;
      if (!existsSync(join(ROOT, file))) continue;
      imports.push(file);
      queue.push(file);
    }
  }
  return graph;
}

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const abs = join(dir, entry);
    if (relative(ROOT, abs) === "scripts/ci") continue;
    if (statSync(abs).isDirectory()) out.push(...testFiles(abs));
    else if (/\.test\.tsx?$/.test(entry)) out.push(relative(ROOT, abs));
  }
  return out;
}

export const CHANGED_ARGS = ["diff", "--no-renames", "--name-only", "HEAD^1", "HEAD"];

function changedFiles(): string[] {
  const diff = spawnSync("git", CHANGED_ARGS, { cwd: ROOT, encoding: "utf8" });
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
  return diff.stdout.split("\n").filter(Boolean);
}

if (import.meta.main) {
  const event = process.env.EVENT_NAME ?? process.env.GITHUB_EVENT_NAME ?? "push";
  const pr = event === "pull_request";
  const changed = pr ? changedFiles() : [];
  const scope = pr
    ? collectSources()
    : { sources: new Map<string, string>(), preloadImports: new Set<string>(), tests: [], graph: new Map<string, string[]>() };
  const decision = decide({ event, changed, ...scope });
  const extraTests = decision.extra ?? [];
  const selected =
    decision.mode === "changed" ? [...new Set([...selectedTests(changed, scope.tests, scope.graph), ...extraTests])] : [];
  const count = shardCount(decision.mode, selected, readTimings());
  const shards = JSON.stringify(Array.from({ length: count }, (_, i) => i + 1));
  const extra = extraTests.map((f) => `./${f}`).join(" ");
  const dirs = unitDirs().join(" ");
  const always = alwaysRunPaths().join(" ");
  console.log(`mode=${decision.mode} (${decision.reason})`);
  console.log(`shards=${shards}${decision.mode === "changed" ? ` (${selected.length} tests reach the diff)` : ""}`);
  console.log(`extra=${extra}`);
  console.log(`dirs=${dirs}`);
  const plugins = (pr ? prPluginDirs(changed) : existingPluginDirs()).join(",");
  console.log(`always=${always}`);
  console.log(`plugins=${plugins}`);
  const jobs = jobsFor(event, changed, pr ? e2eReach() : undefined);
  const jobLines = Object.entries(jobs).map(([job, runs]) => `${job}=${runs}`);
  for (const line of jobLines) console.log(line);
  if (!process.argv.includes("--explain") && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [`mode=${decision.mode}`, `shards=${shards}`, `extra=${extra}`, `dirs=${dirs}`, `always=${always}`, `plugins=${plugins}`, ...jobLines, ""].join("\n"),
    );
  }
}
