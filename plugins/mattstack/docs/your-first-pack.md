# Your first pack

A pack is your team's plugin: the verbs your team types (`/<team>:work`), the
bindings that route each pipeline stage to your rules, and the rules
themselves. Nobody writes it by hand. Two skills do the work; this page shows
what happens at each step so you know what to expect and what to check. The
examples use a team called `acme`.

## Before you start

On the machine that runs it:

| need | how to check | how to get it |
| --- | --- | --- |
| rt daemon | `rt daemon status --json` prints `"ok":true` | `rt setup pack` |
| mattstack plugin | `claude plugin list --json` lists `mattstack@...` | `rt setup pack` |
| superpowers plugin | `claude plugin list --json` lists `superpowers@...` | `rt setup pack` |
| glab | `which glab` | the mattstack app bundles it |
| a GitLab remote | `git remote get-url origin` | the repo's origin |

A team zone must exist too: a directory under `~/.mattstack/teams/<slug>/`
that is a clone of a repo your team owns. If your team has none yet:

```bash
rt team create Acme --remote https://gitlab.example.com/acme/mattstack-team.git   # an empty repo the team owns
```

## 1. Create the pack

In the repo, start Claude and say what you want in plain words:

```
$ claude
> we want the mattstack work pipeline on this repo, our team is acme
```

`mattstack:creating-a-pack` picks itself up from that phrasing (or type
`/mattstack:creating-a-pack`). It runs the checks above and stops on any miss,
naming the fix. Then it runs:

```bash
rt skills init --json --zone acme
```

which writes, in the zone:

```
mattstack/packs/acme/.claude-plugin/plugin.json   the pack's plugin manifest, version 0.1.0
mattstack/packs/acme/PACK.md                       what this pack is and where to go next
mattstack/packs/acme/pack/surface.jsonc            which verbs are public (work)
mattstack/packs/acme/pack/stubs.jsonc              the verb roster: work, compiled from the mattstack engine
mattstack/packs/acme/pack/skills.jsonc             the bindings fragment: the eight-stage feature pipeline, model tiering, GitLab CI
mattstack/team.jsonc                               the repo declared under the team's forge host
.claude-plugin/marketplace.json                    the pack listed as a plugin
```

and then compiles the pack (`skills/work/`, `attachments/stage-*/`), checks
it, and installs it on your machine as `acme@<marketplace>`. The envelope it
prints ends with `"tryNext": "/acme:work <ticket>"`.

Two things about that pack:

- **It has no rules yet.** Every stage runs its generic path. That is on
  purpose: the pipeline works on day one, and rules arrive one at a time
  (step 3).
- **The daemon publishes it.** Within about a minute, the team-snapshot job
  commits the new files in the zone and pushes them. The skill checks that
  this happened (`git -C ~/.mattstack/teams/acme status -sb` is clean and
  not ahead) and pushes if it did not. Teammates receive the pack through
  `rt setup`.

## 2. Prove it

`/acme:work` appears only after a restart. Restart Claude Code in the repo
and run the pipeline on a small real ticket:

```
> /acme:work <ticket>
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
2. **The fill.** `mattstack/packs/acme/attachments/ship-lint/SKILL.md`, a
   small skill whose frontmatter declares `metadata.provides:
   "ship-domain@1"` and whose body is the rule in your team's words: run
   `bun run lint`, and on failure do not push.
3. **Bind, certify, check.**
   `rt skills bind stage-ship domain acme:ship-lint` writes the binding into
   the per-repo manifest and into `pack/skills.jsonc` (the file teammates
   receive) and recompiles; `tests/certify.sh` and `rt skills check` pass.
4. **GREEN.** The same task again, in a session started with
   `claude --plugin-dir <pack dir>` so it loads the pack source instead of
   the installed copy: lint runs, a failure blocks the push.
5. **Publish** through `mattstack:editing-skills`: bump the pack version,
   commit, push, `rt skills sync --pack acme`, restart.

A rule can be undone the same way: remove the binding and the fill, bump,
publish.

## What not to do

- Do not edit `skills/work/` or `attachments/stage-*/`: compiled output,
  overwritten on the next compile.
- Do not edit the mattstack engine in the plugin cache: every team compiles
  from it, and the next update erases the edit.
- Do not edit `~/.mattstack/repos/<slug>/skills.jsonc` by hand: it is
  regenerated on every materialize; `pack/skills.jsonc` is the source.
- Do not copy another team's pack: its fills carry that team's rules.
- Do not write a fill "to have something there": an unbound slot renders as
  nothing, and that is the correct state until a rule exists.

## Where things live

| thing | path |
| --- | --- |
| the zone (a git clone the daemon keeps in sync) | `~/.mattstack/teams/<slug>/` |
| the pack | `~/.mattstack/teams/<slug>/mattstack/packs/<pack>/` |
| the per-repo manifest (generated, never edited) | `~/.mattstack/repos/<host>-<path>/skills.jsonc` |
| the installed copy sessions load | `~/.claude/plugins/cache/<marketplace>/<pack>/<version>/` |
