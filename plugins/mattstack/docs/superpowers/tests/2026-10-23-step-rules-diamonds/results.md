# Stage diamonds that hold when rules sit at the step: RED/GREEN

stage-provision, stage-gates and stage-self-review each route on a diamond,
`domain_rules_inlined`, labelled "Domain rules inlined?". Its yes edge leads
to a step that declares its own `rules` prop (`follow-domain-flow`,
`apply-triggered-gates`, `follow-domain-review`), so a pack that binds only
that step leaves the Domain rules section empty and the question reads
"no". The change:

- the stage-gates and stage-self-review diamonds' label: "Domain rules
  inlined?" becomes "Any domain rule inlined in this stage?" (ids and edges
  unchanged; stage-gates' STOP edge "tempted to invent a gate when none is
  inlined" still reads right under the new question). stage-provision took
  the same label first and has its own wording now (last section);
- stage-gates' Domain rules block: "The domain rules below supply the gates
  and the paths that trigger them." becomes "The domain rules supply the
  gates and the paths that trigger them; they sit below or in the section
  Apply every triggered pre-implementation gate.";
- stage-provision's Precheck result: see the last section.

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
every row. stage-self-review takes the same label with no reps of its own:
like stage-gates, its only rule blocks are the yes step and Domain rules.

## stage-provision under a Gate `provision`-only binding

stage-provision has three rule-bearing blocks: `follow-domain-flow`,
`gate-provision` and `domain-rules`. "Any domain rule inlined in this
stage?" also counted a rule that only adds a provision-gate question. A
pack binding only `gate-provision` then took the yes edge into an empty
domain flow, and Precheck result dropped the `sameTicket` trees. The fix
names the blocks that make the yes edge true:

- the label "Any domain rule inlined in this stage?" becomes "Domain rules
  inlined in Domain rules or under Follow the domain's provision flow?";
- Precheck result rule 3 becomes "every `sameTicket` tree, but only when no
  domain rule is inlined in Domain rules or under Follow the domain's
  provision flow (a domain flow asks its own slug question for those); a
  rule only under Gate `provision` does not count.";
- Follow the domain's provision flow gains: "The domain's rules for this
  step, when it has any, follow this paragraph. This paragraph is not one,
  and a rule under Gate `provision` only adds gate questions."

The fill bound to `mattstack:stage-provision/gate-provision` `rules` adds a
`squad` question to the provision gate; Domain rules and the flow step are
unbound. The scenario is `provision/headers/provision-same-ticket.md`: an
interactive run whose precheck returns one `sameTicket` tree. RED is the
label above with its first rule-3 wording. GREEN round 1 changed only the
label ("Domain provision flow inlined (Domain rules or Follow the domain's
provision flow)?") and rule 3. GREEN round 2 is the final text. All three
compiled files are in `provision/compiled/`; round 1's runs are in
`provision/runs-green1/`.

| Question | RED | GREEN round 1 | GREEN round 2 |
|---|---|---|---|
| skips Follow the domain's provision flow | 0/5 | 2/5 | 5/5 |
| offers the `sameTicket` tree in `resume_in`, plus Fresh tree | 0/5 | 2/5 | 5/5 |
| presents the provision gate with `resume_in`, `squad`, `next` | 0/5 | 2/5 | 5/5 |

RED read the gate rule as a domain rule 5/5 and provisioned fresh with no
gate. Round 1 still took the yes edge 3/5, because the flow step's own
paragraph made the section look inlined. Round 2 says what counts.

A sanity run binds the rule to `follow-domain-flow` instead
(`provision-flow/`, GREEN text only, same scenario). It takes the yes edge
5/5 and leaves the `sameTicket` tree off `resume_in` 5/5: the domain flow's
own slug question replaces it. This is the behavior the flow binding needs.
