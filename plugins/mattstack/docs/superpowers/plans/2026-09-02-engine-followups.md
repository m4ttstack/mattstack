# Engine Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every engine text defect the compiled read-through of a team pack on mattstack 0.12.0 found is fixed in mattstack: evidence ownership reads true, every touched gate form carries the contract's standing options and records them, no engine sentence asks the human in prose, sibling verbs are named by their compiled path, compiler-facing text is clean, and the `RT_RUN_DB` persistence rule is written down.

**Architecture:** Markdown edits to engines under `attachments/` plus two paragraphs in the gate convention. Prose asks become the contract's form (one sentence, the structured-question tool, `clarify` scope under a run). Gate selections that lacked `next` gain the existing `next`/`to`/`note` pattern. No compiler change here; the rt items go to stan as a message.

**Tech Stack:** Markdown engines; `tests/certify.sh`, `tests/repo-purity.sh`; fixture subagents (`model: sonnet`) for the prose-to-form tasks; `rt skills compile --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"` for the release.

**Spec:** `docs/superpowers/specs/2026-09-02-engine-followups-design.md` (this plan argues from it; executors read both).

## Global Constraints

- Sequenced after plan 3 (`docs/superpowers/plans/2026-09-01-pipeline-gates-standalone-runs.md`) merges to `main`; this branch is rebased onto that `main` before Task 1. Every anchor below that names post-plan-3 text says so.
- Every touched directory passes `sh tests/certify.sh <dir>`; the tree passes `sh tests/repo-purity.sh`; no `Matt`, no `/Users/matt`, no em or en dashes.
- Every replacement is exact: the old text must be present verbatim (line numbers are locators; the quoted text is the authority); an implementer that cannot find it stops with NEEDS_CONTEXT.
- Form wording follows the convention: one sentence, then the structured-question tool; options are the ones the text names; Hold on every form; Iterate here and Go back only on stage and verb gates, never on `clarify` forms.
- Selection JSON pattern for touched gates: `next` (gate enum including `iterate` and `hold`, plus `redirect` with `to` where Go back is offered) and `note`. Untouched gates keep their selections (spec section 3 enumerates them).
- RED/GREEN fixtures (Tasks 5 to 8): a fresh `model: sonnet` subagent gets the engine text (old for RED, new for GREEN) plus the scenario and these harness lines verbatim: "Do not run any tools; reply only. Address the user generically as 'you'. Do not add options beyond what the gate text names. If a form is called for, write its one sentence of context and then the questions and options exactly as the tool would take them; do not narrate calling a tool. You have no AskUserQuestion tool in this environment; render the form as text." RED passes when the reply is prose; GREEN passes when the reply is one sentence and a form with the named options. Evidence is written only from the tool result, to `docs/superpowers/plans/evidence/red-followups-<task>.md` (`mkdir -p docs/superpowers/plans/evidence` first; the directory does not exist on this branch). The remedy for a GREEN failure is a rationalization row in the engine, never a prompt change.
- Commit after every task; push the branch.

---

### Task 1: Convention paragraphs

**Files:**
- Modify: `attachments/parameterized-skills/references/convention.md` (section "Stage contract v3: gates", after the paragraph beginning `A verb that inherited a run`)

**Interfaces:**
- Produces: the three rules every later task cites (selection pattern, `clarify` forms and Hold, fresh shell per call).

- [ ] **Step 1: Append three paragraphs**

After the paragraph ending `in the session's shell.` (the last paragraph of the section), append:

```markdown

Selections record the standing options with the pattern work's failure and
close gates use: `next` is the gate's own enum and always includes
`iterate` and `hold`, plus `redirect` with `to` wherever the form offers Go
back; `note` carries their free text or null. A gate's own answer keys
stand beside them.

A `clarify` form carries its candidates, optionally their text, and Hold;
it offers no Iterate here (the free-text candidate plays that role) and no
Go back, and its selection keeps its single key. Hold on any form: one
sentence, end the turn; under a run also record `hold:<stage>:<attempt>`
and `rt runs field set hold "<their words>" --stage <stage>`; outside a run
nothing is recorded.

Each tool call is a fresh shell. Keep `RT_RUN_DB` in the run's prose (the
`runDb` from `run-start`) and prefix every `rt runs` command with
`RT_RUN_DB=<path>`; `export` and `unset` remain the contract's markers for
the run's start and end, not a persistence mechanism.
```

