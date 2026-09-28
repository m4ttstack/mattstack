# Compile-native pipeline skills

Status: approved design, 2026-08-24. Implementation plan: one plan covering
repo-tools (compiler) and mattstack-skills (engines) together.

## Problem

Compiled pack verbs still make the agent resolve, at every run, facts the
compiler already knew when it built them. The compiled `work` orchestrator
inlines its own slot fill, then tells the agent to run `resolve-pipeline.sh`
(which shells into the seven slot-bearing stages' `resolve-args.sh` -- eight
stages, one slotless -- ~200 processes and nine `claude plugin list` calls
per run), to run its own `resolve-args.sh` (which
now exits with `no-slots` because compile stripped the metadata it reads), to
hand-transcribe a shell function to compute a value derivable at compile
time, and to keep two parallel state stores (`uow.json` and the run DB) with
contradictory source-of-truth claims. The stages themselves are never
compiled at all: the compiler only reaches engines with a typed `slots:`
block, and stages declare `metadata.slots` only, so each stage is read
uncompiled from the plugin cache and re-resolves its domain fill live.

The root cause is a representation mismatch. The parameterized-skills
primitive (`resolve-args.sh`, `metadata.slots`, bindings resolved at skill
time) is a runtime-resolution mechanism. Compilation was layered on top of
it without replacing it, so every compiled artifact carries both modes and
patches the contradiction with prose caveats ("in a compiled skill, do not
run resolve-args.sh"). The runtime resolvers were guarding against a world
with no compiler; with compilation as the gate, they are vestigial.

The measured burden is also growing: the `work` engine went 104 -> 135 ->
175 lines across 0.7 -> 0.8 -> 0.9, and the 0.9.0 change replaced a one-line
`run-start` with forty lines of agent-executed shell.

## Decisions (ratified)

1. **Per-stage compiled skills.** Stages compile into the pack as their own
   files. `work` stays a thin loop over a baked stage list. Not a monolith.
2. **Zero runtime resolution.** A compiled artifact is trusted completely.
   No manifest discovery, plugin listing, chain check, binding resolution,
   or version guard at run time. Drift is `rt skills check`'s job at build.
3. **Work type is baked.** One declared type: the compiled skill states it
   and moves on. Several: the compiled skill carries a menu of the declared
   types and asks one question.
4. **`uow.json` is retired.** The run DB is the single state store. The
   `~/.mattstack/work/<id>/` directory survives for evidence artifacts.
   Verified: no code reads `uow.json`. The only references outside the
   engines are prose in two team-pack domain fills (a plan-policy fill and a
   gates fill) that tell the agent to write to or read the record; those
   fills inline into compiled stages, so they are migrated too (Section 5).
5. **Compile-native representation.** Engines the compiler owns are written
   with placeholders that only the compiler can fill. Run raw, they visibly
   do not work. This is a correctness property, not tidiness: a stale or
   half-resolved artifact can no longer masquerade as a working one.

## Section 1: the placeholder contract

One syntax, `{{name}}` or `{{name:arg}}`, eight kinds, no logic:

| Placeholder | Fills with |
|---|---|
| `{{slot:<name>}}` | The bound fill's body, inlined in place. Replaces today's append-after-body. Unbound optional slot substitutes an empty string. Obeys the surface rule below. |
| `{{include:<attachment>}}` | A named attachment's body, inlined in place. Like a slot with the target fixed by the author instead of bound by the consumer. Closes the relative-path back channel (`../../../attachments/<x>/SKILL.md` and `../<sibling>/SKILL.md`) that engines use today. **An include target must be slotless**: the compiler errors if the target declares slots or contains a placeholder. No recursive expansion. |
| `{{pipeline.stages}}` | The resolved stage lists, keyed by work type: for each declared type, its ordered stages with name, stage token, sibling path, produces, consumes. A fenced JSON block `work` reads by the chosen type. With one declared type the block has one key. |
| `{{work-type}}` | One type: a literal "The work type is `feature`. Continue." Several: a structured menu of the declared types plus the instruction to ask one question; the answer selects the key in `{{pipeline.stages}}` and `{{run-start.flags}}`. |
| `{{stage.fields}}` | For a stage, its own consumes/produces as prose, from frontmatter. |
| `{{stage.dir}}` | Inside a compiled stage, the stage's own directory as a path relative to the orchestrator: `${CLAUDE_SKILL_DIR}/../../attachments/stage-<name>`. Stages are read as sibling files, not invoked, so `${CLAUDE_SKILL_DIR}` still names `work`'s directory while a stage body is followed; a stage addresses its vendored scripts as `{{stage.dir}}/parts/<slot>/...`. |
| `{{run-start.flags}}` | The static fragment, keyed by work type like `{{pipeline.stages}}`: `--repo <key> --work-type <t> --pipeline <name> --mattstack-sha <sha> --mattstack-dirty <0\|1>`. The two mattstack values are one per compile, not per work type, and are repeated in every key. `--pack-dirs` is not baked (see below). |
| `{{compiled-from}}` | Provenance, the value of today's `metadata.compiled`: pack and mattstack versions plus every binding. The emitted frontmatter **key stays `metadata.compiled`**; the placeholder only names the value. Also the only version stamp; there is no separate version placeholder. |

`--repo <key>`: the manifest key of the pack's repo. A pack serves one
manifest; the compiler takes the key from the manifest it compiled against
(`--manifest`, else the default-manifest rule already in `rt skills
compile`) and errors, not guesses, if that rule finds more than one
candidate.

Pack provenance is split into a path and a sha, because they travel
differently. The pack root is a build-machine absolute path; baking it
into a distributed pack would give teammates wrong paths, and
`pack_provenance` skips a non-git directory silently, so the failure would
be silent loss of provenance -- the one thing that flag exists to
guarantee. So the pack root is derived at run time by one skill-relative
line, `cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P` (the compiler always emits
a compiled target two levels below the pack root), and passed as
`--pack-dirs`. An installed plugin cache is not a git checkout, so this
derivation records pack provenance only when the pack runs from a git
checkout; the mattstack sha is baked at compile time regardless. The
mattstack root is never under the pack checkout (the
plugin cache is a separate tree on every machine), so a path to it cannot
be derived from the skill; instead the compiler bakes the mattstack **sha**
-- a content fact, safe to distribute -- and whether the mattstack tree
was dirty at compile time, into two new `run-start` flags,
`--mattstack-sha <sha> --mattstack-dirty <0|1>`, carried inside
`{{run-start.flags}}`. `pipeline-state.sh` records the sha as
`mattstack=<sha>` inside `pack_commits` and ORs the dirty bit into
`pack_dirty`. New flags, not a run-DB schema change. No `git_root_of`
function, no loop over resolved fill paths, and no loss versus today: the
runtime loop fed the mattstack checkout to `pack_provenance`, which
captured its sha and its dirty state; both are still captured, at compile
time instead of by walking fill paths. (Dirty-at-compile matters on an
estate with dev-mode plugin swaps.)

Invariants:

- **Any placeholder left unfilled is a hard compile error** naming the
  placeholder, engine, and line. A raw engine file contains literal
  `{{slot:...}}` text and no resolver call; it cannot run.
- No escaping, no conditionals, no loops inside placeholders. Any case that
  needs logic becomes a new placeholder kind computed in the compiler.
- Executable-valued slots (`forge` -> `ci-forge.sh`, `accounts` ->
  `pick-account.py`) vendor to `parts/<slot>/` as today. In a verb the fill
  prose addresses them as `${CLAUDE_SKILL_DIR}/parts/<slot>/...` (today's
  rewrite); in a stage, as `{{stage.dir}}/parts/<slot>/...`. The same
  applies to a stage's **own** step scripts (`scripts/ci-watch.sh` and the
  like): inside a compiled stage the compiler rewrites every
  `${CLAUDE_SKILL_DIR}/` reference in the body to `{{stage.dir}}/`, so both
  vendored and step-owned scripts resolve to the stage's directory.
