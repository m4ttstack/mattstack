# Remove a pipeline override, and pick the pipeline when rebinding

Status: draft, 2026-10-16. Ticket: RT-493. Follows RT-491 (per-pipeline bindings, `docs/superpowers/specs/2026-10-16-per-pipeline-bindings-design.md`).

## Why

RT-491 lets a pipeline override a stage's fill (`rt skills bind stage-evidence domain acme:b --pipeline accessibility`). Nothing removes an override after that:

- Neither `rt skills bind` nor console can take one away. Binding the override back to the default's value leaves it in place, and it then shadows every later change to the default. The only way out is a hand edit of `pack/skills.jsonc`.
- Console's rebind drawer always writes to the pipeline the graph is showing. From the `accessibility` view you cannot change the default fill. From any view you cannot clear an override. RT-491's spec asked for a pipeline choice in the drawer, and the build narrowed it to "the graph's pipeline".

## Goals

1. `rt skills bind` can remove a pipeline override, and that leaves the pack exactly as if the override had never been written.
2. Console's rebind drawer lets you choose which pipeline a change goes to, and clear an override.

## Non-goals

- Removing a default (top-level) binding. That is a different operation, and unbinding a required slot breaks the default pipeline. `--unset` always needs `--pipeline`.
- Removing an override that a lower layer sets (an org base pack or the override layer). Bind writes only this pack's fragment.
- A picker flow for `--unset`. The interactive picker stays as it is: bind with a fill.
- Anything about `--` in pipeline names, or the other RT-491 leftovers. RT-494 owns those.

## Anti-goals

- An unset that leaves a different pack than one that never had the override, whether that is a stray `{ "stages": [...] }`, an empty `bindings`, or a copy left on disk.
- A drawer that silently writes to a pipeline you did not mean.

## Decided by Matt

- **Drawer default target:** opened from a specialized pipeline's view (e.g. `accessibility`), on a stage that pipeline lists, the drawer targets that pipeline's own fill. A switch moves it to the default every pipeline shares.
- **Last override removed:** the pipeline goes back to a plain stage list in the fragment. `{ "stages": [...] }` with no `bindings` never stays behind.
- **Process:** spec, plan, then a subagent-driven build, as with RT-491.

## My calls (for Matt to check)

These are mine, not Matt's; each is cheap to reverse.

- The flag is `--unset` on `rt skills bind`, as the ticket proposed, rather than a new verb.
- `--unset` needs `--pipeline`: removing a default binding stays out of scope.
- Bind removes only an override this pack's own fragment sets, never one from a base or override layer.
- No picker flow for `--unset`.
- `--json` reports the fill the slot falls back to as `to`, plus `"unset": true`.
- The drawer shows the pipeline choice only on a stage slot that a non-default pipeline lists.
- The refusal wording below.
- **On the default pipeline's view** (e.g. `feature`), the drawer keeps today's behavior. It preselects Default and does not offer the default pipeline as a separate choice, unless that pipeline already overrides the slot. In that case the override is offered and preselected, so it can be changed or cleared.
- **A compiled stage copy** (`<stage>--<pipeline>`) opened in the drawer stays pinned to its own pipeline, with no choice shown, as today. "Use default" is offered there.
- **The banner's "to the default" wording is console's job.** rt's `changes` payload stays as it is: a removed override is `{ pipeline, from: <override>, to: null }`. Console renders `to: null` on a pipeline change as falling back to the default fill it reads from the composition's top-level bindings. No rt envelope or signature changes.
- **A lower layer's override under this pack's.** Provenance names only the winning layer, so the "comes from another layer" refusal does not see a lower layer that sets the same key. In that case the unset proceeds. rt reads the regenerated manifest and reports in `to` the fill the slot really reads now. The human output adds a note that `<layer>`'s override still applies, and the copy stays, correctly. Console's confirm modal says it removes this pack's override, and names the default fill only as what the slot falls back to "if no other layer overrides it".
- **Manifest-only write paths** (fixture mode, a pack whose fragment is the manifest, a pack with no fragment): the unset also removes the matching `//   <pipeline>/<ref> <slot> <- <layer>` provenance header line, so the manifest reads as if the override were never written. The byte-identical acceptance test runs through the real materialize path.

## rt: `rt skills bind --unset`

```
rt skills bind <verb> <slot> --pipeline <name> --unset [--pack ...] [--json] [--dry-run]
```

Behavior:

1. The usual bind resolution and refusals all apply as they do for `--pipeline` today: the pipeline must be declared and well named, the verb must be a stage (not a compiled copy) that the pipeline lists, and the slot must exist on the stage.
2. New refusals, checked before any write:
   - `--unset` without `--pipeline`: `--unset removes a pipeline override; name the pipeline with --pipeline`.
   - `--unset` with a fill positional: `--unset takes no fill`.
   - No override at that slot in the merged manifest: `<pipeline> has no override for <verb>.<slot>`.
   - The override comes from a layer other than this pack (manifest provenance for `pipelineBindingKey(pipeline, engineRef, slot)` names a base or override layer): `<pipeline>'s override for <verb>.<slot> comes from <layer>; remove it there`.
3. The edit removes `pipelines.<p>.bindings.<engineRef>.<slot>` from the fragment, using jsonc-parser removals so comments elsewhere in the file survive. It then removes `bindings.<engineRef>` if that is now empty, and `bindings` if that is now empty. If the pipeline is then `{ "stages": [...] }` and nothing else, it is rewritten as the plain list. Comments inside that one pipeline's value may be lost; comments elsewhere are kept.
4. After the edit: materialize, then recompile the same way a bind does. A stage bind recompiles the whole pack, so the copy sweep removes `<stage>--<pipeline>` once that pipeline's fills match the default again.
5. Output:
   - Human: the bind line reads `<pipeline>: <verb>.<slot>  <old> -> <default fill or (unbound)>`, plus a note that the override was removed.
   - `--json` keeps today's bind envelope keys, plus `"unset": true`; `to` is the fill the slot now reads (the default's, or `"(unbound)"`).
   - `--dry-run` prints the same line without writing.
6. When the edit lands but materialize fails, behavior matches bind today: the fragment stays edited, nothing is recompiled, exit 1, and the output says to run `rt skills materialize`.

## Console: pipeline choice and "Use default"

The rebind drawer (`apps/console/src/app/wiring/graph/drawer/`) gains:

1. **A pipeline choice**, shown only for a stage slot whose stage at least one non-default pipeline lists. The options are "Default" plus each non-default pipeline that lists the stage. The default pipeline joins them only when it already overrides the slot. The preselection follows Matt's ruling: a specialized pipeline's view preselects that pipeline when it lists the stage. The default pipeline's view and every other case follow "My calls" above. A work verb's own slots (e.g. `work-a11y`'s `tiering`) show no choice and always write the default, as they do today.
2. **The facts, current fill, choices, command preview and note** all follow the chosen pipeline: the current fill shown is that pipeline's effective fill, and the command preview carries `--pipeline <name>` only when a pipeline is chosen.
3. **"Use default"**, on a slot the chosen pipeline overrides. It confirms through `modals.confirm`, naming the override and the default fill it falls back to, then calls the bind route with `unset: true`. The pending-changes banner then shows the change as `<slot> · <pipeline>`, going from the override's fill to the default's, like any other binding change.
4. **Server:** `POST /api/skills/bind` accepts `unset?: boolean`. With `unset`, `pipeline` is required and `fill` must be absent. The route checks the verb, slot and pipeline against the composition as it does today, then runs `rt skills bind <verb> <slot> --pipeline <p> --unset --pack <pack>`. A request with `unset` and no `pipeline`, or with a `fill`, gets a 400 before any spawn.
5. Under a fixture scenario the server refuses every write, as today. The design fixture gains whatever state the drawer needs to draw the choice and the "Use default" action.

## Docs and skills

- The bind reference partial documents `--unset`, its refusals, and the plain-list collapse.
- The `extending-a-pack` recipe "Add a specialized pipeline" gets one line on removing an override.
- The `rt skills bind` usage line and `lib/command-tree-def.ts` gain `--unset`.

## Acceptance

- `--unset` on an override this pack sets removes it from the fragment and keeps comments elsewhere. After the bind, the `<stage>--<pipeline>` copy is gone and `rt skills check` is clean.
- Each refusal in the list above writes nothing and exits non-zero with its message.
- When the last override goes, the fragment holds a plain list, and the generated manifest is byte-identical to the same pack with that override never written. The test compares against a fixture that never had it.
- Bind's `--json` envelope stays additive (`skills-json-frozen` unedited).
- Console: from the `accessibility` view, the drawer on `stage-evidence`'s `domain` preselects `accessibility`. Switching to Default changes the default fill. "Use default" clears the override. Both show as pending changes and sync.
- A work verb's own slot shows no pipeline choice.
- The UI is checked in Fast Browser in light and dark.

## Left to the builder

- Control choice for the pipeline picker (SegmentedControl vs Select), following `docs/apps/ui-authoring.md` and what the drawer already uses.
- Exact copy for the confirm modal and the note under the bind line, within the rules in `.claude/rules/output-layer.md` and the console copy style.
- Where the unset edit lives (inside `applyBind` or a sibling), as long as refusals run before any write.
