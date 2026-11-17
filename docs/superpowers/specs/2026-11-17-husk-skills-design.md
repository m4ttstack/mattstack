# Husk skills: team packs commit sources, members render on their own Mac

Ticket: RT-586. Spike evidence lives in the ticket's agent notes.

## Problem

A team pack commits every compiled skill in full. One edit to shared text
lands in many files: a capture-evidence rule shows up 13 times (once per
skill's `references/` copy), and a `gate-protocol` engine change rewrites 14
compiled bodies in every pack. The pack's Changes view shows one real edit
as a dozen diffs.

## Decisions

1. **Packs commit husks, not compiled bodies.** A husk is a skill's
   frontmatter plus one line telling the agent to call `load_skill`.
2. **`load_skill` is a tool the mattstack plugin's mod registers.** It
   returns a short result and the rendered skill as attached `context`. It
   must be a mod tool: a plain MCP result over about 25 KB is cut to a
   preview, and a mod hook that replaces skill text is skipped on enterprise
   accounts by `cc-plugin-sec-default`. A mod tool's attached context passed
   on both account kinds in the spike.
3. **Members render on their own Mac, with their installed mattstack.**
   Nothing pins a render to the publisher's mattstack version.
4. **Render on pull, render after install, build on a miss.** The daemon's
   after-pull hook renders packs a pull changed. Setup renders after it
   installs a pack. `load_skill` renders when the copy it needs is missing.
5. **Floors keep their current meaning.** An ordinary skill edit raises no
   floor and reaches every member on the next sync. Only a genuine new need
   (a tool, argument or marker an older engine lacks) raises
   `pack/requires.json` `minEngine`. The husk rollout raises it once, to the
   release that ships `load_skill`.
6. **Pointers resolve to rendered files on disk** (recommended; confirm at
   review). `skills_resolve` keeps returning paths, now into the render
   cache, so agents keep "resolve the key, read or run the file". Scripts
   such as `backend-db.py` must be runnable from a real path, which rules out
   serving references only through a tool. `load_skill` serves skill bodies,
   whose size is the problem.

## What is committed

| Path in a team pack | Today | After |
| --- | --- | --- |
| `skills/<verb>/SKILL.md`, `attachments/<stage>/SKILL.md` | compiled body | husk |
| `<unit>/references/`, `<unit>/parts/` | rendered copies | not committed |
| `attachments/<base unit>/` (assured-base copies) | rendered copies | not committed |
| `<unit>/compiled.json` | pointer map | not committed (rendered beside the body) |
| hand-written skills, fills, `pack/*` | sources | unchanged |
| `pack/compiled.lock.json`, `pack/requires.json` | written by compile | unchanged |

A husk body reads:

> Before anything else, call `load_skill {skill: "<plugin>:<unit>", dir: "<this skill's directory>"}`. What it returns is this skill's full text: follow it as the skill. If the tool says any part was saved to a file, Read that whole file first. If it fails, stop and say so.

Frontmatter carries over from the compiled body as today (`name`,
`description`, `allowed-tools`, `disable-model-invocation`, the `compiled:`
stamp), so invocation and permissions are unchanged.

## The render cache

`~/.mattstack/rt/rendered/<org>/<plugin>/<pack version>/<mattstack version>/`
holds the full compiled tree a compile writes today: every unit's
`SKILL.md`, `references/`, `parts/`, base copies and `compiled.json`. The rt
build that rendered it is recorded in a stamp file; a different rt build
re-renders. A render writes to a temp folder and renames it into place, so a
reader never sees half a tree.

A render needs the org clone, not the installed plugin copy: base pack
sources, the org marker and the repo's materialized bindings exist only
there. It runs the existing compile against the clone, with output pointed
at the cache instead of the pack.

### Triggers

- **After a pull.** `composePullHooks` in `lib/daemon.ts` gains a render
  hook after `createMaterializePullHook`, so it renders with fresh bindings.
  It renders each pack whose sources or version the pull changed, plus every
  pack when the installed mattstack version changed since the last render.
  It never throws; a failure logs at `warn` and the miss path covers it.
- **After install.** `plugins.install` renders after
  `runMaterializeAfterInstall`.
- **On a miss.** `load_skill` renders when the copy for the installed pack
  version and installed mattstack version is missing, if the clone's pack
  version matches the installed one. Otherwise it fails with a sentence
  naming the version it lacks and `rt setup` as the fix. Rendering an older
  commit is out of scope for v1.

## `load_skill`

Registered at `session.start` by the mattstack mod (`plugins/mattstack/hooks/`),
with `isDeferred: false` and a `tool.check` allow, the same shape as
`enter-worktree-check.ts`.

- Input: `skill` (`<plugin>:<unit>`) and `dir` (the loaded skill's own
  directory, which pins the installed pack version, as `skills_resolve`
  does).
- It asks rt for the rendered body (`rt skills render <id> --dir <dir>`, a
  new hidden verb that returns the cached body or renders on a miss), splits
  it at line boundaries into pieces of at most 99,000 characters, and returns
  `{ result: "Loaded <id> (<pack version>, mattstack <version>): <n> characters in <k> parts", context: pieces }`.
- A failure is a `deny` whose text says what is missing and the fix, so the
  agent stops instead of working from a husk.

## Readers of compiled output

| Reader | Change |
| --- | --- |
| `skills_resolve` (`lib/skills/resolve.ts`) | Reads `compiled.json` from the render cache for the installed version; the bound check allows that cache folder, and nothing else outside the plugin copy. |
| `rt skills check` (`computeCheck`) | Compares husks and sources, renders in memory to catch compile errors, and fails a body over 200,000 characters. On-disk body drift and orphan checks apply to husks only. |
| `rt skills anatomy`, `blocks`, `--preview` | Already render in memory; `attachMaps` reads sibling maps from the render cache instead of the pack. |
| Console Packs page | Goes through those verbs, so it follows them. The Changes view shows only sources, which is the goal. |
| `lib/runs/installed-provenance.ts` | Unchanged: it reads `compiled.lock.json`, which is still committed. |
| `rt skills sync` | Commits husks and sources; no body churn. |

## Size rule

Claude Code keeps attached context whole up to 100,000 characters per piece
and 200,000 per tool call, and saves anything past that to a file with a
preview and the path. `check` fails a rendered body over 200,000 characters.
The husk's "Read any saved file" line covers a body that grows past the
limit between checks. claimview `review` (201,762) needs trimming before its
pack switches.

## Rollout

1. A mattstack release ships `load_skill`, `rt skills render`, the render
   cache, the pull and install triggers, and the resolver change. Packs still
   commit full bodies, so nothing changes for anyone yet.
2. A pack opts in with `"husks": true` in `pack/skills.jsonc`. Its next
   compile writes husks, deletes committed bodies and copies, and raises
   `minEngine` to the release in step 1. Members below it are held, as today.
3. Once claimview and ingestion-platform run on husks, husks become the
   default for new packs.

## Testing

- Unit: husk writer, render cache keying and atomic swap, pull hook ordering,
  `load_skill` splitting and failures, resolver bound, check's size rule.
- An ordinary fill edit leaves `pack/requires.json` unchanged.
- End to end, as in the spike: the largest skills load whole through
  `load_skill`, with probe lines quoted word for word, on a personal and an
  enterprise account (a herdr pane under the enterprise cswap account).

## Out of scope

- The mattstack pack's own compiled verbs (`shepherdr`, `wrap-up`, the
  writing styles) and the board's expanded skills.
- Rendering an older pack version than the clone holds.
- Folding remaining duplicates in the Console.
