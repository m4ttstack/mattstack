# Gate Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the gate protocol's bookkeeping into rt's MCP server: a byte-exact TS port of `gate-ctx.sh` / `review-source.sh` behind `gate_open`, decision building in `gate_record`, run-aware `gate_ask` / `gate_answer`, and `gate_reconcile`.

**Architecture:** Pure functions under `lib/gates/` (jq semantics, the two script ports, form building, decision building) tested directly against the existing shell fixtures and differentially against the real scripts. `lib/mcp/gate-tools.ts` holds the tool handlers and a deps seam; run reads and writes go through `runToolDefs()`'s own handlers. `lib/mcp/tools.ts` delegates `gate_ask` / `gate_answer` to it and spreads the new tools right after `gate_ask`.

**Tech Stack:** Bun + TypeScript, `bun:test`, rt-client gate commands, `jq` (differential test only).

**Spec:** `docs/superpowers/specs/2026-10-16-gate-tools-design.md`

## Global Constraints

- Write only: `lib/mcp/tools.ts` (gate handlers, one contiguous registration block), `lib/mcp/gate-tools.ts`, `lib/gates/**`, and `__tests__` beside them. Read `plugins/mattstack/attachments/**` in place; never edit it. No plugin version bump. Never edit `lib/mcp/run-tools.ts`.
- Every run parameter is optional. With no `runDb`, `gate_ask` / `gate_answer` send the daemon exactly what they send today; only result fields are added.
- Run writes are only `gate`, `waiting-gate`, `extra.context-dropped.<scope>`, `extra.gate-source.<scope>` and `gate@1` decisions on the caller's scope. Never `hold`, stages, run status or `pipeline-stages`.
- `decidedBy` is the answered row's `answer.by`, or the caller-named decider on a handed decision.
- Context budget 8192 UTF-8 bytes; option label cap 200 bytes; description cap 1024 bytes.
- New tools use `shellForms: { none: "..." }`; `RULES_SHA256` in `lib/skills/__tests__/mcp-lint-rules-hash.test.ts` must stay unchanged.
- Fixture dirs (read in place): `RR = plugins/mattstack/attachments/review/receive-review/tests/fixtures`, `RV = plugins/mattstack/attachments/review/review/tests/fixtures`; scripts `GC = plugins/mattstack/attachments/review/receive-review/scripts/gate-ctx.sh`, `RS = plugins/mattstack/attachments/review/review/scripts/review-source.sh`.
- Run `bun test` from the worktree root, targeted files only. Comments only where they state a constraint the code cannot show.
- A0 (before Task 1): `bun install` in the worktree.

## Review Focus

- A thread id that itself contains `:` (`reply:a:b`): split at the FIRST `:` only, so the thread is `a:b` (Task 6).
- A label of multi-byte characters crossing the 200-byte cap: the cut never splits a codepoint and the result is ≤ 200 bytes (Task 5).
- The daemon accepts an answer but the run write then fails (runDb moved or unwritable): the tool still returns the answer with `runErrors`, never an error that makes the pane re-answer (Task 8).
- The pane's `gate_answer` loses the CAS: the record carries the WINNER's answers and `by`, not the pane's (Task 8).
- A hand-back open still over budget after every question context is dropped: the gate context goes too, and the open is still returned (Task 9).

---

### Task 1: jq semantics and the gate-ctx validator

**Files:**
- Create: `lib/gates/jq.ts`, `lib/gates/ctx.ts`
- Test: `lib/gates/__tests__/jq.test.ts`, `lib/gates/__tests__/ctx-validate.test.ts`

**Interfaces:**
- Produces (`lib/gates/jq.ts`):
  - `class JqError extends Error`
  - `utf8Bytes(s: string): number`; `cpLength(s: string): number`; `cpSlice(s: string, start: number, end?: number): string` (codepoint indices)
  - `tojson(v: unknown): string`: `JSON.stringify` compact, plus `\x7f` written as `\u007f` (jq does; U+2028 stays raw)
  - `asciiUpper(s)`, `asciiLower(s)`: ASCII letters only
  - `isSpace(ch: string): boolean` and `hasNonSpace(s: string): boolean`: Oniguruma `\s`, i.e. U+0009-000D, 0020, 0085, 00A0, 1680, 2000-200A, 2028, 2029, 202F, 205F, 3000 (NOT U+FEFF, NOT U+200B)
  - `jqCompare(a: unknown, b: unknown): number`: null < false < true < number < string (codepoint order) < array < object
  - `jqHas(v: unknown, k: string): boolean` throws `JqError` unless `v` is a plain object; `jqGet(v: unknown, k: string): unknown` returns null for null, throws on non-objects
  - `ok(f: () => unknown): boolean`: false on throw, else jq truthiness (`false`/`null` falsy)
