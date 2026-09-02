# Pipeline gates: forms at every decision point, a hook that enforces it

**Date:** 2026-09-01
**Status:** design approved in conversation (sections 1 to 8); section 9 added from the pack audit; adversarial review round one applied; review loop approved on round three (2026-09-01); ready for writing-plans
**Builds on:** `2026-08-24-compile-native-pipeline-design.md`,
`2026-08-25-compile-native-followups-design.md`, and rt's
`2026-09-01-runs-write-verbs-design.md` (rt PR #172, merged to main as
`ec2572e2`; the skills side is this repo's `rt-runs-verbs` branch, d7b3d80,
which this branch is cut from). Nothing those specs settled changes here
except where a section says so.

The companion spec for the team pack's fills lives in that pack's repo
(`docs/specs/2026-09-01-pack-gates-and-seam-cleanup.md`); this repo's purity
gate keeps domain vocabulary out of here.

## Problem

Every human stop-point in the pipeline engines is prose. A survey of the
engines on the `rt-runs-verbs` branch found roughly twenty places that say "stop for the
user", "ask commit / stash / abort", "surface to the user", or "report and
stop", and not one that names the structured-question tool. Of the seven
`<HARD-GATE>` blocks, six are print-before-acting self-gates; only the
receive-review posting gate is a human decision. The work engine's Close is
`rt runs run-status --status done` and nothing else: a green run's last act is
writing `ci=green`, then the turn ends. The standalone review verbs end with a
verdict the agent sometimes presents as a form and sometimes as a wall of
text.

Two consequences. First, the human reads prose and types an answer, at
exactly the moments the pipeline most needs a crisp decision (ship, mark
ready, go back a stage, done). Second, the console cannot tell a run that is
waiting on a form (herdr `blocked`) from one whose agent ended its turn in
prose (herdr `idle`); the second one sits as "idle" until the thirty-minute
stale threshold, and nothing nudges it.

The runs write verbs record stage rows, fields, and `decision record` rows
with timestamps, and emit `run-updated` per write. There is no notion of a
pending decision, a turn boundary, a redirect, or a hold. Those are what this
spec adds, on the skills side, with one small rt placeholder variant.

## Decisions already made

| Question | Decision |
|---|---|
| How much to build | Prompt layer and Stop hook now; the daemon-side idle nudge is a follow-up spec handed to rt |
| Which gates are hard | Close, ship (before push and before mark-ready), stage failure, plan approval, CI failure, provision conflict, the review posting gates; the hook makes every other mid-run turn end a gate too |
| Where wrap-up lives | A mattstack include compiled into a public door; the personal `wrap-up` skill is retired |
| Iteration model | Redirect to existing stages plus standing options on every gate; no dedicated iterate stage |
| Standalone verbs | Start a single-stage run for themselves when `RT_RUN_DB` is unset, so the hook and the console cover them |
| Pack cleanup | Full seam cleanup of the team pack's fills, in the companion spec |

## 1. The gate contract (`gate@1`)

A gate is a named decision point. Every gate site in an engine is the same
recipe, in this order:

```bash
rt runs field set gate <scope> --stage <stage>
```

then one sentence of context and the form (the wrap-up contract, section 2),
then stop. When the answer arrives:

```bash
rt runs decision record --contract gate@1 --scope <scope> --selection '<answers as JSON>' --decided-by <engine>
```

then act on it. `<scope>` is the gate's name. The pipeline set is `plan`,
`provision`, `evidence`, `evidence-attach`, `ship`, `mark-ready`, `ci`,
`close`, `<stage>-failed`, `redirect`, `hold`; section 9 adds the standalone
verbs' scopes; `clarify` is the generic scope for any mid-verb "which one
do you mean" (the review verb's ambiguity ask, self-review's "which
requirements", checkout's "which branch"). The `gate` field write is the
commitment the estate's existing HARD-GATEs already use (print before act);
it is also what lets the console name the pending gate. The decision row is
the record; a gate whose `gate` field is newer than its last `gate@1`
decision for that scope is pending.