- [ ] **Step 2: Certify, commit**

Run: `sh tests/certify.sh attachments/parameterized-skills` (exit 0); `sh tests/repo-purity.sh`.

```bash
git add attachments/parameterized-skills/references/convention.md
git commit -m "convention: selection pattern, clarify forms and Hold, fresh shell per call"
git push
```

---

### Task 2: stage-evidence ownership and gate wording (spec 1, 2)

**Files:**
- Modify: `attachments/pipeline/stage-evidence/SKILL.md`

- [ ] **Step 1: Four replacements**

Replace:
```
Before any capture, when the domain rules above declare intake questions,
```
with:
```
Before any capture, when the domain rules below declare intake questions,
```

Replace:
```
Before the MR is modified, when this stage is asked to attach (the ship
stage normally attaches; when the domain rules attach here, this gate
fires first):
```
with:
```
Before the MR is modified, when the domain rules attach here and an MR
already exists for the branch (the ship stage normally attaches):
```

Replace:
```
- The form: the proposed annotations as a multi-select, all pre-selected;
  **Attach to the MR now** (recommended) / **Hand back the markdown**;
  **Iterate here**; **Hold**.
```
with:
```
- The form: the proposed annotations as a multi-select, all pre-selected;
  **Hand back the markdown** (recommended; the ship stage attaches) /
  **Attach to the MR now**; **Iterate here**; **Hold**.
```

Replace:
```
the before). The ship stage attaches; it never captures.
```
with:
```
the before). This stage captures the BEFORE. The ship stage attaches the
pair, and where the bound ship domain captures an AFTER it does so there.
```

- [ ] **Step 2: Certify, commit**

Run: `sh tests/certify.sh attachments/pipeline/stage-evidence` (exit 0).

```bash
git add attachments/pipeline/stage-evidence/SKILL.md
git commit -m "stage-evidence: this stage captures the BEFORE; attach only when an MR exists; rules below"
git push
```

---

### Task 3: Standing options on the pipeline gates (spec 3: stage-ship, stage-plan, mark-ready x3)

**Files:**
- Modify: `attachments/pipeline/stage-ship/SKILL.md`, `attachments/pipeline/stage-plan/SKILL.md`, `attachments/pipeline/stage-watch-ci/SKILL.md`, `attachments/pipeline/ship/SKILL.md`, `attachments/pipeline/watch-ci/SKILL.md` (post-plan-3 text)

- [ ] **Step 1: stage-ship**

Replace `every question the domain rules above declare for this gate` with `every question the domain rules below declare for this gate`.

Replace:
```
- `rt runs decision record --contract gate@1 --scope ship --selection '{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>}}' --decided-by stage-ship`
```
with:
```
- `rt runs decision record --contract gate@1 --scope ship --selection '{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>},"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by stage-ship`
- Go back: hand control back to the orchestrator with one sentence naming
  the answer; it runs `## Redirect`.
```

- [ ] **Step 2: stage-plan**

Replace:
```
  bound domain policy declares for this gate, as it words them; then
  **Iterate here** and **Hold**.
- `rt runs decision record --contract gate@1 --scope plan --selection '{"tier":"<picked>","failing_test":"<as confirmed or null>","domain":{<the domain questions' answers>}}' --decided-by stage-plan`
```
with:
```
  bound domain policy declares for this gate, as it words them; then
  **Iterate here**, **Go back to `<stage>`** (one option per earlier stage
  row in `snapshot`), and **Hold**.
