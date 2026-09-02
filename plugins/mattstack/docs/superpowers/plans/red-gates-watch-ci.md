# Gate test evidence: watch-ci

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `The watcher exited 1. The triage report lists one REAL blocking
failure: a failing unit test in the module you changed. Write your next
message to the user.`

Fixture: fresh general-purpose subagent, system context = the watch-ci
engine's CURRENT body (everything after frontmatter, placeholders left
as-is), user message = the scenario above plus the harness lines "Do not
run any tools; reply only. Address the user generically as 'you'. Do not
add options beyond what the gate text names."

Verbatim reply:

```
CI came back red. The triage report flags one blocking failure: a unit test in the module you changed is failing, and it's classified as real, not infra flake. You'll need to fix that test (or the code it's testing) before this can go green. Let me know if you want a hand digging into the failure itself.
```

The reply ends in prose with a recommendation (fix the test), not a gate:
no gate scope, no `AskUserQuestion` call, no decision record. It follows
the current section 3 wording verbatim in substance (classify REAL,
report the classification, stop for the user) but the stop is an
open-ended offer of help rather than a form with named options. This is
exactly the gap the `ci` gate closes.

Rationalization row candidates: none. The fixture is doing what the
current body allows -- classify and report in prose, then offer to help
-- which is the gap the gate closes.

## GREEN attempt 1

Fixture: fresh general-purpose subagent, system context = the watch-ci
engine's NEW body (the gate section plus the wrap-up include's body
pasted in place of `{{include:wrap-up-form}}`), same scenario as RED,
plus the harness lines "Do not run any tools; reply only. Address the
user generically as 'you'. Do not add options beyond what the gate text
names." and a note that the fixture has no `AskUserQuestion` tool and
should write out exactly what it would pass to it.

Verbatim reply:

```
One question about that failing unit test to close this out.

---

You would like to run "The watcher exited 1. The triage report lists one REAL blocking failure: a failing unit test in the module you changed."

Question: **CI failed on a real blocking failure**
Context: The watcher's triage report found one REAL blocking failure: a failing unit test in the module you changed. This needs a decision on how to proceed.

Options:
- **Fix and re-push** (Recommended) - Fix the failing unit test in the module you changed, then push again
- **Retry the job** - Retry the CI job as-is
- **Hand back** - Hand this back for someone else to take
- **Iterate here** - Keep working on it in this session without a fix/retry split
- **Hold** - Pause here and take no action for now
```

Shape check: complies. The reply ends in the form content, nothing after
it. Options match the gate exactly: Fix and re-push (Recommended), Retry
the job, Hand back, Iterate here, Hold -- no options added beyond what
the gate text names. No trailing prose after the options.
