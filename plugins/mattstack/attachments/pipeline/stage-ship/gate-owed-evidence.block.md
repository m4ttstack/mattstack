---
node: gate_owed_evidence
kind: gate
label: Owed evidence
---

# Gate owed-evidence (table below)

Scope `owed-evidence:ship:<n>`, `<n>` counting its openings in this run
from 1. Pass `needsOperator` with one line naming how many items are owed.
`context` quotes each owed item's line and says why it is still owed: the
capture that failed and its error, the environment that is not up, or that
no tool here can make it. For an item captured at an earlier sha, it names
that sha and lists `git diff --name-only <that sha>..<pushed sha>`.

One question (write-in) per owed item, its id `owed-<finding id>`, its
label the item's text:

| Option | Shown when |
|---|---|
| **Accept the capture from `<earlier sha>`** (`accept`) | the evidence record holds a capture of it from an earlier sha |
| **Capture it now** (`now`) | a method here can make it; its `description` names the method |
| **Capture it later on `<environment>`** (`later`), its `description` saying the run waits until it is up | always; the environment is the one the item or the domain names, else the MR's preview |
| **Move it to a follow-up in the MR** (`followup`) | always |

Recommend Accept when no file in the diff can change what the capture
shows (tests, docs, CI config), else Capture it now when shown, else
Capture it later.

Apply each answer to its line (Graph notes, Owed evidence): `accept`
checks it at the pushed sha, `followup` checks it as a follow-up, `later`
leaves it open on its environment, `now` leaves it as it was. A write-in
that names a method is `now` by that method; one that names an environment
is `later` on it. An item answered `now` takes one more try, its spent
`after-attempts` sending a failed one back here. Every other case counts
as tried.