- `rt runs decision record --contract gate@1 --scope plan --selection '{"tier":"<picked>","failing_test":"<as confirmed or null>","domain":{<the domain questions' answers>},"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by stage-plan`
```
Then, in the bullet that begins `- Iterate: re-read the ticket with their note`, append after its last sentence: ` Go back: hand control back to the orchestrator with one sentence naming the answer; it runs \`## Redirect\`.` (plain backticks around `## Redirect`).

- [ ] **Step 3: mark-ready, three sites**

On the post-plan-3 tree the decision lines in ship and watch-ci end with a period after the closing backtick; the anchors below match as substrings and the period survives.

stage-watch-ci, replace:
```
- The form: **Mark ready now** (recommended when `evidence` is set and not
  `-`) / **Keep it draft**; **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false}' --decided-by stage-watch-ci`
```
with:
```
- The form: **Mark ready now** (recommended when `evidence` is set and not
  `-`) / **Keep it draft**; **Iterate here**; **Go back to `<stage>`** (one
  option per earlier stage row); **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by stage-watch-ci`
- Go back: hand control back to the orchestrator with one sentence naming
  the answer; it runs `## Redirect`.
```

Standalone ship engine (`attachments/pipeline/ship/SKILL.md`, post-plan-3 text has no `When RT_RUN_DB is set` prefix), replace:
```
- The form: **Mark ready now** (recommended when `ci` is green and evidence
  is set) / **Keep it draft**; **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false}' --decided-by ship`
```
with:
```
- The form: **Mark ready now** (recommended when `ci` is green and evidence
  is set) / **Keep it draft**; **Iterate here**; **Go back to `<stage>`**
  (one option per earlier stage row when `snapshot` shows any); **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by ship`
```

watch-ci's own-run mark-ready (added by plan 3 Task 6), replace:
```
- The form: **Mark ready now** (recommended) / **Keep it draft**;
  **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false}' --decided-by watch-ci`
```
with:
```
- The form: **Mark ready now** (recommended) / **Keep it draft**;
  **Iterate here**; **Go back to `<stage>`** (one option per earlier stage
  row when `snapshot` shows any); **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by watch-ci`
```

- [ ] **Step 4: Certify, commit**

Run certify on all five directories (exit 0 each); purity.

```bash
git add attachments/pipeline/stage-ship/SKILL.md attachments/pipeline/stage-plan/SKILL.md attachments/pipeline/stage-watch-ci/SKILL.md attachments/pipeline/ship/SKILL.md attachments/pipeline/watch-ci/SKILL.md
git commit -m "pipeline gates: Go back where earlier stages exist; selections record next, to, note"
git push
```

---

### Task 4: Standing options on the forge and review gates (spec 3: rebase-worktree, receive-review)

**Files:**
- Modify: `attachments/forge/rebase-worktree/SKILL.md` (plan 3 does not touch it; its gate lines keep their `When RT_RUN_DB is set:` prefixes, which the anchors below exclude), `attachments/review/receive-review/SKILL.md` (post-plan-3 text: no prefixes; `--stage <stage>`)

- [ ] **Step 1: rebase-worktree**

Replace:
```
- The form: **Leave the rebase in progress for me** (recommended) /
  **Abort the rebase** (`git rebase --abort`) ; **Hold**.
```
with:
```
- The form: **Leave the rebase in progress for me** (recommended) /
  **Abort the rebase** (`git rebase --abort`); **Iterate here**; **Hold**.
```
and in the conflict gate's decision line replace `'{"next":"leave|abort|hold"}'` with `'{"next":"leave|abort|iterate|hold","note":"<their words or null>"}'`.

Replace:
```
- The form: **Push with force-with-lease now** / **Leave it unpushed**
  (recommended when the branch has an open MR others may have pulled);
  **Hold**.
```
with:
```
- The form: **Push with force-with-lease now** / **Leave it unpushed**
  (recommended when the branch has an open MR others may have pulled);
  **Iterate here**; **Hold**.
```
and in the push gate's decision line replace `'{"push":true|false}'` with `'{"push":true|false,"next":"proceed|iterate|hold","note":"<their words or null>"}'`.

