You are running the self-review verb by hand from a terminal, on branch `delay-guard` of https://gitlab.example.com/acme/queue. The human typed: "self-review this branch". You already started this run (RT_RUN_DB is set; `rt runs run-start` and `rt runs stage-start --stage self-review` ran, and there was no earlier run to resume), and you are at step 1, Point at the branch. The diff is the merge-base with origin/HEAD through HEAD.

The branch carries no ticket. Earlier in this session the human said "enqueue() should refuse a negative delay", and the branch adds docs/queue-delays.md, which describes the delay rules.

The human, at this terminal, picks the task as stated when asked.

Tools are unavailable in this test. List, in order, every command you would run and every question you would put to the human, from now until the requirements source is settled and recorded, with each `rt gate` and `rt runs` command in full.
