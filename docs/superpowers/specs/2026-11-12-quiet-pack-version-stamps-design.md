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
  file and nothing else, for a team pack bump and an org base bump alike.
- A change to one source touches only the compiled files that inline it.
- One pack's sync never changes another pack's files.
- One commit per sync.
- Pack authoring puts the source edit and its recompile in one commit.
- The same holds for the mattstack plugin's own compiled skills.
- The console's pack history folds existing version-only commits, without
  rewriting them.

## Non-goals

- Changing when versions bump. Claude Code reloads a plugin only when its
  version changes, so every rebuild still bumps.
- Changing the run DB schema or the `pack_commits` format.
- Rewriting existing history on the data branch (see section 6).

## Anti-goals

- Nothing that reads a stamp today may silently break or degrade. This
  covers the console's run detail (pack versions drift row, stage-doc
  panel), its Packs page (Changes tab "built → current" rows, "waiting
  for compile", base pack owner and version) and resolve.
- A long-running session must keep reading the references of the pack
  version it loaded, even after a newer version installs mid-run.

## Where the stamps are today, and who reads them

| Stamp | Written by | Read by |
|---|---|---|
| `version=` in every `<!-- part: ... -->` seam | `placeholders.ts`, `team-params.ts`, block render | `drift.ts` (`partExtents` → `PartExtent.version`), `anatomy.ts` (`builtVersion`), console `waiting.ts` (`movedSourcesOf`) and `PackHistory.tsx` ("ref built → current"). `check` masks it (`maskProvenance`). |
| `metadata.compiled: "mattstack@X + pack:fill@Y + ..."` | `compile.ts` `buildFrontmatter`, `expand.ts` | `lsp/skill-paths.ts` checks only that the key exists. `check` masks the value. |
| `skills_resolve {id: "<pack>@<version>:<unit>"}` opening line | `pointers.ts` `openingLine`, in every SKILL.md, stage attachment, reference copy and parts file | The agent, which passes it to `skills_resolve` and reuses a held map that "covers" the id; `resolve.ts` uses the version to pick the plugin cache folder. |
| `compiled.json` `id` and `covers` | `unit-maps.ts` | `resolve.ts`, `mcp-lint.ts`, `sync.ts`. `check` compares `compiled.json` byte for byte. |
| A base copy's `compiled.json` `version` | `base-attachments.ts:160`, `:385` | The console's base owner and `baseVersion`. |
| `--mattstack-sha`, `--mattstack-dirty`, `--pack-sha` baked by `{{run-start.flags}}` | `placeholders.ts` `runStartFlags`, `provenance.ts` | `rt run start` → `runs.pack_commits`, `pack_dirty` → console `effectiveInputs.ts` (drift row, hex shas only) and `stageDoc.ts` (`git show <sha>:<stage doc>`). |
| Two sync commits (`skills: <pack> pending changes`, `skills sync: <pack> vX`) | `sync.ts:974` | Only the sync's own undo path. The unbumped check reads `plugin.json` history, not subjects. |

Two things found along the way:

- `--pack-sha` is `git rev-parse HEAD` of the whole org clone, so any
  team's commit changes every other team's next rebuild. `check` masks
  it, so it never triggers a rebuild by itself, but it rides along on the
  next one.
- That sha is HEAD before the compile's own commit, so the console's
  stage-doc panel shows the previous compile's stage text.

## Approaches considered for pinning

The version in the resolve id is what pins a session, so taking it out
needs a replacement.

- **Read the skill's folder (picked).** The installed folder path
  already carries the version (`.../<pack>/<version>/skills/<unit>`).
  The agent passes it, and resolve reads the version from it. This keeps
  today's guarantee, removes the stamp and adds no step for the agent.
  `run_start` already relies on the agent knowing this folder
  (`skillDir`, "the loaded skill's own directory").
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

Compile writes `pack/compiled.lock.json` beside `requires.json`. It is
keyed by compiled target, because `rt skills compile --verb` and sync's
verb filter recompile only some targets, and a target that was not
recompiled must keep its own record:

```json
{
  "skills/work": { "mattstack": "0.32.56", "acme": "0.4.12", "acme-base": "org" },
  "skills/review": { "mattstack": "0.32.55", "acme": "0.4.11", "acme-base": "org" },
  "bases": { "acme-base": "0.2.3" }
}
```

- A compile rewrites only the entries of the targets it compiled.
  (My call: a per-target lock, so a partial compile leaves untouched
  targets' "built → current" rows correct.)
- When mattstack is compiled from a checkout, the lock records its sha
  and dirty bit beside the target (`mattstackSha`, `mattstackDirty`),
  keeping the version itself plain. This keeps the dev provenance the
  baked flags carried. (My call.)
- Seams keep `source=` / `binding=` (which name the plugin) and the line
  spans, and drop `version=`. `PartExtent.version` and anatomy's
  `builtVersion` come from `lock[target][plugin of the seam]`. The
  console payload keeps its shape.
- `metadata.compiled` keeps its key (the LSP's compiled-output marker)
  and lists sources without versions: `mattstack + acme:review-criteria`.
- A base copy's `compiled.json` drops `version`. The base's version
  lives in the lock's `bases` entry, and the code that feeds the
  console's `baseVersion` reads it there. The owner still comes from the
  copy's `compiled.json`. (My call: in scope, or a base bump would still
  rewrite every base copy.)
- `check` never reads the lock: sync's compile always rewrites it, so a
  lock change alone is never drift, as a version-only bump is not today.
  Old seams compare equal to new ones (the mask deletes `version=`), but
  old opening lines do not, so each pack reads stale once after the
  upgrade until its next sync recompiles it.
- Console `waiting.ts` counts the lock as compiled output when it finds
  the last compile, so a version-only sync is not listed as an edit
  "waiting for compile". (My call.)

### 2. Run provenance worked out at run start

`{{run-start.flags}}` stops baking `--mattstack-sha`, `--mattstack-dirty`
and `--pack-sha`, and adds nothing in their place. `run_start` and
`run_enter` already receive `skillDir` and derive the pack root from it
(`lib/mcp/run-tools.ts`). From that, run start works out:

- **Pack.** The pack's version from the root's `plugin.json`. Then the
  org commit on the data branch where `plugin.json` reached that version,
  which is the sync commit that holds the compiled output. The org clone
  comes from the plugin's name through the team pack path. The branch is
  the data branch (`generatedMarketplaceRef`), never the clone's checkout,
  because team packs always install from the data branch, even while the
  clone sits on a trial branch. Recorded as `<pack>=<short sha>`.
- **mattstack.** From the target's lock entry, recorded as
  `mattstack=<version>`, or `mattstack=<checkout sha>` with `pack_dirty`
  set when the lock carries one.
- **Dev pack.** A pack run from a checkout keeps today's
  `packProvenance(dirs)` path (sha plus dirty bit).

If no bump commit can be found (no org clone on this Mac, a shallow
clone), run start records `<pack>=<version>`. The console's stage-doc
panel already parses a version token; its drift row drops one today, so
it gains a version-only row.

`pack_commits` keeps its `name=value,...` shape, so the stage-doc panel
reads it unchanged and the drift row needs only the version-only row
above. The stage-doc panel now shows
the text the run actually used.

The old flags stay accepted by `rt run start`, `rt runs run-start` and
`RUN_START_FLAGS`, so a skill compiled before this change still records
its provenance. The shell path (`rt runs run-start`) has no `skillDir`.
It records what its flags and `--pack-dirs` give it, as today. (My call.)

### 3. Pinning by skill folder

Every resolve id drops its version: `acme:work`, in the opening line and
in `compiled.json`'s `id` and `covers`. `skills_resolve` gains a `dir`
argument.

The opening line is prose, never a `${CLAUDE_SKILL_DIR}` token. The
`leftover-token` lint rightly refuses that token in compiled bodies, and
in attachments, reference copies and parts files nothing would
substitute it. Following `run_start`'s `skillDir` wording, it tells the
agent to pass "the loaded skill's own directory": the skill the agent
invoked, which in a reference or parts file is the host skill. (My call.)

The reuse rule changes too. Today a held map is reused when it "covers"
the id, and a versioned id cannot match a newer version's map. With a
versionless id it could, so the opening line says to reuse a held map
only when its `folder` (which `skills_resolve` already returns) sits in
the same plugin version folder as the loaded skill's directory. Otherwise the agent resolves again. (My call.)

Resolve takes the version from the plugin cache folder that `dir` sits
in, then resolves as today.

- With `dir` missing or outside the plugin cache, resolve uses the
  installed version and returns a warning that the run is not pinned.
- An id that still carries a version (older compiled output) resolves
  as it does today.
- `ID_RE`, the `skills_resolve` tool's guards and the mcp-tools reference
  are updated for the versionless form and `dir`.

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
with a toggle that shows them. Opening a folded row shows its commits as
today, and a two-commit compare can still pick any of them.

- **Where the rule lives.** The tab's commit list is the console's own
  `/api/skills/history` (`apps/console/src/server/skills.ts`), which runs
  `git log` itself. The rule lives in rt, because the masking code is in
  `lib/skills`, which the console cannot import. A new agent-unsafe verb,
  `rt skills history-classify --pack <name> --json`, takes a list of
  shas and answers which are version-only. The history route calls it
  for the commits it lists. (My call.)
- **The rule.** Its own classifier, broader than `check`'s mask, because
  old commits carry stamps `check` never masks. A commit is version-only
  when every file it changes is identical before and after with all of
  these masked: seam `version=`, the `compiled:` header, the baked run
  flags (`--mattstack-sha`, `--mattstack-dirty`, `--pack-sha`), the
  version in every unit id (opening lines, `compiled.json` `id` and
  `covers`), a base copy's `compiled.json` `version`, the `plugin.json`
  version, `requires.json`'s `minEngine` and the lock file. (My call.)
- **Cost.** Commits never change, so each sha's answer is cached for
  good, keyed by pack and sha, in rt's cache folder. A page load
  classifies only commits it has not seen. (My call.)
- **The UI.** There is no board for this tab, so it is built live and
  iterated in the pane, then rendered in Fast Browser in light and dark
  before it counts as done. (My call, following how Packs page polish
  has been done.)

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
| mattstack plugin bump | every seam in every compiled file | `compiled.lock.json` per pack, at its next compile |
| Org base pack bump | every base copy's `compiled.json` in every pack | `compiled.lock.json` per pack |
| One fill edit | the files that inline it, plus every file's version lines | the files that inline it, plus the lock |
| Another team's sync | nothing at once, but its org sha rides into this pack's files at its next rebuild | nothing |
| Commits per sync | 2 | 1 |

Packs stay coupled only through what they really share: a change to the
mattstack plugin's or the org base pack's text still recompiles every
pack that inlines it, because that is a content change.

## Left to the builder

- The lock's exact key order.
- How run start finds the bump commit (walking `plugin.json` history on
  the data branch, the way `committedSinceBump` walks it, is the obvious
  start).
- Whether old version-bearing seams in on-disk output need a read path
  or only a recompile; anatomy must not crash on either.
- The classify verb's exact name, flags and cache file layout.
- Test coverage for: a mid-run install (resolve pins to the loaded
  folder, and a held map from the old folder is not reused), a missing
  `dir` (warns, uses installed), older compiled ids, a `--verb` compile
  (other targets' lock entries untouched), the console's drift row and
  stage doc against the new `pack_commits` values, a trial-branch clone
  (provenance still reads the data branch) and the classifier against
  real historical sync, bump and compile-only commits.
