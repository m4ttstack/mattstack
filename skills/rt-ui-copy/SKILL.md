---
name: rt:ui-copy
description: Use when writing or reviewing short UI copy in a mattstack app or an rt surface - tooltips, help icons, button, switch and badge hints, aria-labels, one-line notes - or an rt command-tree description.
---

# Short UI copy

A tip reads like an rt command description: one short plain sentence about
what the control does for the person ("Jump to a repo or worktree", "Undo
the last commit, keep its changes").

## The shape

- One clause, sentence case, no full stop, about 2 to 6 words.
- **A control** leads with its verb, said to the person: "Deploy the latest
  code", "Build without redeploying".
- **A switch** says what flipping it does now: "Make private", "Publish".
- **A disabled control** names what unlocks it: "Add Google sign-in first".
- **A state** (badge, chip) names the state, then the fix as a second short
  clause: "Off. Turn it on in Settings > Apps".
- **A setting's help icon** says what the setting gets the person: "Keep
  serving when this Mac is off".

That clause is the whole tip. How it works, what happens after, and data
the screen already shows (a SHA, a count) live in the docs or the UI around
it.

## Before and after

| Verbose | Short |
| --- | --- |
| Runs this app's deploy command from its linked checkout, so the running app picks up the new code. | Deploy the latest code |
| Build this app. The running app stays the same until you deploy. | Build without redeploying |
| New code since last deploy: abc123 to def456. Deploy to update. | Deploy the new code |
| Tunnel visitors enter this before the gateway lets them through. | Visitors enter this to get in |
| Public: anyone with the link can open this app. Switch to make it private. | Make private |
