# Compile-native pipeline skills

Status: approved design, 2026-08-24. Implementation plan: one plan covering
repo-tools (compiler) and mattstack-skills (engines) together.

## Problem

Compiled pack verbs still make the agent resolve, at every run, facts the
compiler already knew when it built them. The compiled `work` orchestrator
inlines its own slot fill, then tells the agent to run `resolve-pipeline.sh`
(which shells into seven stages' `resolve-args.sh`, ~200 processes and nine
`claude plugin list` calls per run), to run its own `resolve-args.sh` (which
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
   Verified: no code or skill outside the pipeline reads `uow.json`.
5. **Compile-native representation.** Engines the compiler owns are written
   with placeholders that only the compiler can fill. Run raw, they visibly
   do not work. This is a correctness property, not tidiness: a stale or
   half-resolved artifact can no longer masquerade as a working one.

## Section 1: the placeholder contract

One syntax, `{{name}}` or `{{name:arg}}`, nine kinds, no logic:

| Placeholder | Fills with |
|---|---|
| `{{slot:<name>}}` | The bound fill's body, inlined in place. Replaces today's append-after-body. Unbound optional slot substitutes an empty string. |
| `{{include:<attachment>}}` | A named attachment's body, inlined in place. Like a slot with the target fixed by the author instead of bound by the consumer. Closes the relative-path back channel (`../../../attachments/<x>/SKILL.md`) that four engines use today. |
| `{{pipeline.stages}}` | The resolved, ordered stage list: name, stage token, sibling path, produces, consumes. A fenced JSON block `work` iterates. |
| `{{work-type}}` | One type: a literal "The work type is `feature`. Continue." Several: a structured menu of the declared types plus the instruction to ask one question. |
| `{{stage.fields}}` | For a stage, its own consumes/produces as prose, from frontmatter. |
| `{{pack-dirs}}` | The precomputed colon-joined pack root list. |
| `{{run-start.flags}}` | The static `--repo <key> --work-type <t> --pipeline <name> --pack-dirs "<dirs>"` fragment. |
| `{{version}}` | Pack and mattstack versions as a scalar. |
| `{{compiled-from}}` | Provenance, the content of today's `metadata.compiled`. |

Invariants:

- **Any placeholder left unfilled is a hard compile error** naming the
  placeholder, engine, and line. A raw engine file contains literal
  `{{slot:...}}` text and no resolver call; it cannot run.
- No escaping, no conditionals, no loops inside placeholders. Any case that
  needs logic becomes a new placeholder kind computed in the compiler.
- Executable-valued slots (`forge` -> `ci-forge.sh`, `accounts` ->
  `pick-account.py`) are unchanged: their scripts vendor to
  `parts/<slot>/` as today; their prose inlines through `{{slot:...}}`.
- `{{include}}` obeys the surface rule (Section 2): an internal attachment
  inlines; a registered public skill becomes an "invoke `<name>`" line so
  the public skill stays singly canonical.

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

Compiler touch points: `surface`'s `classify()` and `readVerbRoster` union
in manifest-derived stages so a never-yet-compiled stage classifies as
`compiled`, not `hand-authored`.

**Chain validation moves to compile.** `rt skills compile` folds
produces/consumes over the pipeline order against the fixed seed exactly as
`resolve-pipeline.sh` does today, and refuses a broken chain. The compiled
`work` never re-checks.

**The runtime-native carve-out.** Skills that genuinely resolve at skill
time stay on the existing `resolve-args.sh` primitive, untouched:
`mr-board:review`, `mr-board:respond`, `mr-board:doctor` (model-invocable
slash wrappers with required slots, launched by the board). `review-core`
and `review-dispatch` resolve their own slot live today; once
`{{include:...}}` inlines them into compiled `review` / `self-review` /
`receive-review`, their standalone runtime path is needed only if something
invokes them directly. The plan verifies this and folds them into the
compiled set if nothing does.

The rule, recorded in `convention.md`: **a skill is compile-native
(placeholders, inert raw) or runtime-native (`resolve-args.sh`, never a
placeholder), never both.** The compiler errors on a `resolve-args.sh`
call inside a compile-native engine; the certify gate errors on `{{` inside
a runtime-native one.

## Section 3: the runtime contract

The whole job of a compiled `work` run:

1. **Start the run with one command.** The compiled skill carries
   `"$RT_PIPELINE_STATE" run-start {{run-start.flags}}`; the agent adds
   only `--ticket <id>` (when named) and `--spawned-by "<surface>"` (when
   spawned). The script computes pack HEAD/dirty state itself from
   `--pack-dirs`. It returns `runDb`; the agent exports `RT_RUN_DB`. The
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
validation, binding resolution, work-type selection when single, pack-dir
computation. A compiled `work` never shells out to `resolve-pipeline.sh` or
`resolve-args.sh`, and neither script is vendored into it.

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
emission to `attachments/`, include-vs-public referencing, and the surface
`classify` change. Engines: the existing certify and purity gates, plus one
end-to-end proof: compile a real team pack, `rt skills check` clean, and
the compiled `work` and every stage contain zero `resolve-args` /
`resolve-pipeline` references and zero `{{`.

## Section 5: migration order

Each step leaves the estate working.

1. **Compiler** (repo-tools): placeholders, stage emission, chain check,
   surface `classify` change, `pipeline-state.sh --ticket` is engine-side
   but lands with step 2. Backward compatible: an engine with no
   placeholders compiles exactly as today.
2. **Engines** (mattstack-skills): convert `work`, the eight stages, `ship`,
   `watch-ci`, `review`, `self-review`, `receive-review`, `shepherdr`. Add
   placeholders; delete resolver prose, `uow.json` prose, and the
   compiled-mode caveats; promote stages to typed slots; add
   `run-start --ticket`. Update `convention.md` with the compile-native /
   runtime-native rule. Verify whether anything invokes `review-core` /
   `review-dispatch` directly and fold them in if not.
3. **Runtime-native skills untouched**: `mr-board:*`.
4. **Release**: bump mattstack, `claude plugin update mattstack@mattstack`,
   `rt skills compile --pack <pack>`, bump and push the pack,
   `claude plugin update <pack>@<marketplace>`. Then run one real `work`
   end to end and confirm the invocation is visibly faster than before.

## Out of scope

- Multi-pipeline support beyond what the manifest already declares (the
  menu form of `{{work-type}}` is all that is needed).
- Any change to the run DB schema beyond `run-start --ticket`.
- The `mr-board:*` wrappers and the board's launch contract.
