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
export type Decision = { mode: Mode; reason: string };
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

function isSwift(f: string): boolean {
  return (
    extname(f) === ".swift" &&
    f.startsWith("rt-tray/") &&
    !f.startsWith("rt-tray/Tests/stub-rt/") &&
    !f.startsWith("rt-tray/vm/run/helpers/")
  );
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

// What the e2e job cannot see: it compiles cli.ts, which imports nothing
// from the apps, plugins, tray or Go trees, and builds no rt-ui. An apps
// package manifest still counts, since e2e/setup.ts rebuilds the binary on
// any packages/*/package.json change.
function e2eIgnores(f: string): boolean {
  if (/^packages\/[^/]+\/package\.json$/.test(f)) return false;
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
// rather than ships.
export function jobsFor(event: string, changed: string[]): Jobs {
  if (event !== "pull_request") return { go: true, deck: true, e2e: true, glitter: true, website: true };
  return {
    go: changed.some(goReads),
    deck: changed.some(deckReads),
    e2e: changed.some((f) => !e2eIgnores(f)),
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

// A plugin or workflow file matches by its repo path only: their basenames
// (SKILL.md, lib.rs, Cargo.toml, ci.yml) are common enough to false-positive
// against rt tests.
function readBy(sources: Map<string, string>, f: string): string | undefined {
  const name = isPluginTree(f) || isOtherCiConfig(f) ? f : basename(f);
  for (const [source, text] of sources) {
    if (text.includes(f) || text.includes(name)) return source;
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

export function decide(input: ScopeInput): Decision {
  if (input.event !== "pull_request") return { mode: "full", reason: `${input.event} is not a pull request` };
  if (input.changed.length === 0) return { mode: "skip", reason: "no changed files" };
  if (input.changed.includes(CHECKS_WORKFLOW)) {
    return { mode: "full", reason: `${CHECKS_WORKFLOW} defines the shards` };
  }

  const skippable = input.changed.every(
    (f) =>
      isAppsTree(f) ||
      isPluginTree(f) ||
      isWebsiteTree(f) ||
      isOtherCiConfig(f) ||
      ((isDocs(f) || isSwift(f)) && !isFixture(f)),
  );
  if (skippable) {
    // Only the finite named apps root files are ever read by hardcoded path;
    // an ordinary apps source file's basename (index.ts, README.md) is common
    // enough to false-positive against unrelated rt tests.
    const checkable = input.changed.filter(
      (f) => !isWebsiteTree(f) && (!isAppsTree(f) || APPS_ROOT_FILES.has(f)),
    );
    const read = checkable.map((f) => [f, readBy(input.sources, f)] as const).find(([, by]) => by);
    if (!read) {
      return { mode: "skip", reason: "only docs, the docs site, swift, apps, plugin or workflow files, none of it read by a unit test" };
    }
    return { mode: "full", reason: `${read[0]} is read by ${read[1]}` };
  }

  for (const f of input.changed) {
    const why = invisible(input, f);
    if (why) return { mode: "full", reason: `${f} is ${why}, which --changed cannot see` };
  }
  return { mode: "changed", reason: "typescript only; --changed selects the importers" };
}

// The unit test sources: every test file under the unit directories plus
// the preload, and the relative imports both reach. String presence in
// this text is what "a test reads this file" means. scripts/ci is left
// out so this script's own test, which names files on purpose, never
// widens the read set.
export function collectSources(): { sources: Map<string, string>; preloadImports: Set<string> } {
  const preloadImports = walk([PRELOAD]);
  preloadImports.delete(PRELOAD);
  const roots = [PRELOAD];
  for (const dir of unitDirs()) roots.push(...testFiles(unitDirPath(dir)));
  const sources = new Map<string, string>();
  for (const rel of walk(roots)) sources.set(rel, readFileSync(join(ROOT, rel), "utf8"));
  return { sources, preloadImports };
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

// Every file the roots reach through relative imports, roots included.
// Only TypeScript is scanned; a JSON or shell file that a test imports is
// kept as text but has no imports of its own. The shebang some command
// modules start with is not syntax the transpiler accepts.
function walk(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    seen.add(rel);
    if (!/\.tsx?$/.test(rel)) continue;
    const text = readFileSync(abs, "utf8").replace(/^#!.*/, "");
    const transpiler = rel.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
    for (const imp of transpiler.scanImports(text)) {
      if (!imp.path.startsWith(".")) continue;
      const target = relative(ROOT, resolve(dirname(abs), imp.path));
      const file = existsSync(join(ROOT, target)) && statSync(join(ROOT, target)).isFile() ? target : `${target}.ts`;
      if (existsSync(join(ROOT, file))) queue.push(file);
    }
  }
  return seen;
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
  const changed = event === "pull_request" ? changedFiles() : [];
  const scope = event === "pull_request" ? collectSources() : { sources: new Map<string, string>(), preloadImports: new Set<string>() };
  const decision = decide({ event, changed, ...scope });
  const dirs = unitDirs().join(" ");
  const always = alwaysRunPaths().join(" ");
  console.log(`mode=${decision.mode} (${decision.reason})`);
  console.log(`dirs=${dirs}`);
  const plugins = (event === "pull_request" ? prPluginDirs(changed) : existingPluginDirs()).join(",");
  console.log(`always=${always}`);
  console.log(`plugins=${plugins}`);
  const jobs = jobsFor(event, changed);
  const jobLines = Object.entries(jobs).map(([job, runs]) => `${job}=${runs}`);
  for (const line of jobLines) console.log(line);
  if (!process.argv.includes("--explain") && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [`mode=${decision.mode}`, `dirs=${dirs}`, `always=${always}`, `plugins=${plugins}`, ...jobLines, ""].join("\n"),
    );
  }
}
