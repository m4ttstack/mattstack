---
name: editing-skills
description: Use when adding, editing, publishing, or debugging why a change isn't live in any mattstack-connected skill surface -- the mattstack plugin, a team pack (acme), or a compiled/vendored pipeline verb built with `rt skills compile` -- e.g. "add a mattstack skill", "why isn't my skill or pipeline change showing up", "rt skills compile / check", "update the work orchestrator", or any change under mattstack-skills, a teams/<team> pack, or a shared work/review engine.
---

# Editing and Publishing Estate Skills

Skills load from a **versioned plugin cache**
(`<config>/plugins/cache/<marketplace>/<plugin>/<version>/`), never from the
source repo. A source edit is invisible until you bump the plugin version,
run the update, and restart the session. Same-commit version bumps are the
convention (see any pack bump in git history). What the update puts in the
cache differs by estate: a team pack's update copies the pack's whole
working tree, untracked files and `.worktrees/` included, so prune stray
worktrees before a bump; the mattstack plugin's update clones the checkout's
committed `main`, so an uncommitted edit or an untracked file never reaches
the cache.

The team pack is a _directory-source_ marketplace, so a loaded pack skill's
reported base dir often points at the SOURCE path, not the cache copy. Don't
read that as "it loads from source": the versioned cache is still what a
fresh session loads, and the bump/update/restart rule above still applies.
The source path in the base dir is a convenience, not the live surface. The
mattstack plugin is a _url-source_ entry (a `file://` URL to the checkout),
so its base dir is the cache clone itself.

## The two estates

|             | Team pack (acme)                                                                                                                            | mattstack plugin                                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | `~/.mattstack/teams/acme/mattstack/packs/acme/skills/<name>/` (hand-authored) or `packs/acme/attachments/<fill>/` (fills)                   | `~/Documents/GitHub/mattstack-skills/plugin/skills/<name>/` (invocable), `attachments/<category>/<name>/` (engines, includes, mattstack fills -- reached only through a pack's compile), or `pack/stubs.jsonc` + `pack/skills.jsonc` (the pack's OWN one-verb roster and bindings: `shepherdr`, compiled to `skills/shepherdr/`) |
| Manifest    | `packs/acme/.claude-plugin/plugin.json`                                                                                                     | `mattstack-skills/.claude-plugin/plugin.json`                                                                                                                                                                                                                                                                                    |
| Marketplace | `name` in the teams-clone `.claude-plugin/marketplace.json`, which need not match the pack name (directory source = the teams clone itself) | `mattstack` (the local dev marketplace `~/Documents/GitHub/mattstack-marketplace`, whose `mattstack` entry is a url source, a `file://` URL to this checkout at ref `main`; Claude Code refuses symlinked plugin paths since 2.1.257)                                                                                            |
| Update      | `claude plugin update <plugin>@<marketplace>` (derive both, see below)                                                                      | `claude plugin update mattstack@mattstack`                                                                                                                                                                                                                                                                                       |

**Deriving `<plugin>@<marketplace>` for the update.** The two names are
independent: `<plugin>` is the `name` in the pack's `plugin.json`;
`<marketplace>` is the `name` in the teams-clone
`.claude-plugin/marketplace.json`. They routinely differ, so read
`marketplace.json` for the value rather than reusing the pack name: a pack
whose `plugin.json` name is `acme` can ship under a marketplace whose
`marketplace.json` name is `beacon`, making the update `claude plugin update
acme@beacon`. `mattstack@mattstack` reads identical only because that plugin
and its marketplace share a name; a team pack usually does not, and assuming
it does gives a real-looking command that updates nothing.

## The pipeline (all three cases)

1. **Craft gate first**: follow superpowers:writing-skills (TDD for docs --
   baseline a fresh agent before writing, verify after). For parameterized
   wrapper skills also read
   `${CLAUDE_SKILL_DIR}/../../../attachments/parameterized-skills/SKILL.md`.
2. Edit or create `SKILL.md` in the source path above.
3. **New mattstack skill only**: the manifest's `skills` field is an
   EXPLICIT array of the roots Claude loads directly (`./skills`,
   `./skills/review`, `./plugin/skills`; each root is scanned one level
   deep, so `./skills` loads the compiled `skills/shepherdr/` and skips the
   `review/` group); a skill under a new root silently never loads until
   you add it. An engine, include, or fill goes under
   `attachments/<category>/<name>/` and is never listed there: it reaches
   a session only when a pack compiles it in -- the mattstack pack's own
   roster included.
