# Compile-native follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `rt skills check` mean "a recompile would change the artifact", let pack fills inline mattstack attachments at compile time, bake pack provenance into `run-start`, and close the three CLI gaps left after the compile-native release.

**Architecture:** One mattstack engine change (`pipeline-state.sh run-start --pack-sha`) ships first. One rt branch carries the compiler work: a provenance mask applied by `check`, a restricted placeholder pass over fill bodies, a baked `--pack-sha`, two helper modules split out of `commands/skills.ts`, and two CLI validations widened. The team pack is recompiled once at the end; the `editing-skills` rule that "any mattstack bump re-releases every pack" is retired last, proving Section 1 by not needing a pack release.

**Tech Stack:** Bun + TypeScript (repo-tools `lib/skills`, `commands/skills.ts`, `bun test`), POSIX sh + sqlite3 (`pipeline-state.sh`), Claude Code plugins.

**Spec:** `docs/superpowers/specs/2026-08-25-compile-native-followups-design.md` (mattstack-skills). The previous spec `2026-08-24-compile-native-pipeline-design.md` still governs everything this one does not mention.

## Global Constraints

- `check` masks exactly three token forms before comparing: `version=<v>` in `<!-- part: … -->` markers, the `compiled: "<…>"` frontmatter value, and `--mattstack-sha <token>` / `--pack-sha <token>` inside `run-start.flags`. `compile` writes real values.
- A fill body may carry `{{include:<name>}}` and nothing else placeholder-shaped; any other kind is a compile error naming the fill, the placeholder, and its line. Include targets stay slotless and placeholder-free (already enforced by `loadInclude`).
- `run-start.flags` gains `--pack-sha <pack>=<value>` after `--mattstack-dirty`; value = short git sha of `--pack-dir`, else the pack's `plugin.json` version. `run-start` appends `<name>=<value>` to `pack_commits` verbatim; `--pack-dirs` unchanged. Unknown flags are ignored by `flag()`.
- `--json` row shapes for compile/check/surface stay byte-compatible (the console reads them); additive top-level fields only.
- Seam-marker formats unchanged; a `slot:` part may now be followed by an `include:` part before the next `slot:`/`step` marker (contract note to the console lane, Task 8).
- Public repos (repo-tools, mattstack-skills): no team, product, or customer names; mattstack-skills uses `--`, never em-dashes; `sh tests/repo-purity.sh` passes.
- Clean-code comments: a comment states a constraint the code cannot show; never narrates or cites this plan.
- Never run git against the shared `~/Documents/GitHub/repo-tools` checkout; rt work happens in a worktree on branch `feat/compile-native-followups` created from `origin/main` AFTER PR "fix(skills): compiler hardening" (`fix/compiler-hardening`) has merged. Every rt task's file:line references assume that base.

---

## File structure (rt)

- `lib/skills/provenance.ts` (new): `maskProvenance(body)`, `gitFacts(dir)`, `mattstackProvenance(...)`, `packPluginIdentity(packDir)`, `packProvenance(packDir)`.
- `lib/skills/layout.ts` (new): `outDirFor`, `otherSideDir`, `buildStageEntries`, `targetOutDirs`.
- `lib/skills/placeholders.ts`: fill bodies pass through `substituteIncludesOnly`.
- `lib/skills/types.ts`: `PlaceholderContext.packSha: string`.
- `commands/skills.ts`: imports the two modules; `skillsCheck` masks; `loadIncludesFor` scans fills; `runSet` records never-compiled stages; `skillsBind` accepts stage targets.

---

### Task 1 (mattstack-skills): `run-start --pack-sha`

**Files:**
- Modify: `attachments/pipeline/work/scripts/pipeline-state.sh:4` (usage line), `:104-151` (`run-start` case)
- Modify: `attachments/pipeline/work/scripts/tests/pipeline-state-run-start.test.sh`

**Interfaces:**
- Produces: `run-start … --pack-sha <name>=<value>` → `pack_commits` contains `<name>=<value>`.

