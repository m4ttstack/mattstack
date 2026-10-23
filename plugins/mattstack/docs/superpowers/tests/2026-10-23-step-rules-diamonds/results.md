# Stage diamonds that hold when rules sit at the step: RED/GREEN

stage-provision, stage-gates and stage-self-review each route on a diamond,
`domain_rules_inlined`, labelled "Domain rules inlined?". Its yes edge leads
to a step that declares its own `rules` prop (`follow-domain-flow`,
`apply-triggered-gates`, `follow-domain-review`), so a pack that binds only
that step leaves the Domain rules section empty and the question reads
"no". The change:

- the three diamonds' label: "Domain rules inlined?" becomes "Any domain
  rule inlined in this stage?" (ids and edges unchanged; stage-gates' STOP
  edge "tempted to invent a gate when none is inlined" still reads right
  under the new question);
- stage-gates' Domain rules block: "The domain rules below supply the gates
  and the paths that trigger them." becomes "The domain rules supply the
  gates and the paths that trigger them; they sit below or in the section
  Apply every triggered pre-implementation gate.";
- stage-provision's Precheck result: "only when no domain rules are
  inlined" becomes "only when no domain rule is inlined in this stage".

Reps run on stage-gates. Both sides compile it under the split binding: a
`widgets` fill with two gates (`migration-dry-run` on `db/migrations/`,
`api-schema` on `src/api/schema.graphql`) bound to
`mattstack:stage-gates/apply-triggered-gates` `rules`, Domain rules unbound.
RED is the text before the change, GREEN after; `compiled/` holds both, and
they differ only in the lines above. Recipe as in
`2026-10-23-domain-rules-at-steps`: `bun build.ts <prompt dir>`, then
`bun run-reps.ts <prompt dir> <empty dir> <red|green> <scenario...>`, 5
tool-less Sonnet reps per scenario.

## gates-migration: the migration gate fires and passes

| Question | RED | GREEN |
|---|---|---|
| takes the yes edge into the step's gates | 5/5 | 5/5 |
| runs `bun run widgets:migrate --dry-run`, nothing else | 5/5 | 5/5 |
| `run_field_set {key: extra.gates, value: ["migration-dry-run"], stage: gates}` | 5/5 | 5/5 |
| ends at Gates done | 5/5 | 5/5 |

## gates-migration-fails: both gates fire, the migration gate fails

| Question | RED | GREEN |
|---|---|---|
| runs both gate commands | 5/5 | 5/5 |
| `extra.gates` is `["migration-dry-run", "api-schema"]` | 5/5 | 5/5 |
| `run_stage {action: fail, stage: gates, reason}` naming the gate and its output | 5/5 | 5/5 |
| ends at Stage failed | 5/5 | 5/5 |

## Noise inside each side

- An extra `run_field_get {key: worktree}`: migration RED 2/5, GREEN 1/5;
  migration-fails RED 0/5, GREEN 4/5.
- A `cd /repo/wt` before the command: migration RED 2/5, GREEN 5/5.

## Verdict

RED shows no failure: no rep read the empty Domain rules section as "no
rules" (0/10), because the step's section sits right after the graph. The
old label was still false under a step-only binding; the new one is true
whichever block holds the rules, and GREEN makes the same decisions in
every row. stage-provision and stage-self-review take the same label with
no reps of their own.