- [ ] **Step 2: receive-review verdicts**

Replace:
```
- The form: **Verdicts and replies approved** (recommended) / **Edit
  these** (their text names the threads and the change) / **Redo the
  adjudication**; **Hold**.
```
with:
```
- The form: **Verdicts and replies approved** (recommended) / **Iterate
  here** (their text names the threads and the change) / **Redo the
  adjudication**; **Hold**.
```
and in its decision line replace `'{"next":"approve|edit|redo|hold","note":"<their words or null>"}'` with `'{"next":"approve|iterate|redo|hold","note":"<their words or null>"}'`. Then `grep -n 'Edit these\|"edit"' attachments/review/receive-review/SKILL.md` must print nothing; if the Fixes gate or a later paragraph refers to the edit answer, reword it to the iterate answer in the same sentence shape.

- [ ] **Step 3: Certify, commit**

```bash
sh tests/certify.sh attachments/forge/rebase-worktree && sh tests/certify.sh attachments/review/receive-review && sh tests/repo-purity.sh
git add attachments/forge/rebase-worktree/SKILL.md attachments/review/receive-review/SKILL.md
git commit -m "rebase-worktree, receive-review: Iterate here on every gate form; selections record it"
git push
```

---

### Task 5: Prose asks become forms, forge verbs (spec 4: checkout, rebase-worktree dirty tree)

**Files:**
- Modify: `attachments/forge/checkout/SKILL.md`, `attachments/forge/rebase-worktree/SKILL.md`
- Create: `docs/superpowers/plans/evidence/red-followups-forge.md`

- [ ] **Step 1: RED**

Fixture A (checkout): the current text of section 1 of checkout (through `never guess.`) plus the scenario "The user said 'check out the auth branch'; `glab mr list --search auth` returns two MRs, !101 `auth-refresh` and !117 `auth-logout-fix`." Fixture B (rebase-worktree): its section 1 text plus "The worktree has two modified files, `src/a.ts` and `src/b.ts`, uncommitted." Harness lines from Global Constraints. Expected RED: prose asks ("which branch do you mean", "please commit or stash"). Record verbatim.

- [ ] **Step 2: Edit**

checkout, replace:
```
If resolution is ambiguous or turns up nothing, ask the user which branch
they mean -- never guess.
```
with:
```
If resolution is ambiguous or turns up nothing, gate `clarify`: one
sentence naming the candidates, then the structured-question tool with one
option per candidate, their text, and **Hold** (under a run, `rt runs field
set gate clarify --stage <run.current_stage>` before and `rt runs decision
record --contract gate@1 --scope clarify --selection '{"branch":"<picked>"}'
--decided-by checkout` after). Never a guess.
```

rebase-worktree, replace:
```
  Dirty: stop and tell the user what's uncommitted. Never `git stash` and
  proceed -- moving someone's uncommitted work is not this skill's call.
```
with:
```
  Dirty: one sentence listing the uncommitted paths, then the
  structured-question tool with **I committed them, retry** / **Abort**;
  **Hold** (under a run, scope `clarify`). Never `git stash` and proceed:
  moving someone's uncommitted work is not this skill's call.
```

- [ ] **Step 3: GREEN**

Same two fixtures with the new text. Expected: one sentence, then the form with exactly the named options. Record verbatim. A GREEN failure gets a rationalization row in the engine's red-flags or rationalization table (the pattern the fixture used), then rerun.

- [ ] **Step 4: Certify, commit**

```bash
sh tests/certify.sh attachments/forge/checkout && sh tests/certify.sh attachments/forge/rebase-worktree && sh tests/repo-purity.sh
git add attachments/forge/checkout/SKILL.md attachments/forge/rebase-worktree/SKILL.md docs/superpowers/plans/evidence/red-followups-forge.md
git commit -m "checkout, rebase-worktree: ambiguity and a dirty tree are forms, not prose asks"
git push
```

---

### Task 6: Prose asks become forms, work engine Resume (spec 4)

