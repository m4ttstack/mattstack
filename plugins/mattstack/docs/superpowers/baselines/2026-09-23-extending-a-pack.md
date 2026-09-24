# Baseline: extending a pack without the skill

Run 2026-09-24 in the same clean-room guest as the creating-a-pack baseline, with the `scratch` pack present and published (zero fills), the merged rt on `main`, mattstack at `pack-authoring` (0.19.4, which had no `extending-a-pack` yet). Prompt, verbatim:

```
Our pipeline shipped an MR without running `bun run lint`. Make the pipeline always run lint before it opens an MR on this repo.
```

## What the agent did (two minutes, 29 tool calls)

1. Looked in the repo first: `.mattstack/skills.jsonc` (absent), `package.json`, `.gitlab-ci.yml`, then the installed pack's `pack/skills.jsonc` and the manifest schema doc.
2. Loaded `mattstack:editing-skills` as its guide.
3. Read the compiled `attachments/stage-ship/SKILL.md` and `stage-self-review/SKILL.md` in the pack ("I'm tracking down where the scratch pack's `work` pipeline checks things before `stage-ship` opens the MR, so I can add `bun run lint` there"), then the engine's `stage-ship` source in the plugin cache and its `{{slot:domain}}` marker, the parameterized-skills convention, and the stale `templates/domain-pack/README.md`.
4. "The `ship` stage has an optional `domain` slot that's currently empty. I'm adding a scratch-pack fill there that runs `bun run lint` before the push."
5. Wrote `attachments/ship-lint/SKILL.md` with `disable-model-invocation: true` and `metadata.provides: "ship-domain@1"`, but a description that describes the fill's job ("Ship-stage fill: run the repo's lint script and require it to pass ... Reached only through a slot binding; not for direct invocation") rather than the contract's trigger form.
6. `rt skills bind stage-ship domain scratch:ship-lint --pack scratch` (a dry run first, then live), diffed the compiled `work` skill and `pack/skills.jsonc`, confirmed the per-repo manifest and the fragment carried the binding.
7. Ran `bun install` and `bun run lint` in the test repo as a "trial lint run" (which created a stray `bun.lock` it then deleted).
8. Bumped the pack to 0.1.1, committed to the zone, pushed, tried `rt skills sync` (refused: no mattstack marketplace registered in that guest), then `claude plugin update scratch@scratch`.

Final message, verbatim (opening):

> From now on, the `work` pipeline runs `bun run lint` before it pushes a branch or opens an MR. If lint fails, the ship stage stops and nothing is pushed. It takes effect after you **restart Claude Code**, because the running session still has the old version loaded. I haven't run a full pipeline end to end, so the next real run is the first live test.

## What it got right

