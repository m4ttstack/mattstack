---
order: 3
---

# Annotate or waive each image the record does not yet cover

For each image `evidence_record` lists in `uncovered` (`{case, slot,
theme?, path, why}`); images that need the gate in one pass share one
opening. Waiver held and Redaction held are the verb's hold path; Waiver
openings spent fails the verb, naming the images.

```mermaid
flowchart TB
%% name: annotate_or_waive
    image_needs_cover([Image needs cover])
    nothing_to_mark{Nothing selected, a video, nothing worth marking, or the domain says it goes up as shot?}
    compose_board
    drawn{Compose outcome?}
    redaction_held(((Redaction held)))
    run_budget_draw[/"run_budget {runDb, key: evidence:draw-failures:<case>/<slot>[/<theme>], limit: 2, stage}"/]
    draw_failures_spent{draw-failures spent?}
    write_caption
    run_budget_waiver[/"run_budget {runDb, key: evidence:waiver-openings:<case>/<slot>[/<theme>], limit: 3, stage}"/]
    waiver_openings_spent{waiver-openings spent?}
    gate_evidence_waiver
    waiver_answer{waiver answer?}
    stop_self_waive[STOP: only the human waives an image]:::stop
    waiver_held(((Waiver held)))
    waiver_openings_exhausted(((Waiver openings spent)))
    ready(((Ready))):::done
    image_needs_cover --> nothing_to_mark
    nothing_to_mark -->|no| compose_board
    nothing_to_mark -->|tempted to keep the base unmarked| stop_self_waive
    stop_self_waive --> run_budget_waiver
    compose_board --> drawn
    drawn -->|Board ready| write_caption
    drawn -->|Not drawn| run_budget_draw
    drawn -->|Not drawn, after Annotate it after all| run_budget_waiver
    drawn -->|Held at evidence-redaction| redaction_held
    run_budget_draw --> draw_failures_spent
    draw_failures_spent -->|no: one retry| compose_board
    nothing_to_mark -->|yes| run_budget_waiver
    draw_failures_spent -->|yes| run_budget_waiver
    write_caption --> ready
    run_budget_waiver --> waiver_openings_spent
    waiver_openings_spent -->|no| gate_evidence_waiver
    waiver_openings_spent -->|yes| waiver_openings_exhausted
    gate_evidence_waiver --> waiver_answer
    waiver_answer -->|proceed: a reason| ready
    waiver_answer -->|proceed: Annotate it after all| compose_board
    waiver_answer -->|proceed with neither| run_budget_waiver
    waiver_answer -->|hold| waiver_held
```
