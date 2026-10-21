# Base-pack team params and sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org base-pack text can carry `{{team.<key>}}` and `{{team.section:<name>}}` markers that `rt skills compile` fills from each team pack's `pack/params.jsonc` and `pack/sections/<name>.md`.

**Architecture:** One new pure module (`lib/skills/team-params.ts`) reads a team's values and resolves markers in a text body, collecting what is missing instead of throwing. Compile threads a team context through `PlaceholderContext` to the two places base text is rendered (inlined slot fills, copied base attachments), gathers every missing marker, and refuses once at pack level. Drift, anatomy and the console learn a fourth seam kind, `section:`. Init gains `--extends` and seeds the files compile says are missing.

**Tech Stack:** Bun + TypeScript (`bun test`), the console app's vitest for `parseSeam`, Markdown skills under `plugins/mattstack`.

**Spec:** `docs/superpowers/specs/2026-10-21-base-pack-team-params-design.md`

## Global Constraints

- Markers: `{{team.<key>}}`, `{{team.<key>?}}`, `{{team.section:<name>}}`, `{{team.section:<name>?}}`; `<key>`/`<name>` match `^[a-z][a-z0-9-]*$`; `section` is not a valid key.
- `pack/params.jsonc` shape: `{ "version": 1, "params": { "<key>": "<string>" } }`; a value is a non-empty string with no newline and no `{{`; `""` counts as missing.
- A section file's trailing newline is trimmed; whitespace-only counts as missing; it may not contain `{{`.
- Markers resolve only in base text (a fill whose plugin is in `pluginRoots.folderOnly`, or a `.md` attachment a base copies); only in the body, never frontmatter; never nested inside another marker. Each of these violations is a compile error naming the file and line.
- A section marker must be alone on its line (like `{{include}}`).
- "Required" = in base text this pack's compile emits; a key no emitted marker names is a compile warning, not an error.
- Section seam, exactly five tokens: `<!-- part: section:<name> source=<team plugin>:pack/sections/<name>.md version=<team plugin version> path=pack/sections/<name>.md lines=1-<n> -->`.
- Engine floor rises only for a pack whose emitted base text uses a `{{team.` marker: `minEngine = max(mattstack floor, TEAM_MARKERS_MIN_ENGINE)`.
- Repo rules: no employer terms (`scripts/repo-purity.sh`; examples use `acme-base`, `widgets`); every print through `lib/ui/out.ts`; compile diagnostics keep exact words; a policy/needs-you stop is not `out.fail`; `--json` frozen tests updated deliberately.
- Run `bun test <file>` from the worktree root (bunfig preload); only targeted tests locally, CI runs the rest.
- Any edit under `plugins/mattstack` bumps `plugins/mattstack/.claude-plugin/plugin.json`; skill text edits go through `superpowers:writing-skills` and `plugins/mattstack/tests/certify.sh`.

## Review Focus

