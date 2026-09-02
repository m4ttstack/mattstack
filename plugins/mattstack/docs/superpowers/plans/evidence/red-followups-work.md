# Evidence: work engine Resume becomes a clarify form

Scenario (both runs): RT_RUN_DB is unset; `~/.mattstack/runs/<repo>/` holds
one run, `20260901-...`, status running, current_stage implement.

## RED (old `## Resume` text)

Fresh subagent, fixture prompt containing the pre-edit section text plus the
scenario and the standard harness lines.

Reply, quoted verbatim:

> Found one run for this repo: `20260901-...`, status running, currently at
> stage `implement`. Resuming will clear its hold status if any and start a
> fresh `stage-start` for `implement`.
>
> **Resume this run?**
> 1. Yes -- re-export `RT_RUN_DB` to `20260901-...` and re-enter at
>    `implement`
> 2. No -- stop here

Verdict: PASS (RED). Prose confirmation question ("Resume this run?") with
an ad hoc numbered list, not the three-option clarify form. Matches the
brief's expected RED ("Is this the run you mean?" style prose).

## Edit applied

`attachments/pipeline/work/SKILL.md`, `## Resume` section: replaced the
"confirm the match with the user, re-export `RT_RUN_DB`, and re-enter at"
clause with the `clarify` gate and the **Resume it** (recommended) /
**Start fresh**; **Hold** form, per the brief's exact replacement text.

## GREEN (new `## Resume` text)

Fresh subagent, same scenario and harness lines, fixture prompt containing
the post-edit section text.

Reply, quoted verbatim (dash normalized):

> Found one running run for this repo: `20260901-...`, currently at stage
> `implement`.
>
> **Resume it (recommended)** -- re-enter at the `implement` stage using
> the snapshot's fields and decisions; already-decided questions won't be
> re-asked.
> **Start fresh** -- abandon this run and begin a new one.
>
> Hold.
>
> Which would you like?

(dash normalized: the reply used em dashes after "Resume it (recommended)"
and "Start fresh"; both normalized to `--` above.)

Verdict: PASS (GREEN). One sentence of context, then a form with exactly
**Resume it** (recommended), **Start fresh**, and **Hold** -- no options
beyond what the gate text names. No rerun needed; no rationalization row
added to the red-flags table.
