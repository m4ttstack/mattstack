---
order: 4
---

# Attach the evidence

Entered only after the verb's attach gate proceeds. On GitLab, nothing
uploads until the human has looked at every file the upload carries
but a cleared board (Gate evidence-boards). The domain supplies `heading`, `before` and
`appendix`; unbound, `heading` is the repo MR template's evidence
heading, else `## Evidence`, always the full line with its `##`. On
GitHub nothing uploads; `<n>` is the PR number in `mrUrl`. Attach held is
the verb's hold path; Attach failed fails it, quoting the reason (a failed
`gh pr edit` too); Taken writes nothing, and a later attach sends the
refused files.

```mermaid
flowchart TB
%% name: attach_evidence
    attach_evidence(["Attach the evidence (evidence-record)"])
    forge_host{Forge host?}
    run_field_get_cleared[/"run_field_get {runDb, key: evidence-cleared:<stem>}, for each board the upload carries"/]
    files_to_show{Any file to show?}
    files_left{Files left to show in this attach?}
    run_budget_boards[/"run_budget {runDb, key: evidence:boards-openings:<first file of this opening>, limit: 3, stage}"/]
    boards_openings_spent{boards-openings spent?}
    gate_evidence_boards
    boards_answer{boards answer?}
    revise_named_boards
    boards_revision_outcome{Board revision outcome?}
    evidence_attach[/"evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}"/]
    attach_result{evidence_attach result?}
    stop_move_refused_file[STOP: only the human moves a refused file]:::stop
    gate_upload_refused
    repair_board
    upload_answer{upload off-script answer?}
    evidence_attach_link[/"evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, linkRefused: true}"/]
    link_written{Linked description written?}
    run_budget_upload[/"run_budget {runDb, key: evidence:upload-off-script, limit: 2, stage}"/]
    upload_off_script_spent{upload-off-script spent?}
    needs_rerecord{Iterate needs a re-record?}
    rerecord_images
    rerecord_outcome{Re-record outcome?}
    run_budget_repair[/"run_budget {runDb, key: evidence:redaction-repairs:<stem>, limit: 2, stage}"/]
    repairs_spent{redaction-repairs spent?}
    repair_outcome{Repair outcome?}
    gh_pr_view[/gh pr view <n> --json body/]
    evidence_attach_body[/"evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}"/]
    description_returned{description returned?}
    gh_pr_edit[/gh pr edit <n> --body-file <file holding the returned description>/]
    attached(((Attached))):::done
    taken(((Taken)))
    attach_held(((Attach held)))
    attach_failed(((Attach failed)))
    attach_evidence --> forge_host
    forge_host -->|GitLab| run_field_get_cleared
    run_field_get_cleared --> files_to_show
    files_to_show -->|yes: the first 12 files to show| run_budget_boards
    files_to_show -->|no: every file a cleared board| evidence_attach
    run_budget_boards --> boards_openings_spent
    boards_openings_spent -->|no| gate_evidence_boards
    boards_openings_spent -->|yes: nothing uploaded| attach_held
    gate_evidence_boards --> boards_answer
    boards_answer -->|proceed + clear| files_left
    files_left -->|yes: the next 12| run_budget_boards
    files_left -->|no: every file shown and answered clear| evidence_attach
    boards_answer -->|proceed + hide, or their words| revise_named_boards
    boards_answer -->|hold| attach_held
    revise_named_boards --> boards_revision_outcome
    boards_revision_outcome -->|Recorded, or no board named: again from the first file| run_field_get_cleared
    boards_revision_outcome -->|Held at evidence-redaction, or Record held| attach_held
    boards_revision_outcome -->|Not revised: the failure quoted| attach_failed
    forge_host -->|GitHub| gh_pr_view
    evidence_attach --> attach_result
    attach_result -->|descriptionWritten, or notWritten: unchanged| attached
    attach_result -->|refused: redaction, per board, before any other bucket| run_budget_repair
    attach_result -->|any other refused bucket, or timedOutTwice| stop_move_refused_file
    run_budget_repair --> repairs_spent
    repairs_spent -->|no| repair_board
    repairs_spent -->|yes: refused again after a repair| stop_move_refused_file
    repair_board --> repair_outcome
    repair_outcome -->|Repaired: again from the first file| run_field_get_cleared
    repair_outcome -->|Held at evidence-redaction| attach_held
    repair_outcome -->|Not repaired, the output quoted| stop_move_refused_file
    attach_result -->|tempted to copy the file or upload another way| stop_move_refused_file
    attach_result -->|writeErrors, or the call errored| attach_failed
    stop_move_refused_file --> gate_upload_refused
    gate_upload_refused --> upload_answer
    upload_answer -->|"proceed + take, a later stage attaches (stage-evidence)"| taken
    upload_answer -->|"proceed + take, the last attach (ship, stage-ship)"| evidence_attach_link
    upload_answer -->|proceed + hand back| attach_failed
    upload_answer -->|iterate| run_budget_upload
    upload_answer -->|hold| attach_held
    evidence_attach_link --> link_written
    run_budget_upload --> upload_off_script_spent
    upload_off_script_spent -->|no| needs_rerecord
    needs_rerecord -->|"yes: size, bytes or missing (a recapture), a new file, or a record or raw-capture refusal"| rerecord_images
    needs_rerecord -->|no: timedOutTwice, the human checked the daemon| evidence_attach
    rerecord_images --> rerecord_outcome
    rerecord_outcome -->|Recorded: again from the first file| run_field_get_cleared
    rerecord_outcome -->|Record held| attach_held
    rerecord_outcome -->|Record failed| attach_failed
    gh_pr_view --> evidence_attach_body
    evidence_attach_body --> description_returned
    description_returned -->|yes| gh_pr_edit
    gh_pr_edit --> attached
    link_written -->|yes| attached
    link_written -->|no| attach_failed
    description_returned -->|no| attach_failed
    upload_off_script_spent -->|yes| attach_failed
```
