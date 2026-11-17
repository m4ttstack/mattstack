# Husk skills: team packs commit sources, members render on their own Mac

Ticket: RT-586. Spike evidence lives in the ticket's agent notes.

## Problem

A team pack commits every compiled skill in full. One edit to shared text
lands in many files: a capture-evidence rule shows up 13 times (once per
skill's `references/` copy), and a `gate-protocol` engine change rewrites 14
compiled bodies in every pack. The pack's Changes view shows one real edit
as a dozen diffs.

## Goal

A team pack commit shows only the source a person edited, plus the version
bump every publish carries. A mattstack update alone makes no team pack
commit. A member on the publisher's mattstack version gets exactly the
skill text they get today; a member on another version gets that version's
engine text with the same team sources.

## Decisions

1. **Packs commit husks, not compiled bodies.** A husk is a skill's
   frontmatter plus one line telling the agent to call
   `mcp__mattstack__load_skill`.
2. **`load_skill` is a tool the mattstack plugin's mod registers.** It
   returns a short result and the rendered body as attached `context`. It
   must be a mod tool: a plain MCP result over about 25 KB is cut to a
   preview, and a mod hook that replaces skill text is skipped on enterprise
   accounts by `cc-plugin-sec-default`. A mod tool's attached context passed
   on both account kinds in the spike.
3. **Members render on their own Mac, with their installed mattstack.**
   Nothing pins a render to the publisher's mattstack version.
4. **Render on pull, render after install, build on a miss.** The daemon's
   after-pull hook renders packs a pull changed, setup renders after it
   installs a pack, and `load_skill` renders when the copy it needs is
   missing.
5. **Floors keep their meaning.** An ordinary skill edit raises no floor
   and reaches every member on the next sync. Only a genuine new need (a
   tool, argument or marker an older engine lacks) raises
   `pack/requires.json` `minEngine`. The husk switch raises it once, to the
   release that ships `load_skill`.
6. **Pointers resolve to rendered files on disk.** `skills_resolve` keeps
   returning paths, now into the render cache, so agents keep "resolve the
   key, read or run the file". Vendored scripts (`gate-ctx.sh`,
   `backend-db.py`) must run from a real path. `load_skill` serves the
   skill bodies, whose size is the problem.

## What a render takes in

A render runs the existing compile with the same inputs a publisher's
compile uses today, built in memory, so it needs nothing per member:

- **The org clone** at its checked-out data branch: the team pack's
  sources, the org base pack (`<org>/mattstack/org/packs/<base>`) and the
  org marker. The installed plugin copy has none of the base sources, so a
  render never reads it.
- **Team-level bindings**, merged the way `materializePack`
  (`lib/skills/materialize.ts`) merges them: the engine's
  `pack/skills.jsonc`, the base pack's and the team pack's own fragments.
  The repo key is the first repo the pack's zone declares, the same rule
  compile's default `--repo` follows.
- **No personal overrides.** `~/.mattstack/user/skills/overrides.jsonc` is
  left out, so every member renders the same team text they get today, and
  a broken overrides file cannot break team skills. A member's materialized
  `~/.mattstack/repos/<slug>/packs/<pack>/skills.jsonc` is not read, so a member
  with no registered repo still renders.
- **The installed mattstack plugin**, through `resolvePluginRoots()` as
  compile does today.

## What is committed

| Path in a team pack | Today | After |
| --- | --- | --- |
| `skills/<verb>/SKILL.md`, `attachments/<stage>/SKILL.md` | compiled body | husk |
| base doors (`skills/<base unit>/SKILL.md`, from `doorFor`) | "Read `${CLAUDE_SKILL_DIR}/../../attachments/<unit>/SKILL.md`" | husk for that base unit |
| `<unit>/references/`, `<unit>/parts/`, `<unit>/scripts/` | rendered and vendored copies | render cache only |
| `attachments/<base unit>/` (assured-base copies) | rendered copies | render cache only |
| `<unit>/compiled.json` | pointer map | render cache only |
| hand-written skills, fills, `pack/*` sources | sources | unchanged |
| `pack/requires.json` | written by compile | written by compile, husk rules below |
| `pack/compiled.lock.json` | per-target mattstack versions | bases only (no per-target engine versions) |

A husk body reads:

> Before anything else, call `mcp__mattstack__load_skill {skill: "<plugin>:<unit>", dir: "<this skill's directory>"}`. What it returns is this skill's full text: follow it as the skill. If the tool says any part was saved to a file, Read that whole file first. If the call fails, stop and say so.