- **Permission rules for stage scripts live in `work`'s `allowed-tools`**,
  because nothing loads a stage's own frontmatter when it is read as a
  file. The compiler unions every emitted stage's rules into the
  orchestrator's frontmatter, **rewriting each `${CLAUDE_SKILL_DIR}/`-
  anchored rule to the leading-wildcard form** the convention already
  prescribes for cross-directory scripts (`Bash(*/scripts/ci-watch.sh:*)`).
  Copied verbatim the rules would match `work/scripts/...` while the real
  command string is `.../attachments/stage-<name>/scripts/...`, and every
  call would prompt. The forge fill already uses the wildcard form and
  declares no rules of its own, so it needs no rewrite.
- **The surface rule** applies to both `{{slot}}` and `{{include}}`
  (Section 2): an internal attachment inlines; a registered public skill
  becomes an "invoke `<name>`" line so the public skill stays singly
  canonical. This is `buildBody`'s existing registered-skill rule, kept.

### Seam markers (preserved contract)

The console's compiled view, version timeline, seam-aware compare, and
copy-agent-context are built on machine-readable seam markers the compiler
writes into each committed compiled `SKILL.md`. In-place placeholder
substitution must not drop them. The contract is kept, and extended by
one kind:

```
<!-- part: step source=<plugin>:<name> version=<v> path=<p> lines=<a>-<b> -->
<!-- part: slot:<slot> binding=<plugin>:<fill> version=<v> path=<p> lines=<a>-<b> -->
<!-- part: include:<attachment> source=<plugin>:<attachment> version=<v> path=<p> lines=<a>-<b> -->
```

