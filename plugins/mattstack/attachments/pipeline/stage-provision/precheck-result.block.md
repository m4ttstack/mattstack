---
node: precheck_result
---

# Precheck result?

**Trees to resume** are, each tree once and in this order:

1. the `attached` tree, only when exactly one is listed (two or more make
   `reuse` refuse `branch-duplicated`, so offer none of them);
2. the surviving local branch (`localBranch: true` with no `attached`
   tree), offered as resume on `base`;
3. every `sameTicket` tree, but only when no domain rule is inlined in
   this stage (a domain flow asks its own slug question for those).

All of them go in the gate's one `resume_in` question, the first 3 in that
order plus **Fresh tree**; provisioning adds no other gate or question.
A claimed tree whose `owner` is set is held by someone else unless that
owner is `herd:<id>`, where `<id>` is `herd.id` from `whoami` (this pane's
own herd). A tree the EnterWorktree hook claimed has owner `claude`, which
names no session, so it reads as held. A held tree's option reads **Resume
in `<tree>` (held by `<owner>` since `<claimedAt>`)** and is never the
recommended one; when every offered tree is held, **Fresh tree** is
recommended.
Two or more `attached` trees with nothing else to offer still go to the
gate, offering **Fresh tree** alone. **Nothing in the way** means no
`attached` tree and no other offer. A refused precheck routes on its
`code`; `daemon-outdated` never retries the precheck.
