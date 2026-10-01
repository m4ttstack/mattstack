# rt Output Layer, Phase 5d1 (Skills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every line a person reads from `rt skills` (compile, check, packs, composition, materialize, surface, bind, audit, expand, init, link, sync, writing-style) comes from the output layer, so the seven `skills` command files and `lib/skills/sources.ts` leave the raw-output allowlist. Every `--json` envelope keeps its shape (keys, structure, types, exit codes, every value a program reads) and the `compile --preview` body is unchanged byte for byte. The human sentences that `lib/skills/link.ts`, `sync.ts` and `init.ts` hand to the screen take the copy pass in place.

**Architecture:** Each verb's human output becomes a pure function that returns blocks (`checkBlocks`, `compileBlocks`, `syncBlocks` and so on), printed with one `out.print`; those functions are what the tests pin, through `renderPlain`. `SkillsUsageError` keeps its technical message (it also travels inside `--json` envelopes and other verbs' errors) and gains an optional `shown` failure, so a mistyped flag reads as a plain sentence while a pack author's compile diagnostic keeps its exact words. A refusal by policy (a sync guard, an existing pack, an existing writing style) is a `refused` line through `out.note` on stderr, never a coral failure. Notes that can fire under an agent-safe `--json` verb go through `out.note` on stderr; the preview body goes through `out.payload`; the one lib warning goes through `warn`. One plugin skill quotes two lines this slice rewords (the `skills check` lag line and a `skills sync` refusal), and is updated in the same PR.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/skills/`), `bun:test`. No Go change (all Go work in phase 5 is 5a's).

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Block vocabulary", "Status set", "Copy style", "Guard" and "Testing". The slice is section 3 "5d" of `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md`, first half of its second cut. The API it builds on is fixed by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md` ("API for slices 5b to 5f", "The breadcrumb header (nothing to call)", and row 43 of the warnings table in its Task 1). The twelve rulings in `.superpowers/sdd/cross-phase-rulings.md` and the notes in `.superpowers/sdd/herd-notes.md` bind this plan.

**This is one of two plans for slice 5d.** The slice measures about 183 visible sites, and this plan's estimate alone is about 2,350 changed lines (about 880 in the eight command files and the three `lib/skills` files whose copy changes, about 1,470 in tests, and a handful in the plugin), with the other half about 1,100. That stays under the 2,500 line mark, so this half is still one PR. Together they pass the 2,500 line mark Matt set, so the slice ships as two PRs along the scoping document's second cut: this plan (the seven `skills` files and `lib/skills/sources.ts`) and `2026-10-01-rt-output-layer-phase-5d2-plugins-hooks.md` (`plugin`, `tools`, `deps`, `hooks`, `intercept`). They share no source file and no test file, and either can merge first.

**What was run while writing this plan:** nothing was compiled. The code was written against the files at `9390e493d` plus `lib/ui/__tests__/capture-out.ts` as phase 4 left it on `origin/main` (`19ceaa403`), and against 5a's signatures as its plan states them. Every expected plain string was worked out by hand from `lib/ui/out-plain.ts` with 5a's leading-failure rule applied.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name or commit message. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` output of every existing command must not change, byte for byte. Plain text off a TTY takes the new wording.
- Human text goes to stdout except in payload verbs; failures go to stderr through `out.fail`; never style a payload.
- Coral only for failures. A state that is not done is pending, off, refused, needs-you, stale, skipped or warn.
- Run `bun test` only from the repo root. Run Go from `ui/` (`go -C ui ...`). `bun run ui:build` after any change under `ui/`.
- Every converted file: delete its line from `lib/__tests__/raw-output-allowlist.json` in the same commit.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Sample data in tests is invented. No real team, person or host names.
- Every leaf picker and every human branch gates on TTY, `--json` and `RT_BATCH` exactly as today; the non-TTY and `--json` paths keep their exit codes.
- 5d1 only: exit codes do not change. A `SkillsUsageError` exits 1; `skills audit` refusals exit 2; `skills init` exits 2 on a refusal and 1 on a failure; `skills writing-style` refusals exit 2; `skills materialize --dir` keeps 0, 1 and 2; `skills check` and `skills compile` keep setting `process.exitCode = 1`.
- 5d1 only (the phase 5 "copy inside envelopes" ruling, which narrows the byte-for-byte rule above to shape for the strings named here): these keep their exact text: the `message` of every `SkillsUsageError` (new wording for a person goes in `shown`, never in `message`); every pack author's compile diagnostic, meaning each `throw new Error(...)` in `lib/skills/compile.ts`, `placeholders.ts`, `layout.ts`, `expand.ts` and `sources.ts`; and four `error` strings `skills sync` puts in its `{ ok: false, error }` envelope: the three pack-resolution errors (`no packs discovered ...`, `no pack named ...`, `which pack? ...`) and `deriveEngine`'s, which tests pin. A `syncPack` throw that lands in that same `error` field is reworded with the rest of `sync.ts` (no program matches it). Every other human sentence that reaches the screen, inside an envelope or not, takes the copy pass in Task 2's copy tables: the `detail` strings of `lib/skills/link.ts`, `lib/skills/sync.ts` (steps, refusals and its five throws) and `lib/skills/init.ts` (refusals and failures), and `syncMaterializeVerdict`'s details. Their envelopes keep every key, type and machine-read value (ids, codes, statuses, booleans, paths, versions).
- 5d1 only: a pure `...Blocks()` function never prints, never exits and never reads `process.argv`.
- 5d1 only: a policy refusal (rt declining by rule: a sync `refused` step under `guards`, `check`, `bump` or `recheck`, `skills init`'s `pack-exists`, `zone-has-pack` and `zone-mismatch`, `writing-style new`'s `exists`) is `out.note(out.line("refused", ...), ...callouts)` on stderr, never `out.fail`. A sync step `lib/skills/sync.ts` marks `refused` after a command failed (`pull-engine`, `pull-pack`, `update-engine`, `compile`) is drawn with `out.fail`. Exit codes and `--json` (statuses included) do not change.
- 5d1 only: files this slice must not edit: anything under `ui/`; `lib/ui/**` (5a and phase 4 own it); `lib/setup/**` (phase 3), which includes `lib/setup/skills-materialize.ts`, `lib/setup/skills-link-bundled.ts` and `lib/setup/validators/writing-style.ts`; `lib/skills/writing-style.ts` (its `WRITING_STYLE_SOURCE_LABEL` wording is shared with phase 3's setup row and stays as it is); `lib/command-tree-def.ts`; every file the 5d2 plan owns (`commands/plugin.ts`, `tools.ts`, `deps.ts`, `hooks.ts`, `intercept.ts`, `lib/plugins.ts`, `lib/plugin-api.ts`, `lib/deps/**`); anything under `skills/`; and anything under `plugins/mattstack/` except two sentences of `plugin/skills/editing-skills/SKILL.md` (lines 336 to 337 and 490 to 491) and the version in `.claude-plugin/plugin.json`, which Task 14 changes (never a literal version: cross-phase ruling 13) (never `CERTIFICATION.md`: the shepherd appends its ledger rows).
- 5d1 only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.

## Review Focus

1. **A note that fires while a program is reading stdout.** `skills compile`, `check`, `surface`, `bind` and `sync` are agent-safe: `rt_verb` parses stdout as one JSON value. The "using the pack this folder is inside" note, the two bind warnings and the expand advisory hits all fire under `--json`; each must land on stderr and leave stdout as one line. Pinned in Task 4 (`the enclosing-pack note goes to stderr and stdout stays one JSON line`) and Task 8 (`a bind note under --json keeps stdout to one envelope`, `a shadowed bind under --json keeps stdout to one envelope`).
2. **`compile --preview` piped into a file.** The body must be the only thing on stdout, written once, with exactly one trailing newline, also when a pack note fires. Pinned in Task 5 (`--preview writes the body once through out.payload and nothing else on stdout`).
3. **A skill, verb or file name from a pack that carries a newline or an escape.** Pack content is untrusted text (a pack under review); a name such as `x` followed by a newline and `[ok] forged` must not print as a status row of its own. Pinned in Task 6 (`a hostile verb name cannot forge a status row`).
4. **A usage error whose message has more than one line** (several chain errors joined by newlines). The first line must be the title and every other line must still be printed. Pinned in Task 4 (`a multi-line message keeps every line`).
5. **A pack with nothing in it.** `compile` on a pack with no verbs and `surface` on a pack with no skills must each say so in one line rather than print nothing; `packs` on a Mac with no packs prints one line plus a note saying what a pack is. Pinned in Task 5 (`an empty compile says so`), Task 6 (`no packs is a line and a note`) and Task 7 (`an empty pack says so`).
6. **A refusal drawn as a failure.** A sync guard, an existing pack or an existing writing style is rt declining by policy: it must be a `refused` line on stderr, never coral and never on stdout, with the exit code and `--json` unchanged. Pinned in Task 10 (`a policy refusal is a refused note on stderr`), Task 11 (`a refusal is not a failure: the steps before it on stdout, then a refused note`) and Task 12 (`an existing style is a refused note`).

## File Structure

| File | Responsibility |
|---|---|
| `lib/skills/__tests__/helpers.ts` (modify) | `captureSkills()` and `runExpectingCleanExit()`: one capture for every skills command test, reading console and stream writes alike. Any test that calls `runExpectingCleanExit` must not hold a `console` spy of its own |
| `commands/__tests__/skills-json-frozen.test.ts` (create) | Characterization: the `--json` line of each skills verb, pinned before any conversion |
| `commands/skills.ts` (modify) | `SkillsUsageError.shown`, `skillsFailure`, and the block builders `compileBlocks`, `compileFailure`, `misplacedFailure`, `checkBlocks`, `installedCacheBlocks`, `packsBlocks`, `compositionBlocks`, `materializeBlocks`, `surfaceBlocks`, `bindBlocks`; every print through `out` |
| `commands/skills-audit.ts`, `skills-expand.ts`, `skills-init.ts`, `skills-link.ts`, `skills-sync.ts`, `skills-writing-style.ts` (modify) | Each verb's blocks and failures on the layer |
| `lib/skills/sources.ts` (modify) | The skipped-plugin warning through `warn` |
| `lib/skills/link.ts`, `lib/skills/sync.ts`, `lib/skills/init.ts` (modify) | The copy pass on the sentences they hand to the screen (Task 2's copy tables); `init.ts`'s refusals gain an optional `next` command and its `remedy` becomes a list of commands |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Eight lines deleted |
| The nineteen test files Task 2's last table marks for change (modify) | Capture through the layer, new wording pinned |
| `plugins/mattstack/plugin/skills/editing-skills/SKILL.md`, `plugins/mattstack/.claude-plugin/plugin.json` (modify) | The two sentences that quote reworded output (the lag line, the recheck refusal); the patch version bump the `plugin-mattstack` job requires |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | One paragraph; two renders |

---

### Task 1: Check what this plan builds on is on main

No code. Stop and report if any check fails; do not work around a missing piece.

**Files:** none.

**Interfaces:**
- Consumes: 5a's merged PR (`out.note`, `warn`, `usageFailure`, the plain failure rule) and phase 4's `captureOut({ console: true })` with `clear()`.
- Produces: a branch based on a main that has both.

- [ ] **Step 1: Fetch and rebase**

Run: `git fetch origin`
Run: `git rebase origin/main`

- [ ] **Step 2: Confirm 5a is on main**

Run: `git log origin/main --oneline -30`
Expected: a commit titled `RT-369: output layer phase 5a, layer additions and dispatcher`.

Run: `ls lib/ui/warn.ts lib/ui/usage.ts lib/ui/transient-step.ts lib/ui/screen.ts`
Expected: all four files listed.

Run: `grep -n "export function note" lib/ui/out.ts`
Expected: one line.

Run: `grep -n "export function usageFailure\|export function warn\|export function setWarningLog" lib/ui/usage.ts lib/ui/warn.ts`
Expected: three lines, with the signatures `usageFailure(title: string, usage: string, why?: string): FailureInput`, `warn(module: string, message: string, opts?: WarnOptions): void` and `setWarningLog(log: WarningLog | null, opts?: { quiet?: boolean }): void`.

If 5a is not on main, stop here and report "5a is not on main yet"; this plan cannot start.

- [ ] **Step 3: Confirm the capture helper phase 4 extended**

Run: `grep -n "console?: boolean\|clear(): void" lib/ui/__tests__/capture-out.ts`
Expected: two lines. `captureOut({ console: true })` also captures `console.log` and `console.error`, and `clear()` empties both buffers.

- [ ] **Step 4: Confirm the leading-failure rule**

Run: `bun test lib/ui/__tests__/out-plain.test.ts`
Expected: PASS, including `a failure that opens the output leads with its title alone`.

- [ ] **Step 5: Confirm the eight files are still on the allowlist**

Run: `grep -n "commands/skills\|lib/skills/sources.ts" lib/__tests__/raw-output-allowlist.json`
Expected: eight lines (`commands/skills-audit.ts`, `skills-expand.ts`, `skills-init.ts`, `skills-link.ts`, `skills-sync.ts`, `skills-writing-style.ts`, `skills.ts`, `lib/skills/sources.ts`).

---

### Task 2: Audit of the print sites this plan owns

No code. This is the inventory every later task implements; it stays in the plan. Line numbers are at `9390e493d`. Where today's text holds a long dash, this table writes `--`.

**Files read:** `commands/skills.ts`, `commands/skills-audit.ts`, `skills-expand.ts`, `skills-init.ts`, `skills-link.ts`, `skills-sync.ts`, `skills-writing-style.ts`, `lib/skills/*.ts` (every `throw` and every detail string), `lib/setup/skills-materialize.ts` (the strings `materialize` prints), `lib/setup/skills-link-bundled.ts` (it calls `reconcileSkillLinks` and reads no `detail`), phase 3's copy table in `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-3-setup.md` (it pins no `lib/skills/link.ts` string), the twenty test files below, `e2e/tests/skills-sync.test.ts`, `e2e/tests/skills-writing-style.test.ts`, `.github/workflows/checks.yml` lines 224 to 276.

#### Already on rt-ui (confirming the scoping document)

| Verb | Scoping call | Confirmed | What this plan touches |
|---|---|---|---|
| `skills compile`, `check`, `bind`, `surface` (pack choice) | partly | Yes. `pickPack` (`filterableSelect`) is rt-ui and is not changed. | The result lines and failures |
| `skills surface` (bare) | partly | Yes. The palette (`filterableMultiselect`) is rt-ui and is not changed. | The lines around it, and the yes or no question after it: today a raw `readline` prompt on stderr (`confirmYesNo`, line 1953), which becomes the rt-ui `confirm` prompt so the file holds no stream use |
| `skills bind` | partly | Yes. `pickBindArgs` (three `filterableSelect` calls) is rt-ui and is not changed. | The result lines |
| `skills init` | partly | Yes. The two `textInput` prompts are rt-ui and are not changed. | The outcome and the warnings |
| `skills writing-style use`, `new` | partly | Yes. The style picker and the name prompt are rt-ui and are not changed. | Every printed line |
| `skills audit`, `expand`, `link`, `sync`, `packs`, `composition`, `materialize`, `writing-style show`, `list` | no | Yes: none reaches rt-ui today. | All of their human output |

#### `commands/skills.ts`

| Site | Today | Becomes | Task |
|---|---|---|---|
| 85 `withCleanErrors` | `console.error("rt skills: <message>")`, exit 1 | `out.fail(skillsFailure(err))`, exit 1 | 4 |
| 204 | stderr: `rt skills: acting on the pack tree enclosing cwd (<dir>)` | `out.note(out.callout("note", ["Using the pack this folder is inside: ", out.strong(dir)]))` | 4 |
| 207 | stderr: cwd is inside pack tree `<name>` but `--pack <x>` was given | `out.note(out.line("warn", "This folder is inside the <name> pack, but you asked for <x>", "using the one you asked for"))` | 4 |
| 886 preview failure | `console.error("rt skills: <message>")`, exitCode 1 | `out.fail({ title: "<verb> did not compile, so there is nothing to preview", details: message })`, exitCode 1 | 5 |
| 894 preview body | `console.log(main.content)` | `out.payload(main.content + "\n")`, after `out.payloadOnStdout()` | 5 |
| 904 compile failures | one `console.error("rt skills: <message>")` per failure, exit 1 | `out.fail(compileFailure(failures))`: title `1 verb did not compile` or `<n> verbs did not compile`, the messages as details; exit 1 | 5 |
| 916 to 917 dry run | `would write <n> files for <verb>`, warnings indented | `out.line("pending", verb, "would write <n> files")`, warnings in a `note` callout | 5 |
| 923 to 924 | `compiled <verb> -> <side> (<n> files, <m> warnings)`, warnings indented | `out.line("done" or "warn", "Compiled <verb>", "<n> files in <side>/")`, warnings in a `note` callout. A warning from `lib/skills/compile.ts:343` already starts `note: `; the callout drops that prefix so it never reads `note: note:` | 5 |
| (none today) | a pack with no verbs prints nothing | `out.line("skipped", "Nothing to compile", "this pack has no verbs")` | 5 |
| 940 | `console.log(JSON.stringify({...}))` | `out.json({...})` (guard-only) | 5 |
| 945 misplaced | stdout: `misplaced: <name> (run rt skills surface apply, or move it)`, exitCode 1 | `out.fail(misplacedFailure(names))`: title `<name> is in the wrong folder`, why `A skill's folder has to match whether it is public or internal.`, next `rt skills surface apply`; exitCode 1 | 5 |
| 1143 chain errors | one stdout line each | `out.line("failed", chainError)` | 6 |
| 1146 | `<verb>: stale (never compiled -- outDir missing; run rt skills compile)` | `out.line("stale", verb, "never compiled")` | 6 |
| 1151 | `<verb>: stale (<causes> moved; recompile or investigate drift with git diff) -- <files>` | `out.line("stale", verb, "<causes> moved: <files>")`, or `"changed since the last compile: <files>"` when no cause is known | 6 |
| 1153 | `<verb>: current` | `out.line("done", verb, "current")` | 6 |
| (after the rows) | the advice sat inside each stale line | one `out.callout("next", out.cmd("rt skills compile"))` after the rows when any is stale | 6 |
| 1127 to 1135, 1158 `installedCacheLine` | `installed cache: lagging (<a> installed vs <b> source) -- run rt skills sync`, or `missing (...)` | `installedCacheBlocks`: `out.line("stale", "The installed copy is behind the source", "<a> installed, <b> in the source")` or `out.line("pending", "This pack is not installed here", "<plugin>@<marketplace>")`, then `out.callout("next", out.cmd("rt skills sync"))` | 6 |
| 1160 lint hits | one stdout line each | `out.verbatim(hits.map(formatHit), "mcp lint")` | 6 |
| 1164 | `mcp lint: <n> hits (<policy>)` or `mcp lint: clean` | `out.line("done", "mcp lint", "clean")`; with hits `out.line("failed" when the strict flag is on, else "warn", "mcp lint: <n> hit(s)", policy)` where policy is `this pack is strict, so they fail a strict check and the sync`, `they fail a strict check`, or `advisory; they fail a strict check` | 6 |
| 1165 to 1166 script hits | `(advisory) <hit>` lines, then `mcp lint (pack scripts, advisory): <n> hits` | `out.verbatim(hits, "pack scripts, advisory")`, `out.line("warn", "pack scripts: <n> hit(s)", "advisory")` | 6 |
| 1174, 1195, 1479, 1526 | `console.log(JSON.stringify(...))` | `out.json(...)` (guard-only) | 6 |
| 1200 | `no packs discovered (no directory marketplace plugin carries a surface.jsonc)` | `out.line("pending", "No packs found")`, `out.callout("note", "A pack is a plugin from a directory marketplace that has a surface file.")` | 6 |
| 1203 | `<name>  <layout>  <dir>` rows | `out.table(rows, ["Pack", "Layout", "Folder"])` | 6 |
| 1483 to 1497 composition | header, `<verb> (<engineRef>) public`, slot rows, `ENGINE ERROR -- ...`, `<n> fills, <m> binders` | `out.section("Pack <pack>", undefined, ...)` holding one `out.tree` per verb (slots as children) or `out.line("failed", verb, engineError)`; then `out.kv("Fills", n)`, `out.kv("Binders", m)` | 6 |
| 1528 | `skipped: <reason>` | `out.line("skipped", "Nothing was written", reason)` | 6 |
| 1531 | `materialized <repo>: <detail>`, `no skills declared for <repo>: ...`, `failed <repo>: ...` | `out.line("done", repo, detail)`, `out.line("skipped", repo, detail)`, `out.line("failed", repo, detail)` | 6 |
| 1532 | `  renamed the old merged file to <path>` | `out.callout("note", ["Renamed the old merged file to ", out.dim(path)])` | 6 |
| 1533 | `  set aside <n> stale bindings file(s): <paths>` | `out.callout("note", "<setAsideLine(n)>: <paths>")` | 6 |
| 1540 | `exitUserError(err, json, "skills materialize", console.log)` | `exitUserError(err, json, "skills materialize")` (it then uses `out.json`; same bytes) | 6 |
| 1764 to 1767 `printSurfaceRows` | header, `source: ...`, padded rows | `out.section("Pack <team>", source, out.table(rows, ["Skill", "Surface", "Kind"]))` | 7 |
| 1669 `computeRows` source text | `(no surface.jsonc yet -- inferred from current skills/ + stubs.jsonc placement)` | `no surface file yet, worked out from where each skill sits` (shown only; the JSON does not carry it) | 7 |
| 1784, 1973 | `(no skills registered in this pack)` | `out.line("pending", "No skills are registered in this pack")` | 7 |
| 1816, 1821 | `would move <name>: <route>`, `moved <name>: <route> (<note>)` | `out.line("pending", name, "would move <route>")`, `out.line("done", name, "moved <route> (<note>)")` | 7 |
| 1760 `moveHandAuthoredDir` note | `plain rename -- pack dir is not a git repo` (shown only, inside the moved line) | `this pack is not a git repo, so no git history follows it` | 7 |
| 1835 | `<name>: recorded; emitted to skills/ on the next compile` (or `would record`) | `out.line("pending", name, "recorded; written to skills/ on the next compile")` (or `would be recorded; ...`) | 7 |
| 1841 | `no moves needed` | `out.line("skipped", "Nothing needs to move")` | 7 |
| 1895 | `<name>: public` | `out.line("done", name, "public" or "internal")` | 7 |
| 1948 to 1950 `printDelta` | `changes:`, `  + public   <name>`, `  - public   <name>` | `out.changes([{ op: "+", name, hint: "becomes public" }, { op: "-", name, hint: "becomes internal" }])` | 7 |
| 1953 to 1961 `confirmYesNo` | `readline` on `process.stderr` | `confirm({ message: "Apply these changes?", initialValue: false })` from `lib/ui/prompts.ts` | 7 |
| 1979 to 1980 | blank line, `no tty -- edit one at a time: rt skills surface set <name> --public|--internal` | `out.callout("next", [out.cmd("rt skills surface set <name> --public"), " (or ", out.cmd("--internal"), ")"])` | 7 |
| 2010 | `no changes -- surface.jsonc left as is` | `out.line("skipped", "No changes")` | 7 |
| 2019 | `declined -- no changes made` | `out.line("skipped", "No changes made")` | 7 |
| 2024 | `surface.jsonc updated: <n> public` | `out.line("done", "Saved which skills are public", "<n> public")` | 7 |
| 1779, 1899, 2045, 2091 | `console.log(JSON.stringify(...))` | `out.json(...)` (guard-only) | 7 |
| 2289 | stderr: `rt skills bind: <fragment> resolves outside the pack; skipping fragment write` | `out.note(out.line("warn", "The pack's bindings file points outside the pack, so it was left alone", fragmentPath))` | 8 |
| 2434, 2453, 2464, 2505 summary | `<verb>.<slot>: <old> -> <new>`, with ` (fragment updated: <path>)` | `out.line("done", "<verb>.<slot>", "<old> -> <new>")` (`pending` on a dry run), and `out.callout("note", ["Also saved in the pack's own bindings file: ", out.dim(path)])` | 8 |
| 2454 | `<pack> is a base pack: packs that extend it pick this up once it is published and their bindings files are regenerated` | `out.callout("note", "<pack> is a base pack. Packs that extend it pick this up once it is published and their bindings are rebuilt.")` | 8 |
| 2465 to 2466 | two stderr lines: bindings file not regenerated; the fragment is written and the next materialize picks it up | `out.fail({ title: "The bindings file was not rebuilt, so nothing was recompiled", why: regenerateDetail, next: out.cmd("rt skills materialize") })` | 8 |
| 2470 | stderr: bound in the fragment, but the `<layer>` layer still wins | `out.note(out.line("warn", "<verb>.<slot> is still decided by the <layer> layer", "your change is saved, but that layer wins"))` | 8 |
| 2433, 2450, 2461, 2490 | `console.log(JSON.stringify(...))` | `out.json(...)` (guard-only) | 8 |
| 31 | `import { createInterface } from "node:readline"` | removed | 7 |

Guard lines: 72. Visible sites 59, guard-only 13 (the twelve `--json` writes and the `exitUserError` print argument). That matches the scoping document's 59 visible lines for `skills.ts`.

#### `SkillsUsageError` sites that gain `shown` (Task 4)

The message of every site stays as it is. These thirteen also say what a person should read: the eight a person reaches by mistyping a command, and the five whose message carries a command or a flag mid-sentence.

| Line | Message (unchanged) | `shown` |
|---|---|---|
| 195 | `--pack-dir <dir> is not an existing directory` | `{ title: "That pack folder does not exist", details: packDir }` |
| 216 | `no pack named "<x>" (discovered: ...; checked <legacy>)` | `{ title: "No pack is called <x>", next: out.cmd("rt skills packs"), details: "Packs here: <names or none>" }` |
| 222 | `no packs discovered (...); pass --pack <name>` | `{ title: "No packs found", why: "A pack is a plugin from a directory marketplace that has a surface file.", next: ["Run it again with ", out.cmd("--pack <name>"), " or ", out.cmd("--pack-dir <folder>")] }`. `resolvePack` does not know which verb called it, so the `next` names the two ways to say which pack. With `--mattstack-dir` discovery is skipped and this is what a person sees, so `skills-surface.test.ts:947`'s check for `--pack` keeps its meaning |
| 225 | `which pack? pass --pack <name> (discovered: ...)` | `{ title: "Which pack?", why: "There is more than one: <names>.", next: ["Run it again with ", out.cmd("--pack <name>")] }` |
| 863 | `--preview needs a single --verb` | `usageFailure("Which verb should be previewed?", "rt skills compile --preview --verb <name>")` |
| 2065 | `set requires a skill name: rt skills surface set <name...> --public|--internal` | `usageFailure("Which skill?", "rt skills surface set <name> --public")` |
| 2076 | `set requires --public or --internal` | `usageFailure("Should it be public or internal?", "rt skills surface set <name> --public", "Say which with --public or --internal.")` |
| 2358 | `bind requires: rt skills bind <verb> <slot> <fill>` | `usageFailure("Bind which verb, slot and fill?", "rt skills bind <verb> <slot> <fill>")` |
| 415 | `no <team> bindings file for repo "<repo>" under <root> (have: ...); run rt skills materialize` | `{ title: "No <team> bindings file for <repo> yet", next: out.cmd("rt skills materialize"), details: "Repos that have one: <slugs or none>" }` |
| 432 | `pack "<team>" binds <n> repos (<slugs>)[; its team zone declares no forge host, ...]; pass --repo <slug or host/path>` | `{ title: "Which repo?", why: "The <team> pack is bound in <n> repos: <slugs>." plus, with no forge host, " Its team zone names no forge host, so rt cannot pick one.", next: ["Run it again with ", out.cmd("--repo <slug>")] }` |
| 446 | `no repos/*/packs/<team>/skills.jsonc under <root>[ and <own> is absent]; run rt skills materialize, or pass --manifest explicitly` | `{ title: "No <team> bindings file was found", next: out.cmd("rt skills materialize"), details: "Looked for repos/*/packs/<team>/skills.jsonc under <root>" plus, when standalone, ", and for <own>" }` |
| 866 | `--preview and --json cannot be combined (--preview prints the compiled body; --json compiles, writes, and reports)` | `{ title: "A preview prints the compiled skill, so it cannot also print JSON", next: out.cmd("rt skills compile --preview --verb <name>") }` |
| 2381 | `pack "<team>" is a base pack with no verbs of its own, so bind cannot check the slot; edit <path> directly` | `{ title: "<team> is a base pack with no verbs of its own, so rt cannot check the slot", why: "Edit its bindings file by hand.", details: path }` |

Every other `SkillsUsageError` (29 sites) prints its message as the failure title, unprefixed: the flag errors that name what was typed (`<flag> needs a value`, `unrecognized argument "<a>"`, `unrecognized subcommand ...`), the plain ones (`"<name>" named more than once`, the base-pack error at 401) and every wrapped `lib/skills` error, which is a pack author's compile diagnostic.

#### `lib/skills/` copy audit

| What | Count | Decision |
|---|---|---|
| `throw new Error(...)` in `compile.ts`, `placeholders.ts`, `layout.ts`, `sources.ts` (`loadStepSource`, `loadAttachment`, `loadInclude`), `expand.ts` | 55 | Keep every word. These are a pack author's compile diagnostics: each names the file, the slot, the placeholder and the line, and that detail is the message. They also sit inside `--json` values (`verbs[].errors`, `compileErrors`, `chainErrors`) that `rt_verb` callers read, and about 110 test lines pin them. The frame changes: no `rt skills:` prefix, and the failure block around them |
| `throw new Error(...)` in `sync.ts` (5) | 5 | Reword (the sync copy table below). A person reads each one as the `why` of a failed sync; none is a compile diagnostic |
| Step ids in `sync.ts` (`guards`, `pull-engine`, ... 13 names) | 13 | Keep the ids (they are `--json` values a program reads). The human output maps each to a plain title in `commands/skills-sync.ts` (Task 11) |
| Step `detail` strings in `sync.ts`, with `guardSummary` and `inTreeBranchNote` | about 45 | Reword each that carries a step id, a flag, a `key=value`, a command mid-sentence or "re-run" (the sync copy table below). Shape kept: `steps[].detail` stays a string. The command a refusal names moves to the human `next` callout. Plain ones stay, and git or Claude output quoted inside a detail stays word for word |
| `detail` strings in `link.ts` (8) | 8 | Reword (the link copy table below). They are `actions[].detail` in the `--json` envelope, which no program reads: no Swift or TypeScript file calls `skills link --json` (grep of `rt-tray`, `lib`, `commands`), and `lib/setup/skills-link-bundled.ts` calls `reconcileSkillLinks` in process and reads only `kind` and `changed`. The human row shows each as a hint |
| `InitOutcome.detail` in `init.ts` (refusals and failures) | 17 | Reword (the init copy table below). A refusal's command moves to a new optional `next` on the outcome, which the `--json` envelope does not carry (`userErrorPayload` gets only `{ refused, wrote }`), so its shape is unchanged |
| `InitOutcome.remedy` in `init.ts` | 4 | Restructure. It is in no envelope. Today every one starts `then: `, and the screen would show `next: then: rt skills compile ... and rt skills check ...` styled as one command. It becomes `remedy?: { commands: string[]; folder?: string }`, and each command is its own `cmd` in the `next` callout |
| `lib/skills/sources.ts:71` | 1 | Row 43 of 5a's warnings table: show (Task 13) |
| `lib/setup/skills-materialize.ts` (`reason`, `detail`, `setAsideLine`) | 6 | Not this slice's file. `materialize` prints them as hints unchanged. The reason `engine-pack-missing: install the mattstack plugin first (plugins.install), then rerun` carries a step id; see "Decisions" |

#### The six smaller files

| Site | Today | Becomes | Task |
|---|---|---|---|
| `skills-audit.ts:76` | `rt skills audit: pass --pack <name> or --pack-dir <dir>` | `usageFailure("Which pack?", "rt skills audit --pack <name>")` | 9 |
| `skills-audit.ts:81` | `rt skills audit: <SkillsUsageError message>` | `skillsFailure(err)` | 9 |
| `skills-audit.ts:85` | `rt skills audit: no claude binary on PATH; the audit needs a Claude login` | `{ title: "The audit needs Claude Code, and rt could not find it", why: "The audit runs as a Claude session, so Claude has to be installed and signed in." }` | 9 |
| `skills-audit.ts:92` | `console.error(message)`, exit 2 | `out.fail(inputs.failure)`, exit 2 | 9 |
| `skills-audit.ts:107` | stderr: `rt skills audit: claude exited <n>: <tail>` (also under `--json`) | `out.note(out.line("warn", "Claude exited with code <n>", tail))` | 9 |
| `skills-audit.ts:108` | `console.log(JSON.stringify(...))` | `out.json(...)` (guard-only) | 9 |
| `skills-audit.ts:109-110` | `rt skills audit (advisory; never a gate): <pack>`, blank line, the report | `out.section("Audit of <pack>", "advisory, never a gate", out.paragraph(text))` | 9 |
| `skills-expand.ts:24` `fail` | `rt skills expand: <message>`, exit 1 | `out.fail(failure)`, exit 1. `--src <dir> is required` becomes `usageFailure("Which folder holds the skills to expand?", "rt skills expand --src <dir> --out <dir>")`; `--out <dir> is required` becomes `usageFailure("Which folder should the expanded skills go in?", "rt skills expand --src <dir> --out <dir>")`; `unknown flag <a>` becomes `{ title: "rt skills expand does not take <a>" }`; a lib error is the title as it is | 9 |
| `skills-expand.ts:73` | stderr, per hit: `(advisory) <hit>` (also under `--json`) | one `out.note(out.verbatim(hits, "advisory"))` | 9 |
| `skills-expand.ts:82` | `console.log(JSON.stringify(payload))` | `out.json(payload)` (guard-only) | 9 |
| `skills-expand.ts:85` lines | `expanded skills current (<n>)`; `+ <name>`, `- <name>` | `out.line("done", "The expanded skills are current", "<n> skill(s)")`; `out.changes([...])` | 9 |
| `skills-expand.ts:104-105` | stderr: `<skill>: <causes>` per drift, each lint hit; exit 1 | `out.fail({ title: "The expanded skills are out of date" (or "The expanded skills have <n> lint hit(s)" when only lint failed), next: the same command without the check when there is drift, details: the drift and lint lines })`, exit 1 | 9 |
| `skills-expand.ts:121` | stderr: each lint hit; exit 1 | `out.fail({ title: "<n> lint hit(s) in the expanded skills", details })`, exit 1 | 9 |
| `skills-init.ts:49-62` `renderInitOutcome` | a string: `rt skills init: <detail>`; or `rt skills init: <code>: <detail>`, `written so far (<remedy>):`, paths; or five lines for success | `initOutcomeBlocks(ok)`; `initRefusalBlocks(o)` for a policy refusal; `initFailure(o)` for every other refusal and every failure | 10 |
| `skills-init.ts:67` `initMaterializeVerdict` | detail `materialize wrote nothing` | `no bindings file was written` | 10 |
| `skills-init.ts:148` `registerRepo` | `UserActionableError("locate-failed", "registering <dir> failed: <error>")`, which reaches the screen as a failure's detail | message `rt could not add <dir> to its repo list: <error>` (the code is unchanged) | 10 |
| `skills-init.ts:153-154` | stderr: `rt skills init: warning: another pack failed to materialize: <w>`; `rt skills init: warning: <w>` | `ui.note(ui.line("warn", "Another pack did not materialize", w))`; `ui.note(ui.line("warn", w))` | 10 |
| `skills-init.ts:170` | stderr: `rt skills init: check threw: <message>` | `ui.note(ui.line("warn", "The check could not run", message))` | 10 |
| `skills-init.ts:183-188, 202-206` | `--json` envelope by `console.log`; or stderr `rt skills init: <message>`; exitCode 2 | `ui.json(...)`; or, for the usage error, `ui.fail({ title: message })`, and for the crash-path `UserActionableError`, `logFailureDetail(err)` then `ui.fail(failureFor(err))` (cross-phase ruling 12); exitCode 2 | 10 |
| `skills-init.ts:212-222` | three `console.log(JSON.stringify(...))`, one `console.log(renderInitOutcome(out))` on stdout for refusals and failures too | `ui.json(...)`; success through `ui.print`; a policy refusal (`pack-exists`, `zone-has-pack`, `zone-mismatch`) through `ui.note(...initRefusalBlocks(out))` on stderr; every other refusal and every failure through `ui.fail(initFailure(out))` on stderr | 10 |
| `skills-link.ts:24` `fail` | `rt skills link: <message>`, exit 1 | `out.fail(...)`, exit 1 | 10 |
| `skills-link.ts:55, 61` | two error strings with a long dash and a flag in the sentence | `{ error: "You are not inside a git repo", next: "rt skills link --from <folder>" }` (`fail` styles `next` as a command); `{ error: "This repo has no skills folder (<dir>)" }` | 10 |
| `skills-link.ts:107` | `console.log(JSON.stringify(envelope(...)))` | `out.json(envelope(...))` (guard-only) | 10 |
| `skills-link.ts:112-123` | header with both folders, one glyph row per action, the conflict note, `Everything already linked.` | `linkBlocks(...)`: `out.section("Skill links", "dry run" or undefined, out.kv("From", ...), out.kv("To", ...), one line per action)`, a `note` callout for conflicts, `out.summary("done", "Everything is already linked")` | 10 |
| `skills-sync.ts:82-89` `syncMaterializeVerdict` | details `skipped: <reason>`; `materialized <n> <pack> pack file(s)[; other packs failed: <w>]` | `nothing was written: <reason>`; `wrote <n> <pack> bindings file(s)[; these other packs did not: <w>]` (the failure detail, `<pack> (<repo>): <why>`, stays) | 11 |
| `skills-sync.ts:91-117` `stepLine`, `renderHuman` | `<step id>: ran (<detail>)` and so on; `engine: a -> b`; `warning: ...`; `refused: ...`, `failed: ...`, `synced; run /reload-plugins ...`, `already current` | `syncBlocks(report)` on stdout: one line per step up to the one that stopped the run, each with a plain title; `out.kv("Engine", "a -> b")`; `out.line("warn", w)`; then, only when no step stopped it, `out.summary("done", "Synced")` with a `next` callout or `out.summary("done", "Already current")`. A policy refusal (a `refused` step under `guards`, `check`, `bump` or `recheck`) is `out.note(...syncRefusal(report))` on stderr: `out.line("refused", "rt did not sync <pack>", "it stopped at: <title>")`, a `why` callout with the detail, and for the `check` step `next: rt skills check --pack <pack>`. A failed step, and a `refused` step under `pull-engine`, `pull-pack`, `update-engine` or `compile` (each only ever refuses after a command failed), is `out.fail(syncFailure(report))` on stderr. The `--json` statuses are unchanged | 11 |
| `skills-sync.ts:124-128` `fail` | `--json`: `{ ok: false, error }` by `console.log`; else stderr `rt skills sync: <error>`; exit 1 | `out.json({ ok: false, error })`; else `out.fail(shown ?? { title: error })`; exit 1 | 11 |
| `skills-sync.ts:131-139` | the three envelope `error` strings (`no packs discovered ...`, `no pack named ...`, `which pack? ...`) and `deriveEngine`'s at 46 | kept word for word (`e2e/tests/skills-sync.test.ts` pins `no packs discovered`); each gains `shown` copy for the screen | 11 |
| `skills-sync.ts:176` | `console.log(JSON.stringify(report))` | `out.json(report)` (guard-only) | 11 |
| `skills-writing-style.ts:35` | `print: (s) => console.log(s)` | `print: (s) => out.payload(s + "\n")` (the seam now carries `--json` lines only), plus `show: (...blocks) => out.print(...blocks)`, `note: (...blocks) => out.note(...blocks)` and `fail: (f) => out.fail(f)` | 12 |
| `skills-writing-style.ts:56-59` `refuse` | `rt skills writing-style <verb>: <message>` on stdout, exit 2 | `deps.fail(shown ?? { title: err.message })` on stderr, exit 2 | 12 |
| `skills-writing-style.ts:194, 241` the two `exists` refusals | `rt skills writing-style new: <path> already exists` on stdout, exit 2 | `decline(...)`: a `refused` line through `deps.note` on stderr, exit 2. At 194: `out.line("refused", "You already have a writing style called <name>", target)` and `out.callout("next", ["Edit it, then run ", out.cmd("rt skills writing-style use <name>")])`. At 241: `out.line("refused", "Your Claude skills folder already has something called <name>", link)` and `out.callout("note", "rt left it alone and removed the copy it had just made.")` | 12 |
| `skills-writing-style.ts:72` | `<skill> (<source label>)` | `out.kv("Writing style", skill, WRITING_STYLE_SOURCE_LABEL[source])` | 12 |
| `skills-writing-style.ts:81-91` list | `* <id padded> <detail>`, `Also available (type the id):`, `* <id> (current)` | one `out.table` with a group row `Also available (type the id)` and a `current` cell | 12 |
| `skills-writing-style.ts:143` | `writing style: <id> (<scope>)` | `out.line("done", "Writing style set", "<id>, for you" or "<id>, for your team")` | 12 |
| `skills-writing-style.ts:244-246` | `created <path> from <preset>`, `edit it, then: rt skills writing-style use <name>` | `out.line("done", "Created <name>", path)`, `out.callout("next", ["Edit it, then run ", out.cmd("rt skills writing-style use <name>")])` | 12 |
| `lib/skills/sources.ts:71` | `console.error("rt: skipping plugin \"<name>\" -- installPath does not exist: <path>")` | `warn("skills", "skipping plugin \"<name>\" -- installPath does not exist: <path>", { show: { title: "Skipped the <name> plugin", hint: "its folder is gone" } })` | 13 |

Every verb named in a `next` exists in `lib/command-tree-def.ts`: `rt skills compile`, `rt skills check`, `rt skills sync`, `rt skills materialize`, `rt skills packs`, `rt skills init`, `rt skills surface` (its `apply` and `set` modes are positional values of the one leaf), `rt skills bind`, `rt skills audit`, `rt skills expand`, `rt skills writing-style use`, `rt skills writing-style new`, `rt setup`, `rt setup pack` (line 2601), `rt team create` (line 2794). `claude plugin marketplace add` and `claude plugin install` are Claude Code's own commands.

#### Copy table: `lib/skills/link.ts` details (Task 10)

Shown as the hint after the row's word (`linked`, `relinked`, `link removed`, `left alone`, `not linked`), so each reads after a colon.

| Line | Kind | Today | New |
|---|---|---|---|
| 97 | skip | `SKILL.md frontmatter unreadable` | `its SKILL.md header could not be read` |
| 101 | skip | `frontmatter has no usable name:` | `its SKILL.md header has no name` |
| 106 | skip | `duplicate skill name -- already provided by <clash>` | `another skill already has this name: <clash>` |
| 126 | conflict | `a real file or directory occupies this name` | `a file or folder rt did not make has this name` |
| 142 | relink | `was` and an arrow, then `<raw>` | `it pointed at <raw>` |
| 149 | conflict | `points outside this repo: <raw>` | `it links to somewhere outside this repo: <raw>` |
| 162 | prune | `listed in .skillsignore: <raw>` | `.skillsignore lists it now: <raw>` |
| 162 | prune | `target gone: <raw>` | `the skill it pointed at is gone: <raw>` |
| 198 | prune | `source gone: <raw>` | `the skill it pointed at is gone: <raw>` |

No test pins a link detail today (`lib/skills/__tests__/link.test.ts` asserts kinds and paths only); Task 10 pins the new words through `linkBlocks` and one `reconcileSkillLinks` case.

#### Copy table: `lib/skills/init.ts` (Task 10)

A refusal's command leaves the sentence for a new optional `next` on the outcome. Policy refusals are marked; the rest are failures on screen.

| Line | Code | Today | New `detail` | New `next` |
|---|---|---|---|---|
| 308 | `not-a-repo` | `<repo> is not a git checkout` | `<repo> is not a git repo` | |
| 309 | `no-remote` | `<repo> has no git remote; add one so the zone can declare it` | `<repo> has no git remote. Add one, so the team zone can name this repo` | |
| 311 | `no-remote` | `could not read a host and path from remote "<url>"` | `rt could not read a host and path from the remote <url>` | |
| 315 | `mattstack-missing` | `the mattstack plugin is not installed, so the work engine cannot be read; run rt setup pack first` | `The mattstack plugin is not installed, so rt cannot read the work engine` | `rt setup pack` |
| 317 | `claude-missing` | `claude binary not found on PATH; install the Claude CLI, then re-run` | `Claude Code is not on your PATH. Install it, then run this again` | |
| 325 | `zone-missing` | `no team zone without a pack covers <host>; run rt team create <Name> --remote <url>, then re-run` | `No team zone on <host> is free for a new pack` | `rt team create <name> --remote <url>` |
| 333 | `zone-missing` | `no team zone named "<zone>"` | `There is no team zone called <zone>` | |
| 335 | `zone-ambiguous` | `several zones could host this pack: <slugs>; pass --zone <slug>` | `More than one team zone could hold this pack: <slugs>` | `rt skills init --zone <slug>` |
| 338 | `zone-mismatch` (policy) | `zone "<z>" is on <a>, the repo is on <b>` | `The <z> zone is on <a>, but this repo is on <b>` | |
| 341 | `zone-has-pack` (policy) | `zone "<z>" already carries a pack that claims repos; a zone hosts one such pack (a base pack may sit beside it), so create a zone for this team (rt team create)` | `The <z> zone already has a team pack, and a zone holds only one (a base pack can sit beside it)` | `rt team create <name> --remote <url>` |
| 346 | `invalid-namespace` | `zone "<z>" has an invalid namespace "<ns>"; fix mattstack/mattstack.jsonc in the zone` | `The <z> zone's namespace, <ns>, is not a valid pack name. Fix it in the zone's mattstack/mattstack.jsonc` | |
| 350 | `pack-exists` (policy) | `<packs dir> already holds this repo's pack; init never touches an existing pack (see mattstack:extending-a-pack)` | `This zone already has a pack for this repo, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill` | |
| 409 | `materialize-failed` | `<detail>; expected <manifest>` | `<detail>. rt expected the bindings file at <manifest>` | |
| 414 | `compile-failed` | the compile errors | unchanged: they are compile diagnostics | |
| 417 | `check-drift` | `rt skills check reports drift right after compile` | `The pack was out of date right after it compiled` | |
| 425 | `install-failed` | `claude plugin marketplace add exited <n>: <output>` | `Adding the zone's marketplace to Claude Code failed (exit <n>): <output>` | |
| 431 | `install-failed` | `claude plugin install <id> exited <n>: <output>` | `Installing <id> in Claude Code failed (exit <n>): <output>` | |

