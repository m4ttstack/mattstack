---
name: editing-skills
description: Use when adding, editing, publishing, or debugging why a change isn't live in any mattstack-connected skill surface -- the mattstack plugin, a team pack (acme), or a compiled/vendored pipeline verb -- e.g. "add a mattstack skill", "why isn't my skill or pipeline change showing up", "rt skills compile / check / sync", "an installed cache is lagging", "update the work orchestrator", or any change under mattstack-skills, a teams/<team> pack, or a shared work/review engine.
---

# Editing and Publishing Estate Skills

Skills load from a **versioned plugin cache**
(`<config>/plugins/cache/<marketplace>/<plugin>/<version>/`), never from the
source repo. A source edit is invisible until you bump the plugin version,
run the update, and run `/reload-plugins` in the session. Same-commit
version bumps are the convention (see any pack bump in git history). What the update puts in the
cache differs by estate: a team pack's update copies the pack's whole
working tree, untracked files and `.worktrees/` included, so prune stray
worktrees before a bump; the mattstack plugin's update clones the checkout's
committed `main`, so an uncommitted edit or an untracked file never reaches
the cache.

The team pack is a _directory-source_ marketplace, so a loaded pack skill's
reported base dir often points at the SOURCE path, not the cache copy. Don't
read that as "it loads from source": the versioned cache is still what a
session loads, and the bump/update/reload rule above still applies.
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
   mattstack, this is step 1 of "Releasing an engine, include, or fill change"
   below; finish that section's step 3 for each compiled pack.
5. Commit and push: `cd <checkout>` as its own Bash call, then the bare
   commands (`git add`, `git commit`), never `git -C <path> ...`. Push a
   checkout on its default branch with a bare `git push`; push a feature
   branch with `git_push {tree: <checkout path>}`, which refuses the
   default branch. For the team
   pack, push IS the team publish (teammates' installs read the same
   repo). For mattstack, the commit on
   `main` is what the update clones, so it is required; push is
   backup/other-machines. To try an uncommitted edit for one session
   without touching the cache: `claude --plugin-dir
~/Documents/GitHub/mattstack-skills`.
6. **Bring the caches current**: call `rt_verb {args: ["skills", "sync", "--pack", "<pack>"]}`,
   one call per pack. Skills verbs go through `rt_verb` this way everywhere
   below: `--pack <pack>` sits in `args`, and the call never carries a
   `cwd`. `--pack-dir <dir>` rides in `args` for `check` only; compiling a
   checkout's or worktree's sources is the bare Bash
   `rt skills compile --pack <pack> --pack-dir <dir>`, because `rt_verb`
   refuses that flag on compile. An `rt_verb` check or sync that comes
   back `failed (exit 1)` is drift (check) or a refusal (sync), and only
   the tail of its output comes back with it. Read what moved with the
   bare Bash `rt skills check --pack <pack>`. For a sync, run `git status`
   in the pack checkout first: a modified `plugin.json` plus compiled
   output is the `content drift survives recompile` handoff below, and a
   re-run would only refuse on the clean-checkout guard; a clean tree
   means another step refused or failed, and the bare Bash
   `rt skills sync --pack <pack>` prints each step's reason. Sync runs the whole
   deterministic tail as code -- a fast-forward pull in both checkouts,
   engine cache update, check, patch-bump, compile, recheck, a commit + push
   scoped to the pack, pack cache update, verify -- and reports
   `restartNeeded`. The pull is the step hand-runs forget: a checkout parked
   on a merged branch compiles stale engines and nothing says so.
   The middle of that chain (patch-bump, compile, recheck, commit + push)
   fires ONLY when check finds compiled output drifting from its sources, so
   your step 4 bump is never doubled: a hand-authored skill compiles to
   nothing and so never drifts, leaving sync as just the cache update. Sync's
   own bump is for the other case, where a shared engine rebuilt a pack's
   verbs and nobody has versioned that yet.
   Guards, all refused before anything mutates: both checkouts clean and on
   `main`, no `.worktrees/` or `.claude/worktrees/` under the pack, a
   resolvable `claude` binary, a marketplace for each. Run it against the
   canonical checkouts -- from a feature worktree or an unmerged branch it
   refuses by design, so land the work on `main` first.
   Sync only WARNS about a cswap session whose `plugins` is not a symlink
   resolving to `<config>/plugins`; for each session it names, repeat the
   update with `CLAUDE_CONFIG_DIR=<that session dir>` prefixed. By hand when
   sync refuses: `claude plugin update <plugin>@<marketplace>`.
