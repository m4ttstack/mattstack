# Gate tools: the gate protocol's bookkeeping moves into rt's MCP server

## Why

The gate-protocol include is about 4.75K compiled words and is inlined
into six skills per team pipeline run (about 28.5K words a run). Most of
it is bookkeeping an agent walks by hand: bracket the gate, arm and clear
`waiting-gate`, take the CAS winner's `by`, record the decision, discard a
late signal. On top of that, the review skills fit their gate opens with
two jq scripts (`gate-ctx.sh`, `review-source.sh`) that exist in 6+ copies
and normalize answers into decision records with rules (the override rule
above all) that carry the most red flags of any skill in the estate.

This wave moves that bookkeeping into tools, so that wave 3 can shrink
the skills to "call the tool, branch on its result". Code and tests only:
no skill, script or plugin version changes.

## Goals

- `gate_open`: a TypeScript port of `gate-ctx.sh` and `review-source.sh`
  that validates, builds, fits and opens a structured gate, returns ready
  form chunks of at most 4 questions, middle-truncates oversized labels,
  and saves the "context dropped" fact to the run.
- `gate_record`: answer normalization, the respond-plan override rule,
  the respond-post and review-post selections, `decidedBy` = the actual
  winner, and late answers discarded.
- Run-aware `gate_ask` / `gate_answer`: optional `runDb` and `stage`; when
  given, they write the run's `gate` and `waiting-gate` fields and record
  the decision.
- `gate_reconcile`: one call for every re-entry (wait finished, doorbell,
  words at a held gate): re-read, record, clear `waiting-gate`, say
  whether the gate was already reconciled.

## Non-goals

- No skill, include, script or fixture edits under `plugins/mattstack`
  (wave 3 shrinks the skills; the scripts stay until then).
- No console change. No daemon gate-registry change.
- No run lifecycle work (`run_hold`, attempts, stage starts): the
  run-engine lane owns those.
- No `herd_gate_answer` / `herd_gate_park` changes (herd-tools lane).

## Anti-goals (a failure even if it works)

- A tool that picks an answer, decides on a budget, or opens a gate the
  skill did not ask for. Tools return results; skills own gates.
- A port whose option labels, descriptions or fitted contexts differ by a
  byte from the scripts': older renderers parse those labels.
- A run parameter that becomes required. Board and herd panes walk the
  same protocol with no run; with no `runDb` every tool behaves exactly as
  today plus the new result fields.
- A new `shellForms` rule that turns today's skill lines into strict-lint
  failures before wave 3 rewrites them.

## Decided

- **Selection shape (Matt, via the herd gate):** generic gates record the
  registry's answers object keyed by question id: a bare value (string or
  array), or `{value, note?, text?}` only when a note or text rides, or
  `{writeIn}`. `respond-plan`, `respond-post` and `post` keep their
  existing site shapes, built by `gate_record`. No console change this
  wave (`decisionSentence` already renders any flat selection; the story
  only special-cases `hold:` / `redirect:` scopes, which these tools never
  record).
- **Field contract (agreed with run-engine):** these tools write only
  `gate`, `waiting-gate`, `extra.context-dropped.<scope>` and
  `extra.gate-source.<scope>`, and only `gate@1` decisions on the scope
  the caller names. They never touch
  `hold`, stages, run status or `pipeline-stages`. run-engine never writes
  `gate` or `waiting-gate`, records `hold:` and `redirect:` decisions
  itself, and returns failure scopes (`<stage>-failed:<n>`) as data for the
  skill to pass here verbatim.
- **Write fence:** `lib/mcp/tools.ts` (one contiguous registration
  block), a new `lib/mcp/gate-tools.ts`, `lib/gates/**`, and tests beside
  them. `lib/mcp/run-tools.ts` is not in the fence, so run writes go
  through `runToolDefs()`'s own handlers (same runs-root confinement), not
  through new exports.

## Design

### Modules

| Path | Holds |
|---|---|
| `lib/gates/jq.ts` | The jq semantics the port needs: UTF-8 byte length, codepoint slicing, jq-compatible `tojson`, ASCII-only case changes |
| `lib/gates/ctx.ts` | `gate-ctx.sh` port: `ctxErrors(source)`, `fitOpen(source, limit)`, `proseOpen(source)`, `proseContext(obj)` |
| `lib/gates/review-source.ts` | `review-source.sh` port: `reviewSourceErrors(findings, extras)`, `buildReviewSource(findings, extras)` |
| `lib/gates/form.ts` | `truncateOptionText(questions)` (label and description caps), `formChunks(questions, proseByQuestion)`, `flattenContext(string)` |
| `lib/gates/record.ts` | `normalizeAnswers`, `writeInsOf`, `respondPlanSelection`, `respondPostSelection`, `postSelection` |
| `lib/mcp/gate-tools.ts` | The tool defs for `gate_open`, `gate_record`, `gate_reconcile`, the run-aware helpers `gate_ask` / `gate_answer` call, and injectable deps |
| `lib/mcp/tools.ts` | `gate_ask` and `gate_answer` gain the run params and call into `gate-tools.ts`; `...gateToolDefs()` spreads right after `gate_ask`, so every gate tool sits in one block |

