# Skill certification

The written purity rule and per-skill certification checklist for this repo
(spec: the thinning milestone / certification sweep). The machine gate is
`tests/certify.sh <skill-dir>`; this file is the human half plus the ledger.

## Purity rule

1. Nothing domain-specific to any one team ships in this repo. Domain
   conventions, examples, and routing live in domain-owned packs that BIND
   to the seams here (slots, pipelines, manifests).
2. Nothing personal to one operator ships in prose or scripts: no personal
   names, home paths, or account hints. The bar is the README's: what
   someone else could actually pick up.
3. House style: no em or en dashes; trigger-only descriptions
   ("Use when...", <= 500 chars) per superpowers:writing-skills.

## Certification checklist (per skill)

- [ ] `tests/certify.sh <skill-dir>` exits 0 (purity greps, frontmatter
      grammar, depth cap, vendored-resolver identity, stage declaration).
- [ ] desc-test selection micro-test: all scenarios in
      `tests/desc-test-scenarios.json` pass before AND after any
      description edit (`bun run tests/desc-test.ts`).
- [ ] Parameterized wrappers only: the model-free matrix
      (`plugin/tests/test-resolve-args.sh`) is green, including the `cmp`
      identity case for this wrapper's vendored resolver.
- [ ] Skill-local script tests (if the skill ships any) are green.
- [ ] Prose reviewed against superpowers:writing-skills (authority on
      authorship; certification does not restate it).

## Ledger