The remedies (lines 357 to 364) become `{ commands, folder? }`:

| Code | Today | New | On screen |
|---|---|---|---|
| `write-failed` | `then: remove <packDir> and re-run rt skills init` | `{ commands: ["rt skills init"], folder: packDir }` | `next: Delete the pack folder it started, then run rt skills init`, and the details lead with `Pack folder: <packDir>` |
| `materialize-failed` | `then: rt skills materialize --dir <repo>` | `{ commands: ["rt skills materialize --dir <repo>"] }` | `next: Run rt skills materialize --dir <repo>` |
| `compile-failed`, `check-drift` | `then: rt skills compile --pack-dir <d> and rt skills check --pack-dir <d>` | `{ commands: ["rt skills compile --pack-dir <d>", "rt skills check --pack-dir <d>"] }` | `next: Run rt skills compile --pack-dir <d>, then rt skills check --pack-dir <d>` |
| `install-failed` | `then: claude plugin marketplace add <zone> and claude plugin install <id>` | `{ commands: ["claude plugin marketplace add <zone>", "claude plugin install <id>"] }` | `next: Run claude plugin marketplace add <zone>, then claude plugin install <id>` |

#### Copy table: `lib/skills/sync.ts` (Task 11)

Each new string is the step's `detail`, shown as the line's hint or as the `why` of a refusal or failure. A row marked "(refused)" under `pull-engine`, `pull-pack`, `update-engine` or `compile` keeps `refused` in `--json` but is drawn as a failure (Decision 7). A git or Claude Code command failure that quotes the command and its own output stays as it is (`git status failed in <dir>: <stderr>` at 248, 255; `git branch --show-current failed ...` at 263, 271; `git show ... failed ...` at 137; `git add`, `git commit`, `git push failed: ...` at 439 to 443), as do the plain ones (`engine and pack checkouts clean on main`, `up to date` and git's own pull output, `bumped <a> -> <b>`, `compiled clean`, `committed and pushed v<v>`, `updated <id>`, `refreshed <id> ...` at 347, `engine already at <v>` at 353, `engine already current at <v> in the <m> marketplace` at 346).

| Line | Step | Today | New |
|---|---|---|---|
| 46 | (throw) | `cannot bump non-semver version in <path>: <v>` | `The version in <path> is not semver (<v>), so rt cannot bump it` |
| 87, 139 | (throw) | `no "version" string in <path>` | `<path> has no version` |
| 145 | branch note | `; could not read the shared checkout's branch (<stderr>); the in-tree plugin installs from main` | `; rt could not read the shared checkout's branch (<stderr>), and the plugin installs from main` |
| 149 | branch note | `; shared checkout <root> is on "<b>" (or is detached), not main; the in-tree plugin installs from main` | `; the shared checkout at <root> is on <b> (or is detached), not main, and the plugin installs from main` |
| 155 | `guards` | `<pack part>; engine is the installed cache at <dir>, never touched by git` | `<pack part>; the engine is Claude Code's installed cache at <dir>, which git never touches` |
| 154, 158, 159 | `guards` | `pack is in-tree, its git checks skipped` (and the engine form) | `the pack is in the shared checkout, so its git checks are skipped` (and the engine form) |
| 157 | `guards` | `engine and pack are in-tree; git checks skipped` | `the engine and the pack are in the shared checkout, so git checks are skipped` |
| 165 | (throw) | `claude plugin list --json failed: <stderr>` | `Listing Claude Code's plugins failed: <stderr>` |
| 229 to 231 | `guards` (refused) | `claude binary not found; checked PATH, <fallbacks>; install the Claude CLI or put it on PATH, then re-run` | `Claude Code is not on your PATH or at <fallbacks>. Install it, then run this again` |
| 234 | `guards` (refused) | `pack "<p>" has no marketplace; it must be installed from a directory marketplace to sync` | `The <p> pack was not installed from a directory marketplace, so rt has nothing to sync it from` |
| 237 | `guards` (refused) | `engine "<e>" has no marketplace; install it from its marketplace and re-run` | `The <e> engine was not installed from a marketplace. Install it from one, then run this again` |
| 242 | `guards` (refused) | `worktrees directory found at <dir> (a directory-marketplace update copies the whole working tree); prune it and re-run` | `There is a worktrees folder at <dir>, and an update would copy it into the plugin. Remove it, then run this again` |
| 250, 257 | `guards` (refused) | `engine checkout dirty at <dir>: "<status>"; commit or stash and re-run` (and the pack form) | `The engine checkout at <dir> has uncommitted changes (<status>). Commit or stash them, then run this again` (and the pack form) |
| 266, 274 | `guards` (refused) | `engine checkout on branch "<b>"; check out main and re-run` (and the pack form) | `The engine checkout is on <b>, not main. Switch it to main, then run this again` (and the pack form) |
| 293 | `pull-engine` | `engine and pack share a checkout; pulled once as pull-pack` | `The engine and the pack share a checkout, so it is pulled once, with the pack` |
| 297 | `pull-engine` | `engine is the installed cache at <dir> (from the <m> marketplace); never git-pulled, update-engine refreshes it` | `The engine is Claude Code's installed cache from the <m> marketplace, so rt never pulls it; the next step refreshes it` |
| 301, 315 | `pull-engine`, `pull-pack` | `engine is in-tree at <dir>; kept current by update-machine<note>` (and the pack form) | `The engine is in the shared checkout at <dir>, which rt keeps current when it updates this Mac<note>` (and the pack form) |
| 304, 318 | `pull-engine`, `pull-pack` (refused) | `git pull --ff-only failed in <dir>: <stderr>; resolve manually and re-run` | `Pulling <dir> failed: <stderr>. Sort it out by hand, then run this again` |
| 335 | `update-engine` | `sync stopped before compiling the pack against a stale engine` (appended to the three below) | `rt stopped so the pack is not compiled against an old engine` |
| 338 | `update-engine` (refused) | `claude plugin marketplace update <m> failed: <stderr>; <stopped>` | `Updating the <m> marketplace failed: <stderr>. <stopped>` |
| 342 | `update-engine` (refused) | `claude plugin update <id> failed: <stderr>; <stopped>` | `Updating <id> failed: <stderr>. <stopped>` |
| 344 | `update-engine` (refused) | `<id> is not in claude plugin list after its update; <stopped>` | `<id> is not installed after its update. <stopped>` |
| 351 | `update-engine` | `engine and pack share a checkout; update handled as update-pack` | `The engine and the pack share a checkout, so it is updated once, with the pack` |
| 356, 455 | `update-engine`, `update-pack` (failed) | `claude plugin update <id> failed: <stderr>` | `Updating <id> failed: <stderr>` |
| 375 | `check` (refused) | `mcp lint: <n> hits; run rt skills check --pack <p> and fix them before syncing` | `This pack is strict, and mcp lint found <n> hit(s). Fix them before syncing`; the command moves to `syncRefusal`'s `next` |
| 377 to 380 | `check` | `drift=<bool>` plus ` mcp lint: <n> hits (advisory; set "strictLint": true in the pack's plugin.json to refuse on them)` | `the compiled skills are out of date` or `the compiled skills are current`, plus `; mcp lint found <n> hit(s), advisory for this pack` |
| 389, 405, 423, 436 | `bump`, `compile`, `recheck`, `commit-push` | `no drift; skipping version bump` (compile, recheck, commit) | `nothing changed, so the version stays`; `nothing changed, so there is nothing to recompile`; `... nothing to check again`; `... nothing to commit` |
| 391 to 394 | `bump` (refused) | `pack is in-tree at <dir> and its compiled output drifted; sync never bumps, compiles or commits inside the shared checkout, so recompile it and bump its plugin.json version in a pull request to the monorepo` | `This pack is in the shared checkout at <dir>, and its compiled skills are out of date. rt never bumps, compiles or commits there: recompile it and bump its version in a pull request to the monorepo` |
| 415 | `compile` (refused) | `<errors>; reverted plugin.json to <v> so the checkout stays clean for the next run` | `<errors>. rt put the version back to <v>, so the checkout stays clean` (the errors themselves are compile diagnostics and stay) |
| 426 to 428 | `recheck` (refused) | `content drift survives recompile; pack checkout carries an uncommitted version bump (<a> -> <b>) and its compiled output; take the agent path (mattstack:editing-skills), continuing from this working tree` | `The compiled skills are still out of date after a recompile. The checkout keeps the uncommitted version bump (<a> -> <b>) and the compiled output; finish by hand with the mattstack:editing-skills skill, from this working tree` |
| 430 | `recheck` | `drift resolved` | `now current` |
| 466 | `verify-installed` (failed) | `installed version <a> does not match source version <b> after update` | `The installed copy is at <a>, but the source is at <b>` |
| 468 | `verify-installed` | `installed matches source at <v>` | `the installed copy matches the source at <v>` |
| 474 | `cswap-sweep` | `no cswap sessions directory at <dir>` | `no cswap sessions folder at <dir>` |
| 483 | (warning) | `cswap session "<n>" plugins dir (<path>) does not point at <target>` | `The <n> cswap account's plugins folder (<path>) does not point at <target>` |
| 486 | `cswap-sweep` | `no divergent sessions`, `<n> divergent session(s)` | `every cswap account links the current plugins`, `<n> cswap account(s) link another plugins folder` |

Pins this moves in `lib/skills/__tests__/sync.test.ts` (Task 11 Step 1): 306, 321, 337, 461, 515, 677, 759, 782, 804, 888, 911, 912, 1010, 1018, 1097, 1116, 1143; and `commands/__tests__/skills-sync.test.ts:124`.

#### What reads this output (and whether it needs an edit)

| Reader | Where | Reads | Edit needed |
|---|---|---|---|
| `rt_verb` | `lib/mcp/rt-verb.ts:59` | stdout of `skills compile`, `check`, `sync`, `surface`, `bind`, `writing-style show` under `--json` | No: every envelope is unchanged and every note goes to stderr (Review Focus 1) |
| CI | `.github/workflows/checks.yml:270, 274` | exit codes of `skills check --strict` and `skills compile --dry-run` | No |
| `plugins/mattstack/plugin/skills/editing-skills/SKILL.md:336-337` | prose an agent follows | "The bare Bash check prints the same lag as `installed cache: lagging (<a> installed vs <b> source)`." | **Yes (Task 14 Step 1).** Task 6 changes that line, so the quote becomes `[out of date] The installed copy is behind the source  <a> installed, <b> in the source`, the plain text an agent's Bash reads. Same PR, with the `plugin.json` patch bump the `plugin-mattstack` job requires |
| `plugins/mattstack/plugin/skills/editing-skills/SKILL.md:490-491` | prose an agent follows | "When content drift survives that recompile, sync refuses with `content drift survives recompile` and leaves its bump and compiled output in the pack working tree" | **Yes (Task 14 Step 1).** Task 11 rewords that refusal (`lib/skills/sync.ts:426-428`) to `The compiled skills are still out of date after a recompile. ...`; the skill quotes the new opening sentence. Same commit as the lag line |
| `apps/console` | `src/app/wiring/InstalledCachesBar.tsx:56, 243` | the sync report's stopping step `detail` and each step's `detail`, shown verbatim (and `report.error`) | No: it renders whatever words the report carries and matches none of them; `status` and `name` are unchanged |
| `plugins/mattstack/plugin/skills/editing-skills/SKILL.md:342, 527` | prose | "The bare Bash `rt skills check --pack <pack>` names what moved on each stale line (source, fill, include, vendored, frontmatter, structure)" | No: each stale verb's line still names what moved (`[out of date] <verb>  source, fill moved: <files>`), so the sentence stays true |
| `plugins/mattstack/plugin/skills/editing-skills/SKILL.md:349-351` | prose | "The bare Bash sync prints each step's reason" | No: every step's reason is still printed (the steps on stdout, the refusal's `why` on stderr, both on the Bash tool's screen) |
| `plugins/mattstack/plugin/skills/creating-a-pack/SKILL.md:85-105` | `rt skills init --json` | routes on `ok`, `refused`, `error.code` and `error.wrote`; relays `error.message` to the author verbatim | No: every key and code is unchanged, and the message it relays is the reworded detail, which is the point. It never parses the message, and the old remedy was never in the envelope |
| `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md:180` | prose | "`rt skills packs` prints the pack dir" | No: the table carries the folder |
| `plugins/mattstack/tests/stubs-no-source-collision.sh:27` | grep on compiled files | `compiled by rt skills compile` | No: file content, not terminal output |
| `e2e/tests/skills-sync.test.ts`, `e2e/tests/skills-writing-style.test.ts` | spawn | `--json` bodies (the `error` string `no packs discovered` is kept) and `skills --help` (5a's) | No |
| `skills link --json` callers | none: no Swift or TypeScript file runs it (`lib/setup/skills-link-bundled.ts` calls `reconcileSkillLinks` in process and reads `kind` and `changed`) | the envelope | No: every key and `kind` is unchanged; only `detail` wording moves |

#### Tests that change, and the task that changes each

| File | Why | Task |
|---|---|---|
| `lib/skills/__tests__/helpers.ts` | the shared capture | 3 |
| `commands/__tests__/skills.test.ts` | harness in 3; wording in 4, 5, 6 | 3, 4, 5, 6 |
| `commands/__tests__/skills-surface.test.ts` | harness in 3; wording in 4 and 7 | 3, 4, 7 |
| `commands/__tests__/skills-bind.test.ts` | harness in 3; wording in 4 and 8 | 3, 4, 8 |
| `lib/skills/__tests__/compile-native.e2e.test.ts` | harness in 3 (a `console.log` spy wraps `runExpectingCleanExit`; two `--json` checks read a `console.log` spy); compile wording in 5 | 3, 5 |
| `lib/skills/__tests__/surface.test.ts` | harness in 3 (a file-level `console.log` spy, and one test's own `console.error` and `process.exit` spies); compile wording in 5 | 3, 5 |
| `lib/skills/__tests__/init-compile.e2e.test.ts` | none: it calls `runExpectingCleanExit` with no spy of its own; it runs in each task's list from 3 on | |
| `commands/__tests__/skills-check-strict.test.ts`, `skills-compile-source.test.ts` | a `console.log` spy that goes silent | 6 |
| `commands/__tests__/skills-expand.test.ts`, `lib/__tests__/no-board-skills-drift.test.ts` | harness in 3; wording in 9 | 3, 9 |
| `commands/__tests__/skills-audit.test.ts` | the result shape and wording | 9 |
| `commands/__tests__/skills-init.test.ts`, `skills-link.test.ts` | `renderInitOutcome` goes; two error strings; the refusal split | 10 |
| `lib/skills/__tests__/init.test.ts`, `lib/skills/__tests__/link.test.ts` | the init copy and remedy shape; one pin of a link detail | 10 |
| `commands/__tests__/skills-sync.test.ts`, `lib/skills/__tests__/sync.test.ts` | new block tests; the sync copy | 11 |
| `commands/__tests__/skills-writing-style.test.ts` | the deps seam; refusals and the existing-style note | 12 |
| `lib/skills/__tests__/sources.test.ts` | a `console.error` spy that goes silent | 13 |

Nineteen of these are modified; `init-compile.e2e.test.ts` only joins the run lists. Task 3 also creates `commands/__tests__/skills-json-frozen.test.ts`, and Tasks 4, 5 and 6 each create one output test.

---

### Task 3: One capture for the skills tests, and the `--json` lines pinned

Nothing under `commands/` changes in this task. After it, every skills command test reads output the same way before and after its command is converted.

**Files:**
- Modify: `lib/skills/__tests__/helpers.ts`
- Modify: `commands/__tests__/skills.test.ts`, `commands/__tests__/skills-surface.test.ts`, `commands/__tests__/skills-bind.test.ts`, `commands/__tests__/skills-expand.test.ts`, `lib/__tests__/no-board-skills-drift.test.ts`, `lib/skills/__tests__/compile-native.e2e.test.ts`, `lib/skills/__tests__/surface.test.ts`
- Create: `commands/__tests__/skills-json-frozen.test.ts`
- Run only: `lib/skills/__tests__/init-compile.e2e.test.ts` (it calls `runExpectingCleanExit` and holds no spy of its own)

**Interfaces:**
- Consumes: `captureOut(opts?: { console?: boolean }): CapturedOut` with `stdout()`, `stderr()`, `lines()`, `errLines()`, `clear()`, `reset()`, `restore()` (`lib/ui/__tests__/capture-out.ts`, phases 2 and 4); `out.__test__.setHuman` (`lib/ui/out.ts`).
- Produces, in `lib/skills/__tests__/helpers.ts`:
  - `captureSkills(): CapturedOut`: `captureOut({ console: true })` with the human gate closed. Only one may be open at a time; `restore()` closes it.
  - `runExpectingCleanExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; errors: string[] }>`: same signature as today. `errors` is every stderr line written during `fn` (stream writes and `console.error` alike). It uses the open `captureSkills()` capture when there is one and opens its own otherwise.

- [ ] **Step 1: Write the characterization tests**

Create `commands/__tests__/skills-json-frozen.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";
import { checkPack, skillsCheck, skillsCompile, skillsComposition, skillsPacks, skillsSurface } from "../skills.ts";
import { skillsLink } from "../skills-link.ts";

let io: CapturedOut;
let root: string;
const origHome = process.env.HOME;

function makePack(): string {
  const dir = join(root, "acme");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "1.0.0" }));
  mkdirSync(join(dir, "skills", "x"), { recursive: true });
  writeFileSync(join(dir, "skills", "x", "SKILL.md"), "---\nname: x\n---\nNo commands here.\n");
  return dir;
}

/** stdout is exactly one line, and that line is compact JSON. */
function oneJsonLine(): { line: string; value: Record<string, unknown> } {
  const text = io.stdout();
  expect(text.endsWith("\n")).toBe(true);
  const line = text.slice(0, -1);
  expect(line).not.toContain("\n");
  const value = JSON.parse(line) as Record<string, unknown>;
  expect(JSON.stringify(value)).toBe(line);
  return { line, value };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-frozen-")));
  process.env.HOME = join(root, "home");
  mkdirSync(process.env.HOME, { recursive: true });
  io = captureSkills();
});

afterEach(() => {
  io.restore();
  process.env.HOME = origHome;
  process.exitCode = 0;
  rmSync(root, { recursive: true, force: true });
});

test("skills check --json is the check payload minus drift, in this key order", async () => {
  const dir = makePack();
  const { pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint } = await checkPack({ packDir: dir });
  io.clear();
  await skillsCheck(["--pack-dir", dir, "--json"]);
  expect(io.stdout()).toBe(JSON.stringify({ pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint }) + "\n");
});

test("skills compile --json is one line with these keys", async () => {
  await skillsCompile(["--pack-dir", makePack(), "--dry-run", "--json"]);
  expect(Object.keys(oneJsonLine().value)).toEqual(["pack", "packDir", "manifestPath", "repoKey", "written", "verbs", "misplaced"]);
});

test("skills composition --json is one line with these keys", async () => {
  await skillsComposition(["--pack-dir", makePack(), "--json"]);
  expect(Object.keys(oneJsonLine().value)).toEqual(["pack", "packDir", "manifestPath", "verbs", "fills", "binders", "pipelines"]);
});

test("skills surface list --json is one line with these keys", async () => {
  await skillsSurface(["list", "--pack-dir", makePack(), "--json"]);
  expect(Object.keys(oneJsonLine().value)).toEqual(["pack", "packDir", "rows"]);
});

test("skills surface --json with no mode is the one error envelope", async () => {
  await skillsSurface(["--json", "--pack-dir", makePack()]);
  expect(io.stdout()).toBe('{"ok":false,"error":"rt skills surface --json needs a mode: list, set <name...> --public|--internal, or apply"}\n');
  expect(process.exitCode).toBe(1);
});

test("skills packs --json with no marketplaces is an empty list", async () => {
  const settings = join(root, "settings.json");
  writeFileSync(settings, "{}");
  await skillsPacks(["--json", "--settings-path", settings]);
  expect(io.stdout()).toBe('{"packs":[]}\n');
});

test("skills link --json is one contract envelope with these keys", async () => {
  const from = join(root, "bundle");
  mkdirSync(join(from, "alpha"), { recursive: true });
  writeFileSync(join(from, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: a\n---\nbody\n");
  await skillsLink(["--from", from, "--dry-run", "--json"]);
  const { value } = oneJsonLine();
  expect(Object.keys(value)).toEqual(["contract", "at", "ok", "dryRun", "skillsDir", "claudeSkillsDir", "changed", "actions"]);
  expect(value.contract).toBe(1);
});
```

The other envelopes are already pinned by whole-object equality in the existing suites and need nothing new: `surface set` and `surface apply` (`skills-surface.test.ts`, `expect(payload).toEqual({...})`), `bind` (`skills-bind.test.ts`), `materialize` and the `compile --json` rows (`skills.test.ts`), `expand` (`skills-expand.test.ts` and `no-board-skills-drift.test.ts`), `init` (`skills-init.test.ts`), `writing-style` (`skills-writing-style.test.ts`, exact `toEqual` on the envelope), `sync` (`e2e/tests/skills-sync.test.ts`). `skills audit --json` needs a Claude login to run and is pinned through `auditJsonPayload` in `skills-audit.test.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test commands/__tests__/skills-json-frozen.test.ts`
Expected: FAIL, `captureSkills` is not exported by `lib/skills/__tests__/helpers.ts`.

- [ ] **Step 3: Rewrite the helper**

Replace all of `lib/skills/__tests__/helpers.ts` with:

```ts
import { spyOn } from "bun:test";
import * as out from "../../ui/out.ts";
import { captureOut, type CapturedOut } from "../../ui/__tests__/capture-out.ts";

let active: CapturedOut | null = null;

/**
 * What a skills command printed, as plain text: console and stream writes
 * alike, with the human gate closed. One at a time; restore() closes it.
 */
export function captureSkills(): CapturedOut {
  const io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  const capture: CapturedOut = {
    ...io,
    restore: () => {
      active = null;
      io.restore();
    },
  };
  active = capture;
  return capture;
}

/**
 * Expected errors print a failure and process.exit instead of throwing a
 * stack. process.exit is mocked to throw a sentinel so the test process
 * lives; `errors` is every stderr line the call wrote. A second console.error
 * spy here would unhook the open capture's own, so this reads that capture
 * when one is open.
 */
export async function runExpectingCleanExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; errors: string[] }> {
  const own = active ? null : captureSkills();
  const io = active!;
  const before = io.errLines().length;
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return { exitCode: undefined, errors: io.errLines().slice(before) };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, errors: io.errLines().slice(before) };
  } finally {
    exitSpy.mockRestore();
    own?.restore();
  }
}
```

- [ ] **Step 4: Move the five test files onto it**

The same edit in `commands/__tests__/skills.test.ts`, `skills-surface.test.ts`, `skills-bind.test.ts`, `skills-expand.test.ts` and `lib/__tests__/no-board-skills-drift.test.ts` (each has its own `console.log` spy, which the helper's capture would unhook):

1. Import: `import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";` and `import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";` (from `lib/__tests__/no-board-skills-drift.test.ts` the paths are `../skills/__tests__/helpers.ts` and `../ui/__tests__/capture-out.ts`). In `skills-surface.test.ts` and `skills-bind.test.ts`, delete the local `async function runExpectingCleanExit` (surface lines 146 to 164, bind lines 219 to 237); the shared one has the same signature.
2. Replace the two declarations `let logSpy: ReturnType<typeof spyOn>;` and `let logs: string[];` with `let io: CapturedOut;`.
3. In `beforeEach`, replace `logs = [];` and the `logSpy = spyOn(console, "log")...` statement with `io = captureSkills();`.
4. In `afterEach`, replace `logSpy.mockRestore();` with `io.restore();`.
5. Replace every read of `logs` with `io.lines()` (`logs.find(` becomes `io.lines().find(`, `expect(logs)` becomes `expect(io.lines())`, `logs[0]` becomes `io.lines()[0]`, `logs.join("\n")` becomes `io.lines().join("\n")`), and every `logs = [];` or `logs.length = 0;` inside a test with `io.clear();`.
6. Each test that makes its own `spyOn(console, "error")` would unhook the capture's spy. Replace each with a read of the capture: delete the `const errors: string[] = [];` line, the `const errorSpy = spyOn(console, "error")...` statement and its `errorSpy.mockRestore();`, put `io.clear();` where the spy was created, and after the call add `const errors = io.errLines();`. The sites: `skills.test.ts` lines 1841, 1873, 1895; `skills-bind.test.ts` lines 756 and 862. At `skills-bind.test.ts:399` the spy only silenced output: delete the spy and its restore and add nothing.
7. Remove `spyOn` from the `bun:test` import in a file that no longer uses it.

`io.lines()` splits on newlines, where a `console.log` of a multi-line string used to be one entry. Two tests in `skills.test.ts` count entries for the preview body (lines 1117 and 1129, `expect(logs).toHaveLength(1)`); change each pair to read the whole text until Task 5 gives them their final form:

```ts
    expect(io.stdout()).toContain("The work type is `feature`. Continue.");
```

```ts
    expect(io.stdout()).not.toContain("The work type is");
```

`errors` splits the same way. A `loadStepSource` miss lists every path it searched, one per line, so two tests that count `errors` entries for such a message now count lines. In `skills.test.ts`, line 428 (`expect(errors).toHaveLength(2);`, two verbs with missing engines) becomes:

```ts
    expect(errors.filter((e) => e.startsWith("rt skills: "))).toHaveLength(2);
```

and line 1190 (`expect(errors).toHaveLength(1);`, a pipeline stage with no `SKILL.md`) becomes:

```ts
    expect(errors.filter((e) => e.startsWith("rt skills: "))).toHaveLength(1);
```

Every other `toHaveLength` on `errors` in these files counts a one-line message and stays.

`lib/skills/__tests__/surface.test.ts` has the same file-level spy (lines 292 to 307): apply items 1 to 5 to it, with the import paths `./helpers.ts` and `../../ui/__tests__/capture-out.ts`. Its test at line 350 (`a retired stub verb with no dir on disk ...`) builds its own `console.error` and `process.exit` spies, which would unhook the capture's; replace lines 363 to 386 (from `const errors: string[] = [];` to the end of its `finally`) with:

```ts
    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile([
        "--team", "acme",
        "--pack-dir", packDir,
        "--mattstack-dir", mattstackDir,
        "--manifest", manifestPath,
      ]),
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("acme:old-verb");
    expect(errors.join("\n")).toContain("surface-internal");
```

Then `spyOn` is unused there; drop it from the `bun:test` import.

`lib/skills/__tests__/compile-native.e2e.test.ts` has no file-level spy, but two kinds of local ones:

- `compileCapturingLogs` (lines 244 to 257) holds a `console.log` spy around `runExpectingCleanExit`. In bun 1.4.2 a second `spyOn` of an already-spied method returns the same mock, so the helper's capture would restore the real `console.log` on its way out and leave this spy dead. Replace the function and its comment with:

```ts
/** A failing compile calls process.exit(1); runExpectingCleanExit turns that into a result instead of ending the bun process. */
async function compileCapturingLogs(pack: string, ms: string, manifest: string, extra: string[] = []): Promise<CompileRun> {
  const io = captureSkills();
  try {
    const { exitCode, errors } = await runExpectingCleanExit(() =>
      skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest, ...extra]),
    );
    return { logs: io.lines(), errors, exitCode };
  } finally {
    io.restore();
  }
}
```

- The two `check --json` tests (lines 89 to 130) read `JSON.parse(logs.join("\n"))` from a `console.log` spy, which goes empty once Task 6 writes the envelope through `out.json`. In each, replace the `const logs ...` declaration, the spy, and the `try`/`finally` with:

```ts
    const io = captureSkills();
    try {
      await skillsCheck(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest, "--json"]);
    } finally {
      io.restore();
    }

    const parsed = JSON.parse(io.stdout());
```

  `restore()` puts the streams back and leaves the buffers, so `io.stdout()` still reads after it.

Change its imports to `import { afterEach, describe, expect, test } from "bun:test";` and `import { captureSkills, runExpectingCleanExit } from "./helpers.ts";`.

- [ ] **Step 5: Run the suites**

Run: `bun test commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-bind.test.ts commands/__tests__/skills-expand.test.ts lib/__tests__/no-board-skills-drift.test.ts lib/skills/__tests__/compile-native.e2e.test.ts lib/skills/__tests__/surface.test.ts lib/skills/__tests__/init-compile.e2e.test.ts`
Expected: PASS. Nothing under `commands/` has changed, so a failure here is a harness mistake: the usual one is a test that still builds its own console spy (Step 4 item 6).

Run: `grep -rln 'spyOn(console' commands/__tests__/skills*.test.ts lib/skills/__tests__ lib/__tests__/no-board-skills-drift.test.ts`
Expected: only `commands/__tests__/skills-check-strict.test.ts`, `skills-compile-source.test.ts`, `skills-init.test.ts`, `skills-audit.test.ts` and `lib/skills/__tests__/sources.test.ts`, each of which a later task repoints (6, 6, 10, 9, 13), and none of which calls `runExpectingCleanExit` while its spy is open. Any other file is a spy this step missed.

- [ ] **Step 6: Commit**

```bash
git add lib/skills/__tests__/helpers.ts commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-bind.test.ts commands/__tests__/skills-expand.test.ts lib/__tests__/no-board-skills-drift.test.ts lib/skills/__tests__/compile-native.e2e.test.ts lib/skills/__tests__/surface.test.ts
```

```bash
git commit -m "skills tests: one capture for console and stream output, and the --json lines pinned

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Skills failures and the pack notes

**Files:**
- Modify: `commands/skills.ts` (lines 72 to 91, 190 to 230, 401 to 450, 863 to 866, 2065, 2076, 2358, 2381)
- Create: `commands/__tests__/skills-failures.test.ts`
- Modify: `commands/__tests__/skills.test.ts`, `skills-surface.test.ts`, `skills-bind.test.ts`

**Interfaces:**
- Consumes: `out.fail(f: FailureInput, ...after: Block[]): void`, `out.note(...blocks: Block[]): void`, `out.line`, `out.callout`, `out.strong`, `FailureInput` (`lib/ui/out.ts`); `usageFailure(title: string, usage: string, why?: string): FailureInput` (`lib/ui/usage.ts`, 5a); `captureSkills`, `runExpectingCleanExit` (Task 3).
- Produces, exported from `commands/skills.ts`:
  - `class SkillsUsageError extends Error { constructor(message: string, shown?: out.FailureInput); readonly shown?: out.FailureInput }`
  - `function skillsFailure(err: SkillsUsageError): out.FailureInput`

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/skills-failures.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import { SkillsUsageError, skillsCheck, skillsCompile, skillsFailure } from "../skills.ts";

let io: CapturedOut;
let root: string;
const cwd = process.cwd();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-failures-")));
  io = captureSkills();
});

afterEach(() => {
  process.chdir(cwd);
  io.restore();
  process.exitCode = 0;
  rmSync(root, { recursive: true, force: true });
});

test("a message with no shown copy is the title, unprefixed", () => {
  expect(skillsFailure(new SkillsUsageError('unrecognized argument "--bogus"'))).toEqual({ title: 'unrecognized argument "--bogus"' });
});

test("a multi-line message keeps every line", () => {
  expect(skillsFailure(new SkillsUsageError("first chain error\nsecond chain error\nthird"))).toEqual({ title: "first chain error", details: "second chain error\nthird" });
});

test("shown copy wins, and the message stays what it was", () => {
  const err = new SkillsUsageError("--preview needs a single --verb", { title: "Which verb should be previewed?" });
  expect(skillsFailure(err)).toEqual({ title: "Which verb should be previewed?" });
  expect(err.message).toBe("--preview needs a single --verb");
});

test("a usage error prints one failure on stderr, exits 1 and writes nothing to stdout", async () => {
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(["--bogus-flag"]));
  expect(exitCode).toBe(1);
  expect(errors).toEqual(['unrecognized argument "--bogus-flag"']);
  expect(io.stdout()).toBe("");
});

test("--preview without one verb asks which", async () => {
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(["--preview"]));
  expect(exitCode).toBe(1);
  expect(errors).toEqual(["Which verb should be previewed?", "  next: rt skills compile --preview --verb <name>"]);
});

test("no packs found names both ways to say which pack", async () => {
  process.chdir(root);
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCheck(["--mattstack-dir", root]));
  expect(exitCode).toBe(1);
  expect(errors).toEqual([
    "No packs found",
    "  why: A pack is a plugin from a directory marketplace that has a surface file.",
    "  next: Run it again with --pack <name> or --pack-dir <folder>",
  ]);
});

test("a pack folder that is not there says so, with the folder under it", async () => {
  const missing = join(root, "nope");
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCheck(["--pack-dir", missing]));
  expect(exitCode).toBe(1);
  expect(errors).toEqual(["That pack folder does not exist", `  ${missing}`]);
});

test("the enclosing-pack note goes to stderr and stdout stays one JSON line", async () => {
  const pack = join(root, "acme");
  mkdirSync(join(pack, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pack, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "1.0.0" }));
  mkdirSync(join(pack, "pack"), { recursive: true });
  writeFileSync(join(pack, "pack", "surface.jsonc"), '{ "public": [] }');
  mkdirSync(join(pack, "skills", "x"), { recursive: true });
  writeFileSync(join(pack, "skills", "x", "SKILL.md"), "---\nname: x\n---\nNo commands here.\n");
  process.chdir(pack);

  await skillsCheck(["--json"]);

  expect(io.errLines()).toEqual([`  note: Using the pack this folder is inside: ${pack}`]);
  const text = io.stdout();
  expect(text.endsWith("\n")).toBe(true);
  expect(text.slice(0, -1)).not.toContain("\n");
  expect(JSON.parse(text).pack).toBe("acme");
});
```

`findEnclosingPack` (`lib/skills/packs.ts`) is what decides the last test's fixture is a pack tree. If it does not recognise this one, read that function and give the fixture what it looks for (it is the marker `discoverPacks` uses: a `surface.jsonc` under the plugin folder); the assertions do not change.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-failures.test.ts`
Expected: FAIL. `skillsFailure` is not exported; the usage error still prints `rt skills: unrecognized argument "--bogus-flag"`.

- [ ] **Step 3: Give `SkillsUsageError` its shown copy**

In `commands/skills.ts`, add to the imports:

```ts
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
```

(`loadIncludesFor` has a local named `out` at line 605. It shadows the import inside that function only and prints nothing, so leave it.)

Replace lines 72 to 91 (the class comment, the class and `withCleanErrors`) with:

```ts
/**
 * An expected, user-facing condition (bad flags, an absent binding, an
 * unknown verb) rather than a bug in this command. `message` is the technical
 * text: it also travels inside --json envelopes and other verbs' errors, so
 * it never changes for the sake of the screen. `shown` is what a person reads
 * in its place; without it the message is the failure's title.
 */
export class SkillsUsageError extends Error {
  constructor(
    message: string,
    readonly shown?: out.FailureInput,
  ) {
    super(message);
  }
}

export function skillsFailure(err: SkillsUsageError): out.FailureInput {
  if (err.shown) return err.shown;
  const [title, ...rest] = err.message.split("\n");
  return { title: title ?? err.message, ...(rest.length > 0 ? { details: rest.join("\n") } : {}) };
}

async function withCleanErrors(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof SkillsUsageError) {
      out.fail(skillsFailure(err));
      process.exit(1);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Add the shown copy at the thirteen sites**

Line 195:

```ts
      throw new SkillsUsageError(`--pack-dir ${packDir} is not an existing directory`, { title: "That pack folder does not exist", details: packDir });
```

Lines 216 to 218 (keep the message expression as it is and add the second argument):

```ts
    throw new SkillsUsageError(
      `no pack named "${flags.team}" (discovered: ${packs.map((p) => p.name).join(", ") || "none"}; checked ${legacy})`,
      { title: `No pack is called ${flags.team}`, next: out.cmd("rt skills packs"), details: `Packs here: ${packs.map((p) => p.name).join(", ") || "none"}` },
    );
```

Line 222 (`resolvePack` does not know which verb called it, so the `next` names the two ways to say which pack):

```ts
  if (packs.length === 0) {
    throw new SkillsUsageError("no packs discovered (no directory marketplace plugin carries a surface.jsonc); pass --pack <name>", {
      title: "No packs found",
      why: "A pack is a plugin from a directory marketplace that has a surface file.",
      next: ["Run it again with ", out.cmd("--pack <name>"), " or ", out.cmd("--pack-dir <folder>")],
    });
  }
```

Line 225:

```ts
    throw new SkillsUsageError(`which pack? pass --pack <name> (discovered: ${packs.map((p) => p.name).join(", ")})`, {
      title: "Which pack?",
      why: `There is more than one: ${packs.map((p) => p.name).join(", ")}.`,
      next: ["Run it again with ", out.cmd("--pack <name>")],
    });
```

In `findDefaultManifest`, lines 415 to 417:

```ts
    throw new SkillsUsageError(
      `no ${team} bindings file for repo "${repo}" under ${reposRoot} (have: ${candidates.map((c) => c.slug).join(", ") || "none"}); run rt skills materialize`,
      {
        title: `No ${team} bindings file for ${repo} yet`,
        next: out.cmd("rt skills materialize"),
        details: `Repos that have one: ${candidates.map((c) => c.slug).join(", ") || "none"}`,
      },
    );
```

lines 432 to 436:

```ts
    throw new SkillsUsageError(
      `pack "${team}" binds ${candidates.length} repos (${candidates.map((c) => c.slug).join(", ")})` +
        (hostless ? `; its team zone declares no forge host, so its projects cannot pick one` : "") +
        `; pass --repo <slug or host/path>`,
      {
        title: "Which repo?",
        why:
          `The ${team} pack is bound in ${candidates.length} repos: ${candidates.map((c) => c.slug).join(", ")}.` +
          (hostless ? " Its team zone names no forge host, so rt cannot pick one." : ""),
        next: ["Run it again with ", out.cmd("--repo <slug>")],
      },
    );
```

and lines 446 to 450:

```ts
  throw new SkillsUsageError(
    `no repos/*/packs/${team}/skills.jsonc under ${reposRoot}` +
      (standalone ? ` and ${ownManifest} is absent` : "") +
      `; run rt skills materialize, or pass --manifest explicitly`,
    {
      title: `No ${team} bindings file was found`,
      next: out.cmd("rt skills materialize"),
      details: `Looked for repos/*/packs/${team}/skills.jsonc under ${reposRoot}` + (standalone ? `, and for ${ownManifest}` : ""),
    },
  );
```

Line 863:

```ts
      throw new SkillsUsageError("--preview needs a single --verb", usageFailure("Which verb should be previewed?", "rt skills compile --preview --verb <name>"));
```

Line 866:

```ts
      throw new SkillsUsageError("--preview and --json cannot be combined (--preview prints the compiled body; --json compiles, writes, and reports)", {
        title: "A preview prints the compiled skill, so it cannot also print JSON",
        next: out.cmd("rt skills compile --preview --verb <name>"),
      });
```

Line 2065:

```ts
        throw new SkillsUsageError("set requires a skill name: rt skills surface set <name...> --public|--internal", usageFailure("Which skill?", "rt skills surface set <name> --public"));
```

Line 2076:

```ts
      if (!want) {
        throw new SkillsUsageError(
          "set requires --public or --internal",
          usageFailure("Should it be public or internal?", "rt skills surface set <name> --public", "Say which with --public or --internal."),
        );
      }
```

Line 2358:

```ts
      throw new SkillsUsageError("bind requires: rt skills bind <verb> <slot> <fill>", usageFailure("Bind which verb, slot and fill?", "rt skills bind <verb> <slot> <fill>"));
```

Lines 2381 to 2383:

```ts
      const fragment = join(resolved.packDir, "pack", "skills.jsonc");
      throw new SkillsUsageError(
        `pack "${resolved.team}" is a base pack with no verbs of its own, so bind cannot check the slot; edit ${fragment} directly`,
        {
          title: `${resolved.team} is a base pack with no verbs of its own, so rt cannot check the slot`,
          why: "Edit its bindings file by hand.",
          details: fragment,
        },
      );
```

- [ ] **Step 5: Move the two pack notes onto `out.note`**

In `resolvePack`, replace line 204:

```ts
      out.note(out.callout("note", ["Using the pack this folder is inside: ", out.strong(enclosing.dir)]));
```

and line 207:

```ts
    out.note(out.line("warn", `This folder is inside the ${name} pack, but you asked for ${flags.team}`, "using the one you asked for"));
```

- [ ] **Step 6: Run the new tests**

Run: `bun test commands/__tests__/skills-failures.test.ts`
Expected: PASS.

- [ ] **Step 7: Update the assertions that pinned the old frame**

`errors` is now stderr lines, so `errors[0]` is the failure's title.

In `commands/__tests__/skills.test.ts`:

- Line 304: `expect(errors.join("\n")).toContain("Which verb should be previewed?");`
- Lines 1009, 1029, 1050: `expect(errors).toEqual([expect.stringContaining("Using the pack this folder is inside")]);`
- Line 1071: `expect(errors.join("\n")).toContain("No pack is called other");`
- Line 949: stays (`errors.join("\n")` holds the folder on the details line). Line 962: stays.
- Lines 472, 493, 1167 and 1219 each read `expect(errors[0]).toStartWith("rt skills: ");` under a one-line `SkillsUsageError` with no `shown` (an unrecognized flag; an unknown verb, line 787; the roster and stage collision, line 771). Replace each with `expect(errors.join("\n")).not.toContain("rt skills:");`; the `toHaveLength(1)` above each stays.
- Lines 1190 and 1191 (Task 3's `filter(...)` count and the prefix pin; the stage with no `SKILL.md` that `buildStageEntries` rejects through line 555, a message of several lines): replace both with `expect(errors.join("\n")).not.toContain("rt skills:");`. Lines 1192 to 1194 stay: the title is the message's first line, which names the pipeline and the stage.
- Lines 511 to 513 (`absent manifest`, the error at line 446, which now has `shown` copy): replace the three lines with `expect(errors[0]).toBe("No t bindings file was found");` and `expect(errors.join("\n")).toContain("skills.jsonc");`.
- Lines 769 and 770 (a team-zone pack never falls back to its fragment: the same error at 446): `expect(errors[0]).toBe("No t bindings file was found");` and `expect(errors.join("\n")).toContain("skills.jsonc");`.
- Line 612: `expect(errors[0]).toBe("No t bindings file was found");` and `expect(errors.join("\n")).toContain("repos/*/packs/t/skills.jsonc");`.
- Line 642: `expect(ambiguous.errors[0]).toBe("Which repo?");` and `expect(ambiguous.errors.join("\n")).toContain("--repo <slug>");`.
- Line 667: `expect(errors[0]).toBe("No t bindings file for nope yet");`.
- Lines 696 to 697: `expect(errors.join("\n")).toContain("names no forge host");` and `expect(errors.join("\n")).toContain("--repo <slug>");`.
- Lines 626 to 628 (the base pack error at line 401, which keeps its message as the title): stay.

In `commands/__tests__/skills-surface.test.ts`, each of lines 201, 386, 400, 409, 520 and 688 reads `expect(errors[0]).toStartWith("rt skills: ");`. Replace each with:

```ts
    expect(errors.join("\n")).not.toContain("rt skills:");
```

Line 947 (`errors.join("\n")).toContain("--pack")`) stays: the run passes `--mattstack-dir`, so discovery finds nothing, and the `No packs found` failure's `next` names `--pack <name>`.

In `commands/__tests__/skills-bind.test.ts`, the same replacement at lines 316, 475, 496, 601 and 618, and lines 454 to 456 (the base pack with no verbs of its own) become `expect(errors[0]).toBe("acme-base is a base pack with no verbs of its own, so rt cannot check the slot");` and `expect(errors.join("\n")).toContain(fragmentPath);`.

The prefix assertions at `skills.test.ts:401 to 402` and `428 to 429`, and at `lib/skills/__tests__/surface.test.ts:525 to 526` and `564 to 565`, belong to compile failures (`performCompile`'s `failures`, still printed by hand until Task 5) and are Task 5's.

- [ ] **Step 8: Run the affected suites**

Run: `bun test commands/__tests__/skills-failures.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-bind.test.ts commands/__tests__/skills-audit.test.ts commands/__tests__/skills-json-frozen.test.ts lib/skills/__tests__/compile-native.e2e.test.ts lib/skills/__tests__/surface.test.ts lib/skills/__tests__/init-compile.e2e.test.ts`
Expected: PASS. The compile-failure prefix pins still pass here, because those lines are still `console.error("rt skills: ...")`, which the capture reads. Any failure is an assertion this step missed: match it against Task 2's `SkillsUsageError` table.

Run: `grep -rn '"rt skills: ' commands/__tests__ lib/skills/__tests__`
Expected: exactly five hits, all Task 5's: `commands/__tests__/skills.test.ts:402`, `skills.test.ts:428` (Task 3's `filter(...)` count), `skills.test.ts:429`, `lib/skills/__tests__/surface.test.ts:526` and `surface.test.ts:565`.

- [ ] **Step 9: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills-failures.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-bind.test.ts
```

```bash
git commit -m "skills: usage errors are failure blocks, and the pack notes go to stderr through the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `skills compile`

**Files:**
- Modify: `commands/skills.ts` (lines 856 to 950)
- Create: `commands/__tests__/skills-compile-output.test.ts`
- Modify: `commands/__tests__/skills.test.ts`, `lib/skills/__tests__/surface.test.ts`, `lib/skills/__tests__/compile-native.e2e.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.json`, `out.payload`, `out.payloadOnStdout`, `out.line`, `out.callout`, `out.cmd`, `Block` (`lib/ui/out.ts`, `lib/ui/protocol.ts`); `SkillsUsageError`, `skillsFailure` (Task 4); `Side` (`lib/skills/types.ts`).
- Produces, exported from `commands/skills.ts`:
  - `type CompiledRow = { name: string; side: Side; files: number; warnings: string[] }`
  - `function compileBlocks(rows: CompiledRow[], writing: boolean): Block[]`
  - `function compileFailure(failures: string[]): out.FailureInput`
  - `function misplacedFailure(names: string[]): out.FailureInput`

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/skills-compile-output.test.ts`:

```ts
import { expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { compileBlocks, compileFailure, misplacedFailure } from "../skills.ts";

test("a compile lists each verb, with its warnings under it", () => {
  expect(
    renderPlain(
      compileBlocks(
        [
          { name: "watch-ci", side: "skills", files: 3, warnings: ["slot forge is bound but unused"] },
          { name: "ship", side: "attachments", files: 1, warnings: [] },
        ],
        true,
      ),
    ),
  ).toBe("[warning] Compiled watch-ci  3 files in skills/\n  note: slot forge is bound but unused\n[ok] Compiled ship  1 file in attachments/\n");
});

test("a warning that already starts with note: is not labelled twice", () => {
  expect(
    renderPlain(compileBlocks([{ name: "watch-ci", side: "skills", files: 1, warnings: ["note: acme:qa-gates is surface-internal; inlined"] }], true)),
  ).toBe("[warning] Compiled watch-ci  1 file in skills/\n  note: acme:qa-gates is surface-internal; inlined\n");
});

test("a dry run says what it would write", () => {
  expect(renderPlain(compileBlocks([{ name: "watch-ci", side: "skills", files: 3, warnings: [] }], false))).toBe("[not yet] watch-ci  would write 3 files\n");
});

test("an empty compile says so", () => {
  expect(renderPlain(compileBlocks([], true))).toBe("[skipped] Nothing to compile  this pack has no verbs\n");
});

test("compile failures are one failure with every message under it", () => {
  expect(renderPlain([out.failure(compileFailure(['verb "a": slot "forge" has no binding', 'verb "b": engine not found']))])).toBe(
    '2 verbs did not compile\n  verb "a": slot "forge" has no binding\n  verb "b": engine not found\n',
  );
  expect(compileFailure(["only one"]).title).toBe("1 verb did not compile");
});

test("a misplaced skill names the fix", () => {
  expect(renderPlain([out.failure(misplacedFailure(["helper"]))])).toBe(
    "helper is in the wrong folder\n  why: A skill's folder has to match whether it is public or internal.\n  next: rt skills surface apply\n",
  );
  expect(renderPlain([out.failure(misplacedFailure(["a", "b"]))])).toBe(
    "2 skills are in the wrong folder\n  why: A skill's folder has to match whether it is public or internal.\n  next: rt skills surface apply\n  a\n  b\n",
  );
});
```

In `commands/__tests__/skills.test.ts`, add `import * as ui from "../../lib/ui/out.ts";` (and put `spyOn` back in the `bun:test` import if Task 3 removed it) and replace the test body tails at lines 1117 to 1118 and 1129 to 1130 (the two preview tests Task 3 loosened). The first becomes:

```ts
    // Strict, not toContain: a second body on stdout (the stage's after the
    // orchestrator's) is the N+1-bodies bug, and one payload call is the check.
    expect(payload).toHaveBeenCalledTimes(1);
    expect(io.stdout()).toContain("The work type is `feature`. Continue.");
    expect(io.stdout().endsWith("\n")).toBe(true);
    expect(io.stdout().endsWith("\n\n")).toBe(false);
```

and the second:

```ts
    expect(payload).toHaveBeenCalledTimes(1);
    expect(io.stdout()).not.toContain("The work type is");
```

In each of those two tests, open the spy as the first statement and wrap everything after it in a `try` whose `finally` restores it. bun hands a second `spyOn` of the same method the same mock, so a spy left open by a failing assertion would carry its call count into the next test's `toHaveBeenCalledTimes(1)`:

```ts
    const payload = spyOn(ui, "payload");
    try {
      // the test's existing body, ending with the assertions above
    } finally {
      payload.mockRestore();
    }
```

Then add one test beside them (it reuses `makePipelineFixtures`, which those two tests already call):

```ts
  test("--preview writes the body once through out.payload and nothing else on stdout", async () => {
    const { mattstackDir, packDir, manifestPath } = makePipelineFixtures();
    const payload = spyOn(ui, "payload");
    try {
      await skillsCompile(["--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath, "--verb", "stage-plan", "--preview"]);
      expect(payload).toHaveBeenCalledTimes(1);
      expect(io.stdout()).toBe(String(payload.mock.calls[0]![0]));
      expect(io.stderr()).toBe("");
    } finally {
      payload.mockRestore();
    }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-compile-output.test.ts`
Expected: FAIL, `compileBlocks` is not exported.

- [ ] **Step 3: Add the block builders**

In `commands/skills.ts`, add `type Block` to the protocol import (new line): `import type { Block } from "../lib/ui/protocol.ts";`. Then, directly above `export async function skillsCompile`, add:

```ts
export type CompiledRow = { name: string; side: Side; files: number; warnings: string[] };

const countOf = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function compileBlocks(rows: CompiledRow[], writing: boolean): Block[] {
  if (rows.length === 0) return [out.line("skipped", "Nothing to compile", "this pack has no verbs")];
  return rows.flatMap((row) => [
    writing
      ? out.line(row.warnings.length > 0 ? "warn" : "done", `Compiled ${row.name}`, `${countOf(row.files, "file", "files")} in ${row.side}/`)
      : out.line("pending", row.name, `would write ${countOf(row.files, "file", "files")}`),
    // compile.ts writes its surface-internal notes with their own "note: " label.
    ...(row.warnings.length > 0 ? [out.callout("note", ...row.warnings.map((w) => w.replace(/^note: /, "")))] : []),
  ]);
}

export function compileFailure(failures: string[]): out.FailureInput {
  return { title: `${countOf(failures.length, "verb", "verbs")} did not compile`, details: failures.join("\n") };
}

export function misplacedFailure(names: string[]): out.FailureInput {
  return {
    title: names.length === 1 ? `${names[0]} is in the wrong folder` : `${names.length} skills are in the wrong folder`,
    why: "A skill's folder has to match whether it is public or internal.",
    next: out.cmd("rt skills surface apply"),
    ...(names.length > 1 ? { details: names.join("\n") } : {}),
  };
}
```

- [ ] **Step 4: Convert the preview branch**

In `skillsCompile`, directly after the two flag-shape checks (after the `--preview and --json cannot be combined` throw), add:

```ts
    if (flags.preview) out.payloadOnStdout();
```

Replace the failure inside the preview loop (lines 883 to 889):

```ts
        if (!outcome.ok) {
          out.fail({ title: `${verb.name} did not compile, so there is nothing to preview`, details: outcome.message });
          process.exitCode = 1;
          return;
        }
```

and the body write (line 894):

```ts
        out.payload(`${main.content}\n`);
```

Keep the comment above it about the body being the product; replace its words "no summary lines and no warnings interleaved" as they are (it states a constraint).

- [ ] **Step 5: Convert the compile result**

Replace everything from `const { outcomes, failures, misplaced } = performCompile(...)` to the end of the `withCleanErrors` callback (lines 902 to 948) with:

```ts
    const { outcomes, failures, misplaced } = performCompile(resolved, flags.verbs, !flags.dryRun);
    if (failures.length > 0 && !flags.json) {
      out.fail(compileFailure(failures));
      process.exit(1);
    }

    const writing = failures.length === 0 && !flags.dryRun;

    if (flags.json) {
      const rows: CompileVerbRow[] = outcomes.map(({ target, outcome }) => {
        const side: Side = target.isPublic ? "skills" : "attachments";
        return outcome.ok
          ? { name: target.verb.name, status: "compiled", files: outcome.result.files.map((f) => ({ path: f.path })), warnings: outcome.result.warnings, errors: [], side }
          : { name: target.verb.name, status: "errored", files: [], warnings: [], errors: [outcome.message], side };
      });
      // An errored or misplaced verb is a failed compile: exit non-zero so a
      // caller reading the code (not just the payload) sees it, matching the
      // non-JSON path's exits. `written` stays honest on an empty target set.
      if (failures.length > 0 || misplaced.length > 0) process.exitCode = 1;
      const written = writing && outcomes.length > 0;
      out.json({ pack: resolved.team, packDir: resolved.packDir, manifestPath: resolved.manifestPath, repoKey: resolved.repoKey, written, verbs: rows, misplaced });
      return;
    }

    const compiled: CompiledRow[] = outcomes.flatMap(({ target, outcome }) =>
      outcome.ok ? [{ name: target.verb.name, side: target.isPublic ? ("skills" as const) : ("attachments" as const), files: outcome.result.files.length, warnings: outcome.result.warnings }] : [],
    );
    out.print(...compileBlocks(compiled, writing));

    if (misplaced.length > 0) {
      out.fail(misplacedFailure(misplaced));
      process.exitCode = 1;
    }
  });
}
```

The `--json` object is the one line 940 built, key for key; only the writer changed.

- [ ] **Step 6: Run the new tests**

Run: `bun test commands/__tests__/skills-compile-output.test.ts commands/__tests__/skills-json-frozen.test.ts`
Expected: PASS.

- [ ] **Step 7: Update the wording the compile tests pinned**

In `commands/__tests__/skills.test.ts`:

- Lines 288 to 290, 332 to 333 and 351 to 353 read the preview body from `const out = logs.join("\n")` (now `io.lines().join("\n")`). They still pass. Change line 290 to `expect(out).not.toContain("Compiled watch-ci");` and line 353 to `expect(out).not.toContain("wrong folder");`, so each still says the body is alone.
- Line 369: `expect(io.lines().some((l) => l.includes("Compiled watch-ci") && l.includes("3 files"))).toBe(true);`
- Lines 401 and 402 (one verb with an unbound required slot; the message is one line): `expect(errors).toHaveLength(2);` and `expect(errors[0]).toBe("1 verb did not compile");`. The output is the title and the message as its one details line.
- Lines 403 to 405: replace `errors[0]` with `errors.join("\n")` in all three.
- Lines 428 and 429 (Task 3's `filter(...)` count and the prefix pin; two verbs whose `loadStepSource` messages run to several lines each): replace both with `expect(errors[0]).toBe("2 verbs did not compile");`. Lines 430 and 431 stay.
- Lines 274, 538, 553, 565, 729, 1015, 1035 and 1056 match `/would write \d+ files/` and still pass: the dry-run line is `[not yet] watch-ci  would write 3 files`.

In `lib/skills/__tests__/surface.test.ts` (its `logs` reads became `io.lines()` in Task 3):

- Line 324: `expect(io.lines().some((l) => l.includes("Compiled old-verb") && l.endsWith("in attachments/"))).toBe(true);`
- Line 344: the misplaced report is now a failure on stderr: `expect(io.errLines()).toContain("stray-skill is in the wrong folder");`
- Line 402: `expect(io.stderr()).not.toContain("in the wrong folder");` Line 401 stays (no line starts `internal:`).
- Line 489: `expect(io.lines().some((l) => l.endsWith("acme:qa-gates is surface-internal; inlined"))).toBe(true);` and, on the next line, `expect(io.stdout()).not.toContain("note: note:");`
- Line 492: `expect(io.errLines()).toContain("qa-gates is in the wrong folder");`
- Lines 525 to 529 and 564 to 568 (a body reference to an internal skill; one verb, a one-line message): `expect(errors).toHaveLength(2);`, `expect(errors[0]).toBe("1 verb did not compile");`, and the three `toContain` checks read `errors[1]` in place of `errors[0]`.

In `lib/skills/__tests__/compile-native.e2e.test.ts`, the four checks at lines 271, 284, 318 and 319 assert `/0 warnings\)$/` on a `compiled <verb>` line. A verb with no warnings is now the `done` line, so each becomes, for its verb:

```ts
    expect(logs.some((l) => l.startsWith("[ok] Compiled receive-review  "))).toBe(true);
```

(`checkout` at 284 and 319, `stage-plan` at 318). Line 297 stays.

- [ ] **Step 8: Run the affected suites**

Run: `bun test commands/__tests__/skills.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-bind.test.ts commands/__tests__/skills-compile-output.test.ts commands/__tests__/skills-json-frozen.test.ts lib/skills/__tests__/compile-native.e2e.test.ts lib/skills/__tests__/surface.test.ts lib/skills/__tests__/init-compile.e2e.test.ts`
Expected: PASS for every compile test. Tests of `check`, `materialize`, `surface` and `bind` wording still pass, because those verbs still print by hand until Tasks 6 to 8. A surface or bind test that now fails is reading a compile line (bind and `surface apply` end with a compile): match it against Task 2's table and fix it here.

Run: `grep -rn '"rt skills: ' commands/__tests__ lib/skills/__tests__`
Expected: no hits.

- [ ] **Step 9: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills-compile-output.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-bind.test.ts lib/skills/__tests__/surface.test.ts lib/skills/__tests__/compile-native.e2e.test.ts
```

```bash
git commit -m "skills compile: result lines, failures and the preview body go through the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `skills check`, `packs`, `composition` and `materialize`

**Files:**
- Modify: `commands/skills.ts` (lines 1127 to 1204, 1451 to 1543)
- Create: `commands/__tests__/skills-report-output.test.ts`
- Modify: `commands/__tests__/skills.test.ts`, `commands/__tests__/skills-check-strict.test.ts`, `commands/__tests__/skills-compile-source.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.json`, `out.line`, `out.callout`, `out.kv`, `out.table`, `out.tree`, `out.section`, `out.verbatim`, `out.cmd`, `out.strong`, `out.dim`; `countOf` (Task 5, same file); `CheckPayload`, `InstalledInfo` (same file); `formatHit` (`lib/skills/mcp-lint.ts`); `MaterializeSkillsResult`, `setAsideLine` (`lib/setup/skills-materialize.ts`).
- Produces, exported from `commands/skills.ts`:
  - `function installedCacheBlocks(installed: InstalledInfo): Block[]` (replaces `installedCacheLine`, which is deleted)
  - `function checkBlocks(payload: CheckPayload, strictFlag: boolean): Block[]`
  - `function packsBlocks(rows: Array<{ name: string; dir: string; layout: string }>): Block[]`
  - `type CompositionPayload` (now exported) and `function compositionBlocks(payload: CompositionPayload): Block[]`
  - `function materializeBlocks(result: MaterializeSkillsResult): Block[]`

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/skills-report-output.test.ts`:

```ts
import { expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { checkBlocks, compositionBlocks, installedCacheBlocks, materializeBlocks, packsBlocks, type CheckPayload, type CompositionPayload } from "../skills.ts";

const base: CheckPayload = { pack: "acme", packDir: "/p", verbs: [], chainErrors: [], installed: null, drift: false, mcpLint: [], scriptLint: [], strictLint: false };

test("check lists each verb, names what moved, and gives the fix once", () => {
  const payload: CheckPayload = {
    ...base,
    drift: true,
    verbs: [
      { name: "watch-ci", status: "in-sync", staleFiles: [], orphanFiles: [], side: "skills" },
      { name: "ship", status: "stale", staleFiles: ["SKILL.md"], orphanFiles: ["old.md"], side: "skills", staleBecause: ["source", "fill"] },
      { name: "plan", status: "stale", staleFiles: ["SKILL.md"], orphanFiles: [], side: "skills" },
      { name: "review", status: "never-compiled", staleFiles: [], orphanFiles: [], side: "attachments" },
    ],
    installed: { plugin: "acme", marketplace: "beacon", version: "0.5.2", sourceVersion: "0.5.3", status: "lagging" },
  };
  expect(renderPlain(checkBlocks(payload, false))).toBe(
    [
      "[ok] watch-ci  current",
      "[out of date] ship  source, fill moved: SKILL.md, old.md (orphan)",
      "[out of date] plan  changed since the last compile: SKILL.md",
      "[out of date] review  never compiled",
      "  next: rt skills compile",
      "[out of date] The installed copy is behind the source  0.5.2 installed, 0.5.3 in the source",
      "  next: rt skills sync",
      "[ok] mcp lint  clean",
      "",
    ].join("\n"),
  );
});

test("a chain error is a failed line", () => {
  expect(renderPlain(checkBlocks({ ...base, chainErrors: ['stage "stage-ship" consumes "commits" that no earlier stage produces'] }, false))).toBe(
    '[failed] stage "stage-ship" consumes "commits" that no earlier stage produces\n[ok] mcp lint  clean\n',
  );
});

test("a hostile verb name cannot forge a status row", () => {
  const text = renderPlain(checkBlocks({ ...base, verbs: [{ name: "x\n[ok] forged", status: "never-compiled", staleFiles: [], orphanFiles: [], side: "skills" }] }, false));
  expect(text.split("\n").some((l) => l.startsWith("[ok] forged"))).toBe(false);
  expect(text).toContain("[out of date] x [ok] forged  never compiled\n");
});

test("a pack that is not installed here is pending, not failed", () => {
  expect(renderPlain(installedCacheBlocks({ plugin: "acme", marketplace: "beacon", version: null, sourceVersion: "0.5.3", status: "missing" }))).toBe(
    "[not yet] This pack is not installed here  acme@beacon\n  next: rt skills sync\n",
  );
  expect(installedCacheBlocks({ plugin: "acme", marketplace: "beacon", version: "0.5.3", sourceVersion: "0.5.3", status: "current" })).toEqual([]);
});

test("no packs is a line and a note", () => {
  expect(renderPlain(packsBlocks([]))).toBe("[not yet] No packs found\n  note: A pack is a plugin from a directory marketplace that has a surface file.\n");
});

test("packs are a table that carries each folder", () => {
  expect(renderPlain(packsBlocks([{ name: "acme", dir: "/z/packs/acme", layout: "team" }]))).toBe("Pack  Layout  Folder\nacme  team    /z/packs/acme\n");
});

test("composition is one tree per verb, with engine errors as failed lines", () => {
  const slot = { contract: "c@1", required: true, fillSourcePath: null, fillVersion: null, registered: null, inlined: null };
  const payload: CompositionPayload = {
    pack: "acme",
    packDir: "/p",
    manifestPath: null,
    verbs: [
      {
        name: "watch-ci",
        engine: "watch-ci",
        engineRef: "mattstack:watch-ci",
        plugin: "mattstack",
        description: "Watch CI",
        public: true,
        sourcePath: null,
        artifactPath: "/p/skills/watch-ci",
        includes: [],
        slots: [
          { ...slot, name: "domain", boundTo: "acme:watch-ci-domain", layer: "team" },
          { ...slot, name: "forge", boundTo: null, layer: null },
        ],
      },
      { name: "ship", engine: "ship", engineRef: null, plugin: null, description: "Ship", public: false, sourcePath: null, artifactPath: "/p/attachments/ship", includes: [], slots: [], engineError: "engine not found" },
    ],
    fills: [],
    binders: [],
    pipelines: {},
  };
  expect(renderPlain(compositionBlocks(payload))).toBe(
    ["Pack acme", "watch-ci  mattstack:watch-ci, public", "  - domain  acme:watch-ci-domain  team", "  - forge   not bound", "[failed] ship  engine not found", "Fills: 0", "Binders: 0", ""].join("\n"),
  );
});

test("materialize rows: written, nothing declared, failed, and a skip", () => {
  expect(
    renderPlain(
      materializeBlocks({
        skipped: false,
        repos: [
          { name: "widgets", path: "/r/widgets", ok: true, detail: "wrote 1 pack file", migrated: "/h/widgets/skills.jsonc.migrated", pruned: ["/h/widgets/old.stale"] },
          { name: "gadgets", path: "/r/gadgets", ok: false, noManifest: true, detail: "no team declares gitlab.example.com/acme/gadgets" },
          { name: "sprockets", path: "/r/sprockets", ok: false, detail: "EACCES: permission denied" },
        ],
      } as Parameters<typeof materializeBlocks>[0]),
    ),
  ).toBe(
    [
      "[ok] widgets  wrote 1 pack file",
      "  note: Renamed the old merged file to /h/widgets/skills.jsonc.migrated",
      "  note: set aside 1 stale bindings file: /h/widgets/old.stale",
      "[skipped] gadgets  no team declares gitlab.example.com/acme/gadgets",
      "[failed] sprockets  EACCES: permission denied",
      "",
    ].join("\n"),
  );
  expect(renderPlain(materializeBlocks({ skipped: true, reason: "engine-pack-missing: install the mattstack plugin first", repos: [] }))).toBe(
    "[skipped] Nothing was written  engine-pack-missing: install the mattstack plugin first\n",
  );
});
```

The `as Parameters<typeof materializeBlocks>[0]` cast is there because a repo row has more optional fields than the test fills; if the type rejects a field name used above, read `MaterializeRepoResult` in `lib/setup/skills-materialize.ts` and use its names (the function under test reads only `name`, `ok`, `noManifest`, `detail`, `migrated` and `pruned`).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-report-output.test.ts`
Expected: FAIL, `checkBlocks` is not exported.

- [ ] **Step 3: Replace `installedCacheLine` and convert `skillsCheck`**

In `commands/skills.ts`, replace `installedCacheLine` (lines 1127 to 1135) with:

```ts
export function installedCacheBlocks(installed: InstalledInfo): Block[] {
  const next = out.callout("next", out.cmd("rt skills sync"));
  if (installed.status === "lagging") {
    return [out.line("stale", "The installed copy is behind the source", `${installed.version} installed, ${installed.sourceVersion} in the source`), next];
  }
  if (installed.status === "missing") {
    return [out.line("pending", "This pack is not installed here", `${installed.plugin}@${installed.marketplace}`), next];
  }
  return [];
}

export function checkBlocks(payload: CheckPayload, strictFlag: boolean): Block[] {
  const blocks: Block[] = payload.chainErrors.map((chainError) => out.line("failed", chainError));
  let stale = false;
  for (const row of payload.verbs) {
    if (row.status === "never-compiled") {
      stale = true;
      blocks.push(out.line("stale", row.name, "never compiled"));
    } else if (row.status === "stale") {
      stale = true;
      const files = [...row.staleFiles, ...row.orphanFiles.map((f) => `${f} (orphan)`)].join(", ");
      const causes = row.staleBecause ?? [];
      blocks.push(out.line("stale", row.name, causes.length > 0 ? `${causes.join(", ")} moved: ${files}` : `changed since the last compile: ${files}`));
    } else {
      blocks.push(out.line("done", row.name, "current"));
    }
  }
  if (stale) blocks.push(out.callout("next", out.cmd("rt skills compile")));
  if (payload.installed) blocks.push(...installedCacheBlocks(payload.installed));

  if (payload.mcpLint.length === 0) {
    blocks.push(out.line("done", "mcp lint", "clean"));
  } else {
    const policy = payload.strictLint
      ? "this pack is strict, so they fail a strict check and the sync"
      : strictFlag
        ? "they fail a strict check"
        : "advisory; they fail a strict check";
    blocks.push(out.verbatim(payload.mcpLint.map(formatHit), "mcp lint"));
    blocks.push(out.line(strictFlag ? "failed" : "warn", `mcp lint: ${countOf(payload.mcpLint.length, "hit", "hits")}`, policy));
  }
  if (payload.scriptLint.length > 0) {
    blocks.push(out.verbatim(payload.scriptLint.map(formatHit), "pack scripts, advisory"));
    blocks.push(out.line("warn", `pack scripts: ${countOf(payload.scriptLint.length, "hit", "hits")}`, "advisory"));
  }
  return blocks;
}
```

Replace the body of `skillsCheck`'s callback (lines 1139 to 1176) with:

```ts
    const flags = parseFlags(args);
    const payload = await computeCheck(flags);

    if (payload.drift) process.exitCode = 1;
    if (flags.strict && payload.mcpLint.length > 0) process.exitCode = 1;

    if (flags.json) {
      const { pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint } = payload;
      out.json({ pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint });
      return;
    }
    out.print(...checkBlocks(payload, flags.strict));
```

- [ ] **Step 4: Convert `skillsPacks`**

Above `skillsPacks`, add:

```ts
export function packsBlocks(rows: Array<{ name: string; dir: string; layout: string }>): Block[] {
  if (rows.length === 0) {
    return [out.line("pending", "No packs found"), out.callout("note", "A pack is a plugin from a directory marketplace that has a surface file.")];
  }
  return [out.table(rows.map((row) => [out.strong(row.name), row.layout, out.dim(row.dir)]), ["Pack", "Layout", "Folder"])];
}
```

and replace lines 1194 to 1203 (from `if (json) {` to the end of the function body) with:

```ts
  if (json) {
    out.json({ packs: rows });
    return;
  }
  out.print(...packsBlocks(rows));
```

- [ ] **Step 5: Convert `skillsComposition`**

Change `type CompositionPayload = {` (line 1249) to `export type CompositionPayload = {`. Above `skillsComposition`, add:

```ts
export function compositionBlocks(payload: CompositionPayload): Block[] {
  const verbs = payload.verbs.map((verb) =>
    verb.engineError
      ? out.line("failed", verb.name, verb.engineError)
      : out.tree(
          [out.strong(verb.name), "  ", out.dim(`${verb.engineRef ?? verb.engine}, ${verb.public ? "public" : "internal"}`)],
          verb.slots.map((slot) => {
            const bound = slot.resolveError ? `error: ${slot.resolveError}` : (slot.boundTo ?? "not bound");
            return slot.layer ? [slot.name, bound, out.dim(slot.layer)] : [slot.name, bound];
          }),
        ),
  );
  return [out.section(`Pack ${payload.pack}`, undefined, ...verbs), out.kv("Fills", String(payload.fills.length)), out.kv("Binders", String(payload.binders.length))];
}
```

and replace lines 1478 to 1497 (from `if (flags.json) {` to the fills line) with:

```ts
    if (flags.json) {
      out.json(payload);
      return;
    }
    out.print(...compositionBlocks(payload));
```

- [ ] **Step 6: Convert `skillsMaterialize`**

Above `skillsMaterialize`, add:

```ts
export function materializeBlocks(result: MaterializeSkillsResult): Block[] {
  if (result.skipped) return [out.line("skipped", "Nothing was written", result.reason)];
  return result.repos.flatMap((r) => [
    out.line(r.ok ? "done" : r.noManifest ? "skipped" : "failed", r.name, r.detail),
    ...(r.migrated ? [out.callout("note", ["Renamed the old merged file to ", out.dim(r.migrated)])] : []),
    ...(r.pruned?.length ? [out.callout("note", `${setAsideLine(r.pruned.length)}: ${r.pruned.join(", ")}`)] : []),
  ]);
}
```

and replace the `try` block's body (lines 1524 to 1537) with:

```ts
    const result = await materializeSkills(createRealProbes(), { repo, dir });
    if (json) out.json(envelope(result));
    else out.print(...materializeBlocks(result));
    const code = materializeExitCode(result, dir !== undefined);
    if (code !== 0) process.exitCode = code;
```

and the catch's first line with:

```ts
    if (err instanceof UserActionableError) exitUserError(err, json, "skills materialize");
```

`exitUserError` without a `print` writes the payload through `out.json`, which is `JSON.stringify(payload) + "\n"`: the bytes `console.log` wrote.

- [ ] **Step 7: Run the new tests**

Run: `bun test commands/__tests__/skills-report-output.test.ts commands/__tests__/skills-json-frozen.test.ts`
Expected: PASS.

- [ ] **Step 8: Update the tests that pinned the old wording**

In `commands/__tests__/skills.test.ts`:

- Line 6: drop `installedCacheLine` from the import. Lines 1523 to 1538 (`describe("installedCacheLine", ...)`): delete the block; `skills-report-output.test.ts` covers `installedCacheBlocks`.
- Lines 1250 to 1251: `expect(io.lines()).toContain("[ok] watch-ci  current");` and `expect(io.lines().some((l) => l.includes("[out of date]"))).toBe(false);`
- Line 1274: stays (`[failed] stage "stage-ship" consumes "commits"...` contains the asserted text).
- Lines 1303, 1334, 1385 and 1456: `const staleLine = io.lines().find((l) => l.includes("[out of date]"));` The assertions under each (`toContain("watch-ci")`, `toContain("SKILL.md")`, `toContain("leftover.txt")`) stay.
- Line 1368: `expect(io.lines()).toContain("[ok] watch-ci  current");`
- Line 2295 and 2304: stay (the detail is the line's hint).
- Line 2310: `expect(io.lines().join("\n")).toContain("[skipped] Nothing was written  engine-pack-missing");`
- Line 2320: ``expect(io.lines()).toContain(`  note: Renamed the old merged file to ${legacy}.migrated`);``
- Line 2331: ``expect(io.lines()).toContain(`  note: set aside 1 stale bindings file: ${stale}.stale`);``

In `commands/__tests__/skills-check-strict.test.ts`, replace `runCheck` (lines 19 to 30) with:

```ts
async function runCheck(args: string[]): Promise<{ exitCode: number; logs: string[] }> {
  const io = captureSkills();
  process.exitCode = 0;
  try {
    await skillsCheck(args);
    return { exitCode: Number(process.exitCode ?? 0), logs: io.lines() };
  } finally {
    io.restore();
    process.exitCode = 0;
  }
}
```

with `import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";` added and `spyOn` dropped from the `bun:test` import. Then the five pinned lines:

- `"mcp lint: 1 hits (--strict fails on them)"` becomes `"[failed] mcp lint: 1 hit  they fail a strict check"`.
- `"mcp lint: 1 hits (advisory; --strict fails on them)"` becomes `"[warning] mcp lint: 1 hit  advisory; they fail a strict check"`.
- `"mcp lint: 1 hits (strict: --strict and rt skills sync fail on them)"` without the flag becomes `"[warning] mcp lint: 1 hit  this pack is strict, so they fail a strict check and the sync"`.
- The same string with `--strict` becomes `"[failed] mcp lint: 1 hit  this pack is strict, so they fail a strict check and the sync"`.
- `logs.some((l) => l.startsWith("mcp lint (pack scripts, advisory): 1 hit"))` becomes `expect(logs).toContain("[warning] pack scripts: 1 hit  advisory");`, and `expect(logs).toContain("mcp lint: clean");` becomes `expect(logs).toContain("[ok] mcp lint  clean");`.

In `commands/__tests__/skills-compile-source.test.ts`, the `logSpy = spyOn(console, "log").mockImplementation(() => {});` at line 49 only silenced output. Replace it with `io = captureSkills();`, its `mockRestore()` with `io.restore();`, and its declaration with `let io: CapturedOut;`, with the same two imports the other files gained in Task 3.

- [ ] **Step 9: Run the affected suites**

Run: `bun test commands/__tests__/skills.test.ts commands/__tests__/skills-check-strict.test.ts commands/__tests__/skills-compile-source.test.ts commands/__tests__/skills-report-output.test.ts commands/__tests__/skills-json-frozen.test.ts commands/__tests__/skills-audit.test.ts commands/__tests__/skills-sync.test.ts lib/skills/__tests__/compile-native.e2e.test.ts lib/skills/__tests__/surface.test.ts lib/skills/__tests__/init-compile.e2e.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills-report-output.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-check-strict.test.ts commands/__tests__/skills-compile-source.test.ts
```

```bash
git commit -m "skills check, packs, composition and materialize print blocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `skills surface`

**Files:**
- Modify: `commands/skills.ts` (line 31, lines 1667 to 1669, 1760, 1763 to 2027, 2045, 2091)
- Modify: `commands/__tests__/skills-surface.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.json`, `out.line`, `out.section`, `out.table`, `out.changes`, `out.callout`, `out.cmd`, `out.strong`, `out.dim`; `confirm(opts: { message: string; initialValue?: boolean; stderr?: boolean; destructive?: boolean }): Promise<boolean>` (`lib/ui/prompts.ts`); `SurfaceRow`, `SurfaceFlags`, `SurfaceDelta`, `kindLabel` (same file).
- Produces, exported from `commands/skills.ts`: `function surfaceBlocks(team: string | null, source: string, rows: SurfaceRow[]): Block[]` and `type SurfaceRow` (now exported).

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/skills-surface.test.ts`, add to the imports `import { renderPlain } from "../../lib/ui/out-plain.ts";` and `import * as prompts from "../../lib/ui/prompts.ts";`, add `surfaceBlocks` to the `../skills.ts` import, and add:

```ts
describe("surfaceBlocks", () => {
  test("rows are a table under the pack's name and where the list came from", () => {
    expect(
      renderPlain(
        surfaceBlocks("acme", "pack/surface.jsonc", [
          { name: "watch-ci", kind: "compiled", status: "public" },
          { name: "helper", kind: "missing", status: "internal" },
        ]),
      ),
    ).toBe(["Pack acme (pack/surface.jsonc)", "Skill     Surface   Kind", "watch-ci  public    compiled", "helper    internal  (no files on disk)", ""].join("\n"));
  });

  test("an empty pack says so", () => {
    expect(renderPlain(surfaceBlocks("acme", "pack/surface.jsonc", []))).toBe("[not yet] No skills are registered in this pack\n");
  });
});
```

Replace `withPaletteTTY` (lines 15 to 30) with a version that answers the rt-ui confirm in place of feeding `readline`:

```ts
/**
 * The palette needs process.stdin.isTTY to reach the picker branch at all,
 * and it asks one yes or no question once a delta exists; the answer is
 * given through the prompt module so no helper is spawned.
 */
function withPaletteTTY<T>(answer: string, fn: () => Promise<T>): Promise<T> {
  const previousStdin = process.stdin;
  const fakeStdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
  Object.defineProperty(fakeStdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });
  const confirm = spyOn(prompts, "confirm").mockResolvedValue(answer === "y");
  return fn().finally(() => {
    confirm.mockRestore();
    Object.defineProperty(process, "stdin", { value: previousStdin, configurable: true });
  });
}
```

Keep `spyOn` in the `bun:test` import for it.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-surface.test.ts`
Expected: FAIL, `surfaceBlocks` is not exported; the two palette tests that answer `y` hang or fail because `readline` gets no answer (the fake stdin no longer carries one).

- [ ] **Step 3: Convert the list**

In `commands/skills.ts`, change `type SurfaceRow =` (line 1556) to `export type SurfaceRow =`. In `computeRows`, replace the fallback source string (line 1669) with:

```ts
    : "no surface file yet, worked out from where each skill sits";
```

Replace `printSurfaceRows` (lines 1763 to 1769) with:

```ts
export function surfaceBlocks(team: string | null, source: string, rows: SurfaceRow[]): Block[] {
  if (rows.length === 0) return [out.line("pending", "No skills are registered in this pack")];
  return [out.section(`Pack ${team ?? ""}`.trim(), source, out.table(rows.map((row) => [out.strong(row.name), row.status, out.dim(kindLabel(row.kind))]), ["Skill", "Surface", "Kind"]))];
}
```

In `runList`, replace lines 1778 to 1785 with:

```ts
  if (flags.json) {
    out.json({ pack: flags.team, packDir, rows });
    return;
  }
  out.print(...surfaceBlocks(flags.team, source, rows));
```

- [ ] **Step 4: Convert apply and set**

In `runApply`, replace the two move prints (lines 1815 to 1821):

```ts
    if (flags.dryRun) {
      if (!flags.json) out.print(out.line("pending", name, `would move ${route}`));
      continue;
    }

    const note = moveHandAuthoredDir(packDir, move);
    if (!flags.json) out.print(out.line("done", name, `moved ${route}${note ? ` (${note})` : ""}`));
```

the recorded print (lines 1834 to 1838):

```ts
    if (!flags.json) {
      out.print(out.line("pending", name, flags.dryRun ? "would be recorded; written to skills/ on the next compile" : "recorded; written to skills/ on the next compile"));
    }
```

and line 1841:

```ts
  if (!flags.json && moved.length === 0 && recorded.length === 0) out.print(out.line("skipped", "Nothing needs to move"));
```

Each move prints as it happens, one call per line, so a move that throws halfway leaves the earlier lines on screen.

In `moveHandAuthoredDir`, the note it returns (line 1760) becomes:

```ts
  return "this pack is not a git repo, so no git history follows it";
```

In `runSet`, replace line 1895 and the `--json` write below it (lines 1895 to 1907):

```ts
  if (!flags.json) out.print(...names.map((name) => out.line("done", name, want)));

  const result = await runApply(flags);
  if (flags.json) {
    out.json({
      ok: result.compileErrors.length === 0,
      dryRun: flags.dryRun,
      set: names.map((name) => ({ name, want })),
      moved: result.moved,
      recorded: result.recorded,
      compileErrors: result.compileErrors,
    });
  }
```

In `skillsSurface`, the apply envelope (line 2045) becomes `out.json({ ok: result.compileErrors.length === 0, dryRun: flags.dryRun, moved: result.moved, recorded: result.recorded, compileErrors: result.compileErrors });` and the no-mode envelope (line 2091) becomes `out.json({ ok: false, error: "rt skills surface --json needs a mode: list, set <name...> --public|--internal, or apply" });`.

- [ ] **Step 5: Convert the palette**

Delete `import { createInterface } from "node:readline";` (line 31) and the whole `confirmYesNo` function (lines 1953 to 1961). Replace `printDelta` (lines 1947 to 1951) with:

```ts
function deltaBlock(delta: SurfaceDelta): Block {
  return out.changes([
    ...delta.toPublic.map((name) => ({ op: "+" as const, name, hint: "becomes public" })),
    ...delta.toInternal.map((name) => ({ op: "-" as const, name, hint: "becomes internal" })),
  ]);
}
```

In `runPalette`:

- Lines 1972 to 1975 (no rows): `out.print(...surfaceBlocks(flags.team, source, rows)); return;`
- Lines 1977 to 1982 (no terminal):

```ts
  if (!process.stdin.isTTY) {
    out.print(...surfaceBlocks(flags.team, source, rows), out.callout("next", [out.cmd("rt skills surface set <name> --public"), " (or ", out.cmd("--internal"), ")"]));
    return;
  }
```

- Line 2010: `out.print(out.line("skipped", "No changes"));`
- Lines 2014 to 2016:

```ts
  out.print(deltaBlock(preview.delta));
  const { confirm } = await import("../lib/ui/prompts.ts");
  const confirmed = await confirm({ message: "Apply these changes?", initialValue: false });
  const decision = decidePaletteAction(previousPublic, resultRows, confirmed);
```

- Line 2019: `out.print(out.line("skipped", "No changes made"));`
- Line 2024: `out.print(out.line("done", "Saved which skills are public", `${selectedSet.size} public`));`

- [ ] **Step 6: Update the wording the surface tests pinned**

In `commands/__tests__/skills-surface.test.ts`:

- Line 482: stays (`[not yet] my-attach  would move ...` contains both words).
- Line 495: `expect(io.lines().some((l) => l.includes("Nothing needs to move"))).toBe(true);`
- Lines 540 and 593: `expect(io.lines().join("\n")).toContain("[not yet] stage-plan  recorded; written to skills/ on the next compile");`
- Line 558: `expect(io.lines().join("\n")).not.toContain("stage-plan  recorded");`
- Line 607: `expect(io.lines().join("\n")).toContain("[not yet] stage-plan  would be recorded; written to skills/ on the next compile");`
- Line 680: `expect(io.lines().some((l) => l.includes("No skills are registered"))).toBe(true);`
- Line 721: `expect(io.lines().join("\n")).toContain("[skipped] No changes");`
- Line 940: `expect(io.lines().join("\n")).toContain("[ok] checkout  moved attachments/forge/ -> skills/forge/");`
- Line 1067: `expect(io.lines().join("\n")).toContain("[ok] helper  moved plugin/skills/ -> attachments/");`
- Line 1078: `expect(io.lines().join("\n")).toContain("[not yet] helper  would move plugin/skills/ -> attachments/");`
- Line 177: `expect(out).toContain("no surface file yet");` (the fallback source, now the section's subtitle).
- Lines 178 to 180: the row is now name, surface, kind, in that order: `expect(out).toMatch(/hand-authored-public +public +hand-authored/);`, `expect(out).toMatch(/hand-authored-internal +internal +hand-authored/);`, `expect(out).toMatch(/my-verb +public +compiled/);`
- Line 193: `expect(out).toMatch(/still-under-skills +internal/);` (line 192, `pack/surface.jsonc`, stays: it is the subtitle).
- Lines 575 and 576: `const recordedLines = io.lines().filter((l) => l.includes("recorded; written to"));` and `expect(recordedLines).toEqual(["[not yet] stage-plan  recorded; written to skills/ on the next compile"]);`
- Line 655: `expect(out).toContain("next: rt skills surface set <name> --public (or --internal)");`
- Lines 741 and 742: `expect(out).toContain("+ b  becomes public");` and `expect(out).toContain("- a  becomes internal");`
- Lines 758 and 759: `expect(out).toContain("- a  becomes internal");` and `expect(out).toContain("- b  becomes internal");`
- Lines 919 to 922: `expect(joined).toContain("Pack mattstack (surface.jsonc)");`, then `expect(joined).toMatch(/subagent-review-loop +public +hand-authored/);` and `expect(joined).toMatch(/checkout +internal +hand-authored/);` (the old line 920, `source: surface.jsonc`, is folded into the first).
- Lines 962, 995, 1014, 1033 and 1052: `/public {3}hand-authored {2}<name>/` becomes `/<name> +public +hand-authored/` for the same name (`editing-skills` at 962, `inside` at the other four).
- Lines 297 and 374 (`not a git repo`, present and absent) stay: the move note still says it.

Then run `grep -n "inferred from\|no surface.jsonc\|rt skills surface --\|source: \|public {3}\|+ public\|- public" commands/__tests__/skills-surface.test.ts`; any hit left is an old row or header this step missed, and takes the same treatment.

- [ ] **Step 7: Run the suites**

Run: `bun test commands/__tests__/skills-surface.test.ts commands/__tests__/skills-json-frozen.test.ts lib/skills/__tests__/surface.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills-surface.test.ts
```

```bash
git commit -m "skills surface: rows, moves and the palette's question go through the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `skills bind`, and `commands/skills.ts` leaves the allowlist

**Files:**
- Modify: `commands/skills.ts` (lines 2289, 2431 to 2506)
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/skills-bind.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.note`, `out.json`, `out.line`, `out.callout`, `out.cmd`, `out.dim`; `BindOutcome` (same file).
- Produces, exported from `commands/skills.ts`: `function bindBlocks(b: { verb: string; slot: string; from: string; to: string; dryRun: boolean; fragmentUpdated: string | null; basePack: string | null }): Block[]` and `function shadowWarning(verb: string, slot: string, layer: string): Block`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/skills-bind.test.ts`, add `import { renderPlain } from "../../lib/ui/out-plain.ts";`, add `bindBlocks` to the `../skills.ts` import, and add:

```ts
describe("bindBlocks", () => {
  const bind = { verb: "stage-plan", slot: "domain", from: "(unbound)", to: "acme:plan-policy", dryRun: false, fragmentUpdated: null, basePack: null };

  test("a bind is one line: the slot, then what it was and what it is", () => {
    expect(renderPlain(bindBlocks(bind))).toBe("[ok] stage-plan.domain  (unbound) -> acme:plan-policy\n");
  });

  test("a dry run is pending", () => {
    expect(renderPlain(bindBlocks({ ...bind, dryRun: true }))).toBe("[not yet] stage-plan.domain  (unbound) -> acme:plan-policy\n");
  });

  test("the pack's own bindings file and a base pack each add a note", () => {
    expect(renderPlain(bindBlocks({ ...bind, fragmentUpdated: "/z/packs/acme/pack/skills.jsonc", basePack: "acme-base" }))).toBe(
      [
        "[ok] stage-plan.domain  (unbound) -> acme:plan-policy",
        "  note: Also saved in the pack's own bindings file: /z/packs/acme/pack/skills.jsonc",
        "  note: acme-base is a base pack. Packs that extend it pick this up once it is published and their bindings are rebuilt.",
        "",
      ].join("\n"),
    );
  });
});
```

and two tests for the notes. The first goes directly after the test `a fragment symlinked outside the pack is skipped, with a warning, and the outside file is untouched` (line 746), inside the same `describe`, so it can use `fixtureWithFragment`; it is that test's arrangement with `--json` added:

```ts
  test("a bind note under --json keeps stdout to one envelope", async () => {
    const { pack, ms, manifest, root } = fixtureWithFragment(`// acme fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    const fragmentPath = join(pack, "pack", "skills.jsonc");
    const outsidePath = join(root, "outside-fragment.jsonc");
    writeFile(outsidePath, `// outside fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    rmSync(fragmentPath);
    symlinkSync(outsidePath, fragmentPath);
    io.clear();

    await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--json", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);

    expect(io.lines()).toHaveLength(1);
    expect(typeof JSON.parse(io.lines()[0]!).ok).toBe("boolean");
    expect(io.errLines()).toEqual([`[warning] The pack's bindings file points outside the pack, so it was left alone  ${fragmentPath}`]);
  });
```

The second goes in `describe("bindBlocks", ...)` and needs `shadowWarning` added to the `../skills.ts` import and `import * as ui from "../../lib/ui/out.ts";`:

```ts
  test("a shadowed bind under --json keeps stdout to one envelope", () => {
    io.clear();
    ui.note(shadowWarning("watch-ci", "domain", "override"));
    expect(io.stdout()).toBe("");
    expect(io.errLines()).toEqual(["[warning] watch-ci.domain is still decided by the override layer  your change is saved, but that layer wins"]);
  });
```

A bind that another layer shadows needs a real materialize run to reach through `skillsBind`, so the warning is pinned as the block `skillsBind` hands to `out.note`, and the end-to-end case is the outside-fragment note above.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-bind.test.ts`
Expected: FAIL, `bindBlocks` is not exported.

- [ ] **Step 3: Convert `applyBind`'s note and the bind output**

In `applyBind`, replace line 2289:

```ts
    out.note(out.line("warn", "The pack's bindings file points outside the pack, so it was left alone", fragmentPath));
```

Above `skillsBind`, add:

```ts
export function bindBlocks(b: { verb: string; slot: string; from: string; to: string; dryRun: boolean; fragmentUpdated: string | null; basePack: string | null }): Block[] {
  return [
    out.line(b.dryRun ? "pending" : "done", `${b.verb}.${b.slot}`, `${b.from} -> ${b.to}`),
    ...(b.fragmentUpdated ? [out.callout("note", ["Also saved in the pack's own bindings file: ", out.dim(b.fragmentUpdated)])] : []),
    ...(b.basePack ? [out.callout("note", `${b.basePack} is a base pack. Packs that extend it pick this up once it is published and their bindings are rebuilt.`)] : []),
  ];
}

export function shadowWarning(verb: string, slot: string, layer: string): Block {
  return out.line("warn", `${verb}.${slot} is still decided by the ${layer} layer`, "your change is saved, but that layer wins");
}
```

In `skillsBind`, delete the line `const summary = ...` (2430) and add in its place:

```ts
    const bound = { verb: verbName, slot: slotName, from: oldValue, to: fill, dryRun: bindFlags.dryRun, fragmentUpdated: null as string | null, basePack: null as string | null };
```

Replace the dry-run branch (lines 2432 to 2436):

```ts
    if (bindFlags.dryRun) {
      if (bindFlags.json) out.json({ ok: true, dryRun: true, verb: verbName, slot: slotName, from: oldValue, to: fill });
      else out.print(...bindBlocks(bound));
      return;
    }
```

the base-pack branch (lines 2448 to 2456):

```ts
    if (resolved.base) {
      if (bindFlags.json) {
        out.json({ ok: true, verb: verbName, slot: slotName, from: oldValue, to: fill, fragmentUpdated, shadowedBy, base: true });
        return;
      }
      out.print(...bindBlocks({ ...bound, basePack: resolved.team }));
      return;
    }
```

the not-regenerated branch (lines 2458 to 2468):

```ts
    if (regenerated === false) {
      process.exitCode = 1;
      if (bindFlags.json) {
        out.json({ ok: false, verb: verbName, slot: slotName, from: oldValue, to: fill, fragmentUpdated, shadowedBy, regenerated, regenerateDetail });
        return;
      }
      out.print(...bindBlocks({ ...bound, fragmentUpdated }));
      out.fail({ title: "The bindings file was not rebuilt, so nothing was recompiled", ...(regenerateDetail ? { why: regenerateDetail } : {}), next: out.cmd("rt skills materialize") });
      return;
    }
```

the shadow warning (lines 2469 to 2471):

```ts
    if (shadowedBy) out.note(shadowWarning(verbName, slotName, shadowedBy));
```

the `--json` write at line 2490 (`console.log(JSON.stringify({` becomes `out.json({`, and its closing `}));` becomes `});`), and line 2505:

```ts
    out.print(...bindBlocks({ ...bound, fragmentUpdated }));
```

The base-pack branch today prints the summary without the fragment path; `bindBlocks({ ...bound, basePack })` keeps that.

- [ ] **Step 4: Delete the allowlist line**

Run: `grep -n "console\.\(log\|error\|warn\|info\)\|process\.std\(out\|err\)" commands/skills.ts`
Expected: only uses the guard allows (`process.stdin.isTTY` is not matched by that pattern at all; a hit on `process.stdout` or `process.stderr` means a site was missed).

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "commands/skills.ts",`.

Run: `bun test lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the wording the bind tests pinned**

In `commands/__tests__/skills-bind.test.ts`:

- Line 380: the expected string becomes `"  note: acme-base is a base pack. Packs that extend it pick this up once it is published and their bindings are rebuilt."`.
- Line 516: stays (the line holds both fill names).
- Line 586: `expect(io.lines()).toContain("[not yet] stage-plan.domain  (unbound) -> acme:plan-policy");`
- Line 642: `expect(io.lines()).toContain("[not yet] stage-plan.domain  (unbound) -> acme:watch-ci-domain-v1");`
- Line 695: `expect(io.lines()).toContain("[ok] stage-plan.domain  acme:plan-policy -> acme:plan-policy-v2");`
- Line 724: ``expect(io.lines().some((l) => l.includes(`bindings file: ${fragmentPath}`))).toBe(true);``
- Line 735: `expect(io.lines().some((l) => l.includes("pack's own bindings file"))).toBe(false);`
- Lines 766 to 768: stay (`[warning] The pack's bindings file points outside the pack, so it was left alone  <path>` holds the path and "outside the pack").
- Lines 881 to 882: `expect(errors[0]).toBe("The bindings file was not rebuilt, so nothing was recompiled");`, `expect(errors.join("\n")).toContain("engine-pack-missing");` and `expect(errors.join("\n")).toContain("rt skills materialize");`.

- [ ] **Step 6: Run the suites**

Run: `bun test commands/__tests__/skills-bind.test.ts commands/__tests__/skills.test.ts commands/__tests__/skills-surface.test.ts commands/__tests__/skills-json-frozen.test.ts lib/__tests__/no-raw-output.test.ts lib/skills/__tests__/compile-native.e2e.test.ts lib/skills/__tests__/surface.test.ts lib/skills/__tests__/init-compile.e2e.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add commands/skills.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/skills-bind.test.ts
```

```bash
git commit -m "skills bind prints blocks, and commands/skills.ts leaves the raw-output allowlist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `skills audit` and `skills expand`

**Files:**
- Modify: `commands/skills-audit.ts`, `commands/skills-expand.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/skills-audit.test.ts`, `commands/__tests__/skills-expand.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.note`, `out.json`, `out.line`, `out.section`, `out.paragraph`, `out.verbatim`, `out.changes`, `out.cmd`, `FailureInput`; `usageFailure` (5a); `SkillsUsageError`, `skillsFailure`, `checkPack`, `CheckPayload` (`commands/skills.ts`, Task 4); `captureSkills`, `runExpectingCleanExit` (Task 3).
- Produces:
  - `commands/skills-audit.ts`: `type AuditInputsResult = { ok: true; resolved: CheckPayload; claude: string } | { ok: false; failure: FailureInput }` (the `message` field is gone).
  - `commands/skills-expand.ts`: no new export.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/skills-audit.test.ts`, replace `runCapturingExit` (lines 72 to 93) with an import of the shared helper, `import { runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";`, rename its two call sites to `runExpectingCleanExit`, drop `spyOn` from the `bun:test` import if nothing else uses it, and change the five expectations:

```ts
  test("no --pack or --pack-dir: ok:false, asking which pack", async () => {
    const r = await resolveAuditInputs([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toEqual({ title: "Which pack?", next: { text: "rt skills audit --pack <name>", role: "command" } });
  });
```

```ts
    if (!r.ok) expect(r.failure).toEqual({ title: "That pack folder does not exist", details: "/definitely/does/not/exist/rt-skills-audit-test" });
```

```ts
      if (!r.ok) expect(r.failure.title).toBe("The audit needs Claude Code, and rt could not find it");
```

```ts
    expect(errors).toEqual(["Which pack?", "  next: rt skills audit --pack <name>"]);
```

```ts
    expect(errors).toEqual(["That pack folder does not exist", "  /definitely/does/not/exist/rt-skills-audit-test"]);
```

(The second replaces both assertions inside that test's `if (!r.ok) { ... }`; the last replaces the `errors.length` and `errors[0]` assertions of the unresolvable `--pack-dir` test.)

In `commands/__tests__/skills-expand.test.ts`, update the pins and add two tests:

- Line 131: ``expect(r.errors.join("\n")).toContain(`advisory:\n  ${join(root, "out", "a", "scripts", "post.sh")}:1`);``
- Lines 39, 49, 63, 72, 83, 89, 95 and 139 stay: `+ a` is the `changes` row, drift lines are the failure's details, and the messages are titles.

```ts
  test("--check reports drift as one failure that names the fix", async () => {
    await skillsExpand(base());
    io.clear();
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nNew line.\n\n{{include:note}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(r.exitCode).toBe(1);
    expect(r.errors[0]).toBe("The expanded skills are out of date");
    expect(r.errors[1]).toBe(`  next: rt skills expand --src ${join(root, "src")} --out ${join(root, "out")}`);
    expect(io.stdout()).toBe("");
  });

  test("a missing --src asks for it", async () => {
    const r = await runExpectingCleanExit(() => skillsExpand(["--out", join(root, "out")]));
    expect(r.exitCode).toBe(1);
    expect(r.errors).toEqual(["Which folder holds the skills to expand?", "  next: rt skills expand --src <dir> --out <dir>"]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-audit.test.ts commands/__tests__/skills-expand.test.ts`
Expected: FAIL. `r.failure` is undefined; the expand failure still starts with `rt skills expand:`.

- [ ] **Step 3: Convert `commands/skills-audit.ts`**

Add to the imports:

```ts
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
```

and add `skillsFailure` to the `./skills.ts` import. Replace `AuditInputsResult` and the three returns in `resolveAuditInputs`:

```ts
export type AuditInputsResult =
  | { ok: true; resolved: CheckPayload; claude: string }
  | { ok: false; failure: out.FailureInput };
```

```ts
  if (!pack && !packDir) return { ok: false, failure: usageFailure("Which pack?", "rt skills audit --pack <name>") };
```

```ts
    if (err instanceof SkillsUsageError) return { ok: false, failure: skillsFailure(err) };
```

```ts
  if (!claude) {
    return {
      ok: false,
      failure: { title: "The audit needs Claude Code, and rt could not find it", why: "The audit runs as a Claude session, so Claude has to be installed and signed in." },
    };
  }
```

In `skillsAudit`, replace the line that prints `inputs.message` and the last four lines of the function:

```ts
  if (!inputs.ok) {
    out.fail(inputs.failure);
    process.exit(2);
  }
```

```ts
  if (r.exitCode !== 0) out.note(out.line("warn", `Claude exited with code ${r.exitCode}`, r.stderr.trim().split("\n").slice(-3).join(" ")));
  if (json) {
    out.json(auditJsonPayload(resolved, files, text, r.exitCode));
    return;
  }
  out.print(out.section(`Audit of ${resolved.pack}`, "advisory, never a gate", out.paragraph(text)));
```

- [ ] **Step 4: Convert `commands/skills-expand.ts`**

Add `import * as out from "../lib/ui/out.ts";`, `import { usageFailure } from "../lib/ui/usage.ts";` and `import type { Block } from "../lib/ui/protocol.ts";`. Replace `fail`, `requireFlagValue`'s call, and the three usage sites in `parseFlags`:

```ts
function fail(failure: out.FailureInput): never {
  out.fail(failure);
  process.exit(1);
}

function requireFlagValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) fail({ title: `${flag} needs a value` });
  return value;
}
```

```ts
      default: fail({ title: `rt skills expand does not take ${a}` });
```

```ts
  if (!flags.src) fail(usageFailure("Which folder holds the skills to expand?", "rt skills expand --src <dir> --out <dir>"));
  if (!flags.out) fail(usageFailure("Which folder should the expanded skills go in?", "rt skills expand --src <dir> --out <dir>"));
```

`lintExpanded` returns the advisory hits in place of printing them. Change its signature and the script branch:

```ts
function lintExpanded(outDir: string, skills: ExpandedSkill[]): { lint: string[]; advisory: string[] } {
```

```ts
  const lint: string[] = [];
  const advisory: string[] = [];
```

```ts
      } else if (isScriptPath(f.path)) {
        advisory.push(...lintScriptFile(readFileSync(f.copyFrom, "utf8"), join(home, f.path), rules).map(formatHit));
      }
```

```ts
  return { lint, advisory };
```

Update the comment above it: the last sentence becomes "they go to stderr as one advisory block and never fail the run."

Replace `emit` with:

```ts
function emit(flags: Flags, payload: { ok: boolean; mode: "expand" | "check"; skills: string[]; removed: string[]; drift: ExpandDrift[]; lint: string[] }, blocks: Block[]): void {
  if (flags.json) {
    out.json(payload);
    return;
  }
  out.print(...blocks);
}

const hits = (n: number): string => `${n} lint ${n === 1 ? "hit" : "hits"}`;
```

and the body of `skillsExpand` from the `let skills` declaration to the end:

```ts
  let skills: ExpandedSkill[];
  try {
    skills = expandSkills({ srcDir: flags.src, outDir: flags.out, roots });
  } catch (err) {
    fail({ title: (err as Error).message });
  }

  const { lint, advisory } = flags.strict ? lintExpanded(flags.out, skills) : { lint: [], advisory: [] };
  if (advisory.length > 0) out.note(out.verbatim(advisory, "advisory"));

  if (flags.check) {
    const drift = checkExpanded(flags.out, skills);
    const ok = drift.length === 0 && lint.length === 0;
    emit(
      flags,
      { ok, mode: "check", skills: skills.map((s) => s.name), removed: [], drift, lint },
      ok ? [out.line("done", "The expanded skills are current", `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`)] : [],
    );
    if (!ok) {
      fail({
        title: drift.length > 0 ? "The expanded skills are out of date" : `The expanded skills have ${hits(lint.length)}`,
        ...(drift.length > 0 ? { next: out.cmd(`rt skills expand --src ${flags.src} --out ${flags.out}`) } : {}),
        details: [...drift.map((d) => `${d.skill}: ${d.causes.join(", ")}`), ...lint].join("\n"),
      });
    }
    return;
  }

  let result: { written: string[]; removed: string[] };
  try {
    result = flags.dryRun ? { written: skills.map((s) => s.name), removed: planRemoval(flags.out, skills) } : writeExpanded(flags.out, skills);
  } catch (err) {
    fail({ title: (err as Error).message });
  }
  const rows = [
    ...result.written.map((name) => ({ op: "+" as const, name, ...(flags.dryRun ? { hint: "would write" } : {}) })),
    ...result.removed.map((name) => ({ op: "-" as const, name, ...(flags.dryRun ? { hint: "would remove" } : {}) })),
  ];
  emit(flags, { ok: lint.length === 0, mode: "expand", skills: result.written, removed: result.removed, drift: [], lint }, rows.length > 0 ? [out.changes(rows)] : []);
  if (lint.length > 0) fail({ title: `${hits(lint.length)} in the expanded skills`, details: lint.join("\n") });
}
```

- [ ] **Step 5: Delete the two allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/skills-audit.ts",` and `  "commands/skills-expand.ts",`.

- [ ] **Step 6: Run the suites**

Run: `bun test commands/__tests__/skills-audit.test.ts commands/__tests__/skills-expand.test.ts lib/__tests__/no-board-skills-drift.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. `no-board-skills-drift.test.ts` reads only the envelope (through the capture since Task 3) and `run.errors` as failure context, so it needs no further edit.

Run: `bun run skills:check:board`
Expected: exit 0, and the line `[ok] The expanded skills are current  <n> skills` (the count is the board's own).

- [ ] **Step 7: Commit**

```bash
git add commands/skills-audit.ts commands/skills-expand.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/skills-audit.test.ts commands/__tests__/skills-expand.test.ts
```

```bash
git commit -m "skills audit and expand print through the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `skills init` and `skills link`

**Files:**
- Modify: `commands/skills-init.ts`, `commands/skills-link.ts`, `lib/skills/init.ts`, `lib/skills/link.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/skills-init.test.ts`, `commands/__tests__/skills-link.test.ts`, `lib/skills/__tests__/init.test.ts`, `lib/skills/__tests__/link.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.note`, `out.json`, `out.line`, `out.kv`, `out.callout`, `out.section`, `out.summary`, `out.cmd`, `FailureInput`, `Block`, `RenderStatus` (`lib/ui/protocol.ts`); `failureFor`, `logFailureDetail` (`lib/errors.ts`); `InitOutcome` (`lib/skills/init.ts`); `LinkAction`, `ReconcileResult` (`lib/skills/link.ts`); `captureSkills` (Task 3).
- Produces:
  - `lib/skills/init.ts`: `type InitRemedy = { commands: string[]; folder?: string }`; the refusal outcome becomes `{ ok: false; refused: true; code: InitRefusalCode; detail: string; next?: string }`; the failure outcome's `remedy?` becomes `InitRemedy`; `const POLICY_REFUSALS: ReadonlySet<InitRefusalCode>` (`pack-exists`, `zone-has-pack`, `zone-mismatch`). Every `detail` per Task 2's init copy table.
  - `lib/skills/link.ts`: the nine `detail` strings per Task 2's link copy table; no type changes.
  - `commands/skills-init.ts`: `initOutcomeBlocks(o: Extract<InitOutcome, { ok: true }>): Block[]`, `initRefusalBlocks(o: Extract<InitOutcome, { ok: false; refused: true }>): Block[]` and `initFailure(o: Extract<InitOutcome, { ok: false }>): FailureInput`. `renderInitOutcome` is deleted.
  - `commands/skills-link.ts`: `linkBlocks(skillsDir: string, claudeSkillsDir: string, result: ReconcileResult, dryRun: boolean): Block[]`; `resolveSkillsDir` returns `{ dir: string } | { error: string; next?: string }`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/skills-init.test.ts`, change the import to `import { initFailure, initMaterializeVerdict, initOutcomeBlocks, initRefusalBlocks, parseInitArgs, skillsInit } from "../skills-init.ts";`, add `import { renderPlain } from "../../lib/ui/out-plain.ts";`, `import * as ui from "../../lib/ui/out.ts";` and `import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";`, and replace the `describe("renderInitOutcome", ...)` block (lines 21 to 60; keep its `okOutcome` fixture) with:

```ts
describe("init outcome", () => {
  test("success names the pack, where things are, and what to try next", () => {
    const text = renderPlain(initOutcomeBlocks(okOutcome));
    expect(text.split("\n")[0]).toBe(`[ok] Created the ${okOutcome.pack.name} pack  ${okOutcome.pack.dir}`);
    expect(text).toContain(`Zone: ${okOutcome.pack.zone}\n`);
    expect(text).toContain(`Installed: ${okOutcome.installed.plugin} ${okOutcome.installed.version}\n`);
    expect(text).toContain(`  next: Run /reload-plugins in your Claude session, then try ${okOutcome.tryNext}\n`);
    expect(text).not.toContain("restart");
  });

  test("a policy refusal is a refused line, with its command as next", () => {
    expect(
      renderPlain(
        initRefusalBlocks({
          ok: false,
          refused: true,
          code: "zone-has-pack",
          detail: "The acme zone already has a team pack, and a zone holds only one (a base pack can sit beside it)",
          next: "rt team create <name> --remote <url>",
        }),
      ),
    ).toBe(
      "[refused] The acme zone already has a team pack, and a zone holds only one (a base pack can sit beside it)\n  next: rt team create <name> --remote <url>\n",
    );
  });

  test("a refusal that is not a policy one is a failure, its command as next", () => {
    const failure = initFailure({ ok: false, refused: true, code: "zone-ambiguous", detail: "More than one team zone could hold this pack: acme, beta", next: "rt skills init --zone <slug>" });
    expect(renderPlain([ui.failure(failure)])).toBe("More than one team zone could hold this pack: acme, beta\n  next: rt skills init --zone <slug>\n");
  });

  test("a failure names each command of its remedy, then what was written", () => {
    const failure = initFailure({
      ok: false,
      refused: false,
      code: "compile-failed",
      detail: "boom",
      wrote: ["/a", "/b"],
      remedy: { commands: ["rt skills compile --pack-dir /z/mattstack/packs/acme", "rt skills check --pack-dir /z/mattstack/packs/acme"] },
    });
    expect(renderPlain([ui.failure(failure)])).toBe(
      "boom\n  next: Run rt skills compile --pack-dir /z/mattstack/packs/acme, then rt skills check --pack-dir /z/mattstack/packs/acme\n  Written so far:\n  /a\n  /b\n",
    );
  });

  test("a write failure says to delete the folder it started, then run init again", () => {
    const failure = initFailure({
      ok: false,
      refused: false,
      code: "write-failed",
      detail: "disk full",
      wrote: ["/z/mattstack/packs/acme/.claude-plugin/plugin.json"],
      remedy: { commands: ["rt skills init"], folder: "/z/mattstack/packs/acme" },
    });
    expect(renderPlain([ui.failure(failure)])).toBe(
      "disk full\n  next: Delete the pack folder it started, then run rt skills init\n  Pack folder: /z/mattstack/packs/acme\n  Written so far:\n  /z/mattstack/packs/acme/.claude-plugin/plugin.json\n",
    );
  });

  test("with no remedy, the next step is the general one", () => {
    expect(renderPlain([ui.failure(initFailure({ ok: false, refused: false, code: "compile-failed", detail: "boom", wrote: [] }))])).toBe(
      "boom\n  next: Fix it, then run rt skills compile and rt skills check\n",
    );
  });
});
```

Move `memFs` out of the `--json: a post-write compile failure ...` test (lines 155 to 171) to module scope, unchanged, so a second test can use it.

In `describe("skillsInit", ...)`, every test builds its own `spyOn(console, "log")` or `spyOn(console, "error")`. Replace each with the shared capture: declare `let io: ReturnType<typeof captureSkills>;` in the describe, add `beforeEach(() => { io = captureSkills(); });`, extend the existing `afterEach` with `io.restore();`, delete each test's spy, `try` and `finally`, and read `io` in its place:

- Lines 86 to 96 (a plain refusal, `no-remote`, which is not a policy refusal): `expect(io.stdout()).toBe("");`, `expect(io.errLines()).toHaveLength(1);`, `expect(io.stderr()).not.toContain("rt skills init:");`, `expect(io.stderr()).not.toContain("[refused]");`, `expect(process.exitCode).toBe(2);`.
- Every `--json` test: `expect(logSpy.mock.calls.length).toBe(1);` becomes `expect(io.lines()).toHaveLength(1);` and `JSON.parse(String(logSpy.mock.calls[0]?.[0]))` becomes `JSON.parse(io.lines()[0]!)`.
- Line 133 (`expect(errorSpy).toHaveBeenCalledWith("rt skills init: a remote is required");`): `expect(io.stderr()).toBe("a remote is required\n");` and `expect(io.stdout()).toBe("");`.

Rename that test to `without --json, the same crash-path refusal prints the message as a failure`, and add, in the same describe:

```ts
  test("a policy refusal is a refused note on stderr, exit 2", async () => {
    const HOME = "/h";
    const fs = memFs({
      [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "team", "namespace": "acme", "org": "x" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`]: `{ "gitlabHost": "https://gitlab.com", "projects": ["acme/api"] }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/pack/stubs.jsonc`]: "{}",
    });
    await skillsInit([], {}, stubDeps({ fs, home: HOME, gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }) }));
    expect(io.stdout()).toBe("");
    expect(io.errLines()[0]).toStartWith("[refused] This zone already has a pack for this repo");
    expect(io.stderr()).not.toContain("[failed]");
    expect(process.exitCode).toBe(2);
  });
