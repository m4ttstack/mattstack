---
name: editing-skills
description: Use when adding, editing, publishing, or debugging why a change isn't live in any mattstack-connected skill surface -- the mattstack plugin, a team pack (acme), or a compiled/vendored pipeline verb built with `rt skills compile` -- e.g. "add a mattstack skill", "why isn't my skill or pipeline change showing up", "rt skills compile / check", "update the work orchestrator", or any change under mattstack-skills, a teams/<team> pack, or a shared work/review engine.
---

# Editing and Publishing Estate Skills

Skills load from a **versioned plugin cache**
(`<config>/plugins/cache/<marketplace>/<plugin>/<version>/`), never from the
source repo. A source edit is invisible until you bump the plugin version,
run the update, and restart the session. Same-commit version bumps are the
convention (see any pack bump in git history).

## The two estates

| | Team pack (acme) | mattstack plugin |
|---|---|---|
| Source | `~/.mattstack/teams/acme/mattstack/packs/acme/skills/<name>/` | `~/Documents/GitHub/mattstack-skills/skills/<category>/<name>/` or `plugin/skills/<name>/` |
| Manifest | `packs/acme/.claude-plugin/plugin.json` | `mattstack-skills/.claude-plugin/plugin.json` |
| Marketplace | `acme` (directory source = the teams clone itself) | `mattstack` (directory source = `~/Documents/GitHub/mattstack-marketplace`, whose `plugins/mattstack` is a SYMLINK to the mattstack-skills repo) |
| Update | `claude plugin update acme@acme` | `claude plugin update mattstack@mattstack` |

## The pipeline (all three cases)

1. **Craft gate first**: follow superpowers:writing-skills (TDD for docs --
   baseline a fresh agent before writing, verify after). For parameterized
   wrapper skills also read
   `${CLAUDE_SKILL_DIR}/../../../attachments/parameterized-skills/SKILL.md`.
2. Edit or create `SKILL.md` in the source path above.
3. **New mattstack skill only**: the manifest's `skills` field is an
   EXPLICIT array of category roots (`./skills/pipeline`, `orchestration`,
   `forge`, `review`, `./plugin/skills`). A skill in a new category
   silently never loads until you add its root to that array.
4. Bump `version` in the manifest -- same commit as the skill change.
5. Commit and push. For the team pack, push IS the team publish
   (teammates' installs read the same repo). For mattstack, push is
   backup/other-machines; the local symlink makes the update work even
   before pushing.
6. **Update EVERY Claude account on the machine** (cswap users have
   several; one update reaches only the active account's cache):
   `claude plugin update <plugin>@<marketplace>` under each account's
   config (e.g. prefix `CLAUDE_CONFIG_DIR=~/.claude` for the main one).
7. Restart the Claude session -- the running process keeps its old cache.

## When a pack compiles verbs from a shared engine

Some team packs don't hand-author their verbs -- they **compile** them with
`rt skills compile --pack <pack>`, which renders each verb's SKILL.md and
vendors the verb's scripts from a shared engine (the mattstack `work` /
`review` / ... orchestrators) plus the pack's slot bindings. Editing the
pack's `skills/<verb>/` directly is a dead end: the next compile overwrites it.
A vendored script (e.g. a pipeline resolver) has its source in the **engine**.

Two facts drive the release order -- both are load-bearing:

- **`compile` reads engine files from the INSTALLED mattstack plugin, not the
  repo.** So a fix committed to an engine script in the source repo does not
  reach the pack until the **mattstack plugin is republished first** (bump its
  manifest + `claude plugin update mattstack@mattstack`). A same-version update
  no-ops and leaves the stale engine in the cache.
- **`rt skills check --pack <pack>` also compares against the installed
  mattstack**, so it will **not** flag your repo edit as drift. A clean `check`
  is NOT proof your fix landed -- it only means the pack matches whatever
  mattstack is currently installed.

Recompiling regenerates every verb against the current mattstack, so it also
lands any pending mattstack version jump; you cannot ship one engine fix in
isolation from an already-published mattstack bump.

Release order for an engine fix that a compiled pack must pick up:

1. Edit + commit the engine source in mattstack-skills.
2. Bump `mattstack-skills/.claude-plugin/plugin.json`; `claude plugin update
   mattstack@mattstack`.
3. `rt skills compile --pack <pack>` (re-vendors from the now-updated cache).
4. `rt skills check --pack <pack>` -> every verb `current`.
5. Bump the pack's `.claude-plugin/plugin.json`; commit + push the team clone
   (push = publish).
6. `claude plugin update <pack>@<marketplace>` on each account.
7. Restart the session.

Verify by **running the installed compiled script** under
`<config>/plugins/cache/<marketplace>/<pack>/<version>/...`, not the repo
source -- that is the only copy the pack's users execute.

## Verifying

`ls <config>/plugins/cache/<marketplace>/<plugin>/` shows installed
versions; the newest must match your bump. A skill invocable by name in a
fresh session is the end-to-end proof.
