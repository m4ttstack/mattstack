---
name: editing-skills
description: Use when adding, editing, or publishing a skill in the mattstack plugin or a team pack (acme) -- "edit the dev-servers skill", "add a new mattstack skill", "why isn't my skill change showing up", or any change under mattstack-skills or a teams/<team> pack.
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

## Verifying

`ls <config>/plugins/cache/<marketplace>/<plugin>/` shows installed
versions; the newest must match your bump. A skill invocable by name in a
fresh session is the end-to-end proof.
