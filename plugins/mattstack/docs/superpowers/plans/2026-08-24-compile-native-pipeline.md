# Compile-Native Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the pipeline engines to a compile-native representation so a compiled `work` run performs zero runtime resolution: placeholders only the compiler fills, per-stage compiled skills, one run-state store, and the console's seam-marker contract preserved.

**Architecture:** The compiler (`repo-tools`, `lib/skills/` + `commands/skills.ts`) gains a placeholder substitution pass, manifest-derived stage targets emitted to the pack's `attachments/` side, a compile-time chain check, and a compile gate that emits internal targets instead of deleting them. The engines (`mattstack-skills`, `attachments/pipeline/*`, `attachments/review/*`) are rewritten with placeholders and stripped of every runtime resolver call and every `uow.json` reference. Both halves ship together as one mattstack release plus one pack recompile.

**Tech Stack:** Bun + TypeScript (compiler, `bun test`), POSIX sh + jq + sqlite3 (`pipeline-state.sh`), Markdown SKILL.md engines certified by `tests/certify.sh` and `tests/repo-purity.sh`.

**Spec:** `docs/superpowers/specs/2026-08-24-compile-native-pipeline-design.md` (this repo). Executors read the spec alongside every task; the plan argues from it.

## Global Constraints

- Placeholder syntax is exactly `{{name}}` or `{{name:arg}}`; eight kinds: `slot`, `include`, `pipeline.stages`, `work-type`, `stage.fields`, `stage.dir`, `run-start.flags`, `compiled-from`. No escaping, conditionals, or loops.
- Any unfilled placeholder in compiled output is a hard compile error naming placeholder, engine, and line.
- The emitted frontmatter key stays `metadata.compiled`; `{{compiled-from}}` names only the value.
- Seam markers are preserved for every inlined region, per compiled file, with plugin-relative `path=` and 1-indexed inclusive `lines=` in SOURCE coordinates. Third kind: `<!-- part: include:<attachment> source=<plugin>:<attachment> version=<v> path=<p> lines=<a>-<b> -->`.
- Stages are emitted to `attachments/stage-<name>/`; internal compile targets are emitted to `attachments/<name>/`, never skipped or deleted; public to `skills/<name>/`.
- `defaultPublicSet` must never include stages.
- An `{{include}}` target must be slotless and contain no placeholder.
- A compile-native engine must not call `resolve-args.sh`; a runtime-native skill (`mr-board:*`) must not contain `{{`.
- `--pack-dirs` is derived at run time by `git -C "${CLAUDE_SKILL_DIR}" rev-parse --show-toplevel`; `--mattstack-sha` and `--mattstack-dirty` are baked into `{{run-start.flags}}`.
- No run-DB schema change. New `run-start` flags `--ticket`, `--mattstack-sha`, `--mattstack-dirty` write existing columns.
- This repo is public: every file must pass `tests/repo-purity.sh`. Never write a team, product, or customer name into a mattstack-skills file. Use `<pack>` / "a team pack".
- Clean-code comments: a comment states a constraint the code cannot show; never narrates the next line or cites a review/ticket.

---

## Base branch (read first)

