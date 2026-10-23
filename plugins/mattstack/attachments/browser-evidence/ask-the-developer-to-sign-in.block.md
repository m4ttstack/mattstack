---
order: 7
---

# Ask the developer to sign in

A clarify question through gate-protocol, scope `clarify:browser-login:<n>`.
The question says the saved login could not sign in, and offers exactly two
options, each with one sentence and no free text and no Hold:

- **Logged in, retry**: the developer has signed in for this origin;
  spawn the driver again for these briefs.
- **Leave it uncaptured**: the board is not drawn.

At most two asks per stage pass (`sign-in-asks`, counted at each
needs-login before the ask).
