# Engine follow-ups from the compiled read-through (mattstack 0.13.1)

**Status:** draft for review. **Source:** the compiled read-through of a team pack built on mattstack 0.12.0 (three passes, 2026-09-02) and one live pipeline run. Every item below was found in engine text or compiler output, not in the pack's fills. The gate contract is `attachments/parameterized-skills/references/convention.md`, "Stage contract v3: gates".

**Sequencing:** implemented after plan 3 (standalone verbs as runs) merges, on a branch rebased onto that main, because five engines overlap (ship, watch-ci, receive-review, self-review, sync-open-mrs). Released as a patch after plan 3's minor bump. The team pack recompiles once, in its own release, and re-reads the affected compiled files.

## 1. Evidence ownership (stage-evidence, E1 and E3)

Facts: the pipeline runs provision, plan, gates, evidence, implement, self-review, ship, watch-ci. stage-evidence captures the BEFORE. No engine stage captures the AFTER; a bound ship domain does, at ship. stage-evidence currently says "The ship stage attaches; it never captures", and its `evidence-attach` gate recommends "Attach to the MR now" at a stage where no MR exists.

Changes:
- Replace "The ship stage attaches; it never captures." with: "This stage captures the BEFORE. The ship stage attaches the pair, and where the bound ship domain captures an AFTER it does so there."
- `## Gate evidence-attach`: the condition becomes "when the domain rules attach here and an MR already exists for the branch"; the form's options become **Hand back the markdown** (recommended; the ship stage attaches) / **Attach to the MR now**; Iterate here; Hold. The selection stays `{"annotations":[...],"attach":"now|handback"}`.

## 2. Gate wording that assumes layout (E2)

`## Gate evidence` says "when the domain rules above declare intake questions"; the domain slot is below it in source and in compiled output. Change "above" to "below". Same check on every gate that names "the domain rules above": stage-ship's `ship` gate does (its slot is also below); change to "below" there too.

## 3. Standing options on every gate form (E4)

The contract names Iterate here and Hold on every stage or verb gate form, and Go back to `<stage>` when `snapshot` shows an earlier stage row. Some forms omit them and their selection JSON cannot record them.

The recording pattern already in use (work's failure and close gates, stage-watch-ci's `ci` gate) is the rule for every form this spec touches: the selection JSON carries `next`, a gate-specific enum that always includes `iterate` and `hold`, plus `redirect` with `to` wherever Go back is offered, and `note` (their free text, or null). Gates that have `next` keep their enum and add the missing values; four forms listed under Changes (ship, plan, mark-ready, push) gain it beside their own keys, and two (conflict, verdicts) extend the enum they have. `clarify` selections keep their single key (`target`, `source`): Hold is recorded by the hold decision, and clarify offers no Iterate here or Go back. Every other gate (`provision`, `evidence`, `evidence-attach`, sync-open-mrs `sweep` and `push`, receive-review `fixes` and `post`, review's `post-severity` and `post-disposition`, self-review's `self-review`, shepherdr's `wrap-up`, the standalone ship engine's `ship`) keeps its current selection in this release; their forms already carry the standing options, and the envelope reaches them in a later pass. Convention section "Stage contract v3" gains one paragraph stating the pattern, and one more on `clarify`: a `clarify` form carries its candidates, optionally their text, and Hold; it does not offer Iterate here (the free-text candidate plays that role) or Go back. Hold on any form: one sentence, end the turn; under a run also record `hold:<stage>:<attempt>` and `rt runs field set hold "<their words>" --stage <stage>`; outside a run nothing is recorded.

On a Go back answer at a stage gate the stage hands control back to the orchestrator with one sentence naming the answer, and the orchestrator runs `## Redirect`, exactly as the `ci` gate's Fix answer does today; no stage runs Redirect itself.

