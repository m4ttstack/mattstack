# Per-Pack Binding Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every team pack that binds a repo gets its own merged bindings file (`~/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc`), so two packs on one repo never collide, and every reader (compile, composition, bind, the board, `resolve-args.sh`, the console) reads that per-pack file.

**Architecture:** The merge moves from `merge-manifests.sh` (jq) into TypeScript under `lib/skills/` as a pure layer merge (`manifest-merge.ts`) plus a filesystem-injected orchestrator (`materialize.ts`) that walks team zones, resolves an optional one-level `extends` base pack from the installed plugin cache, writes one file per repo and pack, and renames the old merged file to `.migrated`. `lib/setup/skills-materialize.ts` calls that instead of the script; the script becomes a thin `rt skills materialize --dir` wrapper. Compile-side readers find the pack file by path (no header grep), composition reports each slot's layer from the file's provenance header, the board picks a pack (tab, then `board.defaultPack`) and passes `MATTSTACK_PACK` into the launched pane, and `resolve-args.sh` reads the pack file when that variable is set.

**Tech Stack:** Bun + TypeScript (rt CLI and setup), POSIX sh (`resolve-args.sh`), React/Mantine (console), Bun/TS (board server). Tests: `bun test` (rt), vitest via turbo for board and console.

**Spec:** `docs/superpowers/specs/2026-09-30-per-pack-binding-scope-design.md`

## Global Constraints

- Public repo: fixtures, tests and docs use acme placeholders only (`widgets`, `gadgets`, `acme-base`, `gitlab.example.com`, `acme/widgets`). Never a real team, host or ticket id.
- No em dashes or en dashes anywhere (code, comments, docs, commit messages). Use `...`, parens, or rephrase.
- Comments state constraints the code cannot show; no narration, no decision history, no ticket or review references in source.
- `<pack>` in `repos/<slug>/packs/<pack>/` is the plugin's short name (`widgets`), the same value `--pack` takes.
- `extends` is one level: `"<plugin>@<marketplace>"`. A base pack that itself extends is an error.
- The old `repos/<slug>/skills.jsonc` is renamed to `skills.jsonc.migrated`, never deleted.
- Run `bun test` from the repo root only (bunfig preload). Board and console suites run through `bun run board:test` and `bun run console:test`.
- After any change under `packages/rt-client/src`, run `bun run build` in `packages/rt-client` (the dist-freshness test names this).
- Any change under `plugins/mattstack` needs a version bump in `plugins/mattstack/.claude-plugin/plugin.json` (one bump for the whole branch: `0.28.8` to `0.29.0`, done in Task 4; later tasks touching the plugin do not bump again).
- Editing `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md` (Task 13) requires loading `superpowers:writing-skills` and `mattstack:editing-skills` first.
- A UI change (Task 12, console) is not done until rendered in Fast Browser and screenshotted in both color schemes.
- Commit after every task with a short imperative message and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A user override that shadows a slot the pack just bound.** `rt skills bind` writes the fragment and regenerates; the regenerated file shows the override, not the fill. Expected: bind succeeds and prints which layer shadows it. Test pinned in Task 9.
2. **A zone whose `team.jsonc` declares no projects but holds the base pack.** Expected: the base pack is never a "two packs claim one repo" error, because a zone that declares nothing claims nothing. Test pinned in Task 3.
3. **A base pack that itself carries `extends`.** Expected: a per-pack error naming the base, never a silent second hop. Test pinned in Task 3.
4. **`MATTSTACK_PACK` set to a pack that has no file for this repo.** Expected: `resolve-args.sh` behaves as "no manifest" and its note names the path it looked for. Test pinned in Task 10.
5. **A tab whose `pack` names a pack with no `board:review` binding.** Expected: the launch falls back to the generic skill and the log line says `(config, pack widgets)`, never a crash. Test pinned in Task 11.

---

### Task 1: The pure layer merge and the manifest path helpers

**Files:**
- Create: `lib/skills/manifest-merge.ts`
- Create: `lib/skills/manifest-paths.ts`
- Test: `lib/skills/__tests__/manifest-merge.test.ts`
- Test: `lib/skills/__tests__/manifest-paths.test.ts`

**Interfaces:**
- Consumes: `stripJsonc` from `lib/skills/sources.ts`.
- Produces:
  ```ts
  // manifest-merge.ts
  export type Fragment = { extends?: string; skills?: { enabled?: string[] }; pipelines?: Record<string, string[]>; bindings?: Record<string, Record<string, string>> };
  export type Layer = { label: string; fragment: Fragment };   // label: "default" | "base:<pack>" | "pack" | "override"
  export type MergedManifest = { enabled: string[]; pipelines: Record<string, string[]>; bindings: Record<string, Record<string, string>>; provenance: Record<string, string> };
  export class FragmentError extends Error {}
  export function parseFragment(text: string, path: string): Fragment;      // throws FragmentError
  export function mergeLayers(layers: Layer[]): MergedManifest;
  export function renderManifest(merged: MergedManifest, opts: { repo: string; pack: string }): string;
  export function readManifestProvenance(text: string): Record<string, string>;
  // manifest-paths.ts
  export function packManifestPath(mattstackRoot: string, slug: string, pack: string): string;
  export function legacyManifestPath(mattstackRoot: string, slug: string): string;
  export function manifestRepoKey(manifestPath: string): string;
  export function manifestPack(manifestPath: string): string | null;
  ```
  Provenance keys are `"<engine ref> <slot>"` for bindings and `"pipeline <work type>"` for pipelines; values are layer labels.

- [ ] **Step 1: Write the failing merge tests**

```ts
// lib/skills/__tests__/manifest-merge.test.ts
import { describe, expect, test } from "bun:test";
import { FragmentError, mergeLayers, parseFragment, readManifestProvenance, renderManifest } from "../manifest-merge.ts";

const defaults = { label: "default", fragment: { bindings: { "mattstack:stage-gates": { domain: "mattstack:generic-gates" } }, pipelines: { feature: ["stage-plan", "stage-gates"] } } };
const base = { label: "base:acme-base", fragment: { skills: { enabled: ["acme-base:shared"] }, bindings: { "mattstack:stage-gates": { domain: "acme-base:gates" }, "mattstack:watch-ci": { forge: "mattstack:gitlab-forge" } } } };
const pack = { label: "pack", fragment: { skills: { enabled: ["widgets:work"] }, bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } };
const override = { label: "override", fragment: { bindings: { "mattstack:watch-ci": { forge: "me:forge" } } } };

describe("mergeLayers", () => {
  test("later layers win per slot and provenance names the winning layer", () => {
    const merged = mergeLayers([defaults, base, pack, override]);
    expect(merged.bindings["mattstack:stage-gates"]).toEqual({ domain: "widgets:gates" });
    expect(merged.bindings["mattstack:watch-ci"]).toEqual({ forge: "me:forge" });
    expect(merged.provenance["mattstack:stage-gates domain"]).toBe("pack");
    expect(merged.provenance["mattstack:watch-ci forge"]).toBe("override");
  });

  test("a slot only the base fills keeps the base label", () => {
    const merged = mergeLayers([defaults, base, pack]);
    expect(merged.bindings["mattstack:watch-ci"]).toEqual({ forge: "mattstack:gitlab-forge" });
    expect(merged.provenance["mattstack:watch-ci forge"]).toBe("base:acme-base");
  });

  test("pipelines replace per work type and are attributed", () => {
    const merged = mergeLayers([defaults, { label: "pack", fragment: { pipelines: { feature: ["stage-plan"] } } }]);
    expect(merged.pipelines.feature).toEqual(["stage-plan"]);
    expect(merged.provenance["pipeline feature"]).toBe("pack");
  });

  test("skills.enabled is a stable union", () => {
    const merged = mergeLayers([base, pack, { label: "override", fragment: { skills: { enabled: ["widgets:work"] } } }]);
    expect(merged.enabled).toEqual(["acme-base:shared", "widgets:work"]);
  });

  test("the same slot in two separate merges never interferes", () => {
    const a = mergeLayers([defaults, { label: "pack", fragment: { bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } }]);
    const b = mergeLayers([defaults, { label: "pack", fragment: { bindings: { "mattstack:stage-gates": { domain: "gadgets:gates" } } } }]);
    expect(a.bindings["mattstack:stage-gates"]!.domain).toBe("widgets:gates");
    expect(b.bindings["mattstack:stage-gates"]!.domain).toBe("gadgets:gates");
  });
});

describe("parseFragment", () => {
  test("strips full-line comments and returns the object", () => {
    expect(parseFragment('// note\n{ "bindings": { "a:b": { "s": "x:y" } } }', "/f.jsonc").bindings).toEqual({ "a:b": { s: "x:y" } });
  });
  test("throws FragmentError naming the path on invalid JSONC", () => {
    expect(() => parseFragment("{ nope", "/zone/packs/widgets/pack/skills.jsonc")).toThrow(FragmentError);
    expect(() => parseFragment("{ nope", "/zone/packs/widgets/pack/skills.jsonc")).toThrow(/widgets\/pack\/skills\.jsonc/);
  });
  test("throws FragmentError when the document is not an object", () => {
    expect(() => parseFragment("[]", "/f.jsonc")).toThrow(FragmentError);
  });
});

describe("renderManifest + readManifestProvenance", () => {
  test("round-trips the provenance header and emits version 1", () => {
    const merged = mergeLayers([defaults, base, pack]);
    const text = renderManifest(merged, { repo: "gitlab.example.com/acme/widgets", pack: "widgets" });
    expect(text).toContain("// repo: gitlab.example.com/acme/widgets");
    expect(text).toContain("// pack: widgets");
    expect(readManifestProvenance(text)).toEqual(merged.provenance);
    const body = JSON.parse(text.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n"));
    expect(body.version).toBe(1);
    expect(body.bindings["mattstack:stage-gates"].domain).toBe("widgets:gates");
    expect(body.skills.enabled).toEqual(["acme-base:shared", "widgets:work"]);
  });
  test("readManifestProvenance ignores non-provenance comment lines", () => {
    expect(readManifestProvenance("// GENERATED\n// repo: x\n//   a:b s <- pack\n{}")).toEqual({ "a:b s": "pack" });
  });
});
```

- [ ] **Step 2: Write the failing path tests**

```ts
// lib/skills/__tests__/manifest-paths.test.ts
import { describe, expect, test } from "bun:test";
import { legacyManifestPath, manifestPack, manifestRepoKey, packManifestPath } from "../manifest-paths.ts";

describe("manifest paths", () => {
  test("packManifestPath places the file under repos/<slug>/packs/<pack>", () => {
    expect(packManifestPath("/h/.mattstack", "gitlab.example.com-acme-widgets", "widgets"))
      .toBe("/h/.mattstack/repos/gitlab.example.com-acme-widgets/packs/widgets/skills.jsonc");
  });
  test("legacyManifestPath is the retired per-repo file", () => {
    expect(legacyManifestPath("/h/.mattstack", "s")).toBe("/h/.mattstack/repos/s/skills.jsonc");
  });
  test("manifestRepoKey reads the slug from both shapes", () => {
    expect(manifestRepoKey("/h/.mattstack/repos/slug-a/packs/widgets/skills.jsonc")).toBe("slug-a");
    expect(manifestRepoKey("/tmp/x/skills.jsonc")).toBe("x");
  });
  test("manifestPack is the pack dir for the per-pack shape and null otherwise", () => {
    expect(manifestPack("/h/.mattstack/repos/slug-a/packs/widgets/skills.jsonc")).toBe("widgets");
    expect(manifestPack("/tmp/x/skills.jsonc")).toBeNull();
  });
});
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `bun test lib/skills/__tests__/manifest-merge.test.ts lib/skills/__tests__/manifest-paths.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement manifest-merge.ts**

```ts
// lib/skills/manifest-merge.ts
import { stripJsonc } from "./sources.ts";

export type Fragment = {
  extends?: string;
  skills?: { enabled?: string[] };
  pipelines?: Record<string, string[]>;
  bindings?: Record<string, Record<string, string>>;
};

/** label is the layer's provenance name: "default", "base:<pack>", "pack" or "override". */
export type Layer = { label: string; fragment: Fragment };

export type MergedManifest = {
  enabled: string[];
  pipelines: Record<string, string[]>;
  bindings: Record<string, Record<string, string>>;
  provenance: Record<string, string>;
};

export class FragmentError extends Error {}

export function parseFragment(text: string, path: string): Fragment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(text));
  } catch {
    throw new FragmentError(`fragment is not valid JSONC: ${path}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FragmentError(`fragment is not a JSON object: ${path}`);
  }
  return parsed as Fragment;
}

export function mergeLayers(layers: Layer[]): MergedManifest {
  const out: MergedManifest = { enabled: [], pipelines: {}, bindings: {}, provenance: {} };
  for (const { label, fragment } of layers) {
    for (const name of fragment.skills?.enabled ?? []) {
      if (!out.enabled.includes(name)) out.enabled.push(name);
    }
    for (const [type, stages] of Object.entries(fragment.pipelines ?? {})) {
      out.pipelines[type] = [...stages];
      out.provenance[`pipeline ${type}`] = label;
    }
    for (const [engineRef, slots] of Object.entries(fragment.bindings ?? {})) {
      for (const [slot, fill] of Object.entries(slots)) {
        (out.bindings[engineRef] ??= {})[slot] = fill;
        out.provenance[`${engineRef} ${slot}`] = label;
      }
    }
  }
  return out;
}

const PROVENANCE_LINE = /^\/\/\s{3}(.+?) <- (\S+)\s*$/;

