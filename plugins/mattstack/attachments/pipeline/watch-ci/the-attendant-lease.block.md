---
order: 4
---

# The attendant lease

One actor attends an MR's CI at a time: this verb, the watch-ci stage, or
the board's doctor. On GitLab only `ci_watch {attend: true}` claims: it
heartbeats every poll, re-claims a vanished lease twice per commit, and a
keepalive holds the lease between calls, a waiting gate included, until
`ci_lease_release`, another owner, or 60 minutes with no attending CI call.
Another owner's fresh lease (the doctor's included) returns `stood_down`.
Never pass `underBoardLease`. `git_push` and `mr_retry` with `leaseMrUrl:
<mr>` take a lapsed lease back or refuse with `lease_held`, so a long fix
needs no heartbeat. On GitHub the graph claims and heartbeats. Every exit
that knows the MR calls `ci_lease_release` (harmless on another owner's
lease); the stand-down never does: that lease is someone else's.

| Thought | Reality |
|---|---|
| "The doctor's on it, but I can fix or retry faster" | A repair is the lease holder's. Stand down and stop. |
| "This fix is long, so I'll heartbeat or claim by hand" | On GitLab the keepalive and the guard cover it; only `ci_watch` claims. |
| "A ci_watch error, so a script or the GitLab CLI" | Fix the input once, then the off-script gate. |