- Produces (`lib/gates/ctx.ts`): `type GateCtxSource = { context?: unknown; questions: unknown[]; [k: string]: unknown }`; `ctxErrors(source: unknown): string[]` (throws `JqError` exactly where jq's `errors` would fail); `contextShapeErrors(ctx: unknown, where: string, allowed: string[], values: unknown[]): string[]`; `checkSource(source: unknown): { ok: true } | { ok: false; problems: string[] }` (a `JqError` or non-object source becomes `["source is not a JSON object"]`).

- [ ] **Step 1: Write the failing tests**
  - `jq.test.ts`: `tojson("a\x7fb c") === '"a\\u007fb c"'`; `utf8Bytes("é…𝄞") === 9`; `cpSlice("a𝄞b", 1, 2) === "𝄞"`; `hasNonSpace(" \u0085") === false`, `hasNonSpace("﻿") === true`; `asciiUpper("ß-é-x") === "ß-é-X"`; `jqCompare` orders `[null,false,true,1,"a",[],{}]` as given; `jqHas("x","k")` throws `JqError`.
  - `ctx-validate.test.ts`: one test per `reject` line in `test-gate-ctx.sh` (lines 177-216), same name, applying the same mutation (write it in TS over the parsed fixture) and expecting `checkSource(m)` to give `{ok:false, problems:[<the shell's expected stderr line>]}`. Plus: plan, post and review fixtures pass; "unknown keys pass through" and "reply.kind none needs no text" pass; a source with `threads` deleted from `plan@1` context gives both `gate: threads: required object` and `gate: threads.total: required integer` and `gate: threads.blocking: integer when present`, in that order; `checkSource([])` gives `["source is not a JSON object"]`.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/gates/__tests__/jq.test.ts lib/gates/__tests__/ctx-validate.test.ts`
  Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `jq.ts` and the validator half of `ctx.ts`**
  Port `plan_errs`, `post_errs`, `thread_errs`, `reply_errs`, `carryover_errs`, `review_errs`, `findings_errs`, `skipped_errs`, `shape_errs`, `option_values` and `errors` from the `LIB` heredoc in `GC` one def per function, each `chk` as `ok(() => ...) ? [] : [msg]`, keeping message text and emission order byte-identical. Sorts and `group_by` use `jqCompare` and are stable. `str` here is `typeof v === "string" && hasNonSpace(v)`.

- [ ] **Step 4: Run to verify they pass**
  Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add lib/gates && git commit -m "gates: jq semantics and the gate-ctx validator port"`

### Task 2: gate-ctx fit and prose

**Files:**
- Modify: `lib/gates/ctx.ts`
- Test: `lib/gates/__tests__/ctx-fit.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `GATE_CTX_LIMIT = 8192`; `interface FitResult { mode: "structured" | "prose"; trimmed: string[]; context?: string; questions: Record<string, unknown>[]; bytes: number; fits: boolean }` (own keys in exactly this order); `fitOpen(source: GateCtxSource, limit?: number): FitResult`; `proseOpen(source: GateCtxSource): FitResult`; `proseContext(ctx: Record<string, unknown>): string`.

- [ ] **Step 1: Write the failing tests**
  One test per `check` in `test-gate-ctx.sh` lines 24-172 (structured round trips, trim order, prose fallbacks, exact prose text, review-post evidence/fix trimming, legacy prose), same names and expected values. Each calls `fitOpen(src, limit)` / `proseOpen(src)` over the parsed fixture or the same mutation, and asserts on the result the way the jq expression does. The `--limit "$FULL"` / `$NOEV` / `$MIN` cases compute those limits from earlier `fitOpen` results, exactly as the shell does.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/gates/__tests__/ctx-fit.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
  Port `prose`, `ctx_bytes`, `trim`, `trim_carry`, `shorten_carry` (with `middle`: `k = floor(n/4)`, `cpSlice(0,k) + " ... " + cpSlice(n-k)`), `trim_entries`, `structurable`, `render` and `main`. `render` keeps question key order (`context` replaced in place), and `trimmed` is `source.trimmed` when it is neither null nor false, else `[]`. Sizes always use `utf8Bytes(tojson(...))`.

- [ ] **Step 4: Run to verify they pass**
  Run: `bun test lib/gates/__tests__/ctx-fit.test.ts lib/gates/__tests__/ctx-validate.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add lib/gates && git commit -m "gates: gate-ctx fit and prose port"`

### Task 3: review-source port

**Files:**
- Create: `lib/gates/review-source.ts`
- Test: `lib/gates/__tests__/review-source.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `reviewSourceErrors(findings: unknown, extras: unknown): string[]` (lines prefixed `findings file: ` / `extras: `; a non-object input gives `["findings file: not a JSON object"]` / `["extras: not a JSON object"]`); `buildReviewSource(findings: Record<string, unknown>, extras: Record<string, unknown>): GateCtxSource`; `midTrunc(s: string, maxBytes: number): string`; `endTrunc(s: string, maxBytes: number): string`.

- [ ] **Step 1: Write the failing tests**
  One test per `check` in `test-review-source.sh` (all of it except the `cmp` of the two script copies, which is not about the port), same names and expected values. Run them through `buildReviewSource` and, where the shell pipes into `gate-ctx.sh fit` / `prose`, through `fitOpen` / `proseOpen`. Exit-1 cases assert on `reviewSourceErrors(...)`. The two usage cases (one argument, an unreadable file) become tool-level tests in Task 9. Add: `midTrunc("é".repeat(150), 200)` is ≤ 200 bytes and contains `…` once; `endTrunc("abc", 2) === ""`.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/gates/__tests__/review-source.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
  Port `file_errs`, `extras_errs`, `mid_trunc`, `end_trunc`, `anchor`, `kind_word` (whitespace class from `isSpace`), `opt_label`, `opt_description`, `option`, `entry`, `rank`, `thread_anchor`, `settled`, `thread_question`, `skip_option`, `skip_entry` and `build` from `RS`, key order as the jq object constructors build it. Here `str` is `typeof v === "string" && v.length > 0` (not `hasNonSpace`).

- [ ] **Step 4: Run to verify they pass**
  Run: `bun test lib/gates/__tests__/review-source.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add lib/gates && git commit -m "gates: review-source port"`

### Task 4: differential parity against the real scripts

**Files:**
- Test: `lib/gates/__tests__/parity.test.ts`

**Interfaces:**
- Consumes: `checkSource`, `fitOpen`, `proseOpen`, `reviewSourceErrors`, `buildReviewSource`, `tojson`.

- [ ] **Step 1: Write the test**
  A table of inputs: every fixture in `RR` and `RV`, every mutation either shell suite applies, and these hostile cases: a DEL in a `claim.summary`; a non-BMP title (`"𝄞".repeat(60)`); a title whose `[Minor] ` label lands exactly on 200 bytes, and one landing 1 byte over; `kind: "a\u0085b c﻿d"`; a `reply.text` of `"　"`. For each gate-ctx input × {`fit`, `fit --limit 900`, `prose`}, run `sh GC <mode>` via `Bun.spawnSync` with `stdin` and compare. Exit 0: stdout equals `tojson(<TS result>)`, keys in the script's order (`mode, trimmed, context, questions, bytes, fits`). Exit 1: stderr lines equal the TS problems. For review inputs, write temp files and run `sh RS`: stdout equals `tojson(buildReviewSource(...))`, and exit 1 stderr equals `reviewSourceErrors`. The first test asserts `Bun.which("jq")` is truthy, with the message "jq is required for the gate-ctx parity test"; it never skips.

- [ ] **Step 2: Run it**
  Run: `bun test lib/gates/__tests__/parity.test.ts`. Expected: PASS. Any diff is a port bug: fix it in Tasks 1-3's files and re-run their tests too.

- [ ] **Step 3: Commit**
  `git add lib/gates && git commit -m "gates: differential parity test against gate-ctx.sh and review-source.sh"`

### Task 5: form building and option text caps

**Files:**
- Create: `lib/gates/form.ts`
- Test: `lib/gates/__tests__/form.test.ts`

**Interfaces:**
- Consumes: `midTrunc`, `endTrunc`, `contextShapeErrors`, `proseContext`; `normalizeGateOptions` and `GateOptionObject` from `packages/rt-client/src/gate-options.ts`; `GateQuestion` from rt-client.
- Produces:
  - `LABEL_CAP_BYTES = 200`, `DESCRIPTION_CAP_BYTES = 1024`
  - `interface TruncatedText { question: string; value: string; field: "label" | "description" }`
  - `truncateOptionText(questions: GateQuestion[]): { questions: GateQuestion[]; truncated: TruncatedText[] }`: object options only; `value` never changes
  - `flattenContext(context: string | undefined, where: { level: "gate" } | { level: "question"; values: string[] }): string | undefined`: prose when the string parses to an object that passes `contextShapeErrors` for that level, else the string unchanged
  - `interface FormQuestion { id: string; label: string; text: string; multi: boolean; options: GateOptionObject[] }`
  - `formChunks(questions: GateQuestion[], proseById?: Record<string, string>): FormQuestion[][]`: chunks of ≤ 4 in gate order. `text` is `label`, plus `"\n" + prose` when a prose context exists (`proseById[id]`, else `flattenContext(q.context)`). `options` come from `normalizeGateOptions`.
  - `type PaneAction = "form" | "wait"`; `paneActionFor(presentation: "form" | "wait", o: { herdr: boolean; spawned: boolean }): PaneAction`
  - `dropContextsToFit(open: { context?: string; questions: GateQuestion[] }, limit: number): { open: { context?: string; questions: GateQuestion[] }; dropped: string[] }`: drops whole question contexts largest first (ties by position), then the gate context, until total bytes < limit

- [ ] **Step 1: Write the failing tests**
  - A 260-byte label is cut to ≤ 200 bytes with its value unchanged and `truncated` naming it; a label of `"é".repeat(101)` (202 bytes) never splits a codepoint; a 1100-byte description ends in `…` at ≤ 1024 bytes; bare-string options are left alone.
  - `formChunks` of 9 questions gives chunk sizes `[4,4,1]`. `text` of a question whose context is a valid `thread@1` JSON string equals `label + "\n" + proseContext(parsed)`. An invalid structured context stays raw. `{value:"x",label:"fix",recommended:true}` renders label `"Fix (Recommended)"`.
  - `paneActionFor`: `form` for any presentation `form`; `wait` + herdr gives `wait`; `wait` + spawned gives `wait`; `wait` + neither gives `form`.
  - `dropContextsToFit` drops the largest question context first and reports ids in drop order. When the gate context alone is over, every question context is dropped and then the gate context.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/gates/__tests__/form.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `form.ts` per the interfaces.**

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add lib/gates && git commit -m "gates: form chunks, option text caps, pane action"`

### Task 6: answer normalization and the generic recorder pieces

**Files:**
- Create: `lib/gates/record.ts`
- Test: `lib/gates/__tests__/record-answers.test.ts`

**Interfaces:**
- Consumes: `GateAnswer` from rt-client.
- Produces:
  - `type AnswerWire = GateAnswer["answers"][string]`; `type AnswersMap = Record<string, AnswerWire>`
  - `normalizeAnswers(a: AnswersMap): AnswersMap`: an object form becomes the bare value unless it has a non-empty `note` or `text` (then `{value, note?, text?}` with only non-empty keys); a `{writeIn}` stays as is
  - `answerValue(a: AnswerWire): string | string[] | undefined` (undefined for a write-in)
  - `splitVerb(value: string): { verb: string; id: string }`: split at the FIRST `:`
  - `writeInsOf(a: AnswersMap): { question: string; text: string }[]`; `nextOf(a: AnswersMap): string | null`; `actOnWriteIn(a: AnswersMap): boolean`: writeIns non-empty and next null, `proceed`, or starting with `iterate`
  - `interface DecisionRow { contract: string; scope: string; selection: string; decided_by: string; decided_at: number }`
  - `decisionForGate(decisions: DecisionRow[], scope: string, since: number): DecisionRow | null`: the `gate@1` row on `scope` with `decided_at >= since`, else null
  - `type RecordShape = "answers" | "respond-plan" | "respond-post" | "post"`; `skipReason(shape: RecordShape, a: AnswersMap): string | null`: null for `answers`; for the other three, `` `next is ${v}: ${shape} decides nothing` `` when `nextOf(a)` is non-null and not `proceed`

- [ ] **Step 1: Write the failing tests**
  `{q:{value:"a"}}` → `{q:"a"}`; `{q:{value:"a",note:""}}` → `{q:"a"}`; `{q:{value:["a"],note:"n"}}` unchanged; `{q:{writeIn:"w"}}` unchanged. `splitVerb("reply:a:b")` → `{verb:"reply", id:"a:b"}`. `actOnWriteIn` is true for `{tier:{writeIn:"x"}, next:"proceed"}` and `{tier:{writeIn:"x"}}`, false for next `hold`, true for `"iterate here"`. `decisionForGate` ignores a row decided 1 ms before `since` and another scope's row. `skipReason("answers", {next:"hold"})` is null; `skipReason("post", {next:"iterate"})` is `"next is iterate: post decides nothing"`.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/gates/__tests__/record-answers.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add lib/gates && git commit -m "gates: answers map, write-ins, late-answer rule"`

### Task 7: review decision shapes and the override rule

**Files:**
- Modify: `lib/gates/record.ts`
- Test: `lib/gates/__tests__/record-review.test.ts`

**Interfaces:**
- Consumes: Task 6; `GateCtxSource`; `GateQuestion`.
- Produces:
  - `interface PlanRow { threadId: string; file: string; verdict: string; recommended: string; gate1: "reply" | "fix" | "skip" | "override"; reply: string }`
  - `respondPlanSelection(a: AnswersMap, o: { source?: GateCtxSource; storedQuestions?: GateQuestion[]; contextDropped?: boolean | string[] }): { selection: Record<string, unknown>; rows: PlanRow[] }`
  - `respondPostSelection(a: AnswersMap, o: { source?: GateCtxSource; storedQuestions?: GateQuestion[]; held?: string[] }): Record<string, unknown>`
  - `postSelection(a: AnswersMap, o: { source?: GateCtxSource }): Record<string, unknown>`
- Rules (copied from the spec; selection key order as written):
  - respond-plan: `{threads, texts?, overrides?, notes?, "code-changes"?}`. A card is the source question's `thread@1` context (`reply.kind`, `reply.text`, `verdict.call`). A question counts as dropped when `contextDropped === true`, or its id is in `contextDropped`, or the source question has a context and the matching `storedQuestions` entry has none. Override = verb `reply`, no `text`, and (no card, or card kind ≠ `verbatim`, or a non-empty note, or dropped). `notes` only for override threads. Row `file` = question label; `verdict` = card `verdict.call` else `unknown`; `recommended` = verb of the option with `recommended: true` or a label ending `(recommended)` (any case), else `unknown`; `reply` = answer `text`, else card `reply.text` when kind ≠ `none`, else `none`.
  - respond-post: offered threads are source questions with a `reply@1` context (thread = `context.thread`), else `storedQuestions` whose options are `post:<id>` / `resolve:<id>`. Each gets `{post, resolve}` from its answer's values (an empty array gives both false; an unanswered offered thread gives both false), plus `text` when the answer has `text` and `post` is true, plus `note` when the answer has a note. Thread ids come from option values, never from `thread-<n>` position. `held` is added when given and non-empty. Answers carrying `replies` or `replies-<n>` keys return the answers object unchanged (retired shape).
  - post: an `a.findings` array means a handed `{findings, outcome, replies?, restored?}`: return `{findings, disposition: outcome}` plus `replies` / `restored` unchanged. A `tiers` answer gives `{levels: <tiers values>, disposition}`. Otherwise `findings` = the union of every `findings-<n>` answer's values in question order, `disposition` = `outcome`'s value, `replies` (when any `thread-<n>` picked anything) = `{discussionId, resolve, body?}` with `body` = answer `text`, else the source `carryover@1` `reply`, and `restored` (when any `restore:<id>` was picked) = `[{id, changed}]` from the source's `skipped@1` entry (changed false when not found).

- [ ] **Step 1: Write the failing tests**
  Use `RR/plan-source.json`, `RR/post-source.json` and `buildReviewSource(RV/findings-v3.json, RV/extras.json)` as sources.
  - Plan, `{ "thread-1": "fix:T1", "thread-2": "reply:T2", "code-changes": "approve" }` → `{threads:{T1:"fix",T2:"reply"},"code-changes":"approve"}` (T2's card is verbatim, so no override), rows `gate1` `["fix","reply"]`.
  - Each override trigger on its own: `thread-1: "reply:T1"` (a direction card); `thread-2: {value:"reply:T2", note:"tone"}`; T2 with `contextDropped: ["thread-2"]`; T2 with `storedQuestions` lacking thread-2's context; T2 with no source. Each gives `overrides:["T…"]`, and `notes` only in the note case.
  - `{value:"reply:T2", text:"edited"}` → `texts:{T2:"edited"}`, not an override, row reply `edited`.
  - Post: `{ "thread-1": {value:["post:T1","resolve:T1"], text:"x"}, "thread-2": [], next:"proceed" }` with `held:["T1"]` → `{threads:{T1:{post:true,resolve:true,text:"x"},T2:{post:false,resolve:false}},held:["T1"]}`. A thread id `a:b` round-trips.
  - Review post over the v3 source: `{ "thread-1": ["post:a1b2"], "findings-1": ["f4","f2"], "findings-2": ["f5"], "skipped-1": ["restore:r1-f3"], outcome: "comment", next: "proceed" }` → `findings: ["f4","f2","f5"]`, `disposition: "comment"`, `replies: [{discussionId:"a1b2", resolve:false, body:"Confirmed, thanks."}]`, `restored: [{id:"r1-f3", changed:true}]`. A handed `{findings:["f1"], outcome:"approve"}` → `{findings:["f1"], disposition:"approve"}`. `{tiers:["Critical"], outcome:"comment"}` → `{levels:["Critical"], disposition:"comment"}`.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/gates/__tests__/record-review.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add lib/gates && git commit -m "gates: respond-plan, respond-post and post decision shapes"`

### Task 8: gate-tools seam, run plumbing, run-aware gate_ask and gate_answer

**Files:**
- Create: `lib/mcp/gate-tools.ts`
- Modify: `lib/mcp/tools.ts` (the `gate_answer` and `gate_ask` defs only)
- Test: `lib/mcp/__tests__/gate-tools.test.ts`; `lib/mcp/__tests__/tools.test.ts` must stay green unchanged

**Interfaces:**
- Consumes: Tasks 5-6; `runToolDefs`, `RunToolDeps`, `realRunToolDeps` from `./run-tools.ts`; `gateAsk`, `gateAnswer`, `gateWait` from rt-client; `readRootsForThisProcess`, `tempRootsForThisProcess`, `checkReadRootPath`, `checkTempRootPath`.
- Produces:
  - `interface GateToolDeps { ask: typeof gateAsk; answer: typeof gateAnswer; wait: typeof gateWait; runDeps: RunToolDeps; readRoots: () => ReadRoots; tempRoots: () => string[]; readFile: (p: string) => string; writeFile: (p: string, s: string) => void }`; `realGateToolDeps: GateToolDeps`
  - `askGate(input: Record<string, unknown>, env: NodeJS.ProcessEnv, deps: GateToolDeps, extra?: { proseById?: Record<string, string>; formContext?: string; contextDropped?: boolean }): Promise<ToolResult>`: the shared open path (spec, "The shared open path")
  - `answerGate(input: Record<string, unknown>, env: NodeJS.ProcessEnv, deps: GateToolDeps): Promise<ToolResult>`
  - `recordAnswered(run: RunHandle, row: GateRow, o: { scope: string; shape: RecordShape; record: boolean; source?: GateCtxSource; contextDropped?: boolean | string[]; held?: string[] }): Promise<RecordResult>`
  - `RunHandle` (internal; exported for Tasks 9-10): `openRun(input, env, deps): Promise<{ run: RunHandle } | { error: string } | null>` (null when no `runDb`; refuses `runDb` without `stage`). A handle carries `snapshot: { run: { spawned_by: string | null }; fields: { key: string; value: string; at: number }[]; decisions: DecisionRow[] }`, `field(key: string, value: string): Promise<string | null>` (null = ok, else the error) and `decision(scope: string, selection: object, by: string): Promise<string | null>`, all through the `run_snapshot` / `run_field_set` / `run_decision` handlers of `runToolDefs(deps.runDeps)` with `{runDb, stage}`.
  - `RecordResult = { recorded: boolean; alreadyReconciled?: boolean; skipped?: string; selection?: Record<string, unknown>; decidedBy: string; answers: AnswersMap; writeIn: {question: string; text: string}[]; next: string | null; actOnWriteIn: boolean; rows?: PlanRow[]; runErrors?: string[] }`
- New `gate_ask` input props: `runDb`, `stage`, `scope` (description: run, stage, and the decision scope, default kind). New `gate_answer` props: `runDb`, `stage`, `scope`, `record` (boolean, default true). Result additions: `gate_ask` adds `paneAction`, `formChunks`, `formContext`, `labelsTruncated?`, `runErrors?`; `gate_answer` adds the `RecordResult` fields beside `row` / `conflict`.

- [ ] **Step 1: Write the failing tests** (`gate-tools.test.ts`, with fake `GateToolDeps`: `ask` / `answer` / `wait` record payloads and return canned rows; `runDeps.write` records `(verb, args)` and serves a canned snapshot JSON for `snapshot`; `RT_RUNS_ROOT=/runs`, `runDb=/runs/r/1/state.db`)
  - No run: `askGate` sends `gate:ask` the same payload as today's handler for the same input (questions, context, kind, subject, sessionId, paneId); makes no run call; returns `paneAction: "form"` for form; `paneAction: "wait"` for wait with `HERDR_ENV=1`.
  - Run: the write order is snapshot, then `field set gate <scope> --stage s`, then ask. On wait in herdr, `field set waiting-gate <id> --stage s` follows. With `contextOmitted`, `field set extra.context-dropped.<scope> <id>` follows. `runDb` without `stage` is refused before any call. A `runDb` outside `/runs` is refused and `ask` is never called.
  - Spawned run (`spawned_by: "herd:x"`) outside herdr on wait gives `paneAction: "wait"`.
  - A 260-byte label is truncated before `ask` sees it, and `labelsTruncated` names it.
  - `formChunks` has 2 chunks for 5 questions.
  - `answerGate` with run and a recorded answer: `decision record --contract gate@1 --scope <row.kind> --selection <normalized> --decided-by pane`. Then `waiting-gate -` only when the snapshot's `waiting-gate` equals the id.
  - Conflict (`conflict: true`, winner row `by: "console"`) records the winner's answers with `--decided-by console`.
  - A decision on the scope with `decided_at >= row.openedAt` gives `alreadyReconciled: true` and no decision write.
  - `record: false` writes no decision but still clears `waiting-gate`.
  - A failing run write after the daemon answered returns `ok` with the row and `runErrors: [<error>]`.
  - The owned-by, gate-closed and not-found refusals keep today's text.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/mcp/__tests__/gate-tools.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `gate-tools.ts` helpers and point `tools.ts`'s `gate_ask` / `gate_answer` handlers at `askGate(input, env, realGateToolDeps)` / `answerGate(...)`.**
  Move today's `gate_answer` refusal mapping into `answerGate` unchanged. Extend the two descriptions by one sentence each: pass `runDb` and `stage` under a run; the result's `paneAction` (not `presentation`) says form or wait; and for `gate_answer`, `record: false` at a review site, which records with `gate_record`.

- [ ] **Step 4: Run to verify they pass**
  Run: `bun test lib/mcp/__tests__/gate-tools.test.ts lib/mcp/__tests__/tools.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add lib/mcp && git commit -m "mcp: run-aware gate_ask and gate_answer over a gate-tools seam"`

### Task 9: gate_open

**Files:**
- Modify: `lib/mcp/gate-tools.ts`, `lib/mcp/tools.ts` (add `...gateToolDefs()` right after the `gate_ask` def)
- Test: `lib/mcp/__tests__/gate-tools.test.ts`; `lib/mcp/__tests__/tools.test.ts` (`NAMES` gains `gate_open`)

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces: `gateToolDefs(deps?: GateToolDeps): McpToolDef[]`, holding `gate_open` (this task), then `gate_record` and `gate_reconcile` (Task 10), in that order. `gate_open` input: `kind` (required), `source` | `sourcePath` | `review: {findings | findingsPath, extras}` (exactly one), `subject`, `handBack`, `outPath`, `runDb`, `stage`, `scope`. Shared helper `resolveSource(input, deps): { source: GateCtxSource } | { error: string }`, reused by Task 10.

- [ ] **Step 1: Write the failing tests**
  - `source` = plan fixture: `ask` receives `fitOpen(src).context` and questions verbatim, kind `respond-plan`. The result has `mode: "structured"`, `fits: true`, `contextDropped: false`, `formContext` = the prose gate line from Task 2's exact-text check, and `formChunks[0][0].text` starting `"queue/enqueue.ts:88\n[BLOCKING] renee:"`.
  - `review` = `{findingsPath: <temp copy of findings-v2.json>, extras}`: `ask` receives what `fitOpen(buildReviewSource(...))` gives. A `findingsPath` outside the read roots is refused with `checkReadRootPath`'s message, and nothing opens.
  - A refused source returns an error whose text lists each problem line (thread-2's `verdict.call` mutation gives `thread-2: verdict.call: valid|valid-low-value|pushback|needs-clarification|no-ask`), and `ask` is never called. Zero or two of `source` / `sourcePath` / `review` are refused.
  - Run: `field set extra.gate-source.respond-plan {"gate":"<id>","source":<src>}` after the open. With `review`, kind `review-post` and scope `post`, the `gate` field value is `post`. `fits: false` (plan fixture at the real limit with a 9 KB `adjudication`) also writes `extra.context-dropped.<scope>`.
  - `handBack: true`: no `ask`. The result has `open` = `{context, questions}` of the fit. Over budget, `droppedContexts` lists question ids and `contextDropped` is true. With `outPath` in a temp root, the file holds `{mode, trimmed, context, questions, bytes, fits}`. With `runDb`, `extra.gate-source.<scope>` holds `"gate": null`. An `outPath` outside the temp roots is refused.
  - A hand-back open whose gate context alone is over 8192 bytes drops every question context and then the gate context, and still returns `open`.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/mcp/__tests__/gate-tools.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `gate_open` and register `...gateToolDefs()` in `tools.ts`; add `gate_open` to `NAMES` in `tools.test.ts`.**
  Description: what it builds, that it opens only when called and never picks an answer, `handBack`, and the result fields. `shellForms: { none: "replaces sh gate-ctx.sh / review-source.sh once wave 3 rewrites the skills" }`.

- [ ] **Step 4: Run to verify they pass**
  Run: `bun test lib/mcp/__tests__/gate-tools.test.ts lib/mcp/__tests__/tools.test.ts lib/skills/__tests__/mcp-lint-rules-hash.test.ts commands/__tests__/mcp-tools-list.test.ts`. Expected: PASS (hash unchanged).

- [ ] **Step 5: Commit**
  `git add lib/mcp && git commit -m "mcp: gate_open builds, fits and opens structured gates"`

### Task 10: gate_reconcile and gate_record

**Files:**
- Modify: `lib/mcp/gate-tools.ts`
- Test: `lib/mcp/__tests__/gate-tools.test.ts`; `lib/mcp/__tests__/tools.test.ts` (`NAMES` gains `gate_record`, `gate_reconcile`)

**Interfaces:**
- Consumes: `openRun`, `recordAnswered`, `resolveSource`, Task 7's builders.
- Produces:
  - `gate_reconcile` input: `id` (required), `runDb`, `stage`, `scope`, `record`. It calls `wait {id, waitMs: 2000, sessionId: env.CLAUDE_CODE_SESSION_ID}`.
  - `gate_record` input: `runDb` (required), `stage` (required), `scope` (required), `shape` (default `answers`), `gateId` | (`answers` + `decidedBy`), `source` | `sourcePath` | `review` (optional), `contextDropped` (boolean or string array), `held` (string array).

- [ ] **Step 1: Write the failing tests**
  - Reconcile, answered: records the answers map with the row's `by`, clears an armed `waiting-gate`, and returns `status: "answered"`. Already-reconciled skips the record. `record: false` skips it.
  - Reconcile, closed: clears `waiting-gate`, returns `{status: "closed", closedReason, supersededBy}`, records nothing. Timeout returns `status: "open"` with no run writes. No run returns the same statuses with no run calls.
  - Record, `respond-plan` with `gateId`: reads the row through `wait {id, waitMs: 0}`; cards come from `extra.gate-source.respond-plan` in the snapshot when no source is passed; `extra.context-dropped.respond-plan` equal to the gate id makes every textless reply an override; the result carries `rows`.
  - Record, `respond-post` with `held:["T1"]` upserts even when a decision already exists on the scope (a held resume re-record).
  - A stale gate (the gate-source field names a different gate) gives `skipped: "stale gate; respond-post's latest gate is <other>"`, with no write.
  - A still-open `gateId` is refused. `next: "hold"` on `post` gives `skipped: "next is hold: post decides nothing"`.
  - Handed: `answers` + `decidedBy: "board"` record with `--decided-by board`. `answers` without `decidedBy` is refused.

- [ ] **Step 2: Run to verify they fail**
  Run: `bun test lib/mcp/__tests__/gate-tools.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement both tools in `gateToolDefs` after `gate_open`, and add their names to `NAMES`.**
  `shellForms: { none: ... }` on both. `gate_reconcile`'s description says it is the one call for a finished wait, a doorbell, or words at a held gate, that `rt gate wait` stays background Bash, and that it never invents an answer for a closed gate.

- [ ] **Step 4: Run to verify they pass**
  Run: `bun test lib/mcp/__tests__/gate-tools.test.ts lib/mcp/__tests__/tools.test.ts lib/skills/__tests__/mcp-lint-rules-hash.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
  `git add lib/mcp && git commit -m "mcp: gate_reconcile and gate_record"`

### Task 11: whole-branch verification

**Files:** none new.

- [ ] **Step 1:** `bun test lib/gates lib/mcp/__tests__/gate-tools.test.ts lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/run-tools.test.ts lib/mcp/__tests__/shell-forms.test.ts lib/mcp/__tests__/no-unredacted-mcp-output.test.ts lib/skills/__tests__/mcp-lint-rules-hash.test.ts lib/skills/__tests__/mcp-lint.test.ts commands/__tests__/mcp-tools-list.test.ts`. Expected: all pass.
- [ ] **Step 2:** `sh plugins/mattstack/attachments/review/receive-review/tests/test-gate-ctx.sh && sh plugins/mattstack/attachments/review/review/tests/test-review-source.sh`. Expected: `all passing` twice (the scripts are untouched).
- [ ] **Step 3:** `bun run check`. Expected: exit 0.
- [ ] **Step 4:** `bun run purity`. Expected: exit 0.
- [ ] **Step 5:** Fix anything red in the owning task's files, re-run that task's tests and this task, then commit any fix as `gates: <what>`.
