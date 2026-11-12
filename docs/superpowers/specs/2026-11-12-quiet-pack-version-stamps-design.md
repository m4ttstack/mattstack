# Quiet pack version stamps

## Why

A team pack's history on the org data branch is mostly noise. Each
`rt skills sync` bumps the pack's patch version and recompiles, and the
compiler writes that version into every compiled file. One sync on a
real pack touched about 140 files, and every change was a one-line
version string. When the mattstack plugin's version moves, every
compiled file in every pack picks up dozens more changed lines. Edits
that change something are hard to find among them.

The goal is the package.json shape: a version bump changes the manifest
and one lock file, and a content change touches only the files whose
content changed.

## Goals

- A bump with no content change touches `plugin.json`, the pack's lock
  file and nothing else.
- A change to one source touches only the compiled files that inline it.
- One commit per sync.
- Pack authoring puts the source edit and its recompile in one commit.
- The same holds for the mattstack plugin's own compiled skills.
- The console's pack history folds existing version-only commits, without
  rewriting them.

## Non-goals

- Changing when versions bump. Claude Code reloads a plugin only when its
  version changes, so every rebuild still bumps.
- Changing the run DB schema or the `pack_commits` format.

## Anti-goals

- Nothing that reads a stamp today may silently break or degrade. This
  covers the console's run detail (pack versions drift row, stage-doc
  panel) and its Packs page (Changes tab "built from" rows).
- A long-running session must keep reading the references of the pack
  version it loaded, even after a newer version installs mid-run.

## Where the stamps are today, and who reads them

| Stamp | Written by | Read by |
|---|---|---|
| `version=` in every `<!-- part: ... -->` seam | `placeholders.ts`, `team-params.ts`, block render | `drift.ts` (`partExtents` → `PartExtent.version`), `anatomy.ts` (`builtVersion`), console `waiting.ts` and `PackHistory.tsx` ("ref built → current"). `check` masks it (`maskProvenance`). |
| `metadata.compiled: "mattstack@X + pack:fill@Y + ..."` | `compile.ts` `buildFrontmatter`, `expand.ts` | `lsp/skill-paths.ts` checks only that the key exists. `check` masks the value. |
| `skills_resolve {id: "<pack>@<version>:<unit>"}` preamble | `pointers.ts:30`, in every SKILL.md and every reference copy | The agent, which passes it to `skills_resolve`; `resolve.ts` uses the version to pick the plugin cache folder. |
| `compiled.json` `id` and `covers` | `unit-maps.ts` | `resolve.ts`, `mcp-lint.ts`, `sync.ts` |
| `--mattstack-sha`, `--mattstack-dirty`, `--pack-sha` baked by `{{run-start.flags}}` | `placeholders.ts` `runStartFlags`, `provenance.ts` | `rt run start` → `runs.pack_commits` → console `effectiveInputs.ts` (drift row, hex shas only) and `stageDoc.ts` (`git show <sha>:<stage doc>`). |
| Two sync commits (`skills: <pack> pending changes`, `skills sync: <pack> vX`) | `sync.ts:974` | Only the sync's own undo path. The unbumped check reads `plugin.json` history, not subjects. |

Two things found along the way:

- `--pack-sha` is `git rev-parse HEAD` of the whole org clone, so any
  team's commit changes every other team's next compile.
- That sha is HEAD before the compile's own commit, so the console's
  stage-doc panel shows the previous compile's stage text.

## Approaches considered for pinning

The version in the resolve id is what pins a session, so taking it out
needs a replacement.

- **Read the skill's folder (picked).** The installed folder path
  already carries the version (`.../<pack>/<version>/skills/<unit>`).
  The preamble passes it, and resolve reads the version from it. This
  keeps today's guarantee, removes the stamp and adds no step for the
  agent. It depends on the harness exposing the folder; see Pinning.
- **Use the installed version.** Simplest, but it drops pinning: a run
  that started on one version could silently read the next version's
  references after a mid-run sync. Rejected under the second anti-goal.
- **Read compiled.json first.** compiled.json sits in the skill folder,
  so finding it needs the folder anyway. Same dependency as the pick,
  plus a file read per run. Rejected.
- **Keep the version in the id.** Safe, but a bump still changes one line
  in every compiled file. Kept as the fallback if pinning by folder fails
  in review.

## Design

### 1. One lock file per pack

Compile writes `pack/compiled.lock.json` beside `requires.json`, holding
the version of each source plugin that the compile used:

```json
{ "mattstack": "0.32.56", "acme": "0.4.12", "acme-base": "org" }
```

One compile uses one installed version of each source, so per-part
entries are not needed.

- Seams keep `source=` / `binding=` (which name the plugin) and the line
  spans, and drop `version=`.
