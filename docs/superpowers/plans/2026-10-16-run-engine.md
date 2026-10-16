# Run Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move pipeline run bookkeeping (enter, next, resolve, hold, close, budgets) into MCP tools over the run DB, and make `rt skills compile` emit `pack/pipelines.json` and fail packs whose skills read a run field nothing writes.

**Architecture:** Pure functions over an open `bun:sqlite` `Database` in `lib/runs/engine.ts` and `lib/runs/enter.ts`; one structured entry point in `commands/runs-write.ts` that resolves/opens the DB, runs the op, emits `run-updated`; six thin MCP tool defs in `lib/mcp/run-tools.ts`. Compiler side: `lib/skills/pipeline-manifest.ts` and `lib/skills/field-contract.ts`, wired at three call sites in `commands/skills.ts`.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-16-run-engine-design.md` (read it; this plan argues from it).

## Global Constraints

- Write only under: `lib/runs/**`, `lib/mcp/run-tools.ts`, `lib/mcp/tools.ts` (none expected), `lib/skills/**` (not `buildPluginRoots`), `commands/runs-write.ts`, `commands/skills.ts` (call sites only), the `__tests__` beside them, `plugins/mattstack/attachments/mcp-tools/reference.md` and the `version` line of `plugins/mattstack/.claude-plugin/plugin.json` (Task 10 only), `docs/superpowers/plans/`, `.superpowers/`. No skill edits.
- Run tests from the worktree root: `bun test <file>`; never `cd` into a subdirectory first. Targeted files only.
- A built `rt` binary only ever runs under an isolated HOME. `bun cli.ts ...` against real packs also runs under `env -i HOME=<scratch> PATH="$PATH" RT_SKIP_SETUP=1 RT_BATCH=1`.
- No `console.*` or `process.stdout/stderr` writes under `lib/` or `commands/` (`lib/__tests__/no-raw-output.test.ts`).
- Comments only state a constraint the code cannot show.
- Field keys the hook and console read are frozen: `hold`, `waiting-gate`, `gate`, `pipeline-stages`, `shipTarget`; decision scopes `hold:<stage>:<n>` with `{reason}` and `redirect:<from>:<n>` with `{from,to,reason}`; contract `gate@1`.
- The engine never writes `gate` or `waiting-gate`, never records a gate's own decision, never opens a gate, never refuses on a spent budget.
- Multi-row writes run inside `db.transaction(...)`.
- Commit after each task: short imperative subject, then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Two `run_next` calls for the same finished stage** (a retry after compaction, two panes): the second returns the same `done` result with `repeated: true` and the next stage still has exactly one running row. Test in Task 6.
- **A produce holding whitespace or ` - `**: counts as missing (values are trimmed before the `''`/`-` check, as the console does). Test in Task 6.
- **Field-reference shapes in real skills**: `key: "mr"`, `key: extra.plan-verdict}` inside a dot label, `key: shipTarget,`, a templated `key: extra.context-dropped.<scope>`, and the shell form `rt runs field get mode` must scan to the right key or template. Test in Task 3.
- **A `pipelines.json` entry whose `file` escapes the pack** (`../x/SKILL.md`, `/abs/SKILL.md`): parse refuses, so `run_enter` never hands an agent a path outside the pack. Test in Task 2.
- **`run_resolve` with `to` misspelled or later than `stage`**: refused, naming the manifest stages; nothing written. Test in Task 7.

---

### Task 1: Run DB schema v3, the double-start refusal, snapshot additions

**Files:**
- Modify: `lib/runs/write.ts`
- Test: `lib/runs/__tests__/write.test.ts`; fix any existing test under `lib/runs/__tests__/`, `lib/mcp/__tests__/` or `commands/__tests__/` that starts a stage twice while its row is running (grep `stage-start` / `stageStart` / `action: "start"`).

**Interfaces:**
- Produces: `KNOWN_SCHEMA_VERSION = 3`; tables `manifest(run_id, ordinal, stage, name, file, pack_root, consumes, produces)` and `budgets(run_id, key, spent, "limit", updated_at)` exactly as the spec's SQL; `stageStart(db, name, env, now?)` returns `{ ok: false, code: 2, error: "stage <name> attempt <n> is still running; end it (done, fail or redirect) before starting another, or resume it with run_enter" }` when refused; `snapshot(db)` result gains `manifest: Row[]` (ordered by ordinal) and `budgets: Row[]` (ordered by key).

- [ ] **Step 1: Write failing tests** in `write.test.ts`:
  - `createRunDb stamps user_version 3 and creates manifest and budgets`
  - `migrate upgrades a v2 db: adds both tables, stamps 3, keeps rows` (build a v2 DB with the old schema SQL and `PRAGMA user_version=2`, then `openRunDb`)
  - `stage-start refuses while the latest attempt is running` (start `plan` twice: second returns `ok: false`, `code: 2`, error contains `stage plan attempt 1 is still running`; `SELECT COUNT(*) FROM stages` is 1)
  - `stage-start after done or failed starts the next attempt` (attempt 2 inserted)
  - `snapshot returns manifest and budgets arrays` (empty arrays on a fresh run)
- [ ] **Step 2:** `bun test lib/runs/__tests__/write.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement.** Append both `CREATE TABLE IF NOT EXISTS` statements to `SCHEMA_SQL`; in `migrate`, run them after the existing column adds and stamp only when both tables exist. Make `stageStart`'s insert conditional in the same statement (`... FROM runs WHERE NOT EXISTS (SELECT 1 FROM stages s WHERE s.name = ? AND s.status = 'running' AND s.attempt = (SELECT MAX(attempt) FROM stages WHERE name = ?))`); on `changes() === 0`, read the latest attempt for the message and return the refusal without touching `current_stage` or identity. Add the two arrays to `snapshot`.
- [ ] **Step 4:** Run `write.test.ts`, then grep and run every test file that drives stage starts (`lib/runs/__tests__/*.test.ts`, `lib/mcp/__tests__/run-tools.test.ts`, `commands/__tests__/` files matching `runs`); fix tests that relied on a double start by ending the row first. All PASS.
- [ ] **Step 5: Commit** `runs: schema v3 (manifest, budgets) and refuse a second start on a running stage`.

---

### Task 2: `pack/pipelines.json` render, parse, write

**Files:**
- Create: `lib/skills/pipeline-manifest.ts`
- Test: `lib/skills/__tests__/pipeline-manifest.test.ts`

**Interfaces:**
- Consumes: `StageEntry` (`lib/skills/types.ts`: `{name, stage, dir, consumes, produces}`, `dir` = `${CLAUDE_SKILL_DIR}/../../<side>/<name>`).
- Produces:
  ```ts
  export const PIPELINES_REL = "pack/pipelines.json";
  export type PipelineStage = { stage: string; name: string; file: string; consumes: string[]; produces: string[] };
  export type PipelinesManifest = { version: 1; pipelines: Record<string, PipelineStage[]> };
  export function renderPipelinesManifest(entries: Record<string, StageEntry[]>): string | null; // null when no pipeline has stages; else JSON.stringify(m, null, 2) + "\n"
  export function parsePipelinesManifest(text: string): { ok: true; manifest: PipelinesManifest } | { ok: false; error: string };
  export function pipelinesWrite(resolved: { packDir: string; stageEntries: Record<string, StageEntry[]> }, readFile: (path: string) => string | null, write: boolean): { written: string[]; removed: string[]; stale: boolean };
  ```

- [ ] **Step 1: Write failing tests:**
  - `renders each pipeline's stages with a pack-relative file` (entry dir `${CLAUDE_SKILL_DIR}/../../attachments/stage-plan` → `file: "attachments/stage-plan/SKILL.md"`; `skills` side likewise)
  - `renders null for no pipelines`
  - `parse round-trips the rendered text`
  - `parse refuses an unknown version, a non-array pipeline, a stage without a string stage, non-string consumes`
  - `parse refuses a file that is absolute or has a .. segment` (Review Focus)
  - `pipelinesWrite: missing file → stale without write; written with write; current file → nothing; no pipelines and a file present → removed` (temp dir; returns pack-relative `PIPELINES_REL` in `written`/`removed`)
- [ ] **Step 2:** `bun test lib/skills/__tests__/pipeline-manifest.test.ts` → FAIL.
- [ ] **Step 3: Implement** the four exports. Mirror `floorWrite` in `commands/skills.ts:978` for `pipelinesWrite` (compare whole text; `mkdirSync` the `pack/` dir before writing).
- [ ] **Step 4:** Run the test file → PASS.
- [ ] **Step 5: Commit** `skills: render, parse and write pack/pipelines.json`.

---

### Task 3: Field-contract scanner and check

**Files:**
- Create: `lib/skills/field-contract.ts`
- Test: `lib/skills/__tests__/field-contract.test.ts`

**Interfaces:**
- Consumes: `StageEntry`.
- Produces:
  ```ts
  export type FieldUse = { key: string; line: number; template: boolean }; // line is 1-based
  export function scanFieldUses(text: string): { reads: FieldUse[]; writes: FieldUse[] };
  export const RT_WRITTEN_KEYS: readonly string[];      // work-type ticket repo mode claude-session herdr-pane agent pipeline-stages hold gate waiting-gate
  export const RT_WRITTEN_PREFIXES: readonly string[];  // extra.context-dropped. extra.gate-source.
  export type CompiledDoc = { path: string; text: string }; // path is pack-relative, e.g. attachments/stage-gates/SKILL.md
  export function sourceOf(text: string, line: number): { label: string; path: string; line: number } | null;
  export function fieldContractErrors(docs: CompiledDoc[], stageEntries: Record<string, StageEntry[]>): string[];
  ```
- Matching: reads are `run_field_get {` … `key:` X on the same line (`/run_field_get\s*\{[^}\n]*?\bkey:\s*["'`]?([A-Za-z][\w.-]*)(<)?/g`) and `/\brt runs field get\s+([A-Za-z][\w.-]*)(<)?/g`; writes the same with `run_field_set` / `rt runs field set`. A match followed by `<` is a template. Templated writes register the captured text as a prefix; templated reads are skipped.
- Attribution: the nearest `<!-- part: … -->` line above `line` (regex from `lib/skills/compile.ts:99`); `label` is the marker's `binding=` value, else `source=`, else the `include:<name>` token; source line = marker's `lines=A-…` start `A` + (`line` − marker line − 1).
- Error text (exact): `field contract: <doc path>:<line> (from <label> <src path>:<src line>) reads "<key>", which nothing in this pack writes`; without a marker, drop the parenthesised part. One error per (doc path, key), at its first line; errors sorted by doc path then line.

- [ ] **Step 1: Write failing tests:**
  - `scans a dot-label read`: `"run_field_get {key: extra.plan-verdict} (hobgoblin gates)" [shape=plaintext];` → read `extra.plan-verdict` line 1
  - `scans quoted, comma-ended and multi-key forms`: `run_field_get {key: "mr"}`, `run_field_set {key: shipTarget, value: -, stage: ship}`, `run_field_get {runDb, key: approach}` → `mr`, `shipTarget` (write), `approach`
  - `scans the shell forms`: `rt runs field get mode`, `rt runs field set ci green --stage watch-ci`
  - `marks templates`: `run_field_set {key: extra.context-dropped.<scope>, …}` → write template `extra.context-dropped.`; `run_field_set {key: <each produce>}` → no match
  - `attributes a line inside a slot part to its fill`: doc with frontmatter, a `<!-- part: step source=mattstack:stage-gates version=1 path=attachments/pipeline/stage-gates/SKILL.md lines=14-64 -->` block, then `<!-- part: slot:domain binding=ip:hobgoblin-gates version=0.3.1 path=attachments/hobgoblin-gates/SKILL.md lines=9-160 -->` and the read 3 lines below it → `{label: "ip:hobgoblin-gates", path: "attachments/hobgoblin-gates/SKILL.md", line: 11}`
  - `errors on a read nothing writes` (exact string above, the plan-verdict case)
  - `passes a read a stage produces`, `a read another doc writes`, `a read of an rt-written key (hold, ticket)`, `a read under a tool-written prefix (extra.gate-source.respond-plan)`, `a read under a templated write's prefix`
  - `one error per doc and key`
- [ ] **Step 2:** `bun test lib/skills/__tests__/field-contract.test.ts` → FAIL.
- [ ] **Step 3: Implement** the exports. Written set = every produce of every stage in every pipeline ∪ every non-template write in any doc ∪ `RT_WRITTEN_KEYS`; prefixes = templated writes ∪ `RT_WRITTEN_PREFIXES`.
- [ ] **Step 4:** Run the test file → PASS.
- [ ] **Step 5: Commit** `skills: field-contract scanner and pack-wide check`.

---

### Task 4: Wire the manifest and the field-contract check into compile and check

**Files:**
- Modify: `commands/skills.ts` (`performCompile` ~L1010-1052, `computeCheck` ~L1374-1476; one new helper `compiledDocsOf`)
- Test: `commands/__tests__/skills.test.ts` (helpers there: `makeMattstackDir` ~L180, `stageSkillMd` ~L162, `makePackDir` ~L215, `makeManifest` ~L221; the chain-error tests ~L2241 and ~L2554 are the model)

**Interfaces:**
- Consumes: `pipelinesWrite`, `PIPELINES_REL` (Task 2); `fieldContractErrors`, `CompiledDoc` (Task 3).
- Produces: `compiledDocsOf(outcomes: { target: CompileTarget; outcome: CompileOutcome }[]): CompiledDoc[]` — for each ok outcome, every file whose path ends `.md`, text from `content` or `readFileSync(copyFrom)`, path `${side}/${verb.name}/${file.path}`.

Behaviour:
- `performCompile`: when `verbFilter === null` and `failures` is empty, append `fieldContractErrors(compiledDocsOf(outcomes), resolved.stageEntries)` to `failures` before `writing` is computed. When writing (full compile), call `pipelinesWrite(resolved, readIfPresent, true)` beside `floorWrite` and add its `written`/`removed` to `writes`.
- `computeCheck`: when `flags.verbs === null`, push `"pack/pipelines.json is out of date with the pack's pipelines"` to `compileErrors` (and set `anyStale`) if `pipelinesWrite(resolved, readIfPresent, false).stale`. Collect each ok compile outcome during the target loop; after it, when `flags.verbs === null`, no target was never-compiled and no compile failed, append the field-contract errors to `compileErrors` and set `anyStale`.

- [ ] **Step 1: Write failing tests** in `skills.test.ts`:
  - `compile writes pack/pipelines.json for a pack with a pipeline` (stages and files match the manifest's stage list; `written` lists `pack/pipelines.json`)
  - `check reports a missing or stale pack/pipelines.json` (delete it after compile → check exits 1, the line appears; `--json` `compileErrors` carries it)
  - `compile fails when a fill reads a field nothing writes` (bind a fill whose body has `run_field_get {key: extra.plan-verdict}` to a stage's domain slot; nothing written; the error names the fill binding; exit 1)
  - `check fails on the same pack` (`compileErrors` contains the `field contract:` line)
  - `compile passes when another verb's fill writes the field` (a second fill on another stage with `run_field_set {key: extra.plan-verdict, value: yes, stage: plan}`)
  - `a --verb scoped compile skips both`
- [ ] **Step 2:** `bun test commands/__tests__/skills.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement** the call sites and `compiledDocsOf`.
- [ ] **Step 4:** `bun test commands/__tests__/skills.test.ts lib/skills/__tests__/compile-native.e2e.test.ts lib/skills/__tests__/init-compile.e2e.test.ts` → PASS. A fixture that now fails the field contract is a real finding: report it, do not silence it.
- [ ] **Step 5: Real packs, read-only.** Write a throwaway script in the session scratchpad (not the repo) that, for each of `~/.mattstack/orgs/assured/mattstack/teams/{claimview,ingestion-platform}/plugin` and `plugins/mattstack`, builds `CompiledDoc`s from every `.md` under `skills/*/` and `attachments/*/` that carries the compiler header comment, builds stage entries from `pack/skills.jsonc` `pipelines` and each stage's frontmatter in `plugins/mattstack/attachments/pipeline/<stage>/SKILL.md`, and prints `fieldContractErrors`. Expected: ingestion-platform's `extra.plan-verdict` read and nothing else. Any other error goes in the task report as a finding (it would break that pack's compile).
- [ ] **Step 6:** `env -i HOME=<scratch home> PATH="$PATH" RT_SKIP_SETUP=1 RT_BATCH=1 bun cli.ts skills compile --dry-run --pack-dir "$PWD/plugins/mattstack" --mattstack-dir <scratch>/ms` and the same with `skills check ... --strict` (what CI's plugin-mattstack job runs) → no `field contract:` line.
- [ ] **Step 7: Commit** `skills: write pack/pipelines.json and fail packs that read unwritten run fields`.

---

### Task 5: Engine foundation: manifest rows, positions, hold, budget

**Files:**
- Create: `lib/runs/engine.ts`
- Test: `lib/runs/__tests__/engine.test.ts` (real temp DBs via `runStart` from `lib/runs/start.ts` into a `mkdtempSync` root; reuse `lib/runs/__tests__/fixtures.ts` if it fits)

**Interfaces:**
- Consumes: Task 1's tables; `stageStart`, `stageEnd`, `fieldSet`, `decisionRecord`, `runStatus`, `Ok`, `Fail` from `lib/runs/write.ts`.
- Produces:
  ```ts
  export type StageStatus = "running" | "done" | "failed" | "redirected";
  export type Position = { stage: string; attempt: number; status: StageStatus; file: string | null };
  export type ManifestStage = { ordinal: number; stage: string; name: string | null; file: string | null; packRoot: string | null; consumes: string[]; produces: string[] };
  export type ManifestInput = { stage: string; name?: string; file?: string; consumes: string[]; produces: string[] };
  export const CONSENT_FIELDS: Readonly<Record<string, readonly string[]>>; // { ship: ["shipTarget"] }
  export function readManifest(db: Database): ManifestStage[];
  export function writeManifest(db: Database, stages: ManifestInput[], packRoot: string | null): void; // replaces all rows; ordinals 0..n-1
  export function setManifestRoot(db: Database, packRoot: string): void;
  export function positionOf(db: Database, stage: string): Position | null; // latest attempt; file = join(packRoot, file) when both set
  export function cleared(value: string | null | undefined): boolean;       // null/undefined, or trimmed value is "" or "-"
  export function holdStage(db: Database, o: { stage: string; reason?: string; decidedBy: string; now?: number }): Ok<{ held: true; at: Position; scope: string }> | Fail;
  export function budget(db: Database, o: { key: string; limit: number; increment?: number; stage?: string; now?: number }): Ok<{ key: string; spent: number; limit: number; remaining: number; exhausted: boolean }> | Fail;
  ```
- `holdStage`: scope `hold:<stage>:<attempt>`, selection `{"reason": reason ?? "held"}`, then field `hold` = same text, `produced_by` = stage; refuses a stage with no row (`code: 3`).
- `budget`: validation per spec (key 1-200 chars, no control chars; limit integer ≥ 1; increment integer ≥ 0, default 1); with `stage`, stored key `<stage>:<attempt>:<key>` and refuse a stage with no row; one `INSERT … ON CONFLICT(run_id, key) DO UPDATE SET spent = spent + excluded.spent, "limit" = excluded."limit", updated_at = excluded.updated_at RETURNING spent`.

- [ ] **Step 1: Write failing tests:**
  - `writeManifest/readManifest round-trip; positionOf joins packRoot and file`
  - `setManifestRoot rewrites every row's pack_root`
  - `cleared: null, "", "-", " - " are cleared; "x" is not`
  - `holdStage records gate@1 hold:<stage>:<attempt> and the hold field` (after two attempts of `plan`, scope is `hold:plan:2`, selection `{"reason":"waiting on design"}`, field `hold` = `waiting on design`)
  - `holdStage defaults the reason to held; refuses a stage with no row`
  - `budget counts up, reports remaining and exhausted, and keeps counting past the limit` (limit 2: spent 1/false, 2/true, 3/true with remaining 0)
  - `budget increment 0 reads; a new limit replaces the old`
  - `budget with stage resets on a new attempt` (key stored `implement:1:retries`, then `implement:2:retries` starts at 1)
  - `budget refuses an empty key, a control character, limit 0, a negative or fractional increment`
- [ ] **Step 2:** `bun test lib/runs/__tests__/engine.test.ts` → FAIL.
- [ ] **Step 3: Implement** the exports; `holdStage` and `budget` each in one transaction.
- [ ] **Step 4:** Run the test file → PASS.
- [ ] **Step 5: Commit** `runs: engine foundation (manifest rows, positions, hold, budget)`.

---

### Task 6: `nextStage`

**Files:**
- Modify: `lib/runs/engine.ts`
- Test: `lib/runs/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces:
  ```ts
  export type NextResult =
    | { ended: "closed"; status: string }
    | { ended: "failed"; at: Position; reason: string | null; detailPath: string | null; missing?: string[]; scope: string; earlier: string[] }
    | { ended: "held"; at: Position; reason: string }
    | { ended: "waiting"; at: Position; gate: string }
    | { ended: "done"; next: Position; repeated?: true }
    | { ended: "done"; last: true; stages: string[]; scope: "close"; repeated?: true };
  export function nextStage(db: Database, o: { stage: string; env: NodeJS.ProcessEnv; now?: number }): Ok<NextResult> | Fail;
  ```
- Order of checks, all in one transaction, exactly as the spec's `run_next` table: run not running → closed; no manifest rows → refuse with `this run has no pipeline manifest; resume it with run_enter to record one`; stage not in manifest → refuse; latest row failed → failed (scope `<stage>-failed:<attempt>`); row done → repeated `done` result when the next manifest stage is `current_stage` with a running row (or the stage is last), else refuse; row running → `hold` not cleared with `at >= row.started_at` → held; `waiting-gate` likewise → waiting; produces with `cleared(value)` → `stageEnd(failed, reason "missing produce: a, b")` → failed with `missing`; else `stageEnd(done)`, then start the next stage (`stageStart`; clear `hold` to `-` first when not cleared) or return the last-stage result. `earlier` = manifest stages before `stage` with at least one row, in manifest order. Anything else (stage is not `current_stage`, never started, `redirected`) is refused naming `current_stage` and the latest row's status.

- [ ] **Step 1: Write failing tests** (a three-stage manifest `plan(produces approach)`, `implement(produces commits)`, `ship(produces mr)`):
  - `done: all produces set → plan done, implement attempt 1 running, next.file is the joined path`
  - `failed: a missing produce fails the row with the reason and returns missing, scope plan-failed:1`
  - `whitespace and " - " produces count as missing` (Review Focus)
  - `a stage that wrote its own fail returns failed with its reason and detailPath, and earlier lists started stages before it`
  - `held and waiting are returned without writes` (hold set after start → held; hold `-` → not held; waiting-gate set → waiting)
  - `last stage done returns last: true, stages, scope close`
  - `a repeated call returns the same result with repeated: true and leaves one running row for the next stage` (Review Focus)
  - `closed run returns closed; a run with no manifest is refused; a stage that is not current is refused`
  - `starting the next stage clears a leftover hold to -`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `nextStage`.**
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `runs: nextStage checks produces and advances the pipeline`.

---

### Task 7: `resolveStage` and `closeRun`

**Files:**
- Modify: `lib/runs/engine.ts`
- Test: `lib/runs/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: Tasks 5-6.
- Produces:
  ```ts
  export type ResolveNext = "retry" | "redirect" | "iterate" | "hold" | "abandon" | "done";
  export type ResolveResult =
    | { applied: "retry"; next: Position; cleared: string[] }
    | { applied: "redirect" | "iterate"; next: Position; cleared: string[] }
    | { applied: "hold"; held: { at: Position; scope: string } }
    | { applied: "abandon" | "done"; status: string };
  export function resolveStage(db: Database, o: { stage: string; next: ResolveNext; to?: string; note?: string; decidedBy: string; env: NodeJS.ProcessEnv; now?: number }): Ok<ResolveResult> | Fail;
  export function closeRun(db: Database, o: { workType: string; stage: string; outcome: "done" | "failed" | "abandoned"; reason?: string; detailPath?: string; now?: number }): Ok<{ closed: true; status: string }> | Fail;
  ```
- `resolveStage` follows the spec's `run_resolve` section step for step; `cleared` lists every key set to `-` (produces from `to` on, then consent fields). Refusals write nothing: no manifest (same message as Task 6), `stage` or `to` not in the manifest (message lists the manifest stages), `to` after `stage`, redirect without `to`, retry on a row that is not `failed`, done on a stage that is not last or whose row is not `done`, `decidedBy` empty.
- `closeRun` follows the spec's `run_close` section; the two refusal messages are the spec's.

- [ ] **Step 1: Write failing tests** (manifest `plan`, `implement`, `ship`, `watch-ci`; produces `approach`, `commits`, `mr`, `ci`):
  - `retry after a failure starts attempt 2; retry of ship clears shipTarget`
  - `retry refuses a running or done row`
  - `redirect from a running ship to implement: decision redirect:ship:1 {from: ship, to: implement, reason}, ship row redirected, commits mr ci set to -, shipTarget set to -, implement attempt 2 running, cleared lists them`
  - `redirect after close (last row done) records the decision and does not end the row`
  - `iterate defaults to the same stage; note becomes the reason; no note gives "redirected to <to>"`
  - `redirect refuses an unknown to and a to after stage, writing nothing` (Review Focus)
  - `hold delegates to holdStage`
  - `abandon fails a running row and sets the run abandoned`
  - `done sets the run done only when the last stage is done`
  - `closeRun: own single-stage run → row done, run done; failed carries the reason`
  - `closeRun refuses another work type and a multi-stage manifest`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement both.**
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `runs: resolveStage applies gate answers; closeRun closes a standalone verb's run`.

---

### Task 8: `enterRun`

**Files:**
- Create: `lib/runs/enter.ts`
- Test: `lib/runs/__tests__/enter.test.ts` (temp runs root; a temp pack dir with `pack/pipelines.json` rendered by Task 2)

**Interfaces:**
- Consumes: `runStart`, `RunStartOpts` (`lib/runs/start.ts`); `createRunDb`/`openRunDb`, `stageStart`, `fieldSet` (write.ts); Task 5's manifest functions and `positionOf`, `cleared`; `parsePipelinesManifest`, `PIPELINES_REL` (Task 2); `recordIdentity` (`lib/runs/identity.ts`); `isPathComponent` (`lib/runs/paths.ts`).
- Produces:
  ```ts
  export type Candidate = { runId: string; runDb: string; startedAt: number; spawnedBy: string | null; currentStage: string | null; ownSession: boolean };
  export type EnterResult =
    | { mode: "inherited"; runDb: string; runId: string; at: Position | null }
    | { mode: "candidates"; candidates: Candidate[]; handedRunDb?: "not-running" }
    | { mode: "resumed"; runDb: string; runId: string; at: Position | null; clearedHold: boolean; handedRunDb?: "not-running" }
    | { mode: "started"; runDb: string; runId: string; at: Position; stages: string[]; handedRunDb?: "not-running" };
  export type EnterInput = {
    root: string; packRoot: string; start: RunStartOpts; // start.repo, start.workType, start.pipeline come from the flags
    stage?: string; pipeline?: string; handedRunDb?: string; resume?: string; fresh?: boolean;
    env: NodeJS.ProcessEnv; now?: number;
  };
  export function pickManifest(packRoot: string, o: { stage?: string; pipeline?: string; pipelineFlag: string }): Ok<{ stages: ManifestInput[] }> | Fail;
  export function enterRun(i: EnterInput): Ok<EnterResult> | Fail;
  ```
- Precedence and every rule as the spec's `run_enter` section (handed → resume → `fresh`/`spawnedBy` start → candidates). `pickManifest`: `stage` → `[{stage, consumes: [], produces: []}]`; else read `<packRoot>/pack/pipelines.json` (missing → `this pack has no pack/pipelines.json; recompile it with this rt, or pass stage`), pick `pipeline` input, else `pipelineFlag` when it is a key, else the only key, else refuse listing the keys. Start writes the manifest rows (`packRoot`), `pipeline-stages` (names joined by one space, `produced_by` = first stage) and starts the first stage, after `runStart` closes its handle, re-opening with `openRunDb`. Resume runs its writes in one transaction; backfill uses `pickManifest` and refuses with `this run's stages do not match the pack's pipeline; start fresh` when a stage with rows is missing from it. Candidates: scan `<root>/<repo>/*/state.db` read-only, `status = 'running'` and `work_type = start.workType`, newest `started_at` first; `ownSession` = `claude-session` field equals `env.CLAUDE_CODE_SESSION_ID`.

- [ ] **Step 1: Write failing tests:**
  - `start with stage: one-stage manifest, stage running, file null`
  - `start from pipelines.json: manifest rows, pipeline-stages field, first stage running, at.file under packRoot`
  - `pipeline pick: input wins; flag used when it is a key; the only key otherwise; several and none named refused listing keys; missing file refused`
  - `candidates: running runs of the same work type in the repo, newest first, ownSession set; another work type or a finished run excluded; none → starts`
  - `fresh and spawnedBy skip candidates`
  - `inherited: a handed running runDb returns its position and writes nothing (db bytes unchanged)`
  - `a handed run that is not running is ignored and flagged handedRunDb: not-running`
  - `resume adopts the running attempt (no new row), clears hold, records claude-session, rewrites pack_root`
  - `resume returns a failed row as is`
  - `resume refuses a missing run, a finished run, another work type, a bad id (../x)`
  - `resume backfills a missing manifest from the pack; refuses when the run's stages are not in it`
  - `resume of a run with no current stage starts the first manifest stage`
