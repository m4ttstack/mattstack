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


(Ledger rows are appended by the orchestrating session as each lane lands -- lanes themselves never edit this file.)