export function renderManifest(merged: MergedManifest, opts: { repo: string; pack: string }): string {
  const lines = [
    "// GENERATED by rt skills materialize -- do not hand-edit for keeps;",
    "// the next pack install or materialize run rewrites this file.",
    `// repo: ${opts.repo}`,
    `// pack: ${opts.pack}`,
    "// provenance (binding <- layer):",
    ...Object.entries(merged.provenance).map(([key, label]) => `//   ${key} <- ${label}`),
  ];
  const body = { version: 1, skills: { enabled: merged.enabled }, pipelines: merged.pipelines, bindings: merged.bindings };
  return `${lines.join("\n")}\n${JSON.stringify(body, null, 2)}\n`;
}

export function readManifestProvenance(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith("//")) break;
    const m = PROVENANCE_LINE.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}
```

- [ ] **Step 5: Implement manifest-paths.ts**

```ts
// lib/skills/manifest-paths.ts
import { basename, dirname, join } from "path";

export function packManifestPath(mattstackRoot: string, slug: string, pack: string): string {
  return join(mattstackRoot, "repos", slug, "packs", pack, "skills.jsonc");
}

export function legacyManifestPath(mattstackRoot: string, slug: string): string {
  return join(mattstackRoot, "repos", slug, "skills.jsonc");
}

function isPerPackShape(manifestPath: string): boolean {
  return basename(dirname(dirname(manifestPath))) === "packs";
}

/** The registry repo key `run-start --repo` expects: the repo dir's name, for both file shapes. */
export function manifestRepoKey(manifestPath: string): string {
  const dir = dirname(manifestPath);
  return isPerPackShape(manifestPath) ? basename(dirname(dirname(dir))) : basename(dir);
}

export function manifestPack(manifestPath: string): string | null {
  return isPerPackShape(manifestPath) ? basename(dirname(manifestPath)) : null;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test lib/skills/__tests__/manifest-merge.test.ts lib/skills/__tests__/manifest-paths.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add lib/skills/manifest-merge.ts lib/skills/manifest-paths.ts lib/skills/__tests__/manifest-merge.test.ts lib/skills/__tests__/manifest-paths.test.ts
git commit -m "skills: add the layer merge and per-pack manifest path helpers"
```

---

### Task 2: Installed-plugin lookup and zone reading from a given teams dir

**Files:**
- Create: `lib/skills/installed-plugins.ts`
- Modify: `lib/skills/init.ts:76-93` (`readZones` gains a teams-dir variant)
- Test: `lib/skills/__tests__/installed-plugins.test.ts`
- Test: `lib/skills/__tests__/init.test.ts` (one added case)

**Interfaces:**
- Produces:
  ```ts
  // installed-plugins.ts
  export type PluginFs = { exists(p: string): boolean; readDir(p: string): string[] };
  export function compareVersions(a: string, b: string): number;   // moved from lib/setup/skills-materialize.ts
  export function findInstalledPluginDir(fs: PluginFs, home: string, ref: string): string | null;  // ref "<plugin>@<marketplace>"
  export const ENGINE_PACK_REF = "mattstack@mattstack";
  // init.ts
  export function readZonesFrom(fs: InitFs, teamsDir: string): ZoneInfo[];   // readZones(fs, home) delegates to it
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/skills/__tests__/installed-plugins.test.ts
import { describe, expect, test } from "bun:test";
import { compareVersions, ENGINE_PACK_REF, findInstalledPluginDir } from "../installed-plugins.ts";

function fs(dirs: Record<string, string[]>) {
  return {
    exists: (p: string) => p in dirs || Object.keys(dirs).some((d) => d.startsWith(p + "/")),
    readDir: (p: string) => dirs[p] ?? [],
  };
}

describe("findInstalledPluginDir", () => {
  const cache = "/h/.claude/plugins/cache";
  test("picks the highest semver version dir of <marketplace>/<plugin>", () => {
    const f = fs({ [`${cache}/acme/acme-base`]: ["0.9.0", "0.10.1"], [`${cache}/acme/acme-base/0.9.0`]: [], [`${cache}/acme/acme-base/0.10.1`]: [] });
    expect(findInstalledPluginDir(f, "/h", "acme-base@acme")).toBe(`${cache}/acme/acme-base/0.10.1`);
  });
  test("null when the plugin is not in the cache", () => {
    expect(findInstalledPluginDir(fs({}), "/h", "acme-base@acme")).toBeNull();
  });
  test("refuses a ref without a marketplace", () => {
    expect(findInstalledPluginDir(fs({}), "/h", "acme-base")).toBeNull();
  });
  test("the engine pack ref is mattstack@mattstack", () => {
    expect(ENGINE_PACK_REF).toBe("mattstack@mattstack");
  });
});

describe("compareVersions", () => {
  test("dotted numeric compare, missing segments are 0", () => {
    expect(compareVersions("0.10.1", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});
```

Add to `lib/skills/__tests__/init.test.ts` (find the existing `readZones` describe and add):

```ts
test("readZonesFrom reads zones under an explicit teams dir", () => {
  const home = makeHome();                       // the file's existing tmp-home helper
  writeZone(home, "acme", { host: "gitlab.example.com", projects: ["acme/widgets"] });  // the file's existing zone helper
  const zones = readZonesFrom(realFs, join(home, ".mattstack", "teams"));
  expect(zones.map((z) => z.slug)).toEqual(["acme"]);
});
```

(Use whatever helpers `init.test.ts` already has for a fake home and zone; match its imports. If it has none, write the zone files inline: `mattstack/mattstack.jsonc` with `{"role":"team","namespace":"acme"}` and `mattstack/team.jsonc` with `{"gitlabHost":"https://gitlab.example.com","projects":["acme/widgets"]}`.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/skills/__tests__/installed-plugins.test.ts lib/skills/__tests__/init.test.ts`
Expected: FAIL (module not found; `readZonesFrom` not exported).

- [ ] **Step 3: Implement installed-plugins.ts**

```ts
// lib/skills/installed-plugins.ts
import { join } from "path";

export type PluginFs = { exists(p: string): boolean; readDir(p: string): string[] };

export const ENGINE_PACK_REF = "mattstack@mattstack";

const REF_RE = /^([a-z0-9][a-z0-9-]*)@([a-z0-9][a-z0-9-]*)$/i;

/** Dotted-numeric compare, missing segments treated as 0; version dirs here are plain "x.y.z". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Claude Code installs every plugin, dev marketplaces included, under ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/. */
export function findInstalledPluginDir(fs: PluginFs, home: string, ref: string): string | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const root = join(home, ".claude", "plugins", "cache", m[2]!, m[1]!);
  let best: string | null = null;
  for (const version of fs.readDir(root)) {
    if (!fs.exists(join(root, version))) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best === null ? null : join(root, best);
}
```

- [ ] **Step 4: Add readZonesFrom to init.ts**

Replace the body of `readZones` so it delegates:

```ts
export function readZones(fs: InitFs, home: string): ZoneInfo[] {
  return readZonesFrom(fs, join(home, ".mattstack", "teams"));
}

export function readZonesFrom(fs: InitFs, teams: string): ZoneInfo[] {
  const zones: ZoneInfo[] = [];
  for (const slug of fs.readDir(teams)) {
    // ... the existing loop body, unchanged, using `teams` for the join
  }
  return zones;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test lib/skills/__tests__/installed-plugins.test.ts lib/skills/__tests__/init.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/skills/installed-plugins.ts lib/skills/init.ts lib/skills/__tests__/installed-plugins.test.ts lib/skills/__tests__/init.test.ts
git commit -m "skills: installed-plugin cache lookup and readZonesFrom"
```

---

### Task 3: The per-repo materializer

**Files:**
- Create: `lib/skills/materialize.ts`
- Test: `lib/skills/__tests__/materialize.test.ts`

**Interfaces:**
- Consumes: Task 1 (`mergeLayers`, `renderManifest`, `parseFragment`, `FragmentError`, `packManifestPath`, `legacyManifestPath`), Task 2 (`findInstalledPluginDir`, `readZonesFrom`), `parseRemote` and `InitFs` from `lib/skills/init.ts`.
- Produces:
  ```ts
  export type MaterializeFs = InitFs & { rename(from: string, to: string): void };
  export type PackOutcome =
    | { pack: string; zone: string; ok: true; path: string; layers: string[] }
    | { pack: string; zone: string; ok: false; detail: string };
  export type MaterializeRepoOutcome =
    | { kind: "no-remote" }
    | { kind: "undeclared"; repo: string }
    | { kind: "written"; repo: string; slug: string; packs: PackOutcome[]; migrated: string | null };
  export type MaterializeDeps = { fs: MaterializeFs; mattstackRoot: string; claudeHome: string; enginePackDir: string; installedPluginDir?: (ref: string) => string | null };
  export function materializeRepo(deps: MaterializeDeps, remote: string | null): MaterializeRepoOutcome;
  ```
  `mattstackRoot` is `~/.mattstack` (zones under `<root>/teams`, files under `<root>/repos`, overrides at `<root>/user/skills/overrides.jsonc`); `claudeHome` is the HOME whose `.claude/plugins/cache` holds installed plugins. `installedPluginDir` defaults to `findInstalledPluginDir(fs, claudeHome, ref)`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/skills/__tests__/materialize.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { materializeRepo, type MaterializeFs } from "../materialize.ts";
import { readManifestProvenance } from "../manifest-merge.ts";

const realFs: MaterializeFs = {
  exists: existsSync,
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  writeFile: (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); },
  mkdirp: (p) => mkdirSync(p, { recursive: true }),
  readDir: (p) => (existsSync(p) ? readdirSync(p) : []),
  rename: renameSync,
};

const REMOTE = "git@gitlab.example.com:acme/widgets.git";
const SLUG = "gitlab.example.com-acme-widgets";

function write(p: string, text: string): void { realFs.writeFile(p, text); }

function makeWorld() {
  const home = mkdtempSync(join(tmpdir(), "rt-materialize-"));
  const root = join(home, ".mattstack");
  const engine = join(home, "engine");
  write(join(engine, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:stage-gates": { domain: "mattstack:generic-gates" } }, pipelines: { feature: ["stage-plan", "stage-gates"] } }));
  return { home, root, engine };
}

function zone(root: string, slug: string, opts: { projects: string[]; packs: Record<string, object> }): void {
  const dir = join(root, "teams", slug);
  write(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: slug }));
  write(join(dir, "mattstack", "team.jsonc"), JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: opts.projects }));
  for (const [name, fragment] of Object.entries(opts.packs)) {
    write(join(dir, "mattstack", "packs", name, "pack", "skills.jsonc"), JSON.stringify(fragment));
  }
}

function installBase(home: string, fragment: object): void {
  write(join(home, ".claude", "plugins", "cache", "acme", "acme-base", "1.0.0", "pack", "skills.jsonc"), JSON.stringify(fragment));
}

function body(path: string): { bindings: Record<string, Record<string, string>>; pipelines: Record<string, string[]>; skills: { enabled: string[] } } {
  return JSON.parse(readFileSync(path, "utf8").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n"));
}

describe("materializeRepo", () => {
  test("no remote -> no-remote", () => {
    const { root, engine, home } = makeWorld();
    expect(materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, null)).toEqual({ kind: "no-remote" });
  });

  test("no zone declares the repo -> undeclared", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/other"], packs: { widgets: {} } });
    expect(materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE)).toEqual({ kind: "undeclared", repo: "gitlab.example.com/acme/widgets" });
  });

  test("two zones on one repo each get their own pack file with their own stage-gates fill", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme-w", { projects: ["acme/widgets"], packs: { widgets: { bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } });
    zone(root, "acme-g", { projects: ["acme/widgets"], packs: { gadgets: { bindings: { "mattstack:stage-gates": { domain: "gadgets:gates" } } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    expect(out.kind).toBe("written");
    if (out.kind !== "written") return;
    expect(out.slug).toBe(SLUG);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["gadgets", true], ["widgets", true]]);
    expect(body(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc")).bindings["mattstack:stage-gates"]!.domain).toBe("widgets:gates");
    expect(body(join(root, "repos", SLUG, "packs", "gadgets", "skills.jsonc")).bindings["mattstack:stage-gates"]!.domain).toBe("gadgets:gates");
  });

  test("layers: defaults, then base, then pack, then overrides, with provenance per layer", () => {
    const { root, engine, home } = makeWorld();
    installBase(home, { bindings: { "mattstack:stage-gates": { domain: "acme-base:gates" }, "mattstack:watch-ci": { forge: "mattstack:gitlab-forge" }, "mattstack:stage-ship": { policy: "acme-base:squash" } } });
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: { extends: "acme-base@acme", bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } });
    write(join(root, "user", "skills", "overrides.jsonc"), JSON.stringify({ bindings: { "mattstack:watch-ci": { forge: "me:forge" } } }));
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    const pack = out.packs[0]!;
    if (!pack.ok) throw new Error(pack.detail);
    expect(pack.layers).toEqual(["default", "base:acme-base", "pack", "override"]);
    const text = readFileSync(pack.path, "utf8");
    expect(readManifestProvenance(text)).toMatchObject({
      "pipeline feature": "default",
      "mattstack:stage-gates domain": "pack",
      "mattstack:stage-ship policy": "base:acme-base",
      "mattstack:watch-ci forge": "override",
    });
  });

  test("a missing base is a per-pack error and other packs on the repo still write", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme-w", { projects: ["acme/widgets"], packs: { widgets: {} } });
    zone(root, "acme-g", { projects: ["acme/widgets"], packs: { gadgets: { extends: "acme-base@acme" } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    const gadgets = out.packs.find((p) => p.pack === "gadgets")!;
    expect(gadgets.ok).toBe(false);
    if (!gadgets.ok) expect(gadgets.detail).toBe("gadgets extends acme-base@acme, which is not installed; add it to the team's claude.plugins");
    expect(existsSync(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"))).toBe(true);
    expect(existsSync(join(root, "repos", SLUG, "packs", "gadgets", "skills.jsonc"))).toBe(false);
  });

  test("a base that itself extends is refused", () => {
    const { root, engine, home } = makeWorld();
    installBase(home, { extends: "deeper@acme" });
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: { extends: "acme-base@acme" } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false, detail: "widgets extends acme-base@acme, which extends deeper@acme; a base pack cannot extend another" });
  });

  test("two packs in one zone that claims the repo are both refused", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {}, gadgets: {} } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.every((p) => !p.ok)).toBe(true);
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain('zone "acme" holds 2 packs (gadgets, widgets) that all claim gitlab.example.com/acme/widgets');
  });

  test("a zone that declares no projects holds the base pack without claiming anything", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme-base-zone", { projects: [], packs: { "acme-base": {} } });
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {} } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => p.pack)).toEqual(["widgets"]);
  });

  test("an invalid pack fragment is a per-pack error naming the file", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: {} });
    write(join(root, "teams", "acme", "mattstack", "packs", "widgets", "pack", "skills.jsonc"), "{ nope");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false });
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain("widgets/pack/skills.jsonc");
  });

  test("the old merged file is renamed .migrated, never deleted", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {} } });
    write(join(root, "repos", SLUG, "skills.jsonc"), "{}");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.migrated).toBe(join(root, "repos", SLUG, "skills.jsonc.migrated"));
    expect(existsSync(join(root, "repos", SLUG, "skills.jsonc"))).toBe(false);
    expect(readFileSync(join(root, "repos", SLUG, "skills.jsonc.migrated"), "utf8")).toBe("{}");
  });

  test("the file is rewritten in place on a second run (no stray tmp file)", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {} } });
    const deps = { fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine };
    materializeRepo(deps, REMOTE);
    materializeRepo(deps, REMOTE);
    expect(readdirSync(join(root, "repos", SLUG, "packs", "widgets"))).toEqual(["skills.jsonc"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/skills/__tests__/materialize.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement materialize.ts**

```ts
// lib/skills/materialize.ts
import { dirname, join } from "path";
import { findInstalledPluginDir } from "./installed-plugins.ts";
import { parseRemote, readZonesFrom, type InitFs, type ZoneInfo } from "./init.ts";
import { FragmentError, mergeLayers, parseFragment, renderManifest, type Fragment, type Layer } from "./manifest-merge.ts";
import { legacyManifestPath, packManifestPath } from "./manifest-paths.ts";

export type MaterializeFs = InitFs & { rename(from: string, to: string): void };

export type PackOutcome =
  | { pack: string; zone: string; ok: true; path: string; layers: string[] }
  | { pack: string; zone: string; ok: false; detail: string };

export type MaterializeRepoOutcome =
  | { kind: "no-remote" }
  | { kind: "undeclared"; repo: string }
  | { kind: "written"; repo: string; slug: string; packs: PackOutcome[]; migrated: string | null };

export type MaterializeDeps = {
  fs: MaterializeFs;
  mattstackRoot: string;
  claudeHome: string;
  enginePackDir: string;
  installedPluginDir?: (ref: string) => string | null;
};

const EXTENDS_RE = /^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*$/i;

function readFragment(fs: MaterializeFs, path: string): Fragment | null {
  const text = fs.readFile(path);
  return text === null ? null : parseFragment(text, path);
}

function packsIn(fs: MaterializeFs, zone: ZoneInfo): string[] {
  const packsDir = join(zone.dir, "mattstack", "packs");
  return fs.readDir(packsDir).filter((name) => fs.exists(join(packsDir, name, "pack", "skills.jsonc"))).sort();
}

function baseLayer(deps: MaterializeDeps, pack: string, ref: string): Layer | { error: string } {
  if (!EXTENDS_RE.test(ref)) return { error: `${pack} extends "${ref}", which is not a <plugin>@<marketplace> reference` };
  const lookup = deps.installedPluginDir ?? ((r: string) => findInstalledPluginDir(deps.fs, deps.claudeHome, r));
  const dir = lookup(ref);
  if (!dir) return { error: `${pack} extends ${ref}, which is not installed; add it to the team's claude.plugins` };
  const fragmentPath = join(dir, "pack", "skills.jsonc");
  const fragment = readFragment(deps.fs, fragmentPath);
  if (!fragment) return { error: `${pack} extends ${ref}, but ${fragmentPath} is missing` };
  if (fragment.extends) return { error: `${pack} extends ${ref}, which extends ${fragment.extends}; a base pack cannot extend another` };
  return { label: `base:${ref.split("@")[0]}`, fragment };
}

function materializePack(deps: MaterializeDeps, zone: ZoneInfo, pack: string, repo: string, slug: string, defaults: Layer | null, override: Layer | null): PackOutcome {
  const fragmentPath = join(zone.dir, "mattstack", "packs", pack, "pack", "skills.jsonc");
  try {
    const own = readFragment(deps.fs, fragmentPath);
    if (!own) return { pack, zone: zone.slug, ok: false, detail: `${fragmentPath} is missing` };
    const layers: Layer[] = [];
    if (defaults) layers.push(defaults);
    if (own.extends !== undefined) {
      const base = baseLayer(deps, pack, own.extends);
      if ("error" in base) return { pack, zone: zone.slug, ok: false, detail: base.error };
      layers.push(base);
    }
    layers.push({ label: "pack", fragment: own });
    if (override) layers.push(override);

    const path = packManifestPath(deps.mattstackRoot, slug, pack);
    const text = renderManifest(mergeLayers(layers), { repo, pack });
    deps.fs.mkdirp(dirname(path));
    const tmp = `${path}.tmp`;
    deps.fs.writeFile(tmp, text);
    deps.fs.rename(tmp, path);
    return { pack, zone: zone.slug, ok: true, path, layers: layers.map((l) => l.label) };
  } catch (err) {
    if (err instanceof FragmentError) return { pack, zone: zone.slug, ok: false, detail: err.message };
    throw err;
  }
}

export function materializeRepo(deps: MaterializeDeps, remote: string | null): MaterializeRepoOutcome {
  const ref = remote ? parseRemote(remote) : null;
  if (!ref) return { kind: "no-remote" };
  const repo = `${ref.host}/${ref.path}`;

  const zones = readZonesFrom(deps.fs, join(deps.mattstackRoot, "teams"))
    .filter((z) => z.host === ref.host && z.projects.includes(ref.path));
  if (zones.length === 0) return { kind: "undeclared", repo };

  const enginePath = join(deps.enginePackDir, "pack", "skills.jsonc");
  const engineFragment = readFragment(deps.fs, enginePath);
  const defaults: Layer | null = engineFragment ? { label: "default", fragment: engineFragment } : null;
  const overridePath = join(deps.mattstackRoot, "user", "skills", "overrides.jsonc");
  const overrideFragment = readFragment(deps.fs, overridePath);
  const override: Layer | null = overrideFragment ? { label: "override", fragment: overrideFragment } : null;

  const packs: PackOutcome[] = [];
  for (const zone of zones) {
    const names = packsIn(deps.fs, zone);
    if (names.length > 1) {
      const detail = `zone "${zone.slug}" holds ${names.length} packs (${names.join(", ")}) that all claim ${repo}; a zone binds one pack per repo, so move the others to a zone that declares no projects`;
      for (const pack of names) packs.push({ pack, zone: zone.slug, ok: false, detail });
      continue;
    }
    for (const pack of names) packs.push(materializePack(deps, zone, pack, repo, ref.slug, defaults, override));
  }
  packs.sort((a, b) => a.pack.localeCompare(b.pack));

  let migrated: string | null = null;
  const legacy = legacyManifestPath(deps.mattstackRoot, ref.slug);
  if (deps.fs.exists(legacy)) {
    migrated = `${legacy}.migrated`;
    deps.fs.rename(legacy, migrated);
  }

  return { kind: "written", repo, slug: ref.slug, packs, migrated };
}
```

Note: `parseFragment` on the engine or override file throws `FragmentError` outside `materializePack`; wrap those two `readFragment` calls in a try that turns a `FragmentError` into a per-pack error for every pack (`detail: err.message`) rather than a throw. Add one test: an invalid `overrides.jsonc` fails every pack with the override path in `detail`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/skills/__tests__/materialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/materialize.ts lib/skills/__tests__/materialize.test.ts
git commit -m "skills: materialize one bindings file per repo and pack in TypeScript"
```

---

### Task 4: Setup and CLI switch to the TS merge; the shell script becomes a wrapper

**Files:**
- Modify: `lib/setup/skills-materialize.ts` (whole file)
- Modify: `lib/setup/__tests__/skills-materialize.test.ts` (whole file)
- Modify: `lib/setup/__tests__/steps-b.test.ts` (materialize cases; grep `MERGE_MANIFESTS_MISSING_CODE`, `merge-manifests`)
- Modify: `lib/setup/__tests__/steps-c.test.ts:13` (import rename)
- Modify: `lib/setup/__tests__/apply.test.ts` and `contract.test.ts` where they reference `merge-manifests` (grep)
- Modify: `commands/skills.ts:1456-1478` (`skillsMaterialize`: `--dir`)
- Modify: `commands/skills-init.ts:141-146` (row shape unchanged; verify it compiles)
- Modify: `lib/command-tree-def.ts:2313-2321` (description, `--dir`)
- Modify: `plugins/mattstack/attachments/parameterized-skills/scripts/merge-manifests.sh` (whole file)
- Delete: `plugins/mattstack/plugin/tests/test-merge-manifests.sh`
- Modify: `plugins/mattstack/README.md:405` (drop the deleted test line)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`0.28.8` to `0.29.0`)
- Modify: `website/docs/reference/skills/materialize.mdx` (regenerate with `bun run docs:gen`)