- [ ] **Step 1: Write the failing test** — append to the existing test script, before the final `[ "$fail" = 0 ] && echo …` line:

```sh
out3=$(sh "$PS" run-start --repo r --work-type feature --pipeline feature \
  --mattstack-sha deadbee --mattstack-dirty 0 --pack-sha acme=abc1234 --pack-dirs "")
db3=$(printf '%s' "$out3" | jq -r .runDb)
case "$(sqlite3 "$db3" "SELECT pack_commits FROM runs;")" in
  *"mattstack=deadbee"*"acme=abc1234"*) ;;
  *) echo "FAIL pack sha"; fail=1 ;;
esac
```

- [ ] **Step 2: Run** `sh attachments/pipeline/work/scripts/tests/pipeline-state-run-start.test.sh` — expected `FAIL pack sha`.

- [ ] **Step 3: Implement** — after line 111 (`MS_DIRTY=…`) add `PACK_SHA=$(flag --pack-sha "$@" x)`; after line 150 (`mattstack=$MS_SHA`) add:

```sh
    if [ -n "$PACK_SHA" ]; then PACKC="${PACKC:+$PACKC,}$PACK_SHA"; fi
```

Update the usage comment on line 4 to list `[--pack-sha NAME=VALUE]`.

- [ ] **Step 4: Run** the test — expected `ok   run-start flags`. Also `sh tests/certify.sh attachments/pipeline/work` (no FAIL) and `sh tests/repo-purity.sh`.

- [ ] **Step 5: Commit + release** — bump `.claude-plugin/plugin.json` to the next patch; commit `mattstack <v>: run-start records --pack-sha`; `claude plugin update mattstack@mattstack`; push main. (No pack recompile: `--pack-sha` is only emitted once Task 4 ships.)

---

### Task 2 (rt): provenance module and `check` masking

**Files:**
- Create: `lib/skills/provenance.ts`, `lib/skills/__tests__/provenance.test.ts`
- Modify: `commands/skills.ts` (move `gitFacts`, `mattstackProvenance`, `packPluginIdentity` out; `skillsCheck` ~`:891-902`)
- Test: `commands/__tests__/skills.test.ts`

**Interfaces:**
- Produces: `maskProvenance(text: string): string`; `gitFacts(dir): { sha: string; dirty: 0 | 1 }`; `packPluginIdentity(packDir): { name: string; version: string } | null`; `packProvenance(packDir): string` (short sha, else plugin version, else `""`).

- [ ] **Step 1: Failing unit test** (`provenance.test.ts`):

```ts
import { describe, expect, test } from "bun:test";
import { maskProvenance } from "../provenance.ts";

describe("maskProvenance", () => {
  test("masks marker versions, the compiled value, and baked provenance flags", () => {
    const body = [
      "---", 'name: "work"', "metadata:", '  compiled: "mattstack@0.10.3 + acme:plan-policy@0.5.2"', "---",
      "<!-- part: step source=mattstack:work version=0.10.3 path=attachments/pipeline/work/SKILL.md lines=13-98 -->",
      '  "feature": "--repo r --work-type feature --pipeline feature --mattstack-sha 0.10.3 --mattstack-dirty 0 --pack-sha acme=abc1234"',
      "<!-- part: slot:domain binding=acme:plan-policy version=0.5.2 path=attachments/plan-policy/SKILL.md lines=9-84 -->",
    ].join("\n");
    const masked = maskProvenance(body);
    expect(masked).not.toContain("0.10.3");
    expect(masked).not.toContain("0.5.2");
    expect(masked).not.toContain("abc1234");
    expect(masked).toContain("version=* path=attachments/pipeline/work/SKILL.md");
    expect(masked).toContain("compiled: *");
    expect(masked).toContain("--mattstack-sha * --mattstack-dirty 0 --pack-sha *");
  });
  test("leaves a body without provenance tokens unchanged", () => {
    expect(maskProvenance("plain text\n--mattstack-dirty 0")).toBe("plain text\n--mattstack-dirty 0");
  });
});
```