Every inlined region carries five facts: **kind** (`step`, `slot:<name>`,
or the new `include:<name>`), **ref** (`source=` for step and include,
`binding=` for slot), **source version**, **source path** (plugin-relative,
`relative(<plugin root>, skillMdPath)`, per region), and **source line
span** (1-indexed inclusive, measured in the source file from
`bodyStartLine`, never in the compiled output). Placeholder expansion is
where the compiler knows the fill's `bodyStartLine` and length, so the
marker is emitted at substitution time exactly as `buildBody`/`span()` do
today; the marker precedes the region it introduces. The contract applies
**per compiled file**: `work` and every emitted stage carry markers, so a
stage's provenance reads the same way a verb's does. Markers are comments,
invisible to the agent, and `stripCompilerComments` keeps excluding them
from lint. A region split into two includes around a `{{slot}}` (the
review-verb case in Section 2) carries two `include:` markers with their
own spans. Source-coordinate spans are the non-negotiable semantic: the
console attributes a diff hunk to the seam whose span contains it, which is
meaningless in compiled coordinates.

The regions a non-inlined placeholder produces (`{{pipeline.stages}}`,
`{{work-type}}`, `{{stage.fields}}`, `{{stage.dir}}`, `{{run-start.flags}}`)
are compiler-generated text with no source file, so they carry no marker;
they are part of the enclosing `step` region.

## Section 2: stage compilation and the surface

**One declaration form.** Everything the compiler owns declares typed
top-level `slots:` and `type: pipeline-step`. The eight stages are promoted
to this form. The duplicated `metadata.slots` / `slot-<name>` grammar is
removed from compile-native engines; it existed only to feed the runtime
resolver.

**Stages come from the manifest, not the verb roster.** The compiler derives
the stage set as the union of every stage named in the manifest's
`pipelines` map. Stages are not verbs and never appear in `stubs.jsonc` or
the slash menu. A stage no pipeline names is not emitted.

**Stages are emitted to `attachments/stage-<name>/`**, the internal side of
the pack. This reconciles with `rt skills surface`, whose single authority
is positional: `surface.jsonc`'s `public` list decides whether a directory
lives under `skills/` (registered, slash-invocable) or `attachments/`
(internal). "Reached only through the pipeline" is exactly the internal
side in the surface's own vocabulary; no new frontmatter flag is
introduced. A user who wants a stage slash-invocable runs
`rt skills surface set stage-<name> public`, the existing mechanism.

`{{pipeline.stages}}` resolves each stage to a sibling path inside the pack
(`${CLAUDE_SKILL_DIR}/../../attachments/stage-<name>`), so `work` opens a
known file with no lookup.

**The compile gate must change; this is the load-bearing compiler edit.**
Today `skillsCompile` hardcodes every output to `skills/<name>/` and, for a
roster entry not in `surface.jsonc`'s public list, does not compile it at
all -- it logs "internal ... (not compiled)" and deletes the directory.
`skillsCheck` has the same path and the same skip. Under that gate, every
stage would be skipped and deleted, never emitted; and two internal verbs
that exist today (`self-review`, `receive-review` are in `stubs.jsonc` but
not public) have no compiled artifact anywhere, so making their engines
inert-when-raw without this change leaves them permanently non-functional.
The change: an internal compile target is **emitted to
`attachments/<name>/`**, not skipped; a public one to `skills/<name>/`; and
when a name flips sides the compiler removes the stale copy on the other
side (`writeCompiledVerb` today clears only its own output dir).
`skillsCheck` follows the same placement. A visible consequence on first
compile: the four internal roster verbs that are deleted today
(`checkout`, `checkout-and-open`, `map-open-mrs`, `sync-open-mrs`) start
being emitted under `attachments/`. That is the intended behavior, not a
regression, and the resulting pack diff should be read that way.

Other compiler touch points:

- **Stage identity.** Manifest-derived stages have no `stubs.jsonc` entry.
  Their `VerbDef` is synthesized: `name` and `engine` are the stage name;
  `description` is taken from the stage engine's own frontmatter
  `description`, which every stage already carries.
