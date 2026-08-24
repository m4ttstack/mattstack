---
name: acme:work-policy
description: "Use when the mattstack:stage-plan wrapper delegates the acme domain half of the plan stage; the pack manifest points that stage's domain binding here. Not for manual invocation."
disable-model-invocation: true
metadata:
  provides: "plan-domain@1"
---

# acme work policy (plan-domain)

## Always-on constraints

List the rules that bind every unit of work in your domain: branch
naming, forbidden operations, required tooling. One bold rule per
bullet, with the reason.

## Extra commitment lines (print with the APPROACH block, verbatim)

Define each additional line the plan stage must print, in blockquote
form, with the decision rule that fills it. Example shape:

> GATES: yes | no

`yes` when a planned change touches <the paths your gates protect>.

> EVIDENCE: <your evidence taxonomy> -- <why>

State how the tier is decided and when the before-state must be
captured (the evidence stage captures it before implementation).