The decisions table upserts on `(run, contract, scope)`, so a gate that can
fire more than once per run carries the stage and attempt in its scope:
`redirect:ship:2`, `hold:implement:3`, `implement-failed:2`, `ci:watch-ci:2`,
`conflict:rebase-worktree:1`. The attempt is the current stage row's, read
from `snapshot`. Gates that fire once per pass (`plan`, `close`,
`mark-ready`) keep the bare name; after a redirect they fire again and the
upsert keeps only the latest answer, which is intended: the
`redirect:<from>:<attempt>` row preserves why the loop happened, and the
latest `close` or `mark-ready` answer is the one that stands. That is what
lets the timeline (section 8, item 5) show a loop's history without a schema
change.

Every gate form carries standing options after its own question: **Iterate
here** (the human's `Other` text is the change request) and **Hold**
(section 4) always; **Go back to `<stage>`** when `snapshot` shows an
earlier stage row, which a single-stage run (section 6) never does.

Outside a run (`RT_RUN_DB` unset), the two `rt runs` lines are skipped and
the form alone is the gate. Section 6 makes that case rare.

`-` is the cleared sentinel wherever this spec writes a field (`hold`, a
redirected stage's produces): `field set <key> -`. An empty string would
store, but it is invisible in a `snapshot` listing and `field get` already
refuses it, so a visible sentinel that matches `hold`'s is the one readers
can check. Every reader treats it as absent: `field get` returning `-`
is read as "not set", and the work engine's completeness check (every
produce non-null before `stage-done`) becomes "non-null and not `-`".
Without that amendment the redirect clear in section 4 clears nothing.

The contract text, sentinel included, goes into the parameterized-skills
convention reference as "Stage contract v3: gates", beside contract v2.

## 2. Wrap-up: one include, one compiled door

`attachments/wrap-up-form/SKILL.md` is the include. Its body is today's personal
wrap-up skill, kept as a positive recipe: one optional sentence of context,
then the runtime's structured-question tool, then stop; one question per
open item in three buckets (important details, decisions, next steps);
recommended option first and labelled; omit an empty bucket; when the tool
caps questions, fill the first call and wait. It contains no `rt` command
and no placeholder, so it is a legal include target (`{{include:wrap-up-form}}`,
alone on its own line). Two things from the personal skill do not carry
over: the "if this runtime has no such tool, the chat message itself is the
form" clause, which is the exemption an agent under pressure reaches for and
which the Stop hook cannot tell from prose (the estate's runtime always has
the tool); and the worked example, so the include stays under two hundred
words for the fourteen engines that inline it. Its "common mistakes" list is
the seed of a rationalization table; whether the final form is a table or a
recipe is decided by the RED run (Testing), which is also where the rows
come from. The expectation, from the observed failure (the agent knows the
form is wanted and writes prose anyway), is a discipline failure.

The public door is compiled from the same file: `wrap-up` joins
`pack/stubs.jsonc` as a zero-slot verb whose `engine` is `wrap-up-form`, and
`surface.jsonc` lists it. The include's directory cannot share the verb's
name: the compiler removes `attachments/<verb>/` as a stale private compile
before writing a public verb (`commands/skills.ts`, `otherSideDir`), which
deleted the include source on the first compile attempt. A compiler guard
against removing a directory that holds a source is rt follow-up item 7. `rt
skills compile --pack mattstack` emits `skills/wrap-up/SKILL.md`; `rt skills
check` catches drift. One source, no hand copy.

One file serves both roles, verified against the compiler (rt main,
`lib/skills/sources.ts`): `loadInclude` resolves only the flat path
`attachments/<name>/SKILL.md` and rejects a target that declares a `slots`
key at all (an empty `slots: {}` is truthy and is rejected) or contains a
placeholder; `loadStepSource` also searches the flat `attachments/<name>/`
path, requires `type: pipeline-step`, and reads an absent `slots` key as no
slots. So the include's frontmatter is `type: pipeline-step` with no `slots`
key, unlike the forge engines' `slots: {}`. Confirmed in practice by plan 1
Task 3 (with the directory-name rule above).

The personal `wrap-up` skill is deleted from its source repo and the
`~/.claude/skills/` symlink removed, in the same release.

## 3. Gate sites

Each engine that gains a gate inlines `{{include:wrap-up-form}}` once and writes
its gate sites as the section 1 recipe. The form content column is what the
engine supplies; a bound domain fill may add questions (companion spec).

| Engine | Scope | Where | Form content |
|---|---|---|---|
| work | `close` | before `run-status`; the run stays `running` until answered | the MR link and its state (draft or ready, decided at the `mark-ready` gate); done / iterate / go back / hold |
| work | `<stage>-failed` | replaces "report, stop" after a stage failure | resume / fix and retry / go back / abandon (`run-status abandoned`) |
| stage-plan | `plan` | after the triage print, before `decision record` | the tier (recommended first), the failing test on direct-tdd, the domain policy's questions |
| stage-ship, ship | `ship` | before the push | commit / stash / abort on a dirty tree; confirm the commits; draft or ready |
| stage-watch-ci, ship, watch-ci | `mark-ready` | fired once per path by the verb that owns the run's close there: stage-watch-ci on a green verdict when `mr` is set and the MR is a draft (the pipeline path); ship after its inherited watch-ci hands back green (the standalone ship path); watch-ci only when it started its own run (the standalone watch-ci path). An inherited watch-ci fires `ci` and nothing else. Precondition in both, as the engine can check it: `ci` is `green` and `evidence` is set and not `-`; whether the evidence matches the MR's head sha is a domain fill's checklist item, not an engine check | mark ready now (recommended) / keep it draft. On yes, the engine runs the forge's ready command under the section 7 host rule; no domain fill supplies it |
| stage-watch-ci, watch-ci | `ci` | real failure, timeout, no pipeline | fix and re-push / retry the job / hand back / abandon |
| stage-provision | `provision` | branch already attached to a tree | resume in that tree / fresh tree |
| stage-evidence | `evidence`, `evidence-attach` | before capture, when the bound domain declares intake questions; before the MR is modified | the domain's intake and source questions; the proposed annotations (multi-select, all pre-selected) and attach now / hand back the markdown |
| review, self-review, receive-review | the existing Gates A, B, 1, 2 and the `clarify` asks | already form-shaped | rewritten to name the tool and follow the recipe (section 9). These three engines inline the include; `review-posting` is itself an include target and may carry no placeholder, so it names the form contract in prose and the verb that includes it supplies the include |

Stage boundaries with no gate in this table keep flowing; a form at every
boundary would add round trips to the stages that should run unattended.
Iteration always enters through a gate.

Each gated engine gains the rationalization rows its RED run produces
(Testing). The three already observed in the wild, to be confirmed there:
"I'll summarize and let them type", "the options are obvious, prose is
faster", "they asked me to be quick, so a compact list". The work engine's
red flags gain: "About to end the turn with the run still `running` and no
form on screen? Stop."

A verb running inside a stage (watch-ci invoked from a ship flow) inherits
the run and uses `run.current_stage` from `snapshot` as its `--stage`. An
inheriting verb writes no `stage-done` and no `run-status`: only the verb
that ran `run-start` closes the stage and the run. Otherwise watch-ci's
green path would end ship's stage row and mark the run done before ship's
`mark-ready` gate, and the hook would fail open at exactly that gate.

## 4. Iteration: redirect and hold

Pipelines loop in practice (an implement attempt 2 after ship, a second
self-review). The DB already tracks attempts; what is missing is the
decision that caused the loop.

**Redirect.** A new `## Redirect` section in the work engine, beside `##
Resume`. When a gate answer or a human message names an earlier stage:

```bash
rt runs decision record --contract gate@1 --scope redirect:<from>:<attempt> --selection '{"from":"<stage>","to":"<stage>","reason":"<their words>"}' --decided-by work
rt runs field set <key> - --stage <to>      # every produce of <to> and of each later stage
rt runs stage-start --stage <to>
```

then walk forward from `<to>`; later stages re-run as new attempts. The
produces are cleared to the `-` sentinel first, and the walk's completeness
check treats `-` as missing (section 1), so the check cannot pass on a stale
`mr` or `ci` from the previous pass. The reason is the human's words, never
a category.

**Ready is the human's call.** The close gate offers *done* and *iterate*;
the run cannot reach `run-status done` until *done* is picked. A pipeline can
loop indefinitely and still never end in prose.

**Hold.** A gate answer of *hold* records the decision with scope
`hold:<stage>:<attempt>`, writes `rt runs field set hold "<reason>" --stage <stage>`, and the agent
ends its turn. The Stop hook (section 5) allows a turn to end when the
`hold` field's `at` is newer than the latest stage row's `started_at`.
Resume (the existing section, plus the redirect rule) clears it with `field
set hold - --stage <stage>` right after the next `stage-start`. The fields
table is one row per key (`PRIMARY KEY (run_id, key)`, upsert on set), so
`snapshot` carries exactly one `hold` row with the `at` of its last write,
and `field set` accepts any key; no rt change is needed for `gate`, `hold`,
or `nudged`. Without hold, parking a run overnight would fight the hook.

## 5. The Stop hook

`hooks/pipeline-gate-stop.sh`, shipped in this plugin's `hooks/hooks.json`
under `Stop` with a five-second timeout. It is the hard gate: a Stop hook
does not fire while an `AskUserQuestion` is awaiting the user, so at the hook
"presented a form" and "ended in prose" are distinguishable, and blocking
the second leaves the first as the only way to end a mid-run turn.

Logic, in order:

1. Read the hook's stdin JSON. The hook does not pass through on
   `stop_hook_active`: that flag is true on the very next stop after a
   block, so honouring it would make this a one-shot nudge. Claude Code's
   own cap (eight consecutive blocks, then the stop goes through) is the loop
   guard, and every block re-delivers the same exits, hold and close among
   them, so an agent that cannot comply has two ways out before the cap.
2. Find this session's run. First `rt runs find --session <session_id>
   --running` (rt PR #175; the binary found with `command -v rt`, falling
   back to `$HOME/.local/bin/rt`, since a hook's PATH need not include it):
   its `runs` array, newest first, gives the candidate `runDb` paths. When
   that output is not JSON with `ok: true` (an rt older than the verb falls
   through to the run listing), the candidates are the `state.db` files
   under `${RT_RUNS_ROOT:-~/.mattstack/runs}/*/*/` modified in the last 48
   hours. For each candidate, `RT_RUN_DB=<db> rt runs snapshot`; a run
   matches when `run.status` is `running` and its `claude-session` field
   equals the hook's `session_id`; with two matches, the newer `started_at`
   wins. No match, `rt` missing, non-JSON output, or three seconds spent:
   exit 0 silently. A snapshot costs about a third of a second of bun
   start-up, so the find verb (or, on the fallback, the mtime filter) is
   what keeps a machine with many runs under budget.
3. A match whose `hold` field is newer than its latest stage row's
   `started_at` and is not `-`: exit 0.
4. Otherwise exit 2 with the reason on stderr, which Claude receives as the
   instruction to continue:

   > Run `<runId>` is `running` in stage `<stage>`. A turn cannot end here
   > in prose. Four exits: continue the stage; open the decision as a form
   > (`rt runs field set gate <scope> --stage <stage>`, one sentence, the
   > structured-question tool, stop); park it (`rt runs field set hold
   > "<why>" --stage <stage>`); or close it (the close gate, then `rt runs
   > run-status --status done|failed|abandoned`). If the user asked you something
   > mid-run, the answer is the sentence before the form.

That last sentence is the design, not a side effect: a mid-run side question
answered in prose is exactly the dead turn this spec exists to remove, so
the answer rides in front of a "continue the run?" form.

If a resumed or continued session reports a different id to hooks than the
one its Bash calls exported when the run started, the run goes unmatched
and the hook fails open. The Resume section's
fresh `stage-start` re-records `claude-session` (identity is written at
every `stage-start`), so the mismatch lasts one turn.

The hook writes nothing: the daemon's agent-status poller sees the pane flip
and the console updates. A run the hook cannot find is not this session's
problem; the daemon-side nudge (section 8) is the backstop for panes without
this plugin.

Tests are offline shell tests beside the doorbell hook's, with a stub `rt`
on `PATH` and stdin fixtures: no run, a matching running run (exit 2 and the
message), the same with `stop_hook_active` true (still exit 2), a done run,
another session's run, two matching runs (newest named), a held run, a run
dir older than 48 hours (not scanned), `rt` missing, `rt` printing usage
instead of JSON.

**Prerequisite probe, run 2026-09-01.** A temporary user-level Stop hook
logging its stdin recorded zero Stop events while an `AskUserQuestion` was
on screen and exactly one after the answer and the final message, with
`stop_hook_active` false. The design's premise holds on the runtime this
estate runs.

## 6. Standalone verbs run as single-stage runs

`review`, `self-review`, `receive-review`, `ship`, `watch-ci`, and
`sync-open-mrs` are compiled verbs that today run with no run DB, so neither
the hook nor the console can see them. This is where the review wall-of-text
lives, including every review or respond a board pane launches. Each of
those six gains, at its start:

```markdown
{{run-start.flags:<verb>}}
```

then

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage <verb>
```

(the same `PACK_DIRS` derivation and JSON gate as the work engine; a public
verb under `skills/<verb>/` and an internal one under `attachments/<verb>/`
are both two levels below the pack root) guarded by "`RT_RUN_DB` is unset,
or its `snapshot` shows a run that is not `running`" (a verb invoked inside
a pipeline stage inherits the pipeline's running run and skips this; a
finished run left in the variable does not count). Both the work engine's
Close and a standalone verb's close end with `unset RT_RUN_DB` after
`run-status`, since the export otherwise outlives the run in the session's
shell and the next verb would `stage-start` into a finished run (nothing in
`stageStart` checks the run's status). The verb that ran `run-start` closes
with `stage-done` and `run-status done` after its final gate; a verb that
inherited the run closes nothing (section 3).

Standalone verbs share the work engine's Resume rule: before `run-start`,
a `running` run for the repo with this verb's work type is offered as a
`clarify` gate (resume it / start fresh); resuming re-exports `RT_RUN_DB`
and its `stage-start` re-records the session. `{{run-start.flags:<verb>}}` is a
placeholder variant rt adds (section 8, item 1; rt PR #175): the existing
placeholder renders a fenced JSON block with one flag line per pipeline in
the manifest; the variant renders the same shape with one key, `<verb>`,
whose value carries `--work-type <verb> --pipeline <verb>` and the same
provenance flags, so the repo key stays derived in one place (the compiler)
and the console groups the verb's runs with the repo's pipelines. Like the
work engine's, the placeholder stands alone on its own line above the
`run-start` fence. Until that
variant ships, the guard falls through to the section 1 "outside a run"
rule.

`rebase-worktree`, `checkout`, `checkout-and-open`, and `map-open-mrs` do
not start runs: the first is usually a per-branch step inside
`sync-open-mrs` and inherits its run, and the other three end in a fixed
report shape with no decision in it. Section 9 lists the gate sites this
adds, from the pack audit.

## 7. Team pack changes, and the engine edits they need

The companion spec in the pack's repo covers: moving the pack's prose asks
into gate content (plan, provision, ship, mark-ready, evidence); deleting
the process the engines already own from the fills; the board fills reading
the pack's compiled verbs instead of the unfilled engine found through
`claude plugin list`; and `disable-model-invocation: true` on every bound
fill. The pack recompiles against this release and bumps.

Two of its items are engine edits, owned here:

- **stage-watch-ci** gains, beside `{{stage.dir}}`, the paragraph the
  domain fill carries today: the engine's scripts and the forge adapter are
  vendored inside the compiled skill's own directory (`scripts/` and
  `parts/forge/scripts/`), never derived from a plugin install. The fill
  keeps only its script names and its pipeline-shape facts.
- **stage-ship, ship, stage-watch-ci, watch-ci** forge-host rule: read
  the origin remote's host (`git remote get-url origin`); a GitLab host
  means `glab`, a GitHub host means `gh`, anything else is a `clarify` gate
  rather than a guess. It covers the generic push-and-open fallback (today
  it names `glab` first and `gh` as an aside) and the `mark-ready` action
  (`glab mr update <iid> --ready`, `gh pr ready <number>`), so the pipeline
  path needs no domain fill to mark an MR ready.

## 8. rt follow-ups (handed to rt by DM, not built here)

1. **`{{run-start.flags:<verb>}}`** placeholder variant (section 6; rt PR
   #175). It renders the same fenced JSON block as the no-argument form,
   with the verb as its single key.
2. **Idle nudge.** The agent-status poller already sees a running run's
   agent flip to `idle`. After sixty seconds idle with no `hold` and no
   nudge yet in this stage, `rt pane send <herdr-pane field> --text
   "/wrap-up"` and `field set nudged <stage>@<ts>`. Backstop for panes
   without the hook.
3. **`rt runs find --session <id> [--running]`** read verb (rt PR #175,
   shipping with item 1): the hook's primary lookup; the directory scan
   stays as the fallback for an rt that predates it.
4. **Attention evidence.** When `blocked` and a gate is pending, evidence
   reads "waiting on you: `<scope>`"; a run with a fresh `hold` field is
   `held`, not `stale`. Until this lands a held run reads `stale` after
   thirty minutes; cosmetic, and named in the release order.
5. **Timeline.** Render `redirect` and `gate@1` decisions inline in the
   stage timeline so a loop reads as a loop, with the reason.
6. **Cross-reference rewriting.** Compiled verbs carry the engines'
   `mattstack:<engine>` references verbatim (`mattstack:checkout`,
   `mattstack:watch-ci`, `mattstack:rebase-worktree`, `mattstack:map-open-mrs`
   in the audited pack), and those are not invocable names: the plugin's
   public doors are the few `surface.jsonc` lists, the rest are attachments. When the pack compiles
   the referenced engine, the compiler should rewrite the reference to the
   pack's own verb name; when it does not, `rt skills check` should flag it.
7. **Compile must not delete a source.** `rt skills compile` removes
   `attachments/<verb>/` before writing a public verb, to clean a stale
   private compile; when that directory holds a source SKILL.md (no
   `compiled:` marker, a `type:` of its own), it should refuse or skip. Until
   then, no include or engine source may share a compiled verb's name.

## 9. Standalone verb gate sites

The audit of the installed team pack (176 human decision points across its
verbs and the three board wrappers; 20 name a form, 6 of those explicitly;
all 51 inside the pipeline name none) puts the review family's gates
entirely in engine text, so this section is all mattstack. Per verb:

| Engine | Scope | Where | Form content |
|---|---|---|---|
| review | `post-severity`, `post-disposition` | the existing Gate 1 then Gate 2, severities first | Gate 1: multi-select of the severity levels present, all pre-selected; Gate 2: single-select disposition from the forge's offered set, Comment pre-selected. Two calls, in that order; content approval answers neither |
| self-review | `self-review` | replaces "fix Critical and Important, note Minor, then continue or ship" | fix the blocking findings now (recommended) / fix minors too / ship as is / iterate; the draft precedes the form, the form is the close |
| receive-review | `verdicts`, `fixes`, `post` | the existing Gates A, B, and the posting gate | A: approve the verdict table and drafted replies / edit / redo; B: which `valid` fixes to implement (multi-select, all pre-selected); post: which verdict categories to reply with (multi-select, all present pre-selected) |
| watch-ci | `ci`, `mark-ready` | replaces "finish by reporting the verdict" on red; on green the verdict is one line, then, only when watch-ci started its own run, the `mark-ready` gate (when `mr` is set and the MR is a draft) and the close. A watch-ci inherited from ship fires `ci` only and hands control back with the run `running`; ship owns `mark-ready` there | fix and re-push / retry the job / hand back / abandon; mark ready now / keep it draft |
| ship | `ship`, `mark-ready` | section 3 | section 3 |
| sync-open-mrs | `sweep`, `push` | the batch go-ahead and the batch force-push offer | rebase these branches in this order (multi-select, all pre-selected) / skip; push all rebased branches / pick / none, then watch CI or not |
| rebase-worktree | `push`, `conflict` | the closing push ask and the conflict hand-back | force-with-lease push now / leave unpushed; on conflict: resolve here with me / abort / leave the rebase in progress |
| shepherdr | `wrap-up` | the existing wrap-up section's three prose asks | close panes or keep for review; clean worktrees; clean job dirs, one form via the include (shepherdr keeps its own herd DB and starts no run, so this is the form-only case) |

`review`'s close HARD-GATE (the final message ends with the target's real
URL as a markdown link) stays; the link is the sentence before the form.

The board wrappers that launch `review` and `receive-review` live in their
own repo. They delegate the gates to these verbs, so they need no gate of
their own. The review wrapper currently numbers the posting gates in the
opposite order from the engine (disposition before severity) and says
"present the gate"; the respond wrapper only says "hold at a posting gate".
The companion note for that repo: drop the wrapper's own gate text and defer
to the domain verb's gates by name. The "present it" prose in the respond
path is the pack's own board fill, handled in the companion spec. The doctor wrapper is excluded on purpose;
its contract is "the human is not watching, never ask in the pane", and its
escalation string is its whole hand-back.

Verbs that end in a fixed report shape and carry no decision (`checkout`,
`checkout-and-open`, `map-open-mrs`, the pack's reference skills) get no
gate; a closing form with nothing to decide is the noise this spec removes.

## Plans

Three implementation plans, in this order, so the first can ship without the
third:

1. **Foundation:** the include and door (section 2), the Stop hook and its
   probe (section 5), the contract text in the convention reference
   (section 1), `unset RT_RUN_DB` at close (section 6), the wrap-up
   retirement (section 2).
2. **Gate sites:** sections 3, 4, 7 and 9, one engine per task, each its
   own RED/GREEN cycle; the rubric says not to batch skills.
3. **Standalone verbs as runs:** section 6, blocked on rt follow-up item 1.

## Testing

Writing-skills TDD, per changed skill:

- **RED.** A fresh subagent runs a mock end-of-stage scenario with the
  current engine text and three pressures (time, "be quick", sunk cost).
  Record the prose ending verbatim; those are the rationalization rows.
- **Wording.** Micro-test the include and the gate recipe against a
  no-guidance control, five reps each, every flagged output read by hand;
  convergence on one shape is the pass.
- **GREEN.** The same scenarios with the include and recipe present.
- **Hook.** The shell tests in section 5.
- **Estate.** `sh tests/certify.sh <dir>` for every touched attachment,
  `tests/repo-purity.sh`, `rt skills check --pack mattstack` then `compile`,
  the pack's `check` and `compile`, version bumps, `claude plugin update` for
  both, restart.
- **End to end.** One real pipeline run on a throwaway ticket, watched from
  the console: the close gate appears as a form, the console shows
  "waiting on you", a redirect to implement records and re-runs, and a
  deliberate prose ending is blocked by the hook once.

## Release order

1. rt: the placeholder variant (item 1) lands and releases; item 4 should
   ride the same release so held runs do not read stale.
2. This repo: `rt-runs-verbs` merges to `main` (rt's release makes that
   safe); this branch rebases onto it, merges, bumps.
3. Personal skills repo: delete the old wrap-up skill and the symlink, and
   change the `~/.claude/CLAUDE.md` line that tells every session to invoke
   `/matt:wrap-up` at turn end to the compiled door's name.
4. The team pack: companion spec's changes, recompile, bump, update,
   restart.

## Out of scope

- A dedicated iterate stage engine.
- Forms at every stage boundary.
- Any console rendering change (rt and console own it; item 5).
- The board wrappers themselves; they delegate to the pack's verbs, which
  sections 6 and 9 cover. The review wrapper's gate-order inversion is a
  note to that repo (section 9).
