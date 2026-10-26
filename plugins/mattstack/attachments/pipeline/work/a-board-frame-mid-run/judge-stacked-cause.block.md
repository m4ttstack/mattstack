---
node: judge_stacked_cause
---

# Judge whether this branch's change caused the stacked MR's failure

Compare the triage's blocking jobs and their logs with this branch's
diff against its target. Yes needs a job failing in code this branch
changed; a failure in the stacked MR's own change, or INFRA, is no.
