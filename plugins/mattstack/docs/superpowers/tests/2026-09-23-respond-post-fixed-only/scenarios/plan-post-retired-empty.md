You are receive-review on https://gitlab.example.com/acme/queue/-/merge_requests/87 (!87). The reviewer is renee, round 1. You already started this run (RT_RUN_DB is set; your stage is receive-review).

The caller is a surface that collected both decisions up front, from gates it opened before the current respond-post rule. You adjudicated one unresolved human thread and saved step 3's report to /tmp/rr/report.md:
- T1, queue/README.md:12, verdict pushback, action reply; drafted reply: "The wait is a fixed 30s delay (queue/retry.ts:14), so the README keeps delay." Its gate 1 card showed that reply verbatim, and its question context reached the gate.

The caller now hands you the combined decision object, decided by board:
{"plan": {"thread-1": "reply:T1", "code-changes": "skip"}, "post": {"replies": [], "disposition": "leave-open"}}

Tools are unavailable in this test. List, in order, every action you would take on the forge (post a reply, resolve a thread, anything else), every command you would run and every file you would write or change (full contents), from now until the run closes.