- [ ] **Step 2: Run** `bun test lib/skills/__tests__/provenance.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement** `lib/skills/provenance.ts`:

```ts
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const MARKER_VERSION_RE = /(<!-- part: [^>]*?\bversion=)[^\s>]+/g;
const COMPILED_RE = /^(\s*compiled: )"[^"\n]*"$/m;
const BAKED_FLAG_RE = /(--(?:mattstack|pack)-sha )\S+/g;

/** check compares artifacts with the versions and shas the compiler stamps masked out: a bump that changed no inlined body is not drift. */
export function maskProvenance(text: string): string {
  return text
    .replace(MARKER_VERSION_RE, "$1*")
    .replace(COMPILED_RE, "$1*")
    .replace(BAKED_FLAG_RE, "$1*");
}

export function gitFacts(dir: string): { sha: string; dirty: 0 | 1 } { /* moved verbatim from commands/skills.ts */ }
export function mattstackProvenance(/* moved verbatim, same signature */) { }
export function packPluginIdentity(packDir: string): { name: string; version: string } | null { /* moved verbatim */ }

/** The pack's own provenance token: its short sha when --pack-dir is a checkout, else the version its plugin.json declares. */
export function packProvenance(packDir: string): string {
  const { sha } = gitFacts(packDir);
  if (sha) return sha;
  return packPluginIdentity(packDir)?.version ?? "";
}
```

Move the three functions (bodies unchanged) and their existing tests; `commands/skills.ts` imports them.

- [ ] **Step 4: Failing command test** (`commands/__tests__/skills.test.ts`, next to the existing `skillsCheck` tests): compile a fixture pack, then rewrite every `version=<x>` in the emitted `skills/<verb>/SKILL.md` to `version=9.9.9` and the `compiled:` line to `compiled: "bumped"`; run `skillsCheck` → expect exit code 0 and the row `in-sync`. Second case: additionally change one prose line → `stale`, exit 1.

- [ ] **Step 5: Implement** in `skillsCheck` (`commands/skills.ts` ~`:896-902`): for a file whose `path` ends with `SKILL.md`, compare `maskProvenance(readFileSync(dest, "utf8"))` with `maskProvenance(file.content)`; other files compare bytes as today.

- [ ] **Step 6: Run** `bun test lib/skills commands/__tests__/skills.test.ts`; `bunx tsc --noEmit`.

- [ ] **Step 7: Commit** `feat(skills): check masks provenance tokens; provenance helpers move to lib/skills`.

---

### Task 3 (rt): layout module

**Files:**
- Create: `lib/skills/layout.ts`, `lib/skills/__tests__/layout.test.ts`
- Modify: `commands/skills.ts` (remove `outDirFor`, `otherSideDir`, `buildStageEntries`, `targetOutDirs`; import them), `commands/__tests__/skills.test.ts` (imports)

**Interfaces:**
- Produces: `outDirFor(packDir, name, isPublic)`, `otherSideDir(packDir, name, isPublic)`, `buildStageEntries({ pipelines, pluginRoots })`, `targetOutDirs(resolved, targets)` — signatures unchanged.

- [ ] **Step 1:** Move the four functions verbatim with the comments they carry; move the tests that target them (`outDirFor`/`buildStageEntries` cases in `commands/__tests__/skills.test.ts`) into `layout.test.ts`, unchanged except imports.
- [ ] **Step 2: Run** `bun test lib/skills commands` — same pass count as before the move; `bunx tsc --noEmit`.
- [ ] **Step 3: Commit** `refactor(skills): layout helpers move to lib/skills/layout.ts`.

---

### Task 4 (rt): baked `--pack-sha`

**Files:**
- Modify: `lib/skills/types.ts:42-54` (`PlaceholderContext` gains `packSha: string`), `lib/skills/placeholders.ts:68-77` (`runStartFlags`), `commands/skills.ts` (`resolve()` computes `packSha`; the `PlaceholderContext` construction passes it)
- Test: `lib/skills/__tests__/placeholders.test.ts:129-140`, `lib/skills/__tests__/compile-native.e2e.test.ts`

- [ ] **Step 1: Failing test** — in `placeholders.test.ts`, `ctx()` gains `packSha: "acme=abc1234"`; the run-start.flags test expects `"--repo my-repo --work-type feature --pipeline feature --mattstack-sha abc1234 --mattstack-dirty 0 --pack-sha acme=abc1234"`; the empty-sha test expects no `--pack-sha` when `packSha: ""`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `runStartFlags`:

```ts
const sha = ctx.mattstackSha ? ` --mattstack-sha ${ctx.mattstackSha}` : "";
const pack = ctx.packSha ? ` --pack-sha ${ctx.packSha}` : "";
out[t] = `--repo ${ctx.repoKey} --work-type ${t} --pipeline ${t}${sha} --mattstack-dirty ${ctx.mattstackDirty}${pack}`;
```

In `resolve()`: `const packSha = self ? `${self.name}=${packProvenance(packDir)}` : "";` (where `self = packPluginIdentity(packDir)` already exists) and carry it into `Resolved` and the context.
- [ ] **Step 4: e2e assertion** — `compile-native.e2e.test.ts`: `expect(work).toMatch(/--pack-sha acme=\S+/)` (the fixture pack's `plugin.json` is `{"name":"acme","version":"0.1.0"}`; inside repo-tools the fixture is a git checkout, so the value is a sha — assert `\S+`, not the version).
- [ ] **Step 5: Run** `bun test lib/skills`; `bunx tsc --noEmit`.
- [ ] **Step 6: Commit** `feat(skills): bake --pack-sha into run-start.flags`.

---

### Task 5 (rt): fills may `{{include}}`

**Files:**
- Modify: `lib/skills/placeholders.ts:46-53` (`slotText`), export `substituteIncludesOnly`
- Modify: `commands/skills.ts:572-583` (`loadIncludesFor` scans fill bodies too)
- Test: `lib/skills/__tests__/placeholders.test.ts`, e2e fixture `lib/skills/__tests__/fixtures/compile-native/`

**Interfaces:**
- Produces: `substituteIncludesOnly(body, ctx, where): string` — replaces `{{include:<n>}}` lines using `includeText`; throws `` `${where}: ${raw} -- a fill may carry {{include}} only (line N)` `` for any other kind.

- [ ] **Step 1: Failing tests** (`placeholders.test.ts`, in `describe("substitute")`):

```ts
test("a fill may inline an include, with its own marker", () => {
  const fillWithInclude = { ...fill, body: "policy\n{{include:review-core-body}}\ntail" };
  const { body } = substitute("{{slot:domain}}", ctx({ fills: { domain: fillWithInclude } }), "stage-plan");
  expect(body).toContain("<!-- part: slot:domain binding=acme:plan-policy");
  expect(body).toContain("<!-- part: include:review-core-body source=mattstack:review-core-body");
  expect(body).toContain("core A\ncore B");
  expect(body).not.toContain("{{");
});
test("a fill may not carry a slot or any other placeholder", () => {
  const bad = { ...fill, body: "x\n{{slot:tiering}}" };
  expect(() => substitute("{{slot:domain}}", ctx({ fills: { domain: bad } }), "stage-plan"))
    .toThrow("acme:plan-policy: {{slot:tiering}} -- a fill may carry {{include}} only (line 2)");
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — in `placeholders.ts`:

```ts
export function substituteIncludesOnly(body: string, ctx: PlaceholderContext, where: string): string {
  return body.split("\n").map((line, i) =>
    line.replace(PLACEHOLDER_RE, (raw, kind: string, arg?: string) => {
      if (kind !== "include") throw new Error(`${where}: ${raw} -- a fill may carry {{include}} only (line ${i + 1})`);
      if (line.trim() !== raw) throw new Error(`${where}: ${raw} must be alone on its line (line ${i + 1})`);
      const inc = arg ? ctx.includes[arg] : undefined;
      if (!arg || !inc) throw new Error(`${where}: include "${arg}" is not a loaded attachment`);
      return includeText(arg, inc, ctx);
    }),
  ).join("\n");
}
```

and in `slotText`, after the `${CLAUDE_SKILL_DIR}` rewrite: `const body = substituteIncludesOnly(rewritten, ctx, fill.binding);`. In `commands/skills.ts` `loadIncludesFor`, scan `findPlaceholders(fill.body)` for every bound fill as well as the step body (`loadFillsFor` runs first; pass its result in).
- [ ] **Step 4: e2e fixture** — `pack/attachments/plan-policy/SKILL.md` body becomes `policy text\n\n{{include:gitlab-note}}\n`; add `mattstack-home/plugins/mattstack/attachments/gitlab-note/SKILL.md` (frontmatter `name: gitlab-note`, `description: "note"`, body `note body`); e2e asserts the compiled `stage-plan` contains `<!-- part: include:gitlab-note` and `note body`.
- [ ] **Step 5: Run** `bun test lib/skills commands`; `bunx tsc --noEmit`.
- [ ] **Step 6: Commit** `feat(skills): fills may inline {{include}} targets`.

---

### Task 6 (rt): `surface set` on a never-compiled stage

**Files:**
- Modify: `commands/skills.ts` (`runSet`, near `:1395-1403` where `surface.jsonc` is written; `runApply` `:1461+`)
- Test: `commands/__tests__/skills-surface.test.ts`

- [ ] **Step 1: Failing test** — pack with a roster and a manifest declaring `mattstack:stage-plan` in a pipeline, nothing compiled; `skillsSurface(["set", "stage-plan", "--public", …flags])` → exit code undefined (no error), `surface.jsonc` `public` contains `"stage-plan"`, stdout contains `stage-plan: recorded; emitted to skills/ on the next compile`. `apply` on the same pack prints the same line and does not throw.
- [ ] **Step 2: Run** — FAIL (today: unknown-skill error).
- [ ] **Step 3: Implement** — in `runSet`/`runApply`, when a name is in `stageNamesFor(...)` and neither `skills/<name>` nor `attachments/<name>` exists: record the surface change and print the message; skip the move.
- [ ] **Step 4: Run** `bun test commands/__tests__/skills-surface.test.ts`.
- [ ] **Step 5: Commit** `feat(skills): surface set records a stage before its first compile`.

---

### Task 7 (rt): `bind` accepts stage slots

**Files:**
- Modify: `commands/skills.ts:1786-1805` (`skillsBind` target lookup)
- Test: `commands/__tests__/skills.test.ts` (bind cases)

- [ ] **Step 1: Failing test** — manifest with `pipelines: { feature: ["mattstack:stage-plan"] }`; `skillsBind(["stage-plan", "domain", "acme:plan-policy", …flags])` writes `"mattstack:stage-plan": { "domain": "acme:plan-policy" }` into the manifest (dry-run prints `stage-plan.domain: (unbound) -> acme:plan-policy`). A slot the stage does not declare still errors with the known-slots list.
- [ ] **Step 2: Run** — FAIL (`verb "stage-plan" not found in roster`).
- [ ] **Step 3: Implement** — when the name is not in `fullRoster`, look it up in `stageRoster(resolved.pipelines)` (from `lib/skills/sources.ts`); load the stage with `loadStepSource(<engine>, pluginRoots)` exactly as for a verb; `engineRef` is `mattstack:<stage>`. Error text when neither matches: `"<name>" is neither a roster verb nor a pipeline stage (verbs: …; stages: …)`.
- [ ] **Step 4: Run** `bun test commands/__tests__/skills.test.ts`.
- [ ] **Step 5: Commit** `feat(skills): bind targets pipeline stages`.

---

### Task 8 (rt branch → PR; console note)

- [ ] **Step 1:** `bunx tsc --noEmit`; `bun test lib commands`; `bun test lib/__tests__/no-eager-tui.test.ts`; `bun run cli.ts skills check --pack <pack>` (read-only, from the worktree) — report.
- [ ] **Step 2:** Push `feat/compile-native-followups`; open the PR with a body listing the four contract-relevant facts: `check` masks provenance; `--pack-sha` in `run-start.flags`; a `slot:` part may be followed by an `include:` part; `check --json` unchanged in shape.
- [ ] **Step 3:** Append to `~/Documents/GitHub/console/.superpowers/sdd/2026-08-23-console-v1-5-wiring/HANDOFF-compiler-phase-a-for-console.md` a dated section "Markers: a slot part may be split by an include part" stating: treat every `<!-- part: … -->` marker as a boundary; do not assume a `slot:` region runs to the next `slot:`/`step` marker.
- [ ] **Step 4:** Merge on green CI; pull the shared checkout (Matt).

---

### Task 9 (team pack): recompile and release

- [ ] **Step 1:** In the pack's ship-domain fill, replace the runtime `claude plugin list` lookup of `gitlab-mr-threads` with `{{include:gitlab-mr-threads}}` on its own line.
- [ ] **Step 2:** Bump the pack's `plugin.json`; `rt skills compile --pack <pack>`; `rt skills check --pack <pack>` → all current; assert the compiled `work` carries `--pack-sha <pack>=<sha>` and the compiled `ship` contains `<!-- part: include:gitlab-mr-threads` inside the domain slot region and no `claude plugin list`.
- [ ] **Step 3:** Commit, push, `claude plugin update <pack>@<marketplace>`.

---

### Task 10 (mattstack-skills): retire the "any bump re-releases every pack" rule

**Files:**
- Modify: `plugin/skills/editing-skills/SKILL.md` (the read-table row and the "Releasing after a mattstack bump" section)

- [ ] **Step 1: RED** — subagent, skill as is, scenario "doc-only mattstack skill edited, bumped, updated; a compiled pack exists — anything else?" Expected today: "Yes, recompile every pack".
- [ ] **Step 2: Edit** — the table row becomes `| mattstack version in every seam marker | mattstack's plugin.json at compile time; check masks it, so a bump that changed no inlined engine, include, or fill is not drift |`; the section title becomes "Releasing an engine, include, or fill change"; step 2 reads "For each compiled pack that `rt skills check --pack <pack>` reports stale:". Under 500 chars of change; no em-dashes.
- [ ] **Step 3: GREEN** — same scenario → "No; run `rt skills check` per pack; only stale packs recompile". Regression: the engine-fix scenario still yields bump-before-compile.
- [ ] **Step 3b:** `attachments/orchestration/shepherdr/SKILL.md` has one prose sentence naming the bare path `references/strategies.md` ("no body from the strategy part's `references/strategies.md` is copied in"); the compiler's bare-path lint flags it because the vendored file lives under `parts/strategy/references/`. Reword to "no strategy body is copied in" so the sentence names no path. `sh tests/certify.sh attachments/orchestration/shepherdr` clean.
- [ ] **Step 4:** `sh tests/certify.sh plugin/skills/editing-skills`; `sh tests/repo-purity.sh`; bump mattstack; commit `mattstack <v>: editing-skills -- check decides which packs a bump touches`; `claude plugin update mattstack@mattstack`; push.
- [ ] **Step 5: Proof of Section 1** — `rt skills check --pack <pack>` after this doc-only bump reports every target current; no pack release.

---

## Self-review

**Spec coverage.** §1 → Tasks 2, 10. §2 → Task 5 (+ contract note in Task 8, pack use in Task 9). §3 → Tasks 1, 4, 9. §4 → Tasks 3, 6, 7 (+ Task 10 for the editing-skills consequence). §5 out-of-scope untouched. Testing section → each task's steps; release order → Tasks 1, 8, 9, 10 in that order.

**Placeholder scan.** The moved-verbatim bodies in Task 2/3 are the existing functions (named, with current locations); no TBDs.

**Type consistency.** `packSha: string` (Task 4) is what `maskProvenance` masks as `--pack-sha` (Task 2) and what Task 1's engine accepts as `NAME=VALUE`; `substituteIncludesOnly` (Task 5) reuses `includeText`/`ctx.includes` from `placeholders.ts`; `stageRoster`/`loadStepSource` (Task 7) are existing exports of `lib/skills/sources.ts`.