4. Bump `version` in the manifest -- same commit as the skill change. For
   mattstack, this is step 1 of "Releasing an engine, include, or fill change" below;
   finish that section's step 2 for each compiled pack.
5. Commit and push. For the team pack, push IS the team publish
   (teammates' installs read the same repo). For mattstack, the commit on
   `main` is what the update clones, so it is required; push is
   backup/other-machines. To try an uncommitted edit for one session
   without touching the cache: `claude --plugin-dir
~/Documents/GitHub/mattstack-skills`.
6. **Update the plugin cache**: `claude plugin update <plugin>@<marketplace>`.
   cswap users first run `readlink ~/.claude-swap-backup/sessions/*/plugins`.
   Every line `~/.claude/plugins` = one shared cache, and that one update
   is the whole step. Any other line = that account keeps its own cache;
   repeat the update with `CLAUDE_CONFIG_DIR=<that session dir>` prefixed.
7. Restart the Claude session -- the running process keeps its old cache.

## When a pack compiles verbs from a shared engine

A pack that runs `rt skills compile --pack <pack>` does not hand-author its
verbs. The compiler fills the `{{placeholder}}` markers in the mattstack
engines (`work`, `stage-*`, `review`, `self-review`, `receive-review`,
`ship`, `watch-ci`, `shepherdr`) with the pack's fills and writes public
verbs to `<pack>/skills/<verb>/`, internal verbs and stages to
`<pack>/attachments/<name>/`. Edit the engine (mattstack-skills) or the fill
(`<pack>/attachments/<fill>/`), then recompile; the next compile overwrites
compiled files. The mattstack pack is one such pack: `pack/stubs.jsonc`
rosters `shepherdr`, bound through `pack/skills.jsonc` (a standalone pack
with no registered repo compiles against its own manifest).

Writing a fill:

- A file beside the fill is referenced as `${CLAUDE_SKILL_DIR}/<file>`; the
  compiler vendors it under the verb's `parts/<slot>/` and rewrites the
  token. A bare `<file>` ships verbatim and points nowhere.
- A mattstack attachment's rules are inlined with `{{include:<name>}}`
  alone on its own line (it gets its own seam marker). A sibling verb is
  named with `{{verb.path:<name>}}` (renders the reading path from the
  compiled file, whichever side each lands on), and a file in ANOTHER
  attachment with `{{pack.path:<attachment>/<file>}}` (renders a
  host-anchored path; the file must exist at compile time, and a compiled
  verb's output is not addressable this way). Nothing else
  placeholder-shaped belongs in a fill.
- `rt skills check` names what moved on each stale line (source, fill,
  include, vendored, frontmatter, structure); a stage's slot binds with
  `rt skills bind <stage> <slot> <plugin:fill>`, and `rt skills surface set
<stage> --public` works before the stage's first compile.

What `compile` and `check` read:

| Source                                       | Read from                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| mattstack engines, includes, mattstack fills | the INSTALLED mattstack plugin cache                                                                                                 |
| the pack's own fills                         | the pack checkout (`--pack-dir`)                                                                                                     |
| everything, for `--pack mattstack` itself    | the mattstack-skills CHECKOUT (engines, fills, and `pack/skills.jsonc`); the installed cache is never consulted                      |
| mattstack version in every seam marker       | mattstack's `plugin.json` at compile time; `check` masks it, so a bump that changed no inlined engine, include, or fill is not drift |

### Releasing an engine, include, or fill change

1. Changed a mattstack file? Commit it; `sh tests/certify.sh <its dir>`; bump
   mattstack's `plugin.json`.
   1. `rt skills check --pack mattstack` stale? The change reaches the
      pack's own verb: `rt skills compile --pack mattstack`; `rt skills
check --pack mattstack` -> `current`; commit `skills/<verb>/` with the
      bump.
   2. `claude plugin update mattstack@mattstack`.
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

## Final Validation

If you changed a skill, ALWAYS manually read the compiled output in FULL of ALL affected skills (no grep) to validate expected vs what was outputted. Many errors have been caught this way.
