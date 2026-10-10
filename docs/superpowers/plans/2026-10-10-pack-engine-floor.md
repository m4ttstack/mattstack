# Pack Engine Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mac never installs or updates a team pack or the mattstack plugin whose engine floor is above the engine its rt was built with, while routine pack updates keep installing with no app update.

**Architecture:** One pure module (`lib/engine-floor.ts`) answers "which engine does this rt run" and "does this floor fit". One plugin-call module (`lib/setup/plugin-calls.ts`) is the only place `claude plugin install|update` argument lists are built, and it only builds them from an admission that `fits` granted; a guard test keeps it that way. Compile copies the engine's `pack/requires.json` floor into each team pack. Every install path admits first; a refused admission holds the installed version (or installs nothing), and the existing `pack.<name>` / `tool.plugins` rows explain the hold.

**Tech Stack:** Bun + TypeScript, `bun:test`, GitHub Actions YAML, bash (`scripts/release/marketplace.sh`).

**Spec:** `docs/superpowers/specs/2026-10-10-pack-engine-floor-design.md`

## Global Constraints

- The floor file is `pack/requires.json`, shape `{ "minEngine": "<semver>" }`, in `plugins/mattstack/` (hand-maintained) and in every compiled team pack (generated, never hand-edited).
- The engine floor starts at `"minEngine": "0.31.0"`.
- `fits(floor, engine)` is true when `floor` is null, when `engine` is null, or when `engine >= floor` (numeric dotted compare).
- An unknown engine (`null`) fails open and warns once per process at `warn`.
- A floor file that is missing means no floor; one that does not parse warns and counts as no floor, never as a hold.
- `rt --version` plain output is unchanged; its first line stays exactly `rt <version>`.
- `rt --version --json` prints exactly `{"rt":…,"engine":…,"flavor":…}`.
- Held-row copy, verbatim shape: `<plugin> <version> needs a newer mattstack app (engine <floor> or later). Update the app when it's offered.`
- Sync/init refusal copy shape: `This app runs engine <engine>; <what> needs engine <floor>. Update the app first.`
- A built rt binary only ever runs under an isolated HOME (`env -i HOME=<temp> …`).
- Run `bun test` from the repo root only; locally run only the targeted test files for each task (CI runs the full suite).
- Every skill edit goes through `superpowers:writing-skills`; `plugins/mattstack` changes bump `.claude-plugin/plugin.json`'s version.
- Never put employer ticket ids in this repo.

## Review Focus

- A routine team pack update compiled against an engine whose floor is already met installs immediately on a Mac running an older app (the common case must never hold).
- A Mac offline at launch: `plugins.install`'s marketplace refresh fails, and the step still completes from the cached marketplace copy without failing.
- Matt's dev Mac: the mattstack catalog entry is a `git-subdir` `file://` source; nothing is held and nothing crashes.
- A pack held at an older installed version: the `pack.<name>` row is `needs-you` with no action, and Install is still reachable (`canInstall` stays true).
- Compiling the mattstack pack itself (`--pack mattstack`) never overwrites `plugins/mattstack/pack/requires.json`.

---

### Task 1: The engine-floor core

**Files:**
- Create: `lib/engine-floor.ts`
- Test: `lib/__tests__/engine-floor.test.ts`

**Interfaces:**
- Consumes: `compareVersions(a, b)` from `lib/skills/installed-plugins.ts`.
- Produces:
  - `type Floor = string | null`
  - `runnableEngine(deps?: EngineDeps): string | null`
  - `interface EngineDeps { baked: string | undefined; sourceRoot: string | null; readFile(path: string): string | null }`
  - `fits(floor: Floor, engine: string | null): boolean`
  - `readFloor(readFile: (path: string) => string | null, pluginDir: string): Floor`
  - `FLOOR_REL = "pack/requires.json"`
  - `heldCopy(plugin: string, version: string | null, floor: string): string`
  - `refusalCopy(engine: string | null, what: string, floor: string): string`
  - `__resetEngineWarning(): void` (tests only)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { join } from "path";
import { fits, readFloor, runnableEngine, heldCopy, refusalCopy, FLOOR_REL, __resetEngineWarning } from "../engine-floor.ts";

const files = (map: Record<string, string>) => (p: string) => map[p] ?? null;

beforeEach(() => __resetEngineWarning());

describe("runnableEngine", () => {
  test("a baked constant wins", () => {
    expect(runnableEngine({ baked: "0.31.0", sourceRoot: "/src", readFile: files({}) })).toBe("0.31.0");
  });
  test("a source run reads its own tree's plugin.json", () => {
    const pj = join("/src", "plugins", "mattstack", ".claude-plugin", "plugin.json");
    expect(runnableEngine({ baked: undefined, sourceRoot: "/src", readFile: files({ [pj]: '{ "version": "0.30.28" }' }) })).toBe("0.30.28");
  });
  test("no bake and no readable plugin.json is unknown", () => {
    expect(runnableEngine({ baked: undefined, sourceRoot: "/src", readFile: files({}) })).toBeNull();
    expect(runnableEngine({ baked: undefined, sourceRoot: null, readFile: files({}) })).toBeNull();
    const pj = join("/src", "plugins", "mattstack", ".claude-plugin", "plugin.json");
    expect(runnableEngine({ baked: undefined, sourceRoot: "/src", readFile: files({ [pj]: "{ broken" }) })).toBeNull();
  });
});

describe("fits", () => {
  test("no floor fits", () => expect(fits(null, "0.1.0")).toBe(true));
  test("an unknown engine fails open", () => expect(fits("0.31.0", null)).toBe(true));
  test("equal and higher fit, lower does not", () => {
    expect(fits("0.31.0", "0.31.0")).toBe(true);
    expect(fits("0.31.0", "0.32.1")).toBe(true);
    expect(fits("0.31.0", "0.30.28")).toBe(false);
  });
});

describe("readFloor", () => {
  test("reads minEngine", () => {
    expect(readFloor(files({ [join("/p", FLOOR_REL)]: '{ "minEngine": "0.31.0" }' }), "/p")).toBe("0.31.0");
  });
  test("missing file is no floor", () => expect(readFloor(files({}), "/p")).toBeNull());
  test("unparsable or wrong-shaped file is no floor", () => {
    expect(readFloor(files({ [join("/p", FLOOR_REL)]: "{ nope" }), "/p")).toBeNull();
    expect(readFloor(files({ [join("/p", FLOOR_REL)]: '{ "minEngine": 3 }' }), "/p")).toBeNull();
  });
});