**Interfaces:**
- Consumes: Task 3 `materializeRepo`, Task 2 `findInstalledPluginDir`, `ENGINE_PACK_REF`.
- Produces:
  ```ts
  export const ENGINE_PACK_MISSING_CODE = "engine-pack-missing";
  export function findEnginePackDir(p: Pick<Probes, "readDir" | "exists" | "home" | "env">): string | null;  // RT_ENGINE_PACK_DIR env override, else the installed mattstack plugin
  export interface MaterializeRepoResult { name: string; path: string; ok: boolean; noManifest?: true; detail: string; packs?: PackOutcome[]; migrated?: string | null }
  export type MaterializeSkillsResult = { skipped: true; reason: string; repos: [] } | { skipped: false; repos: MaterializeRepoResult[] };
  export async function materializeSkills(p: Probes, opts: { repo?: string; dir?: string }): Promise<MaterializeSkillsResult>;
  ```

- [ ] **Step 1: Rewrite the setup materialize tests**

Replace `lib/setup/__tests__/skills-materialize.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { updateRepoIndex } from "../../repo-index.ts";
import { createRealProbes } from "../probes.ts";
import { ENGINE_PACK_MISSING_CODE, findEnginePackDir, materializeSkills } from "../skills-materialize.ts";
import { fakeProbes } from "./fakes.ts";

const CACHE = "/fake-home/.claude/plugins/cache/mattstack/mattstack";

describe("findEnginePackDir", () => {
  test("RT_ENGINE_PACK_DIR wins outright", () => {
    expect(findEnginePackDir(fakeProbes({ env: { RT_ENGINE_PACK_DIR: "/src/plugins/mattstack" } }))).toBe("/src/plugins/mattstack");
  });
  test("else the highest installed mattstack version", () => {
    const p = fakeProbes({ home: "/fake-home", dirs: { [CACHE]: ["0.28.0", "0.29.0"], [`${CACHE}/0.28.0`]: [], [`${CACHE}/0.29.0`]: [] } });
    expect(findEnginePackDir(p)).toBe(`${CACHE}/0.29.0`);
  });
  test("null when nothing is installed", () => {
    expect(findEnginePackDir(fakeProbes({ home: "/fake-home" }))).toBeNull();
  });
});

describe("materializeSkills", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-materialize-home-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(p: string, t: string): void { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, t); }

  function seedRepo(remote: string | null): { dir: string; name: string } {
    const dir = mkdtempSync(join(home, "repo-"));
    execFileSync("git", ["init", "-q", dir]);
    if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
    updateRepoIndex(basename(dir), dir);
    return { dir, name: basename(dir) };
  }

  function seedZone(): void {
    const zone = join(home, ".mattstack", "teams", "acme", "mattstack");
    write(join(zone, "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: "acme" }));
    write(join(zone, "team.jsonc"), JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/widgets"] }));
    write(join(zone, "packs", "widgets", "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } }));
  }

  function engine(): string {
    const dir = join(home, "engine");
    write(join(dir, "pack", "skills.jsonc"), "{}");
    return dir;
  }

  test("skips with the engine-pack code when the mattstack plugin is not installed", async () => {
    const result = await materializeSkills(createRealProbes(), {});
    expect(result.skipped).toBe(true);
    if (result.skipped) expect(result.reason).toStartWith(`${ENGINE_PACK_MISSING_CODE}:`);
  });

  test("writes the pack file for a registered repo a zone declares", async () => {
    const { name } = seedRepo("https://gitlab.example.com/acme/widgets.git");
    seedZone();
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    const row = result.repos.find((r) => r.name === name)!;
    expect(row.ok).toBe(true);
    expect(row.packs?.[0]).toMatchObject({ pack: "widgets", ok: true, path: join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc") });
    expect(row.detail).toBe("wrote 1 pack file: widgets");
  });

  test("a repo with no remote is noManifest, not a failure", async () => {
    seedRepo(null);
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]).toMatchObject({ ok: false, noManifest: true });
  });

  test("a repo no zone declares is noManifest with the repo named", async () => {
    seedRepo("https://gitlab.example.com/acme/other.git");
    seedZone();
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]).toMatchObject({ ok: false, noManifest: true, detail: "no team declares gitlab.example.com/acme/other" });
  });

  test("a failed pack marks the repo not ok and names the pack and fix", async () => {
    seedRepo("https://gitlab.example.com/acme/widgets.git");
    seedZone();
    write(join(home, ".mattstack", "teams", "acme", "mattstack", "packs", "widgets", "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base@acme" }));
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, {});
    if (result.skipped) throw new Error("skipped");
    expect(result.repos[0]!.ok).toBe(false);
    expect(result.repos[0]!.detail).toBe("widgets: widgets extends acme-base@acme, which is not installed; add it to the team's claude.plugins");
  });

  test("--dir materializes an unregistered checkout by path", async () => {
    const dir = mkdtempSync(join(home, "loose-"));
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://gitlab.example.com/acme/widgets.git"]);
    seedZone();
    const p = { ...createRealProbes(), env: { ...process.env, RT_ENGINE_PACK_DIR: engine() } };
    const result = await materializeSkills(p, { dir });
    if (result.skipped) throw new Error("skipped");
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]!.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/setup/__tests__/skills-materialize.test.ts`
Expected: FAIL (`findEnginePackDir` not exported, `ENGINE_PACK_MISSING_CODE` not exported).

