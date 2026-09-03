# RED/GREEN: editing-skills fill rules name verb.path and pack.path

Reference-skill retrieval fixture, run 2026-09-02 evening, one tool-less sonnet subagent per arm. Scenario: a fill needs (a) a pointer to the pack's compiled `checkout` verb, (b) a command running `resolve-target.py` from a different attachment `evidence-tools/`, (c) the `gitlab-mr-threads` include. The subagent answers with the three references exactly as they would appear in the fill. Run order: the edit was committed first and this fixture run after, against the pre-edit text via git history; the discipline calls for the reverse, recorded here as run.

## RED (pre-edit rules: only the include is placeholder-shaped)

Reply, verbatim:

> (a) Follow the pack's compiled `checkout` verb before proceeding with this step.
>
> (b) `python3 parts/evidence-tools/resolve-target.py`
>
> (c) `{{include:gitlab-mr-threads}}`

Verdict: FAIL as intended. (a) is prose with no path a reader can follow; (b) invents a `parts/evidence-tools/` path that exists in no host (the vendoring rewrite covers only files beside the fill); (c) correct. The harness prepended a classifier warning banner to this arm's delivery; the reply content above is the whole answer and contains no action.

## GREEN (committed rules: verb.path and pack.path named)

Reply, verbatim:

> (a) Follow the pack's compiled checkout verb at {{verb.path:checkout}}.
>
> (b) `python3 {{pack.path:evidence-tools/resolve-target.py}}`
>
> (c) {{include:gitlab-mr-threads}}

Verdict: PASS. Both new placeholders used exactly, the include unchanged.

Remedy required: none; the text committed at ded3f38 stands.
