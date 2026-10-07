# Console wiring for the org base pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The console's Wiring page tells an org base pack apart from an installed plugin and from the team pack, shows base fill text and history, counts base drift on Health, and locks emitted base attachments on Surface, from origin fields rt now sends.

**Architecture:** rt tags every fill, slot, binder slot and anatomy source that comes from an org base (by plugin name, or by an emitted folder's `compiled.json`) with `origin: "base"`, `base` and `baseVersion`, adds `extends` to composition and `base` to surface rows, and refuses a public flip of a base row. The console reads those fields through one helper, `ownerOf`, and every view words a base from it.

**Tech Stack:** rt: Bun + TypeScript, `bun test` (run from the repo root). Console: React + Mantine (`@mattstack/app-kit`), Hono server, Vitest (`bun run test` in `apps/console`).

**Spec:** `docs/superpowers/specs/2026-10-07-console-org-wiring-design.md`

## Global Constraints

- Payload changes are additions only; no key renamed or removed. The one value change: `rt skills surface list` reports a base row's `status` as `internal`.
- The `org` version token stays exactly as it is in `PluginRoots.byName[<base>].version` and in compiled part headers.
- Do not edit `lib/skills/compile.ts` or `lib/skills/base-attachments.ts` (another lane owns them); importing from them is fine. If a change there looks necessary, stop and report it.
- Committed text, fixtures and tests use placeholder names only: org `acme`, base `acme-base`, team pack `widgets` (rt tests) or `acme` (console design fixture), hosts `gitlab.example.com`. Never the live org's names.
- No em dashes or en dashes anywhere, code comments included.
- Comments only state a constraint the code cannot show.
- Every print in rt goes through `lib/ui/out.ts`; a policy refusal is a `refused` note via `SkillsRefusal`, never a failure.
- Console UI follows `apps/AGENTS.md` and `docs/apps/ui-authoring.md`: Mantine kit components first, colour by role tokens, no raw colour values.
- Run rt tests from the repo root: `bun test <file>`. Run console tests from `apps/console`: `bun run test -- <file>` (Vitest).
- Commit after every task; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A pack with no base at all (the mattstack plugin itself, a Just Me pack): every new field absent, `extends: null`, no new UI, and every existing test still green.
2. An older rt that sends none of the new fields: the console reads a base fill as a plugin, exactly as today, with no crash (every new field optional).
3. A `compiled.json` that is a hand-authored data file or malformed: the folder is not tagged base (`isEmittedAttachmentDir` already decides shape); its surface row stays `compiled`.
4. A base with no `plugin.json` or no `version`: `baseVersion: null`, and the console prints the base name with no version and never the word `org`.
5. A grouped emitted unit (`attachments/group/leaf/`): the link badge still matches by `attachments/<rel>/` prefix, and the surface leaf row is tagged.

Each line has its test in the owning task (Tasks 1, 5, 2, 1+6, 4+8).

---

### Task 1: rt origin helpers

**Files:**
- Create: `lib/skills/origin.ts`
- Modify: `lib/skills/sources.ts:41-46` (PluginRoots type), `lib/skills/sources.ts:271-282` (`orgBasePackRoots`)
- Modify: `commands/skills.ts:631` (base root registration)
- Test: `lib/skills/__tests__/sources.test.ts:633-653`, create `lib/skills/__tests__/origin.test.ts`

**Interfaces:**
- Produces:
  - `PluginRoots.byName[name]` is `{ dir: string; version: string; baseVersion?: string | null }`.
  - `orgBasePackRoots(orgRoot): { name: string; dir: string; version: string; baseVersion: string | null }[]`
  - `type Origin = { origin: "base"; base: string; baseVersion: string | null }`
  - `originOf(roots: PluginRoots, plugin: string): Origin | Record<string, never>`
  - `originOfDir(dir: string): Origin | Record<string, never>`
  - `originFor(roots: PluginRoots, plugin: string, dir: string | null): Origin | Record<string, never>` (path first, then name)

- [ ] **Step 1: Update the existing `orgBasePackRoots` test and add a version case**

In `lib/skills/__tests__/sources.test.ts`, change line 635's expectation to include `baseVersion: null`, and add after it:

```ts
  test("a base root carries its plugin.json version beside the org token", () => {
    const { root, base } = makeRoot();
    mkdirSync(join(base, ".claude-plugin"), { recursive: true });
    writeFileSync(join(base, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "0.1.0" }));
    expect(orgBasePackRoots(join(root, "orgs", "acme"))).toEqual([{ name: "acme-base", dir: realpathSync(base), version: "org", baseVersion: "0.1.0" }]);
  });

  test("a base whose plugin.json has an empty version has a null baseVersion", () => {
    const { root, base } = makeRoot();
    mkdirSync(join(base, ".claude-plugin"), { recursive: true });
    writeFileSync(join(base, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "" }));
    expect(orgBasePackRoots(join(root, "orgs", "acme"))[0]?.baseVersion).toBeNull();
  });
```

- [ ] **Step 2: Write `lib/skills/__tests__/origin.test.ts`**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { originFor, originOf, originOfDir } from "../origin.ts";
import type { PluginRoots } from "../sources.ts";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "rt-origin-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const roots = (): PluginRoots => ({
  byName: {
    mattstack: { dir: join(root, "mattstack"), version: "0.30.0" },
    "acme-base": { dir: join(root, "acme-base"), version: "org", baseVersion: "0.1.0" },
  },
  list: [],
  folderOnly: new Set(["acme-base"]),
});

function emitted(dir: string, provenance: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: x\n---\nbody\n");
  writeFileSync(join(dir, "compiled.json"), provenance);
  return dir;
}

test("a base root's plugin is a base, with its version", () => {
  expect(originOf(roots(), "acme-base")).toEqual({ origin: "base", base: "acme-base", baseVersion: "0.1.0" });
});

test("an installed plugin and an unknown name have no origin", () => {
  expect(originOf(roots(), "mattstack")).toEqual({});
  expect(originOf(roots(), "nope")).toEqual({});
});

test("an emitted folder is a base from its compiled.json", () => {
  const dir = emitted(join(root, "widgets", "attachments", "dev-servers"), JSON.stringify({ base: "acme-base", version: "0.1.0", files: ["SKILL.md"] }));
  expect(originOfDir(dir)).toEqual({ origin: "base", base: "acme-base", baseVersion: "0.1.0" });
});

test("a compiled.json version of null reads as a null baseVersion", () => {
  const dir = emitted(join(root, "a"), JSON.stringify({ base: "acme-base", version: null, files: [] }));
  expect(originOfDir(dir)).toEqual({ origin: "base", base: "acme-base", baseVersion: null });
});

test("a hand-authored or malformed compiled.json is not a base", () => {
  expect(originOfDir(emitted(join(root, "b"), JSON.stringify({ rows: [1, 2] })))).toEqual({});
  expect(originOfDir(emitted(join(root, "c"), "{ not json"))).toEqual({});
  expect(originOfDir(join(root, "missing"))).toEqual({});
});

test("the path wins over the name", () => {
  const dir = emitted(join(root, "widgets", "attachments", "board-fill"), JSON.stringify({ base: "acme-base", version: "0.1.0", files: [] }));
  expect(originFor(roots(), "widgets", dir)).toEqual({ origin: "base", base: "acme-base", baseVersion: "0.1.0" });
  expect(originFor(roots(), "acme-base", null)).toEqual({ origin: "base", base: "acme-base", baseVersion: "0.1.0" });
  expect(originFor(roots(), "mattstack", join(root, "mattstack", "attachments", "x"))).toEqual({});
});
```

- [ ] **Step 3: Run both test files, expect failures**

Run: `bun test lib/skills/__tests__/sources.test.ts lib/skills/__tests__/origin.test.ts`
Expected: FAIL (`origin.ts` missing; `baseVersion` absent).

- [ ] **Step 4: Implement**

`lib/skills/sources.ts`, the PluginRoots type:

```ts
export type PluginRoots = {
  byName: Record<string, { dir: string; version: string; baseVersion?: string | null }>;
  list: PluginListEntry[];
  /** Roots that are read from a folder and never installed: a fill found under their skills/ cannot be invoked at run time. */
  folderOnly?: Set<string>;
};
```

`orgBasePackRoots`: import `packPluginIdentity` from `./provenance.ts` (check `provenance.ts` does not import `sources.ts`; it does not today), change the return type to include `baseVersion: string | null`, and push:

```ts
    out.push({ name, dir: realpathSync(dir), version: "org", baseVersion: packPluginIdentity(dir)?.version || null });
