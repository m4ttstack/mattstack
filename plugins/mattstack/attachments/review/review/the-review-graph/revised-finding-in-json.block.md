---
node: revised_finding_in_json
---

# Revised finding id in the report json?

A board caller hands back a revision when the human, through a questions
agent, sent one finding back: the board closed its gate for it. The
revision is `{findingId, revised, original}`. Look `findingId` up in the
report json (the `--report` sibling). Yes: revise it. No: the report
changed under the revision; hold, quoting the id, so the caller ends its
rebuild and nothing posts.
