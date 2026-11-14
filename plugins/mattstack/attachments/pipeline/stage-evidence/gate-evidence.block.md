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
naming any dev-server role left waiting or unclaimed. **I started it,
check again** (or an `iterate`) on such a role re-runs `dev_endpoints`
twice at most (`gate-iterates`); the third fails the stage, naming the
roles.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| the domain's intake | as the domain words them; an open-ended one is free text in the form | the domain declares them |
| `servers` | **I started it, check again** / **Go on without it** / **Hand back** | a dev-server role is waiting or unclaimed |
| `source` (write-in) | **Proceed with `<source>` (Recommended)** / **Switch to local** | the data source is not local |
| `fallback` (write-in) | **Capture again** / **Hand back** once three captures have failed; when the gate reopens from an unfixable Not drawn, **Hand back** / **Go on without this BEFORE** (no **Capture again**) | the gate reopened from failed captures |

Selection: `{"intake":{<answers>},"servers":"check|without|handback|null","source":"<as confirmed>","fallback":"again|handback|goon|null","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Capture again and Go on without it are `proceed`. Hand back fails the
stage, naming the roles or what was tried.

Go on without this BEFORE goes to `Every planned case captured or
located?` with no BEFORE image for the case, as a ticket-link case has
none: ship captures its AFTER, and the description names the gap.

{{props.rules}}