```

The zone declares `acme/api`, so `chooseZone` finds it, and the pack folder already exists (`memFs.exists` matches a folder by any key under it): `pack-exists`, a policy refusal.

In `lib/skills/__tests__/init.test.ts`, move the pins the copy table changes:

- Line 452 (`expect(out.detail).toContain("rt team create");`): `expect(out.next).toBe("rt team create <name> --remote <url>");` and `expect(out.detail).toBe("No team zone on gitlab.example.com is free for a new pack");`
- Line 510 (`expect(out.remedy).toContain(packDir);`): `expect(out.remedy).toEqual({ commands: ["rt skills init"], folder: packDir });`
- Line 525: `remedy: \`then: rt skills materialize --dir ${REPO}\`` becomes `remedy: { commands: [\`rt skills materialize --dir ${REPO}\`] }`.
- In the `pack-exists` test (its `toMatchObject` at line 384), add `if (out.ok || !out.refused) return;` and `expect(out.detail).toBe("This zone already has a pack for this repo, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill");`
- In the `zone-has-pack` test (line 410), add `if (out.ok || !out.refused) return;`, `expect(out.detail).toContain("already has a team pack");` and `expect(out.next).toBe("rt team create <name> --remote <url>");`

Lines 373, 434, 444, 491, 492, 508, 518, 535 and 557 stay: each pins a fact (the CLI's output, the namespace, a zone slug) that the new sentence still carries.

In `lib/skills/__tests__/link.test.ts`, pin two of the new details: after line 116 add `expect(result.actions.find((a) => a.kind === "skip")?.detail).toMatch(/^another skill already has this name: /);`, and after line 194 add `expect(result.actions.find((a) => a.name === "rt:release")?.detail).toMatch(/^\.skillsignore lists it now: /);`.

In `commands/__tests__/skills-link.test.ts`, add the imports `import { renderPlain } from "../../lib/ui/out-plain.ts";` and `linkBlocks` from `../skills-link.ts`, change the two expectations, and add the block tests:

- Line 55: `expect(got).toEqual({ error: "You are not inside a git repo", next: "rt skills link --from <folder>" });`
- Line 61: ``expect(got).toEqual({ error: `This repo has no skills folder (${join(root, "repo", "skills")})` });``

```ts
describe("linkBlocks", () => {
  const action = { link: "/h/.claude/skills/x", target: "/r/skills/x" };

  test("one line per skill, in plain words, under where the links go", () => {
    const result = {
      changed: true,
      actions: [
        { ...action, kind: "create" as const, name: "alpha", detail: null },
        { ...action, kind: "ok" as const, name: "beta", detail: null },
        { ...action, kind: "prune" as const, name: "gamma", target: null, detail: "the skill it pointed at is gone: /r/skills/gamma" },
        { ...action, kind: "conflict" as const, name: "delta", detail: "a file or folder rt did not make has this name" },
        { ...action, kind: "skip" as const, name: "epsilon", detail: "its SKILL.md header has no name" },
      ],
    };
    expect(renderPlain(linkBlocks("/r/skills", "/h/.claude/skills", result, false))).toBe(
      [
        "Skill links",
        "From: /r/skills",
        "To: /h/.claude/skills",
        "[ok] alpha  linked",
        "[ok] beta  already linked",
        "[off] gamma  link removed: the skill it pointed at is gone: /r/skills/gamma",
        "[needs you] delta  left alone: a file or folder rt did not make has this name",
        "[skipped] epsilon  not linked: its SKILL.md header has no name",
        "  note: rt never removes a link it did not make. Sort these out by hand.",
        "",
      ].join("\n"),
    );
  });

  test("a dry run says would, and nothing to do ends with one summary", () => {
    expect(renderPlain(linkBlocks("/r/skills", "/h/.claude/skills", { changed: true, actions: [{ ...action, kind: "create", name: "alpha", detail: null }] }, true))).toBe(
      "Skill links (dry run)\nFrom: /r/skills\nTo: /h/.claude/skills\n[not yet] alpha  would link\n",
    );
    expect(renderPlain(linkBlocks("/r/skills", "/h/.claude/skills", { changed: false, actions: [{ ...action, kind: "ok", name: "alpha", detail: null }] }, false))).toBe(
      "Skill links\nFrom: /r/skills\nTo: /h/.claude/skills\n[ok] alpha  already linked\n\n[ok] Everything is already linked\n",
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-init.test.ts commands/__tests__/skills-link.test.ts lib/skills/__tests__/init.test.ts lib/skills/__tests__/link.test.ts`
Expected: FAIL. `initOutcomeBlocks`, `initRefusalBlocks` and `linkBlocks` are not exported; `out.next` is undefined and `remedy` is still a string; the link details are the old words.

- [ ] **Step 3: The copy pass in `lib/skills/init.ts` and `lib/skills/link.ts`**

In `lib/skills/init.ts`, change the outcome types and `refuse` (lines 272 to 287):

```ts
export type InitRemedy = { commands: string[]; folder?: string };

export type InitOutcome =
  | {
      ok: true;
      pack: { name: string; dir: string; zone: string; marketplace: string };
      repo: { slug: string; manifest: string };
      wrote: string[];
      installed: { plugin: string; version: string };
      restartNeeded: true;
      tryNext: string;
    }
  | { ok: false; refused: true; code: InitRefusalCode; detail: string; next?: string }
  | { ok: false; refused: false; code: FailureCode; detail: string; wrote: string[]; remedy?: InitRemedy };

/** rt declining by rule, drawn as refused; every other refusal code is a missing prerequisite or a usage slip, drawn as a failure. */
export const POLICY_REFUSALS: ReadonlySet<InitRefusalCode> = new Set(["pack-exists", "zone-has-pack", "zone-mismatch"]);

function refuse(code: InitRefusalCode, detail: string, next?: string): InitOutcome {
  return { ok: false, refused: true, code, detail, ...(next ? { next } : {}) };
}
```

Replace each `refuse(...)` and `failed(...)` string at lines 308 to 350 and 409 to 431 with the "New" column of Task 2's init copy table, passing its `next` as `refuse`'s third argument where the table gives one (`mattstack-missing`: `"rt setup pack"`; the no-TTY `zone-missing`: `"rt team create <name> --remote <url>"`; `zone-ambiguous`: `"rt skills init --zone <slug>"`; `zone-has-pack`: `"rt team create <name> --remote <url>"`). Keep every interpolated value the table keeps (`withoutCredentials(remote.url)`, the host, the slugs, `pack`, `manifestPath`, the CLI's own output). Then replace `remedyFor` (lines 357 to 364):

```ts
  const remedyFor = (code: FailureCode): InitRemedy => {
    if (code === "write-failed") return { commands: ["rt skills init"], folder: packDir };
    if (code === "materialize-failed") return { commands: [`rt skills materialize --dir ${opts.repoDir}`] };
    if (code === "compile-failed" || code === "check-drift") {
      return { commands: [`rt skills compile --pack-dir ${packDir}`, `rt skills check --pack-dir ${packDir}`] };
    }
    return { commands: [`claude plugin marketplace add ${zone.dir}`, `claude plugin install ${pluginId}`] };
  };
```

In `lib/skills/link.ts`, replace the nine `detail` strings at lines 97, 101, 106, 126, 142, 149, 162 (both) and 198 with the "New" column of Task 2's link copy table, keeping each interpolated value (`clash`, `raw`).

In `commands/skills-init.ts`, the two strings the init copy table names: `initMaterializeVerdict`'s `"materialize wrote nothing"` (line 67) becomes `"no bindings file was written"`, and `registerRepo`'s message (line 148) becomes ``` `rt could not add ${dir} to its repo list: ${indexed.error}` ``` with the code `locate-failed` unchanged.

- [ ] **Step 4: Convert `commands/skills-init.ts`**

This file already has locals named `out`, so the layer is imported as `ui`:

```ts
import * as ui from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { POLICY_REFUSALS, type InitRemedy } from "../lib/skills/init.ts";
```

(`InitDeps`, `InitOutcome` and `initPack` are already imported from `../lib/skills/init.ts` at line 22; fold the two new names into that import.) Add `failureFor` and `logFailureDetail` to the `../lib/errors.ts` import.

Replace `renderInitOutcome` (lines 49 to 63) with:

```ts
export function initOutcomeBlocks(o: Extract<InitOutcome, { ok: true }>): Block[] {
  return [
    ui.line("done", `Created the ${o.pack.name} pack`, o.pack.dir),
    ui.kv("Zone", o.pack.zone),
    ui.kv("Marketplace", o.pack.marketplace),
    ui.kv("Installed", `${o.installed.plugin} ${o.installed.version}`),
    ui.kv("Repo bindings", o.repo.manifest),
    ui.callout("next", ["Run ", ui.cmd("/reload-plugins"), " in your Claude session, then try ", ui.cmd(o.tryNext)]),
  ];
}

export function initRefusalBlocks(o: Extract<InitOutcome, { ok: false; refused: true }>): Block[] {
  return [ui.line("refused", o.detail), ...(o.next ? [ui.callout("next", ui.cmd(o.next))] : [])];
}

function remedyCell(r: InitRemedy): Array<string | Segment> {
  const commands = r.commands.flatMap((c, i) => (i === 0 ? [ui.cmd(c)] : [", then ", ui.cmd(c)]));
  return [r.folder ? "Delete the pack folder it started, then run " : "Run ", ...commands];
}

export function initFailure(o: Extract<InitOutcome, { ok: false }>): ui.FailureInput {
  if (o.refused) return { title: o.detail, ...(o.next ? { next: ui.cmd(o.next) } : {}) };
  const details = [...(o.remedy?.folder ? [`Pack folder: ${o.remedy.folder}`] : []), ...(o.wrote.length > 0 ? ["Written so far:", ...o.wrote] : [])];
  return {
    title: o.detail,
    next: o.remedy ? remedyCell(o.remedy) : ["Fix it, then run ", ui.cmd("rt skills compile"), " and ", ui.cmd("rt skills check")],
    ...(details.length > 0 ? { details: details.join("\n") } : {}),
  };
}
```

In `realDeps`, the two warning lines in `materialize` and the one in `check`:

```ts
      for (const w of warnings) ui.note(ui.line("warn", "Another pack did not materialize", w));
      for (const w of pruneWarnings) ui.note(ui.line("warn", w));
```

```ts
        ui.note(ui.line("warn", "The check could not run", message(err)));
```

In `skillsInit`, the usage catch:

```ts
      if (args.includes("--json")) ui.json(envelope({ error: { code: "usage", message: err.message } }));
      else ui.fail({ title: err.message });
```

the crash-path catch (cross-phase ruling 12: a caller that prints a `UserActionableError` itself logs its detail first):

```ts
      if (parsed.json) {
        ui.json(userErrorPayload(new UserActionableError(err.code, err.message, { ...err.extra, refused: true })));
      } else {
        logFailureDetail(err);
        ui.fail(failureFor(err));
      }
```

and the final block (from `if (parsed.json) {` to the `else` that printed `renderInitOutcome`):

```ts
  if (parsed.json) {
    if (out.ok) ui.json(envelope(out));
    else if (out.refused) ui.json(userErrorPayload(new UserActionableError(out.code, out.detail, { refused: true })));
    else ui.json(userErrorPayload(new UserActionableError(out.code, out.detail, { refused: false, wrote: out.wrote })));
  } else if (out.ok) {
    ui.print(...initOutcomeBlocks(out));
  } else if (out.refused && POLICY_REFUSALS.has(out.code)) {
    ui.note(...initRefusalBlocks(out));
  } else {
    ui.fail(initFailure(out));
  }
```

A refusal or failure used to print on stdout. A policy refusal is now a `refused` note on stderr; every other one is a failure, also on stderr (spec rule 3). The `--json` envelopes carry `out.detail` as `message`, so their wording follows the copy table while every key, `code`, `refused` and `wrote` stays. The exit codes on the last line are unchanged.

- [ ] **Step 5: Convert `commands/skills-link.ts`**

Add:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
```

Replace `fail` and delete `GLYPH`:

```ts
function fail(title: string, next?: string): never {
  out.fail({ title, ...(next ? { next: out.cmd(next) } : {}) });
  process.exit(1);
}

const ROW: Record<LinkAction["kind"], { status: RenderStatus; done: string; would: string }> = {
  create: { status: "done", done: "linked", would: "would link" },
  ok: { status: "done", done: "already linked", would: "already linked" },
  relink: { status: "done", done: "relinked", would: "would relink" },
  prune: { status: "off", done: "link removed", would: "would remove the link" },
  conflict: { status: "needs-you", done: "left alone", would: "left alone" },
  skip: { status: "skipped", done: "not linked", would: "not linked" },
};
```

In `resolveSkillsDir`, change the return type to `{ dir: string } | { error: string; next?: string }` (`next` is a command) and the last two error returns to:

```ts
    return { error: "You are not inside a git repo", next: "rt skills link --from <folder>" };
```

```ts
  if (!existsSync(dir)) return { error: `This repo has no skills folder (${dir})` };
```

In `skillsLink`, the two flag failures become `fail("--from needs a folder")` and ``fail(`rt skills link does not take ${args[i]}`)``, and the last line of the error branch becomes `fail(source.error, source.next);`.

Replace `report` with:

```ts
export function linkBlocks(skillsDir: string, claudeSkillsDir: string, result: ReconcileResult, dryRun: boolean): Block[] {
  const changes = new Set<LinkAction["kind"]>(["create", "relink", "prune"]);
  const rows = result.actions.map((a) => {
    const word = dryRun ? ROW[a.kind].would : ROW[a.kind].done;
    return out.line(dryRun && changes.has(a.kind) ? "pending" : ROW[a.kind].status, a.name, a.detail ? `${word}: ${a.detail}` : word);
  });
  const conflicts = result.actions.filter((a) => a.kind === "conflict").length;
  return [
    out.section("Skill links", dryRun ? "dry run" : undefined, out.kv("From", skillsDir), out.kv("To", claudeSkillsDir), ...rows),
    ...(conflicts > 0 ? [out.callout("note", "rt never removes a link it did not make. Sort these out by hand.")] : []),
    ...(!result.changed && conflicts === 0 ? [out.summary("done", "Everything is already linked")] : []),
  ];
}

function report(skillsDir: string, claudeSkillsDir: string, result: ReconcileResult, dryRun: boolean, json: boolean): void {
  if (json) {
    out.json(envelope({ ok: true, dryRun, skillsDir, claudeSkillsDir, changed: result.changed, actions: result.actions }));
    return;
  }
  out.print(...linkBlocks(skillsDir, claudeSkillsDir, result, dryRun));
}
```

- [ ] **Step 6: Delete the two allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/skills-init.ts",` and `  "commands/skills-link.ts",`.

- [ ] **Step 7: Run the suites**

Run: `bun test commands/__tests__/skills-init.test.ts commands/__tests__/skills-link.test.ts commands/__tests__/skills-json-frozen.test.ts lib/skills/__tests__/init.test.ts lib/skills/__tests__/link.test.ts lib/skills/__tests__/init-compile.e2e.test.ts lib/setup/__tests__ lib/__tests__/no-raw-output.test.ts`
Expected: PASS. `lib/setup/__tests__` runs because `lib/setup/skills-link-bundled.ts` calls `reconcileSkillLinks`; it reads `kind` and `changed` only, so nothing there moves.

Run: `grep -rn "renderInitOutcome\|re-run\|then: " lib/skills/init.ts lib/skills/link.ts commands/skills-init.ts commands/skills-link.ts`
Expected: no hits.

- [ ] **Step 8: Commit**

```bash
git add commands/skills-init.ts commands/skills-link.ts lib/skills/init.ts lib/skills/link.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/skills-init.test.ts commands/__tests__/skills-link.test.ts lib/skills/__tests__/init.test.ts lib/skills/__tests__/link.test.ts
```

```bash
git commit -m "skills init and link print through the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `skills sync`

**Files:**
- Modify: `commands/skills-sync.ts`, `lib/skills/sync.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/skills-sync.test.ts`, `lib/skills/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.note`, `out.json`, `out.line`, `out.kv`, `out.summary`, `out.callout`, `out.cmd`, `FailureInput`, `Block`, `RenderStatus`; `usageFailure` (5a); `SyncReport`, `SyncStep` (`lib/skills/sync.ts`).
- Produces:
  - `commands/skills-sync.ts`: `syncBlocks(report: SyncReport): Block[]`, `syncRefusal(report: SyncReport): Block[] | null`, `syncFailure(report: SyncReport): FailureInput | null`.
  - `lib/skills/sync.ts`: no signature or shape change. The step `detail`s, the five throws, `guardSummary`, `inTreeBranchNote` and the cswap warning take Task 2's sync copy table.

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/skills-sync.test.ts` (add the imports `import { renderPlain } from "../../lib/ui/out-plain.ts";`, `import * as out from "../../lib/ui/out.ts";`, `import type { SyncReport } from "../../lib/skills/sync.ts";` and `syncBlocks`, `syncFailure`, `syncRefusal` from `../skills-sync.ts`):

```ts
describe("syncBlocks", () => {
  const report = (over: Partial<SyncReport>): SyncReport => ({
    ok: true,
    pack: "acme",
    steps: [],
    versions: { engine: { before: "1.0.0", after: "1.0.0" }, pack: { source: "0.5.3", installedBefore: "0.5.3", installedAfter: "0.5.3" } },
    warnings: [],
    restartNeeded: false,
    ...over,
  });

  test("each step is a line with a plain title, never a step id", () => {
    const text = renderPlain(
      syncBlocks(
        report({
          steps: [
            { name: "guards", status: "ran", detail: "engine and pack checkouts clean on main" },
            { name: "pull-engine", status: "skipped", detail: "The engine and the pack share a checkout, so it is pulled once, with the pack" },
            { name: "commit-push", status: "ran", detail: "committed and pushed v0.5.4" },
          ],
          versions: { engine: { before: "1.0.0", after: "1.1.0" }, pack: { source: "0.5.4", installedBefore: "0.5.3", installedAfter: "0.5.4" } },
          warnings: ["The beta cswap account's plugins folder (/s/beta/plugins) does not point at /c/plugins"],
          restartNeeded: true,
        }),
      ),
    );
    expect(text).toBe(
      [
        "[ok] Safety checks  engine and pack checkouts clean on main",
        "[skipped] Pull the engine  The engine and the pack share a checkout, so it is pulled once, with the pack",
        "[ok] Commit and push  committed and pushed v0.5.4",
        "Engine: 1.0.0 -> 1.1.0",
        "Installed pack: 0.5.3 -> 0.5.4",
        "[warning] The beta cswap account's plugins folder (/s/beta/plugins) does not point at /c/plugins",
        "",
        "[ok] Synced",
        "  next: Run /reload-plugins in any Claude session that is already running",
        "",
      ].join("\n"),
    );
    expect(text).not.toContain("pull-engine");
  });

  test("nothing to do is one summary", () => {
    expect(renderPlain(syncBlocks(report({})))).toBe("[ok] Already current\n");
  });

  test("a refusal is not a failure: the steps before it on stdout, then a refused note", () => {
    const refused = report({
      ok: false,
      steps: [
        { name: "guards", status: "ran", detail: "engine and pack checkouts clean on main" },
        { name: "bump", status: "refused", detail: "This pack is in the shared checkout at /z/mono/packs/acme, and its compiled skills are out of date" },
      ],
    });
    expect(renderPlain(syncBlocks(refused))).toBe("[ok] Safety checks  engine and pack checkouts clean on main\n");
    expect(renderPlain(syncRefusal(refused)!)).toBe(
      "[refused] rt did not sync acme  it stopped at: Bump the pack's version\n  why: This pack is in the shared checkout at /z/mono/packs/acme, and its compiled skills are out of date\n",
    );
    expect(syncFailure(refused)).toBeNull();
  });

  test("a step sync marks refused because a command failed reads as a failure, and the report keeps refused", () => {
    const pulled = report({
      ok: false,
      steps: [{ name: "pull-pack", status: "refused", detail: "Pulling /z/packs/acme failed: not possible to fast-forward. Sort it out by hand, then run this again" }],
    });
    expect(syncRefusal(pulled)).toBeNull();
    expect(renderPlain([out.failure(syncFailure(pulled)!)])).toBe(
      "The sync stopped at: Pull the pack\n  why: Pulling /z/packs/acme failed: not possible to fast-forward. Sort it out by hand, then run this again\n",
    );
    expect(pulled.steps[0]!.status).toBe("refused");
  });

  test("a strict lint refusal names the check to run", () => {
    const refused = report({ ok: false, steps: [{ name: "check", status: "refused", detail: "This pack is strict, and mcp lint found 2 hits. Fix them before syncing" }] });
    expect(renderPlain(syncRefusal(refused)!)).toBe(
      "[refused] rt did not sync acme  it stopped at: Check for drift\n  why: This pack is strict, and mcp lint found 2 hits. Fix them before syncing\n  next: rt skills check --pack acme\n",
    );
  });

  test("a failed step is the failure, named in plain words, with nothing for it on stdout", () => {
    const failed = report({ ok: false, steps: [{ name: "compile", status: "failed", detail: 'verb "ship": engine not found' }] });
    expect(renderPlain([out.failure(syncFailure(failed)!)])).toBe('The sync stopped at: Recompile\n  why: verb "ship": engine not found\n');
    expect(syncBlocks(failed)).toEqual([]);
    expect(syncRefusal(failed)).toBeNull();
  });
});
```

In the same file's `syncMaterializeVerdict` tests, line 124 becomes `toEqual({ ok: true, detail: "nothing was written: engine-pack-missing", warnings: [] })`, and add beside the tests that use `written`:

```ts
  test("a written pack file reads as plain words", () => {
    const r = result([{ name: "repo-a", path: "/r/a", ok: true, detail: "", packs: [written("widgets")] }]);
    expect(syncMaterializeVerdict(r, "widgets").detail).toBe("wrote 1 widgets bindings file");
  });
```

In `lib/skills/__tests__/sync.test.ts`, move the pins the copy table changes:

- Line 306: `expect(report.steps[0]!.detail).toContain("engine checkout is on feature, not main");` (307 stays).
- Line 321: `expect(report.steps[0]!.detail).toContain("The acme pack was not installed from a directory marketplace");` (322 stays).
- Line 337: `expect(report.steps[0]!.detail).toContain("Install it, then run this again");` (335 and 336, the paths, stay).
- Line 461: `expect(last.detail).toContain("old engine");` (460 stays).
- Line 515: `expect(report.steps[0]!.detail).toContain("pack checkout at");` and `expect(report.steps[0]!.detail).toContain("has uncommitted changes");`
- Line 677: `expect(report.steps[0]!.detail).toContain("Remove it, then run this again");` (676, the path, stays).
- Line 759: `expect(report.steps[0]!.detail).toContain("pack checkout is on feature, not main");` (760 stays).
- Line 782: `expect(compile.detail).toContain("rt put the version back to 0.5.2");` (781 stays).
- Line 804: `expect(recheck.detail).toContain("from this working tree");` (278 and 801 to 803 stay).
- Line 888: `expect(checkStep.detail).toContain("Fix them before syncing");` and `expect(checkStep.detail).not.toContain("rt skills check");` (887 stays).
- Lines 911 and 912: `expect(checkStep.detail).toContain("mcp lint found 2 hits, advisory for this pack");` and `expect(checkStep.detail).not.toContain("strictLint");`
- Under line 932, add `expect(checkStep.detail).toMatch(/^the compiled skills are (current|out of date)$/);`
- Line 1010: `.toBe("pack checkout clean on main; the engine is in the shared checkout, so its git checks are skipped");`
- Line 1018: `.toBe("the engine and the pack are in the shared checkout, so git checks are skipped");`
- Line 1097: ``expect(pullEngine.detail).toContain(`the shared checkout at ${root} is on feature-x, not main`);`` (1098 and 1099 stay).
- Line 1116: ``expect(detail).toContain(`the shared checkout at ${root} is detached`);`` (1117 and 1128 stay).
- Line 1143: `expect(bump.detail).toContain("shared checkout");` (1144 stays).

Every other pin in the file (403's `installed cache`, 406 and 441's versions, 483, 559, 590, 641, 660, 713, 727, 746, 747, 781, 801 to 803, 867, 1001, 1059) asserts a value the new copy keeps, or a detail this pass leaves alone.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-sync.test.ts lib/skills/__tests__/sync.test.ts`
Expected: FAIL. `syncBlocks` and `syncRefusal` are not exported; the sync details are the old words.

- [ ] **Step 3: The copy pass in `lib/skills/sync.ts`**

Replace each string in the "Today" column of Task 2's sync copy table with its "New" column, keeping every interpolated value the table keeps. Three spots change shape as well as words:

`inTreeBranchNote` (lines 143 to 150):

```ts
async function inTreeBranchNote(deps: SyncDeps, root: string): Promise<string> {
  const res = await deps.run("git", ["branch", "--show-current"], { cwd: root });
  if (res.code !== 0) return `; rt could not read the shared checkout's branch (${res.stderr.trim()}), and the plugin installs from ${IN_TREE_REF}`;
  const branch = res.stdout.trim();
  if (branch === IN_TREE_REF) return "";
  const where = branch === "" ? "is detached" : `is on ${branch}`;
  return `; the shared checkout at ${root} ${where}, not ${IN_TREE_REF}, and the plugin installs from ${IN_TREE_REF}`;
}
```

The `check` step (lines 370 to 381), with a small counter beside `ran` (line 54):

```ts
const hitCount = (n: number): string => `${n} ${n === 1 ? "hit" : "hits"}`;
```

```ts
  const checkStep = await tryStep(async () => {
    const result = await deps.checkPack(pack.name);
    drift = result.drift;
    if (result.strict && result.lintHits > 0) {
      return refused(`This pack is strict, and mcp lint found ${hitCount(result.lintHits)}. Fix them before syncing`);
    }
    const lintNote = result.lintHits > 0 ? `; mcp lint found ${hitCount(result.lintHits)}, advisory for this pack` : "";
    return ran(`${drift ? "the compiled skills are out of date" : "the compiled skills are current"}${lintNote}`);
  });
```

and the `stale` constant in `refreshCachedEngine` (line 335) becomes `const stopped = "rt stopped so the pack is not compiled against an old engine";`, joined to each of its three refusals with `. ` in place of `; `.

In `commands/skills-sync.ts`, `syncMaterializeVerdict` (lines 82 to 89) takes its two rows of the table:

```ts
  if (r.skipped) return { ok: true, detail: `nothing was written: ${r.reason}`, warnings: [] };
```

```ts
  const others = verdict.warnings.length > 0 ? `; these other packs did not: ${verdict.warnings.join("; ")}` : "";
  return { ok: true, detail: `wrote ${verdict.written} ${pack} bindings file${verdict.written === 1 ? "" : "s"}${others}`, warnings };
```

- [ ] **Step 4: Convert `commands/skills-sync.ts`**

Add:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
```

Replace `stepLine` and `renderHuman` (lines 91 to 117) with:

```ts
const STEP_TITLE: Record<string, string> = {
  guards: "Safety checks",
  "pull-engine": "Pull the engine",
  "pull-pack": "Pull the pack",
  "update-engine": "Update the installed engine",
  materialize: "Rebuild the bindings files",
  check: "Check for drift",
  bump: "Bump the pack's version",
  compile: "Recompile",
  recheck: "Check again",
  "commit-push": "Commit and push",
  "update-pack": "Update the installed pack",
  "verify-installed": "Verify the installed copy",
  "cswap-sweep": "Check each account's plugin link",
};

const STEP_STATUS: Record<SyncStep["status"], RenderStatus> = { ran: "done", skipped: "skipped", refused: "refused", failed: "failed" };

/** The command that clears a refusal, for the steps whose refusal one command clears. */
const STEP_NEXT: Record<string, (pack: string) => string> = { check: (pack) => `rt skills check --pack ${pack}` };

const stepTitle = (step: SyncStep): string => STEP_TITLE[step.name] ?? step.name;

const stops = (step: SyncStep): boolean => step.status === "refused" || step.status === "failed";

/** What a person reads on stdout: the steps up to the one that stopped the run, then a summary only when none did. */
export function syncBlocks(report: SyncReport): Block[] {
  const stop = report.steps.findIndex(stops);
  const shown = stop === -1 ? report.steps : report.steps.slice(0, stop);
  const blocks: Block[] = shown.map((step) => out.line(STEP_STATUS[step.status], stepTitle(step), step.detail));
  const { engine, pack } = report.versions;
  if (engine.before !== engine.after) blocks.push(out.kv("Engine", `${engine.before ?? "unknown"} -> ${engine.after ?? "unknown"}`));
  if (pack.installedBefore !== pack.installedAfter) blocks.push(out.kv("Installed pack", `${pack.installedBefore ?? "unknown"} -> ${pack.installedAfter ?? "unknown"}`));
  for (const warning of report.warnings) blocks.push(out.line("warn", warning));
  if (stop !== -1) return blocks;
  if (report.restartNeeded) blocks.push(out.summary("done", "Synced"), out.callout("next", ["Run ", out.cmd("/reload-plugins"), " in any Claude session that is already running"]));
  else blocks.push(out.summary("done", "Already current"));
  return blocks;
}

/**
 * lib/skills/sync.ts marks these steps `refused` only when a command they ran
 * failed (git pull, claude plugin update or marketplace update, the compile),
 * so a person reads them as failures. --json keeps the status sync gave them.
 */
const REFUSED_ON_FAILED_COMMAND: ReadonlySet<string> = new Set(["pull-engine", "pull-pack", "update-engine", "compile"]);

const isPolicyRefusal = (step: SyncStep): boolean => step.status === "refused" && !REFUSED_ON_FAILED_COMMAND.has(step.name);

/** A policy refusal, for out.note: rt declining by rule, never a failure. */
export function syncRefusal(report: SyncReport): Block[] | null {
  const refused = report.steps.find(isPolicyRefusal);
  if (!refused) return null;
  const next = STEP_NEXT[refused.name];
  return [
    out.line("refused", `rt did not sync ${report.pack}`, `it stopped at: ${stepTitle(refused)}`),
    out.callout("why", refused.detail),
    ...(next ? [out.callout("next", out.cmd(next(report.pack)))] : []),
  ];
}

export function syncFailure(report: SyncReport): out.FailureInput | null {
  const failed = report.steps.find((s) => s.status === "failed" || (s.status === "refused" && !isPolicyRefusal(s)));
  return failed ? { title: `The sync stopped at: ${stepTitle(failed)}`, why: failed.detail } : null;
}
```

The step name is what tells the two kinds of `refused` apart, with no string matching: in `lib/skills/sync.ts` at head, every `refused(...)` under `pull-engine` (line 304), `pull-pack` (318), `update-engine` (338, 342, 344, through `refreshCachedEngine`) and `compile` (415) follows a command that failed, and every `refused(...)` under `guards` (229 to 274), `check` (375), `bump` (391) and `recheck` (426) is a rule. A future `refused` added to one of the four command steps must be a failed command too, or the set must change with it.

In `skillsSync`, replace the `fail` closure and its three callers' arguments (lines 124 to 140):

```ts
  const fail = (error: string, shown?: out.FailureInput): never => {
    if (json) out.json({ ok: false, error });
    else out.fail(shown ?? { title: error });
    process.exit(1);
  };

  const packs = discoverPacks();
  if (packs.length === 0) {
    fail("no packs discovered (no directory marketplace plugin carries a surface.jsonc); pass --pack <name>", {
      title: "No packs found",
      why: "A pack is a plugin from a directory marketplace that has a surface file.",
    });
  }

  const pack = packFlag ? packs.find((p) => p.name === packFlag) : packs.length === 1 ? packs[0] : undefined;
  if (!pack) {
    const names = packs.map((p) => p.name).join(", ");
    if (packFlag) fail(`no pack named "${packFlag}" (discovered: ${names})`, { title: `No pack is called ${packFlag}`, next: out.cmd("rt skills packs"), details: `Packs here: ${names}` });
    else fail(`which pack? pass --pack <name> (discovered: ${names})`, usageFailure("Which pack?", "rt skills sync --pack <name>", `There is more than one: ${names}.`));
  }
```

the engine refusal (lines 162 to 165):

```ts
  if ("error" in engineResult) {
    fail(engineResult.error, {
      title: `rt could not find the mattstack plugin that ${pack!.name} is built on`,
      why: "Install the mattstack plugin, then run this again.",
    });
    return;
  }
```

and the end of the function (lines 176 to 178):

```ts
  if (json) {
    out.json(report);
  } else {
    const blocks = syncBlocks(report);
    if (blocks.length > 0) out.print(...blocks);
    const refusal = syncRefusal(report);
    if (refusal) out.note(...refusal);
    const failure = syncFailure(report);
    if (failure) out.fail(failure);
  }
  if (!report.ok) process.exitCode = 1;
```

The `error` strings in the `{ ok: false, error }` envelope are the ones lines 131 to 139 and `deriveEngine` (line 46) build today, word for word: `e2e/tests/skills-sync.test.ts` pins `no packs discovered`, and `commands/__tests__/skills-sync.test.ts:79-81` pins `deriveEngine`'s. The `--json` report keeps every key, step `name` and `status`; only the `detail` wording moved, in Step 3.

- [ ] **Step 5: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/skills-sync.ts",`.

- [ ] **Step 6: Run the suites**

Run: `bun test commands/__tests__/skills-sync.test.ts lib/skills/__tests__/sync.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/skills-sync.test.ts`
Expected: PASS, unchanged: it reads only `--json` bodies and exit codes.

Run: `grep -n 're-run\|drift=\|as pull-pack\|as update-pack\|by update-machine\|resolve manually\|never git-pulled' lib/skills/sync.ts`
Expected: no hits.

- [ ] **Step 7: Commit**

```bash
git add commands/skills-sync.ts lib/skills/sync.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/skills-sync.test.ts lib/skills/__tests__/sync.test.ts
```

```bash
git commit -m "skills sync prints through the layer, refusals as refused notes, and its step details in plain words

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `skills writing-style`

**Files:**
- Modify: `commands/skills-writing-style.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `commands/__tests__/skills-writing-style.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.note`, `out.json`, `out.payload`, `out.line`, `out.kv`, `out.callout`, `out.table`, `out.cmd`, `out.strong`, `out.dim`, `FailureInput`, `Block`; `usageFailure` (5a); `WRITING_STYLE_SOURCE_LABEL` (`lib/skills/writing-style.ts`, read and never edited); `personalSkillsDir` (`lib/skills/writing-style-sources.ts`).
- Produces: `WritingStyleDeps` gains `show: (...blocks: Block[]) => void`, `note: (...blocks: Block[]) => void` and `fail: (f: FailureInput) => void`; `print` stays `(s: string) => void` and now carries `--json` lines only.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/skills-writing-style.test.ts`, add `import { renderPlain } from "../../lib/ui/out-plain.ts";`, `import * as ui from "../../lib/ui/out.ts";` and `import { personalSkillsDir } from "../../lib/skills/writing-style-sources.ts";`, and give `fakeDeps` the three new members, which render to the same `out` array the tests already read:

```ts
    show: (...blocks) => { out.push(...renderPlain(blocks).replace(/\n$/, "").split("\n")); },
    note: (...blocks) => { out.push(...renderPlain(blocks).replace(/\n$/, "").split("\n")); },
    fail: (f) => { out.push(...renderPlain([ui.failure(f)]).replace(/\n$/, "").split("\n")); },
```

Then the four plain-output expectations:

- Line 38: `expect(out).toEqual(["Writing style: mattstack:writing-style-sparse", "  team default"]);`
- Lines 64 to 66:

```ts
    expect(out.some((l) => l.startsWith("mattstack:writing-style-sparse"))).toBe(true);
    expect(out).toContain("Also available (type the id):");
    expect(out.some((l) => l.startsWith("team-voice") && l.endsWith("current"))).toBe(true);
```

- Line 71: `expect(out.some((l) => l.startsWith("x:custom-note") && l.endsWith("current"))).toBe(true);`

and add:

```ts
describe("plain refusals", () => {
  test("use with no id off a terminal asks which, on the failure seam", async () => {
    mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });
    await expect(writingStyleUse([], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(out).toEqual(["Which writing style?", "  next: rt skills writing-style use <skill-id>"]);
  });

  test("a missing home repo points at setup", async () => {
    await expect(writingStyleUse(["mattstack:writing-style-sparse"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(out).toEqual(["Your home repo does not exist yet", "  next: rt setup"]);
  });

  test("a scope that is neither user nor team asks which, with no flag in the question", async () => {
    await expect(writingStyleUse(["mattstack:writing-style-sparse", "--scope", "everyone"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(out[0]).toBe("Is this style for you or for your team?");
    expect(out[0]).not.toContain("--scope");
  });

  test("an existing style is a refused note", async () => {
    mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });
    const target = join(personalSkillsDir(home), "team-voice");
    mkdirSync(target, { recursive: true });
    await expect(writingStyleNew(["team-voice"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(out).toEqual([`[refused] You already have a writing style called team-voice  ${target}`, "  next: Edit it, then run rt skills writing-style use team-voice"]);
  });
});
```

The first and last tests' `mkdirSync` creates what `homeGitDir(home)` (`lib/setup/steps/home.ts:18`) checks for: `<home>/.mattstack/user/.git`. The last one reaches the `exists` refusal at line 194: the name passes `NAME_RE`, `conversational` is a preset, and the folder is already there.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/skills-writing-style.test.ts`
Expected: FAIL. `show`, `note` and `fail` are not members of `WritingStyleDeps`, and the refusals still print `rt skills writing-style <verb>: ...` through `print`.

- [ ] **Step 3: Convert `commands/skills-writing-style.ts`**

Add:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
```

In `WritingStyleDeps`, replace the `print` member with:

```ts
  /** One --json line. Human output goes through show, note and fail. */
  print: (s: string) => void;
  show: (...blocks: Block[]) => void;
  note: (...blocks: Block[]) => void;
  fail: (f: out.FailureInput) => void;
```

and in `realWritingStyleDeps` (line 35):

```ts
    print: (s) => out.payload(`${s}\n`),
    show: (...blocks) => out.print(...blocks),
    note: (...blocks) => out.note(...blocks),
    fail: (f) => out.fail(f),
```

Replace `refuse` (lines 56 to 59):

```ts
function refuse(err: UserActionableError, json: boolean, deps: WritingStyleDeps, shown?: out.FailureInput): never {
  if (json) deps.print(JSON.stringify(userErrorPayload(err, deps.now())));
  else deps.fail(shown ?? { title: err.message });
  return deps.exit(2);
}

/** rt declining by rule (a name already taken): a refused note, never a failure. Same exit and --json as refuse. */
function decline(err: UserActionableError, json: boolean, deps: WritingStyleDeps, blocks: Block[]): never {
  if (json) deps.print(JSON.stringify(userErrorPayload(err, deps.now())));
  else deps.note(...blocks);
  return deps.exit(2);
}

const NO_HOME: out.FailureInput = { title: "Your home repo does not exist yet", next: out.cmd("rt setup") };
```

`refuse` no longer takes the verb name, so every call drops its third argument (`"use"` or `"new"`). The calls that gain shown copy:

- Both `no-home-repo` refusals (lines 118 and 182): `refuse(new UserActionableError("no-home-repo", "your home repo does not exist yet; finish rt setup first"), json, deps, NO_HOME)`.
- Both `bad-id` refusals (lines 114 and 136): add ``{ title: `${id} is not a skill id`, why: "A skill id is a lowercase name, with its plugin in front when it comes from one (plugin:name)." }``, where `id` is `given` at 114.
- The `--scope` usage refusal (line 115): add `usageFailure("Is this style for you or for your team?", "rt skills writing-style use <skill-id> --scope team", "Say user for just you, or team for everyone on your team.")`.
- The `use` usage refusal (line 132): add `usageFailure("Which writing style?", "rt skills writing-style use <skill-id>")`.
- The `unknown-skill` refusal (line 139): add ``{ title: `${id} is not installed here`, details: `Choose one of: ${choices}` }``.
- The `new` usage refusal (line 186): add `usageFailure("What should the new writing style be called?", "rt skills writing-style new <name>")`.
- The `bad-name` refusal (line 188): add ``{ title: `${name} cannot be the name of a writing style`, why: "Use lowercase letters, digits, dots, dashes and underscores." }``.
- The `bad-preset` refusal (line 191): add ``{ title: "That is not a preset to copy from", details: `Choose one of: ${PRESET_SHORT.join(", ")}` }``.
- The three `no-plugin` refusals (lines 204, 217, 220): add `{ title: "The mattstack plugin with the writing-style presets is not installed", next: out.cmd("rt setup") }` to the first and `{ title: "The installed preset could not be read", next: out.cmd("rt setup") }` to the other two.

The two `exists` refusals are policy refusals and become `decline`. Line 194:

```ts
  if (existsSync(target)) {
    return decline(new UserActionableError("exists", `${target} already exists`), json, deps, [
      out.line("refused", `You already have a writing style called ${name}`, target),
      out.callout("next", ["Edit it, then run ", out.cmd(`rt skills writing-style use ${name}`)]),
    ]);
  }
```

and line 241:

```ts
    return decline(new UserActionableError("exists", `${conflict.link} already exists`), json, deps, [
      out.line("refused", `Your Claude skills folder already has something called ${name}`, conflict.link),
      out.callout("note", "rt left it alone and removed the copy it had just made."),
    ]);
```

Every refusal's `--json` payload, code and exit code are unchanged.

`writingStyleShow`'s last line (72):

```ts
  deps.show(out.kv("Writing style", resolved.skill, WRITING_STYLE_SOURCE_LABEL[resolved.source]));
```

`writingStyleList`, from `const printRow` (line 81) to the end of the function:

```ts
  const row = (o: { id: string; detail: string; installed: boolean; kind: string }) => [
    o.id === listing.current.skill ? out.strong(o.id) : o.id,
    out.dim(`${o.detail}${o.installed || o.kind === "preset" ? "" : " (not installed here)"}`),
    o.id === listing.current.skill ? "current" : "",
  ];
  const known = new Set([...listing.options, ...listing.suggestions].map((o) => o.id));
  deps.show(
    out.table([
      ...listing.options.map(row),
      ...(known.has(listing.current.skill) ? [] : [[out.strong(listing.current.skill), "", "current"]]),
      ...(listing.suggestions.length > 0 ? [{ group: "Also available (type the id)" }, ...listing.suggestions.map(row)] : []),
    ]),
  );
```

The end of `writingStyleUse` (lines 142 to 143):

```ts
  deps.writeSetting(WRITING_STYLE_KEY, id, scope);
  if (json) deps.print(JSON.stringify(envelope({ skill: id, scope }, deps.now())));
  else deps.show(out.line("done", "Writing style set", `${id}, for ${scope === "team" ? "your team" : "you"}`));
```

The end of `writingStyleNew` (lines 244 to 246):

```ts
  if (json) deps.print(JSON.stringify(envelope({ name, path: target, from: presetId }, deps.now())));
  else deps.show(out.line("done", `Created ${name}`, target), out.callout("next", ["Edit it, then run ", out.cmd(`rt skills writing-style use ${name}`)]));
```

A plain table pads every cell but a row's last, so a row whose last cell is empty ends in two spaces. The plain renderer is not this slice's to change; the tests above assert `startsWith` and `endsWith` for that reason.

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete `  "commands/skills-writing-style.ts",`.

- [ ] **Step 5: Run the suites**

Run: `bun test commands/__tests__/skills-writing-style.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/skills-writing-style.test.ts`
Expected: PASS, unchanged: it reads only `--json` bodies and exit codes.

Run: `grep -rln "WritingStyleDeps\|fakeDeps(" lib commands --include='*.ts'`
Expected: `commands/skills-writing-style.ts` and its test only. Any other file that builds a `WritingStyleDeps` needs `show`, `note` and `fail` members.

- [ ] **Step 6: Commit**

```bash
git add commands/skills-writing-style.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/skills-writing-style.test.ts
```

```bash
git commit -m "skills writing-style prints through the layer, and a taken name is a refused note

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The skipped-plugin warning (row 43 of 5a's table)

**Files:**
- Modify: `lib/skills/sources.ts:71`
- Modify: `lib/__tests__/raw-output-allowlist.json`
- Modify: `lib/skills/__tests__/sources.test.ts`

**Interfaces:**
- Consumes: `warn(module: string, message: string, opts?: { context?: Record<string, unknown>; show?: { title: string; hint?: string; next?: CellInput } }): void`, `setWarningLog(log: WarningLog | null, opts?: { quiet?: boolean }): void`, `__test__.reset()` (`lib/ui/warn.ts`, 5a); `captureOut` (`lib/ui/__tests__/capture-out.ts`).
- Produces: no new export.

- [ ] **Step 1: Write the failing tests**

In `lib/skills/__tests__/sources.test.ts`, add the imports:

```ts
import * as out from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../ui/warn.ts";
```

Replace the body of the test that spies `console.error` at line 449 (from `const errorSpy` to its last three assertions) with:

```ts
    const io = captureOut();
    out.__test__.setHuman(() => false);
    warnTest.reset();
    const logged: Array<{ module: string; message: string }> = [];
    setWarningLog((module, message) => {
      logged.push({ module, message });
    });
    let roots: PluginRoots;
    let shown: string;
    try {
      roots = buildPluginRoots([
        { id: "mattstack@mattstack", installPath: mattstackDir },
        { id: "current-time@mattstack", installPath: staleInstallPath },
        { id: "acme@acme", installPath: acmeDir },
      ]);
      shown = io.stderr();
      expect(io.stdout()).toBe("");
    } finally {
      warnTest.reset();
      io.restore();
    }

    expect(roots.byName.mattstack).toEqual({ dir: mattstackDir, version: "1.2.0" });
    expect(roots.byName.acme).toEqual({ dir: acmeDir, version: "0.3.0" });
    expect(roots.byName["current-time"]).toBeUndefined();

    expect(logged).toEqual([{ module: "skills", message: `skipping plugin "current-time" -- installPath does not exist: ${staleInstallPath}` }]);
    expect(shown).toBe("[warning] Skipped the current-time plugin  its folder is gone\n");
```

and the body of the next test (line 478), which asserts nothing is printed:

```ts
    const io = captureOut();
    let roots: PluginRoots;
    let printed: string;
    try {
      roots = buildPluginRoots([
        { id: "mattstack@mattstack", installPath: fixtureRoots.byName.mattstack!.dir },
        { id: "acme@acme", installPath: fixtureRoots.byName.acme!.dir },
      ]);
      printed = io.stderr() + io.stdout();
    } finally {
      io.restore();
    }

    expect(roots.byName.mattstack?.version).toBe("1.2.0");
    expect(roots.byName.acme?.version).toBe("0.3.0");
    expect(printed).toBe("");
```

Drop `spyOn` from the `bun:test` import if nothing else in the file uses it.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/skills/__tests__/sources.test.ts`
Expected: FAIL. `logged` is empty and stderr is empty: the line still goes through `console.error`, which the stream capture does not see.

- [ ] **Step 3: Convert the line**

In `lib/skills/sources.ts`, add `import { warn } from "../ui/warn.ts";` and replace line 71:

```ts
      warn("skills", `skipping plugin "${name}" -- installPath does not exist: ${entry.installPath}`, {
        show: { title: `Skipped the ${name} plugin`, hint: "its folder is gone" },
      });
```

The log message is today's text without the `rt: ` prefix, as 5a's table says.

- [ ] **Step 4: Delete the allowlist line and run**

In `lib/__tests__/raw-output-allowlist.json`, delete `  "lib/skills/sources.ts",`.

Run: `bun test lib/skills/__tests__/sources.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS. `lib/ui/warn.ts` is importable from a file the daemon loads (5a's constraint), so the last two guards stay green; if either names `lib/skills/sources.ts`, stop and report it rather than editing a guard.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/sources.ts lib/__tests__/raw-output-allowlist.json lib/skills/__tests__/sources.test.ts
```

```bash
git commit -m "lib/skills: the skipped-plugin warning goes through warn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Renders, the reader check, AGENTS.md and every gate

**Files:**
- Modify: `plugins/mattstack/plugin/skills/editing-skills/SKILL.md` (lines 336 to 337 and 490 to 491 only), `plugins/mattstack/.claude-plugin/plugin.json` (the version only)
- Modify: `AGENTS.md` ("Output layer" section: append; never rewrite what is there)
- Modify: `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/skills-dark.png`, `docs/design/output-layer/skills-light.png`

**Interfaces:**
- Consumes: everything above; `ui/dist/rt-ui` (run `bun run ui:build` once if `ui/dist/rt-ui` is missing; this slice changes nothing under `ui/`).
- Produces: the renders the PR carries, and the two skill sentences that quote reworded output.

- [ ] **Step 1: Update the two skill sentences that quote reworded output**

`plugins/mattstack/plugin/skills/editing-skills/SKILL.md:336-337` tells an agent the bare check "prints the same lag as `installed cache: lagging (<a> installed vs <b> source)`", which Task 6 changed. AGENTS.md "plugins/mattstack" governs this file: it keeps the plugin's own Markdown style (never rt's formatter), and the `plugin-mattstack` CI job runs certify, `rt skills check --strict` and the mcp-tools reference diff, and fails a PR that changes the plugin without bumping `.claude-plugin/plugin.json`'s version. Matt's rules require loading `superpowers:writing-skills` and `mattstack:editing-skills` before touching any skill, a one-sentence wording fix included; invoke both first.

Replace the sentence ending at line 337 so the two lines read:

```markdown
`sourceVersion`), not the success. The bare Bash check prints the same lag
as `[out of date] The installed copy is behind the source  <a> installed, <b> in the source`.
```

That is the plain text Task 6's `installedCacheBlocks` writes off a terminal, which is what an agent's Bash tool reads (`commands/__tests__/skills-report-output.test.ts` pins it).

Lines 490 and 491 tell an agent that "sync refuses with `content drift survives recompile` and leaves its bump and compiled output in the pack working tree for you to carry forward", which Task 11 reworded (`lib/skills/sync.ts:426-428`). Replace that sentence's quoted words so the passage reads:

```markdown
that yet. When content drift survives that recompile, sync refuses with
`The compiled skills are still out of date after a recompile` and leaves its bump and compiled output
in the pack working tree for you to carry forward. An in-tree plugin is
```

Rewrap only those lines to the paragraph's width if the plugin's Markdown style asks for it; keep the words. The quoted words are the opening sentence of the recheck refusal's detail, which an agent sees on the Bash tool's stderr as the refused note's `why` and in the `--json` report's `steps[].detail`.

Change nothing else in the file: the description (line 3) keeps its trigger phrase "an installed cache is lagging", since a description edit needs the desc-test run, and lines 342, 349 to 351 and 527 stay true (Task 2's reader table).

Then the version, per cross-phase ruling 13 (never a literal version in this plan): run `git fetch origin` alone, read the base version with `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json`, and set `"version"` in `plugins/mattstack/.claude-plugin/plugin.json` to one patch above it.

Run, one at a time:

- `sh tests/certify.sh plugin/skills/editing-skills/`, with `plugins/mattstack` as the working directory (the `plugin-mattstack` job runs it there: `checks.yml`, "Certify every skill and attachment dir"; the script resolves its own paths from its folder and checks the skill folder relative to the working directory)
- from the repo root: `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack`
- from the repo root: `bun cli.ts skills check --pack-dir plugins/mattstack --mattstack-dir <scratchpad>/mattstack --strict` (the CI step at `checks.yml:270`; make the folder first)

Expected: each exits 0. Do not edit `plugins/mattstack/CERTIFICATION.md`: its ledger rows are appended by the shepherd. Put this row in the task report for it to append: `| <date> | mattstack:editing-skills | pure | pass | n/a (no description edit) | Two quotes of rt output updated to its new wording: the bare check's lag line ([out of date] The installed copy is behind the source) and sync's recheck refusal (The compiled skills are still out of date after a recompile) |`.

```bash
git add plugins/mattstack/plugin/skills/editing-skills/SKILL.md plugins/mattstack/.claude-plugin/plugin.json
```

```bash
git commit -m "editing-skills: quote the bare check's lag line and sync's recheck refusal as rt now prints them

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: Check nothing else scrapes the text this slice reworded**

Run each alone:

- `grep -rn "installed cache:\|misplaced:\|would write\|no moves needed\|fragment updated\|Everything already linked\|drift=\|pulled once\|content drift survives\|resolve manually and re-run\|reverted plugin.json" plugins/mattstack skills apps/board/skills-src apps/console/src --include='*.md' --include='*.sh' --include='*.ts' --include='*.tsx'`
- `grep -rn "rt skills: \|rt skills expand: \|rt skills sync: \|rt skills init: \|rt skills audit: \|rt skills link: \|rt skills writing-style " plugins/mattstack skills apps/board/skills-src .github scripts --include='*.md' --include='*.sh' --include='*.yml' --include='*.ts'`

Expected: no hit that reads a verb's text (`docs/superpowers/` history under `plugins/mattstack` may quote old output as a record; it is not a reader). Task 2's reader table lists the prose mentions that stay true (`editing-skills/SKILL.md:342, 349-351, 527`, `extending-a-pack/SKILL.md:180`) and `apps/console`, which shows details verbatim. A hit that names a command (`rt skills writing-style use ...`) rather than quoting its output is not a reader. A new hit that quotes old wording as something to match is fixed in this PR, the way Step 1 fixed `editing-skills`, and named in the report.

- [ ] **Step 3: Write the render input**

In the session scratchpad (not the repo), write `skills-blocks.ts`, replacing `<repo>` with the worktree's absolute path. All names are invented:

```ts
// usage: bun skills-blocks.ts > skills.ndjson
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { bindBlocks, checkBlocks, compileBlocks, compileFailure, misplacedFailure, packsBlocks, surfaceBlocks } from "<repo>/commands/skills.ts";
import { linkBlocks } from "<repo>/commands/skills-link.ts";
import { initRefusalBlocks } from "<repo>/commands/skills-init.ts";
import { syncBlocks, syncRefusal } from "<repo>/commands/skills-sync.ts";
import type { SyncReport } from "<repo>/lib/skills/sync.ts";

const refusedSync: SyncReport = {
  ok: false,
  pack: "acme",
  steps: [
    { name: "guards", status: "ran", detail: "engine and pack checkouts clean on main" },
    { name: "check", status: "refused", detail: "This pack is strict, and mcp lint found 2 hits. Fix them before syncing" },
  ],
  versions: { engine: { before: "1.0.0", after: "1.0.0" }, pack: { source: "0.5.3", installedBefore: "0.5.3", installedAfter: "0.5.3" } },
  warnings: [],
  restartNeeded: false,
};

const blocks = [
  out.section("skills check", undefined),
  ...checkBlocks(
    {
      pack: "acme",
      packDir: "/z/packs/acme",
      verbs: [
        { name: "watch-ci", status: "in-sync", staleFiles: [], orphanFiles: [], side: "skills" },
        { name: "ship", status: "stale", staleFiles: ["SKILL.md"], orphanFiles: ["old.md"], side: "skills", staleBecause: ["source", "fill"] },
        { name: "review", status: "never-compiled", staleFiles: [], orphanFiles: [], side: "attachments" },
      ],
      chainErrors: [],
      installed: { plugin: "acme", marketplace: "beacon", version: "0.5.2", sourceVersion: "0.5.3", status: "lagging" },
      drift: true,
      mcpLint: [],
      scriptLint: [],
      strictLint: false,
    },
    false,
  ),
  out.section("skills compile", undefined),
  ...compileBlocks(
    [
      { name: "watch-ci", side: "skills", files: 3, warnings: ["slot forge is bound but unused"] },
      { name: "ship", side: "attachments", files: 1, warnings: [] },
    ],
    true,
  ),
  out.failure(compileFailure(['verb "review": slot "forge" has no binding in /z/repos/widgets/packs/acme/skills.jsonc'])),
  out.failure(misplacedFailure(["helper"])),
  out.section("skills packs and surface", undefined),
  ...packsBlocks([
    { name: "acme", dir: "/z/packs/acme", layout: "team" },
    { name: "mattstack", dir: "/z/plugins/mattstack", layout: "plugin" },
  ]),
  ...surfaceBlocks("acme", "pack/surface.jsonc", [
    { name: "watch-ci", kind: "compiled", status: "public" },
    { name: "helper", kind: "hand-authored", status: "internal" },
  ]),
  out.changes([
    { op: "+", name: "helper", hint: "becomes public" },
    { op: "-", name: "watch-ci", hint: "becomes internal" },
  ]),
  out.section("skills bind, link and sync", undefined),
  ...bindBlocks({ verb: "stage-plan", slot: "domain", from: "(unbound)", to: "acme:plan-policy", dryRun: false, fragmentUpdated: "/z/packs/acme/pack/skills.jsonc", basePack: null }),
  ...linkBlocks(
    "/r/skills",
    "/h/.claude/skills",
    {
      changed: true,
      actions: [
        { kind: "create", name: "alpha", link: "", target: "", detail: null },
        { kind: "prune", name: "gamma", link: "", target: null, detail: "the skill it pointed at is gone: /r/skills/gamma" },
        { kind: "conflict", name: "delta", link: "", target: "", detail: "a file or folder rt did not make has this name" },
      ],
    },
    false,
  ),
  ...syncBlocks(refusedSync),
  ...syncRefusal(refusedSync)!,
  out.section("skills init and writing-style refusals", undefined),
  ...initRefusalBlocks({
    ok: false,
    refused: true,
    code: "zone-has-pack",
    detail: "The acme zone already has a team pack, and a zone holds only one (a base pack can sit beside it)",
    next: "rt team create <name> --remote <url>",
  }),
  out.line("refused", "You already have a writing style called team-voice", "/h/.claude/skills/team-voice"),
  out.callout("next", ["Edit it, then run ", out.cmd("rt skills writing-style use team-voice")]),
  out.failure({ title: "Which verb should be previewed?", next: out.cmd("rt skills compile --preview --verb <name>") }),
];
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + blocks.map(encodeLine).join(""));
```

Also write `ansi-page.ts` in the scratchpad. It turns the helper's ANSI into one HTML page on a dark or a light ground:

```ts
// usage: bun ansi-page.ts <dark|light> <title> < ansi.txt > page.html
const [mode, title] = [process.argv[2] ?? "dark", process.argv[3] ?? "render"];
const page = mode === "light" ? { bg: "#FFFFFF", fg: "#1F1F1F" } : { bg: "#161224", fg: "#E6E0FF" };
const input = await new Response(Bun.stdin.stream()).text();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let html = "";
let open = false;
let style: Record<string, string> = {};
const flush = () => {
  if (open) html += "</span>";
  const css = Object.entries(style).map(([k, v]) => `${k}:${v}`).join(";");
  open = css !== "";
  if (open) html += `<span style="${css}">`;
};
const tokens = input.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").split(/(\x1b\[[0-9;]*m)/);
for (const token of tokens) {
  const sgr = token.match(/^\x1b\[([0-9;]*)m$/);
  if (!sgr) {
    html += esc(token);
    continue;
  }
  const codes = sgr[1] === "" ? [0] : sgr[1]!.split(";").map(Number);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0) style = {};
    else if (c === 1) style["font-weight"] = "bold";
    else if (c === 4) style["text-decoration"] = "underline";
    else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      style[c === 38 ? "color" : "background"] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
      i += 4;
    }
  }
  flush();
}
if (open) html += "</span>";
process.stdout.write(
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="margin:24px;background:${page.bg};color:${page.fg}"><pre style="font:14px/1.45 Menlo,monospace">${html}</pre></body>\n`,
);
```

- [ ] **Step 4: Render and screenshot both schemes**

From the scratchpad, one command at a time:

```bash
bun skills-blocks.ts > skills.ndjson
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 100 < skills.ndjson > skills-dark.ansi
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 100 < skills.ndjson > skills-light.ansi
bun ansi-page.ts dark skills < skills-dark.ansi > skills-dark.html
bun ansi-page.ts light skills < skills-light.ansi > skills-light.html
```

Serve the scratchpad over http on 127.0.0.1 (`python3 -m http.server 4174 --bind 127.0.0.1`; `file:` is blocked) and screenshot both pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save them as `docs/design/output-layer/skills-dark.png` and `docs/design/output-layer/skills-light.png`.

Read both PNGs and write down plainly what reads wrong. Check these in particular, on both backgrounds:

- Coral appears only on the three failures and on no stale, pending, refused, off or warn row.
- The stale rows: is `source, fill moved: SKILL.md, old.md (orphan)` readable as a hint, or does it run into the title?
- The long compile diagnostic under `1 verb did not compile` wraps inside the pane and keeps its path whole.
- The `From` and `To` keys of the link section, and the `needs you` row.
- The refused sync, the refused init and the refused writing style: each `refused` line and its `why` or `next` read as a decision rt made, not a failure, and none is coral.

A fault found here is fixed in the task that owns the code, re-rendered, and named in the report. Do not declare success from the tests.

- [ ] **Step 5: Update `docs/design/output-layer/README.md`**

Add one row to its table:

```markdown
| `skills-dark.png`, `skills-light.png` | `rt skills` at 100 columns: a check with stale, never-compiled and behind-the-source rows, a compile with a warning, a compile failure and a misplaced skill, the packs and surface tables with a palette delta, a bind, a link report with a conflict, a refused sync, and the refused `skills init` and `writing-style new` lines |
```

- [ ] **Step 6: Append to `AGENTS.md`**

At the end of the "Output layer" section (after its last paragraph, before the next `##` heading), append:

```markdown
A verb that prints a report builds it in a pure function that returns blocks
(`checkBlocks`, `syncBlocks`, `linkBlocks` in `commands/skills*.ts`) and prints
it with one `out.print`; the tests pin that function through `renderPlain`,
so no test needs a console spy. A pack author's compile diagnostics (the
`lib/skills` errors that name a file, a slot and a line) keep their exact
words, because they also sit inside `--json` values: a `SkillsUsageError`'s
`message` never changes for the sake of the screen, and wording meant for a
person goes in its `shown` failure. Any other sentence a person reads takes
plain copy even when an envelope carries it, with the envelope's keys and
machine-read values kept. A refusal by policy is `out.note` with a
`refused` line, never `out.fail`.
```

Wrap at about 78 columns like the paragraphs above it.

- [ ] **Step 7: Run every gate**

Run each from the repo root, one at a time:

- `bun run typecheck`
- `bun run test`
- `bun run test:e2e`
- `bun run picker:check`
- `bun run format:check`
- `bun run check` (what the `static` CI job runs)
- `bun cli.ts skills check --pack-dir plugins/mattstack --mattstack-dir <scratchpad>/mattstack --strict` (the CI step at `checks.yml:270`; expected exit 0 and a list of `[ok] <verb>  current` lines ending `[ok] mcp lint  clean`)
- `bun cli.ts skills compile --dry-run --pack-dir plugins/mattstack --mattstack-dir <scratchpad>/mattstack` (the CI step at `checks.yml:274`; expected exit 0)

Expected: all pass. `bun run ui:build`, `ui:test` and `test:pty` are not needed for a change of this slice's own: nothing under `ui/` changed and the spec names no pty test for these verbs; run `bun run test:pty` anyway if the rebase in Task 15 brought `ui/` changes in. `bun run docs:gen` is not needed: no command description or argument changed. Known noise, per the herd notes: about ten rotating load flakes in the unit suite (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config) and the `rt plugin new` e2e on this machine. A failure in a file this slice did not touch that passes when its file runs alone is a flake; say so in the report with both results.

Run: `grep -n "commands/skills\|lib/skills/sources.ts" lib/__tests__/raw-output-allowlist.json`
Expected: no lines.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/skills-dark.png docs/design/output-layer/skills-light.png
```

```bash
git commit -m "docs: output layer renders for rt skills, and the report-builder rule

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch.
- Produces: one PR against `m4ttstack/mattstack`.

- [ ] **Step 1: Rebase**

Run: `git fetch origin`
Run: `git rebase origin/main`

Other slices and phase 3 may have merged. Merge by hand, per ruling 7:

- `lib/__tests__/raw-output-allowlist.json`: keep every deletion from both sides.
- `AGENTS.md` "Output layer": keep their paragraphs, then this slice's.
- `docs/design/output-layer/README.md`: keep their rows, then this slice's.
- `plugins/mattstack/.claude-plugin/plugin.json`: expect a conflict here whenever another plugin PR merged first. Resolve it to one patch above the version in `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json` (the `origin/main` just rebased onto), never to a literal from this plan (cross-phase ruling 13).

After every rebase, conflict or not, run `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack`. If it fails, bump to one patch above `origin/main`'s version and commit that alone (`plugin.json: bump above main after rebase`, with the trailer).

If phase 3 merged and reworded `WRITING_STYLE_SOURCE_LABEL`, `skills-writing-style.test.ts` pins `team default` as the source line; change that one expectation to the new label and nothing else.

- [ ] **Step 2: Re-run the gates after the rebase**

Run, one at a time: `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run picker:check`, `bun run format:check`, `bun run check`.
Expected: all pass, with the same known noise as Task 14 Step 7.

- [ ] **Step 3: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the branch's same-named upstream).

- [ ] **Step 4: Open the PR**

Run: `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5d1, skills" --body-file <scratchpad>/pr-body-5d1.md`

The body, in the style of PR 639: one framing paragraph; bold-labelled bullet groups (**Skills**: compile, check, packs, composition, materialize, surface, bind on blocks, with `SkillsUsageError.shown` for the usage copy; **The six smaller verbs**: audit, expand, init, link, sync, writing-style; **Notes and payloads**: the pack notes and shadow warning through `out.note`, the preview body through `out.payload`, the skipped-plugin warning through `warn`; **Copy**: the `lib/skills` link, sync and init sentences in plain words (envelope shapes kept), policy refusals drawn as `refused` notes on stderr; **Also**: `skills surface`'s yes or no question is the rt-ui confirm, `skills init` refusals and failures now go to stderr, `editing-skills` quotes the new lag line (plugin patch bump), eight files off the allowlist; **Follow-up**: 5d2 carries `plugin`, `tools`, `deps`, `hooks` and `intercept`; the materialize skip reason still names a step id and is phase 3's file; `lib/skills/sync.ts` marks a failed git pull, plugin update or compile `refused`, which the human output draws as a failure by step name, and a `reason` code on `SyncStep` would let the `--json` report say so too); the two renders; a verification line with the gate results; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Report**

Report the PR url, the gate results, the flakes seen with both results, what the renders showed, and the `CERTIFICATION.md` ledger row from Task 14 Step 1 for the shepherd to append. Tell the shepherd, in those words: if any other PR touching `plugins/mattstack` merges before this one, this branch rebases, re-bumps `plugin.json` to one patch above `origin/main`, re-runs `plugin-version-bumped.ts` and CI, and only then merges. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the scoping document and the spec do not settle

Each is the plan's best reading; Matt or the reviewer may overrule one before execution.

1. **Compile diagnostics keep their words (the controller's exception, as ruled).** The spec's copy style says to leave out flags, paths and internal names. The 55 compile-time `throw` sites in `lib/skills/compile.ts`, `placeholders.ts`, `layout.ts`, `sources.ts` and `expand.ts` are a pack author's compiler errors: the file, slot, placeholder and line are the message, the same strings sit inside `--json` values, and about 110 test lines pin them. This plan changes their frame (no `rt skills:` prefix, a failure block). Everything else a person reads takes the copy pass: thirteen `SkillsUsageError`s gain `shown` copy, and the `link.ts`, `sync.ts` and `init.ts` sentences are reworded in place (Task 2's copy tables).
2. **`SkillsUsageError` carries two texts.** `message` stays technical and frozen; `shown` is the failure a person reads. The alternative, rewording `message`, would change `error` strings inside several `--json` envelopes that `rt_verb` callers and `e2e/tests/skills-sync.test.ts` read. The `lib/skills` details are different: no program reads their wording, so they are reworded at the source, keeping the envelope's keys and machine-read values.
3. **`skills surface`'s confirm becomes the rt-ui prompt.** The scoping document says a verb already on rt-ui is not converted; the palette is rt-ui, but the question after it is a raw `readline` on stderr, which the guard flags. Moving it to `confirm` is the only way the file leaves the allowlist without an exemption.
4. **`skills init` refusals and failures move from stdout to stderr, and only three of its ten refusal codes are drawn as refusals.** `pack-exists`, `zone-has-pack` and `zone-mismatch` are rt declining by rule, so each is a `refused` note. The other seven (`not-a-repo`, `no-remote`, `mattstack-missing`, `claude-missing`, `zone-missing`, `zone-ambiguous`, `invalid-namespace`) are a missing prerequisite or a usage slip, so each is a failure. All keep exit 2 and `refused: true` in `--json`.
5. **The stale line drops the word "stale".** Off a terminal it reads `[out of date] <verb>  source, fill moved: <files>`. `editing-skills/SKILL.md:342, 527` say the bare check "names what moved on each stale line", which stays true. Line 337 quoted the old lag line verbatim and is updated in this PR (Task 14 Step 1). If Matt wants the literal word "stale" kept for an agent grepping the tail, the hint can lead with it.
6. **`materialize`'s skip reason is printed as it is.** `engine-pack-missing: install the mattstack plugin first (plugins.install), then rerun` comes from `lib/setup/skills-materialize.ts`, which is under `lib/setup/` and not this slice's. It names a step id; rewording it falls to phase 3 or a follow-up.
7. **A sync policy refusal is a `refused` note on stderr, exit 1; a failed step is a `failure` on stderr, exit 1.** stdout carries the steps up to the one that stopped the run; the stopping step is told once, by the note or the failure, so its detail is not printed twice. `lib/skills/sync.ts` also marks four steps `refused` when a command failed (a failed git pull, a failed `claude plugin update` or marketplace update, a compile error with the version put back). `SyncStep` carries only `name`, `status` and `detail`, but the step name tells the two apart at head: those four steps refuse only after a failed command, and `guards`, `check`, `bump` and `recheck` refuse only by rule. So the human output draws those four as failures from the step name alone, with no string matching, and `--json` keeps `refused`. Recording the kind in the report (a `reason` code on `SyncStep`) would be the sturdier fix, but it adds a key to the `--json` report, so it is left for a follow-up rather than done here. The exit code stays 1 throughout, as today.
8. **`WritingStyleDeps` keeps `print` for the `--json` line and gains `show`, `note` and `fail`.** The seam printed JSON and prose through one function; splitting it keeps every existing JSON test untouched.
9. **A compile with nothing to compile now prints one line** (`Nothing to compile`), where it printed nothing. A reasonable person reads an empty screen as a hang.
10. **`resolvePack`'s "No packs found" names two flags in its `next`.** `resolvePack` serves compile, check, composition, bind and surface and is not told which verb called it, so its `next` is `Run it again with --pack <name> or --pack-dir <folder>`, each styled as a command, rather than a full command line. Threading the verb through both callers would change `resolveForCompile`'s signature for one sentence.
11. **The init `remedy` becomes `{ commands, folder? }`.** It is in no envelope, and as one string every remedy began `then: ` and drew as one styled command. A list puts each command in its own `cmd`; `folder` lets the write failure say what to delete without a destructive command in the `next`.

## Self-Review

**Spec coverage.** Scoping section 3 "5d", first half of the second cut: `commands/skills.ts` (Tasks 4 to 8), `skills-audit.ts` and `skills-expand.ts` (Task 9), `skills-init.ts` and `skills-link.ts` (Task 10), `skills-sync.ts` (Task 11), `skills-writing-style.ts` (Task 12), `lib/skills/sources.ts` (Task 13); the `lib/skills/` copy audit (Task 2's copy tables, applied in Tasks 10 and 11). Shared item 1 (the `sources.ts` warning, Task 13) and item 8 (`usageFailure` at the `skills-writing-style` usage sites and the others, Tasks 4, 9, 11 and 12). Section 5 readers: `rt_verb` (Review Focus 1, Tasks 4 and 8), CI exit codes (Task 14 Step 7), `compile --preview` through `out.payload` (Task 5), the compile marker left alone (Task 2), the two skill sentences that quoted changed wording (Task 14 Step 1), and `apps/console`, which shows sync details verbatim and needs no edit. Must-not-touch: `lib/setup/**` (including `skills-link-bundled.ts`, which only reads `kind` and `changed`), `lib/setup/tools-install.ts` and `WRITING_STYLE_SOURCE_LABEL` are not edited. Spec "Testing": characterization (Task 3), plain-renderer assertions per verb, both-scheme renders (Task 14). The spec names no pty test for these verbs. `lib/plugins.ts:346` and everything else in the second half of the cut is the 5d2 plan's.

**Rulings applied.** Copy inside envelopes: the `lib/skills` link, sync and init sentences and the five `SkillsUsageError`s that carried a command take plain copy with shapes kept; only the compile diagnostics and the `SkillsUsageError` messages (whose screen form is `shown`) keep their words. Policy refusals: `skills sync`'s rule refusals (`guards`, `check`, `bump`, `recheck`), `skills init`'s three policy codes and `writing-style new`'s `exists` are `refused` notes on stderr; the sync steps marked `refused` after a failed command are drawn as failures (Decision 7). Plugin version (ruling 13): no literal version; one patch above `origin/main` after a fresh fetch, re-checked after every rebase, and the shepherd told to re-bump if another plugin PR lands first. Steps versus the transient spinner: no verb here gains either; `skills sync` prints its finished report, as today.

**Placeholders.** None. `<repo>` and `<scratchpad>` in Tasks 14 and 15 are the implementer's own absolute paths, named as such. Two steps name a fixture detail the plan could not run (Task 4's enclosing-pack fixture, Task 6's repo row cast) and say exactly which existing code settles it and which assertions stay fixed.

**Type consistency.** `SkillsUsageError(message, shown?)`, `skillsFailure`, `CompiledRow`, `compileBlocks`, `compileFailure`, `misplacedFailure`, `installedCacheBlocks`, `checkBlocks`, `packsBlocks`, `CompositionPayload`, `compositionBlocks`, `materializeBlocks`, `SurfaceRow`, `surfaceBlocks`, `bindBlocks`, `InitRemedy`, `POLICY_REFUSALS`, `initOutcomeBlocks`, `initRefusalBlocks`, `initFailure`, `linkBlocks`, `syncBlocks`, `syncRefusal`, `syncFailure`, `captureSkills`, `runExpectingCleanExit` and the `WritingStyleDeps` members `print`, `show`, `note`, `fail` are spelled the same in the Interfaces blocks, the code and the tests. `countOf` is defined in Task 5 and used in Task 6 in the same file.

**Review Focus.** Six items, each pinned to a named test in Tasks 4 to 8 and 10 to 12.