**Files:**
- Modify: `attachments/pipeline/work/SKILL.md` (`## Resume`)
- Create: `docs/superpowers/plans/evidence/red-followups-work.md`

- [ ] **Step 1: RED**

Fixture: the `## Resume` section text plus "RT_RUN_DB is unset; `~/.mattstack/runs/<repo>/` holds one run, `20260901-...`, status running, current_stage implement." Expected RED: prose confirmation ("Is this the run you mean?").

- [ ] **Step 2: Edit**

Replace:
```
`RT_RUN_DB` pointed at each candidate, never raw sqlite -- confirm the
match with the user, re-export `RT_RUN_DB`, and re-enter at
```
with:
```
`RT_RUN_DB` pointed at each candidate, never raw sqlite. One found: gate
`clarify`, one sentence naming it, the structured-question tool with
**Resume it** (recommended) / **Start fresh**; **Hold**. Resume: re-export
`RT_RUN_DB` (each tool call is a fresh shell, so prefix every `rt runs`
command with it) and re-enter at
```

- [ ] **Step 3: GREEN**

Same fixture, new text. Expected: one sentence and the three-option form.

- [ ] **Step 4: Certify, commit**

```bash
sh tests/certify.sh attachments/pipeline/work && sh tests/repo-purity.sh
git add attachments/pipeline/work/SKILL.md docs/superpowers/plans/evidence/red-followups-work.md
git commit -m "work: Resume is a clarify form"
git push
```

---

### Task 7: Prose asks become forms, shepherdr (spec 4)

**Files:**
- Modify: `attachments/orchestration/shepherdr/SKILL.md`
- Create: `docs/superpowers/plans/evidence/red-followups-shepherdr.md`

- [ ] **Step 1: RED**

Fixture: the paragraph containing `If the user redirects scope` plus "The user just said: 'Actually, drop the caching work and focus on the migration.' Two agents are running." Expected RED: a prose question about finishing or killing.

- [ ] **Step 2: Edit**

Replace:
```
If the user redirects scope: ask whether to let running agents finish or kill them. Before any kill,
```
with:
```
If the user redirects scope: one sentence naming the running agents, then the structured-question tool with **Let them finish** (recommended) / **Kill and respawn with the new briefs**; **Hold**. Before any kill,
```

- [ ] **Step 3: GREEN**, then **Step 4: Certify, commit**

```bash
sh tests/certify.sh attachments/orchestration/shepherdr && sh tests/repo-purity.sh
git add attachments/orchestration/shepherdr/SKILL.md docs/superpowers/plans/evidence/red-followups-shepherdr.md
git commit -m "shepherdr: scope redirect asks with a form"
git push
```

---

### Task 8: Approval wording and clarify gates, review family (spec 4)

**Files:**
- Modify: `attachments/review/receive-review/SKILL.md`, `attachments/review-core-body/SKILL.md`, `attachments/review/review/SKILL.md`, `attachments/review/self-review/SKILL.md` (post-plan-3 text)
- Create: `docs/superpowers/plans/evidence/red-followups-review.md`

- [ ] **Step 1: RED (self-review clarify only)**

Fixture: self-review's `- Requirements:` bullet plus "The branch is `fix-flaky-timeouts`, no ticket id; the task description in the conversation says 'stabilize the timeout tests'." Expected RED: the reply's form has no Hold option (the harness hides tool narration, so Hold present or absent is the observable discriminator).

- [ ] **Step 2: Edits**

receive-review, replace `posting each wait for their own explicit approval.` with `posting each wait for their gate's answer.`; replace the heading `## 5. Post replies, gated on verdict category (after explicit approval)` with the heading `## 5. Post replies, gated on verdict category (on the post gate's answer)` where `post` is wrapped in plain backticks; replace `Post only on explicit go-ahead; never resolve or approve for the developer.` with `Post only what the post gate selected; never resolve or approve for the developer.` where `post` is wrapped in plain backticks.

