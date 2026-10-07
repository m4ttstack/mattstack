# Base pack attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt skills compile` writes an org base pack's attachments into the team pack that extends it, so a file a skill opens at run time reaches every team.

**Architecture:** A new pure-ish module `lib/skills/base-attachments.ts` plans the emit (which base folders, their rendered files, the `compiled.json` provenance, the stale folders to remove, and the clash errors). `commands/skills.ts` computes that plan before any target compiles, hands the planned file set to `{{pack.path}}` so a team verb can address an emitted file on a clean compile or a dry run, writes the emitted folders first in the write pass, and reports drift from `rt skills check`. A new `substituteAttachmentPlaceholders` beside `substituteIncludesOnly` renders `.md` files with exactly `{{pack.name}}`, `{{verb.path}}` and `{{pack.path}}`.

**Tech Stack:** Bun, TypeScript, `bun:test`.

**Spec:** `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/gilraen/docs/superpowers/specs/2026-10-06-orgs-root-design.md`, section 7 and the "Compile tests for base attachments" line of section 10. Read-only; it lives in another worktree.

## Global Constraints

- No em dashes or en dashes anywhere (code, comments, tests, commit messages).
- Placeholder names only in committed text and fixtures: acme, widgets, gadgets, dev1, dev2, gitlab.example.com. The base pack in fixtures is `acme-base`.
- A `SkillsUsageError` message that exists today keeps its exact words. New messages are new strings.
- Everything printed goes through `lib/ui/out.ts` builders; no `console.*`, no ANSI.
- Run tests from the repo root only, one file at a time: `bun test <path>`. Never the full suite.
- Comments only state a constraint the code cannot show.
- `compile --json` keys stay frozen (`commands/__tests__/skills-json-frozen.test.ts`). `check --json` gains exactly one key, `attachments`, appended last; that frozen test is updated deliberately in Task 4.
- Write only under: `lib/skills/`, `commands/skills.ts`, `commands/skills-*.ts`, `commands/__tests__/skills*.ts`, `lib/skills/__tests__/`, `docs/superpowers/plans/`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes (the spec is silent)

- **Planned paths, not disk order alone.** The spec says compile emits base attachments before targets compile so `{{pack.path}}` finds them on disk. Today every target is compiled before anything is written (all or nothing), and `--dry-run`, `--preview` and `check` never write. So the plan's file set is handed to `packPath` as `plannedAttachments` (attachment name to the set of files it will hold). For a name in that map, `packPath` trusts the map instead of the disk; every other name is checked on disk as today. The write pass still writes emitted folders before verbs.
- **A pack that extends a base but has no verbs still emits.**
- **`--verb` scoping**: compile always plans and emits the whole base set (it is pack-level). `check --verb` leaves the `attachments` rows empty.
- **Which files**: every regular file under the base folder except names starting with `.`, `__pycache__/` folders and `*.pyc`. `README.md` is copied (the vendoring filter that drops it does not apply here).
- **Version**: `compiled.json`'s `version` is the base's `.claude-plugin/plugin.json` version, or `null` when the base has none. `check` masks it, the way it masks SKILL.md provenance, so a version-only bump is not drift.
- **Malformed known placeholders error** (`{{pack.name:x}}`, `{{verb.path}}` with no verb, a bad `{{pack.path}}`); any other `{{...}}` passes through.
- **A base folder with its own root `compiled.json`** is a plan error (the name is reserved).
- **A base attachment with `metadata.provides`** is a fill and is never emitted. Includes resolve only from the mattstack plugin, so a base attachment is never an include target; the section 10 "fill or include not emitted" test is the `provides` case.

## Review Focus

1. A base attachment's own `SKILL.md` naming its own nested file with `{{pack.path:<self>/references/x.md}}` on a clean compile: must compile (Task 1 and Task 2 tests).
2. A base drops one file from an attachment it keeps: the next compile rewrites the folder without the file and lists it as removed; `check` before that reports it as an orphan file (Task 3 and Task 4 tests).
3. Brace text that is not one of the three placeholders (`{{slot:x}}`, `{{include:y}}`, `{{ name }}`, `${{ secrets.X }}`) in a `.md` passes through untouched, and a script with `{{pack.name}}` in it is copied byte for byte (Task 1 and Task 3 tests).
4. A failed target compile or a `--dry-run` leaves no emitted folder on disk (Task 3 test).
5. A team that deletes an emitted folder and authors its own (no `compiled.json`) is never overwritten by later compiles, even after the base changes (Task 3 test).

---

### Task 1: Attachment placeholder rendering and planned pack paths

**Files:**
- Modify: `lib/skills/types.ts` (add `plannedAttachments` to `PlaceholderContext`)
- Modify: `lib/skills/placeholders.ts` (`packPath` honours the plan; new `substituteAttachmentPlaceholders`)
- Test: `lib/skills/__tests__/placeholders.test.ts`

**Interfaces:**
- Produces:
  - `PlaceholderContext.plannedAttachments?: ReadonlyMap<string, ReadonlySet<string>>` (attachment name to the files, relative to its folder, compile will leave under `attachments/<name>/`; an empty set means compile removes that folder).
  - `export type PlannedAttachments = ReadonlyMap<string, ReadonlySet<string>>` in `types.ts`.
  - `export function substituteAttachmentPlaceholders(body: string, opts: AttachmentRenderOpts): string` with
    `export type AttachmentRenderOpts = { packName: string; fileRel: string; verbSides: Record<string, Side>; packRoot: string; plannedAttachments?: PlannedAttachments; where: string }`. `fileRel` is pack-relative with `/` separators, e.g. `attachments/review-kit/references/guide.md`.

- [ ] **Step 1: Write the failing tests** (append to `placeholders.test.ts`; add `substituteAttachmentPlaceholders` to the import)