```

`commands/skills.ts:631`:

```ts
      pluginRoots.byName[baseRoot.name] = { dir: baseRoot.dir, version: baseRoot.version, baseVersion: baseRoot.baseVersion };
```

Create `lib/skills/origin.ts`:

```ts
import { readFileSync } from "fs";
import { join } from "path";
import { isEmittedAttachmentDir, PROVENANCE_FILE } from "./base-attachments.ts";
import type { PluginRoots } from "./sources.ts";

export type Origin = { origin: "base"; base: string; baseVersion: string | null };
type NoOrigin = Record<string, never>;

export function originOf(roots: PluginRoots, plugin: string): Origin | NoOrigin {
  if (!roots.folderOnly?.has(plugin)) return {};
  return { origin: "base", base: plugin, baseVersion: roots.byName[plugin]?.baseVersion ?? null };
}

export function originOfDir(dir: string): Origin | NoOrigin {
  if (!isEmittedAttachmentDir(dir)) return {};
  const { base, version } = JSON.parse(readFileSync(join(dir, PROVENANCE_FILE), "utf8")) as { base: string; version: string | null };
  return { origin: "base", base, baseVersion: version || null };
}

/** A team-pack copy of a base file is the base's, whatever plugin name binds it. */
export function originFor(roots: PluginRoots, plugin: string, dir: string | null): Origin | NoOrigin {
  const byPath = dir ? originOfDir(dir) : {};
  return "origin" in byPath ? byPath : originOf(roots, plugin);
}
```

- [ ] **Step 5: Run the tests, expect PASS**

Run: `bun test lib/skills/__tests__/sources.test.ts lib/skills/__tests__/origin.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/skills/origin.ts lib/skills/sources.ts commands/skills.ts lib/skills/__tests__/origin.test.ts lib/skills/__tests__/sources.test.ts
git commit -m "skills: origin helpers and a base root's real version"
```

---

### Task 2: rt composition carries origin and extends

**Files:**
- Modify: `commands/skills.ts` (types at ~1543-1625, `buildCompositionVerb` ~1680-1700, `buildBinders` ~1741-1766, `enumerateFills` ~1805-1830, `skillsComposition` ~1850-1875)
- Test: `commands/__tests__/skills.test.ts` (near the "a team pack compiles a fill that lives in the org base pack" test, ~line 615), `commands/__tests__/skills-json-frozen.test.ts:64-67`

**Interfaces:**
- Consumes: `originOf`, `originFor`, `Origin` from Task 1; `basePlanFor(resolved, verbSides)` and `compileTargets(resolved, publicSet, null).verbSides` (both existing in `commands/skills.ts`).
- Produces (JSON): `verbs[].slots[]`, `fills[]`, `binders[].slots[]` may carry `origin: "base"`, `base: string`, `baseVersion: string | null`; top-level `extends: { name: string; version: string | null } | null`, the LAST key.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/skills-json-frozen.test.ts` change the composition key list to end with `"targets", "extends"`, and add `expect(oneJsonLine().value.extends).toBeNull()` style check by storing the value:

```ts
test("skills composition --json is one line with these keys", async () => {
  await skillsComposition(["--pack-dir", makePack(), "--json"]);
  const { value } = oneJsonLine();
  expect(Object.keys(value)).toEqual(["pack", "packDir", "manifestPath", "verbs", "fills", "binders", "pipelines", "targets", "extends"]);
  expect(value.extends).toBeNull();
});
```