Phase A builds on repo-tools `origin/main` at or after `841d4068`
("machine-readable substrate for the console", #66), in the worktree
`.claude/worktrees/compile-native-pipeline` on branch
`worktree-compile-native-pipeline`. That commit added to the compiler,
and every Phase A task assumes it is present:

- `commands/skills.ts`: `--json` on compile/check/surface; `rt skills packs`,
  `composition`, `bind`; `tryCompileVerb` (per-verb degrade for `--json` /
  `--preview`); `Resolved` already has `team`, `fullRoster`, `manifestPath`.
  Line numbers in this plan are approximate against that file; anchor on
  function names.
- `lib/skills/sources.ts`: `readManifestPipelines` **already exists**
  (line ~340). Task 5 does not create it.
- `lib/skills/compile.ts`: exported `isInlined(fill, internalRoster)` is the
  registered-skill rule; Task 6 uses it rather than re-deriving.

Run `git log --oneline -1` in the worktree before Task 1 and confirm the
SHA is `841d4068` or a descendant; if it is not, stop and say so.

## File structure

**repo-tools (compiler)**

- `lib/skills/types.ts` — modify: add `PlaceholderContext`, `StageEntry`; extend `StepSource` with `stageMeta` and `description`; `CompileResult` unchanged.
- `lib/skills/placeholders.ts` — create: the substitution pass. One responsibility: turn a body with `{{…}}` into a body with none, emitting seam markers, or throw.
- `lib/skills/chain.ts` — create: compile-time produce/consume validation. Pure function over the manifest pipeline order + stage frontmatter.
- `lib/skills/compile.ts` — modify: `buildBody` calls the placeholder pass instead of appending fills; `include` handling; stage `allowed-tools` union with wildcard rewrite; `lintReferences` allowance for emitted sibling dirs.
- `lib/skills/sources.ts` — modify: `loadStepSource` reads `metadata.stage*`; new `readManifestPipelines`; new `loadInclude`; `readVerbRoster` unchanged, new `stageRoster`.
- `commands/skills.ts` — modify: compile gate (internal → `attachments/`), stage targets, stale-side removal, `skillsCheck` placement, `defaultPublicSet`, `classify`.
- `lib/skills/__tests__/placeholders.test.ts` — create.
- `lib/skills/__tests__/chain.test.ts` — create.
- `lib/skills/__tests__/compile.test.ts` — modify: markers, include, stage allowed-tools.
- `lib/skills/__tests__/surface.test.ts` — modify: stage default-internal, stale-side removal.

**mattstack-skills (engines)**

- `attachments/pipeline/work/SKILL.md` — rewrite body with placeholders; delete §3 uow, resolver prose, `PACK_DIRS` block.
- `attachments/pipeline/work/scripts/pipeline-state.sh` — add `--ticket`, `--mattstack-sha`, `--mattstack-dirty` to `run-start`.
- `attachments/pipeline/work/scripts/resolve-pipeline.sh`, `resolve-args.sh` — delete from `work` (chain check moves to compiler).
- `attachments/pipeline/stage-*/SKILL.md` (8) — promote to typed `slots:` + `type: pipeline-step`; `{{slot:domain}}`, `{{stage.fields}}`; delete resolver prose and uow prose; delete each `scripts/resolve-args.sh`.
- `attachments/pipeline/ship/SKILL.md`, `watch-ci/SKILL.md`, `attachments/orchestration/shepherdr/SKILL.md`, `attachments/review/{review,self-review,receive-review}/SKILL.md` — placeholders; delete resolver prose and relative-path reads.
- `attachments/review-core-body/`, `review-core-body-after/`, `review-dispatch-body/`, `review-dispatch-body-after/` — create (four slotless include bodies, cut around the criteria and reviewer slots); delete `attachments/review-core/`, `attachments/review-dispatch/`.
- `lib/skills/__tests__/helpers.ts` (repo-tools) — create: `runExpectingCleanExit`, lifted from `surface.test.ts`.
- `attachments/review-posting/SKILL.md` — `../` reads become `{{include}}`.
- `attachments/parameterized-skills/references/convention.md` — add compile-native/runtime-native rule; delete "Unit-of-work record" section.
- `plugin/schemas/uow.md`, `plugin/schemas/uow.schema.json`, README entry — delete.
- `tests/certify.sh` — add the runtime-native `{{` check.
- `.claude-plugin/plugin.json` — bump.

**Team pack (private repo, outside both public repos)** — two domain fills edited: the plan-policy fill and the gates fill, uow references → run DB fields. Compile + bump + push.

---

## Phase A — Compiler (repo-tools)

### Task 1: Placeholder parser and the unfilled-placeholder error

**Files:**
- Create: `lib/skills/placeholders.ts`
- Create: `lib/skills/__tests__/placeholders.test.ts`

**Interfaces:**
- Produces: `findPlaceholders(body: string): Placeholder[]` where `Placeholder = { kind: string; arg: string | null; line: number; raw: string }`; `assertNoPlaceholders(body: string, where: string): void` throwing `Error("<where>: unfilled placeholder {{…}} at line N")`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/skills/__tests__/placeholders.test.ts
import { describe, expect, test } from "bun:test";
import { assertNoPlaceholders, findPlaceholders } from "../placeholders.ts";

describe("findPlaceholders", () => {
  test("finds kind, arg, and 1-indexed line", () => {
    const body = "intro\n{{slot:tiering}}\nmid {{work-type}} tail\n{{include:review-core-body}}";
    expect(findPlaceholders(body)).toEqual([
      { kind: "slot", arg: "tiering", line: 2, raw: "{{slot:tiering}}" },
      { kind: "work-type", arg: null, line: 3, raw: "{{work-type}}" },
      { kind: "include", arg: "review-core-body", line: 4, raw: "{{include:review-core-body}}" },
    ]);
  });

  test("ignores braces that are not placeholders", () => {
    expect(findPlaceholders("json {\"a\":1} and {single}")).toEqual([]);
  });
});

describe("assertNoPlaceholders", () => {
  test("passes a clean body", () => {
    expect(() => assertNoPlaceholders("no braces here", "work")).not.toThrow();
  });

  test("names placeholder, engine, and line", () => {
    expect(() => assertNoPlaceholders("a\nb {{stage.dir}} c", "stage-plan")).toThrow(
      "stage-plan: unfilled placeholder {{stage.dir}} at line 2",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/Documents/GitHub/repo-tools && bun test lib/skills/__tests__/placeholders.test.ts`
Expected: FAIL, `Cannot find module "../placeholders.ts"`

- [ ] **Step 3: Implement**

```ts
// lib/skills/placeholders.ts
export type Placeholder = { kind: string; arg: string | null; line: number; raw: string };

const PLACEHOLDER_RE = /\{\{([a-z][a-z0-9.-]*)(?::([^}\s]+))?\}\}/g;

export function findPlaceholders(body: string): Placeholder[] {
  const out: Placeholder[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i]!.matchAll(PLACEHOLDER_RE)) {
      out.push({ kind: m[1]!, arg: m[2] ?? null, line: i + 1, raw: m[0] });
    }
  }
  return out;
}

export function assertNoPlaceholders(body: string, where: string): void {
  const first = findPlaceholders(body)[0];
  if (first) throw new Error(`${where}: unfilled placeholder ${first.raw} at line ${first.line}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills/__tests__/placeholders.test.ts`
Expected: 4 pass

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/repo-tools
git add lib/skills/placeholders.ts lib/skills/__tests__/placeholders.test.ts
git commit -m "skills: placeholder parser and unfilled-placeholder guard"
```

---

### Task 2: Placeholder context type and stage metadata on StepSource

**Files:**
- Modify: `lib/skills/types.ts`
- Modify: `lib/skills/sources.ts:151-219` (`loadStepSource`)
- Modify: `lib/skills/__tests__/sources.test.ts`

**Interfaces:**
- Produces on `StepSource`: `stageMeta: { stage: string; consumes: string[]; produces: string[] } | null` (null for non-stage engines).
- Produces: `PlaceholderContext` type consumed by Task 3. `slotMode` carries the per-slot decision `buildBody` makes today from `fill.registered` + the internal roster: `inline` (paste the body), `reference` (emit the "invoke that skill" line). `partsPrefix` is where a fill's own files are addressed from: `${CLAUDE_SKILL_DIR}/parts` in a verb, `<stageDir>/parts` in a stage.

```ts
export type StageEntry = {
  name: string; stage: string; dir: string; consumes: string[]; produces: string[];
};
export type PlaceholderContext = {
  fills: Record<string, AttachmentSource | null>;
  slotMode: Record<string, "inline" | "reference">;
  partsPrefix: string;
  includes: Record<string, AttachmentSource>;
  pipelines: Record<string, StageEntry[]>;
  repoKey: string;
  mattstackSha: string;
  mattstackDirty: 0 | 1;
  stageDir: string | null;
  stageMeta: StepSource["stageMeta"];
  compiledFrom: string;
};
```

Also add to `StepSource`: `description: string` (read from `frontmatter.description`, default `""`), which Task 7 uses to synthesize a stage's `VerbDef`. Adding two required fields means every `StepSource` literal in `lib/skills/__tests__/compile.test.ts` (4), `surface.test.ts` (6), and `sources.test.ts` must gain `stageMeta: null, description: ""` -- do that sweep in this task so `bunx tsc --noEmit` is clean before committing.

- [ ] **Step 1: Write the failing test**

`sources.test.ts` already imports `loadStepSource`, `mkdirSync`, `mkdtempSync`, `writeFileSync`, `tmpdir`, and `join`; a second `import` of the same identifier is a syntax error in Bun. Do not add import lines -- append only the tests:

```ts
// append to lib/skills/__tests__/sources.test.ts (imports already present)

test("loadStepSource reads stage metadata into stageMeta", () => {
  const root = mkdtempSync(join(tmpdir(), "rt-step-"));
  const dir = join(root, "attachments", "stage-plan");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), [
    "---", "name: stage-plan", "description: plan", "type: pipeline-step",
    "slots:", "  domain: { contract: plan-domain@1, required: false }",
    "metadata:", "  stage: plan", "  stage-consumes: ticket", "  stage-produces: approach evidence-plan",
    "---", "", "body {{slot:domain}}",
  ].join("\n"));
  const step = loadStepSource("stage-plan", { byName: { mattstack: { dir: root, version: "1.0.0" } } });
  expect(step.stageMeta).toEqual({ stage: "plan", consumes: ["ticket"], produces: ["approach", "evidence-plan"] });
});

test("loadStepSource leaves stageMeta null for a non-stage engine", () => {
  const root = mkdtempSync(join(tmpdir(), "rt-step-"));
  const dir = join(root, "attachments", "work");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: work\ndescription: w\ntype: pipeline-step\n---\n\nbody");
  const step = loadStepSource("work", { byName: { mattstack: { dir: root, version: "1.0.0" } } });
  expect(step.stageMeta).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/sources.test.ts -t stageMeta`
Expected: FAIL, `stageMeta` undefined

- [ ] **Step 3: Implement**

In `lib/skills/types.ts`, add after `StepSource`'s `stepFiles` line:

```ts
  stageMeta: { stage: string; consumes: string[]; produces: string[] } | null;
```

and add the two new types at the end of the file, identical to the Interfaces block above (`slotMode` and `partsPrefix` included; Tasks 3 and 6 read both):

```ts
export type StageEntry = {
  name: string; stage: string; dir: string; consumes: string[]; produces: string[];
};

export type PlaceholderContext = {
  fills: Record<string, AttachmentSource | null>;
  slotMode: Record<string, "inline" | "reference">;
  partsPrefix: string;
  includes: Record<string, AttachmentSource>;
  pipelines: Record<string, StageEntry[]>;
  repoKey: string;
  mattstackSha: string;
  mattstackDirty: 0 | 1;
  stageDir: string | null;
  stageMeta: StepSource["stageMeta"];
  compiledFrom: string;
};
```

In `lib/skills/sources.ts`, add a helper above `loadStepSource`:

```ts
function tokens(raw: unknown): string[] {
  return typeof raw === "string" ? raw.split(/\s+/).filter((t) => t && t !== "-") : [];
}

function readStageMeta(frontmatter: Record<string, unknown>): StepSource["stageMeta"] {
  const meta = frontmatter.metadata && typeof frontmatter.metadata === "object"
    ? (frontmatter.metadata as Record<string, unknown>)
    : {};
  if (typeof meta.stage !== "string") return null;
  return { stage: meta.stage, consumes: tokens(meta["stage-consumes"]), produces: tokens(meta["stage-produces"]) };
}
```

and in `loadStepSource`'s return object add `stageMeta: readStageMeta(frontmatter),` and `description: typeof frontmatter.description === "string" ? frontmatter.description : "",`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills && bunx tsc --noEmit`
Expected: all pass, tsc clean (after the `stageMeta: null, description: ""` fixture sweep across the three test files).

- [ ] **Step 5: Commit**

```bash
git add lib/skills/types.ts lib/skills/sources.ts lib/skills/__tests__/sources.test.ts lib/skills/__tests__/compile.test.ts lib/skills/__tests__/surface.test.ts
git commit -m "skills: stage metadata and description on StepSource; the placeholder context type"
```

---

### Task 3: The substitution pass with seam markers

**Files:**
- Modify: `lib/skills/placeholders.ts`
- Modify: `lib/skills/__tests__/placeholders.test.ts`

**Interfaces:**
- Consumes: `PlaceholderContext`, `AttachmentSource` (Task 2), `span`-style marker format from `compile.ts`.
- Produces: `substitute(body: string, ctx: PlaceholderContext, where: string): { body: string; used: { slots: string[]; includes: string[] } }`. Throws on unknown kind, unbound required handled by caller (an unbound optional slot substitutes `""`), include target not in `ctx.includes`, or missing context for `stage.*`/`pipeline.*`.
- Marker format, exact:
  - slot: `<!-- part: slot:<slot> binding=<binding> version=<v> path=<srcPath> lines=<a>-<b> -->`
  - include: `<!-- part: include:<name> source=<plugin>:<name> version=<v> path=<srcPath> lines=<a>-<b> -->`

- [ ] **Step 1: Write the failing tests**

Extend the existing `import { assertNoPlaceholders, findPlaceholders } from "../placeholders.ts";` line at the top of the file to also import `substitute`; do not add a second import of the module.

```ts
// append to lib/skills/__tests__/placeholders.test.ts
import type { AttachmentSource, PlaceholderContext } from "../types.ts";

const fill: AttachmentSource = {
  binding: "acme:plan-policy", plugin: "acme", version: "0.4.0",
  dir: "/p/acme/attachments/plan-policy", srcPath: "attachments/plan-policy/SKILL.md",
  bodyStartLine: 11, body: "line one\nline two\nline three",
  provides: "plan-domain@1", allowedTools: [], extraFiles: [], registered: false,
};
const inc: AttachmentSource = { ...fill, binding: "mattstack:review-core-body", plugin: "mattstack",
  version: "1.0.0", srcPath: "attachments/review-core-body/SKILL.md", bodyStartLine: 6, body: "core A\ncore B", provides: "" };

function ctx(over: Partial<PlaceholderContext> = {}): PlaceholderContext {
  return {
    fills: { domain: fill }, slotMode: { domain: "inline" }, partsPrefix: "${CLAUDE_SKILL_DIR}/parts",
    includes: { "review-core-body": inc },
    pipelines: { feature: [
      { name: "stage-provision", stage: "provision", dir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-provision", consumes: ["ticket", "repo"], produces: ["branch", "worktree"] },
      { name: "stage-plan", stage: "plan", dir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-plan", consumes: ["ticket"], produces: ["approach"] },
    ] },
    repoKey: "my-repo", mattstackSha: "abc1234", mattstackDirty: 0,
    stageDir: null, stageMeta: null, compiledFrom: "mattstack@1.0.0 + acme:plan-policy@0.4.0",
    ...over,
  };
}

describe("substitute", () => {
  test("slot inlines in place with a source-coordinate marker", () => {
    const { body } = substitute("before\n{{slot:domain}}\nafter", ctx(), "stage-plan");
    expect(body).toBe([
      "before",
      "<!-- part: slot:domain binding=acme:plan-policy version=0.4.0 path=attachments/plan-policy/SKILL.md lines=11-13 -->",
      "line one\nline two\nline three",
      "after",
    ].join("\n"));
  });

  test("unbound optional slot substitutes empty", () => {
    const { body } = substitute("a\n{{slot:domain}}\nb", ctx({ fills: { domain: null } }), "x");
    expect(body).toBe("a\n\nb");
  });

  test("a fill's own file references are rewritten under parts/<slot>", () => {
    const withFile = { ...fill, body: "see ${CLAUDE_SKILL_DIR}/ci-config.json" };
    expect(substitute("{{slot:domain}}", ctx({ fills: { domain: withFile } }), "x").body)
      .toContain("see ${CLAUDE_SKILL_DIR}/parts/domain/ci-config.json");
    const inStage = ctx({ fills: { domain: withFile }, partsPrefix: "${CLAUDE_SKILL_DIR}/../../attachments/stage-plan/parts" });
    expect(substitute("{{slot:domain}}", inStage, "stage-plan").body)
      .toContain("see ${CLAUDE_SKILL_DIR}/../../attachments/stage-plan/parts/domain/ci-config.json");
  });

  test("a registered public fill is referenced, not inlined", () => {
    const pub = { ...fill, registered: true };
    const { body } = substitute("{{slot:domain}}", ctx({ fills: { domain: pub }, slotMode: { domain: "reference" } }), "x");
    expect(body).toBe("Slot domain is bound to `acme:plan-policy` (acme:plan-policy@0.4.0) -- invoke that skill when this flow needs it.");
    expect(body).not.toContain("part: slot:");
  });

  test("an include's own file references are rewritten under parts/include-<name>", () => {
    const withRef = { ...inc, body: "shape at ${CLAUDE_SKILL_DIR}/references/adjudicator.md" };
    const { body } = substitute("{{include:review-core-body}}", ctx({ includes: { "review-core-body": withRef } }), "x");
    expect(body).toContain("shape at ${CLAUDE_SKILL_DIR}/parts/include-review-core-body/references/adjudicator.md");
  });

  test("include inlines with an include marker using source=", () => {
    const { body } = substitute("{{include:review-core-body}}", ctx(), "review");
    expect(body).toBe(
      "<!-- part: include:review-core-body source=mattstack:review-core-body version=1.0.0 path=attachments/review-core-body/SKILL.md lines=6-7 -->\ncore A\ncore B",
    );
  });

  test("include target that is not loaded is an error", () => {
    expect(() => substitute("{{include:nope}}", ctx(), "review")).toThrow('review: include "nope" is not a loaded attachment');
  });

  test("work-type: single type states it; several give a menu", () => {
    expect(substitute("{{work-type}}", ctx(), "work").body).toBe("The work type is `feature`. Continue.");
    const two = ctx({ pipelines: { ...ctx().pipelines, bugfix: [] } });
    const body = substitute("{{work-type}}", two, "work").body;
    expect(body).toContain("- `feature`");
    expect(body).toContain("- `bugfix`");
    expect(body).toContain("Ask one structured question");
  });

  test("pipeline.stages emits a fenced JSON block keyed by work type", () => {
    const body = substitute("{{pipeline.stages}}", ctx(), "work").body;
    const json = JSON.parse(body.replace(/^```json\n/, "").replace(/\n```$/, ""));
    expect(json.feature[1]).toEqual({
      name: "stage-plan", stage: "plan", dir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-plan",
      consumes: ["ticket"], produces: ["approach"],
    });
  });

  test("run-start.flags is keyed by work type and carries the baked mattstack facts", () => {
    const body = substitute("{{run-start.flags}}", ctx(), "work").body;
    const json = JSON.parse(body.replace(/^```json\n/, "").replace(/\n```$/, ""));
    expect(json.feature).toBe("--repo my-repo --work-type feature --pipeline feature --mattstack-sha abc1234 --mattstack-dirty 0");
  });

  test("stage.dir and stage.fields need a stage context", () => {
    const stage = ctx({ stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-plan",
      stageMeta: { stage: "plan", consumes: ["ticket"], produces: ["approach", "evidence-plan"] } });
    expect(substitute("{{stage.dir}}", stage, "stage-plan").body).toBe("${CLAUDE_SKILL_DIR}/../../attachments/stage-plan");
    expect(substitute("{{stage.fields}}", stage, "stage-plan").body)
      .toBe("You consume `ticket`. You must produce `approach`, `evidence-plan`.");
    expect(() => substitute("{{stage.dir}}", ctx(), "work")).toThrow("work: {{stage.dir}} used outside a stage");
  });

  test("compiled-from substitutes the provenance string", () => {
    expect(substitute("{{compiled-from}}", ctx(), "work").body).toBe("mattstack@1.0.0 + acme:plan-policy@0.4.0");
  });

  test("unknown kind is an error", () => {
    expect(() => substitute("{{bogus}}", ctx(), "work")).toThrow("work: unknown placeholder {{bogus}} at line 1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/placeholders.test.ts`
Expected: FAIL, `substitute is not a function`

- [ ] **Step 3: Implement**

Append to `lib/skills/placeholders.ts`:

```ts
import type { AttachmentSource, PlaceholderContext, StageEntry } from "./types.ts";

function spanOf(src: { srcPath: string; bodyStartLine: number; body: string }): string {
  const lines = src.body.split("\n").length;
  return `path=${src.srcPath} lines=${src.bodyStartLine}-${src.bodyStartLine + lines - 1}`;
}

function fenced(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";

function slotText(name: string, fill: AttachmentSource | null, mode: "inline" | "reference", partsPrefix: string): string {
  if (fill === null) return "";
  if (mode === "reference") {
    return `Slot ${name} is bound to \`${fill.binding}\` (${fill.binding}@${fill.version}) -- invoke that skill when this flow needs it.`;
  }
  const body = fill.body.split(SKILL_DIR_TOKEN).join(`${partsPrefix}/${name}`);
  return `<!-- part: slot:${name} binding=${fill.binding} version=${fill.version} ${spanOf(fill)} -->\n${body}`;
}

function includeText(name: string, inc: AttachmentSource, partsPrefix: string): string {
  const body = inc.body.split(SKILL_DIR_TOKEN).join(`${partsPrefix}/include-${name}`);
  return `<!-- part: include:${name} source=${inc.plugin}:${name} version=${inc.version} ${spanOf(inc)} -->\n${body}`;
}

function workTypeText(pipelines: Record<string, StageEntry[]>): string {
  const types = Object.keys(pipelines);
  if (types.length === 1) return `The work type is \`${types[0]}\`. Continue.`;
  const menu = types.map((t) => `- \`${t}\``).join("\n");
  return `This pack declares several work types:\n\n${menu}\n\nAsk one structured question to pick one, then use that key in the stage list and run-start flags below.`;
}

function runStartFlags(ctx: PlaceholderContext): string {
  const out: Record<string, string> = {};
  for (const t of Object.keys(ctx.pipelines)) {
    out[t] = `--repo ${ctx.repoKey} --work-type ${t} --pipeline ${t} --mattstack-sha ${ctx.mattstackSha} --mattstack-dirty ${ctx.mattstackDirty}`;
  }
  return fenced(out);
}

function stageFields(meta: NonNullable<PlaceholderContext["stageMeta"]>): string {
  const q = (xs: string[]) => xs.map((x) => `\`${x}\``).join(", ");
  const consume = meta.consumes.length ? `You consume ${q(meta.consumes)}.` : "You consume nothing.";
  const produce = meta.produces.length ? `You must produce ${q(meta.produces)}.` : "You produce nothing.";
  return `${consume} ${produce}`;
}

export function substitute(
  body: string,
  ctx: PlaceholderContext,
  where: string,
): { body: string; used: { slots: string[]; includes: string[] } } {
  const used = { slots: [] as string[], includes: [] as string[] };
  const lines = body.split("\n");

  const out = lines.map((line, i) =>
    line.replace(PLACEHOLDER_RE, (raw, kind: string, arg?: string) => {
      switch (kind) {
        case "slot": {
          if (!arg) throw new Error(`${where}: ${raw} needs a slot name`);
          if (!(arg in ctx.fills)) throw new Error(`${where}: slot "${arg}" is not declared by this engine`);
          used.slots.push(arg);
          return slotText(arg, ctx.fills[arg] ?? null, ctx.slotMode[arg] ?? "inline", ctx.partsPrefix);
        }
        case "include": {
          const inc = arg ? ctx.includes[arg] : undefined;
          if (!arg || !inc) throw new Error(`${where}: include "${arg}" is not a loaded attachment`);
          used.includes.push(arg);
          return includeText(arg, inc, ctx.partsPrefix);
        }
        case "pipeline.stages": return fenced(ctx.pipelines);
        case "work-type": return workTypeText(ctx.pipelines);
        case "run-start.flags": return runStartFlags(ctx);
        case "compiled-from": return ctx.compiledFrom;
        case "stage.dir":
          if (!ctx.stageDir) throw new Error(`${where}: {{stage.dir}} used outside a stage`);
          return ctx.stageDir;
        case "stage.fields":
          if (!ctx.stageMeta) throw new Error(`${where}: {{stage.fields}} used outside a stage`);
          return stageFields(ctx.stageMeta);
        default:
          throw new Error(`${where}: unknown placeholder ${raw} at line ${i + 1}`);
      }
    }),
  );

  return { body: out.join("\n"), used };
}
```

Move the `PLACEHOLDER_RE` constant above these functions so both `findPlaceholders` and `substitute` share it, and note that `String.prototype.replace` with a global regex resets `lastIndex`, so reuse is safe.

A declared-and-bound slot that the body never places as `{{slot:<name>}}` would otherwise vanish silently; the caller (Task 6) compares `used.slots` against the bound slot names and emits a warning `slot "<name>" is bound but never placed in the body` for each miss.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills/__tests__/placeholders.test.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add lib/skills/placeholders.ts lib/skills/__tests__/placeholders.test.ts
git commit -m "skills: placeholder substitution with seam markers"
```

---

### Task 4: Compile-time chain validation

**Files:**
- Create: `lib/skills/chain.ts`
- Create: `lib/skills/__tests__/chain.test.ts`

**Interfaces:**
- Produces: `validateChain(workType: string, stages: StageEntry[], seed: string[]): string[]` returning an array of error strings, empty when the chain is sound. Seed is fixed by the caller to `["work-type", "ticket", "repo", "mode"]`, the same seed `resolve-pipeline.sh` uses today.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/skills/__tests__/chain.test.ts
import { describe, expect, test } from "bun:test";
import { validateChain } from "../chain.ts";
import type { StageEntry } from "../types.ts";

const SEED = ["work-type", "ticket", "repo", "mode"];
const e = (name: string, consumes: string[], produces: string[]): StageEntry =>
  ({ name, stage: name.replace(/^stage-/, ""), dir: `x/${name}`, consumes, produces });

describe("validateChain", () => {
  test("a sound chain has no errors", () => {
    expect(validateChain("feature", [
      e("stage-provision", ["ticket", "repo"], ["branch", "worktree"]),
      e("stage-plan", ["ticket"], ["approach"]),
      e("stage-implement", ["approach", "branch", "worktree"], ["commits"]),
    ], SEED)).toEqual([]);
  });

  test("a consumer with no earlier producer is named", () => {
    expect(validateChain("feature", [
      e("stage-plan", ["ticket"], ["approach"]),
      e("stage-ship", ["commits", "ticket"], ["mr"]),
    ], SEED)).toEqual([
      'pipeline "feature": stage "stage-ship" consumes "commits" but no earlier stage produces it and it is not in the seed',
    ]);
  });

  test("order matters: producing later does not satisfy an earlier consumer", () => {
    expect(validateChain("feature", [
      e("stage-ship", ["commits"], ["mr"]),
      e("stage-implement", [], ["commits"]),
    ], SEED)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/chain.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```ts
// lib/skills/chain.ts
import type { StageEntry } from "./types.ts";

/**
 * The same fold resolve-pipeline.sh performed at run time, moved to compile:
 * a stage may only consume what the seed or an earlier stage produced.
 */
export function validateChain(workType: string, stages: StageEntry[], seed: string[]): string[] {
  const errors: string[] = [];
  const available = new Set(seed);
  for (const stage of stages) {
    for (const field of stage.consumes) {
      if (!available.has(field)) {
        errors.push(
          `pipeline "${workType}": stage "${stage.name}" consumes "${field}" but no earlier stage produces it and it is not in the seed`,
        );
      }
    }
    for (const field of stage.produces) available.add(field);
  }
  return errors;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills/__tests__/chain.test.ts`
Expected: 3 pass

- [ ] **Step 5: Commit**

```bash
git add lib/skills/chain.ts lib/skills/__tests__/chain.test.ts
git commit -m "skills: compile-time produce/consume chain validation"
```

---

### Task 5: Manifest pipelines, include loading, and stage roster

**Files:**
- Modify: `lib/skills/sources.ts`
- Modify: `lib/skills/__tests__/sources.test.ts`

**Interfaces:**
- Consumes: `readManifestPipelines(manifestPath: string): Record<string, string[]>` **already exists** in `sources.ts` (from #66). Do not re-create it; keep its signature. Add only the input-filtering test below if it is not already covered.
- Produces: `loadInclude(name: string, roots: PluginRoots): AttachmentSource` — like `loadAttachment` but the target is `mattstack:<name>` under `attachments/`, `provides` may be empty, and it throws if the target declares `slots:` (typed) or `metadata.slots`, or if its body contains a placeholder (uses `findPlaceholders`).
- Produces: `stageRoster(pipelines: Record<string, string[]>): VerbDef[]` — one `VerbDef` per distinct stage across all pipelines; `name` and `engine` are the bare stage name (`stage-plan`), `description` is filled by the caller from the loaded step's frontmatter (Task 7), so here `description` is `""`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to lib/skills/__tests__/sources.test.ts
import { loadInclude, readManifestPipelines, stageRoster } from "../sources.ts";

test("readManifestPipelines returns the pipelines map", () => {
  const root = mkdtempSync(join(tmpdir(), "rt-man-"));
  const p = join(root, "skills.jsonc");
  writeFileSync(p, '// header\n{ "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-ship"] }, "bindings": {} }');
  expect(readManifestPipelines(p)).toEqual({ feature: ["mattstack:stage-plan", "mattstack:stage-ship"] });
});

test("stageRoster is the distinct union across pipelines, bare names", () => {
  expect(stageRoster({ feature: ["mattstack:stage-plan", "mattstack:stage-ship"], bugfix: ["mattstack:stage-plan"] }))
    .toEqual([
      { name: "stage-plan", engine: "stage-plan", description: "" },
      { name: "stage-ship", engine: "stage-ship", description: "" },
    ]);
});

describe("loadInclude", () => {
  const roots = () => {
    const root = mkdtempSync(join(tmpdir(), "rt-inc-"));
    return { root, roots: { byName: { mattstack: { dir: root, version: "1.0.0" } } } };
  };
  const write = (root: string, name: string, md: string) => {
    mkdirSync(join(root, "attachments", name), { recursive: true });
    writeFileSync(join(root, "attachments", name, "SKILL.md"), md);
  };

  test("loads a slotless attachment with empty provides", () => {
    const { root, roots: r } = roots();
    write(root, "review-core-body", "---\nname: review-core-body\ndescription: d\n---\n\nthe body");
    const inc = loadInclude("review-core-body", r);
    expect(inc.body).toBe("the body");
    expect(inc.provides).toBe("");
    expect(inc.srcPath).toBe("attachments/review-core-body/SKILL.md");
  });

  test("rejects a target that declares slots", () => {
    const { root, roots: r } = roots();
    write(root, "bad", "---\nname: bad\ndescription: d\nslots:\n  x: { contract: x@1 }\n---\n\nbody");
    expect(() => loadInclude("bad", r)).toThrow('include "bad" declares slots; an include target must be slotless');
  });

  test("rejects a target that contains a placeholder", () => {
    const { root, roots: r } = roots();
    write(root, "bad2", "---\nname: bad2\ndescription: d\n---\n\nbody {{slot:x}}");
    expect(() => loadInclude("bad2", r)).toThrow('include "bad2" contains a placeholder; an include target must be inert');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/sources.test.ts`
Expected: FAIL on the three new exports

- [ ] **Step 3: Implement**

Add to `lib/skills/sources.ts` (leave the existing `readManifestPipelines` in place):

```ts
import { findPlaceholders } from "./placeholders.ts";

export function stageRoster(pipelines: Record<string, string[]>): VerbDef[] {
  const seen = new Set<string>();
  const out: VerbDef[] = [];
  for (const list of Object.values(pipelines)) {
    for (const qualified of list) {
      const name = qualified.includes(":") ? qualified.slice(qualified.indexOf(":") + 1) : qualified;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, engine: name, description: "" });
    }
  }
  return out;
}

export function loadInclude(name: string, roots: PluginRoots): AttachmentSource {
  const mattstack = roots.byName.mattstack;
  if (!mattstack) throw new Error(`loadInclude: no "mattstack" plugin root registered`);
  const dir = join(mattstack.dir, "attachments", name);
  const skillMdPath = join(dir, "SKILL.md");
  if (!existsSync(skillMdPath)) throw new Error(`loadInclude: include "${name}" not found at ${skillMdPath}`);

  const { body, frontmatter, bodyStartLine } = stripFrontmatter(readFileSync(skillMdPath, "utf8"));
  const metadata = frontmatter.metadata && typeof frontmatter.metadata === "object"
    ? (frontmatter.metadata as Record<string, unknown>)
    : {};
  if (frontmatter.slots || metadata.slots) {
    throw new Error(`loadInclude: include "${name}" declares slots; an include target must be slotless`);
  }
  if (findPlaceholders(body).length > 0) {
    throw new Error(`loadInclude: include "${name}" contains a placeholder; an include target must be inert`);
  }

  return {
    binding: `mattstack:${name}`,
    plugin: "mattstack",
    version: mattstack.version,
    dir,
    srcPath: relative(mattstack.dir, skillMdPath),
    bodyStartLine,
    body,
    provides: typeof metadata.provides === "string" ? metadata.provides : "",
    allowedTools: parseAllowedTools(frontmatter["allowed-tools"]),
    extraFiles: listFilesUnder(dir, new Set(["SKILL.md"])),
    registered: false,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills/__tests__/sources.test.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add lib/skills/sources.ts lib/skills/__tests__/sources.test.ts
git commit -m "skills: manifest pipelines, include loading, stage roster"
```

---

### Task 6: compileSkill uses the substitution pass; stage allowed-tools union; lint allowance

**Files:**
- Modify: `lib/skills/compile.ts:125-176, 192-219, 240-270`
- Modify: `lib/skills/__tests__/compile.test.ts`

**Interfaces:**
- Changes `compileSkill` signature to:

```ts
export function compileSkill(
  verb: VerbDef,
  step: StepSource,
  fills: Record<string, AttachmentSource | null>,
  roster: Set<string>,
  opts: {
    internalRoster?: Set<string>;
    includes?: Record<string, AttachmentSource>;
    pipelines?: Record<string, StageEntry[]>;
    repoKey?: string;
    mattstackSha?: string;
    mattstackDirty?: 0 | 1;
    stageDir?: string | null;
    stageAllowedTools?: string[];
    emittedSiblingDirs?: string[];
  },
): CompileResult
```

- Behavior: if the step body contains any placeholder, `buildBody` runs `substitute` and does NOT append fills afterward; if it contains none, today's append-after-body path runs unchanged (backward compatibility for engines not yet converted). After substitution, `assertNoPlaceholders` runs on the final body. `stageAllowedTools` entries are rewritten `${CLAUDE_SKILL_DIR}/<rest>` → `*/<basename-preserving rest>` in the leading-wildcard form and unioned into the frontmatter. `emittedSiblingDirs` prefixes are exempt from the not-an-emitted-file lint. Inside a compiled stage (`stageDir` set), every `${CLAUDE_SKILL_DIR}/` in the step body is rewritten to `<stageDir>/` before substitution. A step body containing the literal `resolve-args.sh` while also containing a placeholder is a compile error (`compile-native engine calls the runtime resolver`).

- [ ] **Step 1: Write the failing tests**

`compile.test.ts` already imports `compileSkill`; add no import. The existing `step` fixture declares `domain` and `forge` as `required: true`, so any test that passes `fills: {}` must use a step with `slots: {}`, or `resolveBoundSlots` throws before the behavior under test runs -- the `slotless` fixture below exists for that.

```ts
// append to lib/skills/__tests__/compile.test.ts (compileSkill already imported)

const placeholderStep: StepSource = {
  ...step,
  name: "stage-watch-ci",
  body: "Run ${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh.\n{{slot:domain}}\n{{stage.fields}}",
  slots: { domain: { contract: "watch-ci-domain@1", required: true } },
  allowedTools: ["Bash(${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh:*)"],
  stageMeta: { stage: "watch-ci", consumes: ["mr", "branch"], produces: ["ci"] },
};

const slotless: StepSource = { ...step, slots: {}, stageMeta: null };

function skillMd(result: { files: CompiledFile[] }): string {
  const f = result.files.find((x) => x.path === "SKILL.md");
  return f && "content" in f ? f.content : "";
}

describe("compileSkill with placeholders", () => {
  test("substitutes in place, emits a slot marker, and appends nothing", () => {
    const md = skillMd(compileSkill(verb, placeholderStep, { domain: domainFill }, new Set(), {
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci",
    }));
    expect(md).toContain("<!-- part: slot:domain binding=acme:watch-ci-domain version=0.3.0 path=attachments/watch-ci-domain/SKILL.md lines=8-8 -->");
    expect(md).toContain("You consume `mr`, `branch`. You must produce `ci`.");
    expect(md.indexOf("You consume")).toBeGreaterThan(md.indexOf("part: slot:domain"));
    expect(md.split("part: slot:domain").length).toBe(2);
  });

  test("inside a stage, step-owned script references are rewritten to the stage dir", () => {
    const md = skillMd(compileSkill(verb, placeholderStep, { domain: domainFill }, new Set(), {
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci",
    }));
    expect(md).toContain("Run ${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci/scripts/ci-watch.sh.");
  });

  test("a placeholder that cannot be filled is a compile error", () => {
    const bad = { ...placeholderStep, body: "{{slot:domain}} {{stage.dir}}" };
    expect(() => compileSkill(verb, bad, { domain: domainFill }, new Set(), {})).toThrow("{{stage.dir}} used outside a stage");
  });

  test("a fill's file references resolve under the stage's parts dir inside a stage", () => {
    const md = skillMd(compileSkill(verb, placeholderStep, { domain: domainFill }, new Set(), {
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci",
    }));
    expect(md).toContain("${CLAUDE_SKILL_DIR}/../../attachments/stage-watch-ci/parts/domain/ci-config.json");
  });

  test("a bound slot the body never places is warned", () => {
    const orphan = { ...placeholderStep, body: "{{stage.fields}} only" };
    const r = compileSkill(verb, orphan, { domain: domainFill }, new Set(), { stageDir: "x" });
    expect(r.warnings).toContain('slot "domain" is bound but never placed in the body');
  });

  test("a compile-native engine calling the runtime resolver is a compile error", () => {
    const bad = { ...placeholderStep, body: 'run "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"\n{{slot:domain}}' };
    expect(() => compileSkill(verb, bad, { domain: domainFill }, new Set(), {}))
      .toThrow("compile-native engine calls the runtime resolver");
  });

  test("stage allowed-tools union rewrites to the leading-wildcard form", () => {
    const md = skillMd(compileSkill(verb, { ...slotless, body: "{{pipeline.stages}}" }, {}, new Set(), {
      pipelines: { feature: [] },
      stageAllowedTools: ["Bash(${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh:*)", "Bash(*/scripts/ci-forge.sh:*)", "Bash(gh:*)"],
    }));
    expect(md).toContain('  - "Bash(*/scripts/ci-watch.sh:*)"');
    expect(md).toContain('  - "Bash(*/scripts/ci-forge.sh:*)"');
    expect((md.match(/Bash\(gh:\*\)/g) ?? []).length).toBe(1);
  });

  test("emitted sibling dirs are not lint-warned as missing files", () => {
    const r = compileSkill(verb, { ...slotless, body: "read ${CLAUDE_SKILL_DIR}/../../attachments/stage-plan/SKILL.md" }, {}, new Set(), {
      emittedSiblingDirs: ["${CLAUDE_SKILL_DIR}/../../attachments/stage-plan"],
    });
    expect(r.warnings.filter((w) => w.includes("not an emitted file"))).toEqual([]);
  });

  test("a body with no placeholders still appends fills (backward compatible)", () => {
    const md = skillMd(compileSkill(verb, step, { domain: domainFill, forge: forgeFill }, new Set(), {}));
    expect(md).toContain("part: slot:domain");
    expect(md).toContain("part: slot:forge");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/compile.test.ts`
Expected: FAIL (opts fields unknown / behaviors absent)

- [ ] **Step 3: Implement**

In `lib/skills/compile.ts`:

```ts
import { assertNoPlaceholders, findPlaceholders, substitute } from "./placeholders.ts";
import type { PlaceholderContext, StageEntry } from "./types.ts";

const RESOLVER_RE = /\bresolve-args\.sh\b/;

function toWildcardRule(rule: string): string {
  const prefix = `${CLAUDE_SKILL_DIR_TOKEN}/`;
  const at = rule.indexOf(prefix);
  if (at < 0) return rule;
  return rule.slice(0, at) + "*/" + rule.slice(at + prefix.length);
}

function buildAllowedTools(step: StepSource, boundSlots: BoundSlot[], stageRules: string[]): string[] {
  const entries = [
    ...step.allowedTools,
    ...boundSlots.flatMap(({ slotName, fill }) => fill.allowedTools.map((tool) => rewriteSkillDirRefs(tool, slotName))),
    ...stageRules.map(toWildcardRule),
  ];
  return dedupePreserveOrder(entries);
}
```

Replace `buildBody` with:

```ts
type BuildOpts = {
  internalRoster: Set<string>;
  ctx: PlaceholderContext | null;
  stageDir: string | null;
};

function buildBody(step: StepSource, boundSlots: BoundSlot[], opts: BuildOpts): { body: string; notes: string[] } {
  const notes: string[] = [];
  const sections: string[] = [HEADER_COMMENT];
  sections.push(`<!-- part: step source=${step.plugin}:${step.name} version=${step.version} ${span(step)} -->`);

  let stepBody = step.body;
  if (opts.stageDir) stepBody = stepBody.split(`${CLAUDE_SKILL_DIR_TOKEN}/`).join(`${opts.stageDir}/`);

  const compileNative = findPlaceholders(stepBody).length > 0;
  if (compileNative) {
    if (RESOLVER_RE.test(stepBody)) {
      throw new Error(`engine "${step.name}": compile-native engine calls the runtime resolver (resolve-args.sh)`);
    }
    if (!opts.ctx) throw new Error(`engine "${step.name}": placeholders present but no placeholder context`);
    const { body, used } = substitute(stepBody, opts.ctx, step.name);
    assertNoPlaceholders(body, step.name);
    for (const { slotName } of boundSlots) {
      if (!used.slots.includes(slotName)) notes.push(`slot "${slotName}" is bound but never placed in the body`);
    }
    sections.push(body);
    return { body: sections.join("\n\n"), notes };
  }

  sections.push(stepBody);
  for (const { slotName, fill } of boundSlots) {
    if (!isInlined(fill, opts.internalRoster)) {
      sections.push(`Slot ${slotName} is bound to \`${fill.binding}\` (${fill.binding}@${fill.version}) -- invoke that skill when this flow needs it.`);
      continue;
    }
    if (fill.registered) notes.push(`note: ${fill.binding} is surface-internal; inlined`);
    sections.push(`<!-- part: slot:${slotName} binding=${fill.binding} version=${fill.version} ${span(fill)} -->`);
    sections.push(rewriteSkillDirRefs(fill.body, slotName));
  }
  return { body: sections.join("\n\n"), notes };
}
```

Extend `lintReferences` to accept `exemptPrefixes: string[]` and skip a `${CLAUDE_SKILL_DIR}/…` match when `exemptPrefixes.some((p) => full.startsWith(p))`.

Replace `compileSkill`:

```ts
export function compileSkill(
  verb: VerbDef,
  step: StepSource,
  fills: Record<string, AttachmentSource | null>,
  roster: Set<string>,
  opts: {
    internalRoster?: Set<string>;
    includes?: Record<string, AttachmentSource>;
    pipelines?: Record<string, StageEntry[]>;
    repoKey?: string;
    mattstackSha?: string;
    mattstackDirty?: 0 | 1;
    stageDir?: string | null;
    stageAllowedTools?: string[];
    emittedSiblingDirs?: string[];
  } = {},
): CompileResult {
  const internalRoster = opts.internalRoster ?? new Set<string>();
  const boundSlots = resolveBoundSlots(verb, step, fills);

  const compiledParts = [`${step.plugin}@${step.version}`, ...boundSlots.map(({ fill }) => `${fill.binding}@${fill.version}`)];
  const compiledFrom = compiledParts.join(" + ");

  const slotMode: Record<string, "inline" | "reference"> = {};
  for (const { slotName, fill } of boundSlots) {
    slotMode[slotName] = isInlined(fill, internalRoster) ? "inline" : "reference";
  }
  const partsPrefix = opts.stageDir ? `${opts.stageDir}/parts` : `${CLAUDE_SKILL_DIR_TOKEN}/parts`;

  const ctx: PlaceholderContext = {
    fills,
    slotMode,
    partsPrefix,
    includes: opts.includes ?? {},
    pipelines: opts.pipelines ?? {},
    repoKey: opts.repoKey ?? "",
    mattstackSha: opts.mattstackSha ?? "",
    mattstackDirty: opts.mattstackDirty ?? 0,
    stageDir: opts.stageDir ?? null,
    stageMeta: step.stageMeta,
    compiledFrom,
  };

  const allowedTools = buildAllowedTools(step, boundSlots, opts.stageAllowedTools ?? []);
  const { body, notes } = buildBody(step, boundSlots, { internalRoster, ctx, stageDir: opts.stageDir ?? null });
  const frontmatter = buildFrontmatter(verb, allowedTools, compiledParts);
  const content = `${frontmatter}\n\n${body}\n`;

  const files: CompiledFile[] = [{ path: "SKILL.md", content }, ...buildVendoredFiles(step, boundSlots, opts.includes ?? {})];
  const fillBindings = boundSlots.map(({ fill }) => fill.binding);
  const warnings = [...lintReferences(body, roster, files, fillBindings, opts.emittedSiblingDirs ?? []), ...notes];
  const errors = [
    ...lintInternalRoster(body, internalRoster, "body"),
    ...lintInternalRoster(verb.description, internalRoster, "description"),
  ];
  return { files, warnings, errors };
}
```

`buildVendoredFiles` gains a third parameter and vendors each include's `extraFiles`, matching the path `includeText` rewrites body references to:

```ts
function buildVendoredFiles(step: StepSource, boundSlots: BoundSlot[], includes: Record<string, AttachmentSource>): CompiledFile[] {
  const files: CompiledFile[] = [];
  for (const entry of step.stepFiles) files.push({ path: entry, copyFrom: `${step.dir}/${entry}` });
  for (const { slotName, fill } of boundSlots) {
    for (const entry of fill.extraFiles) files.push({ path: `parts/${slotName}/${entry}`, copyFrom: `${fill.dir}/${entry}` });
  }
  for (const [name, inc] of Object.entries(includes)) {
    for (const entry of inc.extraFiles) files.push({ path: `parts/include-${name}/${entry}`, copyFrom: `${inc.dir}/${entry}` });
  }
  return files;
}
```

One existing test changes meaning here, not in Task 7: nothing in `compile.test.ts` needs edits (every existing body is placeholder-free, so the backward path is exercised unchanged). In `surface.test.ts` the test "skips a non-public verb ... prints an internal line and removes its compiled skills/ dir" asserts behavior Task 7 deletes; leave it failing-red at the end of this task and rewrite it in Task 7 (see there).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills/__tests__/compile.test.ts && bunx tsc --noEmit`
Expected: all pass, tsc clean

- [ ] **Step 5: Commit**

```bash
git add lib/skills/compile.ts lib/skills/__tests__/compile.test.ts
git commit -m "skills: compileSkill runs the placeholder pass, unions stage tools, exempts sibling dirs"
```

---

### Task 7: The compile gate — internal targets emitted, stages from the manifest, stale-side removal

**Files:**
- Modify: `commands/skills.ts:345-411` (`Resolved`, `resolve`), `413-442` (`compileVerb`), `444-518` (`writeCompiledVerb`, `skillsCompile`), `520-569` (`skillsCheck`)
- Modify: `lib/skills/__tests__/surface.test.ts`

**Interfaces:**
- `Resolved` gains: `pipelines: Record<string, string[]>`, `stages: VerbDef[]`, `stageEntries: Record<string, StageEntry[]>`, `repoKey: string`, `mattstackSha: string`, `mattstackDirty: 0 | 1`.
- New exported pure helper for tests: `outDirFor(packDir: string, name: string, isPublic: boolean): string` returning `join(packDir, isPublic ? "skills" : "attachments", name)`, and `otherSideDir(packDir, name, isPublic)`.
- A stage target's `isPublic` is `publicSet?.has(name) ?? false` (never public by default). A roster verb's is `!publicSet || publicSet.has(name)` (today's rule).

- [ ] **Step 1: Write the failing tests**

```ts
// append to lib/skills/__tests__/surface.test.ts
import { otherSideDir, outDirFor } from "../../../commands/skills.ts";

test("outDirFor places public under skills/ and internal under attachments/", () => {
  expect(outDirFor("/pack", "work", true)).toBe("/pack/skills/work");
  expect(outDirFor("/pack", "stage-plan", false)).toBe("/pack/attachments/stage-plan");
});

test("otherSideDir names the stale location for a name that flipped sides", () => {
  expect(otherSideDir("/pack", "work", true)).toBe("/pack/attachments/work");
  expect(otherSideDir("/pack", "checkout", false)).toBe("/pack/skills/checkout");
});
```

And an integration test using the existing fixture style in `surface.test.ts` (it already builds temp packs with `--pack-dir` and `--mattstack-dir`): create a pack with `stubs.jsonc` naming `work`, a manifest with `pipelines.feature = ["mattstack:stage-plan"]`, a mattstack fixture plugin with `attachments/pipeline/work/SKILL.md` (body `{{work-type}}\n{{pipeline.stages}}`) and `attachments/pipeline/stage-plan/SKILL.md` (typed slots, `metadata.stage: plan`, body `{{stage.fields}}`), `surface.jsonc` public `["work"]`; run `skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest])`; assert:

```ts
expect(existsSync(join(pack, "skills", "work", "SKILL.md"))).toBe(true);
expect(existsSync(join(pack, "attachments", "stage-plan", "SKILL.md"))).toBe(true);
expect(readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8")).toContain("The work type is `feature`. Continue.");
```

Then flip `surface.jsonc` to public `[]`, recompile, and assert `skills/work` is gone and `attachments/work/SKILL.md` exists (stale-side removal + internal emission).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/surface.test.ts`
Expected: FAIL, exports missing

- [ ] **Step 3: Implement**

In `commands/skills.ts`:

```ts
export function outDirFor(packDir: string, name: string, isPublic: boolean): string {
  return join(packDir, isPublic ? "skills" : "attachments", name);
}
export function otherSideDir(packDir: string, name: string, isPublic: boolean): string {
  return join(packDir, isPublic ? "attachments" : "skills", name);
}

function gitFacts(dir: string): { sha: string; dirty: 0 | 1 } {
  try {
    const sha = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { stdio: "pipe" }).toString().trim();
    const status = execFileSync("git", ["-C", dir, "status", "--porcelain"], { stdio: "pipe" }).toString();
    return { sha, dirty: status.trim() ? 1 : 0 };
  } catch {
    return { sha: "", dirty: 0 };
  }
}
```

Extend `resolve` (the real `Resolved` already has `team`, `fullRoster`, and `manifestPath`; add the new fields beside them):

```ts
  const pipelines = manifestPath ? readManifestPipelines(manifestPath) : {};
  const stages = stageRoster(pipelines);
  const repoKey = manifestPath ? basename(dirname(manifestPath)) : "";
  const mattstackDir = pluginRoots.byName.mattstack?.dir ?? "";
  const { sha: mattstackSha, dirty: mattstackDirty } = mattstackDir ? gitFacts(mattstackDir) : { sha: "", dirty: 0 as const };
  const stageEntries = buildStageEntries({ pipelines, pluginRoots });
```

and return them alongside the existing fields. `repoKey` is the manifest's parent directory name, which is the registry repo key `run-start --repo` expects (the same key `~/.mattstack/runs/<repo>/` is named by). `skillsComposition` already calls `readManifestPipelines(resolved.manifestPath)` itself; leave that call alone.

Add a `stageEntries` builder used by both `work` compilation and the chain check:

```ts
function buildStageEntries(input: Pick<Resolved, "pipelines" | "pluginRoots">): Record<string, StageEntry[]> {
  const out: Record<string, StageEntry[]> = {};
  for (const [type, names] of Object.entries(input.pipelines)) {
    out[type] = names.map((qualified) => {
      const name = qualified.slice(qualified.indexOf(":") + 1);
      const step = loadStepSource(name, input.pluginRoots);
      if (!step.stageMeta) throw new SkillsUsageError(`pipeline "${type}": "${name}" has no metadata.stage; it cannot appear in a pipeline`);
      return {
        name, stage: step.stageMeta.stage,
        dir: `\${CLAUDE_SKILL_DIR}/../../attachments/${name}`,
        consumes: step.stageMeta.consumes, produces: step.stageMeta.produces,
      };
    });
  }
  return out;
}
```

Replace `compileVerb` with this concrete version. It takes `isStage` and threads every new option; the orchestrator is identified as the target whose step body places `{{pipeline.stages}}`, which is what the stage `allowed-tools` union is for.

```ts
function loadFillsFor(step: StepSource, resolved: Resolved, where: string): Record<string, AttachmentSource | null> {
  const slotBindings = resolved.bindings[`${step.plugin}:${step.name}`] ?? {};
  const fills: Record<string, AttachmentSource | null> = {};
  for (const slotName of Object.keys(step.slots)) {
    const bindingName = slotBindings[slotName];
    if (!bindingName) { fills[slotName] = null; continue; }
    try {
      fills[slotName] = loadAttachment(bindingName, slotName, resolved.pluginRoots);
    } catch (err) {
      throw new SkillsUsageError(`${where}: ${(err as Error).message}`);
    }
  }
  return fills;
}

function loadIncludesFor(step: StepSource, resolved: Resolved, where: string): Record<string, AttachmentSource> {
  const out: Record<string, AttachmentSource> = {};
  for (const p of findPlaceholders(step.body)) {
    if (p.kind !== "include" || !p.arg || out[p.arg]) continue;
    try {
      out[p.arg] = loadInclude(p.arg, resolved.pluginRoots);
    } catch (err) {
      throw new SkillsUsageError(`${where}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Every stage's own rules plus its bound fills' rules; unioned into the orchestrator because a stage read as a file loads no frontmatter of its own. */
function stageAllowedToolsFor(resolved: Resolved, entries: Record<string, StageEntry[]>): string[] {
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const list of Object.values(entries)) {
    for (const entry of list) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      const step = loadStepSource(entry.name, resolved.pluginRoots);
      rules.push(...step.allowedTools);
      for (const fill of Object.values(loadFillsFor(step, resolved, `stage "${entry.name}"`))) {
        if (fill) rules.push(...fill.allowedTools);
      }
    }
  }
  return rules;
}

function compileVerb(verb: VerbDef, resolved: Resolved, isStage: boolean): CompileResult {
  const where = `${isStage ? "stage" : "verb"} "${verb.name}"`;
  let step: StepSource;
  try {
    step = loadStepSource(verb.engine, resolved.pluginRoots);
  } catch (err) {
    throw new SkillsUsageError(`${where}: ${(err as Error).message}`);
  }
  if (isStage) verb = { ...verb, description: step.description };

  const entries = resolved.stageEntries;
  const allStageDirs = Object.values(entries).flat().map((e) => e.dir);
  const stageDir = isStage ? allStageDirs.find((d) => d.endsWith(`/${verb.name}`)) ?? null : null;
  const isOrchestrator = findPlaceholders(step.body).some((p) => p.kind === "pipeline.stages");

  try {
    return compileSkill(verb, step, loadFillsFor(step, resolved, where), resolved.invocable, {
      internalRoster: resolved.internalRoster,
      includes: loadIncludesFor(step, resolved, where),
      pipelines: entries,
      repoKey: resolved.repoKey,
      mattstackSha: resolved.mattstackSha,
      mattstackDirty: resolved.mattstackDirty,
      stageDir,
      stageAllowedTools: isOrchestrator ? stageAllowedToolsFor(resolved, entries) : [],
      emittedSiblingDirs: allStageDirs,
    });
  } catch (err) {
    throw new SkillsUsageError((err as Error).message);
  }
}
```

`Resolved` therefore also carries `stageEntries: Record<string, StageEntry[]>`, computed once inside `resolve` as `buildStageEntries({ pipelines, pluginRoots })` after both are known; the builder is typed over a `Pick` so it can run before a full `Resolved` exists. The old inline slot-binding loop in `compileVerb` is replaced by `loadFillsFor`.

Before any compile, run the chain check once:

```ts
    const entries = resolved.stageEntries;
    const chainErrors = Object.entries(entries).flatMap(([type, list]) => validateChain(type, list, ["work-type", "ticket", "repo", "mode"]));
    if (chainErrors.length > 0) throw new SkillsUsageError(chainErrors.join("\n"));
```

Rework the loop in `skillsCompile`. The real function (post-#66) iterates `resolved.roster` with an `internal-skipped` branch, then `--json`, `--preview`, `--dry-run`, and plain branches, each going through `tryCompileVerb` or `compileVerb`. Keep all four output modes and `tryCompileVerb`; change only what is iterated and where it lands:

```ts
    const targets: { verb: VerbDef; isPublic: boolean; isStage: boolean }[] = [
      ...resolved.roster.map((verb) => ({ verb, isPublic: !publicSet || publicSet.has(verb.name), isStage: false })),
      ...resolved.stages.map((verb) => ({ verb, isPublic: publicSet?.has(verb.name) ?? false, isStage: true })),
    ];

    for (const { verb, isPublic, isStage } of targets) {
      const outDir = outDirFor(resolved.packDir, verb.name, isPublic);
      const stale = otherSideDir(resolved.packDir, verb.name, isPublic);
      const side = isPublic ? "skills" : "attachments";
      // --json / --preview branches: exactly as today, but call tryCompileVerb(verb, resolved, isStage)
      // and, in the json row, replace status "internal-skipped" with "compiled" plus a new
      // `side: "skills" | "attachments"` field. The `internal-skipped` status is retired.
      ...
      const result = compileVerb(verb, resolved, isStage);
      if (result.errors.length > 0) throw new SkillsUsageError(`${isStage ? "stage" : "verb"} "${verb.name}": ${result.errors.join("; ")}`);
      if (flags.dryRun) { /* unchanged */ continue; }
      if (existsSync(stale)) rmSync(stale, { recursive: true, force: true });
      writeCompiledVerb(outDir, result);
      console.log(`compiled ${verb.name} -> ${side} (${result.files.length} files, ${result.warnings.length} warnings)`);
      for (const warning of result.warnings) console.log(`  ${warning}`);
    }
```

`tryCompileVerb` gains the same `isStage` third parameter and passes it through. Delete the `internal-skipped` branch and the `"internal-skipped"` member of `CompileVerbStatus`; add `side` to `CompileVerbRow`. The post-loop "misplaced" scan stays as is.

In `skillsCheck`, iterate the same `targets`, use `outDirFor` for `outDir`, drop the `isPublic` gate (every target is checked), and retire the `"internal-unchecked"` member of `CheckVerbStatus` along with its branch; a missing `outDir` is `never-compiled` for every target. Add `side` to `CheckVerbRow`.

The console reads these JSON payloads (`--json` on compile and check); the changes above are the contract change it must absorb: `internal-skipped` and `internal-unchecked` disappear, and rows gain `side`. Record that in the PR description.

Rewrite the existing `surface.test.ts` test "skips a non-public verb ... prints an internal line and removes its compiled skills/ dir" (it asserts the deleted branch) to: compile with that verb non-public, then `expect(existsSync(join(pack, "skills", "old-verb"))).toBe(false)` and `expect(existsSync(join(pack, "attachments", "old-verb", "SKILL.md"))).toBe(true)`, and assert the log line `compiled old-verb -> attachments`. Any `surface.test.ts` test asserting a `--json` row with `status: "internal-skipped"` or a check row with `"internal-unchecked"` changes to assert `status: "compiled"` / the real check status plus `side: "attachments"`. Grep the test file for both strings before starting.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills && bunx tsc --noEmit`
Expected: all pass, tsc clean

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts lib/skills/sources.ts lib/skills/types.ts lib/skills/__tests__/surface.test.ts
git commit -m "skills: emit internal targets to attachments/, compile stages from the manifest, remove the stale side"
```

---

### Task 8: Surface — stages default internal and classify as compiled

**Files:**
- Modify: `commands/skills.ts:672-676` (`defaultPublicSet`), `~683-700` (`computeRows`), `~760-830` (`runApply`, `runSet`)
- Modify: `lib/skills/__tests__/surface.test.ts`

**Interfaces:**
- `computeRows(packDir, verbNames, surface)` gains a fourth parameter `stageNames: Set<string>`; rows for stage names are `kind: "compiled"` and `status: "internal"` unless in `surface.public`. `defaultPublicSet` is unchanged in signature and must not receive stage names.

- [ ] **Step 1: Write the failing test**

```ts
// append to lib/skills/__tests__/surface.test.ts
import { computeRows } from "../../../commands/skills.ts";

test("a never-compiled stage is a compiled, internal row and never defaults public", () => {
  const pack = mkdtempSync(join(tmpdir(), "rt-surf-"));
  mkdirSync(join(pack, "skills", "work"), { recursive: true });
  writeFileSync(join(pack, "skills", "work", "SKILL.md"), "---\nname: work\n---\n\nx");
  const { rows } = computeRows(pack, new Set(["work"]), null, new Set(["stage-plan"]));
  const stage = rows.find((r) => r.name === "stage-plan");
  expect(stage).toEqual({ name: "stage-plan", kind: "compiled", status: "internal" });
  expect(rows.find((r) => r.name === "work")?.status).toBe("public");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/surface.test.ts -t "never-compiled stage"`
Expected: FAIL, arity / undefined row

- [ ] **Step 3: Implement**

In `computeRows`, add the parameter and:

```ts
  const names = new Set<string>([...allNames, ...publicSet, ...stageNames]);
  const rows = [...names].sort().map((name) => {
    const dir = skillEntries.get(name)?.dir ?? attachmentEntries.get(name)?.dir ?? null;
    const isStage = stageNames.has(name);
    return {
      name,
      kind: isStage ? ("compiled" as const) : allNames.has(name) ? classify(name, dir, verbNames) : ("missing" as const),
      status: (publicSet.has(name) ? "public" : "internal") as "public" | "internal",
    };
  });
```

`defaultPublicSet(skillsNames, verbNames)` is left as is; callers never pass stage names into it. In `runList`, `runApply`, `runSet`, and the palette, compute `stageNames` with this helper and pass it to `computeRows`; in `runApply` skip `git mv` for any name in `stageNames` (they are regenerated by the compile step, like other compiled targets).

```ts
/**
 * A rosterless pack (the mattstack plugin repo itself) has no manifest and
 * `findDefaultManifest` throws for it; the surface verbs must keep working
 * there, so no manifest means no stages rather than an error.
 */
function stageNamesFor(flags: SurfaceFlags, packDir: string): Set<string> {
  if (readVerbRoster(packDir).length === 0) return new Set();
  const mattstackRoot = flags.mattstackDir ?? mattstackHome();
  const team = flags.team ?? packNameFor(packDir);
  const manifest = flags.manifest ?? findDefaultManifest(mattstackRoot, team);
  return new Set(stageRoster(readManifestPipelines(manifest)).map((v) => v.name));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test lib/skills/__tests__/surface.test.ts && bunx tsc --noEmit`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts lib/skills/__tests__/surface.test.ts
git commit -m "skills surface: stages classify as compiled and default internal"
```

---

### Task 9: Compiler end-to-end on a fixture pack + full suite

**Files:**
- Create: `lib/skills/__tests__/fixtures/compile-native/` (a minimal mattstack fixture plugin with `attachments/pipeline/work/SKILL.md` and two stages, a pack with `stubs.jsonc`, `surface.jsonc`, and a manifest)
- Create: `lib/skills/__tests__/compile-native.e2e.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/skills/__tests__/compile-native.e2e.test.ts
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { skillsCompile, skillsCheck } from "../../../commands/skills.ts";
import { runExpectingCleanExit } from "./helpers.ts";

const FIX = join(import.meta.dir, "fixtures", "compile-native");

async function build() {
  const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
  cpSync(FIX, root, { recursive: true });
  const pack = join(root, "pack");
  const ms = join(root, "mattstack-home");
  const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
  await skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);
  return { pack, ms, manifest };
}

describe("compile-native end to end", () => {
  test("work and stages compile with zero resolver references and zero placeholders", async () => {
    const { pack } = await build();
    const work = readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8");
    const plan = readFileSync(join(pack, "attachments", "stage-plan", "SKILL.md"), "utf8");
    for (const md of [work, plan]) {
      expect(md).not.toContain("resolve-args");
      expect(md).not.toContain("resolve-pipeline");
      expect(md).not.toContain("{{");
    }
    expect(work).toContain("<!-- part: step source=mattstack:work");
    expect(plan).toContain("<!-- part: slot:domain binding=");
    expect(plan).toContain("<!-- part: step source=mattstack:stage-plan");
    expect(existsSync(join(pack, "skills", "work", "scripts", "resolve-pipeline.sh"))).toBe(false);
  });

  test("rt skills check is clean immediately after compile", async () => {
    const { pack, ms, manifest } = await build();
    process.exitCode = 0;
    await skillsCheck(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);
    expect(process.exitCode).toBe(0);
  });

  test("a broken chain refuses to compile", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-e2e-"));
    cpSync(FIX, root, { recursive: true });
    const manifest = join(root, "mattstack-home", "repos", "my-repo", "skills.jsonc");
    // stage-ship consumes commits; nothing produces it when stage-plan is alone before it
    const broken = readFileSync(manifest, "utf8").replace('"mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"', '"mattstack:stage-plan", "mattstack:stage-ship"');
    writeFileSync(manifest, broken);
    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir", join(root, "pack"), "--mattstack-dir", join(root, "mattstack-home"), "--manifest", manifest]),
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain('stage "stage-ship" consumes "commits"');
  });
});
```

`skillsCompile` runs inside `withCleanErrors`, which catches `SkillsUsageError`, prints it via `console.error`, and calls `process.exit(1)` -- it never rejects, and an unmocked `process.exit` inside `bun test` kills the runner. So this test uses the `runExpectingCleanExit` helper that `surface.test.ts` already defines (it spies `process.exit` to throw a sentinel and captures `console.error`). Move that helper into a shared `lib/skills/__tests__/helpers.ts` and import it from both test files; add `writeFileSync` to this file's `fs` import.

The fixture tree, exactly (`--mattstack-dir` resolves plugin roots from `<dir>/plugins/<name>/`, each needing `.claude-plugin/plugin.json`; the pack roster lives at `<pack>/pack/stubs.jsonc`):

```
lib/skills/__tests__/fixtures/compile-native/
  pack/
    pack/stubs.jsonc        {"verbs":{"work":{"engine":"work","description":"Run a unit of work"}}}
    pack/surface.jsonc      {"public":["work"]}
    .claude-plugin/plugin.json   {"name":"acme","version":"0.1.0"}
  mattstack-home/
    repos/my-repo/skills.jsonc
    plugins/mattstack/.claude-plugin/plugin.json   {"name":"mattstack","version":"1.0.0"}
    plugins/mattstack/attachments/pipeline/work/SKILL.md
    plugins/mattstack/attachments/pipeline/stage-plan/SKILL.md
    plugins/mattstack/attachments/pipeline/stage-implement/SKILL.md
    plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md
    plugins/acme/.claude-plugin/plugin.json        {"name":"acme","version":"0.1.0"}
    plugins/acme/attachments/plan-policy/SKILL.md
```

`repos/my-repo/skills.jsonc` (the header must name the pack, `acme`, for `findDefaultManifest`; the e2e test passes `--manifest` explicitly anyway):

```jsonc
// acme bindings
{
  "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"] },
  "bindings": { "mattstack:stage-plan": { "domain": "acme:plan-policy" } }
}
```

`work/SKILL.md` body (frontmatter: `name: work`, `description: w`, `type: pipeline-step`, no slots):

```
{{work-type}}

{{pipeline.stages}}

Start: "$RT_PIPELINE_STATE" run-start {{run-start.flags}}
```

Stages (each `type: pipeline-step`, `description: "<name>"`): `stage-plan` with `slots: { domain: { contract: plan-domain@1, required: false } }`, `metadata.stage: plan`, `stage-consumes: ticket`, `stage-produces: approach`, body `{{stage.fields}}\n{{slot:domain}}`; `stage-implement` with no `slots:`, `stage: implement`, consumes `approach`, produces `commits`, body `{{stage.fields}}`; `stage-ship` with no `slots:`, `stage: ship`, consumes `commits ticket`, produces `mr`, body `{{stage.fields}}`. `acme/attachments/plan-policy/SKILL.md`: frontmatter `name: plan-policy`, `metadata.provides: "plan-domain@1"`, body `policy text`. The broken-chain test's `replace` string matches the `pipelines` line above verbatim.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test lib/skills/__tests__/compile-native.e2e.test.ts`
Expected: FAIL until fixtures exist

- [ ] **Step 3: Create the fixtures**, then run again.

- [ ] **Step 4: Run the whole compiler suite + typecheck + startup gate**

Run: `bun test lib commands && bunx tsc --noEmit && bun run lib/__tests__/no-eager-tui.test.ts`
Expected: green

- [ ] **Step 5: Commit**

```bash
git add lib/skills/__tests__/fixtures/compile-native lib/skills/__tests__/compile-native.e2e.test.ts
git commit -m "skills: compile-native end-to-end fixture and chain-refusal test"
```

---

## Phase B — Engines (mattstack-skills)

Every task in this phase ends with `sh tests/repo-purity.sh` and `sh tests/certify.sh <dir>` green. Never write a team name.

### Task 10: `pipeline-state.sh run-start` gains `--ticket`, `--mattstack-sha`, `--mattstack-dirty`

**Files:**
- Modify: `attachments/pipeline/work/scripts/pipeline-state.sh:104-156`
- Create: `attachments/pipeline/work/scripts/tests/pipeline-state-run-start.test.sh` (excluded from vendoring by name)

**Interfaces:**
- `run-start` accepts `--ticket <id>` (writes `fields.ticket` with `produced_by='work'` only when non-empty), `--mattstack-sha <sha>` (appended to `pack_commits` as `mattstack=<sha>`), `--mattstack-dirty <0|1>` (ORed into `pack_dirty`). Output unchanged.

- [ ] **Step 1: Write the failing test**

```sh
#!/bin/sh
# attachments/pipeline/work/scripts/tests/pipeline-state-run-start.test.sh
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PS="$HERE/../pipeline-state.sh"
export HOME=$(mktemp -d)
out=$(sh "$PS" run-start --repo r --work-type feature --pipeline feature \
  --ticket ABC-1 --mattstack-sha deadbee --mattstack-dirty 1 --pack-dirs "")
db=$(printf '%s' "$out" | jq -r .runDb)
fail=0
[ "$(sqlite3 "$db" "SELECT value FROM fields WHERE key='ticket';")" = "ABC-1" ] || { echo "FAIL ticket field"; fail=1; }
[ "$(sqlite3 "$db" "SELECT produced_by FROM fields WHERE key='ticket';")" = "work" ] || { echo "FAIL ticket produced_by"; fail=1; }
case "$(sqlite3 "$db" "SELECT pack_commits FROM runs;")" in *"mattstack=deadbee"*) ;; *) echo "FAIL mattstack sha"; fail=1 ;; esac
[ "$(sqlite3 "$db" "SELECT pack_dirty FROM runs;")" = "1" ] || { echo "FAIL dirty"; fail=1; }
out2=$(sh "$PS" run-start --repo r --work-type feature --pipeline feature --pack-dirs "")
db2=$(printf '%s' "$out2" | jq -r .runDb)
[ -z "$(sqlite3 "$db2" "SELECT value FROM fields WHERE key='ticket';")" ] || { echo "FAIL ticket written without --ticket"; fail=1; }
[ "$fail" = 0 ] && echo "ok   run-start flags"
exit $fail
```

- [ ] **Step 2: Run to verify it fails**

Run: `sh attachments/pipeline/work/scripts/tests/pipeline-state-run-start.test.sh`
Expected: `FAIL ticket field` (and others)

- [ ] **Step 3: Implement**

In the `run-start)` case, after `PACK_DIRS=$(flag --pack-dirs "$@" x)`:

```sh
    TICKET=$(flag --ticket "$@" x)
    MS_SHA=$(flag --mattstack-sha "$@" x)
    MS_DIRTY=$(flag --mattstack-dirty "$@" x)
```

After the `prov=$(pack_provenance "$PACK_DIRS")` block:

```sh
    if [ -n "$MS_SHA" ]; then PACKC="${PACKC:+$PACKC,}mattstack=$MS_SHA"; fi
    [ "$MS_DIRTY" = 1 ] && PACK_DIRTY=1
```

After the `INSERT INTO runs` succeeds and before `export RT_RUN_DB`:

```sh
    if [ -n "$TICKET" ]; then
      sqlite3 "$RT_RUN_DB" "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at)
        VALUES ('$(esc "$RUN_ID")', 'ticket', '$(esc "$TICKET")', 'work', $(now_ms));" >/dev/null \
        || json_fail "could not record ticket" 1
    fi
```

Update the usage comment at the top of the file to list the three flags.

- [ ] **Step 4: Run to verify it passes**

Run: `sh attachments/pipeline/work/scripts/tests/pipeline-state-run-start.test.sh`
Expected: `ok   run-start flags`

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/mattstack-skills
git add attachments/pipeline/work/scripts/pipeline-state.sh attachments/pipeline/work/scripts/tests/pipeline-state-run-start.test.sh
git commit -m "pipeline-state: run-start takes --ticket, --mattstack-sha, --mattstack-dirty"
```

---

### Task 11: Certify gate — runtime-native skills must not contain `{{`

**Files:**
- Modify: `tests/certify.sh`
- Modify: `tests/` matrix runner if one enumerates checks (read `tests/certify.sh` header; add the check where `vendored-resolver` lives)

- [ ] **Step 1: Write the failing test** — a fixture dir under `tests/fixtures/certify/runtime-native-with-placeholder/SKILL.md` whose frontmatter declares `metadata.slots: "x"` and whose body contains `{{slot:x}}`; run `sh tests/certify.sh tests/fixtures/certify/runtime-native-with-placeholder` and expect a `FAIL` line named `no-placeholders-in-runtime-native`.

- [ ] **Step 2: Run to verify it fails** — the check does not exist yet, so certify reports `ok` for everything; the test harness expectation (a FAIL line) is not met.

- [ ] **Step 3: Implement** in `certify.sh`, next to the `vendored-resolver` check:

`certify.sh` reports through its `ok` / `fail` helpers (the `fail` helper is what sets the non-zero exit); an ad-hoc `echo FAIL` prints but never bites. Use the helpers:

```sh
# A skill that resolves slots at run time (metadata.slots + resolve-args.sh)
# must never carry a compile-time placeholder: the two modes do not mix.
if grep -q '^  slots:' "$DIR/SKILL.md" 2>/dev/null && grep -q '{{' "$DIR/SKILL.md"; then
  fail no-placeholders-in-runtime-native "metadata.slots skill contains {{"
else
  ok no-placeholders-in-runtime-native
fi
```

Read the existing `vendored-resolver` check first and match its exact helper names and argument order.

- [ ] **Step 4: Run to verify it passes** — fixture reports the FAIL line; every real skill still certifies `ok`.

- [ ] **Step 5: Commit**

```bash
git add tests/certify.sh tests/fixtures/certify/runtime-native-with-placeholder
git commit -m "certify: runtime-native skills may not contain placeholders"
```

---

### Task 12: Convert the `work` engine

**Files:**
- Rewrite: `attachments/pipeline/work/SKILL.md`
- Delete: `attachments/pipeline/work/scripts/resolve-pipeline.sh`, `attachments/pipeline/work/scripts/resolve-args.sh`
- Modify: `plugin/tests/test-resolve-pipeline.sh` — delete (its subject is gone); remove its invocation from the plugin test matrix.

**Interfaces:** consumes `{{work-type}}`, `{{pipeline.stages}}`, `{{run-start.flags}}`, `{{slot:tiering}}` (Task 3 semantics).

- [ ] **Step 1: Write the check** — a shell assertion the compiled fixture in Task 9 already enforces (no `resolve-*`, no `{{`, markers present). Here the RED is: `grep -c 'resolve-pipeline\|resolve-args\|uow' attachments/pipeline/work/SKILL.md` is non-zero.

- [ ] **Step 2: Rewrite the file.** Frontmatter:

```yaml
---
name: work
disable-model-invocation: true
description: "Use when running a unit of work through a configured pipeline -- 'run the feature pipeline', 'do this ticket end to end', 'start a unit of work', or when a repo's .mattstack/skills.jsonc defines pipelines and a ticket or task should flow through its stages."
allowed-tools:
  - Bash(${CLAUDE_SKILL_DIR}/scripts/pipeline-state.sh:*)
  - Bash(git -C *:*)
type: pipeline-step
slots:
  tiering: { contract: model-tiering@1, required: false }
---
```

Body:

````markdown
# work -- the do-a-unit-of-work orchestrator

You run one unit of work through the pipeline compiled into this skill.
Everything below the stage list is baked: you never resolve a stage, a
binding, or a chain -- the compiler already did.

## 1. Work type

{{work-type}}

## 2. Stages

Read the list for the chosen work type. Each entry is a compiled stage
skill sitting beside this one; `dir` is where to read it.

{{pipeline.stages}}

## 3. Start the run

```bash
export RT_PIPELINE_STATE="${CLAUDE_SKILL_DIR}/scripts/pipeline-state.sh"
PACK_DIRS=$(git -C "${CLAUDE_SKILL_DIR}" rev-parse --show-toplevel)
```

Then run `run-start` with the flags for the chosen work type, adding
`--ticket <id>` when the request named one and `--spawned-by "<surface>"`
when this run was spawned rather than started interactively. Never
fabricate a ticket.

{{run-start.flags}}

```bash
"$RT_PIPELINE_STATE" run-start <flags for the work type> --pack-dirs "$PACK_DIRS" [--ticket <id>] [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
```

Back-fill any spawn-time decision made before the DB existed (account
selection per `account-pool@1`): `"$RT_PIPELINE_STATE" decision record
--contract account-pool@1 --scope run --selection '<JSON>' --decided-by
<spawning surface>`.

## 4. Walk the stages

For each entry, in order:

1. `"$RT_PIPELINE_STATE" stage-start --stage <stage>`
2. Read `<dir>/SKILL.md` and follow it. It carries its own domain rules
   inline and states what it consumes and produces.
3. When it finishes, `"$RT_PIPELINE_STATE" snapshot` and confirm every
   field in the entry's `produces` is non-null. A missing field means the
   stage did not finish: `stage-fail --stage <stage> --reason "<what>"`,
   report, stop.
4. `"$RT_PIPELINE_STATE" stage-done --stage <stage>`

A stage failure stops the pipeline. Report which stage and that a resume
continues from it.

## Resume

Re-entering existing work with no `RT_RUN_DB` set: list
`~/.mattstack/runs/<repo>/` (the `--repo` value above) for the newest run
whose status is `running` -- use `"$RT_PIPELINE_STATE" snapshot` with
`RT_RUN_DB` pointed at each candidate, never raw sqlite -- confirm the
match with the user, re-export `RT_RUN_DB`, and re-enter at
`run.current_stage` with the snapshot's fields and decisions. Do not
re-ask decided questions.

## Close

`"$RT_PIPELINE_STATE" run-status --status done` (or `failed` /
`abandoned`). Never leave a finished run `running`.

## Sub-agent tiering

{{slot:tiering}}

## Red flags -- stop yourself

- About to run a stage the list does not name, or skip one it does? Stop.
- About to carry state in prose because a `field set` feels slow? Stop:
  the DB survives compaction; your prose does not.
````

- [ ] **Step 3: Delete the two resolver scripts and the resolver test**

```bash
git rm attachments/pipeline/work/scripts/resolve-pipeline.sh attachments/pipeline/work/scripts/resolve-args.sh plugin/tests/test-resolve-pipeline.sh
```

Remove the `test-resolve-pipeline.sh` line from the plugin test matrix runner (grep `test-resolve-pipeline` under `plugin/tests/` and `tests/`).

- [ ] **Step 4: Verify**

Run: `grep -c 'resolve-pipeline\|resolve-args\|uow' attachments/pipeline/work/SKILL.md; sh tests/certify.sh attachments/pipeline/work; sh tests/repo-purity.sh`
Expected: `0`, all `ok`, `ok repo-purity`

- [ ] **Step 5: Commit**

```bash
git add -A attachments/pipeline/work plugin/tests
git commit -m "work: compile-native orchestrator; resolver scripts and uow record retired"
```

---

### Task 13: Convert the eight stages

**Files:**
- Modify: `attachments/pipeline/stage-{provision,plan,gates,evidence,implement,self-review,ship,watch-ci}/SKILL.md`
- Delete: each `attachments/pipeline/stage-*/scripts/resolve-args.sh`

**Interfaces:** each stage's frontmatter becomes:

```yaml
---
name: stage-<n>
description: "<unchanged>"
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: <n>-domain@1, required: false }
allowed-tools: <unchanged minus the resolve-args.sh entry>
metadata:
  stage: "<n>"
  stage-consumes: "<unchanged>"
  stage-produces: "<unchanged>"
---
```

`stage-watch-ci` keeps two slots (`domain`, `forge`); `stage-implement` declares no `slots:` block. The `metadata.slots` / `slot-<name>` keys are deleted.

- [ ] **Step 1: RED** — `grep -l 'resolve-args\|uow record\|uow\.json\|the record' attachments/pipeline/stage-*/SKILL.md` lists files.

- [ ] **Step 2: For each stage**, in the body:
  - Insert `{{stage.fields}}` as the first line under the `# stage: <n>` heading.
  - Replace the "Otherwise resolve the domain slot: … read the SKILL.md at `resolved.domain.path` and follow it" block with a `## Domain rules` heading followed by `{{slot:domain}}` and one sentence: *"When nothing is inlined above, follow the generic path below."*
  - Delete every sentence that writes to or reads from "the record" / "uow record" / `uow.json`; where a stage wrote a value to the record AND to the DB, keep only the `field set` call. Where a stage read `mode` from the record (`stage-provision`'s worker path), read it from `"$RT_PIPELINE_STATE" field get mode` instead, and note in the body that an unset `mode` means `interactive`.
  - In `stage-watch-ci` and any stage that invokes its own scripts, leave `${CLAUDE_SKILL_DIR}/scripts/...` as written (the compiler rewrites it to the stage dir); replace `<resolved.forge.path>/scripts/ci-forge.sh` with `{{stage.dir}}/parts/forge/scripts/ci-forge.sh` and put `{{slot:forge}}` under a `## Forge` heading.
  - Delete the "Run state … If `RT_RUN_DB`/`RT_PIPELINE_STATE` are unset you are running standalone" paragraph's standalone clause: a compiled stage always runs under `work`. Keep the four lifecycle calls.

- [ ] **Step 3: Delete the vendored resolvers**

```bash
git rm attachments/pipeline/stage-*/scripts/resolve-args.sh
```

- [ ] **Step 4: Verify**

Run: `for d in attachments/pipeline/stage-*/; do sh tests/certify.sh "$d" | grep FAIL; done; grep -l 'resolve-args\|uow' attachments/pipeline/stage-*/SKILL.md; sh tests/repo-purity.sh`
Expected: no FAIL lines, no files listed, purity ok

- [ ] **Step 5: Commit**

```bash
git add -A attachments/pipeline
git commit -m "stages: compile-native; typed slots, inline domain fills, single state store"
```

---

### Task 14: Convert `ship`, `watch-ci`, `shepherdr`

**Files:**
- Modify: `attachments/pipeline/ship/SKILL.md`, `attachments/pipeline/watch-ci/SKILL.md`, `attachments/orchestration/shepherdr/SKILL.md`
- Delete: their `scripts/resolve-args.sh`

- [ ] **Step 1: RED** — `grep -c 'resolve-args' attachments/pipeline/ship/SKILL.md attachments/pipeline/watch-ci/SKILL.md attachments/orchestration/shepherdr/SKILL.md` non-zero.

- [ ] **Step 2: For each:** keep the typed `slots:` block, delete `metadata.slots`/`slot-*` keys and the `resolve-args.sh` `allowed-tools` entry; replace the "resolve your slots … read `resolved.<slot>.path`" block with one `{{slot:<name>}}` per slot under a heading named for the slot; delete the "In a compiled skill … do not run resolve-args.sh" caveats. In `watch-ci`, `<resolved.forge.path>/scripts/ci-forge.sh` becomes `${CLAUDE_SKILL_DIR}/parts/forge/scripts/ci-forge.sh` (a verb, not a stage, so `CLAUDE_SKILL_DIR` is its own dir). In `shepherdr`, `pick-account.py` is addressed as `${CLAUDE_SKILL_DIR}/parts/accounts/scripts/pick-account.py`.

- [ ] **Step 3: Delete resolvers**

```bash
git rm attachments/pipeline/ship/scripts/resolve-args.sh attachments/pipeline/watch-ci/scripts/resolve-args.sh attachments/orchestration/shepherdr/scripts/resolve-args.sh
```

- [ ] **Step 4: Verify** — certify each dir, purity, `grep -c 'resolve-args'` = 0.

- [ ] **Step 5: Commit**

```bash
git add -A attachments/pipeline/ship attachments/pipeline/watch-ci attachments/orchestration/shepherdr
git commit -m "ship, watch-ci, shepherdr: compile-native slots"
```

---

### Task 15: Dissolve `review-core` / `review-dispatch`; convert the three review verbs; `review-posting`

**Files:**
- Create: `attachments/review-core-body/SKILL.md`, `attachments/review-core-body-after/SKILL.md`, `attachments/review-dispatch-body/SKILL.md`, `attachments/review-dispatch-body-after/SKILL.md` (+ `review-dispatch-body-after/references/adjudicator.md`, moved)
- Delete: `attachments/review-core/`, `attachments/review-dispatch/`
- Modify: `attachments/review/review/SKILL.md`, `attachments/review/self-review/SKILL.md`, `attachments/review/receive-review/SKILL.md`, `attachments/review-posting/SKILL.md`

- [ ] **Step 1: Confirm nothing invokes the two directly**

Run: `grep -rn 'review-core\b\|review-dispatch\b' --include='SKILL.md' --include='*.jsonc' --include='*.sh' . ~/.mattstack/teams 2>/dev/null | grep -v '^./attachments/review' | grep -v 'review-core-body\|review-dispatch-body'` (quote the `--include` patterns: under zsh an unquoted `*.jsonc` glob aborts the command)
Expected: only the manifest binding line `"mattstack:review-core": { "criteria": ... }` (which becomes dead after this task and is removed from the pack manifest in Task 18) and doc mentions. If a slash invocation or a board launch names them, STOP and report; do not delete.

- [ ] **Step 2: Create the bodies.** `review-core-body/SKILL.md`:

```yaml
---
name: review-core-body
description: "Shared review flow body, inlined by the review verbs. Not for direct invocation."
disable-model-invocation: true
---
```

followed by `review-core/SKILL.md`'s body, split at the two runtime reads it performs. Its body reads criteria at one point (`resolved.criteria.path`) and, in its step 4, dispatches through `../review-dispatch/SKILL.md`, which itself reads the reviewer at `resolved.reviewer.path`. Both reads become slots owned by the verb, so the shared prose is cut into slotless pieces around them:

- `review-core-body` = review-core's body from the top up to (not including) the criteria read, with the `resolve-args.sh` block removed.
- `review-core-body-after` = review-core's body after the criteria read up to (not including) the step-4 dispatch line.
- `review-dispatch-body` = review-dispatch's body from the top up to (not including) the reviewer read, `resolve-args.sh` block removed.
- `review-dispatch-body-after` = review-dispatch's body after the reviewer read to the end, followed by whatever review-core had after its step-4 dispatch line.

No piece may contain `../`, `resolve-args`, `resolved.`, or `{{` (they are include targets). Two survivors of those greps must also go, because they describe a step that no longer exists: review-core's HARD-GATE sentence "Only step 2's resolver call precedes it" and its "## 2. Resolve the `criteria` slot" heading -- delete the sentence and the heading (the criteria now arrive inline from the verb's `{{slot:criteria}}` directly above `review-core-body-after`). Renumber review-core's remaining steps.

`review-dispatch` references its own `references/adjudicator.md` by bare relative path; in the include body write that reference as `${CLAUDE_SKILL_DIR}/references/adjudicator.md`. The compiler rewrites it to `<partsPrefix>/include-review-dispatch-body-after/references/adjudicator.md` and vendors the file there (Task 3's `includeText` + Task 6's `buildVendoredFiles`), so the include target stays portable and the compiled verb finds the file. Move the file with git so Step 6's `git rm -r attachments/review-dispatch` does not take it with it:

```bash
mkdir -p attachments/review-dispatch-body-after/references
git mv attachments/review-dispatch/references/adjudicator.md attachments/review-dispatch-body-after/references/adjudicator.md
```

Each piece's frontmatter is the three-line shape above with its own `name`.

- [ ] **Step 3: Convert the verbs.** All three verbs compose the same four includes around two slots. `review` keeps its typed `slots:` (`criteria`) and adds `reviewer`; `self-review` has no typed `slots:` today (it reached criteria only through review-core) and gains both `criteria` and `reviewer`; `receive-review` keeps `criteria` and `reply-rules` and adds `reviewer`. Each drops `metadata.slots`, deletes its `scripts/resolve-args.sh`, and replaces its relative-path read with:

```markdown
{{include:review-core-body}}

## Criteria

{{slot:criteria}}

{{include:review-core-body-after}}

{{include:review-dispatch-body}}

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}
```

The pack manifest must bind `reviewer` for all three verbs (Task 18 adds `"reviewer"` to each verb's binding, pointing at the same reviewer fill `mattstack:review-dispatch` was bound to). `review` also drops the `claude plugin list --json` lookup for `gitlab-mr-threads`: replace with `{{include:gitlab-mr-threads}}` (slotless; verify with `grep -c slots attachments/gitlab-mr-threads/SKILL.md` = 0).

- [ ] **Step 4: `review-posting`** — replace its `../review-core/SKILL.md` and `../review-dispatch/SKILL.md` references with prose that names the shape ("the draft, in the review flow's Strengths / Issues shape") and no path; it is itself an include target so it may not contain placeholders.

- [ ] **Step 5: Retire the resolver-identity tests and the template binding.** `plugin/tests/test-resolve-args.sh` asserts (around lines 305-321) that `review-core` and `review-dispatch` ship byte-identical `resolve-args.sh` copies; delete those two cases (the directories are gone). `templates/domain-pack/skills.jsonc:25` binds `mattstack:review-core`; delete that line so a new pack scaffolded from the template does not bind a retired engine.

- [ ] **Step 6: Delete and verify**

```bash
git rm -r attachments/review-core attachments/review-dispatch attachments/review/*/scripts/resolve-args.sh
for d in attachments/review/*/ attachments/review-core-body attachments/review-core-body-after attachments/review-dispatch-body attachments/review-dispatch-body-after attachments/review-posting; do sh tests/certify.sh "$d" | grep FAIL; done
sh tests/repo-purity.sh
grep -rn '\.\./' attachments/review attachments/review-posting attachments/review-*-body*
```
Expected: no FAIL, purity ok, no `../` reads. Also `sh plugin/tests/test-resolve-args.sh` still passes with the two cases removed.

- [ ] **Step 7: Commit**

```bash
git add -A attachments/review attachments/review-core-body attachments/review-core-body-after attachments/review-dispatch-body attachments/review-dispatch-body-after attachments/review-posting plugin/tests/test-resolve-args.sh templates/domain-pack/skills.jsonc
git commit -m "review: dissolve review-core/dispatch into include bodies; verbs own the slots"
```

---

### Task 16: Retire the unit-of-work record from docs; record the compile-native rule

**Files:**
- Modify: `attachments/parameterized-skills/references/convention.md` — delete the "Unit-of-work record (v1)" section; add a "Compile-native vs runtime-native" section.
- Delete: `plugin/schemas/uow.md`, `plugin/schemas/uow.schema.json`
- Modify: `README.md` — remove the uow entry.

- [ ] **Step 1: RED** — `grep -rn 'uow' README.md plugin/schemas attachments/parameterized-skills/references/convention.md` lists hits.

- [ ] **Step 2: Add to `convention.md`** (replacing the uow section, at the same position):

```markdown
## Compile-native vs runtime-native

A skill is one of two kinds, never both.

**Compile-native** engines are consumed only after `rt skills compile`. They
declare typed top-level `slots:` and `type: pipeline-step`, and their
bodies carry `{{placeholder}}` markers that only the compiler fills
(`slot`, `include`, `pipeline.stages`, `work-type`, `stage.fields`,
`stage.dir`, `run-start.flags`, `compiled-from`). Run raw, they visibly do
not work: an unfilled placeholder is a compile error and never reaches an
agent. They ship no `resolve-args.sh`; the compiler errors if one is
called. The pipeline engines, the review verbs, `ship`, `watch-ci`, and
`shepherdr` are compile-native.

**Runtime-native** wrappers resolve their slots at skill time with the
vendored `resolve-args.sh` described above. They declare `metadata.slots`
and must never contain `{{`; the certify gate errors if one does. The
board's `mr-board:*` wrappers are runtime-native.

An `{{include:<attachment>}}` target must be slotless and contain no
placeholder; it inlines in place with a seam marker of kind `include`.
```

- [ ] **Step 3: Delete the schema files and README entry**

```bash
git rm plugin/schemas/uow.md plugin/schemas/uow.schema.json
```

Edit `README.md` to remove the line naming `uow`.

- [ ] **Step 4: Verify** — `grep -rn 'uow' README.md plugin/schemas attachments/parameterized-skills` → nothing; `sh tests/repo-purity.sh` ok.

- [ ] **Step 5: Commit**

```bash
git add -A README.md plugin/schemas attachments/parameterized-skills
git commit -m "convention: compile-native vs runtime-native; unit-of-work record retired"
```

---

### Task 17: Estate sweep — nothing left references a retired mechanism

**Files:** none modified unless the sweep finds a hit.

- [ ] **Step 1: Sweep**

```bash
cd ~/Documents/GitHub/mattstack-skills
grep -rn 'resolve-pipeline\|uow\.json\|uow record\|resolved\.[a-z]*\.path\|RESOLVED_FILL_PATHS\|git_root_of' --include='*.md' --include='*.sh' --include='*.jsonc' . | grep -v '^./docs/superpowers/' | grep -v '^./.git/'
```
Expected: only `mr-board:*`-related text if any lives here (it does not), otherwise empty. Fix any hit in place.

- [ ] **Step 2: Every-skill certify**

```bash
for d in attachments/*/ attachments/*/*/ skills/*/ skills/*/*/ plugin/skills/*/; do [ -f "$d/SKILL.md" ] && sh tests/certify.sh "$d" | grep -E '^FAIL' && echo "  in $d"; done; sh tests/repo-purity.sh
```
Expected: no FAIL, purity ok.

- [ ] **Step 3: Commit any fixes** with message `sweep: retire remaining references to runtime resolution`.

---

## Phase C — Release and prove

### Task 18: Team pack — edit the two domain fills, drop the dead binding

**Files (private pack repo, NOT public):**
- Modify: the plan-policy fill (`attachments/<plan-policy>/SKILL.md`): its "write this verdict into the uow record too" sentence becomes "write this verdict with `"$RT_PIPELINE_STATE" field set approach <verdict> --stage plan`".
- Modify: the gates fill (`attachments/<gates>/SKILL.md`): "decide from the PLANNED paths in the plan or uow record" becomes "decide from the PLANNED paths in the plan (`"$RT_PIPELINE_STATE" field get approach`)".
- Modify: the repo manifest `~/.mattstack/repos/<slug>/skills.jsonc` AND the pack's `pack/skills.jsonc` template: delete the `"mattstack:review-core"` and `"mattstack:review-dispatch"` bindings, and add a `"reviewer"` key to the `mattstack:review`, `mattstack:self-review`, and `mattstack:receive-review` bindings pointing at whatever fill `mattstack:review-dispatch.reviewer` was bound to (read it before deleting that line).
- Modify: two pack fills that mention the retired engines by name in prose only (the review-criteria fill's description says "Use when mattstack:review-core or ..."; a conventions fill lists "review-core (mattstack, internal)"): reword to name the `review` verb. `grep -rn 'review-core\|review-dispatch' <pack>/` must come back empty.

- [ ] **Step 1:** `grep -rn 'uow' <pack>/attachments/` lists the two fills.
- [ ] **Step 2:** Apply the two edits and the manifest deletion.
- [ ] **Step 3:** `grep -rn 'uow' <pack>/attachments/` → empty.
- [ ] **Step 4:** Commit in the pack repo: `fills: state lives in the run DB; drop the review-core binding`.

---

### Task 19: Release mattstack, recompile the pack, install, prove

- [ ] **Step 1: Bump mattstack** — edit `mattstack-skills/.claude-plugin/plugin.json` `version` to the next minor (the placeholder contract is a new engine representation). Commit `mattstack <v>: compile-native pipeline engines`.

- [ ] **Step 2: Install the compiler and the plugin**

```bash
cd ~/Documents/GitHub/repo-tools && git log --oneline -1   # Phase A commits present on this checkout
claude plugin update mattstack@mattstack
```

Confirm: `grep -c '{{' ~/.claude/plugins/cache/mattstack/mattstack/<v>/attachments/pipeline/work/SKILL.md` is non-zero (raw engine is inert, as designed).

- [ ] **Step 3: Compile the pack**

```bash
~/.local/bin/rt skills compile --pack <pack>
~/.local/bin/rt skills check --pack <pack>
```
Expected: every verb and every stage `current`; output lines show `-> attachments` for the eight stages and the four internal verbs, `-> skills` for the public ones.

- [ ] **Step 4: Assert the compiled artifacts**

```bash
P=~/.mattstack/teams/<team>/mattstack/packs/<pack>
grep -rl 'resolve-args\|resolve-pipeline\|{{' "$P/skills" "$P/attachments/stage-"* ; echo "exit=$? (1 = clean)"
grep -c '<!-- part: ' "$P/skills/work/SKILL.md" "$P/attachments/stage-plan/SKILL.md"
grep -o 'mattstack-sha [0-9a-f]*' "$P/skills/work/SKILL.md" | head -1
```
Expected: no files listed; marker counts ≥ 2 each; a real short sha.

- [ ] **Step 5: Bump, commit, push the pack; update every account**

```bash
# bump <pack>/.claude-plugin/plugin.json, then:
git -C ~/.mattstack/teams/<team> add -A mattstack/packs/<pack> && git -C ~/.mattstack/teams/<team> commit -m "pack: <v> -- compile-native stages"
git -C ~/.mattstack/teams/<team> push origin main
claude plugin update <pack>@<marketplace>
```

- [ ] **Step 6: Prove it end to end** — in a fresh Claude session inside a checkout of the pack's repo, run `/<pack>:work` on a real ticket. Observe: no `resolve-pipeline.sh` or `resolve-args.sh` invocation in the transcript, one `run-start` call, and `sqlite3 ~/.mattstack/runs/<repo>/<newest>/state.db "SELECT pack_commits, pack_dirty FROM runs;"` shows `mattstack=<sha>` and the ticket in `fields`. Note the wall-clock time from invocation to the first stage's `stage-start` and compare to a pre-refactor run's transcript.

- [ ] **Step 7: Push mattstack-skills**

```bash
cd ~/Documents/GitHub/mattstack-skills && sh tests/repo-purity.sh && git push origin main
```

---

## Self-review

**Spec coverage.** Section 1 placeholders → Tasks 1, 3 (all eight kinds, unfilled error, include slotless rule in Task 5, surface rule kept in Task 6's backward path and `{{slot}}` in-place path, executable slots via `{{stage.dir}}` Task 6/13, `--pack-dirs` runtime derivation Task 12, `--mattstack-sha/dirty` Tasks 3/7/10, `--repo` key Task 7, seam markers Task 3 with include kind, per-file markers Task 9). Section 2 → Task 7 (gate, stages from manifest, stale-side, synthesized VerbDef description), Task 8 (default internal, classify), Task 6 (lint allowance, allowed-tools union), Task 4+7 (chain at compile), Task 15 (dissolution, review-posting), Task 16 (convention rule), Task 11 (certify gate). Section 3 → Tasks 10, 12, 13. Section 4 → Tasks 1–9 tests, 9 e2e, 11. Section 5 → Phase order A→B→C, Task 18 pack fills, Task 16 uow doc retirement, Task 19 release and proof.

**Placeholder scan.** No TBD/TODO. Task 13 and 14 describe per-file edits by rule rather than full bodies because the eight stage bodies are 60–150 lines each and unchanged outside the named regions; the rules name every region to touch and the verification greps prove completeness.

**Type consistency.** `StageEntry` defined in Task 2, consumed in Tasks 3, 4, 6, 7 with the same shape. `PlaceholderContext` fields match `substitute`'s reads and `compileSkill`'s construction. `outDirFor`/`otherSideDir` names match between Task 7 and its tests. `loadInclude`, `readManifestPipelines`, `stageRoster` names match Tasks 5 and 7. `run-start` flag names match Tasks 3, 10, 12.