- [ ] **Step 3: Rewrite lib/setup/skills-materialize.ts**

```ts
/**
 * Materializes every registered repo's per-pack bindings files through
 * lib/skills/materialize.ts. Idempotent and re-callable, and never throws
 * for the ordinary fresh-machine case: the apply engine's skills.materialize
 * step runs before plugins.install, so the mattstack plugin (the defaults
 * layer) is routinely absent the first time. That case comes back as
 * `{skipped: true, reason}`; callers rerun once the plugin is on disk.
 */

import { basename, join } from "path";
import { getKnownRepos, type KnownRepo } from "../repo-index.ts";
import { repoLabel } from "../repo-label.ts";
import { tryResolveRepoArg } from "../repo-arg.ts";
import { ENGINE_PACK_REF, findInstalledPluginDir } from "../skills/installed-plugins.ts";
import { materializeRepo, type PackOutcome } from "../skills/materialize.ts";
import { UserActionableError } from "./errors.ts";
import type { Probes } from "./probes.ts";

export const ENGINE_PACK_MISSING_CODE = "engine-pack-missing";

const GIT_TIMEOUT_MS = 10_000;

/** RT_ENGINE_PACK_DIR (a checkout's plugins/mattstack, for development) wins; else the installed mattstack plugin; null before plugins.install has run. */
export function findEnginePackDir(p: Pick<Probes, "readDir" | "exists" | "home" | "env">): string | null {
  const override = p.env.RT_ENGINE_PACK_DIR;
  if (override) return override;
  return findInstalledPluginDir(p, p.home, ENGINE_PACK_REF);
}

export interface MaterializeRepoResult {
  name: string;
  path: string;
  ok: boolean;
  /** Nothing to materialize for this repo (no remote, or no team declares it): not a merge error. */
  noManifest?: true;
  detail: string;
  packs?: PackOutcome[];
  migrated?: string | null;
}

export type MaterializeSkillsResult =
  | { skipped: true; reason: string; repos: [] }
  | { skipped: false; repos: MaterializeRepoResult[] };

function registeredKnownRepos(): Pick<KnownRepo, "repoName" | "worktrees">[] {
  return getKnownRepos().filter((r) => r.registered !== false);
}

async function originRemote(p: Probes, dir: string): Promise<string | null> {
  const origin = await p.exec(["git", "-C", dir, "remote", "get-url", "origin"], { timeoutMs: GIT_TIMEOUT_MS });
  if (origin.code === 0 && origin.stdout.trim()) return origin.stdout.trim();
  const remotes = await p.exec(["git", "-C", dir, "remote"], { timeoutMs: GIT_TIMEOUT_MS });
  const first = remotes.stdout.split("\n")[0]?.trim();
  if (!first) return null;
  const url = await p.exec(["git", "-C", dir, "remote", "get-url", first], { timeoutMs: GIT_TIMEOUT_MS });
  return url.code === 0 && url.stdout.trim() ? url.stdout.trim() : null;
}

async function resolveTargets(opts: { repo?: string; dir?: string }): Promise<{ name: string; path: string }[]> {
  if (opts.dir) return [{ name: basename(opts.dir), path: opts.dir }];
  const known = registeredKnownRepos();
  if (!opts.repo) return known.map((r) => ({ name: repoLabel(r.repoName), path: r.worktrees[0]!.path }));
  // Rows are keyed by serialized identity, so a typed name resolves to one
  // before matching. The raw-spelling fallback is for kind "none" ONLY: on an
  // ambiguous label a legacy row spelled that way would otherwise decide
  // which repo gets materialized.
  const resolution = await tryResolveRepoArg(opts.repo);
  if (resolution.kind === "ambiguous") {
    throw new UserActionableError("repo-ambiguous", `"${opts.repo}" matches more than one repo: ${resolution.matches.join(", ")}... pass the full identity`);
  }
  const match = resolution.kind === "resolved"
    ? known.find((r) => r.repoName === resolution.identity)
    : known.find((r) => r.repoName === opts.repo);
  if (!match) throw new UserActionableError("repo-not-registered", `"${opts.repo}" is not a registered repo (rt repos register first)`);
  return [{ name: repoLabel(match.repoName), path: match.worktrees[0]!.path }];
}

function describe(packs: PackOutcome[]): string {
  const failed = packs.filter((pk) => !pk.ok);
  if (failed.length > 0) return failed.map((pk) => (pk.ok ? "" : `${pk.pack}: ${pk.detail}`)).join("; ");
  return `wrote ${packs.length} pack file${packs.length === 1 ? "" : "s"}: ${packs.map((pk) => pk.pack).join(", ")}`;
}

export async function materializeSkills(p: Probes, opts: { repo?: string; dir?: string }): Promise<MaterializeSkillsResult> {
  const enginePackDir = findEnginePackDir(p);
  if (!enginePackDir) {
    return { skipped: true, reason: `${ENGINE_PACK_MISSING_CODE}: install the mattstack plugin first (plugins.install), then rerun`, repos: [] };
  }
  const deps = { fs: p, mattstackRoot: join(p.home, ".mattstack"), claudeHome: p.home, enginePackDir };
  const repos: MaterializeRepoResult[] = [];
  for (const target of await resolveTargets(opts)) {
    const outcome = materializeRepo(deps, await originRemote(p, target.path));
    if (outcome.kind === "no-remote") {
      repos.push({ ...target, ok: false, noManifest: true, detail: `no git remote in ${target.path}` });
    } else if (outcome.kind === "undeclared") {
      repos.push({ ...target, ok: false, noManifest: true, detail: `no team declares ${outcome.repo}` });
    } else {
      repos.push({ ...target, ok: outcome.packs.every((pk) => pk.ok), detail: describe(outcome.packs), packs: outcome.packs, migrated: outcome.migrated });
    }
  }
  return { skipped: false, repos };
}
```

`Probes` satisfies `MaterializeFs` structurally (`exists`, `readFile`, `writeFile`, `mkdirp`, `readDir`, `rename`). If the typecheck disagrees on `writeFile`'s optional `mode` or `mkdirp`'s optional `mode`, wrap: `fs: { exists: p.exists, readFile: p.readFile, readDir: p.readDir, writeFile: (a, b) => p.writeFile(a, b), mkdirp: (a) => p.mkdirp(a), rename: p.rename }`.

- [ ] **Step 4: Fix the other setup tests and callers**

- `lib/setup/__tests__/steps-c.test.ts:13`: import `ENGINE_PACK_MISSING_CODE` instead of `MERGE_MANIFESTS_MISSING_CODE`; update every use.
- `lib/setup/__tests__/steps-b.test.ts`: find the `skills.materialize` cases (grep `merge-manifests`, `RT_MERGE_MANIFESTS`, `bash`). Rewrite each to seed `RT_ENGINE_PACK_DIR` in the fake env pointing at a fake dir whose `pack/skills.jsonc` is `"{}"`, and to expect the step's detail (`materialized N, failed M` unchanged). A case that asserted the `bash <script> --repo` exec now asserts `calls.exec` contains a `git ... remote get-url origin` call instead.
- `grep -rn "merge-manifests\|MERGE_MANIFESTS" lib commands scripts --include='*.ts'` and fix every remaining reference (apply.test/contract.test mention only the step id, which is unchanged).
- `commands/skills-init.ts:141-146` compiles unchanged (row shape kept).

- [ ] **Step 5: `rt skills materialize --dir`**

In `commands/skills.ts` `skillsMaterialize`:

```ts
export async function skillsMaterialize(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const repo = skillsFlagValue(args, "--repo");
  const dir = skillsFlagValue(args, "--dir");

  try {
    const result = await materializeSkills(createRealProbes(), { repo, dir });
    if (json) {
      console.log(JSON.stringify(envelope(result)));
      return;
    }
    // A top-level skip (mattstack plugin not installed yet) is the normal
    // fresh-machine outcome, not a failure -- exit 0, never exit 2.
    if (result.skipped) {
      console.log(`skipped: ${result.reason}`);
      return;
    }
    for (const r of result.repos) {
      console.log(`${r.ok ? "materialized" : r.noManifest ? "no skills declared for" : "failed"} ${r.name}: ${r.detail}`);
      if (r.migrated) console.log(`  renamed the old merged file to ${r.migrated}`);
    }
    if (result.repos.some((r) => !r.ok && !r.noManifest)) process.exitCode = 1;
  } catch (err) {
    if (err instanceof UserActionableError) exitUserError(err, json, "skills materialize", console.log);
    throw err;
  }
}
```

In `lib/command-tree-def.ts` the `materialize` node:

```ts
materialize: {
  description: "Write each pack's bindings file for your registered repos",
  module: "./commands/skills.ts",
  fn: "skillsMaterialize",
  args: [
    { name: "Repo", flag: "--repo", type: "text", placeholder: "myrepo", hint: "Materialize only this registered repo; omit for every known repo" },
    { name: "Dir", flag: "--dir", type: "text", placeholder: "/path/to/checkout", hint: "Materialize the checkout at this path instead of a registered repo" },
    SETUP_JSON_ARG,
  ],
},
```

Then `bun run docs:gen` and commit the regenerated `website/docs/reference/skills/materialize.mdx`.

- [ ] **Step 6: The wrapper script, the deleted shell test, the plugin bump**

Replace `plugins/mattstack/attachments/parameterized-skills/scripts/merge-manifests.sh` with:

```bash
#!/usr/bin/env bash
# merge-manifests.sh [--repo <path>] -- writes the per-pack bindings files for
# one checkout. The merge itself lives in rt (rt skills materialize); this
# wrapper only keeps the old entry point alive.
set -euo pipefail
REPO=$PWD
if [ "${1:-}" = "--repo" ]; then REPO=$(cd "${2:?--repo needs a path}" && pwd); fi
command -v rt > /dev/null 2>&1 || { echo "merge-manifests: rt is not on PATH; install mattstack.app" >&2; exit 2; }
exec rt skills materialize --dir "$REPO"
```

`git rm plugins/mattstack/plugin/tests/test-merge-manifests.sh`. In `plugins/mattstack/README.md` remove the `plugin/tests/test-merge-manifests.sh  # manifest-merge matrix` line. Bump `plugins/mattstack/.claude-plugin/plugin.json` `version` to `0.29.0`.

- [ ] **Step 7: Run the suites**

Run: `bun test lib/setup lib/skills commands/__tests__/skills.test.ts && bun run typecheck`
Expected: PASS, typecheck clean. Also `sh plugins/mattstack/tests/certify.sh plugins/mattstack` if that is how the plugin job certifies (see `.github/workflows/checks.yml:265` for the exact invocation) and `rt skills check --strict` per AGENTS.md's plugin section; both must pass.

- [ ] **Step 8: Commit**

```bash
git add -A lib/setup lib/skills commands/skills.ts lib/command-tree-def.ts plugins/mattstack website/docs/reference/skills/materialize.mdx
git commit -m "skills: materialize runs the TypeScript merge; merge-manifests.sh is a wrapper"
```

---

### Task 5: `rt setup pack` reads the per-pack file

**Files:**
- Modify: `lib/setup/pack.ts` (whole file)
- Modify: `lib/setup/__tests__/pack.test.ts`

**Interfaces:**
- Consumes: Task 4 `materializeSkills` result rows (`packs?: PackOutcome[]`).
- Produces: `setupPackFlow` unchanged signature; `NO_MANIFEST_DETAIL` unchanged.

- [ ] **Step 1: Rewrite the pack tests' fixtures**

The manifest shape becomes the real one: `pipelines[workType]` is `string[]` and `bindings` is keyed `mattstack:<stage>` with slot objects. A stage is unresolved when its binding entry has an empty slot value. Materialize is driven through `RT_ENGINE_PACK_DIR` and a seeded zone exactly like Task 4's test (copy `seedZone`, `engine`, `write` helpers; register the repo with a real `git init` and an `acme/widgets` remote).

