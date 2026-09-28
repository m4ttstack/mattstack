# Work cutover: the digraph pipeline becomes work

Date: 2026-09-27. Ticket: RT-343 (parent RT-334, wave 6).

## Goal

One work pipeline and one gate protocol. The digraph engines that shipped
beside the prose ones as `work-next` take the canonical names, the prose
engines, every `work-next` name and the `work-next-gate` include retire,
and runs record work type `work`. Team packs that bind `work` and
`stage-*` today compile unchanged apart from dropping their `work-next`
entries.

## Decisions

1. **Stage order is fixed in the graph** (settled at the design gate). The
   digraph `work` hard-codes the eight stages in its Stages table through
   `{{verb.path:stage-<stage>}}` and starts runs with
   `{{run-start.flags:work}}`, so runs record `--work-type work --pipeline
   work`. A pack's `pipelines` key survives only as the stage roster: it
   must list all eight `stage-*` engines. The team pack already lists exactly
   the canonical eight in canonical order, so its `pipelines` block stays
   as it is. A pipeline naming a subset (rt's acme compile fixture: plan,
   implement, ship) fails compile loudly on the first `verb.path` whose
   stage is not rostered; that is an rt follow-up, not a runtime surprise.
   rt refuses a name that is both a roster verb and a pipeline stage, so a
   pack rosters the stages one way or the other; `pipelines` is the path
   of least change.
2. **Engines move in place of the prose ones.**

   | Before (digraph) | After | Replaces (prose, deleted) |
   |---|---|---|
   | `attachments/work-next/work-next/` | `attachments/pipeline/work/` | `attachments/pipeline/work/` |
   | `attachments/work-next/work-next-<stage>/` | `attachments/pipeline/stage-<stage>/` | `attachments/pipeline/stage-<stage>/` |
   | `attachments/work-next-gate/` | deleted | nothing |

   `attachments/work-next/` disappears. `<stage>` is each of provision,
   plan, gates, evidence, implement, self-review, ship, watch-ci;
   `stage-watch-ci` keeps its `scripts/` and `tests/`.
3. **One gate protocol.** Every gating host (the `work` orchestrator and
   the provision, plan, evidence, ship and watch-ci stages) includes
   `{{include:gate-protocol}}` and `{{include:wrap-up-form}}`, exactly the
   pair the prose engines and every other gated verb include. The
   work-next gate include is deleted, not renamed. Where it disagreed with
   gate-protocol under a run, gate-protocol's behavior wins and the
   pipeline gains it:

   | Case | work-next gate | gate-protocol (now) |
   |---|---|---|
   | `wait` in an attended herdr pane | shows the form | holds on the wait |
   | form cancelled by the human, or dismissed by the daemon | no edge | cancelled holds; dismissed takes the doorbell |
   | 2s doorbell read finds the gate still open | always takes an answer | returns to holding |
   | `gate_answer` refused as not an option value | no edge | remaps once, then leaves the gate open |
   | late wait, doorbell or words for a reconciled gate | no edge | discarded, one line |
   | human answers in words at a held gate | no edge | maps the words and answers |

4. **Hold is recorded by the hosts; gate-protocol is untouched.** The
   work-next gate recorded a Hold under a run centrally (the
   `hold:<stage>:<attempt>` decision and the `hold` field). gate-protocol
   leaves Hold to each verb ("Closed gates, Hold / Iterate"), and hosts
   such as checkout, review and self-review record it themselves, so a
   central rule would double-record there and start new writes in ship,
   watch-ci and the forge verbs. gate-protocol stays exactly as merged.
   Instead every hold edge in the pipeline gets its own record nodes, as
   the prose stages recorded it in prose: `run_decision {contract: gate@1,
   scope: hold:<stage>:<attempt>, selection: {reason}}` then
   `run_field_set {key: hold, value: <their words, or held>, stage}`, then
   the held terminal. That covers the provision, plan, evidence (both
   gates), ship and watch-ci hold edges and the orchestrator's failure
   and close hold edges. Every other work-next gate rule is already in
   gate-protocol (question and option limits, verbatim context, answers as
   option values, decidedBy as the CAS winner, attendance from
   `spawnedBy`, a re-ask after Iterate is a new gate, the off-script gate)
   or in wrap-up-form (the form is the reply).