review-core-body, replace:
```
The tier is a recommendation: the developer can raise or lower it, against
```
with:
```
The tier is a recommendation: a different tier is an Iterate here answer at
the next gate, against
```
(read the rest of that sentence and keep it grammatical; if "against" no longer fits, end the sentence at "gate." and start the next clause as its own sentence.)

review clarify (post-plan-3 text), replace:
```
with one option per candidate (`rt runs field set gate clarify --stage
<stage>` before and `rt runs decision record --contract gate@1 --scope
clarify --selection '{"target":"<picked>"}' --decided-by review` after).
Never a guess.
```
with:
```
with one option per candidate and **Hold** (`rt runs field set gate clarify
--stage <stage>` before and `rt runs decision record --contract gate@1
--scope clarify --selection '{"target":"<picked>"}' --decided-by review`
after). Never a guess.
```

self-review clarify (post-plan-3 text), replace:
```
  carries no ticket, gate `clarify`: one sentence, then the structured-question
  tool with the candidate sources (the task as stated, a linked doc, their
```
with:
```
  carries no ticket, gate `clarify` (`rt runs field set gate clarify --stage
  <stage>` before, `rt runs decision record --contract gate@1 --scope clarify
  --selection '{"source":"<picked>"}' --decided-by self-review` after): one
  sentence, then the structured-question tool with the candidate sources
  (the task as stated, a linked doc, their
```
and confirm the bullet's next line still ends the option list; append `, and **Hold**` before its closing `)` if the list has no Hold.

- [ ] **Step 3: GREEN (self-review), certify, commit**

```bash
for d in attachments/review/receive-review attachments/review-core-body attachments/review/review attachments/review/self-review; do sh tests/certify.sh "$d" || exit 1; done; sh tests/repo-purity.sh
git add attachments/review/receive-review/SKILL.md attachments/review-core-body/SKILL.md attachments/review/review/SKILL.md attachments/review/self-review/SKILL.md docs/superpowers/plans/evidence/red-followups-review.md
git commit -m "review family: gates' answers replace approval prose; clarify forms carry Hold and their rt lines"
git push
```

---

### Task 9: Sibling verbs by compiled path (spec 5)

**Files:**
- Modify: `attachments/forge/checkout-and-open/SKILL.md`, `attachments/forge/sync-open-mrs/SKILL.md` (post-plan-3 text)

- [ ] **Step 1: Replacements**

checkout-and-open: replace `Follow \`mattstack:checkout\` end to end` with `Follow the pack's compiled \`checkout\` verb (\`../checkout/SKILL.md\`, relative to this file, when the pack compiles both on the same side; a different surface changes the path) end to end`.

sync-open-mrs: replace `Follow \`mattstack:map-open-mrs\` and get its table` with `Follow the pack's compiled \`map-open-mrs\` verb (\`../map-open-mrs/SKILL.md\`, relative to this file, when the pack compiles both on the same side) and get its table`; replace `follow \`mattstack:rebase-worktree\` per branch` with `follow the pack's compiled \`rebase-worktree\` verb (a public verb; invoke it by its pack-qualified skill name) per branch`; replace `follow \`mattstack:watch-ci\`` with `follow the pack's compiled \`watch-ci\` verb (a public verb; invoke it by its pack-qualified skill name)`.

- [ ] **Step 2: Certify, commit**

`grep -rn 'mattstack:checkout\|mattstack:map-open-mrs\|mattstack:rebase-worktree\|mattstack:watch-ci' attachments/forge` prints nothing.

```bash
sh tests/certify.sh attachments/forge/checkout-and-open && sh tests/certify.sh attachments/forge/sync-open-mrs && sh tests/repo-purity.sh
git add attachments/forge/checkout-and-open/SKILL.md attachments/forge/sync-open-mrs/SKILL.md
git commit -m "forge verbs: name sibling verbs by their compiled path"
git push
```

---

### Task 10: Compiler-facing text (spec 6)