7. Run `/reload-plugins` in each running session: it reloads plugins, skills,
   agents, hooks and plugin MCP servers in place from the updated cache. In a
   herdr pane, queue it on yourself with
   `rt pane send self --text "/reload-plugins" --then "Continue: ..."` and end
   the turn; otherwise ask the user to type it.

What sync never does is author or bump the ENGINE, so steps 1-5 stay yours in
every case.

## When a pack compiles verbs from a shared engine

A pack that runs `rt_verb {args: ["skills", "compile", "--pack", "<pack>"]}` does not hand-author its
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
- The bare Bash `rt skills check --pack <pack>` names what moved on each stale line
  (source, fill, include, vendored, frontmatter, structure); through
  `rt_verb`, a stale check returns only `failed (exit 1)` and a tail. A stage's slot
  binds with `rt_verb {args: ["skills", "bind", "<stage>", "<slot>", "<plugin:fill>", "--pack", "<pack>"]}`,
  and `rt_verb {args: ["skills", "surface", "set", "<stage>", "--public", "--pack", "<pack>"]}`
  works before the stage's first compile.

What `compile` and `check` read:

| Source                                       | Read from                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| mattstack engines, includes, mattstack fills | the INSTALLED mattstack plugin cache                                                                                                 |
| the pack's own fills                         | the pack checkout (`--pack-dir`)                                                                                                     |
| everything, for `--pack mattstack` itself    | the mattstack-skills CHECKOUT (engines, fills, and `pack/skills.jsonc`); the installed cache is never consulted                      |
| mattstack version in every seam marker       | mattstack's `plugin.json` at compile time; `check` masks it, so a bump that changed no inlined engine, include, or fill is not drift |

### Releasing an engine, include, or fill change

1. Yours, and only yours, in this order: `sh tests/certify.sh <its dir>` on the
   edited file; bump mattstack's `plugin.json`; commit the file and the bump
   together; push `main`. Sync consumes whatever `main` says and never bumps
   the engine, so a skipped bump leaves the engine cache -- and therefore
   every pack that compiles against it -- silently on the old version.
2. Call `rt_verb {args: ["skills", "sync", "--pack", "mattstack"]}`. The engine and its own
   compiled verb share a checkout, so the chain collapses to one pull and one
   update.
3. Call `rt_verb {args: ["skills", "sync", "--pack", "<pack>"]}` for each other compiled pack.
   `rt_verb {args: ["skills", "check", "--pack", "<pack>"]}` names which packs are stale (a
   stale pack comes back `failed (exit 1)`), and a lagging installed cache
   is the other trigger: the call's `installed` object reads
   `status: "lagging"` with its `version` and `sourceVersion` (the bare
   Bash check prints it as `installed cache: lagging (<a> installed vs <b> source)`).
   Lag alone leaves check's exit code at 0, so the call succeeds; read the
   `installed` object, not the success.
4. When sync reports `restartNeeded`, run `/reload-plugins` in each running
   session (step 7 of the pipeline above).

Sync refuses with `content drift survives recompile` when the pack has real
content changes pending. That is a handoff to this skill, not a failure: sync
leaves its version bump and compiled output in the pack working tree, so carry
that tree forward by hand: call `rt_verb {args: ["skills", "compile", "--pack", "<pack>"]}`,
then `rt_verb {args: ["skills", "check", "--pack", "<pack>"]}`, commit, push, then
`claude plugin update <pack>@<marketplace>`.

Proof the fix landed: in the installed pack copy
(`<config>/plugins/cache/<marketplace>/<pack>/<version>/`), the compiled
verb's `compiled:` metadata names the new mattstack version and the file
contains no `{{`. `check` alone proves the pack matches the installed
mattstack, whichever version that is.

## Verifying

`ls <config>/plugins/cache/<marketplace>/<plugin>/` shows installed
versions; the newest must match your bump. A skill invocable by name after
`/reload-plugins` is the end-to-end proof.

## Final Validation

If you changed a skill, ALWAYS manually read the compiled output in FULL of ALL affected skills (no grep) to validate expected vs what was outputted. Many errors have been caught this way.