Everything under `lib/gates/` is pure (no I/O, no daemon), so it is
tested directly against the fixtures.

### Port fidelity

The port mirrors jq semantics, not just the happy path:

- Validation messages are the scripts' lines verbatim and in the same
  order (`thread-1: severity: blocking|non-blocking|question|none`, and
  `findings file: ...` / `extras: ...` prefixes for the review build).
  jq's `try ... catch false` and `has()` erroring on a non-object both
  produce messages today (a missing `threads` object reports both
  `threads: required object` and `threads.blocking: ...`); the port keeps
  that.
- Sizes are UTF-8 bytes of jq's compact `tojson`. String lengths, the
  80-character `long_carry` test and both truncations work in codepoints.
  `ascii_upcase` / `ascii_downcase` touch ASCII only.
- `mid_trunc`, `end_trunc` (with `…`, U+2026) and gate-ctx's `middle`
  (` ... ` with spaces) are separate functions, each as the script spells it.
- Sorts are stable, with the scripts' tie-breaks (`sort_by(-.b, .i)` and
  `sort_by(-.b, .i, .j)`).
- Known gap, accepted: MCP input arrives already parsed, so an
  integer-like object key ("0") reorders the way JS objects do. No gate-ctx
  shape uses one.

Parity is proven two ways: the two shell suites (`test-gate-ctx.sh`,
`test-review-source.sh`) ported case for case to bun tests over the TS
functions, reading the fixtures in place; and a differential test that
runs the real scripts (with `jq`) and the TS port over every fixture and
every mutation the shell suites use, plus a few hostile ones (a DEL
character, non-BMP text, 200-byte boundary titles), and compares the
outputs byte for byte. CI runners have `jq` (GitHub-hosted ubuntu and
macos); the differential test fails, not skips, when `jq` is missing.

### gate_open

Builds, fits and (unless handing back) opens a structured gate.

Input:

| Field | Meaning |
|---|---|
| `kind` | Registry kind, as `gate_ask` takes it (`respond-plan`, `review-post`, ...) |
| `source` / `sourcePath` | A gate-ctx@1 source (`{context?, questions}`), inline or as a file under a read root |
| `review` | `{findings \| findingsPath, extras}`: build the source with the review-source port first |
| `subject` | As `gate_ask` |
| `handBack` | Build and fit only, open nothing (a caller that owns the gates) |
| `outPath` | With `handBack`: also write the open to this temp-root path |
| `runDb`, `stage`, `scope` | Optional run; `scope` defaults to `kind`, with no kind-to-scope mapping (a review-post open passes `scope: "post"` itself) |

Exactly one of `source`, `sourcePath`, `review`. Paths are confined:
reads by `checkReadRootPath`, the `outPath` write by `checkTempRootPath`.

Steps: validate (refusal = an error naming every problem line, nothing
opened); fit at 8192 bytes exactly as `gate-ctx.sh fit`; truncate option
text (below); then the shared open path (below) with the fitted context
and questions. The form view is always built from the prose rendering of
the untrimmed source (`gate-ctx.sh prose`), so the form never shows JSON.

With `runDb`, gate_open also stores the untrimmed, validated source as
field `extra.gate-source.<scope>` = `{"gate": "<gate id>", "source":
{context?, questions}}` (`"gate": null` on a hand-back). Every open
overwrites it, so it always names the latest gate on the scope and holds
every card's full text, even when the registry copy was trimmed, turned
to prose or dropped. `gate_record` reads its cards from here when no
source is passed, and the mr-composites lane's `respond_post_execute`
reads reply bodies from it (the answer's `text` if any, else the card's).

Result when opened: `gate_ask`'s result plus `mode` (`structured` |
`prose`), `fits`, `trimmed`, `contextDropped` (true when `fits` is false or
the daemon reported `contextOmitted`), `formContext`, `formChunks`.