Changes:
- stage-ship `ship` gate: its form already offers **Go back to `<stage>`** with nowhere to record it; selection becomes `{"dirty":..., "open_as":..., "domain":{...}, "next":"proceed|iterate|redirect|hold", "to":"<stage or null>", "note":"<their words or null>"}` (Abort stays recorded under `dirty`).
- stage-plan `plan` gate: add **Go back to `<stage>`** (one option per earlier stage row); selection becomes `{"tier":..., "failing_test":..., "domain":{...}, "next":"proceed|iterate|redirect|hold", "to":"<stage or null>", "note":"<their words or null>"}`.
- every `mark-ready` gate (stage-watch-ci, the standalone ship engine, and watch-ci's own-run gate from plan 3): add **Go back to `<stage>`** where earlier stage rows exist; selection becomes `{"ready":true|false, "next":"proceed|iterate|redirect|hold", "to":..., "note":...}`.
- rebase-worktree `conflict` form: add **Iterate here**; enum `leave|abort|iterate|hold`, plus `note`. `push` form: add **Iterate here**; selection becomes `{"push":true|false, "next":"proceed|iterate|hold", "note":...}`.
- receive-review `verdicts` form: **Edit these** becomes the standing **Iterate here** (their text names the threads and the change); enum `approve|iterate|redo|hold`, plus `note`.

## 4. Prose asks in engine text (E5)

Each becomes the contract's form. Outside a run the form alone is the gate; inside a run the scope is `clarify` unless a named gate exists.
- forge/checkout: "ask the user which branch they mean" becomes gate `clarify`: one sentence naming the candidates, then the structured-question tool with the candidates, their text, and Hold.
- pipeline/work Resume: "confirm the match with the user" becomes the Resume form plan 3 defines for standalone verbs: gate `clarify`, **Resume it** (recommended) / **Start fresh**; Hold. The work engine's sections are `## 3. Start the run` and `## Resume`; the change lands in `## Resume`.
- pipeline/work "stop, and tell the user to update rt": stays prose. No run exists yet, so no gate applies; it is an error report, not a decision.
- forge/rebase-worktree "Dirty: stop and tell the user what's uncommitted": becomes a form: one sentence listing the paths, then **I committed them, retry** / **Abort**; Hold. Under a run, scope `clarify`. The rule "never `git stash` and proceed" stays.
- orchestration/shepherdr "ask whether to let running agents finish or kill them": becomes one sentence plus the structured-question tool: **Let them finish** (recommended) / **Kill and respawn with the new briefs**; Hold.
- review/receive-review: "wait for their own explicit approval" becomes "each waits for its gate's answer"; the section 5 heading "(after explicit approval)" becomes "(on the `post` gate's answer)"; the table row "Post only on explicit go-ahead" becomes "Post only what the `post` gate selected".
- review-core-body "the developer can raise or lower it": becomes "a different tier is an Iterate here answer at the next gate".
- review's `clarify` gate (target ambiguity) and self-review's `clarify` gate (no ticket) add **Hold** to their forms, matching the convention paragraph.
- review/self-review `clarify` gate: add the two `rt runs` lines review's clarify gate has (`rt runs field set gate clarify --stage <stage>` before the form; `rt runs decision record --contract gate@1 --scope clarify --selection '{"source":"<picked>"}' --decided-by self-review` after), with `<stage>` in the form the file uses after plan 3 (its Run section defines it).

## 5. Sibling verbs named as `mattstack:` skills (E7)

forge/checkout-and-open names `mattstack:checkout`; forge/sync-open-mrs names `mattstack:map-open-mrs`, `mattstack:rebase-worktree`, `mattstack:watch-ci`. None is a registered skill; in a compiled pack they are sibling compiled verbs whose path depends on the pack's surface (internal: `../<name>/SKILL.md`; public: `../../skills/<name>/SKILL.md`).

Changes, engine side, until the compiler can render the path: internal siblings become "the pack's compiled `checkout` verb (`../checkout/SKILL.md`, relative to this file)" and "the pack's compiled `map-open-mrs` verb (`../map-open-mrs/SKILL.md`)"; public verbs become "the pack's compiled `rebase-worktree` verb (invoke it by its pack-qualified skill name)" and the same for `watch-ci`. The engine sentence states its assumption in a parenthetical: "(when the pack compiles both on the same side; a different surface changes the path)". rt follow-up: a `{{verb.path:<name>}}` placeholder that renders the relative path from the current output file using the surface (layout.ts already computes the side).

## 6. Compiler-facing text (E9, E10)

- review-posting's **Callers:** bullet (under `## Caller inputs`) drops "Nothing in this repo binds it; callers reach it by reading this file." (source-repo prose that surfaces in compiled text).
- `## Where the scripts live` becomes the single owner of the `<scripts>` and `<forge>` definitions, placed directly above `## Domain rules` in both engines that bind the watch-ci domain fill: stage-watch-ci (move its existing section up from below the slot) and the standalone watch-ci engine (add the section; today it has none and the fill is the only definition). The section names the vendored `scripts/` directory and `parts/forge/scripts/ci-forge.sh` and defines both placeholders for the commands that follow. Pack side (team pack release, after this lands): the watch-ci domain fill drops its own copy of that section.

## 7. Redirect leaves the abandoned stage row running (R1)

The work engine's Redirect recipe writes no status for the stage it leaves; `rt runs` has no verb for it (`stage-fail` fails the latest attempt; `abandon` marks the run). rt follow-up: `rt runs stage-redirect --stage <from> --to <to>` (or `stage-done --status redirected`) setting the row to `redirected`. Engine change once it exists: Redirect step 1a calls it before clearing produces. Until then the recipe gains one sentence: "The stage you leave keeps its `running` row; `snapshot` readers treat a `running` row with a later attempt of an earlier stage as redirected."

## 8. `export RT_RUN_DB` does not persist across tool calls (R2)

Claude Code's Bash tool runs each call in a fresh shell; the live run prefixed every `rt runs` verb with the export. The Stop hook is unaffected (it finds the run by session id, then by mtime).

Changes:
- convention.md "Stage contract v3": one paragraph: "Each tool call is a fresh shell. Keep `RT_RUN_DB` in the run's prose (the `runDb` from `run-start`) and prefix every `rt runs` command with `RT_RUN_DB=<path>`; `export` and `unset` remain the contract's markers for the run's start and end, not a persistence mechanism."
- pipeline/work `## 3. Start the run` (its `export RT_RUN_DB` line) and `## Resume` (its "re-export `RT_RUN_DB`"), and plan 3's shared Run section in the six standalone verbs: each `export` line gains the same sentence in one line. The six verbs' Resume offer already carries **Hold** (plan 3's final review folded it in).
- rt follow-up (design, stan): `rt runs` verbs default `RT_RUN_DB` from the running run whose `claude-session` matches the calling session when the harness exposes it, else from the newest running run whose `worktree` field contains the cwd.

## 9. Left as is, with reasons

- E8 empty `## Reviewer` and `## Domain rules` headings above unbound slots: the paragraph after each explains the emptiness. rt follow-up: the compiler drops a heading whose slot renders empty.
- E11 stage-watch-ci's frontmatter `allowed-tools` name `${CLAUDE_SKILL_DIR}/scripts/...`, which does not exist in the pipeline host: harmless, the orchestrator's frontmatter carries the leading-wildcard forms and a stage's frontmatter is not loaded when the orchestrator reads the file. Left as is.
- E12 stage-ship's unbound generic fallback ("Never force-push"): scoped to the unbound path; a bound domain's rules replace it.
- E6 (compiler): `${CLAUDE_SKILL_DIR}` in an included body is rewritten to the vendored parts dir for stage-compiled outputs but not for attachment-compiled verbs (receive-review, self-review), so `parts/include-review-dispatch-body-after/references/adjudicator.md` is unreachable when a board wrapper loads the file. Reported to stan 2026-09-02; no engine change.

## rt follow-ups (for stan)

1. E6: same `${CLAUDE_SKILL_DIR}` rewrite for every otherSideDir output.
2. E7: `{{verb.path:<name>}}` placeholder.
3. E8: drop a heading that directly precedes an empty slot.
4. R1: a redirected status for a stage row.
5. R2: session-scoped or cwd-scoped default for `RT_RUN_DB`.
6. From the pack's 0.5.17 fix: a pack-path token for fills that must name a file in another attachment (the fills use the unbraced `$CLAUDE_SKILL_DIR/../../attachments/<name>/<file>` to escape the vendoring rewrite).
7. From plan 3's review: a verb invoked once per branch inside one attempt (sync-open-mrs calling watch-ci) upserts one `ci:<stage>:<attempt>` decision per attempt, so only the last branch's answer survives; a per-branch discriminator or a decisions sequence.

## Testing

- `sh tests/certify.sh <dir>` for every touched engine; `sh tests/repo-purity.sh`.
- For section 4 items (prose asks to forms): one fixture per item, RED on the old text and GREEN on the new, with the harness lines plan 2 used; the remedy for a GREEN failure is an engine row, never a prompt change.
- Compiled read-through of the affected files after the team pack recompiles (the check that found these).

## Release

mattstack patch after plan 3's minor bump (0.13.0 then 0.13.1). Team pack: recompile, drop the duplicate watch-ci section, read-through, release.
