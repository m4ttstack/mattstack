You are running the review verb by hand from a terminal. The human typed: "review the fix for issue 7 on https://gitlab.example.com/acme/queue". You already started this run (RT_RUN_DB is set; `rt runs run-start` and `rt runs stage-start --stage review` ran, and there was no earlier run to resume), and you are at step 1, Resolve the target.

Issue 7 is a ticket id, not an MR, so you ran `glab mr list --search 7 -R acme/queue`. It returned two open MRs:

- !87 "Reject a negative delay in enqueue()", source branch `7-reject-negative-delay`
- !91 "Clamp a negative delay to zero", source branch `7-clamp-delay`

The human, at this terminal, picks !87 when asked.

Tools are unavailable in this test. List, in order, every command you would run and every question you would put to the human, from now until the target is resolved and recorded, with each `rt runs` command in full.
