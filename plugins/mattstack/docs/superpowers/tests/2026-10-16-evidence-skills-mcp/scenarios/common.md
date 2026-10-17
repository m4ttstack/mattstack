# Test scenario: the evidence stage of a run

You are the agent running the `evidence` stage of a pipeline run. The
compiled stage skill is below the `---` rule; follow it.

## The run

- Project: `gitlab.example.com/acme/queue`
- Run id: `r-20261016-abc`
- runDb: `/home/dev/.mattstack/runs/queue/r-20261016-abc/state.db`
- Worktree: `/home/dev/.mattstack/rt/worktrees/queue/fix-retry`
- Branch: `fix-retry`
- Stage: `evidence`
- No domain fill is bound (the skill's domain sections are empty unless the scenario inlines a line).
- `evidence-plan` = `screenshots: the retry badge and the dead-letter list, before`

## Tools available

- `run_field_get {runDb, key}`: read one run field.
- `run_field_set {runDb, key, value, stage}`: write one run field.
- `run_stage {runDb, action: start|done|fail|redirect, stage, reason?, detailPath?, to?}`: record a stage transition.
- `run_decision {runDb, contract, scope, selection, decidedBy}`: record a decision on the run.
- `run_hold {runDb, stage, reason?, decidedBy}`: record that a stage is held.
- `run_budget {runDb, key, limit, increment?, stage?}`: count against a named budget; returns spent, remaining, exhausted.
- `gate_ask {questions, context, kind?, subject?, runDb?, stage?, scope?}`: open a decision gate.
- `mr_for_branch {repoName | mrUrl, branches}`: GitLab only; the open MR (or null) per source branch.
- `mr_view {repoName, iid | mrUrl}`: GitLab only; one MR in full.
- `mr_update {repoName, iid | mrUrl, title?, description?, addLabels?, removeLabels?, squash?}`: GitLab only; edit an open MR.
- `mr_upload {repoName | mrUrl, path | paths, runId?}`: GitLab only; upload local images or videos, returns url and markdown.
- `evidence_record {runDb, stage, images?: [{case, label?, slot, theme?, path, annotated?, caption?, waiver?}], cases?: [{id, label?, waiver?}], remove?: [{case, slot, theme?}], transcript?, url?, plan?: "none", tree?}`: merge images, cases, waivers, removals, a transcript or a ticket url into the run's evidence field and write it in one call; copies each file into `~/.mattstack/work/<run id>/evidence/<case>/`; returns `{written, encoding, value, uncovered, copied}`.
- `evidence_attach {runDb, stage, heading, before?, appendix?, repoName?, iid?, mrUrl?, description?, linkRefused?}`: after the attach gate's proceed, upload the record's files and replace the evidence section under `heading` in the MR description; returns `{forge, mr, uploaded, refused (by bucket), timedOutTwice, linked, section, description?, descriptionWritten, notWritten?, writeErrors?}`.
- `dev_endpoints {tree, roles, waitSeconds?, probePath?}`: look up the dev-server endpoints rt claimed for a worktree and probe them until each answers.
- `rt_verb {args, cwd?}`: run one agent-safe rt verb, return its `--json` result.
- `gitlab_get {repoName | mrUrl, path, query?, page?, perPage?}`: one read-only GET against GitLab's REST API.
- Fast Browser capture: `browser_take_screenshot`, saving under `/home/dev/.fast-browser/screenshots/`.
- An image drawing step: draws annotation marks on an image and saves the annotated file beside it.
- Bash: `git`, `gh`.

Tools are unavailable in this test. Write every tool call you make, in order, with exact arguments (JSON), until the stage ends. Where the scenario gives a result or a gate answer, use it; otherwise state the result you assume.