5. **Off-script answers route every `next`.** gate-protocol's off-script
   gate asks `action` (take or hand back) and `next` (proceed, iterate,
   hold). The ship and evidence off-script diamonds today route only take
   and hand back; each gains an iterate edge (the human fixed the cause:
   retry the refused move, budgeted at 2 off-script rounds, then hand
   back) and a hold edge into the hold record nodes, modelled on
   checkout's. The scope is gate-protocol's `off-script:<site>:<n>`, the
   site being the stage.
6. **The orchestrator's own gates** (`<stage>-failed`, `close`) walk
   gate-protocol with its "Under a run: fail the stage at the gate?"
   answered no: a gate the daemon cannot open there ends the turn quoting
   the refusal, and the run stays `running`.

## Engine edits

Inside the moved files, and nothing beyond this list:

- `name:` becomes the new directory name (`work`, `stage-<stage>`).
- Descriptions: stages say "Reached only through the work orchestrator";
  `work` becomes a trigger-only description for running a unit of work
  end to end, with no "beside work" or "digraph pipeline" framing.
- `{{verb.path:work-next-<stage>}}` becomes `{{verb.path:stage-<stage>}}`.
- `{{run-start.flags:work-next}}` becomes `{{run-start.flags:work}}`.
- `{{include:work-next-gate}}` becomes the gate-protocol and wrap-up-form
  pair, under the `## Gate protocol` and `## Wrap-up form contract`
  headings every other gated verb uses.
- Hold record nodes and off-script edges per decisions 4 and 5, and the
  orchestrator's own-gate wording per decision 6; the orchestrator heading
  becomes `# work -- the pipeline orchestrator` and its graph
  `digraph work`.

gate-protocol and wrap-up-form do not change.

Unchanged, by contract: every slot name and contract (`tiering`
model-tiering@1; `domain` with each stage's `*-domain@1`; `forge`
ci-forge@1), every `metadata.stage*` declaration, allowed-tools, and every
other `{{...}}` seam (`slot`, `stage.fields`, `stage.dir`,
`include:execution-strategy`, and the rest). A pack's fills bind the same
slots under the same engine names they bind today.

## Behavior changes packs should know about

- **ci-triage.** The digraph `stage-watch-ci` carries a newer
  `ci-triage.sh` with two changes: a log line with a nonzero failure count
  counts as a real failure even when it also reports passes or a zero
  count; and `SCANNED` counts only base pipelines whose jobs were
  actually read, so a base scan where every jobs read failed yields the
  `UNKNOWN (no base pipelines scanned)` verdict instead of a clean one.
  `plugin/tests/test-resolve-args.sh` requires the standalone
  `attachments/pipeline/watch-ci/scripts/` to match `stage-watch-ci`'s
  byte for byte, so the new `ci-triage.sh` is copied there too. the team pack's
  public `watch-ci` verb changes behavior this way when recompiled.
- **Work-type choice dropped.** The prose `work` offered a work-type menu
  when a manifest declared several `pipelines` keys. The digraph `work`
  always records work type `work` (accepted at the design gate).
- **Stage allowed-tools union dropped.** rt unions the stage fills'
  allowed-tools into the orchestrator only when its body carries
  `{{pipeline.stages}}`; the digraph `work` declares its own list
  (`git -C` plus the four ci scripts). The team pack is unaffected: its
  compiled prose `work` and compiled `work-next` carry the same five
  entries. A pack whose stage fill declares extra allowed-tools would lose
  them from `work`.
- **Gate behavior** per decision 3's table.

## Docs and ledger

- `README.md` Pipeline section: work walks a fixed eight-stage graph; a
  pack rosters the stages (its `pipelines` array lists all eight).
- `attachments/parameterized-skills/references/convention.md` "Pipeline
  resolution": the orchestrator's order is fixed; `pipelines` rosters
  stage engines for compile; `{{pipeline.stages}}` and `{{work-type}}`
  remain compiler placeholders no mattstack engine uses.
- `plugin/schemas/skills-manifest.md` and the schema's `pipelines`
  description: the same roster meaning.
- `CERTIFICATION.md`: the 2026-09-26 work-next rows stay as history; new
  2026-09-27 rows for `work`, the eight `stage-*` and `watch-ci`. These and the history rows are the only intentional
  `work-next` mentions left, beside this job's dated docs.
- `.claude-plugin/plugin.json`: 0.25.2 to 0.26.0 in the cutover commit.

## Team pack changes (for the shepherd; no ticket ids)