- **Default visibility.** `defaultPublicSet` (used when a pack has no
  `surface.jsonc`) unions skills and verbs; it must not union stages, or a
  pack without a surface file would default every stage to public and put
  them in the slash menu. Stages default internal; only an explicit
  `surface.jsonc` entry makes one public.
- **`classify()` and `readVerbRoster`** union in manifest-derived stages so
  a never-yet-compiled stage classifies as `compiled`, not `hand-authored`,
  and `surface apply` never `git mv`s it.
- **`lintReferences`** warns on any `${CLAUDE_SKILL_DIR}/...` token that is
  not an emitted file. The sibling paths in `{{pipeline.stages}}` and
  `{{stage.dir}}` are emitted by the same compile, so the lint treats a path
  that resolves to an emitted stage directory as satisfied rather than
  warning once per stage per compile.

**Chain validation moves to compile.** `rt skills compile` folds
produces/consumes over the pipeline order against the fixed seed exactly as
`resolve-pipeline.sh` does today, and refuses a broken chain. The compiled
`work` never re-checks.

**The runtime-native carve-out.** Skills that genuinely resolve at skill
time stay on the existing `resolve-args.sh` primitive, untouched:
`mr-board:review`, `mr-board:respond`, `mr-board:doctor` (model-invocable
slash wrappers with required slots, launched by the board).

`review-core` and `review-dispatch` are **dissolved**, not converted. They
are slot-bearing wrappers today (`review-core` binds `criteria`; the
manifest binds it to the same fill the `review` verb binds), but they are
not verbs in any roster and not manifest-derived stages, so nothing would
ever compile them -- kept as compile-native engines they would be
permanently inert files. Including them is also ruled out: it would drag a
`resolve-args.sh` call into a compile-native engine, or require
`{{include}}` to expand recursively and resolve a nested engine's slots
against a second manifest key, which it does not do. So:

- Each body **minus its slot** becomes a slotless shared attachment
  (`review-core-body`, `review-dispatch-body`), a legitimate `{{include}}`
  target.
- The slot declarations (`criteria`, `reviewer`) and their `{{slot:...}}`
  placement move **up** into the verbs that reach them today by relative
  path: `review`, `self-review`, `receive-review`. Where the shared prose
  is interrupted by the slot, the attachment is split into two includes
  around the verb's `{{slot:...}}`; the compiler needs no new machinery
  for this.
- The `criteria` fill is bound once per verb, so nothing is duplicated.
- `review-posting` is slotless with no `provides` and reaches these two by
  the `../<sibling>/` back channel; it becomes a plain include target.
- The two original directories, their `resolve-args.sh`, and their
  `metadata.slots` are deleted once the plan confirms nothing invokes
  them directly.

The rule, recorded in `convention.md`: **a skill is compile-native
(placeholders, inert raw) or runtime-native (`resolve-args.sh`, never a
placeholder), never both.** The compiler errors on a `resolve-args.sh`
call inside a compile-native engine; the certify gate errors on `{{` inside
a runtime-native one.

## Section 3: the runtime contract

The whole job of a compiled `work` run:

1. **Start the run with one command.** The compiled skill carries
   `"$RT_PIPELINE_STATE" run-start {{run-start.flags}} --pack-dirs
   "$PACK_DIRS"`, where `{{run-start.flags}}` already carries
   `--mattstack-sha` and `--mattstack-dirty` (baked, Section 1) and
   `PACK_DIRS` comes from the single skill-relative line in Section 1,
   `cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P` (no `git_root_of`, no loop
   over fill paths); the agent adds only
   `--ticket <id>` (when named) and `--spawned-by "<surface>"` (when
   spawned). The script computes the pack's HEAD/dirty state itself. It
   returns `runDb`; the agent exports `RT_RUN_DB`. The
   account-pool decision back-fill is unchanged (per-run, spawn-time).
   `run-start --ticket` is a small addition to `pipeline-state.sh`: it
   writes the ticket field only when given a value, never fabricated.
2. **Walk the stages.** For each baked entry: `stage-start`, read the
   compiled sibling stage, follow it, verify every `produces` field is
   non-null in the run DB via `snapshot`, then `stage-done` or
   `stage-fail --reason`. No resolver re-run, no "must agree" check.
3. **One state record.** All `uow.json` prose and the stages' double-writes
   are deleted; each stage writes results once via `field set`.
4. **One resume protocol.** The DB one: newest `running` run under
   `~/.mattstack/runs/<repo>/`, `snapshot`, confirm with the user, re-enter
   at `run.current_stage`. The uow-based protocol is deleted.
