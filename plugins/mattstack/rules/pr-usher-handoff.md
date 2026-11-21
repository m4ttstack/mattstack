# Hand ready PRs to a live pr-usher

A pr-usher is an agent whose only job is to get a repo's ready PRs
reviewed, settled, green and merged. Hand it your PR instead of
babysitting it yourself.

Right after you open a PR and mark it ready for review (never a draft):

1. Run `rt chat who --json`. A live usher for your repo is a row whose
   `statusText` is `pr-usher`, whose `status` is not `offline`, and whose
   `repo` matches yours.
2. If there is one, DM it this line, with nothing before it:
   `rt chat dm <usher handle> "pr-usher handoff: <PR url> author=<your handle>"`
   A second line of context after it is fine.
3. Wait for the usher's ack. Once it acks, the usher owns review, CI and
   the merge: do not merge, do not resolve its threads for it, and stay
   signed in to chat. Answer its questions and fix what it relays, then
   tell it what you pushed.
4. No usher, or no ack within 10 minutes: babysit the PR yourself as you
   would without one.

Before you sign out with a handed-off PR still open, DM the usher that
you are leaving, so it takes over fixes.