The team pack (`packs/<team>/`), in order:

1. `pack/stubs.jsonc`: delete the `work-next` verb and the eight
   `work-next-<stage>` verbs. Keep `work` (engine `work`).
2. `pack/skills.jsonc`: drop `mattstack:work-next` from `skills.enabled`;
   drop the `mattstack:work-next` binding and the seven
   `mattstack:work-next-<stage>` bindings (implement has none). Keep
   `pipelines.feature` and every `mattstack:stage-*` binding; their
   domains already match the work-next ones exactly.
3. `pack/surface.jsonc`: drop `work-next` from `public`.
4. Per-repo manifest `~/.mattstack/repos/<repo slug>/skills.jsonc`:
   it carries the eight `mattstack:work-next*` bindings with no provenance
   lines (written by `rt skills bind`). `merge-manifests.sh --repo
   <repo checkout>` rewrites the whole file from the team fragments
   plus `~/.mattstack/user/skills/overrides.jsonc` (absent today) and keeps
   nothing from the old file, so regenerating after step 2 clears them; no
   unbind is needed.
5. Delete the stale compiled `skills/work-next/` and
   `attachments/work-next-*` dirs before the check.
6. Bump `.claude-plugin/plugin.json` minor (0.7.0 to 0.8.0), recompile,
   strict check, then sync.

## Equivalence proof

No RED/GREEN rerun. Instead, with a scratch mattstack home whose
`plugins/mattstack` points at this worktree (after) or at an export of the
base commit (before):

1. **After.** A scratch copy of the team pack with steps 1 to 3 and 5
   applied, and a scratch per-repo manifest regenerated from the edited
   fragment by `merge-manifests.sh` (run with `MATTSTACK_HOME` at a
   scratch home holding the edited team zone) and passed explicitly with
   `--manifest`. `rt skills compile` compiles every verb with no errors
   and no `{{` left, and a strict `rt skills check` on the result passes.
2. **Before.** The same compile of the unedited pack copy against the base
   commit, with the current per-repo manifest.
3. **Work and stages.** A normalizing diff (rename map
   `work-next-<stage>` to `stage-<stage>`, `work-next` to `work`;
   compiled-version and pack-sha metadata; part-seam source paths and line
   ranges) of new `work` and `stage-*` against old `work-next` and
   `work-next-*` shows only the description lines, the gate include swap
   (the work-next gate body out, gate-protocol and wrap-up-form in), the
   hold record nodes and off-script edges, and the orchestrator's
   own-gate line.
4. **Every other verb.** A plain diff of every other compiled verb, before
   against after, shows only `watch-ci`'s `ci-triage.sh`.
5. **check-dot on compiled hosts.** Every compiled `work` and `stage-*`
   `SKILL.md` renders and passes `check-dot.py`, which catches node text
   collisions and duplicate step sections between a stage graph and the
   inlined gate-protocol graph.
6. **acme.** rt's acme fixture pack compiled against this worktree, once
   as-is (expected loud failure on the subset pipeline, captured for the
   rt follow-up) and once with its pipeline widened to the eight stages
   (compiles clean).

## rt follow-ups (read only here; report, do not change)

- acme compile fixture: its subset pipeline and fixture `work` engine
  model the retired prose shape; widen it to eight stages and a fixed
  order `work`.
- `rt skills init` seeds `pipelines.feature` with the eight stages
  (`lib/skills/init.ts`): still valid as the roster; its comments should
  say the order is fixed.
- `{{pipeline.stages}}` and `{{work-type}}`: no mattstack engine uses them
  now, and the orchestrator allowed-tools union in `commands/skills.ts`
  no longer fires for `work`. Deprecate, or move the union onto a
  roster-based rule so packs with fill allowed-tools keep them.
- Console wiring's `ORCHESTRATOR_VERB = 'work'` now points at the digraph
  orchestrator; no change needed. No rt code keys on `work-next`.
- Runs started before the cutover carry work type `work-next` or
  `feature`; nothing in rt filters on either.

## Verification

`sh tests/certify.sh` on every changed engine dir; `bash
plugin/skills/process-digraphs/test-check-dot.sh`; the strict pack check as
`.github/workflows/purity.yml` mcp-lint runs it; `sh tests/repo-purity.sh`;
`bash plugin/tests/test-resolve-args.sh`; `git grep work-next` shows only
the ledger and this job's dated docs; the equivalence proof above.