```ts
describe("pack.path with planned attachments", () => {
  test("a planned file is addressable before it exists on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-pack-path-planned-"));
    const planned = new Map([["review-kit", new Set(["references/guide.md"])]]);
    expect(substitute("{{pack.path:review-kit/references/guide.md}}", ctx({ packRoot: root, plannedAttachments: planned }), "ship").body)
      .toBe("${CLAUDE_SKILL_DIR}/../../attachments/review-kit/references/guide.md");
  });

  test("a planned attachment ignores what is on disk for that name", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-pack-path-planned-"));
    mkdirSync(join(root, "attachments", "review-kit"), { recursive: true });
    writeFileSync(join(root, "attachments", "review-kit", "old.md"), "old\n");
    const planned = new Map([["review-kit", new Set(["references/guide.md"])]]);
    expect(() => substitute("{{pack.path:review-kit/old.md}}", ctx({ packRoot: root, plannedAttachments: planned }), "ship"))
      .toThrow("ship: {{pack.path:review-kit/old.md}} -- attachments/review-kit/old.md does not exist");
  });

  test("an attachment planned for removal is not a directory", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-pack-path-planned-"));
    mkdirSync(join(root, "attachments", "gone"), { recursive: true });
    writeFileSync(join(root, "attachments", "gone", "x.md"), "x\n");
    const planned = new Map([["gone", new Set<string>()]]);
    expect(() => substitute("{{pack.path:gone/x.md}}", ctx({ packRoot: root, plannedAttachments: planned }), "ship"))
      .toThrow("ship: {{pack.path:gone/x.md}} -- gone is not a directory under attachments/ or skills/");
  });
});

describe("substituteAttachmentPlaceholders", () => {
  const sides = { work: "skills", ship: "skills", "stage-plan": "attachments" } as const;
  function opts(over: Partial<Parameters<typeof substituteAttachmentPlaceholders>[1]> = {}) {
    const root = mkdtempSync(join(tmpdir(), "rt-attach-render-"));
    return {
      packName: "widgets", fileRel: "attachments/review-kit/SKILL.md", verbSides: { ...sides }, packRoot: root,
      plannedAttachments: new Map([["review-kit", new Set(["SKILL.md", "references/guide.md"])]]),
      where: "acme-base:attachments/review-kit/SKILL.md", ...over,
    };
  }

  test("pack.name is the compiling pack's plugin name", () => {
    expect(substituteAttachmentPlaceholders("run {{pack.name}}:ship", opts())).toBe("run widgets:ship");
  });

  test("verb.path is relative to the file's own folder", () => {
    expect(substituteAttachmentPlaceholders("{{verb.path:ship}} {{verb.path:stage-plan}}", opts()))
      .toBe("../../skills/ship/SKILL.md ../stage-plan/SKILL.md");
    expect(substituteAttachmentPlaceholders("{{verb.path:ship}} {{verb.path:stage-plan}}", opts({ fileRel: "attachments/review-kit/references/guide.md" })))
      .toBe("../../../skills/ship/SKILL.md ../../stage-plan/SKILL.md");
  });

  test("pack.path resolves in the team pack, through the plan", () => {
    expect(substituteAttachmentPlaceholders("{{pack.path:review-kit/references/guide.md}}", opts()))
      .toBe("${CLAUDE_SKILL_DIR}/../../attachments/review-kit/references/guide.md");
  });

  test("any other brace text passes through", () => {
    const text = "{{slot:domain}}\n{{include:core}}\n{{ name }}\n${{ secrets.TOKEN }}\n{{Upper}}";
    expect(substituteAttachmentPlaceholders(text, opts())).toBe(text);
  });

  test("a malformed known placeholder is an error naming the file", () => {
    expect(() => substituteAttachmentPlaceholders("{{pack.name:x}}", opts()))
      .toThrow("acme-base:attachments/review-kit/SKILL.md: {{pack.name:x}} -- pack.name takes no argument");
    expect(() => substituteAttachmentPlaceholders("{{verb.path:nope}}", opts()))
      .toThrow("acme-base:attachments/review-kit/SKILL.md: {{verb.path:nope}} -- nope is not a compiled verb of this pack");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/skills/__tests__/placeholders.test.ts`
Expected: FAIL (`substituteAttachmentPlaceholders` is not exported; `plannedAttachments` ignored).

- [ ] **Step 3: Implement**

In `types.ts`:

```ts
export type PlannedAttachments = ReadonlyMap<string, ReadonlySet<string>>;
```

and add to `PlaceholderContext`: `plannedAttachments?: PlannedAttachments;`

In `placeholders.ts`, change `packPath` to take the three fields it reads, so the new function can call it without a full context, and teach it the plan. Replace its doc comment with one that says emitted base attachments are addressable too:

```ts
type PackPathView = Pick<PlaceholderContext, "verbSides" | "packRoot" | "plannedAttachments">;

/**
 * Anchored on the invoking skill's dir rather than this file's, so the same
 * text works inside a shell command from any public skill in the pack. A
 * compiled target's output is written only after every target compiles, so
 * naming one would pass the existence check on a recompile and fail on a
 * clean one. Pack-authored source is addressable, and so are the base
 * attachments compile emits: they are planned before any target compiles,
 * and for those names the plan, not the disk, says what will exist.
 */
function packPath(view: PackPathView, arg: string | undefined, raw: string, where: string): string {
  // ...argument checks unchanged...
  if (attachment in view.verbSides) throw new Error(`${where}: ${raw} -- ${attachment} is a compiled verb; pack.path names source files only`);
  const packRoot = view.packRoot;
  if (!packRoot) throw new Error(`${where}: ${raw} -- pack.path needs a pack root`);
  const planned = view.plannedAttachments?.get(attachment);
  const onAttachments = planned ? planned.size > 0 : isDirectory(join(packRoot, "attachments", attachment));
  const onSkills = isDirectory(join(packRoot, "skills", attachment));
  if (onAttachments && onSkills) throw new Error(`${where}: ${raw} -- ${attachment} exists under both attachments/ and skills/`);
  const side = onAttachments ? "attachments" : onSkills ? "skills" : null;
  if (!side) throw new Error(`${where}: ${raw} -- ${attachment} is not a directory under attachments/ or skills/`);
  const rel = `${side}/${attachment}/${file}`;
  const exists = side === "attachments" && planned ? planned.has(file) : existsSync(join(packRoot, rel));
  if (!exists) throw new Error(`${where}: ${raw} -- ${rel} does not exist`);
  return `${SKILL_DIR_TOKEN}/../../${rel}`;
}
```

Existing callers pass `ctx` unchanged (it satisfies `PackPathView`). Every existing error string keeps its words.

Add beside `substituteIncludesOnly`:

```ts
export type AttachmentRenderOpts = {
  packName: string;
  fileRel: string;
  verbSides: Record<string, Side>;
  packRoot: string;
  plannedAttachments?: PlannedAttachments;
  where: string;
};

/**
 * An emitted base attachment is read as a plain file, so it gets only what
 * makes sense outside a compiled verb; every other brace passes through so
 * template examples in the text survive.
 */
export function substituteAttachmentPlaceholders(body: string, opts: AttachmentRenderOpts): string {
  const { where } = opts;
  return body.replace(PLACEHOLDER_RE, (raw, kind: string, arg?: string) => {
    switch (kind) {
      case "pack.name":
        if (arg !== undefined) throw new Error(`${where}: ${raw} -- pack.name takes no argument`);
        return opts.packName;
      case "verb.path": {
        if (arg === undefined || !VERB_NAME_RE.test(arg)) throw new Error(`${where}: ${raw} -- verb name must match [a-z][a-z0-9-]*`);
        const side = opts.verbSides[arg];
        if (!side) throw new Error(`${where}: ${raw} -- ${arg} is not a compiled verb of this pack`);
        return posix.relative(posix.dirname(opts.fileRel), `${side}/${arg}/SKILL.md`);
      }
      case "pack.path":
        return packPath(opts, arg, raw, where);
      default:
        return raw;
    }
  });
}
```

Import `posix` from `"path"` and `Side`, `PlannedAttachments` from `./types.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/skills/__tests__/placeholders.test.ts`
Expected: PASS, including every pre-existing `pack.path` and `verb.path` test.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/types.ts lib/skills/placeholders.ts lib/skills/__tests__/placeholders.test.ts
git commit -m "skills: render base attachment placeholders and plan-aware pack paths"
```

---

### Task 2: Plan the base attachments a pack receives

**Files:**
- Create: `lib/skills/base-attachments.ts`
- Modify: `lib/skills/sources.ts` (export `readJsoncObject` and `listDirs`; no behaviour change)
- Test: `lib/skills/__tests__/base-attachments.test.ts`

**Interfaces:**
- Consumes: `substituteAttachmentPlaceholders`, `PlannedAttachments` (Task 1); `orgOfPackDir`, `readJsoncObject`, `listDirs`, `stripFrontmatter` (sources.ts); `HEADER_COMMENT` (compile.ts); `packPluginIdentity` (provenance.ts); `TEAM_NAME_RE` (`../settings/stores.ts`); `CompiledFile`, `Side` (types.ts).
- Produces:

```ts
export const PROVENANCE_FILE = "compiled.json";
export type BaseRef = { name: string; dir: string; version: string | null };
export type EmittedAttachment = { name: string; files: CompiledFile[] };
export type StaleAttachment = { name: string; why: "dropped" | "no-base" };
export type BaseAttachmentPlan = {
  base: BaseRef | null;
  emits: EmittedAttachment[];   // sorted by name; each files[] sorted by path, compiled.json included
  kept: string[];               // team-owned folders that shadow a base attachment
  stale: StaleAttachment[];     // emitted folders on disk compile will remove
  errors: string[];
};
export function planBaseAttachments(input: { packDir: string; packName: string; verbSides: Record<string, Side> }): BaseAttachmentPlan;
export function plannedAttachmentsOf(plan: BaseAttachmentPlan): PlannedAttachments; // emits -> their file paths, stale -> empty set
export function isEmittedAttachmentDir(dir: string): boolean; // root compiled.json parses as an object with a string `base`
export function isEmittedAttachmentText(text: string | null): boolean; // the same test on text, for the mcp lint's read seam
export function listAttachmentFiles(dir: string): string[];
export function isSkippedAttachmentPath(rel: string): boolean; // true for a path listAttachmentFiles never lists
export function maskProvenanceVersion(text: string): string;
```

`compiled.json` content, exactly:

```ts
JSON.stringify({ base: base.name, version: base.version, files }, null, 2) + "\n"
```

where `files` is every other file emitted in that folder, sorted.

- [ ] **Step 1: Write the failing tests**

Fixture helper inside the test file (an org clone with a marker, a base, and a team pack under it; all in a temp dir):

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { HEADER_COMMENT } from "../compile.ts";
import { isEmittedAttachmentDir, maskProvenanceVersion, planBaseAttachments, plannedAttachmentsOf } from "../base-attachments.ts";

let root: string;
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const baseDir = () => join(root, "mattstack", "org", "packs", "acme-base");
const packDir = () => join(root, "mattstack", "teams", "widgets", "packs", "widgets");
const plan = (verbSides: Record<string, "skills" | "attachments"> = { ship: "skills" }) =>
  planBaseAttachments({ packDir: packDir(), packName: "widgets", verbSides });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-base-attach-")));
  put(join(root, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme" }));
  put(join(baseDir(), "pack", "skills.jsonc"), JSON.stringify({ base: true }));
  put(join(baseDir(), ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "1.4.0" }));
  put(join(packDir(), "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
```

Tests (one `test` each):

1. `emits every non-fill attachment with compiled.json listing its files`: base has `attachments/review-kit/SKILL.md` (`---\nname: review-kit\n---\nUse {{pack.name}}:ship.\n`), `attachments/review-kit/references/guide.md`, `attachments/review-kit/scripts/run.sh` (`echo {{pack.name}}\n`), `attachments/review-kit/README.md`, `attachments/review-kit/.DS_Store`. Expect `plan().errors` `[]`, one emit named `review-kit`, file paths `["README.md", "SKILL.md", "compiled.json", "references/guide.md", "scripts/run.sh"]`; SKILL.md content contains `Use widgets:ship.`; `scripts/run.sh` is `{ copyFrom: <abs base path> }`; compiled.json content equals `JSON.stringify({ base: "acme-base", version: "1.4.0", files: ["README.md", "SKILL.md", "references/guide.md", "scripts/run.sh"] }, null, 2) + "\n"`.
2. `a fill (metadata.provides) is not emitted`: base `attachments/watch-ci-domain/SKILL.md` with `---\nname: watch-ci-domain\nmetadata:\n  provides: watch-ci-domain@1\n---\nbody\n`. Expect `emits` empty.
Wherever a test below puts a pack-side `compiled.json` to stand for an emitted folder, its content is `JSON.stringify({ base: "acme-base", version: null, files: [] })`.

