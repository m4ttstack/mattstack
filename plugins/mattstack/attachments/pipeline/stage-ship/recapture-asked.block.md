---
node: recapture_asked
---

# Reopened to re-capture the AFTER on a shipped run?

Yes when the orchestrator reopened this stage on a done run because the
operator asked for a new AFTER (or a re-attach of the evidence), and `mr`
is set. Nothing to push is a clean tree and an empty `git log
@{upstream}..`: the MR already carries HEAD, so the route goes straight to
the AFTER with no gate, no `git_push` and no `mr_create`. The operator's
ask is the attach consent and covers the title and description write after
it, `mr` is `mrUrl`, and the capture's `page:` is on HEAD. Anything to push
takes the usual route: the reopen cleared `shipTarget`, so the gate asks
first.
