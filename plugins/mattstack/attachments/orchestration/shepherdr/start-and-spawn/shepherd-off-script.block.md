---
node: shepherd_off_script
kind: gate
label: Off-script gate
---

# Shepherd off-script gate: ask the user

Every unresolved refusal and spent budget, in all three graphs, lands
here. Ask with AskUserQuestion: one sentence quoting the refusal or naming
the budget, then three options:

- **Take the proposed move**: its value spells the move in full (the exact tool call or Bash line), so the answer is the record.
- **Hand it back to you**: the user deals with it.
- **Hold**: nothing moves on this job for now.

"Hand it back" and "Hold" return to the gate's loop: here the job is
skipped and the batch goes on; in the other two graphs you end the turn.
One job's spent budget never ends the herd.

A `... spent?` diamond reads the daemon budget fetched in this decision,
never a count from memory. A
`... = 2?` diamond (`Brief retries = 2?`, `Answer retries = 2?`) is a
same-turn retry count kept in your head, since no daemon budget covers it;
it answers yes once two retries have run.