3. `no extends emits nothing and marks every emitted folder stale`: rewrite the pack's skills.jsonc to `{}`; put `attachments/review-kit/compiled.json` and `attachments/own/SKILL.md` in the pack. Expect `base` null, `emits` `[]`, `stale` `[{ name: "review-kit", why: "no-base" }]`.
4. `an emitted folder whose base attachment is gone is stale`: pack has `attachments/old-kit/compiled.json`; base has only `review-kit`. Expect `stale` `[{ name: "old-kit", why: "dropped" }]`.
5. `a team's own folder wins`: pack has `attachments/review-kit/SKILL.md` (no compiled.json); base has `review-kit`. Expect `emits` `[]`, `kept` `["review-kit"]`, `errors` `[]`.
6. `a name that is a compile target is an error naming both`: base `review-kit`, `verbSides` `{ "review-kit": "attachments" }`. Expect `errors` `["acme-base attachment review-kit has the same name as the widgets verb review-kit; rename one of them"]`.
7. `a hand-authored skills/<name> is an error naming both, a compiled one is not`: pack `skills/review-kit/SKILL.md` plain. Expect `errors` `["acme-base attachment review-kit has the same name as the widgets skill skills/review-kit; rename one of them"]`. Then rewrite that SKILL.md to `---\nname: review-kit\n---\n${HEADER_COMMENT}\nbody\n` and expect `errors` `[]`.
8. `extends a base that is missing, unmarked, or itself extends`: three sub-cases, expected errors exactly `widgets extends nope, but the org has no base pack called nope`, `widgets extends acme-base, but the org's acme-base pack is not marked as a base pack`, `widgets extends acme-base, which extends other; a base pack cannot extend another`; and `extends: "Bad Name"` gives `widgets extends "Bad Name", which is not a base pack name`.
9. `a pack outside any org repo cannot extend`: a pack in a fresh temp dir with `{ extends: "acme-base" }`. Expect `["widgets extends acme-base, but it is not inside an org repo"]`.
10. `a base folder carrying its own compiled.json is refused`: expect `["acme-base attachment review-kit carries compiled.json, a name compile keeps for itself"]`.
11. `pack.path from a base file to its own nested file resolves on a clean plan`: base SKILL.md body `see {{pack.path:review-kit/references/guide.md}}`. Expect content contains `${CLAUDE_SKILL_DIR}/../../attachments/review-kit/references/guide.md` and `errors` `[]`.
12. `a placeholder error becomes a plan error`: base SKILL.md body `{{verb.path:nope}}`. Expect `errors[0]` toBe `acme-base:attachments/review-kit/SKILL.md: {{verb.path:nope}} -- nope is not a compiled verb of this pack`.
13. `plannedAttachmentsOf maps emits to their files and stale folders to nothing`, `isEmittedAttachmentDir`, and `maskProvenanceVersion` (both `"version": "1.4.0"` and `"version": null` mask to the same text).
14. `a hand-authored compiled.json is data, not provenance`: pack skills.jsonc `{}`, pack `attachments/data/compiled.json` = `{"rows": []}\n`. Expect `stale` `[]`; `isEmittedAttachmentDir` false for it, and also false for `[]`, `{"base": 3}` and unparseable text.
15. `a clashing name is reported once`: base `review-kit/SKILL.md` body `{{pack.path:review-kit/x.md}}`, `verbSides` `{ "review-kit": "attachments" }`. Expect `errors` to be exactly the one clash message from test 6.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/skills/__tests__/base-attachments.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/skills/base-attachments.ts`**

Shape (fill in exactly these behaviours):

```ts
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { TEAM_NAME_RE } from "../settings/stores.ts";
import { HEADER_COMMENT } from "./compile.ts";
import { substituteAttachmentPlaceholders } from "./placeholders.ts";
import { packPluginIdentity } from "./provenance.ts";
import { listDirs, orgOfPackDir, readJsoncObject, stripFrontmatter } from "./sources.ts";
import type { CompiledFile, PlannedAttachments, Side } from "./types.ts";

export const PROVENANCE_FILE = "compiled.json";

/** A hand-authored data file may also be called compiled.json, so only compile's own shape marks a folder as output. */
export function isEmittedAttachmentText(text: string | null): boolean {
  if (text === null) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { base?: unknown }).base === "string";
  } catch {
    return false;
  }
}

export function isEmittedAttachmentDir(dir: string): boolean {
  const path = join(dir, PROVENANCE_FILE);
  return existsSync(path) && isEmittedAttachmentText(readFileSync(path, "utf8"));
}

