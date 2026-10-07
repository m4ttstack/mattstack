# Your first pack

A pack is your team's plugin: the verbs your team types (`/<team>:work`), the
bindings that route each pipeline stage to your rules, and the rules
themselves. Nobody writes it by hand. Two skills do the work; this page shows
what happens at each step so you know what to expect and what to check. The
examples use an org called `acme` and its team `widgets`.

## Before you start

On the machine that runs it:

| need | how to check | how to get it |
| --- | --- | --- |
| rt daemon | `rt daemon status --json` prints `"ok":true` | `rt setup pack` |
| mattstack plugin | `claude plugin list --json` lists `mattstack@...` | `rt setup pack` |
| superpowers plugin | `claude plugin list --json` lists `superpowers@...` | `rt setup pack` |
| glab | `which glab` | the mattstack app bundles it |
| a GitLab remote | `git remote get-url origin` | the repo's origin |

Your org must be on the machine too: `~/.mattstack/orgs/<org>/`, a clone
of the org repo, with one folder per team under `mattstack/teams/`. If
there is no org yet:

```bash
rt team create Acme --remote https://gitlab.example.com/acme/mattstack-org.git --first-team widgets   # an empty repo the org owns
```

That makes the org with `widgets` as its first team folder (left out, the
first folder is named after the org). An org admin gives another team its
folder, and that team's pack skeleton, with
`rt team add gadgets --owner dev1`, naming the forge usernames who own the
team.

## 1. Create the pack

In the repo, start Claude and say what you want in plain words:

```
$ claude
> we want the mattstack work pipeline on this repo, our team is widgets
```

`mattstack:creating-a-pack` picks itself up from that phrasing (or type
`/mattstack:creating-a-pack`). It runs the checks above and stops on any miss,
naming the fix. Then it runs:

```bash
rt skills init --json --team widgets
```

(`--team` is your own team when left out). rt works with one org per
machine, so the pack always lands in that org. It writes, in the org clone:

```
mattstack/teams/widgets/packs/widgets/.claude-plugin/plugin.json   the pack's plugin manifest, version 0.1.0
mattstack/teams/widgets/packs/widgets/PACK.md                       what this pack is and where to go next
mattstack/teams/widgets/packs/widgets/pack/surface.jsonc            which verbs are public (work)
mattstack/teams/widgets/packs/widgets/pack/stubs.jsonc              the verb roster: work, compiled from the mattstack engine
mattstack/teams/widgets/packs/widgets/pack/skills.jsonc             the bindings fragment: the eight-stage feature pipeline, model tiering, GitLab CI
mattstack/teams/widgets/settings.team.jsonc                         the repo added to the team's board.projects
.claude-plugin/marketplace.json                                     the pack listed as a plugin
```

and then compiles the pack (`skills/work/`, `attachments/stage-*/`), checks
it, and installs it on your machine as `widgets@<marketplace>`. The
envelope it prints ends with `"tryNext": "/widgets:work <ticket>"`. A team
folder made by `rt team add` already has the pack files; init keeps them
and carries on with the claim, compile and install.

The pack binds the repos in its team's `board.projects` (the org's list
unless the team sets its own), on the org's forge host.

Two things about that pack:

- **It has no rules yet.** Every stage runs its generic path. That is on
  purpose: the pipeline works on day one, and rules arrive one at a time
  (step 3).
- **Init publishes it.** Once the pack installs, init commits the new
  files in the org clone in one commit and pushes them, and its envelope
  says so in `published`. When init stops short of that (the share failed,
  or a later step failed after it wrote the pack),
  `rt team publish --team acme` finishes it. The team's
  members receive the pack through `rt setup`; a machine installs only its
  active team's pack. Later edits go out through the pack's own publish
  (step 3).

## 2. Prove it

`/widgets:work` appears after `/reload-plugins` in your Claude session.
Then run the pipeline on a small real ticket:

```
> /widgets:work <ticket>
```

A good first run: a branch or worktree, an `APPROACH:` block at the plan
gate, a commit, an MR, a CI verdict. The stages will tell you where they took
a generic fallback (for example, the provisioner did not know the repo, so
the branch was made in the checkout). Until this run has happened, the pack
is scaffolded, not proven; the skill says so.

The skill then asks one question, once:

> Are any of your team's rules already written down (CONTRIBUTING, a review
> checklist, branch rules, a release checklist)?

"No" is a complete answer. Each "yes" is one round of step 3.

## 3. Add a rule

Every rule is one round of `mattstack:extending-a-pack`, one ask at a time:

