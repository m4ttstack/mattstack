---
node: show_status_table
---

# Show the status table

Reformat `herd_status {herd}`, flagging failures and the latest
`herd_lanes` drift:

```
| job | pane | account | strategy | status | summary |
|-----|------|---------|----------|--------|---------|
| api tests | w3:p1 | 2 | direct-tdd | done | A1-A4 done, 12 tests, suite green |
```
