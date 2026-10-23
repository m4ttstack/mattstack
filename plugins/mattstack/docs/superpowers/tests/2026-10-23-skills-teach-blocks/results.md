# The pack-authoring skills teach block engines: RED/GREEN

RED is the text of `editing-skills`, `extending-a-pack` (with `slots.md`),
`creating-a-pack` and `process-digraphs` before this change, which still
taught v1 slots: the three-argument bind, a `domain` slot per stage, an
engine's `SKILL.md` as its source and a `dot` graph in it. GREEN is the
same skills after it (`extending-a-pack` with `props.md` in place of
`slots.md`).

Recipe: `bun build.ts <prompt dir> <red|green> <skills root>` writes each
prompt (a header from `headers/` plus the skill's files; RED's root was a
copy of `plugin/skills` taken before the edit), then `bun run-reps.ts
<prompt dir> <empty dir> <red|green> <scenario...>` runs 5 tool-less
Sonnet reps per scenario. Outputs are in `runs/`.

## extending-a-pack: lint at ship's fast-check step

The door and the stage both need the lint at their fast-check step.

| Question | RED | GREEN |
|---|---|---|
| bind form | three arguments, `<verb> domain widgets:lint-changed` 5/5 | `<verb> <block> rules widgets:lint-changed` 5/5 |
| blocks | none: the `domain` slot | `ship/flow/domain-fast-checks` and `stage-ship/domain-fast-checks` 5/5 |
| binds both door and stage | 5/5 | 5/5 |
| keys written | `"mattstack:stage-ship": {"domain": ...}` and `"ship": {"domain": ...}` 5/5 | `"mattstack:ship/flow/domain-fast-checks"` and `"mattstack:stage-ship/domain-fast-checks"`, each `{"rules": ...}` 5/5 |
| section the rule lands in | a guessed `## Fast check` 4/5, "can't name it" 1/5 | "Run the domain's fast checks (none when unbound)" 5/5 |

Every RED call is refused by today's rt.

## extending-a-pack: undo a pipeline's override

| Question | RED | GREEN |
|---|---|---|
| call | `bind stage-evidence domain --pipeline accessibility --unset` 5/5 | `bind stage-evidence domain-rules rules --pipeline accessibility --unset` 5/5 |
| path removed | `pipelines.accessibility.bindings.mattstack:stage-evidence.domain` 5/5 | `pipelines.accessibility.bindings.mattstack:stage-evidence/domain-rules.rules` 5/5 |

## editing-skills: reword an engine step, override it for one pipeline

| Question | RED | GREEN round 1 | GREEN round 2 |
|---|---|---|---|
| file edited | `attachments/pipeline/stage-ship/SKILL.md` 5/5 | `attachments/pipeline/stage-ship/domain-fast-checks.block.md` 5/5 | same 5/5 |
| graph check | certify on the folder, reading its `SKILL.md` 5/5 | `check-dot.py --short-ids` on the compiled `SKILL.md` 5/5, but compiled with the mattstack pack's own roster, which never compiles stage-ship (5/5, 3/5 with no other route) | `check-dot.py --short-ids <scratch>/pack/attachments/stage-ship/SKILL.md` after the scratch compile 5/5 |
| pipeline bind | `stage-ship <slot> widgets:a11y-checks --pipeline accessibility`, slot unnamed 5/5 | `stage-ship domain-fast-checks <prop> ...`, prop unnamed 5/5 | `stage-ship domain-fast-checks rules widgets:a11y-checks --pipeline accessibility` 5/5 |
| certify folder | `attachments/pipeline/stage-ship/` 5/5 | same 5/5 | same 5/5 |

Round 1 left two gaps: the prop name, and where a stage compiles. The
revision names the step's `rules` prop beside the stage-copy bind, and gives
the scratch compile CI runs (`tests/graph-roster.jsonc`) with the paths a
door and a stage land at. Round 1's runs are `runs/green1-*`.

## process-digraphs: a judgment node in an engine graph

The header names `index.block.md` and the two node ids, so RED could place
the node in the right file.

| Question | RED | GREEN |
|---|---|---|
| graph language | `dot` 5/5 | Mermaid (`flowchart TB`) 5/5 |
| node line | `check_changelog [label="Check the changelog" shape=box];` 5/5 | the bare id `check_changelog` 5/5 |
| prose block | `check-changelog.block.md` (4/5; `check-the-changelog.block.md` 1/5) | `check-changelog.block.md` 5/5 |
| its frontmatter and title | frontmatter guessed or copied from a sibling (`name`/`description` 2/5), title `### Check the changelog` 5/5 | `node: check_changelog`, title `# Check the changelog` 5/5 |
| edges | `dot` edges 5/5 | `commit_named_files --> check_changelog`, `check_changelog --> domain_fast_checks` 5/5 |
| check-dot runs on | `index.block.md` 5/5 | the compiled `SKILL.md` 5/5 |

## creating-a-pack: the first rule for one step

| Question | RED | GREEN |
|---|---|---|
| how the rule reaches the step | the fill keys a section to the step's node text 5/5 | the fill carries only the rule; the pack binds it to the step's block 5/5 |
| binding entry | `{"ship": ...}` 4/5, `{"mattstack:ship": [...]}` 1/5, each flagged as a guess | `"mattstack:stage-ship/domain-fast-checks": {"rules": "widgets:lint-changed"}` 5/5 |
| hand-off | `mattstack:extending-a-pack` 5/5 | same 5/5 |

The GREEN entry is the skill's own example, which happens to use the same
block and fill as the scenario, so that row shows the agent read the
example, not that it derived the key.

## Verdict

Every RED scenario failed on the change's subject: the slot-shaped bind,
an engine's `SKILL.md` as its source, and `dot` and `###` sections for an
engine graph. GREEN answers with the block and prop form in every rep,
after one revision of editing-skills.