export function maskProvenanceVersion(text: string): string {
  return text.replace(/"version": (?:"[^"]*"|null)/, '"version": "*"');
}
```

Helpers:
- `isSkippedAttachmentPath(rel)`: true when any `/` segment starts with `.` or is `__pycache__`, or the path ends `.pyc`.
- `listAttachmentFiles(dir)` (exported): recursive, regular files only, `/`-joined relative paths, dropping every path `isSkippedAttachmentPath` matches, sorted.
- `isFill(dir)`: `SKILL.md` exists and its frontmatter `metadata.provides` is a non-empty string.
- `isHandAuthored(dir)`: `SKILL.md` exists and its stripped body does not start with `HEADER_COMMENT` (same test as `isCompiledDir`).
- `resolveBase(packDir, packName, name)`: returns `BaseRef` or an error string, in this order: `typeof name !== "string"` (when `extends` is present but not a string) gives `${packName}'s extends is not a string`; `orgOfPackDir(packDir)` null gives `${packName} extends ${name}, but it is not inside an org repo`; `!TEAM_NAME_RE.test(name)` gives `${packName} extends "${name}", which is not a base pack name`; fragment at `<root>/mattstack/org/packs/<name>/pack/skills.jsonc` missing gives `... but the org has no base pack called ${name}`; `base !== true` gives `... but the org's ${name} pack is not marked as a base pack`; a string `extends` in it gives `${packName} extends ${name}, which extends ${x}; a base pack cannot extend another`. Version: `packPluginIdentity(dir)?.version || null`.

`planBaseAttachments`:
1. `ext = readJsoncObject(join(packDir, "pack", "skills.jsonc"))?.extends`.
2. `onDiskEmitted` = `listDirs(join(packDir, "attachments"))` filtered by `isEmittedAttachmentDir`.
3. `ext === undefined`: return `{ base: null, emits: [], kept: [], stale: onDiskEmitted.map(n => ({ name: n, why: "no-base" })), errors: [] }`.
4. Resolve base; on error return `{ base: null, emits: [], kept: [], stale: [], errors: [error] }` (nothing is removed while the pack is broken).
5. For each `name` of `listDirs(join(base.dir, "attachments"))` (skip names starting with `.`), skip fills. Collect errors for: `name in verbSides` (message in test 6); a hand-authored `packDir/skills/<name>` (test 7); a root `compiled.json` in the base folder (test 10). A name that hit any of these is not recorded or rendered, so it yields exactly one error. If `packDir/attachments/<name>` exists and is not emitted, push to `kept` and skip. Otherwise record `{ name, srcDir, files: listAttachmentFiles(srcDir) }`.
6. Build `planned: Map<string, Set<string>>` from those records (each set includes `compiled.json`), plus each stale name (`onDiskEmitted` not in the records, `why: "dropped"`) mapped to an empty set.
7. Render: for each record and file, `.md` files become `{ path, content: substituteAttachmentPlaceholders(readFileSync(abs, "utf8"), { packName, fileRel: \`attachments/${name}/${file}\`, verbSides, packRoot: packDir, plannedAttachments: planned, where: \`${base.name}:attachments/${name}/${file}\` }) }`, catching a thrown error into `errors` (its message, unchanged); other files become `{ path, copyFrom: abs }`. Append the `compiled.json` file and sort `files` by `path`.
8. If `errors` is non-empty, return them with `emits: []` and `stale: []`. Otherwise return the plan.

`plannedAttachmentsOf(plan)`: `new Map([...plan.emits.map(e => [e.name, new Set(e.files.map(f => f.path))]), ...plan.stale.map(s => [s.name, new Set()])])`.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/skills/__tests__/base-attachments.test.ts lib/skills/__tests__/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/base-attachments.ts lib/skills/sources.ts lib/skills/__tests__/base-attachments.test.ts
git commit -m "skills: plan the base pack attachments a team pack receives"
```

---

### Task 3: Compile emits, removes and reports base attachments

**Files:**
- Modify: `lib/skills/compile.ts` (`compileSkill` opts gain `plannedAttachments`, copied into `ctx`)
- Modify: `commands/skills.ts` (`isCompiledDir`, `compileVerb`, `tryCompileVerb`, `writeCompiledVerb`, `performCompile`, `compileBlocks`, `skillsCompile`, `compilePackAll`)
- Test: `commands/__tests__/skills.test.ts` (new `describe("base pack attachments", ...)` beside the existing org base pack tests near line 615)

**Interfaces:**
- Consumes: `planBaseAttachments`, `plannedAttachmentsOf`, `isEmittedAttachmentDir`, `BaseAttachmentPlan` (Task 2); `PlannedAttachments` (Task 1).
- Produces:
  - `compileVerb(target, resolved, emittedTargetDirs, verbSides, trace?, planned?: PlannedAttachments)` and `tryCompileVerb(target, resolved, emittedTargetDirs, verbSides, planned?: PlannedAttachments)`.
  - `function basePlanFor(resolved: Resolved, verbSides: Record<string, Side>): BaseAttachmentPlan` calling `planBaseAttachments({ packDir: resolved.packDir, packName: packPluginIdentity(resolved.packDir)?.name ?? resolved.team, verbSides })`.
  - `performCompile(resolved, verbFilter, write, plan: BaseAttachmentPlan)` returns its old fields plus `emitted: EmittedRow[]` where `export type EmittedRow = { name: string; base: string; files: number } | { name: string; removed: true; why: "dropped" | "no-base" }`.
  - `compileBlocks(rows: CompiledRow[], writing: boolean, emitted: EmittedRow[] = [])`.

- [ ] **Step 1: Write the failing tests**

Fixture: reuse `makeMattstackDir`, `seedOrg`, `teamPackDir`, `materializeRepo`, `realInitFsForTests`, `STUBS_JSONC`, `DOMAIN_SKILL_MD`, `CI_CONFIG_JSON` exactly as the test "a team pack compiles a fill that lives in the org base pack" does. Helper inside the describe:

```ts
function seedBaseAndTeam(opts: { domainBody?: string } = {}) {
  const mattstackDir = makeMattstackDir();
  seedOrg(mattstackDir, "acme", { projects: ["acme/widgets"], teams: ["widgets"] });
  const baseDir = join(mattstackDir, "teams", "acme", "mattstack", "org", "packs", "acme-base");
  const packDir = teamPackDir(mattstackDir, "acme", "widgets");
  writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true, bindings: { "mattstack:watch-ci": { domain: "acme-base:watch-ci-domain", forge: "mattstack:gitlab-forge" } } }));
  writeFile(join(baseDir, "attachments", "watch-ci-domain", "SKILL.md"), opts.domainBody ?? DOMAIN_SKILL_MD);
  writeFile(join(baseDir, "attachments", "watch-ci-domain", "ci-config.json"), CI_CONFIG_JSON);
  writeFile(join(baseDir, "attachments", "review-kit", "SKILL.md"), "---\nname: review-kit\ndescription: shared review notes\n---\nInvoke {{pack.name}}:watch-ci. Read {{verb.path:watch-ci}}.\n");
  writeFile(join(baseDir, "attachments", "review-kit", "references", "guide.md"), "Back to {{verb.path:watch-ci}}. Keep {{slot:x}} and ${{ secrets.TOKEN }}.\n");
  writeFile(join(baseDir, "attachments", "review-kit", "scripts", "run.sh"), "#!/bin/sh\necho '{{pack.name}}' '{{verb.path:watch-ci}}'\n");
  chmodSync(join(baseDir, "attachments", "review-kit", "scripts", "run.sh"), 0o755);
  writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
  writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
  writeFile(join(packDir, "pack", "stubs.jsonc"), STUBS_JSONC);
  const out = materializeRepo({ fs: realInitFsForTests, mattstackRoot: mattstackDir, enginePackDir: join(mattstackDir, "plugins", "mattstack") }, "https://gitlab.example.com/acme/widgets.git");
  if (out.kind !== "written") throw new Error(out.kind);
  const compile = (...extra: string[]) => runExpectingCleanExit(() =>
    skillsCompile(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, ...extra]));
  return { mattstackDir, baseDir, packDir, compile };
}
```

If `.claude-plugin/plugin.json` in the pack changes how `resolve()` registers the pack as a plugin in a way that breaks this fixture, drop that line and expect `{{pack.name}}` to render as `widgets` (the `resolved.team` fallback); the expected text below is the same either way.

Tests:

1. `emits a base attachment with compiled.json, renders the three placeholders by depth, and copies scripts byte for byte`: `compile()`; errors `[]`. `attachments/review-kit/SKILL.md` is `---\nname: review-kit\ndescription: shared review notes\n---\nInvoke widgets:watch-ci. Read ../../skills/watch-ci/SKILL.md.\n`; `references/guide.md` is `Back to ../../../skills/watch-ci/SKILL.md. Keep {{slot:x}} and ${{ secrets.TOKEN }}.\n`; `scripts/run.sh` equals the base file byte for byte and `statSync(...).mode & 0o111` is non-zero; `compiled.json` parses to `{ base: "acme-base", version: null, files: ["SKILL.md", "references/guide.md", "scripts/run.sh"] }`.
2. `a fill in the base is inlined, never emitted`: after `compile()`, `existsSync(join(packDir, "attachments", "watch-ci-domain"))` is false and `skills/watch-ci/SKILL.md` contains `acme-base:watch-ci-domain`.
3. `a team verb reaches an emitted file through pack.path on a clean compile`: `seedBaseAndTeam({ domainBody: DOMAIN_SKILL_MD.replace(/\n$/, "\nSee {{pack.path:review-kit/references/guide.md}}.\n") })` (if `DOMAIN_SKILL_MD` does not end in a newline, append the line instead); `compile()` errors `[]`; `skills/watch-ci/SKILL.md` contains `${CLAUDE_SKILL_DIR}/../../attachments/review-kit/references/guide.md`; then `rmSync` the pack's `attachments/review-kit` and run `compile("--dry-run")`: errors `[]` and the folder is still absent.
4. `a team's own folder wins`: write `packDir/attachments/review-kit/SKILL.md` = `team copy\n` before `compile()`; afterwards it is still `team copy\n` and no `compiled.json` sits beside it. Change the base SKILL.md and compile again: still `team copy\n`.
5. `a base attachment named like a verb or a hand-authored skill is refused, and nothing is written`: (a) write base `attachments/watch-ci/SKILL.md`; `compile()` errors joined contain `acme-base attachment watch-ci has the same name as the widgets verb watch-ci; rename one of them`, `exitCode` non-zero, and `existsSync(join(packDir, "attachments", "review-kit"))` is false. (b) fresh fixture, write `packDir/skills/review-kit/SKILL.md` = `---\nname: review-kit\n---\nmine\n`; errors contain `acme-base attachment review-kit has the same name as the widgets skill skills/review-kit; rename one of them`.
6. `cleanup after the base drops an attachment and after extends is dropped`: `compile()`; `rmSync(join(baseDir, "attachments", "review-kit"), { recursive: true })`; `compile()`; the pack's `attachments/review-kit` is gone. Second fixture: `compile()`; rewrite the pack's `pack/skills.jsonc` to `{}`, re-run `materializeRepo(...)` with the same args, `compile()`; folder gone. A team's own `attachments/own/SKILL.md` survives both.
7. `a base file dropped from a kept attachment is removed on the next compile`: `compile()`; `rmSync` base `references/guide.md`; `compilePackAll({ packDir, mattstackDir })` returns `ok: true` and `removed` contains a path ending `attachments/review-kit/references/guide.md`; `written` contains one ending `attachments/review-kit/compiled.json`.
8. `a dry run and a failed verb leave no emitted folder`: `compile("--dry-run")` leaves `attachments/review-kit` absent. Then bind the domain slot to a fill that does not exist by writing the base `pack/skills.jsonc` binding `domain: "acme-base:does-not-exist"`, re-materialize, `compile()`; exit non-zero and the folder is still absent.
9. `the human output names what was copied`: `compile()` and assert the captured stdout contains `Copied review-kit` and `from acme-base, 3 files`; after dropping the base attachment and compiling, `Removed review-kit`.
10. `isCompiledDir treats an emitted folder as compiled`: after `compile()`, `computeRows(packDir, new Set(["watch-ci"]), null, new Set()).rows.find(r => r.name === "review-kit")?.kind` is `"compiled"`; for a team folder without `compiled.json` it is `"hand-authored"`.
11. `a pack that extends a base but has no verbs still emits`: fixture variant with `stubs.jsonc` omitted (skip `materializeRepo` when it refuses a rosterless pack). With no verbs `verbSides` is empty, so rewrite the base `review-kit/SKILL.md` to `---\nname: review-kit\n---\nInvoke {{pack.name}}:ship.\n` and `references/guide.md` to `Notes for {{pack.name}}.\n` (run.sh stays). `compile()` errors `[]` and writes `attachments/review-kit/compiled.json`.
12. `anatomy resolves pack.path to an emitted file on a clean tree`: the test 3 fixture (domain fill carrying `{{pack.path:review-kit/references/guide.md}}`), no compile run. `skillsAnatomy(["--skill", "watch-ci", "--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--json"])` completes without error, and its JSON output contains `attachments/review-kit/references/guide.md`.
13. `a pack that never extends keeps a hand-authored compiled.json`: plain team pack (skills.jsonc `{}`), `attachments/data/compiled.json` = `{"rows": []}\n` plus `attachments/data/SKILL.md`; after `compile()` both files are still there.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/skills.test.ts -t "base pack attachments"`
Expected: FAIL (nothing emitted).

- [ ] **Step 3: Implement**

`lib/skills/compile.ts`: add `plannedAttachments?: PlannedAttachments` to `compileSkill`'s `opts` and `plannedAttachments: opts.plannedAttachments` to `ctx`.

`commands/skills.ts`:

```ts
function isCompiledDir(dir: string): boolean {
  if (isEmittedAttachmentDir(dir)) return true;
  const skillMdPath = join(dir, "SKILL.md");
  if (!existsSync(skillMdPath)) return false;
  const { body } = stripFrontmatter(readFileSync(skillMdPath, "utf8"));
  return body.startsWith(HEADER_COMMENT);
}
```

Update the `classify` doc comment to say a dir carrying `compiled.json` is compiled output too.

`compileVerb` / `tryCompileVerb`: accept `planned?: PlannedAttachments` and pass `plannedAttachments: planned` to `compileSkill`. Every `compileVerb` caller passes the plan: `tryCompileVerb`, `computeCheck` (Task 4), and `skillsAnatomy` (about line 1775), which computes `basePlanFor(resolved, plan.verbSides)`, throws a `SkillsUsageError` on plan errors exactly as `skillsCompile` does, and passes `plannedAttachmentsOf(...)` as the sixth argument after the trace callback.

`writeCompiledVerb(packDir, outDir, result: { files: CompiledFile[] }, into)`: widen the parameter type only.

`basePlanFor` as in Interfaces.

`performCompile(resolved, verbFilter, write, plan)`:
- Pass `plannedAttachmentsOf(plan)` to every `tryCompileVerb`.
- In the `writing` branch, before the target loop: for each `plan.stale`, `removeCompiledDir(resolved.packDir, join(resolved.packDir, "attachments", s.name), writes)`; for each `plan.emits`, `writeCompiledVerb(resolved.packDir, join(resolved.packDir, "attachments", e.name), e, writes)`.
- `emitted` rows: one per emit `{ name, base: plan.base!.name, files: e.files.length - 1 }` (the count excludes `compiled.json`), then one per stale `{ name, removed: true, why }`.

`skillsCompile`: right after the chain error check, compute `const { verbSides } = compileTargets(resolved, publicSet, flags.verbs); const plan = basePlanFor(resolved, verbSides);` and `if (plan.errors.length > 0) throw new SkillsUsageError(plan.errors.join("\n"), { title: "This pack's base attachments cannot be copied", details: plan.errors.join("\n") });`. `--preview` passes `plannedAttachmentsOf(plan)` to `tryCompileVerb`. Pass `plan` to `performCompile`. The human branch calls `compileBlocks(compiled, writing, emitted)`. The `--json` branch keeps its keys; `written` becomes `writing && (outcomes.length > 0 || emitted.length > 0)`, so a rosterless pack that copied folders reports `true`.

`compilePackAll`: same plan after the chain check; `if (plan.errors.length > 0) return { ok: false, errors: plan.errors, written: [], removed: [] };`; pass `plan` to `performCompile`.

`compileBlocks`:

```ts
export function compileBlocks(rows: CompiledRow[], writing: boolean, emitted: EmittedRow[] = []): Block[] {
  if (rows.length === 0 && emitted.length === 0) return [out.line("skipped", "Nothing to compile", "this pack has no verbs")];
  const copies = emitted.map((row) => "removed" in row
    ? writing
      ? out.line("done", `Removed ${row.name}`, row.why === "dropped" ? "its base no longer has it" : "this pack no longer extends a base")
      : out.line("pending", row.name, "would remove")
    : writing
      ? out.line("done", `Copied ${row.name}`, `from ${row.base}, ${countOf(row.files, "file", "files")}`)
      : out.line("pending", row.name, `would copy ${countOf(row.files, "file", "files")} from ${row.base}`));
  return [...copies, ...rows.flatMap(/* existing body unchanged */)];
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test commands/__tests__/skills.test.ts`, then `bun test commands/__tests__/skills-compile-output.test.ts commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-sync.test.ts commands/__tests__/skills-bind.test.ts lib/skills/__tests__/compile.test.ts`
Expected: PASS. A pre-existing test that calls `compileBlocks` or `performCompile` keeps passing because the new parameters default.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/compile.ts commands/skills.ts commands/__tests__/skills.test.ts
git commit -m "skills: compile copies a base pack's attachments into the team pack"
```

---

### Task 4: `rt skills check` reports base attachment drift

**Files:**
- Modify: `commands/skills.ts` (`CheckPayload`, `computeCheck`, `checkBlocks`, `skillsCheck`)
- Test: `commands/__tests__/skills.test.ts` (inside the Task 3 describe), `commands/__tests__/skills-json-frozen.test.ts`

**Interfaces:**
- Consumes: `basePlanFor`, `plannedAttachmentsOf`, `maskProvenanceVersion`, `PROVENANCE_FILE` (Tasks 2 and 3).
- Produces:

```ts
type AttachmentCheckRow = {
  name: string;
  base: string | null;
  status: "in-sync" | "stale" | "never-compiled" | "orphaned";
  staleFiles: string[];
  orphanFiles: string[];
};
// CheckPayload gains `attachments: AttachmentCheckRow[]` (after strictLint).
// skillsCheck --json writes { pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint, attachments }.
```

- [ ] **Step 1: Write the failing tests**

In the base attachments describe (reusing `seedBaseAndTeam`):

1. `check is clean right after a compile`: `compile()`; `(await checkPack({ packDir, mattstackDir })).attachments` equals `[{ name: "review-kit", base: "acme-base", status: "in-sync", staleFiles: [], orphanFiles: [] }]` and `drift` is false.
2. `a base change is drift`: `compile()`; append a line to base `references/guide.md`; row status `stale`, `staleFiles` `["references/guide.md"]`, `drift` true.
3. `a base file removed is an orphan; a base version bump alone is not drift`: `compile()`; write the base `.claude-plugin/plugin.json` with version `2.0.0`: still `in-sync`. Remove base `scripts/run.sh`: `stale`, `staleFiles` `["compiled.json"]`, `orphanFiles` `["scripts/run.sh"]`.
4. `never compiled and orphaned`: before any compile the row is `never-compiled`. After `compile()` and dropping the base `review-kit`, the row is `{ name: "review-kit", base: null, status: "orphaned", staleFiles: [], orphanFiles: ["SKILL.md", "compiled.json", "references/guide.md", "scripts/run.sh"] }`.
5. `the human output names drift and the fix`: after test 2's change, `skillsCheck(["--team", "widgets", "--pack-dir", packDir, "--mattstack-dir", mattstackDir])` stdout contains `review-kit`, `changed since the last compile: references/guide.md` and `rt skills compile`; exit code 1.
6. `run leftovers are not drift`: `compile()`; write `attachments/review-kit/scripts/__pycache__/run.cpython-312.pyc` and `attachments/review-kit/.DS_Store` in the pack; the row is still `in-sync` and `drift` is false.
7. `a plan error fails check`: base `attachments/watch-ci/SKILL.md` makes `checkPack` reject with a message containing `has the same name as the widgets verb watch-ci`.

In `skills-json-frozen.test.ts`, update the check test to destructure `attachments` too and expect `JSON.stringify({ pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint, attachments })`, and rename it to say the key order includes `attachments` last.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/skills.test.ts -t "base pack attachments" && bun test commands/__tests__/skills-json-frozen.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `computeCheck`, after `compileTargets`: `const plan = basePlanFor(resolved, verbSides); if (plan.errors.length > 0) throw new SkillsUsageError(plan.errors.join("\n"));` and pass `plannedAttachmentsOf(plan)` to each `compileVerb`. When `flags.verbs` is null, build rows:

```ts
/** Files a run leaves beside the copy (a script's __pycache__, a git-ignored output) are not drift, matching the verb rows. */
function leftovers(packDir: string, name: string): string[] {
  const rel = join("attachments", name);
  const files = listFilesRecursive(join(packDir, rel)).filter((f) => !isSkippedAttachmentPath(f));
  const ignored = gitIgnoredFiles(packDir, files.map((f) => join(rel, f)));
  return files.filter((f) => !ignored.has(join(rel, f))).sort();
}

function attachmentRows(packDir: string, plan: BaseAttachmentPlan): AttachmentCheckRow[] {
  const rows: AttachmentCheckRow[] = [];
  for (const emit of plan.emits) {
    const dir = join(packDir, "attachments", emit.name);
    const base = plan.base!.name;
    if (!existsSync(dir)) { rows.push({ name: emit.name, base, status: "never-compiled", staleFiles: [], orphanFiles: [] }); continue; }
    const staleFiles: string[] = [];
    for (const file of emit.files) {
      const dest = join(dir, file.path);
      if (!existsSync(dest)) { staleFiles.push(file.path); continue; }
      if (file.path === PROVENANCE_FILE && "content" in file) {
        if (maskProvenanceVersion(readFileSync(dest, "utf8")) !== maskProvenanceVersion(file.content)) staleFiles.push(file.path);
        continue;
      }
      const expected = "content" in file ? Buffer.from(file.content) : readFileSync(file.copyFrom);
      if (!readFileSync(dest).equals(expected)) staleFiles.push(file.path);
    }
    const expected = new Set(emit.files.map((f) => f.path));
    const orphanFiles = leftovers(packDir, emit.name).filter((f) => !expected.has(f));
    rows.push({ name: emit.name, base, status: staleFiles.length || orphanFiles.length ? "stale" : "in-sync", staleFiles, orphanFiles });
  }
  for (const s of plan.stale) {
    rows.push({ name: s.name, base: null, status: "orphaned", staleFiles: [], orphanFiles: leftovers(packDir, s.name) });
  }
  return rows;
}
```

`listFilesRecursive` is the helper `writeCompiledVerb` already uses; it returns `/`-joined paths in directory order, hence the sorts. Any row not `in-sync` sets `anyStale`.

`checkBlocks`: after the verb rows and before the `next` callout, one line per attachment row: `in-sync` gives `out.line("done", row.name, \`copied from ${row.base}, current\`)`; `never-compiled` gives `out.line("stale", row.name, \`not copied from ${row.base} yet\`)`; `stale` gives `out.line("stale", row.name, \`changed since the last compile: ${files}\`)` with the same `files` join as verb rows; `orphaned` gives `out.line("stale", row.name, "its base no longer has it")`. Every non-`in-sync` row sets `stale` so the `rt skills compile` callout prints.

`skillsCheck --json`: append `attachments` last.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test commands/__tests__/skills.test.ts && bun test commands/__tests__/skills-json-frozen.test.ts && bun test commands/__tests__/skills-check-strict.test.ts && bun test commands/__tests__/skills-sync.test.ts && bun test commands/__tests__/skills-report-output.test.ts`
Expected: PASS. If a test builds a `CheckPayload` literal, add `attachments: []` to it.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills.test.ts commands/__tests__/skills-json-frozen.test.ts
git commit -m "skills: check reports drift in copied base attachments"
```

---

### Task 5: The mcp lint skips emitted base attachments

**Files:**
- Modify: `lib/skills/mcp-lint.ts` (`lintedSources`)
- Test: `lib/skills/__tests__/mcp-lint.test.ts` (in `describe("lintPackDir on disk")`)

**Interfaces:**
- Consumes: `PROVENANCE_FILE`, `isEmittedAttachmentText` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
test("a folder carrying compiled.json is compiled output and skipped whole", () => {
  const pack = mkdtempSync(join(tmpdir(), "rt-mcp-lint-emitted-"));
  try {
    mkdirSync(join(pack, "attachments", "review-kit", "references"), { recursive: true });
    mkdirSync(join(pack, "attachments", "own"), { recursive: true });
    writeFileSync(join(pack, "attachments", "review-kit", "compiled.json"), JSON.stringify({ base: "acme-base", version: null, files: [] }));
    mkdirSync(join(pack, "attachments", "data"), { recursive: true });
    writeFileSync(join(pack, "attachments", "data", "compiled.json"), "{\"rows\": []}\n");
    writeFileSync(join(pack, "attachments", "data", "SKILL.md"), "`git push`\n");
    writeFileSync(join(pack, "attachments", "review-kit", "SKILL.md"), "`git push`\n");
    writeFileSync(join(pack, "attachments", "review-kit", "references", "x.md"), "`git push -u`\n");
    writeFileSync(join(pack, "attachments", "review-kit", "run.sh"), "git push\n");
    writeFileSync(join(pack, "attachments", "own", "SKILL.md"), "`git push`\n");
    expect(lintPackDir(pack, RULES).map((h) => h.file)).toEqual([join(pack, "attachments", "data", "SKILL.md"), join(pack, "attachments", "own", "SKILL.md")]);
    expect(lintPackScripts(pack, RULES)).toEqual([]);
  } finally {
    rmSync(pack, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/mcp-lint.test.ts`
Expected: FAIL (the emitted folder's files are linted).

- [ ] **Step 3: Implement**

Rename `compiledVerbDir` to `compiledDir` and update the doc comment above `lintedSources` to say a folder carrying `compiled.json` (an emitted base attachment) is output the same way:

```ts
const compiledDir = (path: string): boolean => {
  const root = roots.find((r) => path.startsWith(r))!;
  const segments = path.slice(root.length).split(sep);
  if (segments.length < 2) return false;
  const dir = join(root, segments[0]!);
  return isEmittedAttachmentText(read(join(dir, PROVENANCE_FILE))) || (read(join(dir, "SKILL.md"))?.includes(HEADER_COMMENT) ?? false);
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills/__tests__/mcp-lint.test.ts lib/skills/__tests__/mcp-lint-rules-hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/mcp-lint.ts lib/skills/__tests__/mcp-lint.test.ts
git commit -m "skills: the mcp lint skips emitted base attachments"
```

---

### Task 6: Whole-branch gates

- [ ] `bun run typecheck` is clean.
- [ ] Every touched test file passes, run one at a time from the repo root.
- [ ] `bun test lib/__tests__` passes (the no-* guards: raw output, no em dashes, no UI in CLI).
- [ ] `bun run check` passes.
- [ ] `git grep -nP "[\x{2013}\x{2014}]" -- lib/skills commands/skills.ts commands/__tests__ docs/superpowers/plans/2026-10-07-base-pack-attachments.md` prints nothing.