```
$ claude
> our pipeline shipped an MR without running bun run lint; make ship run lint before it opens an MR on this repo
```

The skill sorts the ask into one of four places:

| the ask is about | where it lands |
| --- | --- |
| a rule that holds even outside a pipeline (branch names, forbidden ops, where things live) | `skills/context/SKILL.md`, a public skill in the pack |
| something one stage or verb should do differently | a fill bound to that stage's slot (`slots.md` in the skill lists them) |
| a new door: `ship`, `review`, `watch-ci`, `self-review`, `receive-review`, `shepherdr` | a roster entry in `pack/stubs.jsonc` |
| the wording of an existing verb | its `description` in `pack/stubs.jsonc` |

For the lint example that is a fill on the ship stage's `domain` slot. What
you will see, in order:

1. **RED.** The skill runs the ship stage without the rule on a small task in
   a worktree and stops before the push, recording that nothing ran lint.
2. **The fill.** `mattstack/teams/widgets/packs/widgets/attachments/ship-lint/SKILL.md`, a
   small skill whose frontmatter declares `metadata.provides:
   "ship-domain@1"` and whose body is the rule in your team's words: run
   `bun run lint`, and on failure do not push.
3. **Bind, certify, check.**
   `rt skills bind stage-ship domain widgets:ship-lint` writes the binding into
   `pack/skills.jsonc` (the file teammates receive), regenerates the pack's
   bindings file for your repo and recompiles; `tests/certify.sh` and
   `rt skills check` pass.
4. **GREEN.** The same task again, in a session started with
   `claude --plugin-dir <pack dir>` so it loads the pack source instead of
   the installed copy: lint runs, a failure blocks the push.
5. **Publish** through `mattstack:editing-skills`: bump the pack version,
   commit, push, `rt skills sync --pack widgets`, `/reload-plugins`.

A rule can be undone the same way: remove the binding and the fill, bump,
publish.

## What not to do

- Do not edit `skills/work/` or `attachments/stage-*/`: compiled output,
  overwritten on the next compile.
- Do not edit the mattstack engine in the plugin cache: every team compiles
  from it, and the next update erases the edit.
- Do not edit `~/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc` by
  hand: `rt skills materialize` regenerates it; `pack/skills.jsonc` is the
  source.
- Do not copy another team's pack: its fills carry that team's rules.
- Do not write a fill "to have something there": an unbound slot renders as
  nothing, and that is the correct state until a rule exists.

## Fills the whole org shares

A rule every team follows goes in the org's base pack, a folder the org
admin adds by hand at `mattstack/org/packs/acme-base/` in the org repo:

- `pack/skills.jsonc` says `"base": true` and binds the shared fills.
- `pack/surface.jsonc` is `{ "public": [] }`.
- The fills sit under `attachments/<fill>/`, never `skills/`: nothing
  installs a base pack, so its fills are always inlined into each team's
  compiled verbs.

A team pack uses it with `"extends": "acme-base"` in its
`pack/skills.jsonc`, and its own fills override the base's slot by slot.
The base is never listed in `claude.plugins` and has no marketplace entry.

A verb the org defines (for example `watch-ci`) reaches a team when the
team lists it in `pack/stubs.jsonc` and compiles: with no team fill for a
slot, the org's fill lands, and the verb is the team's (`/widgets:watch-ci`).

Bindings follow the base at once on every machine. Compiled fills follow
at the team owner's next `rt skills compile`.

A file a skill opens at run time (a reference, a checklist) also lives in
the base, under `attachments/<name>/` with a `SKILL.md`. Each compile of a
team pack that extends the base copies it to the same path in the team
pack, with a `compiled.json` marking the copy, and writes the team pack's
name wherever the file says `{{pack.name}}`. A team that wants its own
version deletes the copy and writes its own folder there; compile then
leaves it alone.

## Where things live

| thing | path |
| --- | --- |
| the org clone (a git clone the daemon keeps in sync) | `~/.mattstack/orgs/<org>/` |
| a team's pack | `~/.mattstack/orgs/<org>/mattstack/teams/<team>/packs/<team>/` |
| the org's base pack | `~/.mattstack/orgs/<org>/mattstack/org/packs/<org>-base/` |
| the bindings file per repo and pack (generated, never edited) | `~/.mattstack/repos/<host>-<path>/packs/<pack>/skills.jsonc` |
| the installed copy sessions load | `~/.claude/plugins/cache/<marketplace>/<pack>/<version>/` |