```ts
test("every stage's slots bound -> ok", async () => {
  seedRepoWithRemote(home, "https://gitlab.example.com/acme/widgets.git");
  seedZone(home, { pipelines: { feature: ["stage-plan", "stage-gates"] }, bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } });
  const p = fakeProbesOverReal(home);   // createRealProbes() with env RT_ENGINE_PACK_DIR = engine(home)
  const reqs: PackRequirements[] = [{ pack: "widgets", tools: [], integrations: [], workType: "feature" }];
  expect(await setupPackFlow(makeCtx(p, { reqs }))).toEqual({ ok: true, detail: `2 stage(s) resolved for "feature"` });
});

test("a stage with an empty slot value -> stage-unresolved", async () => {
  seedRepoWithRemote(home, "https://gitlab.example.com/acme/widgets.git");
  seedZone(home, { pipelines: { feature: ["stage-plan", "stage-gates"] }, bindings: { "mattstack:stage-gates": { domain: "" } } });
  const reqs: PackRequirements[] = [{ pack: "widgets", tools: [], integrations: [], workType: "feature" }];
  expect(await setupPackFlow(makeCtx(fakeProbesOverReal(home), { reqs }))).toEqual({ ok: false, stage: "stage-gates", detail: `stage "stage-gates" is unresolved` });
});

test("no pack file for the requirements' pack -> NO_MANIFEST_DETAIL", async () => {
  seedRepoWithRemote(home, "https://gitlab.example.com/acme/widgets.git");
  seedZone(home, {});                                     // pack "widgets"
  const reqs: PackRequirements[] = [{ pack: "gadgets", tools: [], integrations: [], workType: "feature" }];
  expect(await setupPackFlow(makeCtx(fakeProbesOverReal(home), { reqs }))).toEqual({ ok: false, detail: NO_MANIFEST_DETAIL });
});
```

Keep the file's existing `installPlugins` neutralisation (nonInteractive ctx) and its packError case.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/setup/__tests__/pack.test.ts`
Expected: FAIL (old path and shape).

- [ ] **Step 3: Rewrite pack.ts**

```ts
/**
 * `rt setup pack` -- installs a team pack's plugins, materializes skills, then
 * checks that the pack's declared work-type pipeline is usable: every stage it
 * names must have no empty slot in the pack's own bindings file.
 */

import { stripJsonc } from "../jsonc.ts";
import type { ApplyContext } from "./apply.ts";
import { installPlugins } from "./steps/plugins.ts";
import { materializeSkills } from "./skills-materialize.ts";

const DEFAULT_WORK_TYPE = "feature";

export const NO_MANIFEST_DETAIL = "no per-repo manifest yet";

interface PackManifest {
  pipelines?: Record<string, string[] | undefined>;
  bindings?: Record<string, Record<string, unknown> | undefined>;
}

/** A manifest that fails to parse reads as empty, the same "nothing declared yet" shape as a missing pipeline, never a crash. */
function parseManifest(text: string): PackManifest {
  try {
    const parsed: unknown = JSON.parse(stripJsonc(text));
    return typeof parsed === "object" && parsed !== null ? (parsed as PackManifest) : {};
  } catch {
    return {};
  }
}

function stageUnresolved(stage: string, bindings: PackManifest["bindings"]): boolean {
  const entry = bindings?.[`mattstack:${stage}`] ?? bindings?.[stage];
  if (!entry) return false;
  return Object.values(entry).some((v) => typeof v !== "string" || v.trim().length === 0);
}

export async function setupPackFlow(ctx: ApplyContext): Promise<{ ok: boolean; stage?: string; detail: string }> {
  const packError = ctx.reqs[0]?.error;
  if (packError) return { ok: false, detail: packError };

  const pluginsOutcome = await installPlugins(ctx);
  if (pluginsOutcome.state === "failed") return { ok: false, detail: pluginsOutcome.detail };

  const materialized = await materializeSkills(ctx.p, {});
  if (!materialized.skipped) {
    for (const r of materialized.repos) {
      if (!r.ok) ctx.log("plugins.install", `materialize ${r.name}: ${r.detail}`);
    }
  }

  const packName = ctx.reqs[0]?.pack;
  const written = materialized.skipped ? null : materialized.repos.flatMap((r) => r.packs ?? []).find((pk) => pk.ok && pk.pack === packName);
  const text = written && written.ok ? ctx.p.readFile(written.path) : null;
  if (text === null) return { ok: false, detail: NO_MANIFEST_DETAIL };

  const workType = ctx.reqs[0]?.workType ?? DEFAULT_WORK_TYPE;
  const manifest = parseManifest(text);
  const stages = manifest.pipelines?.[workType] ?? [];
  for (const stage of stages) {
    if (stageUnresolved(stage, manifest.bindings)) return { ok: false, stage, detail: `stage "${stage}" is unresolved` };
  }
  return { ok: true, detail: `${stages.length} stage(s) resolved for "${workType}"` };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/setup/__tests__/pack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/pack.ts lib/setup/__tests__/pack.test.ts
git commit -m "setup pack: read the pack's own bindings file in its real shape"
```

---

### Task 6: Compile and check find the pack file by path

**Files:**
- Modify: `commands/skills.ts:95-140` (`Flags` gains `repo`), `:377-417` (`findDefaultManifest`), `:478-527` (`resolve`: `repoKey`), `:925-935` (`compilePackAll` passes `--repo`), `:1080-1090` (`checkPack`), `:1486-1521` (`parseSurfaceFlags`/`SurfaceFlags` gain `repo`), `:1566-1590` (stage roster lookup), `:1630-1640` (`compileArgs`)
- Modify: `lib/command-tree-def.ts:2322-2360` (compile/check/composition/bind nodes: `--repo` arg, `--manifest` hint)
- Test: `commands/__tests__/skills.test.ts:546-640`

**Interfaces:**
- Consumes: Task 1 `packManifestPath`, `manifestRepoKey`; Task 2 `readZonesFrom`.
- Produces: `findDefaultManifest(mattstackRoot: string, team: string, packDir: string, repo: string | null): string`; every `rt skills compile|check|composition|bind` accepts `--repo <slug or host/path>`.

- [ ] **Step 1: Rewrite the default-lookup tests**

Replace the two tests at `commands/__tests__/skills.test.ts:546-590` and add cases. The `manifestJsonc` helper's header changes to the new generator lines (the header is no longer read, so any comment lines are fine; update it to `// GENERATED by rt skills materialize` and `// provenance (binding <- layer):` with `<- pack`).

```ts
test("default manifest lookup: the one repos/*/packs/<team>/skills.jsonc", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc"), manifestJsonc("t", true));
  await skillsCompile(["--team", "t", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]);
  expect(logs.some((l) => /would write \d+ files/.test(l))).toBe(true);
});

test("another pack's file on the same repo is never picked", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "other", "skills.jsonc"), manifestJsonc("other", true));
  const { exitCode, errors } = await runExpectingCleanExit(() =>
    skillsCompile(["--team", "t", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
  expect(exitCode).toBe(1);
  expect(errors[0]).toContain("no repos/*/packs/t/skills.jsonc");
});

test("two repos for one pack: --repo picks, and without it the zone's first project wins", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc"), manifestJsonc("t", true));
  writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-gadgets", "packs", "t", "skills.jsonc"), manifestJsonc("t", false));
  // no zone yet: ambiguous
  const first = await runExpectingCleanExit(() =>
    skillsCompile(["--team", "t", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
  expect(first.exitCode).toBe(1);
  expect(first.errors[0]).toContain("pass --repo");
  // --repo by slug and by host/path
  await skillsCompile(["--team", "t", "--dry-run", "--repo", "gitlab.example.com-acme-widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]);
  await skillsCompile(["--team", "t", "--dry-run", "--repo", "gitlab.example.com/acme/widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]);
  // a zone listing gadgets first resolves the tie
  const zone = join(mattstackDir, "teams", "acme", "mattstack");
  writeFile(join(zone, "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: "t" }));
  writeFile(join(zone, "team.jsonc"), JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/gadgets", "acme/widgets"] }));
  writeFile(join(zone, "packs", "t", "pack", "skills.jsonc"), "{}");
  await skillsCompile(["--team", "t", "--json", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]);
  const payload = JSON.parse(logs.at(-1)!);
  expect(payload.manifest ?? payload.manifestPath).toContain("gitlab.example.com-acme-gadgets");
});

test("--repo naming a repo with no file for this pack is a clean error", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  const { exitCode, errors } = await runExpectingCleanExit(() =>
    skillsCompile(["--team", "t", "--dry-run", "--repo", "nope", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
  expect(exitCode).toBe(1);
  expect(errors[0]).toContain('no t bindings file for repo "nope"');
});

test("repoKey is the repo slug for the per-pack shape", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  writeFile(join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc"), manifestJsonc("t", true));
  await skillsCompile(["--team", "t", "--json", "--dry-run", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]);
  const payload = JSON.parse(logs.at(-1)!);
  expect(payload.repoKey ?? payload.repo).toBe("gitlab.example.com-acme-widgets");
});
```

Check the compile `--json` payload field names in `skillsCompile` (grep `JSON.stringify` near the end of `skillsCompile`) and use the real ones in the last two assertions; if the payload carries neither the manifest path nor the repo key, add `manifestPath` and `repoKey` to it.

- [ ] **Step 2: Run to verify failure**

Run: `bun test commands/__tests__/skills.test.ts`
Expected: the new cases FAIL; the standalone-pack case still passes.

- [ ] **Step 3: Implement**

Add `repo: string | null` to `Flags`, `SurfaceFlags`, `BindFlags` and their parsers (`case "--repo": repo = args[++i] ?? null; break;`). Add `"--repo"` to `separateBindArgs`'s `valued` set. `compileArgs` forwards it; `compilePackAll` and `checkPack` accept `repo?: string` and push `--repo`.

Replace `findDefaultManifest`:

```ts
function repoSlugArg(repo: string): string {
  return repo.includes("/") ? `${repo.split("/")[0]!.toLowerCase()}-${repo.split("/").slice(1).join("-")}` : repo;
}

/**
 * A team pack is compiled against its own per-pack file for one repo: the
 * only one, `--repo`, or the first project its zone declares. A standalone
 * pack (the mattstack plugin) has no repo; its pack/skills.jsonc IS its
 * manifest.
 */
function findDefaultManifest(mattstackRoot: string, team: string, packDir: string, repo: string | null): string {
  const reposRoot = join(mattstackRoot, "repos");
  const candidates = listSubdirs(reposRoot)
    .map((slug) => ({ slug, path: packManifestPath(mattstackRoot, slug, team) }))
    .filter((c) => existsSync(c.path));

  if (repo) {
    const wanted = repoSlugArg(repo);
    const hit = candidates.find((c) => c.slug === wanted);
    if (hit) return hit.path;
    throw new SkillsUsageError(
      `no ${team} bindings file for repo "${repo}" under ${reposRoot} (have: ${candidates.map((c) => c.slug).join(", ") || "none"}); run rt skills materialize`,
    );
  }
  if (candidates.length === 1) return candidates[0]!.path;

  if (candidates.length > 1) {
    const zones = readZonesFrom(realInitFs, join(mattstackRoot, "teams"));
    const zone = zones.find((z) => existsSync(join(z.dir, "mattstack", "packs", team)));
    for (const project of zone?.projects ?? []) {
      const hit = candidates.find((c) => c.slug === `${zone!.host}-${project.replaceAll("/", "-")}`);
      if (hit) return hit.path;
    }
    throw new SkillsUsageError(
      `pack "${team}" binds ${candidates.length} repos (${candidates.map((c) => c.slug).join(", ")}); pass --repo <slug or host/path>`,
    );
  }

  const ownManifest = join(packDir, "pack", "skills.jsonc");
  // Team packs sit at <repo>/mattstack/packs/<team>; that path shape
  // survives worktrees, unlike the teams-zone location, and a team pack's
  // pack/skills.jsonc is a merge fragment, never its manifest.
  const parts = resolvePath(packDir).split(sep);
  const teamShaped = parts.at(-2) === "packs" && parts.at(-3) === "mattstack";
  const standalone = !isUnder(join(mattstackRoot, "teams"), packDir) && !teamShaped;
  if (standalone && existsSync(ownManifest)) return ownManifest;
  throw new SkillsUsageError(
    `no repos/*/packs/${team}/skills.jsonc under ${reposRoot}` +
      (standalone ? ` and ${ownManifest} is absent` : "") +
      `; run rt skills materialize, or pass --manifest explicitly`,
  );
}
```

`realInitFs` is a module-level `InitFs` over node `fs` (`exists: existsSync`, `readFile` returning null when absent, `readDir` returning `[]` when absent, `writeFile`, `mkdirp`); put it next to `listSubdirs`. Remove `leadingCommentBlock` if nothing else uses it (grep first).

In `resolve()`: `flags.manifest ?? findDefaultManifest(mattstackRoot, team, packDir, flags.repo)` and `const repoKey = manifestPath ? manifestRepoKey(manifestPath) : "";`. Update the stage-roster lookup at `:1566-1590` to pass `flags.repo`.

Command tree: on `compile`, `check`, `composition` and `bind` nodes add
```ts
{ name: "Repo", flag: "--repo", type: "text", placeholder: "gitlab.example.com/acme/widgets", hint: "Which repo's bindings file to read when this pack binds several; omit for the first repo the team declares" },
```
and change every `--manifest` hint to `"Manifest path; omit to read ~/.mattstack/repos/<repo>/packs/<pack>/skills.jsonc"`. Run `bun run docs:gen` and commit the regenerated reference pages.

- [ ] **Step 4: Run to verify pass**

Run: `bun test commands/__tests__/skills.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/picker-conformance.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills.test.ts lib/command-tree-def.ts website/docs/reference/skills
git commit -m "skills compile: read the pack's own bindings file, add --repo"
```

---

### Task 7: Composition reports each slot's layer

**Files:**
- Modify: `commands/skills.ts:1170-1185` (`CompositionSlot` gains `layer`), `:433-450` (`Resolved` gains `provenance`), `:478-527` (`resolve` reads it), `:1274-1311` (`buildCompositionVerb`), `:1440-1452` (text output)
- Test: `commands/__tests__/skills.test.ts` (composition cases: grep `skillsComposition`)

**Interfaces:**
- Consumes: Task 1 `readManifestProvenance`.
- Produces: `CompositionSlot.layer: string | null` on the `rt skills composition --json` wire (`"default" | "base:<pack>" | "pack" | "override" | null`).

- [ ] **Step 1: Write the failing test**

Next to the existing composition `--json` test:

```ts
test("composition reports each slot's layer from the file's provenance header", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  const manifestPath = join(mattstackDir, "repos", "gitlab.example.com-acme-widgets", "packs", "t", "skills.jsonc");
  writeFile(manifestPath, `// GENERATED by rt skills materialize
// provenance (binding <- layer):
//   mattstack:watch-ci domain <- pack
//   mattstack:watch-ci forge <- base:acme-base
{
  "bindings": {
    "mattstack:watch-ci": { "domain": "acme:watch-ci-domain", "forge": "mattstack:gitlab-forge" }
  }
}
`);
  await skillsComposition(["--team", "t", "--json", "--pack-dir", packDir, "--mattstack-dir", mattstackDir]);
  const payload = JSON.parse(logs.at(-1)!);
  const slots = payload.verbs.find((v: { name: string }) => v.name === "watch-ci").slots;
  expect(slots.find((s: { name: string }) => s.name === "domain").layer).toBe("pack");
  expect(slots.find((s: { name: string }) => s.name === "forge").layer).toBe("base:acme-base");
});

test("composition layer is null for a manifest with no provenance header", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  const manifestPath = makeManifest("t");  // the file's plain helper
  await skillsComposition(["--team", "t", "--json", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]);
  const payload = JSON.parse(logs.at(-1)!);
  expect(payload.verbs[0].slots[0].layer).toBeNull();
});
```

(The existing `manifestJsonc` helper's header uses `<- ${team}@${team}` style values; after Task 6 it says `<- pack`, so the second test uses a header-free manifest. If `makeManifest` writes a header, add a header-free variant.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test commands/__tests__/skills.test.ts -t "layer"`
Expected: FAIL (`layer` undefined).

- [ ] **Step 3: Implement**

- `CompositionSlot`: add `layer: string | null;` after `boundTo`.
- `Resolved`: add `provenance: Record<string, string>;`.
- `resolve()`: `const provenance = manifestPath ? readManifestProvenance(readFileSync(manifestPath, "utf8")) : {};` and return it.
- `buildCompositionVerb`: `const base = { name: slotName, contract: spec.contract, required: spec.required ?? false, boundTo, layer: boundTo ? resolved.provenance[\`${engineRef} ${slotName}\`] ?? null : null };` (compute `engineRef` before the slot map; it already exists below as `${step.plugin}:${verb.engine}`; hoist it).
- Text output: `console.log(\`    ${slot.name}: ${status}${slot.layer ? \` [${slot.layer}]\` : ""}\`);`
- Also anywhere else a `CompositionSlot` literal is built (grep `fillSourcePath: null, fillVersion: null`), add `layer: null`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test commands/__tests__/skills.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills.test.ts
git commit -m "skills composition: report each slot's layer"
```

---

### Task 8: `rt skills bind` writes the fragment and regenerates the pack file

**Files:**
- Modify: `commands/skills.ts:2200-2335` (`skillsBind` write path)
- Test: `commands/__tests__/skills.test.ts` (bind cases: grep `skillsBind`)

**Interfaces:**
- Consumes: Task 4 `materializeSkills`, Task 1 `manifestPack`, `readManifestProvenance`, `readManifestBindings`.
- Produces: same CLI. In fixture mode (`--mattstack-dir`) or for a standalone pack, bind writes the manifest directly as today; otherwise it writes the fragment and runs `materializeSkills`, then re-reads the pack file and warns when another layer shadows the new binding.

- [ ] **Step 1: Write the failing test**

The existing bind tests run in fixture mode (`--mattstack-dir`) and keep passing. Add one that exercises the real path through a fake HOME (the pattern of Task 4's setup test: `process.env.HOME` swapped to a tmp dir, a `git init` repo registered with `updateRepoIndex`, a zone seeded, `RT_ENGINE_PACK_DIR` set to a dir with an empty engine fragment). The pack dir is the zone's `mattstack/packs/widgets` (so bind's fragment write lands in the zone); write `pack/stubs.jsonc` there as `makePackDir` does, and point `--mattstack-dir` at nothing (real mode) but set `RT_ENGINE_PACK_DIR` to the fixture engine dir from `makeMattstackDir()` so plugin roots resolve... Real mode resolves plugin roots through `claude plugin list`, which the test cannot run. So test the seam, not the CLI: extract the write-and-regenerate step into an exported function and test that:

```ts
// in commands/skills.ts
export async function applyBind(opts: {
  manifestPath: string; packDir: string; engineRef: string; slotName: string; fill: string;
  fixtureMode: boolean; materialize: () => Promise<void>;
}): Promise<{ fragmentUpdated: string | null; shadowedBy: string | null }>
```

Test:

```ts
describe("applyBind", () => {
  test("team pack: writes the fragment, regenerates, and reports a shadowing override", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
    const packDir = join(root, "teams", "acme", "mattstack", "packs", "widgets");
    writeFile(join(packDir, "pack", "skills.jsonc"), `{\n  "bindings": {}\n}\n`);
    const manifestPath = join(root, "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
    writeFile(manifestPath, "{}");
    let regenerated = 0;
    const result = await applyBind({
      manifestPath, packDir, engineRef: "mattstack:watch-ci", slotName: "domain", fill: "widgets:ci", fixtureMode: false,
      materialize: async () => {
        regenerated++;
        writeFile(manifestPath, `//   mattstack:watch-ci domain <- override\n{ "bindings": { "mattstack:watch-ci": { "domain": "me:ci" } } }`);
      },
    });
    expect(regenerated).toBe(1);
    expect(result.fragmentUpdated).toBe(join(packDir, "pack", "skills.jsonc"));
    expect(JSON.parse(readFileSync(join(packDir, "pack", "skills.jsonc"), "utf8")).bindings["mattstack:watch-ci"].domain).toBe("widgets:ci");
    expect(result.shadowedBy).toBe("override");
  });

  test("fixture mode: writes the manifest directly and never regenerates", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
    const packDir = join(root, "pack");
    const manifestPath = join(root, "skills.jsonc");
    writeFile(manifestPath, `{ "bindings": {} }`);
    const result = await applyBind({ manifestPath, packDir, engineRef: "mattstack:watch-ci", slotName: "domain", fill: "widgets:ci", fixtureMode: true, materialize: async () => { throw new Error("must not run"); } });
    expect(result).toEqual({ fragmentUpdated: null, shadowedBy: null });
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).bindings["mattstack:watch-ci"].domain).toBe("widgets:ci");
  });

  test("standalone pack (fragment is the manifest): one write, no regenerate", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-")));
    const packDir = join(root, "mattstack");
    const manifestPath = join(packDir, "pack", "skills.jsonc");
    writeFile(manifestPath, `{ "bindings": {} }`);
    const result = await applyBind({ manifestPath, packDir, engineRef: "mattstack:shepherdr", slotName: "tiering", fill: "mattstack:model-tiering", fixtureMode: false, materialize: async () => { throw new Error("must not run"); } });
    expect(result).toEqual({ fragmentUpdated: null, shadowedBy: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test commands/__tests__/skills.test.ts -t applyBind`
Expected: FAIL (`applyBind` not exported).

- [ ] **Step 3: Implement**

```ts
export async function applyBind(opts: {
  manifestPath: string; packDir: string; engineRef: string; slotName: string; fill: string;
  fixtureMode: boolean; materialize: () => Promise<void>;
}): Promise<{ fragmentUpdated: string | null; shadowedBy: string | null }> {
  const path = ["bindings", opts.engineRef, opts.slotName];
  const edit = (text: string) => applyEdits(text, modify(text, path, opts.fill, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));

  const fragmentPath = join(opts.packDir, "pack", "skills.jsonc");
  const fragmentIsManifest = existsSync(fragmentPath) && realpathSync(fragmentPath) === realpathSync(opts.manifestPath);
  if (opts.fixtureMode || fragmentIsManifest || !existsSync(fragmentPath)) {
    writeFileSync(opts.manifestPath, edit(readFileSync(opts.manifestPath, "utf8")));
    return { fragmentUpdated: null, shadowedBy: null };
  }

  const fragmentReal = realpathSync(fragmentPath);
  const packDirReal = realpathSync(opts.packDir);
  if (fragmentReal !== packDirReal && !fragmentReal.startsWith(packDirReal + sep)) {
    throw new SkillsUsageError(`${fragmentPath} resolves outside the pack; refusing to write it`);
  }
  writeFileSync(fragmentPath, edit(readFileSync(fragmentPath, "utf8")));
  await opts.materialize();

  const text = readFileSync(opts.manifestPath, "utf8");
  const now = readManifestBindings(opts.manifestPath)[opts.engineRef]?.[opts.slotName];
  const shadowedBy = now === opts.fill ? null : (readManifestProvenance(text)[`${opts.engineRef} ${opts.slotName}`] ?? "another layer");
  return { fragmentUpdated: fragmentPath, shadowedBy };
}
```

In `skillsBind`, replace the block from `// Both edits are computed before either write lands` through `writeFileSync(resolved.manifestPath, manifestAfter);` with:

```ts
const { fragmentUpdated, shadowedBy } = await applyBind({
  manifestPath: resolved.manifestPath, packDir: resolved.packDir, engineRef, slotName, fill,
  fixtureMode: bindFlags.mattstackDir !== null,
  materialize: async () => { await materializeSkills(createRealProbes(), {}); },
});
if (shadowedBy) console.error(`rt skills bind: ${engineRef}.${slotName} is bound to ${fill} in the fragment, but the ${shadowedBy} layer still wins in ${resolved.manifestPath}`);
```

and use `fragmentUpdated` where `fragmentWrite?.path` was used (JSON `fragmentUpdated`, the text summary). Add `shadowedBy` to the JSON envelope. Remove the now-unused `fragmentWrite` variable and imports if any become unused.

- [ ] **Step 4: Run to verify pass**

Run: `bun test commands/__tests__/skills.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills.test.ts
git commit -m "skills bind: write the fragment and regenerate the pack file"
```

---

### Task 9: End-to-end: two packs on one repo compile different fills

**Files:**
- Test: `commands/__tests__/skills.test.ts` (one new test)

**Interfaces:**
- Consumes: Task 3 `materializeRepo`, Task 6 compile lookup.

- [ ] **Step 1: Write the test**

```ts
test("two packs bound to one repo compile different domain fills with no merge error", async () => {
  const mattstackDir = makeMattstackDir();
  // A second fill provider so gadgets can bind something widgets does not.
  writeFile(join(mattstackDir, "plugins", "gadgets", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.1.0" }));
  writeFile(join(mattstackDir, "plugins", "gadgets", "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD.replace("name: watch-ci-domain", "name: watch-ci-domain"));
  const zone = (slug: string, pack: string, domain: string) => {
    const dir = join(mattstackDir, "teams", slug, "mattstack");
    writeFile(join(dir, "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: pack }));
    writeFile(join(dir, "team.jsonc"), JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/widgets"] }));
    writeFile(join(dir, "packs", pack, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:watch-ci": { domain, forge: "mattstack:gitlab-forge" } } }));
    writeFile(join(dir, "packs", pack, "pack", "stubs.jsonc"), STUBS_JSONC);
    return join(dir, "packs", pack);
  };
  const widgetsDir = zone("acme-w", "widgets", "acme:watch-ci-domain");
  const gadgetsDir = zone("acme-g", "gadgets", "gadgets:watch-ci-domain");
  const engine = join(mattstackDir, "plugins", "mattstack");
  const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, claudeHome: mattstackDir, enginePackDir: engine }, "https://gitlab.example.com/acme/widgets.git");
  if (out.kind !== "written") throw new Error(out.kind);
  expect(out.packs.every((p) => p.ok)).toBe(true);

  await skillsCompile(["--team", "widgets", "--json", "--dry-run", "--pack-dir", widgetsDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]);
  const widgets = JSON.parse(logs.at(-1)!);
  await skillsCompile(["--team", "gadgets", "--json", "--dry-run", "--pack-dir", gadgetsDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]);
  const gadgets = JSON.parse(logs.at(-1)!);
  expect(widgets.errors ?? []).toEqual([]);
  expect(gadgets.errors ?? []).toEqual([]);
  const body = (payload: { files: { path: string; content?: string }[] }) => payload.files.find((f) => f.path.endsWith("SKILL.md"))!.content!;
  expect(body(widgets)).toContain("acme:watch-ci-domain");
  expect(body(gadgets)).toContain("gadgets:watch-ci-domain");
});
```

`realInitFsForTests` is a small `MaterializeFs` over node `fs` (copy the `realFs` object from Task 3's test into this file). The dry-run `--json` payload's shape (whether `files[].content` is present) must be checked against `skillsCompile`; if dry-run JSON lists only paths, compile for real into the pack dirs and read the written `skills/watch-ci/SKILL.md` instead. `DOMAIN_SKILL_MD` for the gadgets copy must keep `provides: watch-ci-domain@1` and be reachable as `gadgets:watch-ci-domain` (plugin dir name `gadgets`).

- [ ] **Step 2: Run to verify pass**

Run: `bun test commands/__tests__/skills.test.ts -t "two packs bound"`
Expected: PASS. (If it fails, the failure is the finding; fix the seam it names in the task that owns it, never by loosening the test.)

- [ ] **Step 3: Commit**

```bash
git add commands/__tests__/skills.test.ts
git commit -m "skills: e2e, two packs on one repo compile their own fills"
```

---

### Task 10: `resolve-args.sh` reads the pack file under `MATTSTACK_PACK`

**Files:**
- Modify: `plugins/mattstack/attachments/parameterized-skills/scripts/resolve-args.sh:5-13` (header), `:115-137` (manifest lookup), `:141` (`MANIFEST_NOTE`)
- Modify: `plugins/mattstack/plugin/tests/test-resolve-args.sh` (two cases)
- Modify: `plugins/mattstack/attachments/parameterized-skills/references/convention.md:347-374` ("Manifest layers")
- Regenerate: `apps/board/skills-src/*/scripts/resolve-args.sh` via `apps/board/scripts/sync-resolvers.sh`, then `apps/board/skills/` via `bun run skills:expand:board`

**Interfaces:**
- Produces: with `MATTSTACK_PACK=<pack>` set and no `--manifest`, the resolver reads `$HOME/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc`; the old `repos/<slug>/skills.jsonc` is never read.

- [ ] **Step 1: Add the failing shell cases**

Append before the summary in `test-resolve-args.sh`:

```sh
# --- case: pack-file -- MATTSTACK_PACK selects repos/<slug>/packs/<pack>/skills.jsonc ---
PACK_HOME="$WORK/pack-home"
PACK_REPO="$WORK/pack-repo"
mkdir -p "$PACK_HOME/.mattstack/repos/gitlab.example.com-acme-widgets/packs/widgets" "$PACK_REPO"
cp "$FIX/manifests/bound.jsonc" "$PACK_HOME/.mattstack/repos/gitlab.example.com-acme-widgets/packs/widgets/skills.jsonc"
git init -q "$PACK_REPO" && git -C "$PACK_REPO" remote add origin "https://gitlab.example.com/acme/widgets.git"
OUT=$(cd "$PACK_REPO" && HOME="$PACK_HOME" MATTSTACK_PACK=widgets "$RESOLVE" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check pack_file 0 '.ok == true and .resolved.tiering.binding == "fake:tiering-good"'

# --- case: pack-file-missing -- MATTSTACK_PACK names a pack with no file here ---
OUT=$(cd "$PACK_REPO" && HOME="$PACK_HOME" MATTSTACK_PACK=gadgets "$RESOLVE" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check pack_file_missing 1 '.ok == false and .errors[0].code == "unbound" and (.errors[0].message | contains("packs/gadgets/skills.jsonc"))'

# --- case: no-pack -- the old repos/<slug>/skills.jsonc is never read ---
cp "$FIX/manifests/bound.jsonc" "$PACK_HOME/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
OUT=$(cd "$PACK_REPO" && HOME="$PACK_HOME" "$RESOLVE" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check no_pack 1 '.ok == false and .errors[0].code == "unbound" and (.errors[0].message | contains("MATTSTACK_PACK"))'
```

- [ ] **Step 2: Run to verify failure**

Run: `sh plugins/mattstack/plugin/tests/test-resolve-args.sh`
Expected: `pack_file` FAILs (the resolver still reads the old path; with no old file it reports unbound without the pack path).

- [ ] **Step 3: Implement**

Replace the per-repo block in `resolve-args.sh`:

```sh
  if [ -z "$MANIFEST" ]; then
    # Per-repo, per-pack manifest, keyed by the normalized origin remote and
    # the pack the launcher named. Known limitation: an explicit port
    # (ssh://host:2222/path) stays in the slug; writer and readers agree.
    REPO_REMOTE=$(git remote get-url origin 2> /dev/null || true)
    if [ -n "$REPO_REMOTE" ] && [ -n "${MATTSTACK_PACK:-}" ]; then
      u=${REPO_REMOTE%.git}
      u=${u#ssh://}; u=${u#https://}; u=${u#http://}; u=${u#git://}
      u=${u#*@}
      u=$(printf %s "$u" | sed 's|:|/|')
      _host=${u%%/*}; _path=${u#*/}
      REPO_SLUG="$(printf %s "$_host" | tr 'A-Z' 'a-z')-$(printf %s "$_path" | tr '/' '-')"
      PACK_MANIFEST="$HOME/.mattstack/repos/$REPO_SLUG/packs/$MATTSTACK_PACK/skills.jsonc"
      if [ -f "$PACK_MANIFEST" ]; then
        MANIFEST="$PACK_MANIFEST"
      else
        PACK_MANIFEST_MISSING="$PACK_MANIFEST"
      fi
    fi
  fi
```

Initialise `PACK_MANIFEST_MISSING=""` next to `MANIFEST=""`. Change `MANIFEST_NOTE`:

```sh
if [ -n "$PACK_MANIFEST_MISSING" ]; then
  MANIFEST_NOTE="no manifest: MATTSTACK_PACK=$MATTSTACK_PACK but $PACK_MANIFEST_MISSING does not exist (run rt skills materialize)"
else
  MANIFEST_NOTE="no manifest: not in an upward .mattstack/skills.jsonc from $PWD (stopping before \$HOME), MATTSTACK_PACK unset so no \$HOME/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc was read, not in \$HOME/.mattstack/skills.jsonc"
fi
```

Update the header comment's `--manifest` default line to: `default: nearest .mattstack/skills.jsonc walking up from PWD, then $HOME/.mattstack/repos/<slug>/packs/$MATTSTACK_PACK/skills.jsonc when MATTSTACK_PACK is set, then $HOME/.mattstack/skills.jsonc`.

Rewrite convention.md's "Manifest layers" section:

```markdown
## Manifest layers

`resolve-args.sh` discovers a bindings manifest in this order: (1) a
**committed in-repo file**, the nearest `.mattstack/skills.jsonc` walking up
from `$PWD`, stopping before `$HOME`; (2) the **generated per-pack file**,
`$HOME/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc`, read only when the
launcher set `MATTSTACK_PACK=<pack>` (`<slug>` is the git remote normalized:
protocol, credentials and `.git` stripped, host lowercased, `/` to `-`, e.g.
`gitlab.example.com-acme-widgets`); (3) the **personal global file**,
`~/.mattstack/skills.jsonc`; (4) **none**: empty bindings, and required
slots fail as unbound.

`rt skills materialize` writes layer (2), one file per repo and pack, at pack
install time and on demand (`merge-manifests.sh [--repo <path>]` is a thin
wrapper over it). Each file is four layers, later winning per slot:
mattstack's own `pack/skills.jsonc` (defaults), the base pack the fragment's
`extends` names (one level, installed through the team's `claude.plugins`),
the pack's own `pack/skills.jsonc`, then
`~/.mattstack/user/skills/overrides.jsonc`. Two packs never conflict: each
gets its own file. Two packs in one team zone that both claim a repo is a
per-pack error, and a base pack belongs in a zone that declares no
projects. The file's header names the layer each binding came from
(`default`, `base:<pack>`, `pack`, `override`). Fragments and overrides are
JSONC with full-line `//` comments only.
```

Then `sh apps/board/scripts/sync-resolvers.sh && bun run skills:expand:board`.

- [ ] **Step 4: Run to verify pass**

Run: `sh plugins/mattstack/plugin/tests/test-resolve-args.sh && bun run board:test -- skills-resolve && bun test scripts/__tests__/no-plugin-ci-jobs.test.ts`
Expected: all cases `ok`; board parity test green.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack apps/board/skills-src apps/board/skills
git commit -m "resolve-args: read the per-pack bindings file under MATTSTACK_PACK"
```

---

### Task 11: The board picks a pack and passes `MATTSTACK_PACK`

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts:466-490` (add `board.defaultPack`; `board.tabs` description mentions `pack?`)
- Modify: `packages/rt-client/src/settings/__tests__/registry.test.ts:320-340` (key list)
- Modify: `apps/board/src/config.ts:95-112` (`TabConfig.pack?`), `:138-182` (`BoardConfig.defaultPack`), `:336-370` (`parseConfig`), `:425-455` (`parseTabs`), `:735-760` (`loadConfig` store read)
- Modify: `apps/board/src/client/board/config-shapes.ts:115-140` (`isTabLike` accepts `pack`)
- Modify: `apps/board/src/client/board/ConfigModal.tsx:905-935` (a `pack` field beside `review skill`)
- Modify: `apps/board/src/manifest-bindings.ts` (whole file)
- Modify: `apps/board/src/data.ts:613-625` (`reviewSkillForTab` passes the tab id through)
- Modify: `apps/board/src/server.ts:637-651` (`resolveLaunchSkill` takes a pack), `:1585-1595`, `:1657-1667`, `:3456-3460` and the respond/doctor launch sites (grep `launchRespond(`, `launchDoctor(`) to pass `pack`
- Modify: `apps/board/src/herdr.ts:334-395` (`LaunchPaneOpts.pack?`), `:449-570` (`launchReview/Respond/Doctor` pass `env`)
- Modify: `apps/board/src/agent-launch.ts:21-50` (`env?` option onto the payload)
- Test: `apps/board/src/__tests__/manifest-bindings.test.ts`, `apps/board/src/__tests__/config.test.ts`, the herdr launch tests (grep `launchReview` under `apps/board/src/__tests__`)

**Interfaces:**
- Produces:
  ```ts
  // manifest-bindings.ts
  export interface ResolvedBoardSkill { skill: string; source: 'manifest' | 'config'; pack: string | null }
  export function packForLaunch(cfg: BoardConfig, tabId: string | undefined): string | null;  // tab.pack, else cfg.defaultPack || null
  export function resolveBoardSkill(kind: BoardSkillKind, project: string, cfg: BoardConfig, pack: string | null, mattstackHome?: string): ResolvedBoardSkill;
  export function resolveLaunchSkill(kind: BoardSkillKind, mrUrl: string, cfg: BoardConfig, pack: string | null, mattstackHome?: string): string;
  // herdr.ts
  LaunchPaneOpts.pack?: string   // forwarded as env MATTSTACK_PACK
  // agent-launch.ts
  startAgentPane(opts: { ...; env?: Record<string, string> })
  ```
  Registry: `board.defaultPack` (`string`, scopes `["user"]`, merge `replace`). `board.tabs` items may carry `pack?: string`.

- [ ] **Step 1: Registry key**

Add after `board.defaultMember`:

```ts
{
  key: "board.defaultPack",
  type: "string",
  scopes: ["user"],
  merge: "replace",
  description: "The team pack this developer's board launches review, respond and doctor with when a tab names none; setup seeds it with the first pack of the team you joined.",
},
```

Update `board.tabs`'s description to `({id, label, source, slackChannel?, reviewSkill?, pack?})` and add `pack` to the sentence: "`pack` picks which team pack's bindings a launch from that tab uses". Add `"board.defaultPack"` to the key list in `registry.test.ts` right after `"board.defaultMember"`. Run `bun test packages/rt-client` then `bun run build` in `packages/rt-client`.

- [ ] **Step 2: Failing board tests**

`config.test.ts`: add

```ts
test('tabs accept an optional pack and refuse a non-string one', () => {
  const cfg = parseConfig(JSON.stringify({ ...base, tabs: [{ id: 'w', label: 'W', source: { kind: 'authors' }, pack: 'widgets' }] }));
  expect(cfg.tabs[0]!.pack).toBe('widgets');
  expect(() => parseConfig(JSON.stringify({ ...base, tabs: [{ id: 'w', label: 'W', source: { kind: 'authors' }, pack: 3 }] }))).toThrow(/"w.pack" must be a string/);
});

test('defaultPack defaults to "" and reads board.defaultPack from the store', () => {
  expect(parseConfig(JSON.stringify(base)).defaultPack).toBe('');
  // follow the file's existing store-latch pattern for defaultMember (config-store-latch.test.ts) to assert the store read; add the same one-line case there for board.defaultPack -> 'widgets'.
});
```

`manifest-bindings.test.ts`: change `makeHome` to write `repos/<slug>/packs/<pack>/skills.jsonc` (add a `pack` parameter) and rewrite the cases:

```ts
test('tab pack -> that pack file', () => {
  const home = makeHome('gitlab.com-org-repo', 'widgets', JSON.stringify({ bindings: { 'board:review': { review: 'widgets:review' } } }));
  expect(resolveBoardSkill('review', 'org/repo', cfg, 'widgets', home)).toEqual({ skill: 'widgets:review', source: 'manifest', pack: 'widgets' });
});
test('no pack -> config fallback, pack null', () => {
  const home = makeHome('gitlab.com-org-repo', 'widgets', JSON.stringify({ bindings: { 'board:review': { review: 'widgets:review' } } }));
  expect(resolveBoardSkill('review', 'org/repo', cfg, null, home)).toEqual({ skill: '', source: 'config', pack: null });
});
test('a pack with no board:review binding -> config fallback, pack kept', () => {
  const home = makeHome('gitlab.com-org-repo', 'widgets', JSON.stringify({ bindings: {} }));
  expect(resolveBoardSkill('review', 'org/repo', cfg, 'widgets', home)).toEqual({ skill: '', source: 'config', pack: 'widgets' });
});
test('the old repos/<slug>/skills.jsonc is never read', () => {
  const home = mkdtempSync(join(tmpdir(), 'mb-'));
  mkdirSync(join(home, 'repos', 'gitlab.com-org-repo'), { recursive: true });
  writeFileSync(join(home, 'repos', 'gitlab.com-org-repo', 'skills.jsonc'), JSON.stringify({ bindings: { 'board:review': { review: 'old:review' } } }));
  expect(resolveBoardSkill('review', 'org/repo', cfg, 'widgets', home).skill).toBe('');
});
test('packForLaunch: tab pack, then defaultPack, then null', () => {
  const withTabs = parseConfig(JSON.stringify({ ...base, defaultPack: 'gadgets', tabs: [{ id: 'w', label: 'W', source: { kind: 'authors' }, pack: 'widgets' }, { id: 'g', label: 'G', source: { kind: 'authors' } }] }));
  expect(packForLaunch(withTabs, 'w')).toBe('widgets');
  expect(packForLaunch(withTabs, 'g')).toBe('gadgets');
  expect(packForLaunch(parseConfig(JSON.stringify(base)), undefined)).toBeNull();
});
```

Keep the doctor config-fallback and malformed-file cases, adapted to the new signature. `resolveLaunchSkill` tests: the log line reads `review skill: widgets:review (manifest, pack widgets)` or `review skill:  (config, no pack)`.

Herdr launch test (find the existing `launchReview` test with a fake `AgentIo`): assert `agentStart` received `env: { MATTSTACK_PACK: 'widgets' }` when `pack: 'widgets'` is passed, and no `env` key when it is absent.

- [ ] **Step 3: Run to verify failure**

Run: `bun run board:test`
Expected: the new cases FAIL.

- [ ] **Step 4: Implement**

`config.ts`: `TabConfig` gains `/** Which team pack's bindings a launch from this tab uses; empty/absent = board.defaultPack. */ pack?: string;`. `parseTabs` validates `t.pack` as an optional string (error text `${source} "${label}.pack" must be a string`) and copies it. `BoardConfig` gains `/** Pack for launches whose tab names none. Empty = mattstack's generic skills. */ defaultPack: string;`; `parseConfig` sets `defaultPack: cfg.defaultPack ?? ''` (validate string like `doctorSkill`); `loadConfig` reads `defaultPack: storeValue('board.defaultPack', resolve) ?? fileConfig.defaultPack`. `config-shapes.ts` `isTabLike`: `if (v.pack !== undefined && typeof v.pack !== 'string') return false;`. `ConfigModal.tsx`: a `pack` `TextField` after `review skill` with placeholder `inherits board.defaultPack`, aria-label `pack for tab ${tab.id}`, `patch(tab.id, t => ({ ...t, pack: optional(text) }))`.

`manifest-bindings.ts`:

```ts
export interface ResolvedBoardSkill { skill: string; source: 'manifest' | 'config'; pack: string | null }

export function packForLaunch(cfg: BoardConfig, tabId: string | undefined): string | null {
  const tab = tabId ? cfg.tabs.find(t => t.id === tabId) : undefined;
  return tab?.pack || cfg.defaultPack || null;
}

export function resolveBoardSkill(kind, project, cfg, pack: string | null, mattstackHome?): ResolvedBoardSkill {
  const fallback: ResolvedBoardSkill = { skill: configSkillFor(kind, cfg), source: 'config', pack };
  if (!pack) return fallback;
  const home = mattstackHome ?? join(homedir(), '.mattstack');
  const manifestPath = join(home, 'repos', boardRepoSlug(cfg.gitlabHost, project), 'packs', pack, 'skills.jsonc');
  // ... the existing read/parse/shape checks, returning fallback on each miss ...
  return { skill, source: 'manifest', pack };
}

export function resolveLaunchSkill(kind, mrUrl, cfg, pack: string | null, mattstackHome?): string {
  const project = projectPathFromWebUrl(mrUrl, cfg.gitlabHost);
  const resolved = project ? resolveBoardSkill(kind, project, cfg, pack, mattstackHome) : { skill: configSkillFor(kind, cfg), source: 'config' as const, pack };
  console.log(`${kind} skill: ${resolved.skill} (${resolved.source}, ${resolved.pack ? `pack ${resolved.pack}` : 'no pack'})`);
  return resolved.skill;
}
```

`data.ts` `reviewSkillForTab(config, tabId, mrUrl, fallback: (kind: 'review', mrUrl: string, tabId: string | undefined) => string)` passes `tabId` to the fallback. `server.ts` `resolveLaunchSkill(kind, mrUrl, tabId?)` becomes `resolveLaunchSkillFor(kind, mrUrl, tabId)` which computes `packForLaunch(config, tabId)` and calls the module function; each launch site passes `pack: packForLaunch(config, tabId)` into `launchReview/launchRespond/launchDoctor`. Respond and doctor launches have no tab today; pass `packForLaunch(config, undefined)`.

`herdr.ts`: `LaunchPaneOpts.pack?: string` (doc: `/** Team pack the launched wrapper resolves bindings with; rides the pane as MATTSTACK_PACK. */`); each `startAgentPane(...)` call adds `...(opts.pack ? { env: { MATTSTACK_PACK: opts.pack } } : {})`. `agent-launch.ts`: `env?: Record<string, string>` on opts, spread into the payload as `...(opts.env !== undefined ? { env: opts.env } : {})`.

- [ ] **Step 5: Run to verify pass**

Run: `bun run board:test && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client/src/settings apps/board/src
git commit -m "board: pick a pack per launch and pass MATTSTACK_PACK"
```

---

### Task 12: Setup seeds `board.defaultPack`; console shows layers and the real key

**Files:**
- Modify: `lib/setup/steps/skills.ts:214-250` (`boardKeysRun`)
- Test: `lib/setup/__tests__/steps-b.test.ts:945-1135` (`board.keys` cases)
- Modify: `apps/console/src/server/skills.ts:40-75` (`SkillsCompositionVerb.slots[].layer?`)
- Modify: `apps/console/src/app/wiring/outline.ts:40-75`, `:410-440` (`SlotOutlineNode.layer`)
- Modify: `apps/console/src/app/wiring/SlotRow.tsx:104-150` (layer badge)
- Modify: `apps/console/src/app/wiring/Rebind.tsx:205-212` (`bindingsKey` uses the engine ref)
- Test: `apps/console/src/app/wiring/outline.test.ts`, `Rebind.test.tsx`, `WiringMap.test.tsx` (grep `bindings.` captions)

**Interfaces:**
- Consumes: Task 7 `layer` on the composition wire; Task 11 `board.defaultPack`.
- Produces: `SlotOutlineNode.layer: string | null`; Rebind caption `writes bindings["<engineRef>"].<slot> in <path>, then recompiles <verb>`.

- [ ] **Step 1: Failing setup test**

In `steps-b.test.ts`'s `board.keys` describe, following the `chat.humanHandle` cases' setup:

```ts
test("seeds board.defaultPack with the team's first pack", async () => {
  // seed teams/<slug>/mattstack/packs/{gadgets,widgets}/.claude-plugin/plugin.json in the fake probes' files, ctx.team.slug = that slug
  const outcome = await boardKeysStep.run(ctx);
  expect(detailOf(outcome)).toContain("board.defaultPack");
  expect(getSetting("board.defaultPack").value).toBe("gadgets");
});
test("leaves board.defaultPack alone when set", async () => {
  setSetting("board.defaultPack", "widgets", "user");
  const outcome = await boardKeysStep.run(ctx);
  expect(detailOf(outcome)).not.toContain("board.defaultPack");
  expect(getSetting("board.defaultPack").value).toBe("widgets");
});
test("logs and leaves board.defaultPack unset when the team has no packs", async () => { /* ctx.team.slug with an empty packs dir; expect ctx.log line "board.defaultPack: the team has no packs, left unset" */ });
```

- [ ] **Step 2: Implement the seed**

In `skills.ts`:

```ts
/** The alphabetically first plugin dir under the team's mattstack/packs; the pack `rt setup` installs first is the one a fresh board should launch with. */
function firstTeamPack(ctx: ApplyContext): string | null {
  if (!ctx.team.slug) return null;
  const packs = join(ctx.p.home, ".mattstack", "teams", ctx.team.slug, "mattstack", "packs");
  return ctx.p.readDir(packs).filter((name) => ctx.p.exists(join(packs, name, ".claude-plugin", "plugin.json"))).sort()[0] ?? null;
}
```

and in `boardKeysRun` before `await seedOwnHandle(ctx, written);`:

```ts
if (writable(ctx, "board.defaultPack") && unwritten("board.defaultPack")) {
  const pack = firstTeamPack(ctx);
  if (pack) {
    setSetting("board.defaultPack", pack, "user");
    written.push("board.defaultPack");
  } else {
    ctx.log("board.keys", "board.defaultPack: the team has no packs, left unset");
  }
}
```

Run: `bun test lib/setup/__tests__/steps-b.test.ts` → PASS. Commit: `git commit -am "setup: board.keys seeds board.defaultPack"`.

- [ ] **Step 3: Failing console tests**

`outline.test.ts`: a composition fixture slot with `layer: 'base:acme-base'` produces a `SlotOutlineNode` with `layer: 'base:acme-base'`; a fixture without the field produces `layer: null`. `Rebind.test.tsx`: the caption for verb `work` slot `gates` with `engineRef: 'mattstack:stage-gates'` reads `writes bindings["mattstack:stage-gates"].gates in /x/skills.jsonc, then recompiles work`. A `SlotRow` render test (in the file that renders slot rows, `WiringMap.test.tsx` or a new `SlotRow.test.tsx`): a slot with `layer: 'override'` shows the text `override`; a slot with `layer: null` shows no layer badge.

- [ ] **Step 4: Implement the console changes**

- `server/skills.ts`: on the slot type add `/** Which layer of the pack's bindings file set this slot: "default", "base:<pack>", "pack" or "override". Optional because an rt older than the field answers without it. */ layer?: string | null;`.
- `outline.ts`: `SlotOutlineNode.layer: string | null` (doc: `/** Null for a binder-only slot or an rt that predates the field. */`), populated from `slot.layer ?? null` at the verb slot site (`:419`) and `null` at the binder sites (`:435`, `:541`).
- `SlotRow.tsx`: after the fill link, `{slot.layer && <QuietBadge>{slot.layer}</QuietBadge>}`.
- `Rebind.tsx`: `const bindingsKey = selfRef ? \`bindings["${selfRef}"].${slot}\` : \`bindings.${verb}.${slot}\`;`.

Run: `bun run console:test` → PASS.

- [ ] **Step 5: Render it**

Start the console from this tree (`deck list` gives the localhost URL for a served console; if the served one is the shared checkout, run this tree's console dev server per `apps/console/README.md` and use its port). Open the wiring page for a pack whose file has provenance (materialize the acme fixture zone from Task 3 under a scratch HOME if no real pack is bound on this machine). Screenshot a slot row with a layer badge and the Rebind sheet caption in light and dark schemes through Fast Browser. Say plainly in the task report what looks wrong, if anything; a badge that crowds the fill link or a caption that wraps badly is a finding to fix before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src
git commit -m "console wiring: show each slot's layer and the real bindings key"
```

---

### Task 13: Docs and skill text

**Files:**
- Modify: `plugins/mattstack/docs/your-first-pack.md:120-155`
- Modify: `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md:210-215`, `:284-292`, `:307-312`
- Modify: `plugins/mattstack/README.md:120-130`, `:375-385`
- Modify: `docs/settings-architecture.md` (the merge-manifests retirement note; grep `merge-manifests`)
- Modify: `plugins/mattstack/plugin/schemas/skills-manifest.schema.json` (`extends`)
- Modify: `skills/rt-settings/SKILL.md` (grep `merge-manifests`; only if it states the mechanics)
- Modify: `website/docs/reference/skills/index.mdx` (regenerated by `docs:gen` if generated; else the one sentence naming merge-manifests)

**Interfaces:** none; text only.

- [ ] **Step 1: Schema**

Add to `properties` in `skills-manifest.schema.json`:

```json
"extends": {
  "type": "string",
  "pattern": "^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*$",
  "description": "Fragment only: the base pack whose fragment layers under this one, as <plugin>@<marketplace>. One level; a base pack cannot extend. Never present in a generated file."
}
```

- [ ] **Step 2: Skill and doc text**

Load `superpowers:writing-skills` and `mattstack:editing-skills` before touching `extending-a-pack/SKILL.md`. In each named file, replace every statement of the old mechanics with the new ones, in the file's own voice:

- the generated file is `~/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc`, one per repo and pack; `rt skills materialize` writes it; `merge-manifests.sh` is a wrapper over that verb;
- a pack may declare `"extends": "<plugin>@<marketplace>"` in `pack/skills.jsonc`; the base is installed through the team's `claude.plugins`; its fills are overridden slot by slot, never an error;
- `rt skills bind` writes the fragment and regenerates the pack file; a user override that still wins is reported, not silently lost;
- two packs on one repo never conflict; two packs in one zone that both claim a repo is refused, and a base pack belongs in a zone that declares no projects;
- the board launches with the tab's `pack`, else `board.defaultPack`, and the launched skill sees `MATTSTACK_PACK`.

Keep each edit to the sentences that were wrong. Do not add sections.

- [ ] **Step 3: Verify**

Run: `rt skills check --strict` (the plugin gate per AGENTS.md), `bun run docs:gen`, then `git status` shows only the intended files.

- [ ] **Step 4: Commit**

```bash
git add plugins/mattstack docs/settings-architecture.md skills website/docs
git commit -m "docs: per-pack bindings files, extends, and the materialize verb"
```

---

### Task 14: Whole-branch verification

**Files:** none new.

- [ ] **Step 1: The three rt suites and the gates**

Run from the repo root: `bun run test:all && bun run check`. Then `bun run board:test && bun run console:test`. Then `sh plugins/mattstack/plugin/tests/test-resolve-args.sh`. Then the plugin job's own gates as `.github/workflows/checks.yml` names them (certify, `rt skills check --strict`, the mcp-tools reference diff; the last is unchanged, so the diff must be empty).
Expected: all green. Paste the summary lines (test counts, exit codes) in the task report; a red suite is reported as red with its output, never rerun into green without a fix.

- [ ] **Step 2: A real materialize on this machine, read-only first**

`rt skills materialize --json` against the real HOME writes real files under `~/.mattstack/repos/*/packs/` and renames the real `skills.jsonc` to `.migrated`. Before running it: `ls ~/.mattstack/repos/*/skills.jsonc` and note them. Run it, then `rt skills composition --pack <the local team pack> --json | head -c 600` shows `layer` values, and `git -C ~/.mattstack/teams/<team> status` shows no change (materialize never writes into a team zone). Report what was written and renamed.

- [ ] **Step 3: Push and open the PR**

Push `per-pack-binding-scope-impl` and open a PR against `main` titled `skills: per-pack binding scope for shared repos`, body per the repo's PR template if present, else the What/Verification shape, ending with the attribution line. Wait for CodeRabbit and CI per the operator's standing rule before merging.