1. A base fill that shows a marker literally in an example (inside a code fence): it still resolves (markers resolve everywhere in the body). A required one with no value refuses. Pinned in Task 1 (`resolves markers inside code fences`).
2. A malformed `pack/params.jsonc` (bad JSON, `params` not an object, a non-string value): one error naming `pack/params.jsonc` and the key, never a crash. Pinned in Task 1.
3. A team with no `pack/params.jsonc` and no `pack/sections/`, whose base uses only optional markers or none: compiles exactly as today, byte for byte. Pinned in Task 4.
4. A pipeline stage copy (`stage-x--pipe`) whose override fill is a team fill, while the default pipeline uses a base fill with markers: requiredness follows each emitted target's own fills. Pinned in Task 4.
5. A section file with CRLF line endings or a trailing blank line: inserted with `\n` endings, trailing newlines trimmed, and the seam `lines=` matches. Pinned in Task 1.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/skills/team-params.ts` (new) | Read team values; find and resolve team markers in one body; types for missing markers |
| `lib/skills/types.ts` | `PlaceholderContext.team` |
| `lib/skills/placeholders.ts` | Inlined fills (`slotText`) and copied attachments (`substituteAttachmentPlaceholders`) call the resolver |
| `lib/skills/compile.ts` | Legacy-engine inlining path calls the resolver |
| `lib/skills/base-attachments.ts` | Non-`.md` and frontmatter refusals for copied attachments; pass the team context |
| `commands/skills.ts` | Build the team context in `resolve()`; collect missing across targets; pack-level refusal; unused-key warning; conditional floor |
| `lib/skills/drift.ts`, `lib/skills/anatomy.ts` | `section:` seams in part walking and drift causes |
| `apps/console/src/app/wiring/parseSeam.ts` | `section` seam kind |
| `lib/skills/mcp-lint.ts` | Lint `pack/sections/*.md` |
| `lib/skills/init.ts`, `commands/skills-init.ts` | `--extends`, seeding, `params-missing` stop, resume |
| `plugins/mattstack/plugin/skills/{extending-a-pack,creating-a-pack,editing-skills}/SKILL.md`, `website/docs/skills/packs.mdx`, `website/docs/rt/reference/_partials/skills/*`, `lib/skills/README.md` | Docs |

---

### Task 1: The team-params module

**Files:**
- Create: `lib/skills/team-params.ts`
- Test: `lib/skills/__tests__/team-params.test.ts`

**Interfaces:**
- Produces:
  - `type TeamValues = { plugin: string; version: string; params: Record<string, string>; sections: Record<string, string> }`
  - `type MissingMarker = { kind: "param" | "section"; name: string; file: string; askedBy: string[] }` (`file` is `pack/params.jsonc` or `pack/sections/<name>.md`)
  - `type TeamContext = { values: TeamValues; basePlugins: ReadonlySet<string>; missing: Map<string, MissingMarker>; used: Set<string>; sawMarker: boolean }` (`missing` keyed `kind:name`; `used` holds param keys any emitted marker named; `sawMarker` turns true when any team marker is resolved)
  - `newTeamContext(values: TeamValues, basePlugins: ReadonlySet<string>): TeamContext`
  - `export const TEAM_MARKERS_MIN_ENGINE = "0.32.14"` (the `plugins/mattstack/.claude-plugin/plugin.json` version Task 7 bumps to; re-checked against main at merge)
  - `readTeamValues(packDir: string, plugin: string, version: string): TeamValues` (throws `Error("pack/params.jsonc: <why>")` on a malformed file; missing file or dir = empty)
  - `hasTeamMarker(text: string): boolean`
  - `resolveTeamMarkers(body: string, team: TeamContext, opts: { where: string; sectionSeams: boolean }): string`: replaces every team marker, records missing required ones in `team.missing` (with `opts.where` appended to `askedBy`), records param keys in `team.used`, and sets `team.sawMarker`. Throws `Error("<where>: <raw> ... (line <n>)")` for: an invalid key or name, `section` used as a key, a section marker not alone on its line, a team marker nested in another `{{...}}` marker, and a value or section text containing `{{`.

- [ ] **Step 1: Write the failing tests** (one `test()` each, `describe("team-params")`):
  - `resolves a value marker`: `{{team.linear-team}}` with `params["linear-team"] = "Widgets"` gives `Widgets`.
  - `optional value renders empty when absent`: `a {{team.x?}} b` gives `a  b`, and `missing` stays empty.
  - `required value records missing`: an absent `ticket-prefix` gives `missing.get("param:ticket-prefix")` = `{kind:"param", name:"ticket-prefix", file:"pack/params.jsonc", askedBy:["acme-base:provision-flow"]}`, and the marker renders as `""`.
  - `empty string counts as missing`.
  - `section with seams`: the `ci-extra` section `"line one\nline two\n"` alone on its line, with `sectionSeams: true`, gives `<!-- part: section:ci-extra source=widgets:pack/sections/ci-extra.md version=0.4.0 path=pack/sections/ci-extra.md lines=1-2 -->\nline one\nline two`.
  - `section without seams`: the same with `sectionSeams: false` gives `line one\nline two`.
  - `optional absent section removes its line`: `a\n{{team.section:x?}}\nb` gives `a\nb`.
  - `whitespace-only section counts as missing`.
  - `CRLF section normalizes`: `"one\r\ntwo\r\n\r\n"` inserts `one\ntwo`, with `lines=1-2`.
  - `resolves markers inside code fences`: a required marker inside a fence is resolved, or recorded missing.
  - `refuses section marker not alone on its line`, `refuses nested marker` (`{{pack.path:{{team.x}}/a}}`), `refuses {{ in a value`, `refuses {{ in a section`, `refuses key named section`, `refuses bad key` (`{{team.Bad_Key}}`). Each asserts the error message contains the `where` and `line N`.
  - `readTeamValues`: a missing file gives empty params. `{"version":1,"params":{"a":"x"}}` reads. Malformed JSON, `params` not an object, and a non-string value each throw with `pack/params.jsonc` in the message. A newline in a value throws. Section files are read from `pack/sections/*.md`, keyed by basename.

- [ ] **Step 2: Run it to make sure it fails.** `bun test lib/skills/__tests__/team-params.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/skills/team-params.ts`.** Use the JSONC reader the other pack files already use (find it from `readSurface` in `lib/skills`), and a team-only pattern `/\{\{team\.(section:)?([^}\s?]*)(\?)?\}\}/g` that runs before any other substitution. Detect nesting by an unclosed `{{` before a `{{team.` on the same line.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit** `add lib/skills/team-params.ts`.

### Task 2: Inlined base fills resolve team markers

**Files:**
- Modify: `lib/skills/types.ts` (`PlaceholderContext`), `lib/skills/placeholders.ts` (`slotText`), `lib/skills/compile.ts:383-388` (the legacy inlining path)
- Test: `lib/skills/__tests__/placeholders.test.ts`, `lib/skills/__tests__/compile.test.ts`

**Interfaces:**
- Consumes: Task 1 `TeamContext`, `resolveTeamMarkers`, `hasTeamMarker`.
- Produces: `PlaceholderContext.team?: TeamContext | null` (optional, so existing hand-built test contexts need no change; absent or null = no team pack in play, and any `{{team.` then throws). Both inlining paths call `resolveTeamMarkers(fill.body, ctx.team, { where: fill.binding, sectionSeams: true })` first, before `rewriteSkillDirRefs` / the `SKILL_DIR_TOKEN` split and before `substituteIncludesOnly`, only when `ctx.team.basePlugins.has(fill.plugin)`.

- [ ] **Step 1: Write the failing tests.**
  - `slotText resolves team markers in a base fill`: a fill with plugin `acme-base` (in `basePlugins`) and body `Team {{team.linear-team}}` gives `Team Widgets` after the slot seam.
  - `a team marker in a non-base fill is an error`: plugin `widgets` throws `widgets:x: {{team.linear-team}} -- team markers only resolve in base pack text (line 1)`.
  - `a team marker in a base fill's allowed-tools is an error`: `allowedTools: ["Bash({{team.x}}:*)"]` throws the same shape, ending `-- team markers only resolve in a body, not frontmatter`.
  - `section seam nests inside the slot`: the compiled body carries the slot seam, then the section seam, then the section lines.
  - Repeat the first test through the legacy engine path in `compile.test.ts`.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/placeholders.test.ts lib/skills/__tests__/compile.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Add the field. Thread `team` into both paths. The frontmatter check goes where `allowedTools` are merged into compiled frontmatter.
- [ ] **Step 4: Run.** Expected: PASS, and existing tests unchanged.
- [ ] **Step 5: Commit** `skills compile: resolve team markers in inlined base fills`.

### Task 3: Copied base attachments resolve team markers

**Files:**
- Modify: `lib/skills/placeholders.ts` (`substituteAttachmentPlaceholders`, `AttachmentRenderOpts`), `lib/skills/base-attachments.ts:243-262`
- Test: `lib/skills/__tests__/base-attachments.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `AttachmentRenderOpts.team: TeamContext | null`. `planBaseAttachments(..., team: TeamContext | null)` threads it through. In `.md` files team markers resolve with `sectionSeams: false` and `where: "<base>:attachments/<name>/<file>"`.

- [ ] **Step 1: Write the failing tests.**
  - `copied md attachment resolves a value and a section`.
  - `copied md attachment records a missing required value` (in `team.missing`, with `askedBy` set to the attachment path).
  - `a team marker in a copied non-md file is an error` (`scripts/x.sh` containing `{{team.x}}`) with `-- team markers only resolve in .md files`.
  - `a team marker in a copied md file's frontmatter is an error`.
  - `unknown non-team markers still pass through` (the existing behavior, kept).
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/base-attachments.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** The non-`.md` check reads the file as text only when its first 8 KB has no NUL byte (binary files are copied as today).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `skills compile: resolve team markers in copied base attachments`.

### Task 4: Pack-level refusal, unused keys, conditional floor

**Files:**
- Modify: `commands/skills.ts` (`resolve()` ~:640, the compile loop that calls `tryCompileVerb` ~:906, `compileFailure` ~:1273, `floorWrite` ~:1079 and its two callers ~:1183, ~:1651)
- Test: `commands/__tests__/skills.test.ts` (the base-fill block ~:618-835), `commands/__tests__/skills-floor.test.ts`, `commands/__tests__/skills-json-frozen.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `resolve()` builds `team: TeamContext` with `newTeamContext(readTeamValues(packDir, self.name, self.version), pluginRoots.folderOnly ?? new Set())`. When `packPluginIdentity` returns null, `team` is null: a pack with no plugin identity has no base text to resolve.
  - The refusal is data, not a throw: `performCompile` returns `missing: MissingMarker[]` beside `failures`, and the write pass is gated on it the way it is on failures (`writing = failures.length === 0 && missing.length === 0 && ...`). So no `SKILL.md` with a hole reaches disk and `packIsCompiled` stays false for init. `compilePackAll` passes `missing` through to its result, and the compile result type `deps.compile` returns to init gains `missing?: MissingMarker[]`.
  - Human branch: one failure block. The title is `The <pack> pack is missing values the <bases> pack asks for` (`<bases>` = the distinct base plugins in `askedBy`, joined with ", "). `details` has one line per file (`pack/params.jsonc: <key> (<askedBy>), ...` and `pack/sections/<name>.md (<askedBy>)`). `next` is `rt skills compile --pack <pack>`. Exit 1.
  - `--json` branch: the envelope gains `missing: MissingMarker[]`, with `exitCode = 1`.
  - Other in-memory compiles: `check` adds the same title to its compile errors (the way `pack/requires.json is out of date` rides `compileErrors`), and no verb reports `stale` for it. `compile --preview`, `anatomy` and `composition` refuse with the same block, so no text with a hole is printed or compared.
  - Unused keys, on a full compile only (`verbFilter === null`, the guard `fieldContract` uses): the human output gets a warning line `pack/params.jsonc: <key> is not asked for by any base text this pack compiles`, and the `--json` envelope gets `unusedParams: string[]` next to `fieldContract`.
  - `floorWrite(resolved, readFile, write, usesTeamMarkers: boolean)`: the floor is `max(mattstack floor, TEAM_MARKERS_MIN_ENGINE)` when true, and `usesTeamMarkers` is `team?.sawMarker === true`.

- [ ] **Step 1: Write the failing tests.**
  - `compile refuses with every missing value listed and writes nothing`: a two-verb pack, a base fill missing `linear-team`, and an attachment missing section `ci-extra`. Assert:
    - the failure title and details match the spec's example layout;
    - exit 1;
    - no `SKILL.md` and no copied attachment written.
  - `--json carries missing` (frozen test; `exitCode` 1).
  - `check lists missing values as a compile error`.
  - `preview, anatomy and composition refuse on missing values`.
  - `unused key does not warn under --verb`.
  - `a pack with no params and no markers compiles byte-identical` (Review Focus 3): compile before and after this feature on the fixture gives equal files.
  - `requiredness follows each emitted target` (Review Focus 4): a stage copy whose pipeline override is a team fill does not require that base fill's markers, and the default stage does.
  - `unused key warns`.
  - `floor rises only with team markers`: `skills-floor.test.ts`, both cases.
  - `check reports a params edit as drift`: compile, edit `pack/params.jsonc`, run check, and the verb is stale.
- [ ] **Step 2: Run** the three test files. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `skills compile: refuse missing team values once per pack; floor follows team markers`.

### Task 5: Section seams in drift, anatomy, composition and the console

**Files:**
- Modify: `lib/skills/drift.ts` (`DriftCause`, `MARKER_RE`, `causeOf`, `EXTENT_RE`, `partExtents`), `lib/skills/anatomy.ts:~93,~119`, `commands/skills.ts:~2268,~2287` (composition and anatomy callers), the check row wording that maps drift causes to words, `apps/console/src/app/wiring/parseSeam.ts` (+ its test)
- Test: `lib/skills/__tests__/drift.test.ts`, `lib/skills/__tests__/anatomy.test.ts`, the console's `parseSeam` test

**Interfaces:**
- Produces:
  - `DriftCause` gains `"team"`; `causeOf("section:<name>")` returns `"team"`, and check words it `team values`.
  - `partExtents` treats a `section:` marker nested in a slot like a nested include: the marker stands for one source line and carries `lines=` body lines.
  - `parseSeam` returns `kind: 'section'` for `section:<name>`.
  - Anatomy: a section is its own part. `AnatomyPartKind` gains `"section"`, `partsFromMarkers` maps the `section:` key to it, `partsOnDisk` keeps it, and the anatomy caller (~`commands/skills.ts:2268`) adds `sources["section:<name>"]` with ref `<team plugin>:pack/sections/<name>.md`. Update the `skillsAnatomy --json` frozen test deliberately.
- [ ] **Step 1: Write the failing tests.**
  - `partExtents spans a slot holding a 3-line section`: the slot's `end` covers the section body, and the next part starts after it.
  - `skillMdDriftCauses reports team for a changed section`.
  - `changedPartKeys sees a section edit`.
  - The anatomy line counts include section lines.
  - `parseSeam parses a section seam` (5 tokens).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Also run `bun run console:test` (or the console's vitest script named in `apps/console/package.json`).
- [ ] **Step 5: Commit** `skills: section seams in drift, anatomy and the console`.

### Task 6: Lint and init

**Files:**
- Modify: `lib/skills/mcp-lint.ts:127` (`LINTED_ROOTS` adds `join("pack", "sections")`), `lib/skills/init.ts` (`InitRefusalCode`, `NEEDS_YOU_REFUSALS`, the refused outcome gains `wrote?: string[]`, `renderPackFiles` takes `extendsBase?: string`, `initPack` opts gain `extendsBase: string | null`), `commands/skills-init.ts` (the `--extends <base>` flag, help text, and rendering of `params-missing`)
- Test: `lib/skills/__tests__/mcp-lint.test.ts`, `lib/skills/__tests__/init.test.ts`, `commands/__tests__/skills-init.test.ts`

**Interfaces:**
- Consumes: Task 4 compile result `missing?: MissingMarker[]`.
- Produces: `params-missing` (needs-you). On compile with `missing`, init writes `pack/params.jsonc` (the existing keys kept, each missing key set to `""`) and an empty file for each missing section (existing files untouched), then refuses with `detail` listing them, `wrote` listing the seeded paths, and `next` `rt skills init --team <team> --extends <base>`. Re-running init resumes: no `pack-exists` (nothing compiled), no rewrites, and with nothing missing it continues through check, admit, install and publish.
- `--extends` validation, inside the existing `InitDeps.fs` seam: `join(zone.orgDir, "mattstack", "org", "packs", base)` exists and `isBasePack(deps.fs, dir)` (`init.ts:90`) is true; otherwise a `zone-missing`-style refusal naming the base.

- [ ] **Step 1: Write the failing tests.**
  - `mcp lint flags a shell form in pack/sections`.
  - `init --extends writes extends`.
  - `init seeds missing values and stops with params-missing`: fake deps whose compile returns `missing`; assert the seeded file contents and the outcome's code, `refused`, `wrote` and `next`.
  - `init resumes after values are filled`: the second run gets no `pack-exists`, its compile is ok, and the outcome is ok.
  - `init --extends refuses an unknown base`.
  - `skills-init renders params-missing as needs-you` (plain render via `renderPlain`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Also run `bun test lib/skills/__tests__/init-compile.e2e.test.ts`.
- [ ] **Step 5: Commit** `skills init: --extends seeds the team values a base asks for`.

### Task 7: Docs, skills and the plugin bump

**Files:**
- Modify: `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md` ("The org base pack"), `plugins/mattstack/plugin/skills/creating-a-pack/SKILL.md`, `plugins/mattstack/plugin/skills/editing-skills/SKILL.md`, `plugins/mattstack/.claude-plugin/plugin.json` (bump to exactly `0.32.14`, the value of `TEAM_MARKERS_MIN_ENGINE`; if main has moved past it by merge time, bump both together), `website/docs/skills/packs.mdx`, `website/docs/rt/reference/_partials/skills/{compile,check,init}.mdx`, `lib/skills/README.md`

- [ ] **Step 1: RED.** A fresh subagent gets the current extending-a-pack and the task "two teams share a provision flow differing in Linear team and one block of CI rules; make the base own it". Record that it forks the fill.
- [ ] **Step 2: Edit the skills** through `superpowers:writing-skills`:
  - extending-a-pack gets a recipe "Give a base fill a team value or block" (markers table, `pack/params.jsonc`, `pack/sections/`, required vs `?`, the refusal, no markers in frontmatter or nested ones, a section alone on its line);
  - creating-a-pack gets `--extends` and the `params-missing` stop;
  - editing-skills says params and sections are pack sources compile reads.

  Examples use `acme-base` / `widgets`.
- [ ] **Step 3: GREEN.** The same subagent scenario now puts the flow in the base with markers.
- [ ] **Step 4: Docs.** Update the website pages and the README to match.
- [ ] **Step 5: Verify.** Run `sh plugins/mattstack/tests/certify.sh` on each edited skill dir, `bun cli.ts skills check --pack mattstack --pack-dir plugins/mattstack --strict` (run with the isolated-HOME rule in AGENTS.md if it touches `~/.mattstack`), and `sh scripts/repo-purity.sh`. Expected: all ok.
- [ ] **Step 6: Commit** `docs: base-pack team params and sections`.

---

## After the branch

- Push with `git_push`, open the PR, and wait for CodeRabbit and CI (Matt's standing rule). Merge only with Matt's confirmation.
- Linear (mattstack org, PM-shaped): one ticket for this engine feature, and one for each org's wave-one migration (provision, ship plus preflight, watch-ci into the base), written outside this public repo.