With `handBack`: `{open, mode, fits, trimmed, contextDropped,
droppedContexts, formContext, formChunks, outPath?}`. An open that does not
fit even as prose has whole question contexts dropped largest first (then
the gate context), because a caller opening with raw `gate:open` gets a
hard reject over the budget; `droppedContexts` names the question ids. The
file written to `outPath` has `gate-ctx.sh`'s output shape (`mode`,
`trimmed`, `context`, `questions`, `bytes`, `fits`), so today's hand-back
readers keep working.

### The shared open path (`gate_ask` and `gate_open`)

1. With `runDb`: read the run (`run_snapshot` through the run tool
   handler; a bad `runDb` refuses here, before anything opens), then write
   `gate` = scope with `stage`. `stage` is required whenever `runDb` is.
2. Middle-truncate any object option label over 200 UTF-8 bytes
   (`mid_trunc`, value untouched) and end-truncate any description over
   1024 (`end_trunc`), the review-source recipes. Report each in
   `labelsTruncated: [{question, value, field}]`. This replaces the
   protocol's "fix the refusal and re-ask" loop for these two refusals.
3. `gate:ask`, exactly as today.
4. Compute `paneAction`: `form` when presentation is `form`; on `wait`,
   `wait` when the pane is herdr (`HERDR_ENV=1` in the server's env) or the
   run's `spawned_by` is set, else `form` (an attended non-herdr session
   takes the form anyway). A no-run pane outside herdr counts as attended:
   every surface that launches an unattended pane does it in herdr.
5. With `runDb`: on `paneAction: wait`, write `waiting-gate` = the gate
   id; when context was dropped, write `extra.context-dropped.<scope>` =
   the gate id.
6. `formChunks`: the questions in gate order, at most 4 per chunk, each
   `{id, label, text, multi, options}` where `text` is the label, then a
   newline and the question's prose context when it has one, and
   `options` are the registry's normalized labels and descriptions
   (`normalizeGateOptions`). A question context that is a gate-ctx@1 JSON
   string is flattened to prose; any other string is used as is.
   `formContext` is the gate context flattened the same way.

A run write that fails after the gate opened does not fail the call: the
result carries `runErrors: [...]` beside the open gate's id, and the skill
decides. (The stop hook will also refuse the turn if `waiting-gate` never
landed.)

### Recording: one recorder behind gate_answer, gate_reconcile, gate_record

`record(scope, shape, answeredRow | handed)`:

- **Late-answer rule (signals).** For `gate_answer` and
  `gate_reconcile`, which handle signals arriving at a pane, a `gate@1`
  decision on the scope whose `decided_at` is at or after the gate row's
  `openedAt` means this gate is already reconciled: record nothing, return
  `alreadyReconciled: true`.
- **Stale-gate rule (explicit records).** `gate_record` is the skill
  saying "record this now", so it always upserts for its gate, which is
  how a held respond-post resume re-records with `held` cleared or still
  set (`decidedBy` still the row's original winner). It refuses only a
  stale gate: `extra.gate-source.<scope>` names a different gate, opened
  later. It returns `skipped: "stale gate; <scope>'s latest gate is
  <id>"`. A scope with no stored source (a plain `gate_ask` gate) has no
  staleness check. Signals (`gate_answer`, `gate_reconcile`) refuse a
  stale gate the same way, before the late-answer rule, and still clear
  `waiting-gate` when it names the gate.
  A re-ask opens a new gate (later `openedAt`), so an earlier decision on
  the same scope never shadows it. Without a run the field is absent.
  The rule is exported (`decisionForGate(decisions, scope, since)`) so
  other readers of a scope's decision, `respond_post_execute` among them,
  refuse a stale one the same way. `since` is the gate row's `openedAt`, or,
  on a hand-back (`extra.gate-source.<scope>` with `"gate": null`, the
  decision recorded through the handed path), that field row's own `at`.
- **decidedBy** is the answered row's `answer.by` (the CAS winner:
  `pane`, `board`, `console`, `shepherd`), or the caller-named decider for
  a handed decision. Never a verb name.
- **waiting-gate** is set to `-` when it currently names this gate id,
  whether or not anything was recorded.
