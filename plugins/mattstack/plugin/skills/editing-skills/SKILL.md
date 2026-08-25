---
name: editing-skills
description: Use when adding, editing, publishing, or debugging why a change isn't live in any mattstack-connected skill surface -- the mattstack plugin, a team pack (acme), or a compiled/vendored pipeline verb built with `rt skills compile` -- e.g. "add a mattstack skill", "why isn't my skill or pipeline change showing up", "rt skills compile / check", "update the work orchestrator", or any change under mattstack-skills, a teams/<team> pack, or a shared work/review engine.
---

# Editing and Publishing Estate Skills

Skills load from a **versioned plugin cache**
(`<config>/plugins/cache/<marketplace>/<plugin>/<version>/`), never from the
source repo. A source edit is invisible until you bump the plugin version,
run the update, and restart the session. Same-commit version bumps are the
convention (see any pack bump in git history). The update copies the whole
working tree, untracked files and `.worktrees/` included, so prune stray
worktrees before a bump.

## The two estates

| | Team pack (acme) | mattstack plugin |
|---|---|---|
| Source | `~/.mattstack/teams/acme/mattstack/packs/acme/skills/<name>/` (hand-authored) or `packs/acme/attachments/<fill>/` (fills) | `~/Documents/GitHub/mattstack-skills/plugin/skills/<name>/` (invocable) or `attachments/<category>/<name>/` (engines, includes, mattstack fills -- reached only through a pack's compile) |
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
   EXPLICIT array of the roots Claude loads directly (`./skills/review`,
   `./plugin/skills`); a skill under a new root silently never loads until
   you add it. An engine, include, or fill goes under
   `attachments/<category>/<name>/` and is never listed there: it reaches
   a session only when a pack compiles it in.
4. Bump `version` in the manifest -- same commit as the skill change. For
   mattstack, this is step 1 of "Releasing an engine, include, or fill change" below;
   finish that section's step 2 for each compiled pack.
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

A pack that runs `rt skills compile --pack <pack>` does not hand-author its
verbs. The compiler fills the `{{placeholder}}` markers in the mattstack
engines (`work`, `stage-*`, `review`, `self-review`, `receive-review`,
`ship`, `watch-ci`, `shepherdr`) with the pack's fills and writes public
verbs to `<pack>/skills/<verb>/`, internal verbs and stages to
`<pack>/attachments/<name>/`. Edit the engine (mattstack-skills) or the fill
(`<pack>/attachments/<fill>/`), then recompile; the next compile overwrites
compiled files.

Writing a fill:

- A file beside the fill is referenced as `${CLAUDE_SKILL_DIR}/<file>`; the
  compiler vendors it under the verb's `parts/<slot>/` and rewrites the
  token. A bare `<file>` ships verbatim and points nowhere.
- A mattstack attachment's rules are inlined with `{{include:<name>}}`
  alone on its own line (it gets its own seam marker). Nothing else
  placeholder-shaped belongs in a fill.
- `rt skills check` names what moved on each stale line (source, fill,
  include, vendored, frontmatter, structure); a stage's slot binds with
  `rt skills bind <stage> <slot> <plugin:fill>`, and `rt skills surface set
  <stage> --public` works before the stage's first compile.

What `compile` and `check` read:

| Source | Read from |
|---|---|
| mattstack engines, includes, mattstack fills | the INSTALLED mattstack plugin cache |
| the pack's own fills | the pack checkout (`--pack-dir`) |
| mattstack version in every seam marker | mattstack's `plugin.json` at compile time; `check` masks it, so a bump that changed no inlined engine, include, or fill is not drift |

### Releasing an engine, include, or fill change

1. Changed a mattstack file? Commit it; `sh tests/certify.sh <its dir>`; bump
   mattstack's `plugin.json`; `claude plugin update mattstack@mattstack`.
2. For each compiled pack that `rt skills check --pack <pack>` reports stale:
   1. Bump the pack's `plugin.json` (the version is stamped into the output,
      so this comes before the compile).
   2. `rt skills compile --pack <pack>`; `rt skills check --pack <pack>` -> all `current`.
   3. Commit + push the pack clone; `claude plugin update <pack>@<marketplace>`;
      restart the session.

Proof the fix landed: in the installed pack copy
(`<config>/plugins/cache/<marketplace>/<pack>/<version>/`), the compiled
verb's `compiled:` metadata names the new mattstack version and the file
contains no `{{`. `check` alone proves the pack matches the installed
mattstack, whichever version that is.

## Verifying

`ls <config>/plugins/cache/<marketplace>/<plugin>/` shows installed
versions; the newest must match your bump. A skill invocable by name in a
fresh session is the end-to-end proof.
