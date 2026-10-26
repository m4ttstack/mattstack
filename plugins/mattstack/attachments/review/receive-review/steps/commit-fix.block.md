---
node: commit_fix
---

# Commit the fix and finalize its Fixed reply

Commit the fix. Finalize its reply to "Fixed -- `file:line` / what
changed" and write it over the draft in the thread's row, with ` · sha:
<short sha>` before its `reply` field; the posted reply is the Fixed text
alone, never the sha. A fix already committed on the branch commits
nothing again: its Fixed reply and `sha` come from that commit.