- Every result carries `answers` (normalized), `by`, `writeIn: [{question,
  text}]`, `next` (the `next` answer's value or null) and `actOnWriteIn`:
  true when there is a write-in and `next` is absent, `proceed` or starts
  with `iterate`. The protocol's "deliberate next pick" branch becomes
  that boolean.

Shapes, with their skip rule (when a `next` answer means nothing is
decided):

- **`answers`** never skips: every answered generic gate records,
  whatever `next` is, as the protocol does today (an off-script record
  keeps its `hold` / `iterate`).
- **`respond-plan`**, **`respond-post`** and **`post`** skip when a
  `next` answer is present and is not `proceed`. respond-plan's pane-only
  `next` never reaches the registry, so a pane answer records. A board or
  console answer that carries a Hold or Iterate records nothing, so a
  resume never acts on a plan the human asked to redraft.
- Review sites pass `record: false` to `gate_answer` / `gate_reconcile`
  and record with `gate_record` and their shape, so the `answers` default
  never writes over a review scope.

Shape contents:

- **`answers`** (generic gates): the normalized answers map: each answer
  becomes its bare value unless it carries a non-empty `note` or `text`
  (then `{value, note?, text?}`), and a write-in stays `{writeIn}`.
- **`respond-plan`**: `{threads, texts?, overrides?, notes?,
  code-changes}` exactly as receive-review defines it: each answer other
  than `code-changes` (and `next`) unwraps to its value, splits at the
  first `:` into verb and thread id, and keys by the thread id, never by
  `thread-<n>`. The override rule: a `reply:` with no `text` is an
  override when the thread's card was not `verbatim`, or the answer
  carries a note, or that question's context never reached the gate (the
  run's `extra.context-dropped.<scope>` names this gate; the caller passes
  `contextDropped: true` or the question ids; or the stored row lacks a
  context the source had). With no source at hand every textless `reply:`
  is an override (the snapshot-only reading). Also returns `rows`
  (`{threadId, file, verdict, recommended, gate1, reply}`) for the report.