The right place (a fill on the ship stage's `domain` slot, not the compiled stage, not the engine, not the repo), the contract in the frontmatter, `rt skills bind`, the fragment check, a version bump, a commit and push, a plugin update, and a clear restart note.

## Where it went wrong or stopped short

- **No baseline, no proof.** It never ran the stage without the rule to see the miss, and said so itself: "I haven't run a full pipeline end to end, so the next real run is the first live test." `superpowers:writing-skills` was never loaded. The trial it did run (`bun run lint` in the repo) tests the repo's lint, not the pipeline's behavior.
- **No certification.** `tests/certify.sh <fill dir> --domain` never ran.
- **Description in the wrong form.** The fill's description explains what the fill does; the convention is the trigger-only "Use when mattstack:<engine> resolves its <slot> slot here ..." form, which certify checks.
- **Fill body restates the engine.** Steps 3 and 4 spell out the push and MR flow the stage already owns; the rule is the lint gate and its failure action.
- **Side effect in the author's repo.** `bun install` ran in the checkout to try the lint script.
- **Read the retired template** (`templates/domain-pack/README.md`) as reference, which Task 12 removes.

## With the skill

Same guest, pack reverted to zero fills, mattstack 0.19.5 (the draft skill) installed, same prompt verbatim. The agent invoked `mattstack:extending-a-pack` on its own and followed the round:

1. **Sorted the ask:** "MR preflight, a `ship-domain@1` fill on `mattstack:stage-ship` (and `mattstack:ship` if the door exists)", read `slots.md`, checked the pack's composition.
2. **RED, for real.** Dispatched a subagent to run the pipeline on a small task in an isolated worktree with a deliberate unused variable, stopping at the ship gate so nothing pushed: "The RED pass confirmed the gap. Stage-ship's only check before pushing is 'tests you have seen pass'. Nothing in the pipeline runs lint before the push, and the branch fails `bun run lint` with an unused debug variable."
3. **Wrote the fill** in the contract's form: `description: "Use when mattstack:stage-ship resolves its domain slot here; the pack manifest binds ship-domain@1 to this skill. Not for manual invocation."`, `disable-model-invocation: true`, `metadata.provides: "ship-domain@1"`, then the rule, its reason, and the decisions it changes (no `eslint-disable`, no config edits, no `--no-verify`; passing tests and reviewer waivers do not count).
4. **Bound, certified, checked:** `rt skills bind stage-ship domain scratch:ship-lint`, `tests/certify.sh <fill> --domain` from the installed plugin clone, `rt skills check`, and confirmed the fragment carried the binding.
5. **GREEN, for real:** re-ran ship on the same failing branch with the new fill: "lint failed with exit 1, the push was blocked, the code was fixed without silencing the rule, and lint exited 0 before the gate." The plugin's stop hook held the turn while the test run sat mid-stage; the agent parked the run on hold and abandoned it afterward.
6. **Published through `mattstack:editing-skills`:** noticed the daemon snapshot had already committed the fill, did the skill's full read of the compiled stage, caught a gap in its own fill (no hand-back to the generic push path) and fixed it, bumped, committed, pushed, `rt skills sync` (refused in the guest), then `claude plugin update`, and bumped again to 0.1.2 when it found the 0.1.1 cache stale from the reverted baseline attempt.

Final message opening, verbatim: "The pipeline now runs `bun run lint` before it opens an MR on this repo. The change is published to the scratch team pack as version 0.1.2 and takes effect after you restart your Claude sessions." It listed the test worktree it left behind and the sync refusal as loose ends.

Every miss from the baseline is closed: RED and GREEN ran against the pipeline, certify ran, the description is in contract form, the fill carries only the rule, and nothing ran in the author's checkout.

### Second GREEN, after review changes

Review moved the ship stop point to the push itself (a ship fill's rules run after the gate) and made GREEN run from the pack source with `claude --plugin-dir <pack dir>`, since the open session still loads the installed cache. Re-run on a fresh ask, "every plan on this repo must say how the change gets rolled back", pack at 0.1.2 with mattstack 0.20.0. The agent sorted it to `plan-domain@1`, ran RED through a subagent (the APPROACH block printed no rollback line), wrote `attachments/plan-rollback/SKILL.md` in contract form, bound it (`rt skills bind stage-plan domain scratch:plan-rollback`, after one retry with the qualified name the verb rejects), certified, checked, confirmed the fragment, then ran GREEN in a fresh `--plugin-dir` session stopped at the same point: "the ROLLBACK line now prints right after APPROACH, even on the trivial tier." It cleaned up both test runs and worktrees, asked before pushing the team repo, then published through editing-skills as 0.1.3. One wording note for the skill: the bind command wants the bare stage name (`stage-plan`), which section 3's placeholder already shows.

## Classification

Mixed, as the plan predicted. The shape was right (fill, bind, publish), so the recipe stays short and points at `slots.md`. The misses are discipline: skipping the RED pass and certify because the mechanics were already in hand, and restating the engine in the fill. Those get a required sub-skill line, a required certify step, and a short red-flags list rather than a prohibition-first skill.