The husk keeps the compiled body's frontmatter (`name`, `description`,
`allowed-tools`, `disable-model-invocation`, the `compiled:` stamp), so
invocation and permissions are unchanged. `allowed-tools` adds
`mcp__mattstack__load_skill`. In a husk, a frontmatter rule's
`${CLAUDE_SKILL_DIR}` points at the plugin copy, which no longer holds
`scripts/`, so `check` fails a husk rule naming
`${CLAUDE_SKILL_DIR}/scripts/...` or any other folder that now lives only in
the cache.

**No `${CLAUDE_SKILL_DIR}` in rendered text.** Claude Code fills that token
only when it loads a SKILL.md, never in a tool's attached context. Compiled
bodies already carry `@keys` instead (`keyBody`), and `check`'s
`leftover-token` rule fails one that does not; that rule now covers every
rendered file, base copies included. Doors, the one exception today, become
husks, so no rendered body needs the token.

### Floors and the lock in a husk pack

- `pack/requires.json` holds the highest of `HUSKS_MIN_ENGINE` (the release
  in rollout step 1) and the pack's own rule-based needs (team markers,
  pointer keys). It no longer copies the installed mattstack's own floor:
  a member's mattstack is held by its own floor, and the pack no longer
  carries engine text.
- `pack/compiled.lock.json` keeps `bases` and drops per-target engine
  versions, which now live in the render stamp. It gains one `builtWith`
  field: the mattstack version of the last compile that changed a source.
  A compile writes it only when it also writes a source change, so a
  mattstack bump alone changes nothing committed in a team pack.
- **A source an older engine cannot compile.** A publisher on a newer
  mattstack can bind a fill to a slot, block or stage an older engine lacks.
  That is a genuine new need, but nothing detects it ahead of time. The
  accepted outcome: a member whose render fails while their mattstack is
  older than `builtWith` gets a `load_skill` error that names the version
  the pack was built with and says to update mattstack (`rt setup`), and the
  pull hook logs the same. The previous pack version's tree is never served
  in its place. Members on the same or a newer mattstack than the publisher
  get the same text the publisher saw.

## The render cache

`~/.mattstack/rt/rendered/<org>/<plugin>/<pack version>/<mattstack version>/`,
where `<mattstack version>` is the installed mattstack plugin's
`plugin.json` version. It holds the full tree a compile writes today: every
unit's `SKILL.md`, `references/`, `parts/`, `scripts/`, base copies and
`compiled.json`.

