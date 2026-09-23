# Run protocol

One run = one fresh subagent (general-purpose, most capable model tier, no
conversation context) that drafts all five fixtures and writes one file per
fixture to `outputs/<run>/<fixture-file-name>`.

Prompt, verbatim, with `<STYLE>` replaced per run:

> You draft text that a developer will post under their own name. <STYLE>
> Then read each file in `docs/superpowers/tests/2026-09-22-writing-style-presets/fixtures/`
> and write exactly the text you would post, nothing else, to
> `docs/superpowers/tests/2026-09-22-writing-style-presets/outputs/<run>/<same file name>`.

| Run | `<STYLE>` |
| --- | --- |
| baseline | (empty) |
| reference | Before drafting, read `<REFERENCE_SKILL_DIR>/SKILL.md` and follow it; read `mr-writing-style.md` beside it before any PR description. |
| sparse / conversational / structured | Before drafting, read `skills/writing-style-<preset>/SKILL.md` in this repo and follow it; read the `pr-description.md` beside it before any PR description. |

`<REFERENCE_SKILL_DIR>` is the operator's own style skill; the controller supplies the path at dispatch and never commits it.

After a run: `sh docs/superpowers/tests/2026-09-22-writing-style-presets/check-floor.sh outputs/<run>`
and record the result, word counts per file (`wc -w`), and observations in
`results.md`. The controller, not the subagent, compares runs.
