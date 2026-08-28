# mattstack

The mattstack skill collection for Claude Code: orchestration and infra skills,
built for Matt Goodwin's own day-to-day use and shared here as a public
reference. Every skill is scoped under the `mattstack:` prefix. The browser
skills are catalogued here too, but they ship inside Fast Browser rather than
from this repo.

Skills wired to Matt's own machine, domains, and data live separately at
[m4ttheweric/skills](https://github.com/m4ttheweric/skills) under the `matt:`
prefix. What stays here is what someone else could actually pick up.

## Fast Browser

[**Fast Browser**](https://github.com/m4ttstack/fast-browser) lets Claude Code and Codex drive the
Chrome you already have open, with your profile and logins, instead of a blank
automated browser. Published as
[`@mattstack/fast-browser`](https://www.npmjs.com/package/@mattstack/fast-browser):

```bash
npx @mattstack/fast-browser setup --host both
```

It is MIT licensed; the Playwright-derived runtime and extension artifacts it
installs remain Apache-2.0.

See the [Fast Browser README](https://github.com/m4ttstack/fast-browser#readme)
for requirements, safe and full profiles, unpublished local builds, Chrome
developer-mode loading, diagnostics, migration, rollback, uninstall, privacy,
and security guidance.

Fast Browser is its own repo and its own package. It started life inside this
one, so its history is a filtered copy of this repo's, but nothing about it
lives here now.

## Skills

### orchestration

- **mattstack:shepherdr** -- transport for a herd of Claude Code agents via herdr panes: breaks work into jobs, spawns an agent per job, watches, relays questions, and integrates. Model, method, and account policy arrive through its three slots (model-tiering@1, execution-strategy@1, account-pool@1). Requires the [herdr skill](https://github.com/ogulcancelik/herdr/blob/master/SKILL.md) (auto-installed if missing).
- **mattstack:model-tiering** -- pick the least capable model tier and effort that can succeed at each unit of work, for both spawn-time (shepherd picking worker models) and delegation-time (a worker dispatching sub-agents) decisions.
- **mattstack:cswap-accounts** -- cswap provider for the account-pool@1 contract: the account-pool question, per-spawn picking via pick-account.py (scoped per-model pools, spread penalty), and the exhaustion decision tree. Binding-only; reached through a wrapper's accounts slot.
- **mattstack:execution-strategy** -- name the method an executor should run for a unit of work (trivial, direct-tdd, resume, superpowers, delegate) and the report contract that method owes, including the boundary rules for running the superpowers chain inside a dispatched worker.

### infra

- **mattstack:getting-current-time** -- read the clock only when no hook-injected `Current time:` stamp is in context or the work needs sub-5-minute precision. The plugin's `hooks/hooks.json` runs this skill's `inject-time.sh` on every prompt and, throttled, during long turns, so the stamp is normally already there.

### primitive (plugin/)

The parameterized-skill primitive ships as a Claude Code plugin from the
`plugin/` subtree: a wrapper skill declares named slots in its SKILL.md
`metadata`; a consumer binds each slot to an installed skill in
`.mattstack/skills.jsonc`; the wrapper's vendored `scripts/resolve-args.sh`
resolves and validates the bindings deterministically (POSIX sh, machine-
readable JSON both ways). Enforcement lives in the script, never in prose.

- **parameterized-skills** -- authoring guide for the primitive: slot and
  provides declarations, the bindings manifest, and wiring the resolver
  into a wrapper. Convention: `plugin/skills/parameterized-skills/references/convention.md`.
  Manifest schema: `plugin/schemas/`. Model-free test matrix:
  `plugin/tests/test-resolve-args.sh`.

First wrapper on the primitive: `mattstack:shepherdr` resolves its
`tiering`, `strategy`, and `accounts` slots (contracts `model-tiering@1`,
`execution-strategy@1`, `account-pool@1`) instead of hardcoding policy.

A domain team starts its own pack from `templates/domain-pack`: skills
that fulfill the stage contracts, a bindings manifest, and the
certification habit, all generalized from the first shipped pack.

### pipeline

The do-a-unit-of-work pipeline on the primitive. `work` and its eight
stage skills all set `disable-model-invocation`; they are reached only
through a pack's compiled `work` verb (`/<pack>:work`), which the pack's
surface config makes public, and the eight stages appear only as entries
in a manifest's `pipelines.<work-type>` array.

- **mattstack:work** -- run one unit of work through the pipeline the compiler baked in from the consumer's manifest.
- **mattstack:stage-provision** -- provision the environment: ticket + repo in, branch + worktree out.
- **mattstack:stage-plan** -- approach triage; prints the APPROACH commitment block before any implementation action.
- **mattstack:stage-gates** -- run the domain's gates for the touched paths; no-op without a bound domain.
- **mattstack:stage-evidence** -- capture the before-state per the evidence plan, before implementation.
- **mattstack:stage-implement** -- do the implementation under the TDD floor (slotless; pure methodology).
- **mattstack:stage-self-review** -- self-review checkpoint between implementation and ship.
- **mattstack:stage-ship** -- publish the unit of work: push, open the MR/PR, attach evidence.
- **mattstack:stage-watch-ci** -- watch CI after the push and triage failures before calling the work done.

### review

The review cluster: a shared engine plus the protocols around it.
review-posting and subagent-review-loop are model-visible; review,
self-review, and receive-review are hidden via `disable-model-invocation`
and reached only as a pack's compiled verbs. The code-review skills plug
into domain packs via the review-criteria@1, reviewer-dispatch@1, and
reply-rules@1 contracts, while subagent-review-loop is a standalone
one-off with no slots.

- The review flow now lives in five internal include bodies (`review-core-body`, `review-core-body-after`, `review-core-body-tail`, `review-dispatch-body`, `review-dispatch-body-after`) that the compiler inlines into `review`, `self-review`, `receive-review`; not for direct invocation.
- **mattstack:review** -- review someone else's MR/PR before it merges, from a pasted link, a bare `!iid`/`#number`, or a ticket id: resolve the target, dispatch the judgment to a fresh context, return the structured draft (`criteria` + `reviewer` slots).
- **mattstack:self-review** -- review this session's own work on the current branch before shipping; the bias gate against grading your own homework (provides self-review-domain@1, the stage's default adapter).
- **mattstack:receive-review** -- process the feedback on your OWN MR/PR with technical rigor instead of performative agreement (`criteria` + `reply-rules` slots).
- **mattstack:review-posting** -- the two-gate posting protocol: which findings land, which replies say enough, before anything reaches the MR/PR.
- **mattstack:subagent-review-loop** -- adversarial review loop for a spec or plan document before implementation: one reviewer subagent (model via mattstack:model-tiering unless the operator names one), fix and re-review with that same reviewer (its prompt borrowed from superpowers:writing-plans) until it returns Status: Approved.

### forge

- **mattstack:ci-forge-gitlab** -- GitLab implementation of the watch-ci stage's `forge` slot: pipeline tree-walking, job listing, triage refs. Reached only through the binding; the seam exists so a GitHub adapter can be the second implementation.
- **mattstack:gitlab-mr-threads** -- positioned diff comments and thread replies through `glab api` (JSON `position` bodies, `DiffNote` verification). An include body: the compiler inlines it into `review` and into any pack fill that carries `{{include:gitlab-mr-threads}}`.

### browser

Catalogued here so they are findable, but they install with
[Fast Browser](https://github.com/m4ttstack/fast-browser), not from this repo:

- **fast-browsing** -- drive a browser through Fast Browser's tools at near-human speed: macro check first, scout once, batch whole flows into one script, read targeted.
- **browser-macros** -- library of pre-written flow scripts run via `browser_run_code_unsafe` (filename + args). Index in `MACROS.md`.
- **mine-macros** -- sweep session logs for repeated browser flows, propose parameterized macros with evidence, and update the library after per-macro approval.
- **annotating-screenshots** -- mark up a browser screenshot before it's shown or shared: highlight a changed value, point at a control, label a step, or blur out PII.
- **capturing-flows** -- record a browser session and deliver it as a GIF when motion is the evidence: a multi-step flow, a transition, a loading state, a bug that only shows while it happens.

## Install

The repo is a Claude Code plugin, published through the
[mattstack marketplace](https://github.com/m4ttstack/mattstack-marketplace):

```bash
claude plugin marketplace add m4ttstack/mattstack-marketplace
claude plugin install mattstack@mattstack
```

That loads the invocable skills (`plugin/skills/`, `skills/review/`). The
engines, includes, and fills under `attachments/` are not invocable on their
own: a team pack compiles them into its verbs with `rt skills compile`
(the `{{slot}}` and `{{include}}` markers are resolved at compile time, and
`rt skills check` reports which compiled verb drifted and why). The
`editing-skills` skill carries the edit-bump-update-recompile loop.

A skill's prefix is the `name:` field in its `SKILL.md` frontmatter; the
plugin name supplies the `mattstack:` namespace.

Anyone still on the old symlink-only browser setup can review and migrate that
state with `npx @mattstack/fast-browser migrate --dry-run` followed by `npx
@mattstack/fast-browser migrate --host both`.

## Certification

Every skill this repo ships is certified against the written purity rule
in [CERTIFICATION.md](CERTIFICATION.md): nothing domain-specific to any
one team, nothing personal to one operator, house style held. The machine
half is `tests/certify.sh <skill-dir>` (purity greps, frontmatter grammar,
depth cap, vendored-resolver identity, stage declaration); the ledger in
CERTIFICATION.md records each skill's pass. Domain packs certify their own
skills with `tests/certify.sh <skill-dir> --domain`.