| date | skill | classification | certify | desc-test | notes |
|------|-------|----------------|---------|-----------|-------|
| 2026-08-09 | mattstack:shepherdr | needs-extraction | pass | 4/4 scenarios | de-personalized 8 literal "Matt" hits to "the user"/"the operator" (SKILL.md:139, scripts/spawn-agent.sh:163, references/job-template.md:25,33,46,60, references/cloud-lane.md:94,99,107); normalized 3 em dashes in cloud-lane.md:32,79,104 (2 beyond the plan's called-out line, found on re-grep) |
| 2026-08-10 | mattstack:model-tiering | pure | pass | 4/4 | no changes |
| 2026-08-10 | mattstack:getting-current-time | pure | pass | 4/4 | no changes |
| 2026-08-10 | parameterized-skills | pure | pass | 4/4 | RED found purity-personal (personal path in convention.md:175 example JSON, missed by D1 first pass); fixed to a generic placeholder path |
| 2026-08-10 | mattstack:work | pure | pass | 5/5 (work scenario added in T10) | certified during T10; ledger row recorded in T21; re-run of certify.sh exit 0 at ledger time |
| 2026-08-10 | mattstack:stage-provision | pure | pass | n/a (hidden, excluded from roster) | certified during T11; re-run exit 0 at ledger time |
| 2026-08-10 | mattstack:stage-plan | pure | pass | n/a (hidden) | certified during T11; re-run exit 0 at ledger time |
| 2026-08-10 | mattstack:stage-gates | pure | pass | n/a (hidden) | certified during T12; re-run exit 0 at ledger time |
| 2026-08-10 | mattstack:stage-evidence | pure | pass | n/a (hidden) | certified during T12; re-run exit 0 at ledger time |
| 2026-08-10 | mattstack:stage-implement | pure | pass | n/a (hidden) | certified during T13; slotless (no vendored resolver); re-run exit 0 at ledger time |
| 2026-08-10 | mattstack:stage-self-review | pure | pass | n/a (hidden) | certified during T13; re-run exit 0 at ledger time |
| 2026-08-10 | mattstack:stage-ship | pure | pass | n/a (hidden) | certified during T14; re-run exit 0 at ledger time |
| 2026-08-10 | mattstack:stage-watch-ci | pure | pass | n/a (hidden) | certified during T14; re-run exit 0 at ledger time |

| 2026-08-18 | mattstack:review-core | pure | pass | 5/5 | harvest integration (2026-08-12) certified; ledger row + desc-test scenario added at SKILLS-36 closeout; certify re-run exit 0 |
| 2026-08-18 | mattstack:review-dispatch | pure | pass | no scenario (deliberate) | selection niche is shadowed by its callers (self-review / review-core absorb every task phrasing, verified 3 wordings x 3-5 reps); reached via REQUIRED SUB-SKILL, so no scenario encodes that reality; certify re-run exit 0 |
| 2026-08-18 | mattstack:self-review | pure | pass | 5/5 | harvest integration certified; scenario added at closeout; certify re-run exit 0 |
| 2026-08-18 | mattstack:receive-review | pure | pass | 5/5 | harvest integration certified; scenario added at closeout; certify re-run exit 0 |
| 2026-08-18 | mattstack:review-posting | pure | pass | 5/5 | harvest integration certified; scenario added at closeout; F4 note: Gate 1/2 HARD-GATE tags to be restored on the next writing-skills-gated edit |
| 2026-08-18 | mattstack:ci-forge-gitlab | pure | pass | n/a (hidden, slot-reached) | harvest integration certified incl. F3 fix (jobs --scope native-status filter); certify re-run exit 0 |
| 2026-08-18 | mattstack:stage-watch-ci | pure | pass | n/a (hidden) | rewritten by the ci-engine harvest (forge split) incl. F1 fix (ref forwarded to all three triage call sites); certify re-run exit 0 |

| 2026-09-04 | mattstack:gate-protocol | pure | pass | n/a (hidden, include-reached) | new shared pane-protocol part (gate facility, engine 0.14.0); certify 10/10 at authoring and at review |
| 2026-09-04 | mattstack:review-posting | pure | pass | 5/5 (scenarios unchanged) | execution-only rewrite: caller-decided {levels, disposition}, never asks; the 2026-08-18 F4 note (restore Gate 1/2 tags) closes as moot, the two-gate protocol is retired; certify 10/10 |
| 2026-09-04 | mattstack:review | pure | pass | 5/5 (scenarios unchanged) | Deliver step reworked to caller-owned decisions with the one combined fallback question; decision record moves to scope post with --decided-by surface names; certify 10/10 |

| 2026-09-04 | mattstack:gate-protocol | pure | pass | n/a (hidden, include-reached) | Runs integration recipe added (facility publish, attendance rule, bounded wait, decided-by surfaces); certify 10/10 at authoring and review |
| 2026-09-04 | mattstack:receive-review | pure | pass | 5/5 (scenarios unchanged) | caller-owned two-gate protocol (respond-plan, respond-post); verdicts/fixes retired; adjudication and execution halves unchanged; certify 9/9 |
| 2026-09-04 | mattstack:shepherdr | pure | pass | 5/5 (scenarios unchanged) | run-backed herd questions ride the gate registry (one subscription, worktree-key list-and-match, answers --by shepherd); herd scripts untouched; all 3 script suites green |
| 2026-09-04 | (12 verb dirs: stage-plan, stage-provision, stage-evidence, stage-ship, stage-watch-ci, ship, watch-ci, work, self-review, sync-open-mrs, rebase-worktree, checkout) | pure | pass | n/a (site adoption) | v4 gate-site adoption: publish per gate-protocol Runs integration, questions verbatim, decided-by from the answer; certify 9-10/10 each at task review and release |
| 2026-09-05 | mattstack:gate-protocol | pure | pass | n/a (hidden, include-reached) | W4 T16: origin/context stamping, presentation-keyed nudge (form vs wait, form-first on herdr panes), idle background wait with the waiting-gate marker set/clear, doorbell priming for form-first pipeline panes; bounded 90s poll loop retired; certify 10/10 |
| 2026-09-05 | checkout | pure | pass | n/a (site adoption) | W4 T18: spawned no-run context guard -- a spawned pane with no armed run errors out visibly instead of presenting an unwatched form (gate clarify); certify 10/10 |
| 2026-09-05 | rebase-worktree | pure | pass | n/a (site adoption) | W4 T18: spawned no-run context guard -- spawned panes with no armed run error out visibly instead of presenting unwatched forms (gates conflict:rebase-worktree and push); certify 10/10 |

| 2026-09-05 | mattstack:gate-protocol | pure | pass | n/a (hidden, include-reached) | W4 final-review fix wave: Unattended step rewritten to marker+background-wait+end-turn (no more foreground `gate wait` block); attended non-herdr panes carved out of the idle wait at Presentation, step 3, step 4, and the quick-reference table so wait belongs only to unattended panes and over-cap herdr panes; the context recipe now builds and measures `$CONTEXT` and structurally omits `--context` past 8192 bytes instead of shipping `--context ""`; strict-membership section reworded to value-only for labeled options; certify 10/10 |
| 2026-09-05 | rebase-worktree | pure | pass | n/a (site adoption) | W4 final-review fix wave: dirty-tree gate gained the spawned no-run guard its conflict/push siblings already had, now routes through gate-protocol's Runs integration, and `--decided-by` is fixed from the verb name `rebase-worktree` to the answer's surface; certify 10/10 |
| 2026-09-05 | checkout | pure | pass | n/a (site adoption) | W4 final-review fix wave: re-certified unchanged after the gate-protocol prose fixes; certify 10/10 |
| 2026-09-05 | mattstack:shepherdr | pure | pass | 5/5 (scenarios unchanged) | W4 final-review fix wave: gate relay step 2/3 gained the labeled-option rule (render `label`, submit `value`) the question-relay path already had; compiled fill recompiled via `rt skills compile`; `rt skills check` reports current |
| 2026-09-08 | mattstack:receive-review | pure | pass | n/a (description unchanged) | respond-plan reshaped to one single-select per thread (BOARD-23): 3-option questions stay under the form cap for any thread count; thread id joined from the option value, never the `thread-<n>` id; `skip` sentinel on code-changes; contradictory-selection re-ask retired; Iterate/Hold placed on a pane-only question; certify 10/10 |
| 2026-09-08 | rebase-worktree | pure | pass | n/a (description unchanged) | SKILLS-45: `rt sync --json` fast path ahead of the manual guards, exit-code table (0 synced+pushed, 3 conflict gate, 4 stack-refusal refuses, 4 stack-check-unavailable opens the manual guards), push gate scoped to the manual path; 6 fixture scenarios RED->GREEN in `docs/superpowers/plans/red-fastpath-rebase-worktree.md`; certify pass |
| 2026-09-08 | sync-open-mrs | pure | pass | n/a (description unchanged) | SKILLS-45: step 3 states that rt-sync-synced branches come back pushed; batch push multi-select names the still-unpushed branches; sweep fixture GREEN; certify pass |

(Ledger rows are appended by the orchestrating session as each lane lands -- lanes themselves never edit this file.)