describe("copy", () => {
  test("held and refusal copy", () => {
    expect(heldCopy("acme-skills", "0.11.0", "0.31.0")).toBe("acme-skills 0.11.0 needs a newer mattstack app (engine 0.31.0 or later). Update the app when it's offered.");
    expect(refusalCopy("0.30.28", "the engine on main", "0.31.0")).toBe("This app runs engine 0.30.28; the engine on main needs engine 0.31.0. Update the app first.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/__tests__/engine-floor.test.ts`
Expected: FAIL, cannot find module `../engine-floor.ts`.

- [ ] **Step 3: Implement**

```ts
import { join } from "path";
import { readFileSync } from "fs";
import { compareVersions } from "./skills/installed-plugins.ts";
import { warn } from "./ui/warn.ts";

declare const MATTSTACK_ENGINE: string | undefined;

export type Floor = string | null;
export const FLOOR_REL = "pack/requires.json";

export interface EngineDeps {
  baked: string | undefined;
  sourceRoot: string | null;
  readFile(path: string): string | null;
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** A compiled binary's import.meta.dir is virtual, so its "source root" never holds a plugin.json and an unbaked build reads null. */
function defaultDeps(): EngineDeps {
  return {
    baked: typeof MATTSTACK_ENGINE !== "undefined" ? MATTSTACK_ENGINE : undefined,
    sourceRoot: join(import.meta.dir, ".."),
    readFile: safeRead,
  };
}

let warned = false;
export function __resetEngineWarning(): void {
  warned = false;
}

export function runnableEngine(deps: EngineDeps = defaultDeps()): string | null {
  if (deps.baked) return deps.baked;
  if (deps.sourceRoot !== null) {
    const raw = deps.readFile(join(deps.sourceRoot, "plugins", "mattstack", ".claude-plugin", "plugin.json"));
    if (raw !== null) {
      try {
        const v = (JSON.parse(raw) as { version?: unknown }).version;
        if (typeof v === "string" && v.length > 0) return v;
      } catch {
        // falls through to unknown
      }
    }
  }
  if (!warned) {
    warned = true;
    warn("engine-floor", "This rt cannot tell which mattstack engine it runs, so no pack is held on this Mac", {});
  }
  return null;
}

export function fits(floor: Floor, engine: string | null): boolean {
  if (floor === null || engine === null) return true;
  return compareVersions(engine, floor) >= 0;
}

export function readFloor(readFile: (path: string) => string | null, pluginDir: string): Floor {
  const path = join(pluginDir, FLOOR_REL);
  const raw = readFile(path);
  if (raw === null) return null;
  try {
    const v = (JSON.parse(raw) as { minEngine?: unknown }).minEngine;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // falls through
  }
  warn("engine-floor", `${path} is not a valid engine floor, so it is ignored`, {});
  return null;
}

export function heldCopy(plugin: string, version: string | null, floor: string): string {
  return `${plugin}${version ? ` ${version}` : ""} needs a newer mattstack app (engine ${floor} or later). Update the app when it's offered.`;
}

export function refusalCopy(engine: string | null, what: string, floor: string): string {
  return `This app runs engine ${engine ?? "unknown"}; ${what} needs engine ${floor}. Update the app first.`;
}
```

Check `lib/ui/warn.ts`'s exact `warn(module, message, { context, show })` signature before writing the calls and match it.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/__tests__/engine-floor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine-floor.ts lib/__tests__/engine-floor.test.ts
git commit -m "engine-floor: runnable engine, floor reader and fits"
```

---

### Task 2: `rt --version --json`

**Files:**
- Modify: `lib/flavor.ts` (add `versionJson`)
- Modify: `cli.ts:111-113`
- Test: `lib/__tests__/flavor.test.ts` (create if absent)

**Interfaces:**
- Consumes: `runnableEngine()` from Task 1.
- Produces: `versionJson(version: string, engine: string | null, flavor: Flavor): string` returning `{"rt":…,"engine":…,"flavor":…}`.

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "bun:test";
import { versionJson } from "../flavor.ts";

test("versionJson carries rt, engine and flavor, in that order", () => {
  expect(versionJson("v2.24.0", "0.31.0", "prod")).toBe('{"rt":"v2.24.0","engine":"0.31.0","flavor":"prod"}');
  expect(versionJson("dev", null, "dev")).toBe('{"rt":"dev","engine":null,"flavor":"dev"}');
});
```

- [ ] **Step 2: Run** `bun test lib/__tests__/flavor.test.ts` → FAIL (`versionJson` not exported).

- [ ] **Step 3: Implement** in `lib/flavor.ts`:

```ts
/** `rt --version --json`: what release and preflight assert the baked engine against. */
export function versionJson(version: string, engine: string | null, flavor: Flavor): string {
  return JSON.stringify({ rt: version, engine, flavor });
}
```

In `cli.ts`, replace the `--version` branch:

```ts
if (args[0] === "--version" || args[0] === "-V") {
  if (args.includes("--json")) {
    const { runnableEngine } = await import("./lib/engine-floor.ts");
    payload(versionJson(_RT_VERSION, runnableEngine(), processFlavor()) + "\n");
  } else {
    payload(versionBanner(_RT_VERSION, processFlavor(), buildFlavor(), { execPath: process.execPath, sourceDir: import.meta.dir }) + "\n");
  }
```

(keep whatever follows the existing `payload(...)` line, e.g. the exit, unchanged; add `versionJson` to the existing `./lib/flavor.ts` import). The dynamic import keeps `rt --version` startup cost unchanged (`lib/__tests__/no-eager-tui.test.ts`, `scripts/bench-startup.ts`).

- [ ] **Step 4: Run** `bun test lib/__tests__/flavor.test.ts` → PASS. Then `bun cli.ts --version --json` from the worktree prints `{"rt":"dev","engine":"0.31.0","flavor":"dev"}` (engine read from this tree's plugin.json).

- [ ] **Step 5: Commit**

```bash
git add lib/flavor.ts cli.ts lib/__tests__/flavor.test.ts
git commit -m "cli: rt --version --json prints rt, engine and flavor"
```

---

### Task 3: The mattstack floor and compile copying it into team packs

**Files:**
- Create: `plugins/mattstack/pack/requires.json`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (patch bump)
- Modify: `commands/skills.ts` (`compilePackAll`, the `skills compile` handler's write path, and check)
- Test: `commands/__tests__/skills-floor.test.ts`

**Interfaces:**
- Consumes: `readFloor`, `FLOOR_REL` (Task 1); `resolved.pluginRoots.byName.mattstack.dir`, `resolved.packDir` (existing `Resolved`).
- Produces: `floorWrite(resolved: { packDir: string; pluginRoots: PluginRoots }, readFile, write: boolean): { written: string[]; removed: string[]; stale: boolean }` exported from `commands/skills.ts`; compile's `written`/`removed` include `pack/requires.json` when it changes; check's `drift` is true when `stale`.

- [ ] **Step 1: Create the floor**

`plugins/mattstack/pack/requires.json`:

```json
{ "minEngine": "0.31.0" }
```

Bump `plugins/mattstack/.claude-plugin/plugin.json` `version` by one patch above what main has (the `plugin-mattstack` job fails an unbumped plugin change).

- [ ] **Step 2: Failing tests** (`commands/__tests__/skills-floor.test.ts`), using a temp dir (`mkdtempSync` under `os.tmpdir()`) with `engine/pack/requires.json` and `team/` dirs:

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { floorWrite } from "../skills.ts";

function setup(engineFloor: string | null) {
  const root = mkdtempSync(join(tmpdir(), "floor-"));
  const engine = join(root, "engine");
  const team = join(root, "team");
  mkdirSync(join(engine, "pack"), { recursive: true });
  mkdirSync(join(team, "pack"), { recursive: true });
  if (engineFloor) writeFileSync(join(engine, "pack", "requires.json"), JSON.stringify({ minEngine: engineFloor }));
  const resolved = { packDir: team, pluginRoots: { byName: { mattstack: { dir: engine } }, list: [] } } as never;
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  return { engine, team, resolved, read };
}

test("compile copies the engine's floor into the team pack", () => {
  const { team, resolved, read } = setup("0.31.0");
  const out = floorWrite(resolved, read, true);
  expect(out.written).toEqual(["pack/requires.json"]);
  expect(JSON.parse(readFileSync(join(team, "pack", "requires.json"), "utf8"))).toEqual({ minEngine: "0.31.0" });
});

test("an engine with no floor removes a stale team floor", () => {
  const { team, resolved, read } = setup(null);
  writeFileSync(join(team, "pack", "requires.json"), JSON.stringify({ minEngine: "0.31.0" }));
  const out = floorWrite(resolved, read, true);
  expect(out.removed).toEqual(["pack/requires.json"]);
  expect(existsSync(join(team, "pack", "requires.json"))).toBe(false);
});

test("an up-to-date floor writes nothing and is not stale", () => {
  const { team, resolved, read } = setup("0.31.0");
  writeFileSync(join(team, "pack", "requires.json"), JSON.stringify({ minEngine: "0.31.0" }) + "\n");
  expect(floorWrite(resolved, read, false)).toEqual({ written: [], removed: [], stale: false });
});

test("check (write false) reports a differing floor as stale without writing", () => {
  const { team, resolved, read } = setup("0.31.0");
  writeFileSync(join(team, "pack", "requires.json"), JSON.stringify({ minEngine: "0.30.0" }));
  expect(floorWrite(resolved, read, false).stale).toBe(true);
  expect(JSON.parse(readFileSync(join(team, "pack", "requires.json"), "utf8")).minEngine).toBe("0.30.0");
});

test("compiling the mattstack pack itself never touches its own floor", () => {
  const { engine, read } = setup("0.31.0");
  const self = { packDir: engine, pluginRoots: { byName: { mattstack: { dir: engine } }, list: [] } } as never;
  expect(floorWrite(self, read, true)).toEqual({ written: [], removed: [], stale: false });
  expect(JSON.parse(readFileSync(join(engine, "pack", "requires.json"), "utf8")).minEngine).toBe("0.31.0");
});
```

- [ ] **Step 3: Run** `bun test commands/__tests__/skills-floor.test.ts` → FAIL (`floorWrite` not exported).

- [ ] **Step 4: Implement** in `commands/skills.ts`:

```ts
import { FLOOR_REL, readFloor } from "../lib/engine-floor.ts";

/** The team pack's generated floor mirrors the engine it compiled against; the mattstack pack's own floor is hand-maintained and never written here. */
export function floorWrite(
  resolved: { packDir: string; pluginRoots: PluginRoots },
  readFile: (path: string) => string | null,
  write: boolean,
): { written: string[]; removed: string[]; stale: boolean } {
  const engineDir = resolved.pluginRoots.byName.mattstack?.dir ?? null;
  if (engineDir === null || resolve(engineDir) === resolve(resolved.packDir)) return { written: [], removed: [], stale: false };
  const floor = readFloor(readFile, engineDir);
  const target = join(resolved.packDir, FLOOR_REL);
  const current = readFile(target);
  const want = floor === null ? null : JSON.stringify({ minEngine: floor }) + "\n";
  const same = want === null ? current === null : current !== null && readFloor(readFile, resolved.packDir) === floor;
  if (same) return { written: [], removed: [], stale: false };
  if (!write) return { written: [], removed: [], stale: true };
  if (want === null) {
    rmSync(target, { force: true });
    return { written: [], removed: [FLOOR_REL], stale: false };
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, want);
  return { written: [FLOOR_REL], removed: [], stale: false };
}
```

(`resolve` here is `path.resolve`; rename the import if `commands/skills.ts` already has a local `resolve` (it does: the flags resolver), e.g. `import { resolve as resolvePath } from "path"`.)

Wire it in:
- `compilePackAll`: after `performCompile` succeeds with `write` true, call `floorWrite(resolved, safeRead, opts.write ?? true)` and append its `written` / `removed` to the returned `writes`.
- The `rt skills compile` handler's write path (the caller of `performCompile` that prints the compile result): the same call and append, so a plain compile writes the floor too.
- `rt skills check` (where `CheckPayload.drift` is computed): call `floorWrite(resolved, safeRead, false)`; when `stale`, set `drift` true and add `"pack/requires.json is out of date with the engine's floor"` to `compileErrors`.

- [ ] **Step 5: Run** `bun test commands/__tests__/skills-floor.test.ts` → PASS. Then run the existing compile/check tests touched: `bun test commands/__tests__/skills` (targeted files under that prefix).

- [ ] **Step 6: Commit**

```bash
git add plugins/mattstack/pack/requires.json plugins/mattstack/.claude-plugin/plugin.json commands/skills.ts commands/__tests__/skills-floor.test.ts
git commit -m "skills: engine floor file, compile copies it into team packs"
```

---

### Task 4: One module for plugin install and update, behind an admission

**Files:**
- Create: `lib/setup/plugin-calls.ts`
- Create: `lib/__tests__/no-ungated-plugin-install.test.ts`
- Modify (argv only, no behaviour change yet): `lib/setup/pack-cache.ts:168,296`, `lib/setup/steps/plugins.ts:362`, `lib/setup/steps/org-folder-marketplace.ts:98`, `lib/skills/init.ts:564`, `lib/skills/sync.ts:636,650,940`
- Test: `lib/setup/__tests__/plugin-calls.test.ts`

**Interfaces:**
- Consumes: `fits`, `Floor` (Task 1).
- Produces:
  - `type Admission = { ok: true; readonly __admitted: unique symbol } | { ok: false; floor: string; engine: string | null }`
  - `admit(floor: Floor, engine: string | null): Admission`
  - `ADMIT_UNFLOORED: Extract<Admission, { ok: true }>` (for plugins with no floor: chat, herdr-chat, fast-browser, the official base plugins)
  - `installArgs(a: Extract<Admission, { ok: true }>, id: string, extra?: string[]): string[]` → `["plugin", "install", id, ...extra]`
  - `updateArgs(a: Extract<Admission, { ok: true }>, id: string, extra?: string[]): string[]` → `["plugin", "update", id, ...extra]`

- [ ] **Step 1: Failing tests** (`lib/setup/__tests__/plugin-calls.test.ts`)

```ts
import { test, expect } from "bun:test";
import { admit, ADMIT_UNFLOORED, installArgs, updateArgs } from "../plugin-calls.ts";

test("a fitting floor admits and builds argv", () => {
  const a = admit("0.31.0", "0.31.0");
  expect(a.ok).toBe(true);
  if (!a.ok) throw new Error("unreachable");
  expect(updateArgs(a, "acme-skills@acme-market", ["-y"])).toEqual(["plugin", "update", "acme-skills@acme-market", "-y"]);
  expect(installArgs(a, "acme-skills@acme-market")).toEqual(["plugin", "install", "acme-skills@acme-market"]);
});

test("a floor above the engine refuses with both versions", () => {
  expect(admit("0.31.0", "0.30.28")).toEqual({ ok: false, floor: "0.31.0", engine: "0.30.28" });
});

test("no floor and unknown engine admit", () => {
  expect(admit(null, "0.1.0").ok).toBe(true);
  expect(admit("0.31.0", null).ok).toBe(true);
  expect(updateArgs(ADMIT_UNFLOORED, "fast-browser@mattstack")).toEqual(["plugin", "update", "fast-browser@mattstack"]);
});
```

`lib/__tests__/no-ungated-plugin-install.test.ts` (scans source as text, so it is named `no-*` to run on every PR):

```ts
import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const ALLOWED = new Set(["lib/setup/plugin-calls.ts"]);
const PATTERN = /["']plugin["']\s*,\s*["'](install|update)["']/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("every claude plugin install/update argv is built by lib/setup/plugin-calls.ts", () => {
  const offenders = [...walk(join(ROOT, "lib"), []), ...walk(join(ROOT, "commands"), [])]
    .map((p) => relative(ROOT, p))
    .filter((rel) => !ALLOWED.has(rel) && PATTERN.test(readFileSync(join(ROOT, rel), "utf8")));
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run** both files → the plugin-calls test FAILS (module missing); the guard FAILS listing the seven call sites.

- [ ] **Step 3: Implement** `lib/setup/plugin-calls.ts`:

```ts
import { fits, type Floor } from "../engine-floor.ts";

declare const admitted: unique symbol;
export type Admitted = { ok: true; readonly [admitted]: true };
export type Admission = Admitted | { ok: false; floor: string; engine: string | null };

/** The only way to obtain an Admitted: every install or update argv below requires one, so no call site can skip the floor check. */
export function admit(floor: Floor, engine: string | null): Admission {
  if (fits(floor, engine)) return { ok: true } as Admitted;
  return { ok: false, floor: floor!, engine };
}

/** For plugins that declare no engine floor (chat, herdr-chat, fast-browser, the official base plugins). */
export const ADMIT_UNFLOORED: Admitted = { ok: true } as Admitted;

export function installArgs(_a: Admitted, id: string, extra: string[] = []): string[] {
  return ["plugin", "install", id, ...extra];
}

export function updateArgs(_a: Admitted, id: string, extra: string[] = []): string[] {
  return ["plugin", "update", id, ...extra];
}
```

Then replace each raw argv at the listed call sites with the builder and `ADMIT_UNFLOORED` (pure refactor; Tasks 5-8 swap in real admissions):
- `pack-cache.ts:168` `["plugin", "install", id]` → `installArgs(ADMIT_UNFLOORED, id)`; `:296` `["plugin", "update", pack.id, "-y"]` → `updateArgs(ADMIT_UNFLOORED, pack.id, ["-y"])`.
- `plugins.ts:362` → `updateArgs(ADMIT_UNFLOORED, plugin, ["-y"])`.
- `org-folder-marketplace.ts:98` → `step(prefix, installArgs(ADMIT_UNFLOORED, pl.id, ["--scope", pl.scope]))`.
- `init.ts:564` → `claude(installArgs(ADMIT_UNFLOORED, pluginId))`.
- `sync.ts:636` → `updateArgs(ADMIT_UNFLOORED, id, [...scopeArgs, "-y"])`; `:650` and `:940` → `updateArgs(ADMIT_UNFLOORED, id)`.

- [ ] **Step 4: Run** `bun test lib/setup/__tests__/plugin-calls.test.ts lib/__tests__/no-ungated-plugin-install.test.ts lib/setup/__tests__/pack-cache-converge.test.ts lib/setup/__tests__/pack-cache.test.ts` plus the existing tests for `plugins.ts`, `org-folder-marketplace.ts`, `init.ts`, `sync.ts` (find them with `ls lib/setup/__tests__ lib/skills/__tests__ | grep -E "plugins|org-folder|init|sync"`) → all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/plugin-calls.ts lib/setup/__tests__/plugin-calls.test.ts lib/__tests__/no-ungated-plugin-install.test.ts lib/setup/pack-cache.ts lib/setup/steps/plugins.ts lib/setup/steps/org-folder-marketplace.ts lib/skills/init.ts lib/skills/sync.ts
git commit -m "setup: one module builds plugin install and update argv, behind an admission"
```

---

### Task 5: Served packs carry their floor; the daemon's converge holds

**Files:**
- Modify: `lib/setup/pack-cache.ts` (`ServedPack`, `readServedPacks`, `ConvergeResult`, `convergePackCache`)
- Modify: `lib/daemon/team-snapshots.ts` (`createOnPulled`: log a hold once per version)
- Test: `lib/setup/__tests__/pack-cache.test.ts`, `lib/setup/__tests__/pack-cache-converge.test.ts`

**Interfaces:**
- Consumes: `readFloor` (Task 1), `admit`, `updateArgs`, `installArgs` (Task 4), `runnableEngine` (Task 1).
- Produces:
  - `ServedPack` gains `floor: string | null` (read from `<clone>/<source>/pack/requires.json`; null for an object-form source).
  - `ConvergeResult` gains `held: { id: string; to: string | null; floor: string; engine: string | null }[]`.
  - `convergePackCache(p, slug, log, opts)` gains `opts.engine?: () => string | null` (default `runnableEngine`).
  - `settlePack(runner, id, opts)` gains a required first-arg-adjacent `admitted: Admitted` (`settlePack(runner, id, admitted, opts)`), used for its install argv.

- [ ] **Step 1: Failing tests**

In `pack-cache.test.ts`, extend the existing `toEqual` expectations with `floor: null`, and add:

```ts
test("a served pack carries the floor in its pack/requires.json", () => {
  const p = fakeProbes({
    home,
    files: {
      [marketplacePath]: JSON.stringify({ name: "acme-market", plugins: [{ name: "acme-skills", source: "./packs/acme-skills" }] }),
      [join(clone, "packs", "acme-skills", ".claude-plugin", "plugin.json")]: JSON.stringify({ version: "0.6.0" }),
      [join(clone, "packs", "acme-skills", "pack", "requires.json")]: JSON.stringify({ minEngine: "0.31.0" }),
    },
  });
  expect(readServedPacks(p, "acme").packs[0]).toEqual({ id: "acme-skills@acme-market", name: "acme-skills", servedVersion: "0.6.0", floor: "0.31.0" });
});
```

In `pack-cache-converge.test.ts`, add a helper and tests:

```ts
function floorJson(pack: string, minEngine: string): Record<string, string> {
  return { [join(clone, "packs", pack, "pack", "requires.json")]: JSON.stringify({ minEngine }) };
}

test("a pack whose floor is above this Mac's engine is held, not updated", async () => {
  const { p, execs } = probesWith(
    { ...served([{ name: "acme-skills", source: "./packs/acme-skills" }]), ...pluginJson("acme-skills", "0.6.0"), ...floorJson("acme-skills", "0.31.0") },
    (argv) => (argv.includes("list") ? listing([{ id: "acme-skills@acme-market", version: "0.5.28", enabled: false }]) : { code: 0, stdout: "", stderr: "" }),
  );
  const result = await convergePackCache(p, "acme", quietLog, { ...ACTIVE, engine: () => "0.30.28" });
  expect(result.held).toEqual([{ id: "acme-skills@acme-market", to: "0.6.0", floor: "0.31.0", engine: "0.30.28" }]);
  expect(result.updated).toEqual([]);
  expect(execs.filter((a) => a.includes("update") || a.includes("install"))).toEqual([]);
});

test("a routine update whose floor this Mac meets installs at once", async () => {
  const { p } = probesWith(
    { ...served([{ name: "acme-skills", source: "./packs/acme-skills" }]), ...pluginJson("acme-skills", "0.6.1"), ...floorJson("acme-skills", "0.30.0") },
    (argv) => (argv.includes("list") ? listing([{ id: "acme-skills@acme-market", version: "0.6.0", enabled: false }]) : { code: 0, stdout: "", stderr: "" }),
  );
  const result = await convergePackCache(p, "acme", quietLog, { ...ACTIVE, engine: () => "0.30.28" });
  expect(result.updated).toEqual([{ id: "acme-skills@acme-market", to: "0.6.1" }]);
  expect(result.held).toEqual([]);
});

test("a never-installed pack above the floor installs nothing", async () => {
  const { p, execs } = probesWith(
    { ...served([{ name: "acme-skills", source: "./packs/acme-skills" }]), ...pluginJson("acme-skills", "0.6.0"), ...floorJson("acme-skills", "0.31.0") },
    (argv) => (argv.includes("list") ? listing([]) : { code: 0, stdout: "", stderr: "" }),
  );
  const result = await convergePackCache(p, "acme", quietLog, { ...ACTIVE, engine: () => "0.30.28" });
  expect(result.held.map((h) => h.id)).toEqual(["acme-skills@acme-market"]);
  expect(result.installed).toEqual([]);
  expect(execs.filter((a) => a.includes("update") || a.includes("install"))).toEqual([]);
});

test("a pack with no floor file converges as before", async () => {
  const { p } = probesWith(
    { ...served([{ name: "acme-skills", source: "./packs/acme-skills" }]), ...pluginJson("acme-skills", "0.6.0") },
    (argv) => (argv.includes("list") ? listing([{ id: "acme-skills@acme-market", version: "0.5.0", enabled: false }]) : { code: 0, stdout: "", stderr: "" }),
  );
  const result = await convergePackCache(p, "acme", quietLog, { ...ACTIVE, engine: () => "0.1.0" });
  expect(result.updated.map((u) => u.id)).toEqual(["acme-skills@acme-market"]);
});
```

- [ ] **Step 2: Run** `bun test lib/setup/__tests__/pack-cache.test.ts lib/setup/__tests__/pack-cache-converge.test.ts` → the new tests FAIL.

- [ ] **Step 3: Implement**
- `ServedPack`: add `floor: string | null`. In `readServedPacks`, for a string source: `floor: readFloor(p.readFile, join(clone, entry.source))`; for an object source: `floor: null`.
- `emptyResult()` adds `held: []`.
- `convergePackCache`: `const engine = (opts.engine ?? runnableEngine)();` once before the loop. In the per-pack loop, after the `version unknown` / `current` checks and before the budget check:

```ts
const admission = admit(pack.floor, engine);
if (!admission.ok) {
  if (!result.held.some((h) => h.id === pack.id)) result.held.push({ id: pack.id, to: pack.servedVersion, floor: admission.floor, engine });
  continue;
}
```

  Use `updateArgs(admission, pack.id, ["-y"])` for the update, and pass `admission` to `settlePack`.
- `settlePack(runner, id, admitted, opts)`: use `installArgs(admitted, id)`. Update its other callers (in `plugins.ts`) to pass the admission they hold (Task 6 supplies a real one; until then `ADMIT_UNFLOORED`).
- `team-snapshots.ts` `createOnPulled`: after `convergePackCache` returns, for each `held` entry, `if (!hasKvValue("pack-holds", \`${h.id}@${h.to}\`)) { log.info({ ...h }, "pack held: this app's engine is below its floor"); setKvValue("pack-holds", \`${h.id}@${h.to}\`, { at: Date.now() }); }` (imports from `lib/state/kv-blob.ts`).

- [ ] **Step 4: Run** the two files plus `bun test lib/daemon/__tests__/team-snapshots.test.ts` (if present) → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/pack-cache.ts lib/daemon/team-snapshots.ts lib/setup/__tests__/pack-cache.test.ts lib/setup/__tests__/pack-cache-converge.test.ts
git commit -m "pack-cache: served packs carry their floor; converge holds a pack this app can't run"
```

---

### Task 6: `plugins.install` admits team packs and the mattstack plugin

**Files:**
- Create: `lib/setup/mattstack-floor.ts`
- Modify: `lib/setup/steps/plugins.ts` (the install/update loop around :340-400; the outcome detail)
- Test: `lib/setup/__tests__/mattstack-floor.test.ts`, the existing `plugins.install` step test file

**Interfaces:**
- Consumes: `readFloor` (Task 1), `admit`/`updateArgs`/`installArgs` (Task 4), `ServedPack.floor` (Task 5), `parseMarketplaceList` (existing, `plugins.ts:81`).
- Produces:
  - `parseMarketplaceList` entries gain `installLocation: string | null`.
  - `mattstackFloor(p: Probes, run: (args: string[]) => Promise<ExecResult>, opts: { refresh: boolean }): Promise<Floor>`: when `refresh`, runs `plugin marketplace update mattstack` first (a non-zero exit is ignored: offline falls back to the cache); then lists marketplaces, takes `mattstack`'s `installLocation`, reads `<installLocation>/.claude-plugin/marketplace.json`, finds the `mattstack` entry, and only when its `source` is a string relative path returns `readFloor(p.readFile, join(installLocation, source))`; otherwise (object or `git-subdir` source, no marketplace, unreadable files) returns `null`.

- [ ] **Step 1: Failing tests** (`mattstack-floor.test.ts`, using `fakeProbes` with `files` and a scripted `exec` like `pack-cache-converge.test.ts`'s `probesWith`):

```ts
test("an inline catalog entry yields the published floor", async () => {
  // marketplace list -> [{name:"mattstack", installLocation:"/m"}]; /m/.claude-plugin/marketplace.json lists {name:"mattstack", source:"./plugins/mattstack"}; /m/plugins/mattstack/pack/requires.json = {minEngine:"0.31.0"}
  expect(await mattstackFloor(p, run, { refresh: true })).toBe("0.31.0");
  expect(execs[0]).toEqual([...claudeExec, "plugin", "marketplace", "update", "mattstack"]);
});
test("a git-subdir catalog entry (a dev marketplace) yields no floor", async () => { /* source: { source: "git-subdir", url: "file:///…" } */ expect(await mattstackFloor(p, run, { refresh: false })).toBeNull(); });
test("an offline refresh falls back to the cached copy", async () => { /* marketplace update exits 1; the rest as the first test */ expect(await mattstackFloor(p, run, { refresh: true })).toBe("0.31.0"); });
test("no registered mattstack marketplace yields no floor", async () => { expect(await mattstackFloor(p, run, { refresh: true })).toBeNull(); });
```

(Write each fixture out in full with the same `fakeProbes({ home, env, files, exec })` shape the converge test uses.)

In the `plugins.install` step test: one case where a team pack's served floor is above the injected engine and its installed version is older → no `plugin update` for it, the step's detail names it with `heldCopy`, and the step does not fail; one where the mattstack floor is above the engine → no `plugin update mattstack@mattstack`; one offline case (`marketplace update` exits 1) → the step still completes.

- [ ] **Step 2: Run** them → FAIL.

- [ ] **Step 3: Implement**
- `parseMarketplaceList`: add `installLocation: typeof m.installLocation === "string" ? m.installLocation : null` (extend the parsed type).
- `lib/setup/mattstack-floor.ts` as described in Produces.
- In `plugins.ts`'s run: compute `const engine = runnableEngine()` (allow the step context to inject one for tests the way other step deps are injected; follow how `ctx.p` is faked in the existing test) and, once per config dir before the loop, `const msFloor = await mattstackFloor(ctx.p, runner.run-adapter, { refresh: true })`. Build a floor lookup: team packs from `readServedPacks(...)` (`floor` per id); `mattstack@mattstack` → `msFloor`; everything else → `null`.
- Before the existing `update` / install branch for each plugin: `const admission = admit(floorFor(plugin), engine)`. When `!admission.ok`: record `held.push(heldCopy(id, servedVersionOrNull, admission.floor))`, `ctx.log("plugins.install", …)`, and `continue` (no install, no update, no enable). Otherwise use `updateArgs(admission, plugin, ["-y"])` and pass `admission` to `settlePack`.
- The step's outcome: when `held` is non-empty and nothing else failed, keep the step's existing success state and append `held.join(" ")` to its detail, so `rt setup update` reports it.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/mattstack-floor.ts lib/setup/steps/plugins.ts lib/setup/__tests__/mattstack-floor.test.ts lib/setup/__tests__/<the plugins.install test file>
git commit -m "setup: plugins.install holds a pack or mattstack plugin this app can't run"
```

---

### Task 7: `rt skills sync` and `rt skills init` refuse an engine this app can't run

**Files:**
- Modify: `lib/skills/sync.ts` (`refreshCachedEngine`, the `update-engine` non-cached branch, `update-pack`; deps gain `engine?: () => string | null`)
- Modify: `lib/skills/init.ts` (before the install at :564; deps gain `engine?: () => string | null`)
- Test: the existing `lib/skills/__tests__/sync*.test.ts` and `init*.test.ts`

**Interfaces:**
- Consumes: `readFloor`, `refusalCopy`, `runnableEngine` (Task 1); `admit`, `updateArgs`, `installArgs` (Task 4).
- Produces: sync's `update-engine` returns `refused(refusalCopy(engine, "the engine on main", floor))` when the refreshed engine's floor does not fit; `update-pack` returns `skipped(heldCopy(id, packSourceVersion, floor))`; init returns `failed("install-failed", refusalCopy(engine, \`the ${pack} pack\`, floor))`.

- [ ] **Step 1: Failing tests**
- sync, cached engine: after `marketplace update`, the marketplace copy's mattstack floor is `0.31.0` and the injected engine is `0.30.28` → the run stops at `update-engine` with status refused and the refusal copy; no `plugin update mattstack@mattstack` was run.
- sync, `update-pack`: the pack's `pack/requires.json` floor `0.31.0`, engine `0.30.28` → `update-pack` is skipped with the held copy and `verify-installed` does not fail the run because of it (skip `verify-installed` when `update-pack` held).
- init: the compiled pack's floor `0.31.0`, engine `0.30.28` → outcome `install-failed` with the refusal copy, and no `plugin install` exec.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
- `refreshCachedEngine`: after `marketplace update` succeeds, read the floor with `mattstackFloor`'s reader logic (reuse `lib/setup/mattstack-floor.ts` through a `deps.engineFloor?: () => Promise<Floor>` seam whose default calls it with `{ refresh: false }`), `const a = admit(floor, engine)`; when `!a.ok` return `refused(refusalCopy(engine, "the engine on main", a.floor))`; else `updateArgs(a, id, [...scopeArgs, "-y"])`.
- The non-cached `update-engine` branch: the engine source dir is known (`engine.dir`): `admit(readFloor(readFileOrNull, engine.dir), engine)`, same refusal.
- `update-pack`: `const a = admit(readFloor(readFileOrNull, pack.dir), engine)`; when `!a.ok` return `skipped(heldCopy(id, packSourceVersion, a.floor))` and set a `packHeld` flag that `verify-installed` checks to return `skipped("held for the app")` instead of failing.
- init: `const a = admit(readFloor(readFileOrNull, packDir), engine)`; when `!a.ok` return `failed("install-failed", refusalCopy(engine, \`the ${pack} pack\`, a.floor))` before the install; else `claude(installArgs(a, pluginId))`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/sync.ts lib/skills/init.ts lib/skills/__tests__/<touched test files>
git commit -m "skills: sync and init refuse an engine this app can't run"
```

---

### Task 8: `org.folder` re-points without reinstalling a held pack

**Files:**
- Modify: `lib/setup/steps/org-folder-marketplace.ts` (`convergeMarketplace`, the `else` branch at :196-213 and the `pending` branches)
- Test: the existing `org-folder-marketplace` test file

**Interfaces:**
- Consumes: `readServedPacks` with `floor` (Task 5), `admit`, `installArgs` (Task 4), `heldCopy`, `runnableEngine` (Task 1); the existing `rewriteMarketplaces(ctx, stalePaths, dir)`.
- Produces: when any user-scoped plugin the branch would reinstall is a served pack whose floor does not fit, `convergeMarketplace` runs no remove/add/install for that config dir, calls `rewriteMarketplaces(ctx, [...clone.stalePaths, ...stale], clone.dir)` so the registration follows the moved folder while the installed copies stay, and returns `{ state: "partial", detail: <heldCopy for each held pack> + " The marketplace now points at the moved folder; rt reinstalls nothing until the app updates." }`.

- [ ] **Step 1: Before writing code, verify the premise** on this Mac with a throwaway marketplace: register a directory marketplace in a temp `CLAUDE_CONFIG_DIR`, install a plugin from it, move the directory, rewrite `known_marketplaces.json`'s path the way `rewriteMarketplaces` does, and confirm `claude plugin list --json` (same config dir) still lists the plugin as installed. Record the result in the commit message. If the plugin disappears, stop and raise it with the user: the deferral must then hold the whole move (spec, Gate table).

- [ ] **Step 2: Failing test**: a clone whose served pack has floor `0.31.0`, engine `0.30.28`, a registered marketplace at a stale path with that pack installed user-scoped → no `plugin marketplace remove`, no `add`, no `install` execs; `rewriteMarketplaces` was applied (assert the rewritten path in the fake's files); outcome `partial` with the held copy.

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement**: in the `else` branch and the two `pending` branches, before building `steps`, compute `const served = readServedPacks(ctx.p, slugOf(clone.dir), {}).packs` (use the slug helper the step already uses to find the clone) and `const heldOnes = user.filter((pl) => { const s = served.find((x) => x.id === pl.id); return s !== undefined && !admit(s.floor, engine).ok; })`. When `heldOnes.length > 0`: `rewriteMarketplaces(...)`, `setPending(ctx, null, name, dir)` only in the `else` branch (no remove happened), and return the partial outcome. Otherwise build `install` steps with `installArgs(admit(...) as Admitted, pl.id, ["--scope", pl.scope])` (an admitted value from the same check).

- [ ] **Step 5: Run** → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/setup/steps/org-folder-marketplace.ts lib/setup/__tests__/<org-folder test file>
git commit -m "org.folder: re-point the marketplace without reinstalling a held pack"
```

---

### Task 9: Rows explain holds and never block Install

**Files:**
- Modify: `lib/setup/validators/tools.ts` (`packRow` :537, `pluginsRow` :585, their caller near :793)
- Modify: `lib/setup/plan.ts:135` (`isInstallSatisfied`)
- Test: the existing validator tests for `pack.*` / `tool.plugins` and `plan` tests

**Interfaces:**
- Consumes: `ServedPack.floor` (Task 5), `mattstackFloor` (Task 6, with `{ refresh: false }`), `fits`, `heldCopy`, `runnableEngine` (Task 1).
- Produces: `packRow(req, pluginList, served, engine)` and `pluginsRow(pluginList, msFloor, engine)`; a held row is `{ status: "needs-you", detail: heldCopy(...), action: null }`; `isInstallSatisfied` returns `false` for a `needs-you` row with `action === null`.

- [ ] **Step 1: Failing tests**
- `packRow`: served `0.6.0` with floor `0.31.0`, installed `0.5.28`, engine `0.30.28` → `needs-you`, detail `heldCopy("acme-skills", "0.6.0", "0.31.0")`, `action` null. Not installed, same floor → same row (never `missing` with an Install action).
- `packRow`: floor `0.30.0`, engine `0.30.28`, installed older → today's `needs-you` "Installed X; the team serves Y" with the Install action (routine updates unchanged).
- `pluginsRow`: mattstack floor `0.31.0`, engine `0.30.28` → `needs-you`, held copy for `mattstack`, no action.
- `plan`: a group with a held `pack.acme-skills` row → after `applyInstallSatisfiedFlip(groups, "status")` it stays `required: false`, and the composed plan's `canInstall` is true.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
- `packRow`: add an `engine: string | null` parameter. Right after the `!entry` skip/`missing` checks are computed but before returning `missing` or the version-mismatch `needs-you`: `if (served && served.servedVersion !== null && !fits(served.floor, engine) && entry?.version !== served.servedVersion) return row({ ...base, status: "needs-you", detail: heldCopy(req.pack, served.servedVersion, served.floor!), action: null });`.
- `pluginsRow`: add `(pluginList, msFloor: Floor, engine: string | null)`; after the `absent`/`disabled` checks are computed, before returning `missing`: `if (!fits(msFloor, engine)) return row({ ...base, status: "needs-you", detail: heldCopy("mattstack", null, msFloor!), action: null });` (a held mattstack plugin still installed keeps working; when absent, Install could not install it either).
- The caller near :793: compute `engine = runnableEngine()` once and `msFloor = await mattstackFloor(p, run, { refresh: false })`, pass them in.
- `plan.ts`:

```ts
function isInstallSatisfied(r: Row): boolean {
  if (r.status === "skipped") return false;
  // A needs-you row that offers no action is one Install cannot clear (a pack held for an app update).
  if (r.status === "needs-you" && r.action === null) return false;
  return INSTALL_SATISFIED_IDS.has(r.id) || r.id.startsWith("pack.");
}
```

  and extend its doc comment with that second case.

- [ ] **Step 4: Run** → PASS, plus `bun test commands/__tests__/setup-copy.test.ts`. If a snapshot changes only because of an intended new copy, review it and update with `bun test --update-snapshots commands/__tests__/setup-copy.test.ts`; any other snapshot change is a bug.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/tools.ts lib/setup/plan.ts <touched test files>
git commit -m "setup: pack and plugin rows explain a hold and never block Install"
```

---

### Task 10: Release bakes and asserts the engine, publishes late, never goes backwards

**Files:**
- Modify: `.github/workflows/release.yml` (:92-109, :154-155, after :291, before :398)
- Modify: `scripts/release/marketplace.sh` (after the `fetch` at :223)
- Test: `scripts/__tests__/release-marketplace.test.ts`

**Interfaces:**
- Consumes: `rt --version --json` (Task 2), `plugins/mattstack/pack/requires.json` (Task 3).
- Produces: workflow steps named `Validate the marketplace catalog`, `Assert the baked engine matches the plugin`, `Publish the marketplace catalog` (moved).

- [ ] **Step 1: Failing tests** in `release-marketplace.test.ts` (reuse its throwaway bare-repo publish setup in the `marketplace.sh publish` describe):
- "the staged tree carries the engine floor": run `--dry-run` with a fixture source whose `plugins/mattstack/pack/requires.json` exists; assert the script's stage (expose it via the test's existing approach to inspecting the stage, or publish into the bare repo and `git show main:plugins/mattstack/pack/requires.json`) contains the file.
- "a lower mattstack version is refused": publish once with mattstack `plugin.json` version `0.31.0`, then publish a source with `0.30.28` → non-zero exit, stderr contains `older than the published`, and the bare repo's `main` is unchanged.

- [ ] **Step 2: Run** `bun test scripts/__tests__/release-marketplace.test.ts` → the refusal test FAILS.

- [ ] **Step 3: Implement** `marketplace.sh`, right after a successful `fetch`, before `reset --soft`:

```bash
    PUBLISHED_VER="$(git -C "$STAGE" show FETCH_HEAD:plugins/mattstack/.claude-plugin/plugin.json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)"
    STAGED_VER="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version",""))' "$STAGE/plugins/mattstack/.claude-plugin/plugin.json" 2>/dev/null || true)"
    if [ -n "$PUBLISHED_VER" ] && [ -n "$STAGED_VER" ] && python3 - "$STAGED_VER" "$PUBLISHED_VER" <<'PY'
import sys
a, b = ([int(x) for x in v.split(".")] for v in sys.argv[1:3])
sys.exit(0 if a < b else 1)
PY
    then
        echo "✗ mattstack $STAGED_VER is older than the published $PUBLISHED_VER — refusing to publish it" >&2
        exit 1
    fi
```

`release.yml`:
- Rename the existing step at :99 to `Validate the marketplace catalog` and make it always `scripts/release/marketplace.sh --dry-run` (drop the `PUBLISH` branch and the token env). Update its comment: validation stays first so a broken catalog costs seconds.
- :155 compile line: append ` --define MATTSTACK_ENGINE="$(jq -r .version plugins/mattstack/.claude-plugin/plugin.json | sed 's/.*/"&"/')"` — write it so the define value is a JSON string literal, e.g. set `ENGINE="$(jq -r .version plugins/mattstack/.claude-plugin/plugin.json)"` in the step's `run` and pass `--define MATTSTACK_ENGINE="\"$ENGINE\""`.
- After `Assert tag matches the stamped version`, add (no `if:`, so dispatch runs check it too):

```yaml
      - name: Assert the baked engine matches the plugin
        shell: bash
        run: |
          WANT="$(jq -r .version plugins/mattstack/.claude-plugin/plugin.json)"
          GOT="$(env -i HOME="$(mktemp -d)" PATH="$PATH" dist/rt --version --json | jq -r '.engine // empty')"
          [ -n "$GOT" ] || { echo "::error::rt --version --json has no engine"; exit 1; }
          [ "$GOT" = "$WANT" ] || { echo "::error::baked engine '$GOT' != plugin.json '$WANT'"; exit 1; }
```

- Immediately before `Create Release` (after `Assert release assets are complete`), add:

```yaml
      # Live before the app is: plugins.install adds the catalog's base plugins,
      # so an app must never be offered before its catalog. It runs after every
      # step that can fail, so a failed run publishes nothing, and a failed
      # publish stops the run before Create Release makes appcast.xml live.
      - name: Publish the marketplace catalog
        if: steps.meta.outputs.publish == 'true'
        shell: bash
        env:
          MARKETPLACE_TOKEN: ${{ secrets.MARKETPLACE_TOKEN }}
        run: scripts/release/marketplace.sh
```

- [ ] **Step 4: Run** `bun test scripts/__tests__/release-marketplace.test.ts` → PASS. Run `actionlint .github/workflows/release.yml` if installed; otherwise re-read the YAML indentation by eye.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml scripts/release/marketplace.sh scripts/__tests__/release-marketplace.test.ts
git commit -m "release: bake and assert the engine, publish the catalog last, never backwards"
```

---

### Task 11: CI keeps the floor honest

**Files:**
- Create: `scripts/ci/engine-floor-check.ts`
- Create: `scripts/__tests__/engine-floor-check.test.ts`
- Modify: `.github/workflows/checks.yml` (the `plugin-mattstack` job, after `plugin.json version bumped`)

**Interfaces:**
- Consumes: git diff against `--base`; `PR_BODY` env.
- Produces: `checkEngineFloor(input: { changed: string[]; prBody: string; floor: string | null; pluginVersion: string }): string[]` (error lines; empty = pass), and a CLI that exits 1 when non-empty.

- [ ] **Step 1: Failing tests**

```ts
import { test, expect } from "bun:test";
import { checkEngineFloor } from "../ci/engine-floor-check.ts";

const REF = "plugins/mattstack/attachments/mcp-tools/reference.md";
const FLOOR = "plugins/mattstack/pack/requires.json";

test("a tool reference change without a floor change fails", () => {
  expect(checkEngineFloor({ changed: [REF], prBody: "", floor: "0.31.0", pluginVersion: "0.31.2" })).toHaveLength(1);
});
test("the waiver line passes it", () => {
  expect(checkEngineFloor({ changed: [REF], prBody: "engine-floor: unchanged (docs only)", floor: "0.31.0", pluginVersion: "0.31.2" })).toEqual([]);
});
test("a floor change passes it", () => {
  expect(checkEngineFloor({ changed: [REF, FLOOR], prBody: "", floor: "0.31.2", pluginVersion: "0.31.2" })).toEqual([]);
});
test("a floor above the plugin version always fails", () => {
  expect(checkEngineFloor({ changed: [FLOOR], prBody: "", floor: "0.32.0", pluginVersion: "0.31.2" })).toHaveLength(1);
});
test("unrelated changes pass", () => {
  expect(checkEngineFloor({ changed: ["lib/x.ts"], prBody: "", floor: "0.31.0", pluginVersion: "0.31.2" })).toEqual([]);
});
```

- [ ] **Step 2: Run** `bun test scripts/__tests__/engine-floor-check.test.ts` → FAIL.

- [ ] **Step 3: Implement** `scripts/ci/engine-floor-check.ts`:

```ts
import { readFileSync } from "fs";
import { compareVersions } from "../../lib/skills/installed-plugins.ts";

const REF = "plugins/mattstack/attachments/mcp-tools/reference.md";
const FLOOR = "plugins/mattstack/pack/requires.json";

export function checkEngineFloor(input: { changed: string[]; prBody: string; floor: string | null; pluginVersion: string }): string[] {
  const errors: string[] = [];
  if (input.floor !== null && compareVersions(input.floor, input.pluginVersion) > 0) {
    errors.push(`${FLOOR} sets minEngine ${input.floor}, above the plugin's own version ${input.pluginVersion}; every Mac would hold it.`);
  }
  if (input.changed.includes(REF) && !input.changed.includes(FLOOR) && !/^engine-floor: unchanged\b/m.test(input.prBody)) {
    errors.push(`The MCP tools reference changed but ${FLOOR} did not. Raise minEngine to this PR's plugin version if skills now need the new tools, or add a line "engine-floor: unchanged <reason>" to the PR body.`);
  }
  return errors;
}

if (import.meta.main) {
  const base = process.argv[process.argv.indexOf("--base") + 1] ?? "HEAD^1";
  const diff = Bun.spawnSync(["git", "diff", "--name-only", base, "HEAD"]);
  const changed = diff.stdout.toString().split("\n").filter(Boolean);
  const floorRaw = (() => { try { return readFileSync(FLOOR, "utf8"); } catch { return null; } })();
  const floor = floorRaw ? ((JSON.parse(floorRaw) as { minEngine?: string }).minEngine ?? null) : null;
  const pluginVersion = (JSON.parse(readFileSync("plugins/mattstack/.claude-plugin/plugin.json", "utf8")) as { version: string }).version;
  const errors = checkEngineFloor({ changed, prBody: process.env.PR_BODY ?? "", floor, pluginVersion });
  for (const e of errors) console.error(`::error::${e}`);
  process.exit(errors.length ? 1 : 0);
}
```

(`scripts/` is outside the `no-raw-output` guard's directories; confirm by reading `lib/__tests__/no-raw-output.test.ts`'s scope before keeping `console.error`, and match `scripts/ci/plugin-version-bumped.ts`'s output style if it differs.)

`checks.yml`, in the `plugin-mattstack` job after the version-bump step:

```yaml
      - name: Engine floor
        if: github.event_name == 'pull_request'
        env:
          PR_BODY: ${{ github.event.pull_request.body }}
        run: bun scripts/ci/engine-floor-check.ts --base HEAD^1
```

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/engine-floor-check.ts scripts/__tests__/engine-floor-check.test.ts .github/workflows/checks.yml
git commit -m "ci: fail a tool-reference change that leaves the engine floor untouched"
```

---

### Task 12: Skills and docs

**Files:**
- Modify: `skills/rt-release/SKILL.md` (:12-16 intro; the "Plugin catalog" preflight row :222-228; "Audit the range for what set-up Macs miss" :272-290)
- Modify: `skills/mattstack-release/SKILL.md` (:314-316 "Mirror the workflow's env and order"), `skills/mattstack-release/reference.md` (:28-29)
- Modify: `plugins/mattstack/plugin/skills/editing-skills/SKILL.md` ("Bump version in the manifest" :299-306; "Push the default branch" :310-326; "What compile and check read" :536-545; sync text near :355 and :456)
- Modify: `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md` (compile outputs :343-351; "Publish" :372-378)
- Modify: `plugins/mattstack/plugin/skills/creating-a-pack/SKILL.md` (:352-358)
- Modify: `docs/release-and-distribution.md` (:12, :27-29, :43, :362-363)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (patch bump, unless Task 3's bump is still unreleased on this branch, in which case leave it)

**Interfaces:**
- Consumes: the field and step names from Tasks 2, 3, 10, 11 verbatim: `rt --version --json` `engine`, `pack/requires.json` `minEngine`, `Validate the marketplace catalog`, `Publish the marketplace catalog`, `engine-floor: unchanged`.
- Produces: no code.

- [ ] **Step 1: RED.** Load `superpowers:writing-skills` and `mattstack:editing-skills`. For each of the five skills, run one fresh-agent baseline scenario (sonnet, medium effort) against the current text and record the miss:
- `rt:release`: "where in release.yml is the marketplace published, and what stops a lower mattstack version going out?"
- `rt:mattstack-release`: "which `--define`s does the local compile mirror?"
- `editing-skills`: "I added `runId` to `mr_upload` and used it in stage-ship. What do I bump?"
- `extending-a-pack`: "which files does compile write into my pack?"
- `creating-a-pack`: "a member says the new pack version never arrived; what could it be?"

- [ ] **Step 2: Edit** each section named in Files with the new facts, in each skill's own voice:
- `rt:release`: the order is "validate the catalog first, publish it last, just before Create Release"; the preflight row adds "`env -i HOME=<temp> dist/rt --version --json` engine equals `plugins/mattstack/.claude-plugin/plugin.json`" and "the publish refuses a mattstack version below the published one"; the audit adds `lib/setup/pack-cache.ts` / `lib/setup/plugin-calls.ts` and "is a team pack held on this release's engine floor? It installs for members once they run this release".
- `rt:mattstack-release`: the compile mirrors `--define MATTSTACK_ENGINE` beside `RT_VERSION`, from `plugin.json`; `MARKETPLACE_TOKEN` is used only by the late publish, so a failed run publishes nothing.
- `editing-skills`: when an engine change's skill text uses a tool, argument or daemon verb older apps lack, raise `plugins/mattstack/pack/requires.json` `minEngine` to the version this change bumps to; otherwise write `engine-floor: unchanged <reason>` in the PR body when CI asks. Publishing: a team pack or the mattstack plugin above a member's app is held until they update, with the `pack.<name>` row saying so. Compile table: `pack/requires.json` is compile output. Sync: it refuses when this app can't run the engine on main, and reports a held pack.
- `extending-a-pack`: compile writes `pack/requires.json` (never hand-edited); a published change waits for members whose app is below its floor.
- `creating-a-pack`: members receive the pack through rt setup unless their app is below its floor, in which case the `pack.<name>` row tells them to update the app.
- `docs/release-and-distribution.md`: the catalog is validated first and published last; `MARKETPLACE_TOKEN` is only used by that late step.

- [ ] **Step 3: GREEN.** Re-run each scenario on a fresh agent with the edited text loaded (`claude --plugin-dir` for the plugin skills); each answer now names the new fact. Fix and re-run up to three rounds per skill.

- [ ] **Step 4: Checks.** `sh plugins/mattstack/tests/certify.sh plugins/mattstack/plugin/skills/editing-skills` (and the other two plugin skills); `bun cli.ts skills check --pack mattstack --strict`; `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack`.

- [ ] **Step 5: Commit**

```bash
git add skills/rt-release skills/mattstack-release plugins/mattstack/plugin/skills docs/release-and-distribution.md plugins/mattstack/.claude-plugin/plugin.json
git commit -m "skills: release and pack skills know the engine floor"
```

---

## After the last task

- Run the full targeted set touched across tasks, then `bun run typecheck` and `bun run check`.
- Push with `git_push` and open a PR to main (`gh pr create`). The engine-floor CI check passes on its own here because this PR adds the floor file. Purity must pass (`bash scripts/repo-purity.sh`, tree and PR body).
- Tell the release owner (`nestor` in rt chat) the field name `rt --version --json` → `engine` and the two new release steps.
