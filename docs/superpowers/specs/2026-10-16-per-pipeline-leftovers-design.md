# Per-pipeline bindings leftovers

Status: draft, 2026-10-16. Ticket: RT-494. Follows RT-491 (`docs/superpowers/specs/2026-10-16-per-pipeline-bindings-design.md`) and RT-493 (`docs/superpowers/specs/2026-10-16-unset-pipeline-override-design.md`).

## Why

RT-491 and RT-493 shipped with small rough edges. The reviews found them and judged each safe to ship. None breaks a run, but several mislead the person reading console or rt's output, and one (`--` in a pipeline name) could make two stage copies collide.

## Goal

Every item below is fixed with a test, or closed with a one-line reason in the PR.

## Non-goals

- New features. Each item corrects or completes something that already ships.
- Problems older than RT-491: Escape on a drawer confirm closing the drawer, and the design fixture answering writes as a no-op success.

## Items

### rt

1. **`--` in a pipeline name.** Refuse a pipeline name containing `--` for a pipeline that carries overrides or that a work verb names, with `pipeline "<name>" must not contain "--"`. Check it wherever `PIPELINE_NAME_RE` is checked today: materialize's shape check, `stageRoster`, check and compile's pipeline errors, and bind's `--pipeline`. Plain-list pipelines stay unchecked.
2. **`compile --json` lists removed copies.** The compile envelope carries `removedCopies: string[]` only when non-empty (additive, like `staleCopies`).
3. **Typo'd ref warning.** A dropped override whose engine ref no pipeline layer ever listed warns ``${key} from ${layer} is ignored: the pipeline does not list that stage``. "No longer lists that stage" stays for a stage a higher layer removed.
4. **Schema accepts `""` in pipeline bindings.** In `skills-manifest.schema.json`, a pipeline's `bindings` values accept a fill name or `""`. Top-level bindings keep today's pattern.

### Console

5. **Health tab shows stale copies and dropped overrides.** When `check` reports `staleCopies` or `droppedOverrides`, the Health tab lists them and does not read "in sync". The wording follows rt's: `stale stage copy <name>: run rt skills compile`, and the dropped-override line.
6. **Runs page title and timeline follow the pipeline filter.** The title names the filtered pipeline (`web · accessibility pipeline runs on this Mac`). The timeline view shows the pipeline filter control and names it in its title.
7. **Links on a non-first pipeline's canvas keep that pipeline.** A stage link card, or a Used-by site, opens the step under the canvas's current pipeline (`<engine>@<workType>`) when that pipeline lists it. Otherwise it opens the first pipeline's step.
8. **Unsynced marking under a non-default pipeline.** An override's pending change is marked unsynced when its engine is shown under that pipeline without a copy. `shownPipeline` matches `target?.pipeline ?? workType`, the same as `slotFactsOf`.
9. **Stage copy labels.** A copy's link-card title and rendered-card title read `<stage short name> · <pipeline>` (e.g. `evidence · accessibility`), with the full `stage-evidence--accessibility/SKILL.md` kept in a tooltip or the drawer header.
10. **Rebind note for a default stage bind.** It says the bind rebuilds every skill in the pack, matching rt, which recompiles the whole pack for a stage bind.
11. **Another pack's copy for an uninstalled pack.** `stageDoc` prefers the run's own pack by name before any `rel` match, so a run whose pack is not installed locally never reads another pack's copy.
12. **Work binder names the right verb.** Composition's binder for a shared engine names the verb that runs the default pipeline (or has no `pipeline`), not the last verb listed. Used by then says `work`, not `work-a11y`.
13. **"comes from your override" wording.** For the override layer, the drawer line reads `This override comes from the override layer; remove it there.`. Other layers keep `layerLabel`.
14. **A design fixture scenario for a base-layer pipeline override.** Add a scenario (in `scenarios.ts`) whose composition has an `accessibility` override from `base:acme-base`. The drawer's "comes from" line can then be drawn and parity-checked without editing the fixture.

### Docs

15. **`check.mdx` lists the missing errors:** `verb "<v>" names no pipeline and the manifest declares several with none named feature`, and `pipeline "<p>" has bindings but no layer gives it stages`.
16. **RT-491 spec matches the code.** Rewrite spec lines 156-157: an override naming a stage that the layer setting the pipeline's stages does not list fails materialize. A lower layer's override for a stage a higher layer still lists is kept.

## My calls (for Matt to check)

- The refusal for `--` (item 1) applies only to pipelines that carry overrides or that a work verb names, like the existing name rule. That keeps "no migration" for plain lists.
- `removedCopies` (item 2) is a new optional envelope key, not a reuse of `staleCopies`.
- The copy label (item 9) is `<stage> · <pipeline>`, matching the sidebar's `work-a11y · accessibility` style.
- Item 12 picks the default pipeline's verb. With no default (several pipelines, none `feature`), it picks the verb with no `pipeline` field, else the first verb listed.
- The new fixture scenario is named `pipeline-base-override`.
- **Item 8's matching rule:** a pending change is marked unsynced when its `pipeline` equals the shown pipeline (`target?.pipeline ?? workType`). A default change (`pipeline` null) also matches on any pipeline's canvas whose pipeline does not override that slot. The default pipeline's canvas, where the skill compiles from the default bindings, keeps its marking.
- **Item 1 and real stage names:** a real stage named like a copy (`stage-evidence--accessibility`) already collides with the copy in compile's roster-vs-stage collision guard, which refuses the pack. This item adds a test pinning that refusal, and adds no stage-name rule.
- **Item 3 is materialize's warning only.** `check` and the generated manifest's `// dropped:` lines keep their format, so `check`, its `--json` and the Health tab (item 5) keep the generic dropped-override wording. "Never listed" means no layer's stage list for that same pipeline.
- **Item 2's `removedCopies`** is filled only when compile really removed copies: a write with no failures. `--dry-run` and a failed compile leave the key out.

## Acceptance

- Each item has a test, or a one-line reason in the PR for closing it without one.
- `commands/__tests__/skills-json-frozen.test.ts` passes unedited.
- Console changes (items 5, 6, 9, 13) are checked in Fast Browser in light and dark.
- Public repo rules hold: `acme` only, no ticket ids in shipped files.