5. **Close** with `run-status done|failed|abandoned`, unchanged.

Not runtime anymore: manifest discovery, `claude plugin list`, chain
validation, binding resolution, work-type selection when single, and the
`git_root_of` / fill-path loop for pack dirs. A compiled `work` never shells
out to `resolve-pipeline.sh` or `resolve-args.sh`, and neither script is
vendored into it. What stays runtime is exactly what varies per run or per
machine: the ticket, who spawned the run, the run id, and the pack roots'
current HEAD and dirty state.

## Section 4: build-time checking and tests

`rt skills compile` refuses to build when:

- a placeholder is left unfilled;
- a required slot is unbound or its binding provides the wrong contract
  (already enforced);
- the stage chain is broken;
- a compile-native engine calls the runtime resolver, or a runtime-native
  skill contains a placeholder.

Every refusal names the engine, line, and reason. `rt skills check` keeps
its purpose (drift against the installed mattstack, hand-edited compiled
files) and now covers stages.

Tests. Compiler: unit tests in `lib/skills/__tests__` for placeholder
substitution, the unfilled-placeholder error, chain-validation error, stage
emission to `attachments/`, **stale-side removal when a name flips
public/internal** (the failure most likely to go unnoticed: a working
artifact on both sides, one stale), the `{{stage.dir}}` body rewrite and
the leading-wildcard `allowed-tools` union, include-vs-public referencing,
the slotless-include-target error, the surface `classify` change, and
**seam markers**: every inlined region in a compiled verb and in a compiled
stage carries a marker of the right kind with a plugin-relative path and a
source-coordinate span that matches the fill's real `bodyStartLine`, and
the new `include:` kind parses with the same five facts. Engines: the existing certify and purity gates, plus one
end-to-end proof: compile a real team pack, `rt skills check` clean, and
the compiled `work` and every stage contain zero `resolve-args` /
`resolve-pipeline` references and zero `{{`.

## Section 5: migration order

Each step leaves the estate working.

1. **Compiler** (repo-tools): placeholders, the compile-gate change
   (internal targets emitted to `attachments/`, stale side removed), stage
   emission from the manifest with synthesized `VerbDef`, chain check,
   `defaultPublicSet` / `classify` / `readVerbRoster` changes, the
   `lintReferences` allowance, and unioning stage `allowed-tools` into
   `work`. Backward compatible: an engine with no placeholders compiles
   exactly as today.
2. **Engines** (mattstack-skills): convert `work`, the eight stages, `ship`,
   `watch-ci`, `review`, `self-review`, `receive-review`, `shepherdr`. Add
   placeholders; delete resolver prose, `uow.json` prose, the relative-path
   reads, and the compiled-mode caveats; promote stages to typed slots.
   Dissolve `review-core` and `review-dispatch` into slotless shared
   attachments per Section 2, lifting their slots into the three review
   verbs; make `review-posting` an include target. Add `run-start
   --ticket`, `--mattstack-sha`, and `--mattstack-dirty` to
   `pipeline-state.sh`. Confirm nothing invokes
   `review-core` / `review-dispatch` directly before deleting them.
   Retire the unit-of-work record everywhere it is documented: the
   "Unit-of-work record" section of `convention.md`,
   `plugin/schemas/uow.md`, `plugin/schemas/uow.schema.json`, and the
   README entry -- the estate's rule is that docs assert current mechanics,
   so a retired store is not left described. Add the compile-native /
   runtime-native rule to `convention.md`.
3. **Team pack** (the pack repo): edit the two domain fills that instruct
   writes to or reads from the uow record (the plan-policy fill and the
   gates fill) so they refer to the run DB fields instead. These fills
   inline into compiled stages, so without this a compiled stage would
   carry contradictory instructions.
4. **Runtime-native skills untouched**: `mr-board:*`.
5. **Release**: bump mattstack, `claude plugin update mattstack@mattstack`,
   `rt skills compile --pack <pack>`, bump and push the pack,
   `claude plugin update <pack>@<marketplace>`. Then run one real `work`
   end to end and confirm the invocation is visibly faster than before.

## Out of scope

- New pipeline semantics. Several declared work types are supported by
  keying `{{pipeline.stages}}` and `{{run-start.flags}}` by type and
  selecting through `{{work-type}}`'s menu; anything beyond selecting among
  declared types is out of scope.
- Any change to the run DB schema. The three new `run-start` flags
  (`--ticket`, `--mattstack-sha`, `--mattstack-dirty`) write to existing
  columns.
- The `mr-board:*` wrappers and the board's launch contract.
