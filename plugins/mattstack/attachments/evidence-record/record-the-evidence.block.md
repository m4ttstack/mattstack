---
order: 2
---

# Record the evidence

```mermaid
flowchart TB
%% name: record_evidence
    record_evidence(["Record the evidence (evidence-record)"])
    evidence_record[/"evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}"/]
    record_result{evidence_record result?}
    run_budget_cover[/"run_budget {runDb, key: evidence:cover-rounds, limit: 4, stage}"/]
    cover_rounds_spent{cover-rounds spent?}
    annotate_or_waive["Annotate or waive each image the record does not yet cover (evidence-record)"]
    annotate_outcome{Annotate or waive outcome?}
    run_budget_retries[/"run_budget {runDb, key: evidence:record-retries, limit: 2, stage}"/]
    record_retries_spent{record-retries spent?}
    recorded(((Recorded))):::done
    record_held(((Record held)))
    record_failed(((Record failed)))
    record_evidence --> evidence_record
    evidence_record --> record_result
    record_result -->|written| recorded
    record_result -->|uncovered listed| run_budget_cover
    record_result -->|the evidence field changed during this call| run_budget_retries
    record_result -->|any other error| record_failed
    run_budget_cover --> cover_rounds_spent
    cover_rounds_spent -->|no| annotate_or_waive
    annotate_or_waive --> annotate_outcome
    annotate_outcome -->|Ready: each image `uncovered` lists, by its path there, with its cover, source: ticket on a ticket image, and a new case's label| evidence_record
    annotate_outcome -->|Waiver held, or Redaction held| record_held
    annotate_outcome -->|Waiver openings spent| record_failed
    run_budget_retries --> record_retries_spent
    record_retries_spent -->|no: the same call again| evidence_record
    cover_rounds_spent -->|yes| record_failed
    record_retries_spent -->|yes| record_failed
```

The first call names each capture by the `path` it was written to, with
`case` and `slot` (and `theme`), and `source: "ticket"` on a saved ticket
image. Every later call names the same images by the paths in the last
returned `value`, each with:

- its cover: `annotated` (the board's path) plus `caption`, or `waiver`
  (a case waiver rides in `cases`);
- `source: "ticket"` again on every image whose entry in that `value`
  carries `"source": "ticket"`.

The call that first writes a new case carries its `label`, on the image or
in `cases`, so every call until the record is written carries each new
case's `label`. `tree` is the run's worktree root. Record held is the
verb's hold path; Record failed fails the verb, naming the images or
quoting the error.
