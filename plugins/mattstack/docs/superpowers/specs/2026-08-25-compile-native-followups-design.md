# Compile-native pipeline: follow-ups design

**Date:** 2026-08-25
**Status:** ratified in conversation; implementation plan to follow
**Builds on:** `2026-08-24-compile-native-pipeline-design.md` (shipped as
rt PRs #70, #74, #75 and mattstack 0.10.x). This document changes nothing
that spec settled except where a section says so.

Five items, one plan. Each is small; together they close the gaps the first
release exposed.

## 1. `rt skills check` means "a recompile would change the artifact"

**Problem.** `check` compares the on-disk artifact byte-for-byte with an
in-memory recompile, and the artifact carries the plugin version in every
seam marker, in `metadata.compiled`, and in the `--mattstack-sha` token of
`run-start.flags` (the fallback stamps the version when the plugin root is
not a git checkout). Any mattstack bump, engine touched or not, therefore
marks every compiled verb stale, and a doc-only mattstack change forces a
pack release.

**Design.** Before comparing, both sides are masked:

- `version=<v>` in every `<!-- part: … -->` marker becomes `version=*`.
- The `compiled: "<…>"` frontmatter value becomes `compiled: *`.
- The `--mattstack-sha <token>` and `--pack-sha <token>` pairs inside the
  `run-start.flags` block become `--mattstack-sha *` / `--pack-sha *`.

Masking is a pure function in `lib/skills/compile.ts` (`maskProvenance`),
applied by `skillsCheck` to the file it reads and the body it recompiles,
for `SKILL.md` only (vendored files never carry these tokens). `--json`
uses the same comparison. `compile` is unchanged: it writes real versions,
so a pack release still refreshes them.

**Consequences.** A pack whose engines did not change reports `in-sync`
across a mattstack bump. The artifact's `compiled:` value then names an
older mattstack version than the one installed; that is true (it is the
version the artifact was compiled from) and the next real change refreshes
it. `editing-skills` loses its "any mattstack bump re-releases every pack"
rule and gains the narrower one: a bump that changed an engine, include,
or mattstack fill a pack inlines requires that pack's recompile; `check`
tells you which packs.

## 2. Fills may carry `{{include:<name>}}`, one level

**Problem.** A pack fill cannot reference a mattstack attachment at compile
time, so one team fill still resolves a mattstack path at run time through
`claude plugin list`.

**Design.** `slotText` runs a restricted substitution over the fill body
that accepts exactly one placeholder kind, `include`; any other kind is a
compile error naming the fill, the placeholder, and the line (`a fill may
carry {{include}} only`). Include targets are already required to be
slotless and placeholder-free, so an include inside an include cannot
occur. The include's marker and body are emitted inside the slot region;
its extra files vendor under the host skill's `parts/include-<name>/` and
its `${CLAUDE_SKILL_DIR}` tokens are rewritten to that directory, exactly
as for an include in an engine body. The compiler collects include names
from fill bodies as well as from the engine body when loading includes.

**Seam-marker contract note (external).** A `slot:` part may now be split
by an `include:` part: the flat sequence of markers stays valid, but a
consumer that assumes a slot region runs uninterrupted to the next
`slot:`/`step` marker must instead treat every marker as a boundary. This
note goes to the console lane's handoff file before the compiler change is
released; nothing else about the markers changes.

**Certify.** The mattstack certify gate is unchanged (fills live in packs).
`rt skills compile` is the gate for fills: a slot placeholder in a fill is
an error as above.

## 3. Pack provenance is baked: `--pack-sha`

**Problem.** `run-start --pack-dirs` records the pack's commit only when
the pack root is a git checkout; the installed plugin cache never is, so
`pack_commits` names only mattstack there.

**Design.** The compiler resolves the pack's provenance at compile time the
same way it resolves mattstack's: `gitFacts(packDir)`, falling back to the
pack's `plugin.json` version when there is no `.git`. `run-start.flags`
gains `--pack-sha <pack>=<sha>` after `--mattstack-dirty`. The engine's
`pipeline-state.sh run-start` accepts `--pack-sha <name>=<value>` and
appends it to `pack_commits` verbatim; `--pack-dirs` is unchanged and
still ORs the dirty flag when it finds a git checkout. `flag()` ignores
flags it does not know, so the compiler and the engine may ship in either
order. The previous spec's provenance section is superseded by this one.

## 4. Three leftovers

**Helpers move to `lib/skills/`.** `outDirFor`, `otherSideDir`,
`buildStageEntries` go to `lib/skills/layout.ts`; `gitFacts`,
`mattstackProvenance`, `packPluginIdentity` go to `lib/skills/provenance.ts`.
`commands/skills.ts` imports them; no behaviour change; their tests move
with them.

**`surface set <stage> --public` before the first compile.** A stage that
the manifest declares but that has never been compiled has no directory
to move. `surface set` records the entry in `surface.jsonc` and prints
`<stage>: recorded; emitted to skills/ on the next compile` instead of
erroring. `surface apply` behaves the same.

**`rt skills bind` for stage slots.** `bind` validates its target against
the verb roster ∪ the stage roster (from the manifest's `pipelines`), and
reads a stage's slot names from its typed `slots:` block. The manifest
shape already supports `"mattstack:stage-plan": { "domain": "…" }`; only
the CLI's validation widens.

## 5. Out of scope

Content hashes in seam markers (the stronger form of Section 1) and any
change to the `version=` attribute's meaning. A second level of include
nesting. Baking anything for runtime-native (`mr-board:*`) skills.

## Testing

- Section 1: unit test for `maskProvenance` (each of the three token
  forms; a file with none is returned unchanged); command test that
  `check` reports `in-sync` when only versions differ and `stale` when a
  body differs; `--json` agrees.
- Section 2: placeholder unit tests (include inside a fill inlines with a
  marker and vendors files; a slot inside a fill errors naming the fill);
  e2e fixture gains a fill carrying an include.
- Section 3: placeholder test for the baked `--pack-sha`; `pipeline-state`
  shell test for `--pack-sha` in `pack_commits` alongside `--mattstack-sha`.
- Section 4: moved tests pass unchanged; command tests for the
  never-compiled `surface set` message and for `bind` on a stage slot.
- Release proof: `rt skills check --pack <pack>` stays `in-sync` across a
  doc-only mattstack bump; a compiled `work` carries `--pack-sha <pack>=…`;
  the team fill that used `claude plugin list` no longer does.

## Release order

1. mattstack: `run-start --pack-sha` (engine), certify, bump, update.
2. rt: one PR for Sections 1-4; merge; pull the shared checkout.
3. Console handoff note for Section 2; then pack: bump, compile, check,
   push, update.
4. mattstack: `editing-skills` rule change (Section 1 consequence), tested
   RED/GREEN, bump, update -- and this time no pack release follows.
