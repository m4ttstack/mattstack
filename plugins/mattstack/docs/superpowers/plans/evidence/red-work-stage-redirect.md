# RED/GREEN: the work engine's Redirect closes the abandoned row

Technique fixture, run 2026-09-02 evening, one tool-less sonnet subagent per arm. Scenario: at the ship gate (attempt 1, running) the human answers Go back to implement with the note "the helper needs a unit test"; the subagent lists the exact `rt runs` commands, in order.

## RED (recipe without the stage-redirect step)

> rt runs decision record --contract gate@1 --scope redirect:ship:1 --selection '{"from":"ship","to":"implement","reason":"the helper needs a unit test"}' --decided-by work
> rt runs field set commits - --stage implement
> rt runs field set mr - --stage ship
> rt runs stage-start --stage implement

Verdict: FAIL as intended: nothing closes the ship row, which stays `running` behind implement attempt 2 (the defect a live run showed on 2026-09-02).

## GREEN (recipe with step 2, `rt runs stage-redirect`)

> rt runs decision record --contract gate@1 --scope redirect:ship:1 --selection '{"from":"ship","to":"implement","reason":"the helper needs a unit test"}' --decided-by work
> rt runs stage-redirect --stage ship --to implement --reason "the helper needs a unit test"
> rt runs field set commits - --stage implement
> rt runs field set mr - --stage ship
> rt runs stage-start --stage implement

Verdict: PASS: the abandoned row closes as `redirected` before the produces clear, correct flags, correct order.

Remedy required: none.
