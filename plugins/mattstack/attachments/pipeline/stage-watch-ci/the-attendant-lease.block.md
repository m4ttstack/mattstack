---
order: 2
---

# The attendant lease

One actor attends an MR's CI at a time: this stage, a standalone watch-ci,
or the board's doctor. On GitLab only `ci_watch {attend: true}` claims: it
heartbeats every poll, re-claims a vanished lease twice per commit, and a
keepalive holds it between calls (a waiting gate included) until
`ci_lease_release`, another owner, or 60 minutes with no attending CI call.
Another owner's fresh lease, the doctor's included, returns `stood_down`
with `holder`. Never pass `underBoardLease`. `mr_retry {leaseMrUrl: <mr>}`
takes a lapsed lease back or refuses with `lease_held` and `holder`.

Every exit that knows the MR releases, except Fix and re-push, which keeps
it for the re-run. The stand-down never releases and writes no
`ci`: report the `holder` and stop; that lease is someone else's.

| Thought | Reality |
|---|---|
| "The doctor's on it, but I can fix or retry faster" | A repair is the lease holder's. Stand down and stop. |
| "On GitLab I'll heartbeat or claim by hand" | The keepalive and the `leaseMrUrl` guard cover it; only `ci_watch` claims. |
| "A ci_watch error, so a script or the GitLab CLI" | Fix the input once, then the off-script gate. |