A `render.json` stamp beside the tree records the rt build that rendered
it, the mattstack version, and a hash of the inputs (the pack's sources,
the base pack's sources, the merged bindings).

**Staleness is judged only when the clone holds that tree's pack version.**
Then a tree whose rt build or input hash differs from what a render would
use now is rendered again. When the clone has moved past the tree's pack
version (a pull landed, the installed pack has not updated yet), the
existing tree is used as is: nothing can render that version again, and the
member's skills keep working until setup installs the new one. Only a
missing tree fails.

- **Atomic swap.** A render writes to a temp folder beside the target and
  renames it into place. If the target already exists (another render won
  the race), the temp folder is deleted and the existing tree is used.
- **Pruning.** After a render, keep the three newest pack versions per
  plugin and, under each, the two newest mattstack versions; delete the
  rest.

### Triggers

- **After a pull.** `composePullHooks` in `lib/daemon.ts` gains a render
  hook after `createMaterializePullHook`. The hook receives only the team
  slug, so it renders each pack in that org whose input hash differs from
  its newest stamp: a pull that changed a pack, its base or its bindings
  renders it, and an unchanged pack costs one hash. It never throws; a
  failure logs at `warn` with the pack and reason, and the miss path covers
  it.
- **After install.** `plugins.install` renders after
  `runMaterializeAfterInstall`, which also covers a mattstack update
  (installed by setup), since the new mattstack version has no tree yet.
- **On a miss.** `rt skills render` renders when the tree for the installed
  pack version and installed mattstack version is missing or stale, if the
  clone's pack version matches the installed one. Otherwise it fails with a
  sentence naming the version it lacks and `rt setup` as the fix. Rendering
  an older commit than the clone holds is out of scope for v1.

## `load_skill` and `rt skills render`

`rt skills render <plugin>:<unit> --dir <skill dir> [--file <path>] --json`
is a new hidden verb. It reads the installed pack version from `--dir`'s
plugin version folder, finds or renders the tree, and prints the body (or
the named file) with its version and stamp in a `--json` envelope.

The mattstack mod (`plugins/mattstack/hooks/`) registers `load_skill` at
`session.start` with `isDeferred: false` and answers its `tool.check` with
allow, the same shape as `enter-worktree-check.ts`. Its `tool.call` hook:

- takes `skill` (`<plugin>:<unit>`) and `dir` (the loaded skill's own
  directory, which pins the installed pack version, as `skills_resolve`
  does);
- runs `rt skills render`, trying each `rt` the way the worktree check does;
- splits the body at line boundaries into pieces of at most 99,000
  characters and returns
  `{ result: "Loaded <id> (pack <version>, mattstack <version>): <n> characters in <k> parts", context: pieces }`;
- on any failure returns `{ deny: "<what is missing>. <the fix>" }`, which
  the model reads as the tool's error, with no context, so it stops instead
  of working from a husk. A `tool.call` hook may answer `deny`; the
  human-todos mod does (`mods/human-todos/src/contract.ts`).

## Who reads what

| Reader | After |
| --- | --- |
| An agent invoking a skill (slash command, Skill tool) | Gets the husk; calls `load_skill`. |
| An orchestrator reading a stage through an `@key` (`@stage-provision/SKILL.md`) | `skills_resolve` returns the rendered file in the cache, which it reads directly. No `load_skill` call. |
| A path reader handed a husk path (the board's `--skill-path` dispatch, `apps/board/src/herdr.ts` `dispatchPrompt`) | Reads the husk and follows its line, or the board passes the rendered path instead; the plan picks one. Either keeps `dispatchPrompt` failing closed when the skill does not resolve. |
| A subagent handed a husk | Calls `load_skill`; the end-to-end test proves subagents see the mod tool. |
| `skills_resolve` (`lib/skills/resolve.ts`) | Reads `compiled.json` from the render cache for the installed pack version; the bound check allows that version's cache folder and nothing else outside the plugin copy. |
| `rt skills check` (`computeCheck`) | Compares husks, the lock and `requires.json` against a compile; renders the whole pack in memory to catch compile errors, leftover tokens and bodies over 200,000 characters. Body drift and orphan checks apply to husks only. |
| `rt skills anatomy`, `blocks`, `--preview` | Render the whole pack in memory from the working tree, so sibling maps match uncommitted edits; never read the cache. |
| Console Packs page | Goes through those verbs; its Changes view shows sources only, which is the goal. |
| Language server (`lib/skills/lsp/`) | Already works on sources; `pack.path` targets stop being committed files, which it treats as compile output today. No change beyond tests. |
| Run provenance (`lib/runs/installed-provenance.ts`) | Reads the mattstack version and rt build from the render stamp the run loaded, not from `compiled.lock.json`. |
| `rt skills sync` | Commits husks and sources only. |

## Size rule

Claude Code keeps attached context whole up to 100,000 characters per piece
and 200,000 per tool call, and saves anything past that to a file with a
preview and the path. `check` fails a rendered body over 200,000
characters. The husk's "Read any saved file" line covers a body that grows
past the limit between checks. claimview `review` (201,762) needs trimming
before its pack switches.

## Rollout

1. A mattstack release ships `load_skill`, `rt skills render`, the render
   cache, the pull and install triggers, the resolver and provenance
   changes, and husk-aware `check`. Packs still commit full bodies, so
   nothing changes for anyone.
2. A pack opts in with `"husks": true` in `pack/skills.jsonc`. Its next
   compile writes husks, deletes committed bodies and copies, rewrites the
   lock and raises `minEngine` to `HUSKS_MIN_ENGINE`. Members below it are
   held, as today.
3. Once claimview and ingestion-platform run on husks, husks become the
   default for new packs.

## Skill and doc updates

The skills that teach pack editing describe committed compiled output and
must change with this, after the code they describe has shipped:
`mattstack:editing-skills` (the pipeline, `{{pack.path}}` copying into
`references/`, "Read the compiled output in full", what sync commits),
`mattstack:extending-a-pack`, `mattstack:creating-a-pack`, and
`lib/skills/README.md`. Each skill edit goes through
`superpowers:writing-skills` (RED baseline, edit, GREEN) and the
editing-skills pipeline (certify, version bump).

## Testing

- Unit: render inputs (no overrides, no member bindings file), the husk
  writer and doors, cache keying, stamp staleness, atomic swap and the
  lost race, pruning, pull hook ordering, `load_skill` splitting and its
  deny, the resolver bound, `check`'s size and token rules, provenance from
  the stamp.
- An ordinary fill edit leaves `pack/requires.json` unchanged, and a
  mattstack bump leaves a husk pack's committed files unchanged.
- End to end, as in the spike: the largest skills load whole through
  `load_skill`, with probe lines quoted word for word, on a personal and an
  enterprise account (a herdr pane under the enterprise cswap account), and
  a subagent handed a husk loads it too.

## Out of scope

- The mattstack pack's own compiled verbs (`shepherdr`, `wrap-up`, the
  writing styles) and the board's expanded skills.
- Rendering an older pack version than the clone holds.
- Applying personal overrides to rendered team skills.
- Folding remaining duplicates in the Console.