- `metadata.compiled` keeps its key (the LSP's compiled-output marker)
  and lists sources without versions: `mattstack + acme:review-criteria`.
- `PartExtent.version` and anatomy's `builtVersion` come from
  `lock[plugin of the seam]`. The console's payload keeps its shape, so
  the Changes tab's "built → current" rows are unchanged.
- `maskProvenance` no longer has version stamps to mask in seams and the
  header. `check` compares the lock separately, the way it treats a
  version-only bump today: a lock change alone is not drift.

### 2. Run provenance worked out at run start

`{{run-start.flags}}` stops baking `--mattstack-sha`, `--mattstack-dirty`
and `--pack-sha`. It renders the skill folder instead (the same value
the preamble uses; see Pinning). `rt run start` then works out:

- The pack's version from the folder's `plugin.json`, and the org commit
  where `plugin.json` reached that version (the sync commit, which also
  holds the compiled output). It is recorded as `<pack>=<short sha>`.
- The mattstack version from the pack's lock, recorded as
  `mattstack=<version>`, as the installed cache case does today.
- For a dev pack run from a checkout, today's `packProvenance(dirs)`
  path (sha plus dirty bit) stays as it is.

`pack_commits` keeps its `name=value,...` shape. The console's drift
row and stage-doc panel read it unchanged, and the stage-doc panel now
shows the text the run actually used.

The old flags stay accepted by `rt run start` and the MCP run tools
(`RUN_START_FLAGS`), so a skill compiled before this change still
records its provenance.

### 3. Pinning by skill folder

Every resolve id drops its version: `acme:work`, in the preamble and in
`compiled.json`'s `id` and `covers`. The preamble passes the skill
folder:

```
skills_resolve {id: "acme:work", dir: "${CLAUDE_SKILL_DIR}"}
```

`${CLAUDE_SKILL_DIR}` is the Claude Code substitution the compiler
already writes for public verbs, and that `references.ts` already
rewrites for reference copies. Resolve takes the version from the
plugin cache folder `dir` sits in, then resolves exactly as today.

- With `dir` missing or outside the plugin cache, resolve uses the
  installed version and returns a warning that the run is not pinned.
- An id that still carries a version (older compiled output) resolves
  as it does today.
- The `skills_resolve` MCP tool gains the `dir` argument, and the
  mcp-tools reference is regenerated.

### 4. One sync commit

`rt skills sync` makes one commit, `skills sync: <pack> v<version>`,
holding the pending edits, the bump, the lock and the recompiled output.
The undo path handles one commit.

### 5. Authoring

`mattstack:editing-skills` tells authors to recompile in the same commit
as the source edit, never as a separate "compile the X" commit. That
skill edit goes through `superpowers:writing-skills`.

### 6. Fold the old noise in the console

The existing history stays as it is. Rewriting the data branch would
orphan every past run's recorded sha (breaking the stage-doc panel and
drift row for those runs), look like a lost data branch to
`data-branch-guard.ts`, and need a reset on every member's clone.

Instead, the Packs page's Changes tab folds each run of consecutive
version-only commits into one collapsed row ("N version-only commits")
with a toggle that shows them. A commit is version-only when every file
it changes is identical before and after with provenance masked
(`maskProvenance`, plus the `plugin.json` version and the lock file).
rt decides this in the history read the tab already uses, so the console
does not reimplement the rule. Opening a folded row shows its commits as
today, and a two-commit compare can still pick any of them.

This is a UI change: it is checked against the Packs page mocks and
rendered in Fast Browser in light and dark before it counts as done.

### Compatibility

An rt older than this change cannot parse a resolve id with no version.
A pack compiled in the new format raises `minEngine` in
`pack/requires.json` (the gate in `lib/engine-floor.ts`) to the first rt
that ships it, so an older engine refuses the pack loudly instead of
failing at resolve time. The mattstack plugin's own compiled skills move
to the new format in the same release.

## Result

| Change | Files touched today | Files touched after |
|---|---|---|
| Sync with no content change | every compiled file (around 140 in a real pack) | `plugin.json`, `compiled.lock.json` |
| mattstack plugin bump | every seam in every compiled file | `compiled.lock.json` per pack |
| One fill edit | the files that inline it, plus every file's version lines | the files that inline it, plus the lock |
| Another team's sync | nothing at once, but its org sha rides into this pack's files at its next rebuild | nothing |
| Commits per sync | 2 | 1 |

Packs stay coupled only through what they really share: a change to the
mattstack plugin's or the org base pack's text still recompiles every
pack that inlines it, because that is a content change.

## Left to the builder

- The lock's exact file name and key order, and whether `check` reports
  a stale lock under its own cause.
- How `rt run start` finds the bump commit (walking `plugin.json`
  history the way `committedSinceBump` does is the obvious start).
- Whether old version-bearing seams in on-disk output need a read path
  or only a recompile; anatomy should not crash on either.
- Test coverage for: a mid-run install (resolve pins to the loaded
  folder), a missing `dir` (warns, uses installed), older compiled ids,
  and the console's drift row and stage doc against the new
  `pack_commits` values.
