# Pipeline gates: forms at every decision point, a hook that enforces it

**Date:** 2026-09-01
**Status:** design approved in conversation (sections 1 to 8); section 9 added from the pack audit; spec under review
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

then act on it. `<scope>` is the gate's name (`plan`, `ship`, `mark-ready`,
`ci`, `provision`, `close`, `<stage>-failed`, `redirect`, `hold`). The
`gate` field write is the commitment the estate's existing HARD-GATEs already
use (print before act); it is also what lets the console name the pending
gate. The decision row is the record; a gate whose `gate` field is newer than
its last `gate@1` decision for that scope is pending.

Every gate form carries three standing options after its own question:
**Iterate here** (the human's `Other` text is the change request), **Go
back to `<stage>`**, and **Hold** (section 4).

Outside a run (`RT_RUN_DB` unset), the two `rt runs` lines are skipped and
the form alone is the gate. Section 6 makes that case rare.

The contract text goes into the parameterized-skills convention reference as
"Stage contract v3: gates", beside contract v2.

## 2. Wrap-up: one include, one compiled door

`attachments/wrap-up/SKILL.md` is the include. Its body is today's personal
wrap-up skill, kept as a positive recipe: one optional sentence of context,
then the runtime's structured-question tool, then stop; one question per
open item in three buckets (important details, decisions, next steps);
recommended option first and labelled; omit an empty bucket; when the tool
caps questions, fill the first call and wait. It is runtime-agnostic and
contains no `rt` command and no placeholder, so it is a legal include target
(`{{include:wrap-up}}`, alone on its own line). Its "common mistakes" list
becomes a rationalization table, because the baseline failure is a
discipline failure (the agent knows the form is wanted and writes prose
anyway), and that is the form that holds under pressure.

The public door is compiled from the same file: `wrap-up` joins
`pack/stubs.jsonc` as a zero-slot verb (the pattern the forge
`rebase-worktree` engine already uses: `type: pipeline-step`, `slots: {}`)
and `surface.jsonc` lists it. `rt skills compile --pack mattstack` emits
`skills/wrap-up/SKILL.md`; `rt skills check` catches drift. One source, no
hand copy.

The first implementation task is a spike: confirm the compiler accepts one
attachment as both an include target and a verb engine. If it does not, the
door is a hand-authored `plugin/skills/wrap-up/SKILL.md` and `tests/certify.sh`
gains a check that its body equals the include's body.

The personal `wrap-up` skill is deleted from its source repo and the
`~/.claude/skills/` symlink removed, in the same release.

## 3. Gate sites

Each engine that gains a gate inlines `{{include:wrap-up}}` once and writes
its gate sites as the section 1 recipe. The form content column is what the
engine supplies; a bound domain fill may add questions (companion spec).

| Engine | Scope | Where | Form content |
|---|---|---|---|
| work | `close` | before `run-status`; the run stays `running` until answered | the MR link; mark ready?; watch CI / done / iterate / go back / hold |
| work | `<stage>-failed` | replaces "report, stop" after a stage failure | resume / fix and retry / go back / abandon (`run-status abandoned`) |
| stage-plan | `plan` | after the triage print, before `decision record` | the tier (recommended first), the failing test on direct-tdd, the domain policy's questions |
| stage-ship, ship | `ship` | before the push | commit / stash / abort on a dirty tree; confirm the commits; draft or ready |
| ship | `mark-ready` | when the flow reaches it | mark ready now / hold |
| stage-watch-ci, watch-ci | `ci` | real failure, timeout, no pipeline | fix and re-push / retry the job / hand back / abandon |
| stage-provision | `provision` | branch already attached to a tree | resume in that tree / fresh tree |
| receive-review, review-posting, review, self-review | the existing Gates A, B, 1, 2 and the ambiguity ask | already form-shaped | rewritten to name the tool and follow the recipe (section 9) |

Stage boundaries with no gate in this table keep flowing; a form at every
boundary would add round trips to the stages that should run unattended.
Iteration always enters through a gate.

Each gated engine gains a rationalization row or two. The ones the baseline
produces: "I'll summarize and let them type", "the options are obvious, prose
is faster", "they asked me to be quick, so a compact list". The work engine's
red flags gain: "About to end the turn with the run still `running` and no
form on screen? Stop."

## 4. Iteration: redirect and hold

Pipelines loop in practice (an implement attempt 2 after ship, a second
self-review). The DB already tracks attempts; what is missing is the
decision that caused the loop.

**Redirect.** A new `## Redirect` section in the work engine, beside `##
Resume`. When a gate answer or a human message names an earlier stage:

```bash
rt runs decision record --contract gate@1 --scope redirect --selection '{"from":"<stage>","to":"<stage>","reason":"<their words>"}' --decided-by work
rt runs stage-start --stage <to>
```

then walk forward from `<to>`; later stages re-run as new attempts. The
reason is the human's words, never a category.

**Ready is the human's call.** The close gate offers *done* and *iterate*;
the run cannot reach `run-status done` until *done* is picked. A pipeline can
loop indefinitely and still never end in prose.

**Hold.** A gate answer of *hold* records the decision with scope `hold`,
writes `rt runs field set hold "<reason>" --stage <stage>`, and the agent
ends its turn. The Stop hook (section 5) allows a turn to end when the
`hold` field's `at` is newer than the latest stage row's `started_at`.
Resume (the existing section, plus the redirect rule) clears it with `field
set hold - --stage <stage>` right after the next `stage-start`. `snapshot`
returns fields ordered by `at`; if the fields table keeps one row per set
rather than one per key, the newest `hold` row is the one that counts (the
plan verifies which before the hook is written). Without hold, parking a
run overnight would fight the hook.

## 5. The Stop hook

`hooks/pipeline-gate-stop.sh`, shipped in this plugin's `hooks/hooks.json`
under `Stop` with a five-second timeout. It is the hard gate: a Stop hook
does not fire while an `AskUserQuestion` is awaiting the user, so at the hook
"presented a form" and "ended in prose" are distinguishable, and blocking
the second leaves the first as the only way to end a mid-run turn.

Logic, in order:

1. Read the hook's stdin JSON. `stop_hook_active` true: exit 0. One block
   per turn end; the eight-block cap is never reached.
2. Find this session's run. For each `${RT_RUNS_ROOT:-~/.mattstack/runs}/*/*/state.db`,
   `RT_RUN_DB=<db> "$HOME/.local/bin/rt" runs snapshot`; the run matches when
   `run.status` is `running` and the `claude-session` field equals the
   hook's `session_id`. The binary path is explicit because `rt` is a shell
   function in interactive shells only. No match, `rt` missing, non-JSON
   output, or three seconds spent: exit 0 silently.
3. A match whose newest `hold` field is newer than its latest stage row's
   `started_at` and is not `-`: exit 0.
4. Otherwise exit 2 with the reason on stderr, which Claude receives as the
   instruction to continue:

   > Run `<runId>` is mid-pipeline in stage `<stage>`. A turn cannot end here
   > in prose. Either continue the stage, or open the decision as a form:
   > `rt runs field set gate <scope> --stage <stage>`, one sentence, the
   > structured-question tool, stop. If the work is finished, run the close
   > gate, then `rt runs run-status`.

The hook writes nothing: the daemon's agent-status poller sees the pane flip
and the console updates. A run the hook cannot find is not this session's
problem; the daemon-side nudge (section 8) is the backstop for panes without
this plugin.

Tests are offline shell tests beside the doorbell hook's, with a stub `rt`
on `PATH` and stdin fixtures: no run, `stop_hook_active`, a matching running
run (exit 2 and the message), a done run, another session's run, a held run,
`rt` missing, `rt` printing usage instead of JSON.

## 6. Standalone verbs run as single-stage runs

`review`, `self-review`, `receive-review`, `ship`, `watch-ci`, and
`sync-open-mrs` are compiled verbs that today run with no run DB, so neither
the hook nor the console can see them. This is where the review wall-of-text
lives, including every review or respond a board pane launches. Each of
those six gains, at its start:

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start {{run-start.flags:<verb>}} --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage <verb>
```

(the same `PACK_DIRS` derivation and JSON gate as the work engine; a public
verb under `skills/<verb>/` and an internal one under `attachments/<verb>/`
are both two levels below the pack root) guarded by `RT_RUN_DB` being unset (a verb invoked inside a pipeline stage
inherits the pipeline's run and skips this). It closes with `stage-done` and
`run-status done` after its final gate. `{{run-start.flags:<verb>}}` is a
placeholder variant rt adds (section 8, item 1): the existing placeholder
renders one flag line per pipeline in the manifest; the variant renders one
line with `--work-type <verb> --pipeline <verb>` and the same provenance
flags, so the repo key stays derived in one place (the compiler) and the
console groups the verb's runs with the repo's pipelines. Until that
variant ships, the guard falls through to the section 1 "outside a run"
rule.

`rebase-worktree`, `checkout`, `checkout-and-open`, and `map-open-mrs` do
not start runs: the first is usually a per-branch step inside
`sync-open-mrs` and inherits its run, and the other three end in a fixed
report shape with no decision in it. Section 9 lists the gate sites this
adds, from the pack audit.

## 7. Team pack changes

The companion spec in the pack's repo covers: moving the pack's prose asks
into gate content (plan, provision, ship, mark-ready, evidence intake);
deleting the process the engines already own from the fills; moving
compiler mechanics out of a domain fill into the stage engine; the generic
fallback picking the forge CLI from the origin remote host instead of a
hardcoded name; the board fills reading their vendored parts instead of
shelling out to `claude plugin list`; and `disable-model-invocation: true`
on every bound fill. The pack recompiles against this release and bumps.

## 8. rt follow-ups (handed to rt by DM, not built here)

1. **`{{run-start.flags:<verb>}}`** placeholder variant (section 6). Needed
   for this release; about ten lines in `runStartFlags` plus a test, per
   rt's own estimate.
2. **Idle nudge.** The agent-status poller already sees a running run's
   agent flip to `idle`. After sixty seconds idle with no `hold` and no
   nudge yet in this stage, `rt pane send <herdr-pane field> --text
   "/wrap-up"` and `field set nudged <stage>@<ts>`. Backstop for panes
   without the hook.
3. **`rt runs find --session <id> --json`** read verb, so the hook stops
   scanning.
4. **Attention evidence.** When `blocked` and a gate is pending, evidence
   reads "waiting on you: `<scope>`"; a run with a fresh `hold` field is
   `held`, not `stale`.
5. **Timeline.** Render `redirect` and `gate@1` decisions inline in the
   stage timeline so a loop reads as a loop, with the reason.
6. **Cross-reference rewriting.** Compiled verbs carry the engines'
   `mattstack:<engine>` references verbatim (`mattstack:checkout`,
   `mattstack:watch-ci`, `mattstack:rebase-worktree`, `mattstack:map-open-mrs`
   in the audited pack), and those are not invocable names: the plugin
   registers two skills, the rest are attachments. When the pack compiles
   the referenced engine, the compiler should rewrite the reference to the
   pack's own verb name; when it does not, `rt skills check` should flag it.

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
| watch-ci | `ci` | replaces "finish by reporting the verdict" on red; on green the verdict is one line and the run closes | fix and re-push / retry the job / hand back / abandon |
| ship | `ship`, `mark-ready` | section 3 | section 3 |
| sync-open-mrs | `sweep`, `push` | the batch go-ahead and the batch force-push offer | rebase these branches in this order (multi-select, all pre-selected) / skip; push all rebased branches / pick / none, then watch CI or not |
| rebase-worktree | `push`, `conflict` | the closing push ask and the conflict hand-back | force-with-lease push now / leave unpushed; on conflict: resolve here with me / abort / leave the rebase in progress |
| shepherdr | `wrap-up` | the existing wrap-up section's three prose asks | close panes or keep for review; clean worktrees; clean job dirs, one form via the include (shepherdr keeps its own herd DB and starts no run, so this is the form-only case) |

`review`'s close HARD-GATE (the final message ends with the target's real
URL as a markdown link) stays; the link is the sentence before the form.

The board wrappers that launch `review` and `receive-review` live in their
own repo. They delegate the gates to these verbs, so they need no gate of
their own, and two of their paragraphs currently contradict the engine: one
numbers the posting gates in the opposite order (disposition before
severity) and both describe the posting gate as "present it" prose. The
companion note for that repo: drop the wrapper's own gate text and defer to
the domain verb's gates by name. The doctor wrapper is excluded on purpose;
its contract is "the human is not watching, never ask in the pane", and its
escalation string is its whole hand-back.

Verbs that end in a fixed report shape and carry no decision (`checkout`,
`checkout-and-open`, `map-open-mrs`, the pack's reference skills) get no
gate; a closing form with nothing to decide is the noise this spec removes.

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

1. rt: the placeholder variant (item 1) lands and releases.
2. This repo: `rt-runs-verbs` merges to `main` (rt's release makes that
   safe); this branch rebases onto it, merges, bumps.
3. Personal skills repo: delete the old wrap-up skill and the symlink.
4. The team pack: companion spec's changes, recompile, bump, update,
   restart.

## Out of scope

- A dedicated iterate stage engine.
- Forms at every stage boundary.
- Any console rendering change (rt and console own it; item 5).
- The board wrappers themselves; they delegate to the pack's verbs, which
  sections 6 and 9 cover. Their two contradicting paragraphs are a note to
  that repo (section 9).