In `commands/__tests__/skills.test.ts`, inside the same describe as the base-fill compile test, add (reusing that test's setup lines verbatim, plus a base `plugin.json` and an emitted attachment):

```ts
  test("composition tags a base fill, its slot and binder slot, and names the base the pack extends", async () => {
    const mattstackDir = makeMattstackDir();
    seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
    const baseDir = join(mattstackDir, "orgs", "acme", "mattstack", "org", "packs", "acme-base");
    const packDir = teamPackDir(mattstackDir, "acme", "widgets");
    writeFile(join(baseDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "0.1.0" }));
    writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), DOMAIN_SKILL_MD);
    writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
    writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
    writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
    const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
    if (out.kind !== "written") throw new Error(out.kind);

    const io = captureSkills();
    try {
      await skillsComposition(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--json"]);
      const payload = JSON.parse(io.stdout());
      const tag = { origin: "base", base: "acme-base", baseVersion: "0.1.0" };
      expect(payload.extends).toEqual({ name: "acme-base", version: "0.1.0" });
      expect(payload.fills.find((f: { binding: string }) => f.binding === "acme-base:watch-ci-domain")).toMatchObject(tag);
      expect(payload.fills.find((f: { binding: string }) => f.binding.startsWith("mattstack:"))).not.toHaveProperty("origin");
      const slot = payload.verbs.find((v: { name: string }) => v.name === "watch-ci").slots.find((s: { name: string }) => s.name === "domain");
      expect(slot).toMatchObject({ boundTo: "acme-base:watch-ci-domain", fillVersion: "org", ...tag });
      const binderSlot = payload.binders.flatMap((b: { slots: { boundTo: string }[] }) => b.slots).find((s: { boundTo: string }) => s.boundTo === "acme-base:watch-ci-domain");
      expect(binderSlot).toMatchObject(tag);
    } finally {
      io.restore();
    }
  });
```

Check the file's imports first: add `skillsComposition` to the `../skills.ts` import and `captureSkills` from `../../lib/skills/__tests__/helpers.ts` if missing. If `DOMAIN_SKILL_MD`'s frontmatter lacks `metadata.provides`, the existing compile test proves it has one; reuse it unchanged.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test commands/__tests__/skills.test.ts -t "composition tags a base fill" && bun test commands/__tests__/skills-json-frozen.test.ts`
Expected: FAIL (no `extends`, no `origin`).

- [ ] **Step 3: Implement**

In `commands/skills.ts` import `{ originFor, originOf, type Origin } from "../lib/skills/origin.ts"`.

Types: add to `CompositionSlot`, `CompositionFill` and the binder slot type the optional fields via an intersection:

```ts
type OriginFields = Partial<Origin>;
```

`CompositionSlot = { ...existing } & OriginFields;`, `CompositionFill = { binding: string; provides: string; sourcePath: string; registered: boolean } & OriginFields;`, binder `slots: ({ name: string; boundTo: string; layer: string | null } & OriginFields)[]`. Add to `CompositionPayload`, last: `/** The org base this pack extends, null when none. */ extends: { name: string; version: string | null } | null;`

`buildCompositionVerb`, in the successful `try` branch, spread `...originFor(resolved.pluginRoots, fill.plugin, fill.dir)` after `inlined`.

`buildBinders`, each slot:

```ts
      slots: Object.entries(slotBindings).map(([name, boundTo]) => ({
        name,
        boundTo,
        layer: resolved.provenance[`${ref} ${name}`] ?? null,
        ...bindingOrigin(resolved.pluginRoots, boundTo),
      })),
```

with, next to `buildBinders`:

```ts
/** A binder slot names its fill only by binding, so its origin is found where the verb slot's is: the dir loadAttachment resolves. */
function bindingOrigin(roots: PluginRoots, boundTo: string): Partial<Origin> {
  const plugin = boundTo.split(":")[0] ?? "";
  try {
    return originFor(roots, plugin, loadAttachment(boundTo, "binder", roots).dir);
  } catch {
    return originOf(roots, plugin);
  }
}
```

`enumerateFills`, the push:

```ts
        fills.push({ binding: `${pluginName}:${entry.name}`, provides, sourcePath: skillMdPath, registered, ...originFor(pluginRoots, pluginName, entry.dir) });
```

`skillsComposition`, before building `payload`:

```ts
    const base = resolved.fullRoster.length > 0 ? basePlanFor(resolved, compileTargets(resolved, publicSet, null).verbSides).base : null;
```

and add `extends: base ? { name: base.name, version: base.version } : null,` as the last payload key. (`basePlanFor` returns `base: null` when the pack extends nothing; a rosterless pack skips it because `resolved` has no plugin roots.)

- [ ] **Step 4: Run, expect PASS; run the other composition users**

Run: `bun test commands/__tests__/skills.test.ts commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills-bind.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills.test.ts commands/__tests__/skills-json-frozen.test.ts
git commit -m "skills composition: origin on base fills and slots, and the base a pack extends"
```

---

### Task 3: rt anatomy sources carry origin

**Files:**
- Modify: `lib/skills/anatomy.ts:5` (`AnatomySource`), `commands/skills.ts:1931-1970` (`skillsAnatomy`)
- Test: `commands/__tests__/skills.test.ts` (same describe as Task 2)

**Interfaces:**
- Consumes: `originFor`, `Origin` (Task 1).
- Produces: `AnatomySource = { ref; path; version; builtVersion; lines } & Partial<Origin>`; every `parts[].source` and `template` may carry the fields.

- [ ] **Step 1: Failing test**

Add after Task 2's test, reusing its setup verbatim (factor the setup into a local `function seedBaseFixture(): { mattstackDir: string; packDir: string; baseDir: string }` inside the describe and call it from both tests):

```ts
  test("anatomy tags a base fill's source and leaves the engine's alone", async () => {
    const { mattstackDir, packDir } = seedBaseFixture();
    await runExpectingCleanExit(() => skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--verb", "watch-ci"]));
    const io = captureSkills();
    try {
      await skillsAnatomy(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--skill", "watch-ci", "--json"]);
      const payload = JSON.parse(io.stdout());
      const domain = payload.parts.find((p: { kind: string; name: string }) => p.kind === "slot" && p.name === "domain");
      expect(domain.source).toMatchObject({ ref: "acme-base:watch-ci-domain", version: "org", origin: "base", base: "acme-base", baseVersion: "0.1.0" });
      expect(payload.template).not.toHaveProperty("origin");
    } finally {
      io.restore();
    }
  });
```

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test commands/__tests__/skills.test.ts -t "anatomy tags a base fill"`

- [ ] **Step 3: Implement**

`lib/skills/anatomy.ts:5`:

```ts
export type AnatomySource = { ref: string; path: string; version: string; builtVersion: string | null; lines: number; origin?: "base"; base?: string; baseVersion?: string | null };
```

`commands/skills.ts`, the include and fill source lines spread `...originFor(resolved.pluginRoots, inc.plugin, inc.dir)` and `...originFor(resolved.pluginRoots, fill.plugin, fill.dir)`; the `template` object spreads `...originFor(resolved.pluginRoots, step.plugin, step.dir)` (always `{}` today, kept for symmetry with the spec's table).

- [ ] **Step 4: Run, expect PASS; run anatomy's own tests**

Run: `bun test commands/__tests__/skills.test.ts lib/skills/__tests__/anatomy.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/skills/anatomy.ts commands/skills.ts commands/__tests__/skills.test.ts
git commit -m "skills anatomy: origin on base sources"
```

---

### Task 4: rt surface rows name their base, and the public flip is refused

**Files:**
- Modify: `commands/skills.ts` (`SurfaceRow` type, `computeRows` ~2383-2406, `runSet` ~2599-2639, palette options ~2706-2711)
- Test: `commands/__tests__/skills-surface.test.ts`

**Interfaces:**
- Consumes: `originOfDir` (Task 1).
- Produces: `SurfaceRow` gains `base?: string`; a base row's `status` is always `"internal"`.

- [ ] **Step 1: Failing tests**

In `commands/__tests__/skills-surface.test.ts`, add a describe using the file's `makePackDir()` and `writeFile` helpers:

```ts
describe("emitted base attachments", () => {
  function withEmitted(publicList: string[]): string {
    const packDir = makePackDir();
    writeFile(join(packDir, "attachments", "dev-servers", "SKILL.md"), "---\nname: dev-servers\n---\nbody\n");
    writeFile(join(packDir, "attachments", "dev-servers", "compiled.json"), JSON.stringify({ base: "acme-base", version: "0.1.0", files: ["SKILL.md"] }));
    writeFile(join(packDir, "attachments", "helper", "SKILL.md"), "---\nname: helper\n---\nbody\n");
    writeFile(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: publicList }));
    return packDir;
  }

  test("a row carries its base and reads internal even when the file lists it public", () => {
    const packDir = withEmitted(["dev-servers"]);
    const { rows } = computeRows(packDir, new Set(), { public: ["dev-servers"] }, new Set());
    expect(rows.find((r) => r.name === "dev-servers")).toEqual({ name: "dev-servers", kind: "compiled", status: "internal", base: "acme-base" });
    expect(rows.find((r) => r.name === "helper")).not.toHaveProperty("base");
  });

  for (const json of [[], ["--json"]]) test(`making one public is refused ${json.length ? "as JSON" : "for a person"}`, async () => {
    const packDir = withEmitted([]);
    const before = readFileSync(join(packDir, "pack", "surface.jsonc"), "utf8");
    await runExpectingCleanExit(() => skillsSurface(["set", "dev-servers", "--public", "--pack-dir", packDir, ...json])).catch(() => {});
    expect(readFileSync(join(packDir, "pack", "surface.jsonc"), "utf8")).toBe(before);
    if (json.length) {
      expect(JSON.parse(io.lines().at(-1)!)).toEqual({ ok: false, dryRun: false, set: [{ name: "dev-servers", want: "public" }], moved: [], recorded: [], compileErrors: ["dev-servers comes from acme-base. The org base pack decides. Verbs read it from attachments/, so it stays internal."] });
    } else {
      expect(io.stderr()).toStartWith("[refused] dev-servers comes from acme-base");
    }
  });

  test("a grouped emitted unit tags its leaf row", () => {
    const packDir = withEmitted([]);
    writeFile(join(packDir, "attachments", "refs", "feature-flags", "SKILL.md"), "---\nname: feature-flags\n---\nbody\n");
    writeFile(join(packDir, "attachments", "refs", "feature-flags", "compiled.json"), JSON.stringify({ base: "acme-base", version: "0.1.0", files: ["SKILL.md"] }));
    const { rows } = computeRows(packDir, new Set(), { public: [] }, new Set());
    expect(rows.find((r) => r.name === "feature-flags")).toMatchObject({ status: "internal", base: "acme-base" });
  });

  test("making one internal is allowed and drops a stale public entry", async () => {
    const packDir = withEmitted(["dev-servers"]);
    await skillsSurface(["set", "dev-servers", "--internal", "--pack-dir", packDir, "--json"]);
    expect(readFileSync(join(packDir, "pack", "surface.jsonc"), "utf8")).not.toContain("dev-servers");
  });
});
```

Before writing it, read how the file's other `set` tests pass the pack (`--pack-dir` vs `--team`/manifest flags) and how they await a refusal (the member-refusal tests at ~1194-1212 are the model); match them exactly, including `io`'s name and `process.exitCode` handling.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test commands/__tests__/skills-surface.test.ts -t "emitted base attachments"`

- [ ] **Step 3: Implement**

`computeRows`, the row builder:

```ts
  const rows = [...names].sort().map((name) => {
    const dir = skillEntries.get(name)?.dir ?? attachmentEntries.get(name)?.dir ?? null;
    const isStage = stageNames.has(name);
    const origin = dir ? originOfDir(dir) : {};
    const base = "origin" in origin ? origin.base : null;
    return {
      name,
      kind: isStage ? ("compiled" as const) : allNames.has(name) ? classify(name, dir, verbNames) : ("missing" as const),
      status: (base === null && publicSet.has(name) ? "public" : "internal") as "public" | "internal",
      ...(base === null ? {} : { base }),
    };
  });
```

Add `base?: string` to the `SurfaceRow` type.

`runSet`, after the unknown-name validation loop and before reading the surface:

```ts
  if (want === "public") {
    const { attachmentEntries } = collectRegistry(packDir, verbNames);
    for (const name of names) {
      const dir = attachmentEntries.get(name)?.dir;
      const origin = dir ? originOfDir(dir) : {};
      if ("origin" in origin) {
        const title = `${name} comes from ${origin.base}`;
        const why = "The org base pack decides. Verbs read it from attachments/, so it stays internal.";
        throw new SkillsRefusal(`${title}. ${why}`, { title, why });
      }
    }
  }
```

(`collectRegistry` is already called at the top of `runSet`; destructure `attachmentEntries` there instead of calling it twice.)

Palette (`rows.map` building `options`): filter `rows.filter((row) => row.base === undefined)` first, for both `options` and `initialValues`.

- [ ] **Step 4: Run, expect PASS, plus the frozen and surface suites**

Run: `bun test commands/__tests__/skills-surface.test.ts commands/__tests__/skills-json-frozen.test.ts lib/skills/__tests__/surface.test.ts`

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills-surface.test.ts
git commit -m "skills surface: name a row's base, keep it internal, refuse making it public"
```

---

### Task 5: Console types and the owner helper

**Files:**
- Modify: `apps/console/src/server/skills.ts:26-130, 158-162, 212-218` (interfaces)
- Create: `apps/console/src/app/wiring/owner.ts`, `apps/console/src/app/wiring/owner.test.ts`

**Interfaces:**
- Produces:
  - `interface OriginFields { origin?: 'base'; base?: string; baseVersion?: string | null }` exported from `owner.ts`.
  - `type Owner = { kind: 'pack' } | { kind: 'base'; name: string; version: string | null } | { kind: 'plugin'; name: string }`
  - `ownerOf(ref: string, item: OriginFields | null | undefined, pack: string): Owner`
  - `baseLabel(owner: Extract<Owner, { kind: 'base' }>): string` returning `acme-base 0.1.0` or `acme-base`.
  - Server interfaces: `SkillsCompositionSlot`, `SkillsCompositionFill`, binder slot, `SkillsAnatomySource` extend `OriginFields` (declare the three fields inline on each, since server code cannot import from `app/`); `SkillsCompositionResponse.extends?: { name: string; version: string | null } | null`; `SkillsSurfaceRow.base?: string`; `SkillsCheckResponse.attachments?: SkillsCheckAttachmentRow[]` and `baseErrors?: string[]` with `interface SkillsCheckAttachmentRow { name: string; base: string | null; status: 'in-sync' | 'stale' | 'never-compiled' | 'orphaned'; staleFiles: string[]; orphanFiles: string[] }`.

- [ ] **Step 1: Failing test `owner.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { baseLabel, ownerOf } from './owner';

describe('ownerOf', () => {
  it('reads origin first, so a team-pack copy of a base file is the base', () => {
    expect(
      ownerOf('acme:dev-servers', { origin: 'base', base: 'acme-base', baseVersion: '0.1.0' }, 'acme')
    ).toEqual({ kind: 'base', name: 'acme-base', version: '0.1.0' });
  });
  it('is the pack when the ref is the pack and nothing says base', () => {
    expect(ownerOf('acme:plan-policy', {}, 'acme')).toEqual({ kind: 'pack' });
  });
  it('is a plugin otherwise, including an older rt that sends no origin', () => {
    expect(ownerOf('acme-base:reply-rules', undefined, 'acme')).toEqual({ kind: 'plugin', name: 'acme-base' });
    expect(ownerOf('mattstack:model-tiering', null, 'acme')).toEqual({ kind: 'plugin', name: 'mattstack' });
  });
  it('keeps a missing base version null', () => {
    expect(ownerOf('acme-base:x', { origin: 'base', base: 'acme-base' }, 'acme')).toEqual({ kind: 'base', name: 'acme-base', version: null });
  });
});

describe('baseLabel', () => {
  it('names the version only when there is one, never the org token', () => {
    expect(baseLabel({ kind: 'base', name: 'acme-base', version: '0.1.0' })).toBe('acme-base 0.1.0');
    expect(baseLabel({ kind: 'base', name: 'acme-base', version: null })).toBe('acme-base');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run (in `apps/console`): `bun run test -- src/app/wiring/owner.test.ts`

- [ ] **Step 3: Implement `owner.ts`**

```ts
import { pluginOf } from './outline';

export interface OriginFields {
  origin?: 'base';
  base?: string;
  baseVersion?: string | null;
}

export type Owner =
  | { kind: 'pack' }
  | { kind: 'base'; name: string; version: string | null }
  | { kind: 'plugin'; name: string };

export function ownerOf(
  ref: string,
  item: OriginFields | null | undefined,
  pack: string
): Owner {
  if (item?.origin === 'base' && item.base)
    return { kind: 'base', name: item.base, version: item.baseVersion ?? null };
  const plugin = pluginOf(ref);
  return plugin === pack ? { kind: 'pack' } : { kind: 'plugin', name: plugin };
}

export function baseLabel(owner: Extract<Owner, { kind: 'base' }>): string {
  return owner.version ? `${owner.name} ${owner.version}` : owner.name;
}
```

Then add the server interface fields listed under Interfaces, each with a one-line comment "Optional because an rt older than the field answers without it." where the file's style does so.

- [ ] **Step 4: Run, expect PASS; typecheck**

Run: `bun run test -- src/app/wiring/owner.test.ts && bun run typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/wiring/owner.ts apps/console/src/app/wiring/owner.test.ts apps/console/src/server/skills.ts
git commit -m "console: origin fields on the skills payloads and an owner helper"
```

---

### Task 6: Console words a base fill as a base (F3, F4, F5, F6, F10 rebind)

**Files:**
- Modify: `apps/console/src/app/wiring/graph/model/templateModel.ts:577-590, 652-665`
- Modify: `apps/console/src/app/wiring/graph/model/drawerContent.ts:73` (`DrawerUsedBy`), `155-160` (`ownerMeta`), `385-425` (`inputContent`), `466-482` (`appFillContent`)
- Modify: `apps/console/src/app/wiring/graph/drawer/UsedByTab.tsx:23-27`
- Modify: `apps/console/src/app/wiring/graph/drawer/history.ts:34-50, 114-125` and `BuiltFromTable.tsx:108-125`
- Modify: `apps/console/src/app/wiring/graph/drawer/rebind.ts:100-106`, `RebindPanel.tsx:150-170, ~256`
- Test: `graph/model/__tests__/templateModel.test.ts`, `graph/model/__tests__/drawerContent.test.ts`, `graph/__tests__/SkillDrawer.test.tsx` (used-by footer), `graph/__tests__/RebindPanel.test.tsx`, history tests (find with `grep -rln "fileNote\|builtFrom" src/app/wiring`)

**Interfaces:**
- Consumes: `ownerOf`, `baseLabel`, `Owner` (Task 5).
- Produces: `DrawerUsedBy` gains `owner: Owner` (keep `plugin` for existing callers); `BuiltFromRow` gains `owner: Owner`; rebind options gain `owner: Owner`.

Wording, exact strings (spec section 3):

| Place | Base text |
|---|---|
| card subtitle | `${name} · org base${pickedBy(layer)}` |
| drawer sentence (input, slot) | ``From the org's ${name} base pack. ${skills} ${one ? 'uses' : 'use'} it.`` |
| drawer sentence (app fill) | ``From the org's ${name} base pack. ${view.skill} reads it through its ${row.name} slot.`` |
| drawer meta | ``${baseLabel(owner)} · org base pack, read only here`` |
| used-by footer | ``Edit it in the org's ${name} base pack. Every skill above picks up the change on its next compile.`` |
| built-from `builtWith` | `baseLabel(owner)` (never the `org` token) |
| built-from `installed` column | `org base` |
| built-from note for a base row, any status but `not built`/`unmeasured` | ``${skill} was built from the org's ${name} base pack. rt check says whether it is current.`` |
| rebind option and current fill | `${name} · org base` where a plugin shows its name |

A team-pack copy (owner `base` though the ref's plugin is the pack) takes the base wording everywhere, never "written by <pack>"; its drawer sentence also ends with " Compile copies it from the org's <name> base pack and rewrites it on every compile; edit it there."

- [ ] **Step 1: Write failing model tests**

In `templateModel.test.ts`, build a view from a composition and anatomy whose `domain` slot source is `{ ref: 'acme-base:plan-policy', version: 'org', builtVersion: 'org', origin: 'base', base: 'acme-base', baseVersion: '0.1.0', ... }` (copy the nearest existing test's fixture objects and change only the source), and assert:

```ts
expect(card.subtitle).toBe('acme-base · org base · picked by this pack');
```

and a second case with the same ref but no origin fields asserting today's `acme-base default · picked by this pack` (older rt). Add an `appSkillView` case: a binder slot `{ name: 'domain', boundTo: 'acme:board-fill', layer: 'pack', origin: 'base', base: 'acme-base', baseVersion: '0.1.0' }` with a matching fill in `composition.fills` asserts subtitle `acme-base · org base · picked by this pack`, not `written by acme`.

In `drawerContent.test.ts`, for the input card above assert:

```ts
expect(content.meta).toBe('acme-base 0.1.0 · org base pack, read only here');
expect(content.sentence).toBe("From the org's acme-base base pack. 2 skills in this pack use it.");
expect(content.usedBy).toMatchObject({ kind: 'fill', owner: { kind: 'base', name: 'acme-base', version: '0.1.0' } });
```

and with `baseVersion: null`, `meta` is `acme-base · org base pack, read only here` and no string in the content contains `org ·` or ` org` as a version (`expect(JSON.stringify(content)).not.toMatch(/acme-base org\b/)`).

In the history test file, a `builtFrom` row for that source asserts `builtWith: 'acme-base 0.1.0'`, `installed: 'org base'`, and `fileNote(row, 'stage-plan')` is `"stage-plan was built from the org's acme-base base pack. rt check says whether it is current."`.

In `RebindPanel.test.tsx` (or a `rebind.test.ts` beside `rebind.ts` if the panel test renders), an option for `acme-base:plan-policy` with origin fields renders `acme-base · org base`.

In the used-by test (search `Edit it in the` in `src/app/wiring`), a base owner renders `Edit it in the org's acme-base base pack. Every skill above picks up the change on its next compile.`

- [ ] **Step 2: Run, expect FAIL**

Run: `bun run test -- src/app/wiring/graph`

- [ ] **Step 3: Implement**

Every site replaces `pluginOf(x.ref) === pack` / `plugin !== pack` decisions with `const owner = ownerOf(ref, item, pack)` and a `switch (owner.kind)`. Concretely:

- `templateModel.ts` ~577: `const owner = ownerOf(source.ref, source, pack);` then `owner.kind === 'pack'` keeps `written by ...`; `base` returns `subtitle: \`${owner.name} · org base${pickedBy(facts?.layer ?? null)}\``; `plugin` keeps `${owner.name} default...`. Same in `appSkillView` with `ownerOf(slot.boundTo, slot, pack)`.
- `drawerContent.ts`: `ownerMeta(source, pack)` becomes `ownerMeta(owner: Owner, source: AnatomySource, pack: string)`; `inputContent` and `appFillContent` compute the owner, use the table's sentences, set `badge` to `'pack text'` only for `owner.kind === 'pack'`, and pass `owner` into `usedBy`.
- `UsedByTab.tsx` `editNote` switches on `usedBy.owner.kind`.
- `history.ts` `rowOf` takes `pack` (thread it from `builtFrom(anatomy, ...)`, which has `anatomy.pack`), computes `owner = ownerOf(source.ref, source, pack)`, and for a base sets `builtWith: source.builtVersion === null ? null : baseLabel(owner)`, `installed: 'org base'`, `owner`. `fileNote` returns the base sentence for a base row whose status is `unchanged`, `current` or `changed`; `not built` and `unmeasured` keep their sentences.
- `rebind.ts` options add `owner: ownerOf(fill.binding, fill, pack)` (the function already receives the pack; if not, add a `pack` parameter and pass `composition.pack` at its caller). `RebindPanel.tsx` prints `option.owner.kind === 'base' ? \`${option.owner.name} · org base\` : option.plugin` where it prints `plugin`, and the current-fill box shows the same owner text beside the name (find the current fill's composition fill by binding).

- [ ] **Step 4: Run, expect PASS; then the whole wiring suite and typecheck**

Run: `bun run test -- src/app/wiring && bun run typecheck && bun run lint`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/wiring
git commit -m "console wiring: call an org base fill a base, never an installed plugin"
```

---

### Task 7: Console serves a base fill's text (F1)

**Files:**
- Modify: `apps/console/src/server/skills.ts:1393-1440` (`/api/skills/source`)
- Test: `apps/console/src/server/skills.test.ts` (the existing `/api/skills/source` tests)

**Interfaces:**
- Consumes: `SkillsCompositionFill.origin` (Task 5).

- [ ] **Step 1: Failing test**

Beside the existing source-route tests, with their fake `runRt` returning a composition whose `packDir` is `/p/acme`, one verb under `/m/mattstack/...`, and `fills: [{ binding: 'acme-base:plan-policy', provides: 'plan-domain@1', sourcePath: '/o/acme/mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md', registered: false, origin: 'base', base: 'acme-base', baseVersion: '0.1.0' }]`, and a fake `readPackFile`/`realpath` that resolve those paths:

```ts
it('serves a base fill the composition names', async () => {
  const res = await get('/api/skills/source?pack=acme&path=' + encodeURIComponent('/o/acme/mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md'));
  expect(res.status).toBe(200);
});
it('still refuses a base file outside its skill dirs', async () => {
  const res = await get('/api/skills/source?pack=acme&path=' + encodeURIComponent('/o/acme/mattstack/org/packs/acme-base/PACK.md'));
  expect(res.status).toBe(404);
});
it('refuses a base fill when the fill carries no origin (an older rt)', async () => {
  // same composition, fill without origin fields
});
```

Write the third test's body fully: rebuild the fake with the fill's origin fields removed and expect 404. Match the file's existing helper names for building the app and the fakes.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun run test -- src/server/skills.test.ts -t source`

- [ ] **Step 3: Implement**

After the binders loop in the source route:

```ts
        for (const fill of composition.fills ?? []) {
          if (fill.origin !== 'base') continue;
          const root = pluginRootOf(fill.sourcePath);
          if (root) for (const dir of pluginSkillDirs(root)) roots.add(dir);
        }
```

Check `pluginRootOf` finds a root for a base path (it walks up to the dir holding `attachments/` or `skills/`; read `src/shared/pluginRoot.ts` and its test). If it keys on `.claude-plugin`, the base has one in the live org but not necessarily in a test; give the test fixture a path shape `pluginRootOf` accepts, and add a `pluginRoot.test.ts` case for a base path.

- [ ] **Step 4: Run, expect PASS**

Run: `bun run test -- src/server/skills.test.ts src/shared`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/server/skills.ts apps/console/src/server/skills.test.ts apps/console/src/shared
git commit -m "console: serve an org base fill's text"
```

---

### Task 8: Console marks emitted base attachments (F7, F8)

**Files:**
- Modify: `apps/console/src/app/wiring/graph/model/drawerContent.ts:571-597` (`linkContent`), `templateModel.ts` (link cards, search `referenced: the rendered text links to it` and the output card's `links`)
- Modify: `apps/console/src/app/wiring/SurfaceTab.tsx:48-58, 141-153`, the row render (search `KIND_BADGE[` and the toggle `Switch`)
- Create: `apps/console/src/app/wiring/baseCopies.ts` (+ test)
- Test: `graph/model/__tests__/drawerContent.test.ts`, `src/app/wiring/__tests__/SurfaceTab.test.tsx` (create if missing; check `grep -rl SurfaceTab src/app/wiring`)

**Interfaces:**
- Consumes: `SkillsCheckAttachmentRow` (Task 5), `SkillsSurfaceRow.base`.
- Produces: `baseCopyOf(path: string, attachments: { name: string; base: string | null }[] | undefined): string | null`, the base name when the pack-relative `path` sits under `attachments/<name>/` for some row whose `base` is not null (grouped `name` like `group/leaf` included), else null. A row with `base: null` is an orphaned copy and never matches. `linkContent` gains a `check` argument (thread from `drawerContent`'s caller, which already reads the check query; if it does not, pass `check?.attachments`).

- [ ] **Step 1: Failing tests**

`baseCopies.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { baseCopyOf } from './baseCopies';

const rows = [
  { name: 'dev-servers', base: 'acme-base' },
  { name: 'refs/feature-flags', base: 'acme-base' },
  { name: 'gone', base: null },
];

describe('baseCopyOf', () => {
  it('matches a link into an emitted folder, a link relative to a verb, and a grouped unit', () => {
    expect(baseCopyOf('attachments/dev-servers/SKILL.md', rows)).toBe('acme-base');
    expect(baseCopyOf('../../attachments/dev-servers/SKILL.md', rows)).toBe('acme-base');
    expect(baseCopyOf('attachments/refs/feature-flags/references/x.md', rows)).toBe('acme-base');
  });
  it('does not match a prefix that is only a name prefix, or a team folder', () => {
    expect(baseCopyOf('attachments/dev-servers-extra/SKILL.md', rows)).toBeNull();
    expect(baseCopyOf('attachments/capture-evidence/SKILL.md', rows)).toBeNull();
    expect(baseCopyOf('attachments/dev-servers/SKILL.md', undefined)).toBeNull();
    expect(baseCopyOf('foo-attachments/dev-servers/SKILL.md', rows)).toBeNull();
  });
  it('never matches an orphaned row, which has no base', () => {
    expect(baseCopyOf('attachments/gone/SKILL.md', rows)).toBeNull();
  });
});
```

`drawerContent.test.ts`: a link drawer for `../../attachments/dev-servers/SKILL.md` with `check.attachments` holding the `dev-servers` row has `badge: 'from acme-base'` and a sentence ending "Compile copies it from the org's acme-base base pack and rewrites it on every compile; edit it there."; without the row, the badge stays `pack text`.

Surface test: render `SurfaceTab` with a surface payload row `{ name: 'dev-servers', kind: 'compiled', status: 'internal', base: 'acme-base' }`; assert the row shows the `from acme-base` badge, its toggle is disabled, and hovering (or the tooltip label in the DOM) reads "The org base pack decides. Verbs read it from attachments/, so it stays internal."; a plain compiled row still has an enabled toggle and the `compiled` badge.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun run test -- src/app/wiring/baseCopies.test.ts src/app/wiring/graph/model src/app/wiring/__tests__`

- [ ] **Step 3: Implement**

`baseCopies.ts`:

```ts
/** A link is written relative to the verb that holds it, so only the part from `attachments/` on is the pack-relative path. */
const ATTACHMENTS = /(^|\/)attachments\//;

export function baseCopyOf(
  path: string,
  attachments: { name: string; base: string | null }[] | undefined
): string | null {
  const match = ATTACHMENTS.exec(path);
  if (!match || !attachments) return null;
  const rel = path.slice(match.index + match[0].length);
  return (
    attachments.find(row => row.base !== null && rel.startsWith(`${row.name}/`))
      ?.base ?? null
  );
}
```

`linkContent`: `const base = baseCopyOf(path, attachments);` badge `base ? \`from ${base}\` : <today's ternary>`, sentence appends the copy sentence when `base`. Link cards on the canvas that show a `pack text`-style subtitle take `from <base>` the same way.

`SurfaceTab.tsx`: the badge picks `row.base ? { label: \`from ${row.base}\`, color: <the role colour the kit uses for neutral info badges; reuse the badge colour of an existing neutral badge in this file or the kit, never a raw colour> } : KIND_BADGE[row.kind]`; the toggle gets `disabled={row.base !== undefined}` and is wrapped in the kit `Tooltip` with the label above (check `building-with-mantine-kit` for the kit's Tooltip import path); `effectLine` is never called for a base row (the row cannot be staged).

- [ ] **Step 4: Run, expect PASS; full wiring suite, typecheck, lint**

Run: `bun run test -- src/app/wiring && bun run typecheck && bun run lint`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/wiring
git commit -m "console wiring: mark compile's copies of base attachments and lock them on Surface"
```

---

### Task 9: Console Health counts base drift (F2)

**Files:**
- Modify: `apps/console/src/app/wiring/HealthTab.tsx` (groups ~ the `groups.*Entries` builder, cards, `clean`, `hasDrift` at ~389-398, a new group section)
- Test: `apps/console/src/app/wiring/__tests__/HealthTab.test.tsx`

**Interfaces:**
- Consumes: `SkillsCheckResponse.attachments`, `baseErrors` (Task 5).

- [ ] **Step 1: Failing tests**

Using the file's existing check fixture builder, add cases:

```ts
it('counts a stale base attachment as source newer and lists it under Org base', () => {
  // check: verbs all in-sync, attachments: [{ name: 'dev-servers', base: 'acme-base', status: 'stale', staleFiles: ['SKILL.md'], orphanFiles: [] }], baseErrors: []
  // expect the Source newer card to read 1, an "Org base" group listing "dev-servers" with "stale" and "acme-base", no "All in sync."
});
it('counts a never-compiled base attachment as never compiled', () => {});
it('lists an orphaned attachment (base: null) and a base error under Org base, counted in no card, and still not clean', () => {
  // attachments: [{ name: 'gone', base: null, status: 'orphaned', staleFiles: [], orphanFiles: ['SKILL.md'] }], baseErrors: ['acme-base has no attachments/feature-flags']
  // expect the row to read "gone" with "orphaned · compile removes it" and no "from null" anywhere in the tab
});
it('stays All in sync when attachments are all in-sync and there are no base errors', () => {});
it('reads as today when rt sends no attachments field', () => {});
```

Write each body fully against the test file's render helper and queries (read two existing tests in that file first and copy their shape).

- [ ] **Step 2: Run, expect FAIL**

Run: `bun run test -- src/app/wiring/__tests__/HealthTab.test.tsx`

- [ ] **Step 3: Implement**

```ts
  const attachments = checkQuery.data?.attachments ?? [];
  const baseErrors = checkQuery.data?.baseErrors ?? [];
  const staleCopies = attachments.filter(a => a.status === 'stale');
  const unbuiltCopies = attachments.filter(a => a.status === 'never-compiled');
  const baseRows = attachments.filter(a => a.status !== 'in-sync');
```

Add `staleCopies.length` to the Source newer card count and `unbuiltCopies.length` to the Never compiled card count; `clean` additionally requires `baseRows.length === 0 && baseErrors.length === 0`; `hasDrift` additionally is true when `baseRows.length > 0 || baseErrors.length > 0`. Render an "Org base" group (same component the other groups use) listing each `baseRows` entry as `<name>` with `from <base> · <status>`, or, for a row whose `base` is null (orphaned), `orphaned · compile removes it`, and each base error as its text, shown only when either list is non-empty. No row may render the text `null`.

- [ ] **Step 4: Run, expect PASS; typecheck**

Run: `bun run test -- src/app/wiring/__tests__/HealthTab.test.tsx && bun run typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/wiring
git commit -m "console health: count org base attachment drift and base errors"
```

---

### Task 10: Console history, diff and dirty files see the base (F9, F11)

**Files:**
- Modify: `apps/console/src/server/skills.ts` (`dirtyFilesIn` ~731-744, `/api/skills/history` ~1195-1279, `/api/skills/diff` ~1280-1362, `SkillsDiffResponse`, `SkillsHistoryResponse`)
- Create: `apps/console/src/server/baseScopes.ts` (+ `baseScopes.test.ts`)
- Modify: `apps/console/src/app/wiring/outline.ts` (`SlotOutlineNode` ~45, slot build ~337), `outline.test.ts`
- Modify: `apps/console/src/app/wiring/seamAttribution.ts:168-188`, the timeline's diff parsing (search `useDiff\|SkillsDiff` in `src/app/wiring`), `VersionTimeline.tsx:466-469`
- Test: `src/server/skills.test.ts` (history and diff), `src/app/wiring/seamAttribution.test.ts`, `VersionTimeline.test.tsx`

**Interfaces:**
- Produces:
  - `interface BaseScope { base: string; root: string; top: string }`: `root` the base pack root (realpath), `top` a dir relative to the repo top (`:(top)` pathspec body).
  - `baseScopesFor(composition, verb: string | null, repoRoot: string, realpath): Promise<BaseScope[]>`: one per distinct base fill dir the verb's slots (or, with no verb, every verb's slots) bind (roster verbs only: a pipeline stage's slots carry no `fillSourcePath`, the same gap as today, and the PR body says so), from slots with `origin === 'base'` whose `fillSourcePath` lies outside `packDir`; the dir is the fill's folder (`dirname(fillSourcePath)`), realpath'd, relativized against `repoRoot`; a dir that relativizes outside the repo (`..`) is dropped.
  - `toBaseCoordinate(path: string, scopes: BaseScope[], repoRoot: string): string`: a repo-root-relative path under a scope's root becomes `base:<name>/<path inside the base pack>`; any other path is returned unchanged.
  - `SkillsDiffResponse.baseDiff?: string` (paths rewritten), history `commits[].files` and `runtime.dirtyFiles` rewritten for base paths.
  - `seamPackPath(seam, index)` returns `base:<name>/<seam.path>` for a base seam; `SeamSourceIndex` gains optional `baseRoots?: Record<string, string>` (base name to root dir) built from composition slots with `origin === 'base'`.

- [ ] **Step 1: Failing unit tests for `baseScopes.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { baseScopesFor, toBaseCoordinate } from './baseScopes';

const repoRoot = '/o/acme';
const composition = {
  pack: 'acme',
  packDir: '/o/acme/mattstack/teams/acme/packs/acme',
  verbs: [
    { name: 'plan', slots: [
      { name: 'domain', fillSourcePath: '/o/acme/mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md', origin: 'base', base: 'acme-base' },
      { name: 'tiering', fillSourcePath: '/m/mattstack/attachments/model-tiering/SKILL.md' },
    ] },
    { name: 'ship', slots: [
      { name: 'domain', fillSourcePath: '/o/acme/mattstack/teams/acme/packs/acme/attachments/board-fill/SKILL.md', origin: 'base', base: 'acme-base' },
    ] },
  ],
};
const realpath = async (p: string) => p;

describe('baseScopesFor', () => {
  it('scopes a verb to the base fill dirs it binds, outside the pack', async () => {
    expect(await baseScopesFor(composition, 'plan', repoRoot, realpath)).toEqual([
      { base: 'acme-base', root: '/o/acme/mattstack/org/packs/acme-base', top: 'mattstack/org/packs/acme-base/attachments/plan-policy' },
    ]);
  });
  it('adds no scope for a team-pack copy of a base fill', async () => {
    expect(await baseScopesFor(composition, 'ship', repoRoot, realpath)).toEqual([]);
  });
  it('drops a base dir outside the repo', async () => {
    expect(await baseScopesFor(composition, 'plan', '/elsewhere', realpath)).toEqual([]);
  });
});

describe('toBaseCoordinate', () => {
  const scopes = [{ base: 'acme-base', root: '/o/acme/mattstack/org/packs/acme-base', top: 'mattstack/org/packs/acme-base/attachments/plan-policy' }];
  it('rewrites a repo path under a base root', () => {
    expect(toBaseCoordinate('mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md', scopes, repoRoot)).toBe('base:acme-base/attachments/plan-policy/SKILL.md');
  });
  it('leaves any other path alone', () => {
    expect(toBaseCoordinate('mattstack/teams/acme/packs/acme/skills/plan/SKILL.md', scopes, repoRoot)).toBe('mattstack/teams/acme/packs/acme/skills/plan/SKILL.md');
  });
});
```

The base root is derived with `pluginRootOf(fillSourcePath)` (from `src/shared/pluginRoot.ts`); the test expects it to be the `acme-base` folder.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun run test -- src/server/baseScopes.test.ts`

- [ ] **Step 3: Implement `baseScopes.ts`**

```ts
import { dirname, relative, sep } from 'node:path';

import { pluginRootOf } from '../shared/pluginRoot';

export interface BaseScope {
  base: string;
  root: string;
  top: string;
}

interface ScopeSlot {
  fillSourcePath?: string | null;
  origin?: 'base';
  base?: string;
}
interface ScopeComposition {
  packDir: string;
  verbs?: { name: string; slots: ScopeSlot[] }[];
}

const inside = (child: string, parent: string) =>
  child === parent || child.startsWith(`${parent}${sep}`);

/** A team-pack copy of a base fill is already in the pack's own scope, so only a fill outside the pack adds one. */
export async function baseScopesFor(
  composition: ScopeComposition,
  verb: string | null,
  repoRoot: string,
  realpath: (path: string) => Promise<string>
): Promise<BaseScope[]> {
  const scopes = new Map<string, BaseScope>();
  for (const v of composition.verbs ?? []) {
    if (verb !== null && v.name !== verb) continue;
    for (const slot of v.slots) {
      if (slot.origin !== 'base' || !slot.base || !slot.fillSourcePath) continue;
      if (inside(slot.fillSourcePath, composition.packDir)) continue;
      const pluginRoot = pluginRootOf(slot.fillSourcePath);
      if (!pluginRoot) continue;
      const dir = await realpath(dirname(slot.fillSourcePath)).catch(() => null);
      const root = await realpath(pluginRoot).catch(() => null);
      if (!dir || !root) continue;
      const top = relative(repoRoot, dir);
      if (top.startsWith('..')) continue;
      scopes.set(top, { base: slot.base, root, top });
    }
  }
  return [...scopes.values()];
}

export function toBaseCoordinate(
  path: string,
  scopes: BaseScope[],
  repoRoot: string
): string {
  for (const scope of scopes) {
    const rootTop = relative(repoRoot, scope.root);
    if (path.startsWith(`${rootTop}/`))
      return `base:${scope.base}/${path.slice(rootTop.length + 1)}`;
  }
  return path;
}
```

- [ ] **Step 4: Wire the routes, with failing route tests first**

In `skills.test.ts`, extend the fake `runGit` assertions: for `/api/skills/history?pack=acme&verb=plan`, the `log` argv ends `['--', 'skills/plan', ':(top)mattstack/org/packs/acme-base/attachments/plan-policy']`, and a commit file `mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md` comes back as `base:acme-base/attachments/plan-policy/SKILL.md`; the `status` argv carries the same extra pathspec and a dirty base file is rewritten the same way. For `/api/skills/diff`, a second `diff` call without `--relative` over the `:(top)` pathspecs of every verb's base scopes, its `+++ b/<path>` and `--- a/<path>` and `diff --git a/<path> b/<path>` headers rewritten to the coordinate, returned as `baseDiff`; with no base scopes there is no second call and no `baseDiff` key. The byte cap is shared: `boundDiff` the pack diff first, then the base diff with what is left (`MAX_DIFF_BYTES - packBytes`), `truncated` true if either was cut.

Implement in the routes: fetch composition with `cachedRun(['skills','composition','--pack',pack,'--json'])`, compute scopes with `baseScopesFor(composition, verb ?? null, repoRoot, realpath)` (the route's injected `realpath`), append `...scopes.map(s => \`:(top)${s.top}\`)` after the existing pathspec in `log` and in `dirtyFilesIn` (change its `scope: string` parameter to `scopes: string[]`), and map `toBaseCoordinate` over `commit.files` and dirty paths. A composition that fails to parse means no base scopes, never a failed route.

- [ ] **Step 5: Seam attribution and the timeline**

In `seamAttribution.test.ts`, a seam `{ kind: 'slot', slot: 'domain', ref: 'acme-base:plan-policy', path: 'attachments/plan-policy/SKILL.md', lines: [1, 40] }` with `index.fillSourcePaths.domain = '/o/acme/mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md'`, `index.baseRoots = { 'acme-base': '/o/acme/mattstack/org/packs/acme-base' }` gives `seamPackPath` `base:acme-base/attachments/plan-policy/SKILL.md`, and `attributeHunk({ path: 'base:acme-base/attachments/plan-policy/SKILL.md', lines: [3, 5] }, ...)` names that seam. A seam whose ref is a plugin keeps returning null.

Add `origin?: 'base'` and `base?: string` to `SlotOutlineNode` (`src/app/wiring/outline.ts:~45`) and copy them from the composition slot where `outline.ts` sets `fillSourcePath` (~line 337), with an `outline.test.ts` case that a base slot keeps them. Make `baseRoots` optional on `SeamSourceIndex` (`baseRoots?: Record<string, string>`), so `SeamCompare.tsx`'s `NO_INDEX` fallback (~244) keeps compiling unchanged; SeamCompare gets its real index from VersionTimeline.

Implement: in `seamPackPath`, before the `pluginOf(seam.ref) !== index.pack` bail, `const base = pluginOf(seam.ref); const baseRoot = index.baseRoots?.[base]; if (baseRoot && absolute.startsWith(\`${baseRoot}/\`)) return \`base:${base}/${seam.path}\`;`. Build `baseRoots` where the index is built (`VersionTimeline.tsx:~233-245`) from the `SlotOutlineNode`s with `origin === 'base'`, root from `pluginRootOf` imported from `src/shared/pluginRoot`. Where the timeline parses `diff.diff` into hunks, also parse `diff.baseDiff ?? ''` and concatenate the hunks. Add a `VersionTimeline.test.tsx` case: a composition whose domain slot is a base fill, a diff response whose `baseDiff` holds one hunk inside that fill's seam span, and the timeline shows that change attributed to the domain slot (copy the file's existing attribution test and change the data).

`VersionTimeline.tsx:466-469`: replace the sentence with "The step's own source lives in its engine plugin, and base fills in the org's base pack, outside this pack's folder." and update `VersionTimeline.test.tsx`'s expectation of it.

- [ ] **Step 6: Run everything touched**

Run: `bun run test -- src/server src/app/wiring && bun run typecheck && bun run lint`

- [ ] **Step 7: Commit**

```bash
git add apps/console/src
git commit -m "console wiring: history, diff and seams follow a verb into its org base fills"
```

---

### Task 11: Console names the base the pack extends (F10)

**Files:**
- Modify: `apps/console/src/app/wiring/WiringMap.tsx` (the toolbar row with the `Open pack` button and pack `Select`)
- Test: `apps/console/src/app/wiring/WiringMap.test.tsx`

**Interfaces:**
- Consumes: `SkillsCompositionResponse.extends` (Task 5).

- [ ] **Step 1: Failing test**

With the file's existing composition mock, add `extends: { name: 'acme-base', version: '0.1.0' }` and assert `screen.getByText('extends acme-base')` is in the toolbar; with `extends: null` and with the key absent, `queryByText(/^extends /)` is null.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun run test -- src/app/wiring/WiringMap.test.tsx`

- [ ] **Step 3: Implement**

Beside the pack picker, when `composition.extends` is set, render a kit `Badge` (variant and colour matching the page's other neutral badges, e.g. the `public verb` badge in `FocusHeader.tsx`) reading `extends ${composition.extends.name}`, with `title` `This pack's fills and shared attachments come partly from the org's ${name} base pack.`.

- [ ] **Step 4: Run, expect PASS; typecheck, lint**

Run: `bun run test -- src/app/wiring/WiringMap.test.tsx && bun run typecheck && bun run lint`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/wiring
git commit -m "console wiring: show the base a pack extends"
```

---

### Task 12: Design fixture scenarios with an org base (F12)

**Files:**
- Modify: `apps/console/src/server/fixtures/design/scenarios.ts` (table, `SCENARIOS`, defs)
- Create: `apps/console/src/server/fixtures/design/files/orgbase/acme-base/attachments/plan-policy/SKILL.md`, `files/orgbase/acme-base/.claude-plugin/plugin.json`, `files/packs/acme/attachments/dev-servers/SKILL.md`, `files/packs/acme/attachments/dev-servers/compiled.json`
- Modify: `fixtureRt.ts`: answer `skills surface list --pack acme --json` (today it refuses every surface call)
- Test: `fixtureRt.test.ts`, `boards.test.ts` (must stay green: the board scenarios do not change)

**Interfaces:**
- Consumes: every field from Tasks 2 to 4 (fixture JSON mirrors rt).
- Produces: scenarios `org-base` and `org-base-drift`, subject `stage-plan`.

- [ ] **Step 1: Failing fixture tests**

In `fixtureRt.test.ts`: under `org-base`, composition `extends` is `{ name: 'acme-base', version: '0.1.0' }`; stage-plan's `domain` slot is bound to `acme-base:plan-policy` with `fillSourcePath` `/fixture/orgbase/acme-base/attachments/plan-policy/SKILL.md`, `fillVersion: 'org'` and the three origin fields; the matching `fills[]` row is tagged; the stage-plan anatomy's domain part `source` is tagged with `ref: 'acme-base:plan-policy'`, `version: 'org'`, `builtVersion: 'org'`; check's `attachments` is `[{ name: 'dev-servers', base: 'acme-base', status: 'in-sync', staleFiles: [], orphanFiles: [] }]` and `baseErrors: []`; the anatomy's `links` include `../../attachments/dev-servers/SKILL.md`. Under `org-base-drift`, the same with the attachment `stale` (`staleFiles: ['SKILL.md']`) and `baseErrors: ['acme-base has no attachments/feature-flags']`, and check exits 1. Reading the base fill file through `readPackFile` succeeds. Under both org scenarios, `surface list --json` answers `{ pack: 'acme', packDir: '/fixture/packs/acme', rows: [...] }` holding `{ name: 'dev-servers', kind: 'compiled', status: 'internal', base: 'acme-base' }` beside a plain compiled row and a fill row; every other scenario keeps refusing surface, as today.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun run test -- src/server/fixtures/design`

- [ ] **Step 3: Implement**

Add both names to `SCENARIOS` and the table comment. Each def edits `clean` data: `composition` maps the stage-plan verb's and the `mattstack:stage-plan` binder's `domain` slot and the `acme:plan-policy` fill to the base binding and path, and adds `extends`; `check` adds `attachments` and `baseErrors`; `anatomy['stage-plan']` edits `anatomy.stage-plan.json`'s domain part source and appends the link. Add a `surface` case to `fixtureRt.ts`'s switch: `if (argv[2] === 'list' && def.surface) return answer(JSON.stringify(def.surface));` else refuse, with `surface?: { pack: string; packDir: string; rows: { name: string; kind: string; status: string; base?: string }[] }` on `ScenarioDef`. Put the plan-policy text in the base file (copy `files/packs/acme/attachments/plan-policy/SKILL.md`) and write a short `dev-servers/SKILL.md` ("Start the dev servers for acme widgets." and two lines of placeholder steps). `compiled.json`: `{"base":"acme-base","version":"0.1.0","files":["SKILL.md"]}`.

- [ ] **Step 4: Run, expect PASS, boards included**

Run: `bun run test -- src/server/fixtures/design`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/server/fixtures/design
git commit -m "console fixture: org-base and org-base-drift scenarios"
```

---

### Task 13: Docs, full checks and rendering in both schemes

**Files:**
- Modify: `apps/console/AGENTS.md` (Wiring map section: one paragraph on base packs: `ownerOf`, origin fields, the `base:<name>/` coordinate, the two scenarios)
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` only if `bun cli.ts mcp tools --json` output changed (it should not)
- No product code unless rendering shows a defect; a defect found here gets its own test and commit.

- [ ] **Step 1: Docs**

Add to `apps/console/AGENTS.md` under "Wiring map", after the Writes bullet:

```markdown
- **Org base packs.** rt tags a fill, slot, binder slot or anatomy source from an org base pack with `origin: "base"`, `base` and `baseVersion` (a team-pack copy carrying `compiled.json` included), names the pack's base in composition's `extends`, and marks surface rows with `base`. Every view reads the owner through `ownerOf` (`owner.ts`), never by comparing plugin names or reading rt's `org` version token. History, diff and dirty files name a base path as `base:<name>/<path in the base>`. The design fixture's `org-base` and `org-base-drift` scenarios draw all of it.
```

- [ ] **Step 2: Run every gate**

Run, from the repo root: `bun run check` and `bun test lib/skills/__tests__/origin.test.ts lib/skills/__tests__/sources.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills-bind.test.ts lib/skills/__tests__/anatomy.test.ts`; from `apps/console`: `bun run test && bun run typecheck && bun run lint && bun run format:check`.
Expected: all green. Fix anything red with a test-first commit.

- [ ] **Step 3: Render the fixture scenarios, light and dark**

From `apps/console`: `bun x vite build`, then `CONSOLE_FIXTURE=design CONSOLE_FIXTURE_SCENARIO=org-base PORT=11092 bun run src/server/index.ts` (background; stop it by its own task when done). In Fast Browser (`fast-browser:fast-browsing`, one `browser_run_code_unsafe` per flow), at 1500x950, for each scheme (the console's colour scheme toggle in the rail, or `localStorage` key the kit uses; find it in `@mattstack/app-kit`): screenshot `/wiring?pack=acme&focus=stage-plan`, the domain card's drawer (Text, Used by, History tabs), the rebind panel and its option list, a link to `dev-servers`, Surface, and Health. Restart with `org-base-drift` and screenshot Health. Save into `.superpowers/shots/`. The fixture's repo root is the pack dir, so `/fixture/orgbase` is outside it and the base pathspec in history and diff (F9) is never exercised there: F9 is checked on the live render only (Step 4). Look at each one and write down plainly what reads wrong (wording, overlap, contrast, a badge that clips).

- [ ] **Step 4: Render the live org, light and dark**

The served console reads the installed `rt`, which does not have this branch's rt changes. Write a scratch launcher in the scratchpad (never committed) that starts the console server with its `runRt` replaced by one spawning `bun <worktree>/cli.ts` (see how `src/server/index.ts` builds the app and how `mountSkills` takes `runRt`), on port 11093, and view the real team pack the same way as Step 3, including a verb with a base fill's History tab, to check F9: a base commit in the list and its files in the `base:<name>/` coordinate. Never restart the deck-served console. Screenshots of the live org contain real names: keep them in `.superpowers/shots/live/` (git-ignored) and never attach them to the PR.

- [ ] **Step 5: Notes for the PR body**

Append to `.superpowers/pr-notes.md` (git-ignored), for the integrator: `rt skills surface list --json` now reports a base row's `status` as `internal` (a value change, keys unchanged); a pipeline stage that binds a base fill gets no base history (stage slots carry no `fillSourcePath`, as before), and a base fill bound only through a binder gets no seam attribution (binder-only slots have `fillSourcePath: null`); files both this branch and the rt-followups lane changed, from `git diff --name-only origin/main...HEAD` intersected with that lane's list (ask it in chat).

- [ ] **Step 6: Commit the docs**

```bash
git add apps/console/AGENTS.md
git commit -m "console AGENTS: org base packs on the wiring page"
```