- **`respond-post`**: `{threads: {<id>: {post, resolve, text?, note?}},
  held?}` over every offered thread (from the source's `reply@1`
  questions, or the stored row's `post:` / `resolve:` options), `text`
  only on a `post:` answer that carries it, `held` from the caller. A
  retired-shape handed `post` (`replies` / `replies-<n>`) records unchanged.
- **`post`** (review-post): `{findings: <union of findings-* values>,
  disposition: <outcome>}`, legacy `tiers` as `{levels, disposition}`,
  plus `replies` (`{discussionId, resolve, body?}` from `thread-<n>`
  answers, `body` the answer's `text` else the carryover card's `reply`)
  and `restored` (`[{id, changed}]` from `restore:<id>` picks and the
  skipped cards) when present. A caller's decided `{findings, outcome, ...}`
  normalizes to the same object.

### gate_answer (run-aware)

New optional inputs: `runDb`, `stage`, `scope` (default: under a run, the
scope whose `extra.gate-source.<scope>` names this gate, else the answered
row's `kind`; the same default applies to `gate_reconcile`), `record`
(default true, except on a review gate: kind `respond-plan`,
`respond-post` or `review-post`, or scope `post`, `respond-plan` or
`respond-post`, where it defaults false; the same default applies to
`gate_reconcile`). With `runDb`, after the daemon answers (recorded or
`conflict: true`), the `answers` shape is recorded from the winning row
unless `record` is false. A review site records its review shape with
`gate_record` at the point its site records; with `record` unpassed, a
review gate returns `skipped: "<scope> records its review shape with
gate_record; ..."` and still clears `waiting-gate`. The result keeps
today's `{row, conflict?}` and adds the recorder's fields. Refusals are
unchanged.

### gate_reconcile

Input: `id`, and optionally `runDb`, `stage`, `scope`, `record`. Does the
2-second `gate:wait` re-read with this session's id (stamping
`consumedAt` as `rt gate wait` does), then:

- `answered`: the recorder (late-answer rule, record unless `record:
  false`, clear `waiting-gate`); `status: answered`.
- `closed`: clear `waiting-gate`; `status: closed`, `closedReason`,
  `supersededBy`. Never an answer.
- timed out: `status: open`; nothing written, `waiting-gate` left armed.

`rt gate wait <id>` stays background Bash: no tool blocks past its timeout.

### gate_record

For a decision a gate tool did not record at answer time: the review
scopes (recorded at their site's own point, `respond-post` and `post`
after acting), and caller-handed decisions (board wrappers).

Input: `runDb` (required), `stage`, `scope`, `shape` (`answers` |
`respond-plan` | `respond-post` | `post`), and either `gateId` (the
answered row is read) or `answers` + `decidedBy` (handed). Optional
`source` / `sourcePath` / `review` (the same inputs `gate_open` takes, so
the cards are rebuilt deterministically; when none is passed the cards
come from `extra.gate-source.<scope>`), `contextDropped`, `held`. A
`gateId` whose gate is still open refuses. A gate tool never acts, so
`gate_record` records whenever the skill calls it: for `respond-post`
that can be right after the answer and before execution, with the
executor re-recording the same scope with `held` afterwards (decisions
upsert). The shape builders are exported from `lib/gates/record.ts` for
that executor.

Result: `{recorded, alreadyReconciled?, selection, decidedBy, rows?,
answers, writeIn, next, actOnWriteIn, skipped?}` where `skipped` names why
nothing was recorded (a `hold` / `iterate` next, or already reconciled).

### Tool hygiene

- Every new tool declares `shellForms: { none: ... }`, so the strict mcp
  lint rule set (and its pinned hash) does not change this wave.
- Every result goes through `callTool`'s redaction like every other tool.
- Descriptions say what the tool returns and that the skill owns the
  gate; none tells the agent to act on its own.

## Testing

- Ported shell suites as bun tests over `lib/gates/*` (every `check` in
  `test-gate-ctx.sh` and `test-review-source.sh`).
- The differential test against the real scripts.
- `lib/gates/__tests__/record.test.ts`: every row of the override rule,
  respond-post `held` / empty arrays / text and note, the post union and
  legacy tiers, write-in and `actOnWriteIn` cases, the late-answer rule.
- `lib/mcp/__tests__/gate-tools.test.ts`: the tools with injected deps
  (gate client and run tool handlers faked): no-run path unchanged, run
  path writes exactly the agreed fields in order, a bad `runDb` opens
  nothing, a failed run write after opening reports `runErrors`,
  `paneAction` for each attendance case, `handBack` drop order, path
  confinement refusals.
- `lib/mcp/__tests__/tools.test.ts` stays green; the roster test sees
  the new tools.
- Gates before done: `bun test` on every touched test file, `bun run
  check`, `bun run purity`.

## Behavior changes from today

What a caller sees differently once this ships, beyond the new tools:

- `gate_ask` truncates an object option label over 200 bytes (middle)
  and a description over 1024 bytes (end), and reports them in
  `labelsTruncated`. Today the daemon refuses the open. This applies with
  or without a run.
- `gate_ask` / `gate_answer` results gain fields (`paneAction`,
  `formChunks`, `formContext`, and the record fields on `gate_answer`).
  Existing fields are unchanged.
- Under a run, `gate_answer` and `gate_reconcile` with no `scope` default
  the scope to the one whose `extra.gate-source.<scope>` names the gate,
  else the row's `kind`. Without a run the scope is unused.
- `gate_answer` refuses an empty or whitespace `scope`, like the other gate
  tools.
- Under a run, `gate_answer` and `gate_reconcile` record nothing for a
  stale gate (the scope's `extra.gate-source.<scope>` names a later gate)
  and return `skipped: "stale gate; <scope>'s latest gate is <id>"`.
- Under a run, `gate_answer` and `gate_reconcile` record nothing on a
  review gate unless `record: true` is passed (today `gate_answer` records
  unless `record: false`), and return a `skipped` naming `gate_record`.
- `checkReadRootPath` takes an optional extension (default `.md`).
  Existing callers are unchanged; `gate_open` and `gate_record` read
  `.json`, checked on the realpath.
- With no `runDb`, `gate_ask` and `gate_answer` send the daemon the same
  payload as today for in-cap input and make no run call.

## Left to the builder

- Internal names and file splits inside `lib/gates/`.
- Whether `formChunks` items carry a suggested `header`.
- How the deps seam in `gate-tools.ts` is shaped, as long as tests never
  reach a real daemon or a real run store outside a temp dir.

## My calls (flag any you disagree with)

- Label truncation lives in the shared open path, so `gate_ask` stops
  refusing oversized labels and descriptions too (it truncates and
  reports), not only `gate_open`.
- `gate_ask` also returns `paneAction`, `formChunks` and `formContext`.
- A no-run pane outside herdr is treated as attended.
- `actOnWriteIn` treats `proceed` and any value starting with `iterate`
  as "not a deliberate pick".
- `handBack` drops whole contexts itself when even prose is over budget.
- The post shape records `restored` as `[{id, changed}]`.
- `extra.context-dropped.<scope>` holds the gate id, so a re-ask on the
  same scope is never misread as dropped.
- `extra.gate-source.<scope>` stores the whole source in the run DB, so
  cards survive pane death and trimming (agreed with mr-composites, whose
  executor reads it).
- The late-answer rule covers signals (`gate_answer`, `gate_reconcile`);
  `gate_record` re-records its own gate and refuses only a stale one.
- Review shapes skip on a non-`proceed` `next`; the `answers` shape
  never skips.
