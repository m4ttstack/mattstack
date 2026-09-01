# mattstack

mattstack is a Claude Code skill collection for orchestration and infra work:
fanning tasks out across parallel agents, picking the right model for each
one, running a ticket through a repeatable provision-to-ship pipeline, and
reviewing MRs and PRs before they merge. Every skill installs under the
`mattstack:` prefix and ships as a Claude Code plugin through the mattstack
marketplace.

mattstack is one piece of a small estate of tools. [rt](https://github.com/m4ttstack/rt)
is the developer CLI (daemon, tray app, plugin system) that some of these
skills shell out to. [gitq](https://github.com/m4ttstack/gitq) is a
deterministic stacked-branch engine for git. [board](https://github.com/m4ttstack/board)
is a one-page view of a team's open GitLab MRs. [glance](https://github.com/m4ttstack/glance)
is one client for GitHub and GitLab behind a single set of types.
[deck](https://github.com/m4ttstack/deck) gives a local app a name, keeps it
running, and gives it a real address. [fast-browser](https://github.com/m4ttstack/fast-browser)
drives the Chrome already open on the machine (see [Browser](#browser)
below). Agent-to-agent coordination runs over [herdr](https://github.com/herdrdev/herdr)
panes and [herdr-chat](https://github.com/m4ttstack/herdr-chat). Distribution
is the [mattstack marketplace](https://github.com/m4ttstack/mattstack-marketplace).
Skills wired to one operator's own machine, domains, and data live separately
under the `matt:` prefix; what's here is what someone else could actually
pick up.

## Table of contents

- [What's inside](#whats-inside)
  - [Orchestration](#orchestration)
  - [Infra](#infra)
  - [The parameterized-skill primitive](#the-parameterized-skill-primitive)
  - [Pipeline](#pipeline)
  - [Review](#review)
  - [Forge](#forge)
  - [Browser](#browser)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## What's inside

Only four skills are directly invocable once the plugin is installed:
`mattstack:shepherdr`, `mattstack:subagent-review-loop`,
`mattstack:editing-skills`, and `mattstack:getting-current-time` (see
[Usage](#usage)). Everything else below is an engine: it is not on any slash
menu, and it becomes runnable only once a team's own pack compiles it into a
verb with `rt skills compile`. That split is deliberate; see
[Configuration](#configuration).

### Orchestration

- **mattstack:shepherdr** -- transport for a herd of Claude Code agents via
  herdr panes: breaks work into jobs, spawns an agent per job, watches,
  relays questions, and integrates. Model, method, and account policy arrive
  through its slots (`model-tiering@1`, `execution-strategy@1`,
  `account-pool@1`, and an optional `shepherdr-domain@1`). The engine lives
  at `attachments/orchestration/shepherdr/`; this pack compiles it into its
  own public verb at `skills/shepherdr/` with the generic fills and the
  domain slot left unbound (`pack/stubs.jsonc` + `pack/skills.jsonc`, built
  by `rt skills compile --pack mattstack`), and a team pack compiles its own
  domain-bound copy for its repo. Requires the
  [herdr skill](https://github.com/herdrdev/herdr/blob/master/skills/herdr/SKILL.md)
  (auto-installed if missing).
- **mattstack:model-tiering** -- pick the least capable model tier and effort
  that can succeed at each unit of work, for both spawn-time (a shepherd
  picking worker models) and delegation-time (a worker dispatching
  sub-agents) decisions.
- **mattstack:cswap-accounts** -- cswap provider for the `account-pool@1`
  contract: the account-pool question, per-spawn picking via
  `pick-account.py` (scoped per-model pools, spread penalty), and the
  exhaustion decision tree. Binding-only; reached through a wrapper's
  accounts slot.
- **mattstack:execution-strategy** -- name the method an executor should run
  for a unit of work (trivial, direct-tdd, resume, superpowers, delegate)
  and the report contract that method owes, including the boundary rules for
  running the superpowers chain inside a dispatched worker.

### Infra

- **mattstack:editing-skills** -- use when adding, editing, publishing, or
  debugging why a change isn't live in any mattstack-connected skill
  surface: the mattstack plugin, a team pack, or a compiled/vendored
  pipeline verb built with `rt skills compile`. Owns the
  edit-bump-update-recompile loop.
- **mattstack:getting-current-time** -- read the clock only when no
  hook-injected `Current time:` stamp is in context or the work needs
  sub-5-minute precision. The plugin's `hooks/hooks.json` runs this skill's
  `inject-time.sh` on every prompt and, throttled, during long turns, so the
  stamp is normally already there.

### The parameterized-skill primitive

The parameterized-skill primitive ships as a Claude Code plugin from the
`plugin/` subtree: a wrapper skill declares named slots in its SKILL.md
`metadata`; a consumer binds each slot to an installed skill in
`.mattstack/skills.jsonc`; the wrapper's vendored `scripts/resolve-args.sh`
resolves and validates the bindings deterministically (POSIX sh,
machine-readable JSON both ways). Enforcement lives in the script, never in
prose.

- **parameterized-skills** -- authoring guide for the primitive: slot and
  provides declarations, the bindings manifest, and wiring the resolver into
  a wrapper. Convention:
  `plugin/skills/parameterized-skills/references/convention.md`. Manifest
  schema: `plugin/schemas/`. Model-free test matrix:
  `plugin/tests/test-resolve-args.sh`.

`shepherdr` was the first wrapper on the primitive and is now
compile-native: its `tiering`, `strategy`, `accounts`, and `domain` slots
are `{{slot}}` placeholders the compiler fills, so the runtime resolver now
serves only runtime-native wrappers.

A domain team starts its own pack from `templates/domain-pack`: skills that
fulfill the stage contracts, a bindings manifest, and the certification
habit, all generalized from the first shipped pack.

### Pipeline

The do-a-unit-of-work pipeline is built on the primitive. `work` and its
eight stage skills all set `disable-model-invocation`; they are reached only
through a pack's compiled `work` verb (`/<pack>:work`), which the pack's
surface config makes public, and the eight stages appear only as entries in
a manifest's `pipelines.<work-type>` array. Two of the stages also ship a
standalone counterpart for running that one step outside a full pipeline.

- **mattstack:work** -- run one unit of work through the pipeline the
  compiler baked in from the consumer's manifest.
- **mattstack:stage-provision** -- provision the environment: ticket + repo
  in, branch + worktree out.
- **mattstack:stage-plan** -- approach triage; prints the APPROACH
  commitment block before any implementation action.
- **mattstack:stage-gates** -- run the domain's gates for the touched paths;
  a no-op without a bound domain.
- **mattstack:stage-evidence** -- capture the before-state per the evidence
  plan, before implementation.
- **mattstack:stage-implement** -- do the implementation under the TDD
  floor (slotless; pure methodology).
- **mattstack:stage-self-review** -- self-review checkpoint between
  implementation and ship.
- **mattstack:stage-ship** -- publish the unit of work: push, open the
  MR/PR, attach evidence.
- **mattstack:stage-watch-ci** -- watch CI after the push and triage
  failures before calling the work done.
- **ship** -- the stage-ship step run on its own, outside a pipeline: "ship
  this", "push and open an MR", when there was no `work` run to begin with.
- **watch-ci** -- the stage-watch-ci step run on its own: "watch CI", "is
  the pipeline green", "babysit this MR" after a push made outside a
  pipeline.

### Review

The review cluster: a shared engine plus the protocols around it.
`review-posting` and `subagent-review-loop` are model-visible; `review`,
`self-review`, and `receive-review` are hidden via `disable-model-invocation`
and reached only as a pack's compiled verbs. The review skills plug into
domain packs via the `review-criteria@1`, `reviewer-dispatch@1`, and
`reply-rules@1` contracts, while `subagent-review-loop` is a standalone
one-off with no slots.

- The review flow lives in five internal include bodies
  (`review-core-body`, `review-core-body-after`, `review-core-body-tail`,
  `review-dispatch-body`, `review-dispatch-body-after`) that the compiler
  inlines into `review`, `self-review`, and `receive-review`; not for direct
  invocation.
- **mattstack:review** -- review someone else's MR/PR before it merges, from
  a pasted link, a bare `!iid`/`#number`, or a ticket id: resolve the
  target, dispatch the judgment to a fresh context, return the structured
  draft (`criteria` + `reviewer` slots).
- **mattstack:self-review** -- review this session's own work on the
  current branch before shipping; the bias gate against grading your own
  homework (provides `self-review-domain@1`, the stage's default adapter).
- **mattstack:receive-review** -- process the feedback on your own MR/PR
  with technical rigor instead of performative agreement (`criteria` +
  `reply-rules` slots).
- **mattstack:review-posting** -- the two-gate posting protocol: which
  findings land, which replies say enough, before anything reaches the
  MR/PR.
- **mattstack:subagent-review-loop** -- adversarial review loop for a spec
  or plan document before implementation: one reviewer subagent (model via
  `mattstack:model-tiering` unless the operator names one), fix and
  re-review with that same reviewer until it returns `Status: Approved`.

### Forge

Two clusters share this name: adapters for a CI forge (GitLab today, with
the seam left open for GitHub), and worktree/branch operations against a
code forge (GitHub or GitLab). Both are engines, reached only through a
binding or a pack's compile, never directly.

- **mattstack:ci-forge-gitlab** -- GitLab implementation of the watch-ci
  stage's `forge` slot: pipeline tree-walking, job listing, triage refs.
- **mattstack:gitlab-mr-threads** -- positioned diff comments and thread
  replies through `glab api` (JSON `position` bodies, `DiffNote`
  verification). An include body: the compiler inlines it into `review` and
  into any pack fill that carries `{{include:gitlab-mr-threads}}`.
- **checkout** -- get a local worktree for someone else's branch, given a
  branch name, an MR/PR link or number, or a ticket id, without starting
  work on it.
- **checkout-and-open** -- the same checkout, plus opening it in an editor
  in one step.
- **map-open-mrs** -- pair every one of the user's open MRs/PRs with the
  local worktree holding its branch; the discovery step of `sync-open-mrs`.
- **rebase-worktree** -- rebase one worktree's feature branch onto a moved
  default branch.
- **sync-open-mrs** -- rebase every open MR/PR in one sweep, built on
  `map-open-mrs` and `rebase-worktree`.

### Browser

Catalogued here so they are findable, but they install with
[Fast Browser](https://github.com/m4ttstack/fast-browser), not from this
repo:

- **fast-browsing** -- drive a browser through Fast Browser's tools at
  near-human speed: macro check first, scout once, batch whole flows into
  one script, read targeted.
- **browser-macros** -- library of pre-written flow scripts run via
  `browser_run_code_unsafe` (filename + args). Index in `MACROS.md`.
- **mine-macros** -- sweep session logs for repeated browser flows, propose
  parameterized macros with evidence, and update the library after
  per-macro approval.
- **reviewing-flows** -- triage the pending flow queue before approval:
  clear out recorded flows that can never replay, and read a flow's real
  steps before consenting to it.
- **annotating-screenshots** -- mark up a browser screenshot before it's
  shown or shared: highlight a changed value, point at a control, label a
  step, or blur out PII.
- **capturing-flows** -- record a browser session and deliver it as a GIF
  when motion is the evidence: a multi-step flow, a transition, a loading
  state, a bug that only shows while it happens.

## Installation

### The mattstack plugin

```bash
claude plugin marketplace add m4ttstack/mattstack-marketplace
claude plugin install mattstack@mattstack
```

That loads the invocable skills (`plugin/skills/`, `skills/review/`) and the
pack's own compiled verb (`skills/shepherdr/`, from `pack/stubs.jsonc` and
`pack/skills.jsonc` via `rt skills compile --pack mattstack`). The other
engines, includes, and fills under `attachments/` are not invocable on their
own: a team pack compiles them into its verbs with `rt skills compile` (the
`{{slot}}` and `{{include}}` markers are resolved at compile time, and
`rt skills check` reports which compiled verb drifted and why).
`mattstack:editing-skills` carries the edit-bump-update-recompile loop.

A skill's prefix is the `name:` field in its SKILL.md frontmatter; the
plugin name supplies the `mattstack:` namespace.

To pick up new versions later:

```bash
claude plugin update mattstack@mattstack
```

### Browser skills

The browser skills (`fast-browsing`, `browser-macros`, `reviewing-flows`,
and the rest of the [Browser](#browser) list) ship inside Fast Browser, not
this plugin:

```bash
npx @mattstack/fast-browser setup --host both
```

It is MIT licensed; the Playwright-derived runtime and extension artifacts
it installs remain Apache-2.0. See the
[Fast Browser README](https://github.com/m4ttstack/fast-browser#readme) for
requirements, safe and full profiles, unpublished local builds, Chrome
developer-mode loading, diagnostics, migration, rollback, uninstall,
privacy, and security guidance.

Fast Browser is its own repo and its own package. It started life inside
this one, so its history is a filtered copy of this repo's, but nothing
about it lives here now. Anyone still on the old symlink-only browser setup
can review and migrate that state with
`npx @mattstack/fast-browser migrate --dry-run` followed by
`npx @mattstack/fast-browser migrate --host both`.

## Usage

Once the plugin is installed, four skills are on the slash menu (or trigger
on the phrasing in their own description):

```
$ claude
> /mattstack:shepherdr fan out these 4 tickets across parallel agents
```

```
$ claude
> /mattstack:subagent-review-loop have a subagent review this spec until it signs off
```

`mattstack:editing-skills` and `mattstack:getting-current-time` mostly
trigger on their own: the first when a skill or pipeline change isn't
showing up where it should, the second almost never (a hook already stamps
the time into context on every prompt).

Everything else in [What's inside](#whats-inside) (the pipeline, the review
cluster proper, the forge adapters, `model-tiering`, `execution-strategy`,
`cswap-accounts`, `parameterized-skills`) is an engine with no slash menu
entry of its own. It becomes usable once a team builds its own pack on top;
see [Configuration](#configuration).

## Configuration

A domain team does not fork this repo. It starts its own pack from
`templates/domain-pack`: skills that fulfill the stage contracts (the
`plan-domain@1`, `provision-domain@1`, `ship-domain@1`, and similar
contracts each pipeline stage exposes), a `.mattstack/skills.jsonc` bindings
manifest naming which installed skill fills each slot, and the
certification habit described below.

The bindings manifest schema lives at
`plugin/schemas/skills-manifest.schema.json`, with a worked explanation in
`plugin/schemas/skills-manifest.md`. `pack/skills.jsonc` in this repo is a
real example: it binds `mattstack:shepherdr`'s `tiering`, `strategy`, and
`accounts` slots and leaves `domain` unbound.

Once a pack's manifest and fills are in place:

```bash
rt skills compile --pack <pack>
rt skills check --pack <pack>
```

`compile` writes the pack's public verbs and internal stages;
`check` reports which compiled verb has drifted from its manifest and why.

## Development

Tests are plain scripts and `bun:test` files; there is no build step.

```bash
git clone https://github.com/m4ttstack/skills mattstack-skills
cd mattstack-skills
bun test                              # tests/desc-test.test.ts, tests/pipeline-state.test.ts
tests/certify.sh <skill-dir>          # certification gate for one skill
tests/repo-purity.sh                  # whole-tree purity sweep, run bare
plugin/tests/test-resolve-args.sh     # model-free matrix for the primitive's resolver
plugin/tests/test-merge-manifests.sh  # manifest-merge matrix
hooks/tests/test-herdr-doorbell.sh    # offline, stubs herdr on PATH
```

Skill-local tests live beside the skills they cover, for example
`attachments/ci-forge-gitlab/tests/` and
`attachments/pipeline/stage-watch-ci/tests/`.

## Contributing

Every skill this repo ships is certified against the written purity rule in
[CERTIFICATION.md](CERTIFICATION.md):

1. Nothing domain-specific to any one team ships here. Domain conventions,
   examples, and routing live in domain-owned packs that bind to the seams
   in this repo (slots, pipelines, manifests).
2. Nothing personal to one operator ships in prose or scripts: no personal
   names, home paths, or account hints. The bar is what someone else could
   actually pick up.
3. House style: no em or en dashes, trigger-only descriptions
   ("Use when...", 500 characters or fewer).

Before opening a pull request, run the certification gate on any skill
touched and the repo-wide purity sweep:

```bash
tests/certify.sh <skill-dir>
tests/repo-purity.sh
```

`tests/certify.sh <skill-dir> --domain` is the domain-pack variant (skips
the two purity greps; a domain pack is allowed to be domain-specific). The
ledger in CERTIFICATION.md records each skill's pass.

## License

MIT licensed. See [LICENSE](LICENSE). Fast Browser's own Playwright-derived
runtime and extension artifacts remain Apache-2.0; see its
[README](https://github.com/m4ttstack/fast-browser#readme) for details.