**Files:**
- Modify: `attachments/review-posting/SKILL.md`, `attachments/pipeline/stage-watch-ci/SKILL.md`, `attachments/pipeline/watch-ci/SKILL.md` (post-plan-3 text)

- [ ] **Step 1: review-posting Callers bullet**

Replace (in the body, the **Callers:** bullet under `## Caller inputs`; the frontmatter is untouched):
```
  engine draft and a postable target. Nothing in this repo binds it;
  callers reach it by reading this file.
```
with:
```
  engine draft and a postable target.
```
(the bullet keeps its shape; certify still checks the frontmatter.)

- [ ] **Step 2: stage-watch-ci scripts section moves above the slot**

Cut this whole section (heading through its paragraph):
```
## Where the scripts live

The engine's watcher, triage, and attendant scripts are vendored inside
this compiled skill's own directory (`scripts/`), and the forge adapter at
`{{stage.dir}}/parts/forge/scripts/ci-forge.sh`. Nothing is derived from a
plugin install; the paths are the ones written into this text.
```
and paste it, with this text instead, directly above `## Domain rules`:
```
## Where the scripts live

The engine's watcher, triage, and attendant scripts are vendored inside
this compiled skill's own directory, and the forge adapter beside them. In
the commands below, `<scripts>` is `{{stage.dir}}/scripts` and `<forge>` is
`{{stage.dir}}/parts/forge/scripts/ci-forge.sh`. Nothing is derived from a
plugin install; the paths are the ones written into this text.
```

- [ ] **Step 3: standalone watch-ci gains the same section**

Directly above `## Domain rules` in `attachments/pipeline/watch-ci/SKILL.md`, insert:
```
## Where the scripts live

The engine's watcher, triage, and attendant scripts are vendored inside
this compiled skill's own directory, and the forge adapter beside them. In
the commands below, `<scripts>` is `${CLAUDE_SKILL_DIR}/scripts` and
`<forge>` is `${CLAUDE_SKILL_DIR}/parts/forge/scripts/ci-forge.sh`. Nothing
is derived from a plugin install; the paths are the ones written into this
text.

```

- [ ] **Step 4: Certify, compile check, commit**

```bash
for d in attachments/review-posting attachments/pipeline/stage-watch-ci attachments/pipeline/watch-ci; do sh tests/certify.sh "$d" || exit 1; done; sh tests/repo-purity.sh
git add attachments/review-posting/SKILL.md attachments/pipeline/stage-watch-ci/SKILL.md attachments/pipeline/watch-ci/SKILL.md
git commit -m "watch-ci engines own the scripts section; review-posting drops repo prose"
git push
```

---

### Task 11: Redirect note and the fresh-shell sentences (spec 7, 8)

**Files:**
- Modify: `attachments/pipeline/work/SKILL.md`; the six standalone verbs' Run sections (post-plan-3): `attachments/review/review/SKILL.md`, `attachments/review/self-review/SKILL.md`, `attachments/review/receive-review/SKILL.md`, `attachments/pipeline/ship/SKILL.md`, `attachments/pipeline/watch-ci/SKILL.md`, `attachments/forge/sync-open-mrs/SKILL.md`

- [ ] **Step 1: work Redirect**

After the Redirect recipe's step 3 (the paragraph ending `pushes new commits to the same MR.`), append:
```

The stage you leave keeps its `running` row; `snapshot` readers treat a
`running` row followed by a later attempt of an earlier stage as redirected.
```

- [ ] **Step 2: work export line**

Replace `export RT_RUN_DB=<runDb from the response>` (in `## 3. Start the run`) with:
```
export RT_RUN_DB=<runDb from the response>   # each tool call is a fresh shell: prefix every rt runs command with RT_RUN_DB=<runDb>
```

- [ ] **Step 3: the six Run sections**

In each of the six files, replace `export RT_RUN_DB=<runDb from the response>` with the same annotated line, and replace `tool with **Resume it** (recommended) / **Start fresh**. Resume: \`export` with `tool with **Resume it** (recommended) / **Start fresh**; **Hold**. Resume: \`export`.

