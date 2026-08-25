# domain-pack template

Copy this directory to start a domain pack: the domain-owned half of a
mattstack pipeline. Replace `acme` with your domain prefix everywhere
(directory names, `name:` fields, this file).

A pack is three things:

1. **Skills that fulfill stage contracts.** Each declares
   `metadata.provides: "<contract>@<major>"` and is either a small
   binding-only skill (like the policy skill here,
   `disable-model-invocation: true`) or an existing team skill that
   gains a `provides` line in place.
2. **A bindings manifest** (`skills.jsonc`) binding your skills into the
   stage `domain` slots and defining your per-work-type pipelines.
   Install it to `~/.mattstack/skills.jsonc` (machine-global) or commit
   it as `<repo>/.mattstack/skills.jsonc` (repo-local wins).
3. **A certification habit.** Certify pack skills with
   `tests/certify.sh <skill-dir> --domain` from the mattstack-skills
   repo (structure checks without the purity greps), and keep selection
   micro-tests for any model-visible skill.

Stage contracts shipped by mattstack (see each stage's `slots:` block
for the `domain` slot's contract): provision-domain@1, plan-domain@1,
gates-domain@1, evidence-domain@1, self-review-domain@1, ship-domain@1,
watch-ci-domain@1. The review cluster adds three more (see each skill's
slot lines): reviewer-dispatch@1 (the `reviewer` slot on `review`,
`self-review`, `receive-review`), review-criteria@1 (the `criteria`
slot on the same three), and reply-rules@1 (receive-review's `reply-rules`
slot); stage-watch-ci also takes a `forge` binding (GitLab adapter
shipped as mattstack:ci-forge-gitlab). A custom stage is any skill with `metadata.stage` +
`stage-consumes`/`stage-produces`; add it to your pipeline array with
zero mattstack involvement.
