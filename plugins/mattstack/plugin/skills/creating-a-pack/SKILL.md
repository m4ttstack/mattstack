---
name: creating-a-pack
description: Use when a team wants the mattstack pipeline on a repo that has no pack yet -- "make a pack", "set up /<team>:work", "we want the work pipeline on our repo", "onboard our team to mattstack", or when no pack of the team's is installed. Not for adding rules or verbs to a pack that already exists.
---

# Creating a pack

A pack is a plugin in the team's zone: a verb roster, a bindings fragment,
and (later) domain fills. `rt skills init` writes all of it; this skill runs
that verb, proves the result, and offers the first rules. One zone holds
one pack, named after the zone's namespace.

The output of this skill is a pack the author can invoke, in this order.
Each step is required; the flow is not done until the last one has run:

1. every prerequisite checked and named
2. `rt skills init --json` run once, its envelope read
3. a reloaded session that has run `/<pack>:work`, with its fallbacks named
4. the first-rules question asked once
5. the zone's commit confirmed and pushed

## 1. Prerequisites (stop on any miss, say which)

| check | command | pass |
| --- | --- | --- |
| rt daemon | `rt daemon status --json` | `"ok":true` |
| mattstack plugin | `claude plugin list --json` | an id starting `mattstack@` |
| superpowers | `claude plugin list --json` | an id starting `superpowers@` |
| glab | `which glab` | a path (the ship and watch-ci stages call it) |
| a GitLab remote | `git remote get-url origin` | host is a GitLab host |

A miss is reported as the missing thing and the command that installs it
(`rt setup pack` covers the first three; the mattstack app bundles glab).
Do not improvise a substitute.

## 2. Run init

Resolve the zone before anything is written. A zone is a directory under
`~/.mattstack/teams/` whose `mattstack/mattstack.jsonc` says `role: team`.
When the team's zone is absent, create it first:

```bash
rt team create <Name> --remote <url>    # an empty repo the team owns
```

When the team is unclear, ask which team this is before running. Then,
from the repo root, always name the zone:

```bash
rt skills init --json --zone <slug>
```

Without `--zone`, init picks by detection (the zone declaring this repo,
else the one packless zone on the host), which can land the pack in another
team's zone.

Read the envelope:

- A refusal is `{ "error": { "code", "message", "refused": true } }`: relay
  `error.message` verbatim and stop. `zone-missing` outside a TTY means the
  author runs `rt team create <Name> --remote <url>` (an empty repo the
  team owns) and re-runs init. `zone-has-pack` means the zone found already
  belongs to another team's pack: create a zone for this team the same way.
- A post-write failure is
  `{ "error": { "code", "message", "refused": false, "wrote": [...] } }`:
  relay `error.message` and `error.wrote`, then follow the printed remedy.
  Never re-run init on a written pack, except after `write-failed`, whose
  remedy is to remove the pack dir and re-run.
- Success is `{ "ok": true, ... }`: continue with `pack.name`, `pack.dir`,
  `tryNext`, `restartNeeded`.

## 3. Reload and prove

`restartNeeded` is always true: run `/reload-plugins` in this session, which
loads the new pack in place. In a herdr pane, queue it with `rt:herdr-inject`
(`rt pane send self --text "/reload-plugins" --then "Continue: <tryNext> with a
small real ticket"`) and end the turn; otherwise ask the author to type
`/reload-plugins`, then paste `tryNext` with a small real ticket.

"Works" means, after the reload: a branch or worktree, an APPROACH
block printed, a commit, an MR, and a CI verdict. Every stage runs its
generic path; that is the expected shape of a pack with no fills. Name each
fallback the run took in the report, for example: the provisioner did not
know the repo, so the branch was made in the checkout; `glab` was absent, so
the MR went through the forge API.

Until the first `/<pack>:work` run has reported back, the pack is
scaffolded, not proven: say "scaffolded, proof pending". In a herdr pane
the continuation runs it in this session, which then reports it; otherwise
the author's reloaded session owns the report. A hand-off is not a proof.

The `work` verb's description in `pack/stubs.jsonc` is a placeholder seeded
from the engine. Rewording it in the team's words is the first, smallest
edit; `mattstack:extending-a-pack` covers it.

## 4. Offer the first rules, once

Ask exactly this:

> Are any of your team's rules already written down (CONTRIBUTING, a review
> checklist, branch rules, a release checklist)?

Each yes is one round of `mattstack:extending-a-pack`, one rule per round.
No is a complete answer; say that rules can be added any time with the same
skill.

## 5. Publish

The daemon's team snapshot commits the zone on its own within a minute of
init (a `snapshot:` commit covering the pack dir, `team.jsonc`, and
`marketplace.json`). Confirm it landed and reached the remote:

```bash
git -C <zone dir> status -sb
```

Clean and not ahead means published. Ahead means the daemon could not push;
push it. Then say that teammates receive the pack through `rt setup`, and
hand any later change to `mattstack:editing-skills`.

## Red flags

- Creating directories or `plugin.json` by hand: init writes them.
- Copying another team's pack: its fills carry that team's rules.
- A `.mattstack/skills.jsonc` inside the repo: the compiler reads the
  per-repo manifest under `~/.mattstack/repos/`, not the repo.
- Writing a fill "to have something there": fills are optional and each one
  is written through `superpowers:writing-skills` when the rule exists.
- Ending on "should I commit and push?": step 5 answers that; run it.