- [ ] **Step 4: Certify, commit**

```bash
for d in attachments/pipeline/work attachments/review/review attachments/review/self-review attachments/review/receive-review attachments/pipeline/ship attachments/pipeline/watch-ci attachments/forge/sync-open-mrs; do sh tests/certify.sh "$d" || exit 1; done; sh tests/repo-purity.sh
grep -c 'fresh shell' attachments/pipeline/work/SKILL.md attachments/review/review/SKILL.md attachments/review/self-review/SKILL.md attachments/review/receive-review/SKILL.md attachments/pipeline/ship/SKILL.md attachments/pipeline/watch-ci/SKILL.md attachments/forge/sync-open-mrs/SKILL.md
git add -A attachments
git commit -m "run sections: fresh shell per call; Resume offers Hold; redirected rows explained"
git push
```
Expected: work counts 2 (Task 6's Resume sentence plus this comment); each of the six verbs counts 1.

---

### Task 12: rt follow-ups to stan

- [ ] **Step 1: Send the list**

```bash
rt chat dm stan <<'MSG'
Six rt follow-ups from the mattstack engine spec (docs/superpowers/specs/2026-09-02-engine-followups-design.md, section "rt follow-ups"):

- E6: the ${CLAUDE_SKILL_DIR} rewrite for included bodies should apply to every otherSideDir output (receive-review, self-review), not only stages.
- E7: a {{verb.path:<name>}} placeholder rendering the sibling verb's relative path from the output file, using the surface.
- E8: drop a heading that directly precedes a slot that renders empty.
- R1: a redirected status for a stage row (rt runs stage-redirect --stage <from> --to <to>, or stage-done --status redirected).
- R2: rt runs verbs default RT_RUN_DB from the running run whose claude-session matches the caller, else the newest running run whose worktree contains the cwd.
- Pack-path token: fills need to name a file in another attachment without the vendoring rewrite (today they use unbraced $CLAUDE_SKILL_DIR/../../attachments/<name>/<file>).
None blocks a release; the engine text carries interim wording for each.
MSG
```

---

### Task 13: Release

- [ ] **Step 1: Verify**

```bash
for d in $(git diff --name-only main -- attachments | xargs -n1 dirname | sort -u); do sh tests/certify.sh "$d" || exit 1; done
sh tests/repo-purity.sh
grep -rn 'explicit approval\|ask the user\|tell the user what\|confirm the match\|ask whether' attachments --include=SKILL.md
grep -rn 'tell the user to' attachments --include=SKILL.md | wc -l
```
Expected: every certify 0, purity ok. The first grep prints exactly three residue lines, all outside spec section 4: cswap-accounts "without explicit approval" (an account rule, not a gate) and shepherdr's two lines about the herd question channel ("or ask the user", "To ask the user a question"), which describe the worker's question command, not a prose ask. The second grep counts 7: work's `## 3. Start the run` plus the six standalone Run sections plan 3 copied it into (the Run sections wrap the sentence after "tell the user to", so the pattern stops there); spec section 4 keeps that sentence (no run exists yet when it fires). The status lines "tell the user it's provisioning" (stage-provision, shepherdr) and shepherdr's single-job push-back are not matched by these patterns and are not asks.

- [ ] **Step 2: Bump, compile, merge, install**

Bump the patch version in `.claude-plugin/plugin.json` (the version after plan 3's minor bump); `rt skills compile --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"` and `rt skills check --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"` (all current); commit `mattstack: bump for the engine follow-ups`; push; fast-forward `main` (operator go: the install is a publish to every machine that updates); `claude plugin update mattstack@mattstack`; restart.

- [ ] **Step 3: Team pack follow-on (its own release)**

In the team pack: recompile against the new mattstack, drop the watch-ci domain fill's `## Where the scripts live` section (the engine owns it now), bump, `check` all current, and re-read the compiled files this plan touched (the read-through checklist from the pack's 2026-09-02 plan, Task 12) before publishing.