- [ ] **Step 2:** `bun test lib/runs/__tests__/enter.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `runs: enterRun starts, resumes, inherits or lists candidates`.

---

### Task 9: `runEngineOp` and the six MCP tools

**Files:**
- Modify: `commands/runs-write.ts`, `lib/mcp/run-tools.ts`
- Test: `lib/mcp/__tests__/run-tools.test.ts`, `lib/mcp/__tests__/tools.test.ts` (`NAMES` gains the six), `commands/__tests__/` (a runs-write test file if one exists for the write verbs; else cover `runEngineOp` from `lib/runs/__tests__/runs-write-cwd.test.ts`'s pattern)

**Interfaces:**
- Consumes: Tasks 5-8.
- Produces in `commands/runs-write.ts`:
  ```ts
  export type EngineOp =
    | { op: "enter"; args: string[]; packRoot: string; stage?: string; pipeline?: string; handedRunDb?: string; resume?: string; fresh?: boolean }
    | { op: "next"; stage: string }
    | { op: "resolve"; stage: string; next: ResolveNext; to?: string; note?: string; decidedBy: string }
    | { op: "hold"; stage: string; reason?: string; decidedBy: string }
    | { op: "close"; workType: string; stage: string; outcome: "done" | "failed" | "abandoned"; reason?: string; detailPath?: string }
    | { op: "budget"; key: string; limit: number; increment?: number; stage?: string };
  export async function runEngineOp(op: EngineOp, env?: NodeJS.ProcessEnv, cwd?: string): Promise<CliResult>; // out = JSON envelope {ok, ...body} or {ok:false,error}; same exit codes as runWriteVerb
  ```
  `enter` parses `args` with the same `required`/`flagValue` calls `run-start` uses, builds `RunStartOpts`, calls `enterRun` with `root = env.RT_RUNS_ROOT ?? runsRoot()`; emits `run-updated` kind `run-start` (started) or `run-resume` (resumed) and adopts the session (`adoptRunSessionAt`) for both. The other ops resolve and open the DB through `withRunDbAsync`, call the engine function, emit kind `run-next|run-resolve|run-hold|run-close|run-budget` (stage = the op's stage or null), and `run-next`/`run-resolve` adopt the session when they started a stage.
- Produces in `lib/mcp/run-tools.ts`: `RunToolDeps.engine: typeof runEngineOp` (`realRunToolDeps.engine = runEngineOp`); tools `run_enter`, `run_next`, `run_resolve`, `run_hold`, `run_close`, `run_budget`, inserted after `run_snapshot` in `runToolDefs`. Input schemas are the spec's inputs with `additionalProperties: false`, enums for `next` and `outcome`, `integer` for `limit`/`increment`, and `RUN_DB_PROPS` on all but `run_enter`. `run_enter` repeats `run_start`'s `flags`/`skillDir`/pack-root validation, confines `runDb` with `checkRunDb`, requires `resume` to be a path component, and passes `args = [...flags, "--pack-dirs", packRoot, ticket?, spawnedBy?]`. The others use `runTarget`. Every new tool's `shellForms` is `{ none: "MCP only; no rt runs verb" }`. Add the six names to the `run_list` shell-form `note`. Descriptions: one or two plain sentences each saying what the tool does and that it returns results without opening gates.

- [ ] **Step 1: Write failing tests:**
  - `run-tools.test.ts` (fake `engine` dep): each tool builds the right `EngineOp` from its input; `run_enter` refuses a quoted flag string, a relative skillDir, a non-pack skillDir, a runDb outside the runs root and `resume: "../x"` without calling the engine; the others refuse a missing `stage`/`decidedBy`/`key` and a runDb outside the root; an engine error envelope becomes `err(message)`.
  - one real-DB test (no fake): `run_enter` then `run_next` then `run_resolve {next: redirect}` against a temp `RT_RUNS_ROOT` and a temp pack with `pack/pipelines.json`, with `RT_RUN_EMIT=0`.
  - `tools.test.ts`: `NAMES` includes the six; the roster's run tools all have `shellForms`.
- [ ] **Step 2:** `bun test lib/mcp/__tests__/run-tools.test.ts lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/shell-forms.test.ts` → FAIL.
- [ ] **Step 3: Implement** `runEngineOp` and the tool defs.
- [ ] **Step 4:** Same command plus `bun test lib/runs/__tests__/` → PASS.
- [ ] **Step 5: Commit** `mcp: run_enter, run_next, run_resolve, run_hold, run_close, run_budget`.

---

### Task 10: Reference, plugin version, full verification

**Files:**
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (generated), `plugins/mattstack/.claude-plugin/plugin.json` (`version` patch bump only)

- [ ] **Step 1:** `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md` (under the isolated-HOME env from Global Constraints); the diff adds the six tools and nothing unrelated.
- [ ] **Step 2:** Bump the patch version in `plugin.json` (e.g. `0.31.5` → `0.31.6`; read the current value first).
- [ ] **Step 3:** `bun test commands/__tests__/mcp-tools-list.test.ts lib/mcp/__tests__/no-unredacted-mcp-output.test.ts` → PASS.
- [ ] **Step 4:** `bun run check` → PASS. `bun run purity` → PASS.
- [ ] **Step 5:** Re-run every test file touched in Tasks 1-9 in one `bun test` invocation → PASS.
- [ ] **Step 6: Commit** `mattstack plugin: regenerate the mcp tools reference for the run engine; bump version`.
