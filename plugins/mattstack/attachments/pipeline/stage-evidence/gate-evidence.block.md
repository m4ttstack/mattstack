---
order: 1
kind: gate
label: Evidence gate
props:
  rules:
    merge: add
    default: ""
---

# Gate `evidence` (before any capture)

One sentence above the form: what the plan asks for and what is unknown,
naming any dev-server role left waiting or unclaimed. Iterate on such a
role re-runs `dev_endpoints` twice at most (`gate-iterates`); the third
fails the stage, naming the roles.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| the domain's intake | as the domain words them; an open-ended one is free text in the form | the domain declares them |
| `source` (write-in) | **Proceed with `<source>` (Recommended)** / **Switch to local** | the data source is not local |
| `next` | **Proceed** / **Iterate here** / **Hold**, plus **Hand back** once three captures have failed; when the gate reopens from an unfixable Not drawn, **Hand back** / **Go on without this BEFORE** / **Iterate here** / **Hold** (no **Proceed**) | always |

Selection: `{"intake":{<answers>},"source":"<as confirmed>","next":"proceed|iterate|hold|handback|goon","note":"<their words or null>"}`.

Go on without this BEFORE goes to `Every planned case captured or
located?` with no BEFORE image for the case, as a ticket-link case has
none: ship captures its AFTER, and the description names the gap.

{{props.rules}}
