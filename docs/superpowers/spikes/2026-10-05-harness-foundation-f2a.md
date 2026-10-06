# Isolated harness foundation F2a — implementation and verification

**Status: implementation reviewed; completion BLOCKED by one full-suite timeout.**
Only the five files authorized by the [F2a decision](../plans/2026-10-05-harness-integrations-b0-admission-decision.md)
were implemented. They are disconnected from existing runtime callers. This is
an implementation checkpoint, not a claim of a passing release or completed F2a.

## Workspace and rebase

All task edits, builds and tests ran in the `huan` linked worktree on
`harness-integrations`. The canonical checkout was not edited. At the user's
request, 28 feature commits were rebased cleanly onto `origin/main` at
`7a62b66d2`; the rebased execution base is `21bace497`. In-progress source was
copied and stashed, then restored with identical hashes. The pre-rebase branch
and owned recovery stash remain available. No push, merge, deployment or
shared-service restart occurred.

## Implemented boundary

Portable and runtime type declarations cover sessions, messages, questions,
policy, skills and installation using the approved vocabulary and existing
canonical gate/setup/plugin types. The pure registry snapshots membership,
preserves integration identity, rejects duplicate IDs and returns no match for
unknown IDs. Pure admission refuses unready or unsupported workflows.

Factory/capability consistency is checked at the type boundary, with nine
negative compile fixtures. The registry does not invoke asynchronous probes or
wrap caller-owned implementations. This is an explicit scope interpretation:
native report validation, option routing, built-ins and entrypoint exposure
remain F2b. If later runtime requirements need different typing, the disconnected
contracts may need revision. Synthetic fixtures do not prove native capabilities.

## Verification

| Check | Result |
| --- | --- |
| Unchanged compatibility, before changes | 130 passed; 419 assertions |
| Same selection after rebase | 130 passed; 419 assertions |
| New behavior against throwing pre-implementation stubs | 11 failed as expected |
| New behavior after implementation | 11 passed; 27 assertions |
| Root TypeScript, including negative compile fixtures | Passed |
| Unchanged compatibility after implementation | 130 passed; 419 assertions |
| rt-client build | Passed |
| Full static check, first attempt after rebase | Failed: stale installed Board dependency |
| Board typecheck after frozen dependency refresh | Passed |
| Full static check after reviewed dependency correction | Passed |
| Compiled CLI selection | 42 passed; 189 assertions |
| Full root suite | 14,575 passed, 3 skipped, 1 failed; 41,014 assertions, 4 snapshots, 882 files |

The root failure is `lib/daemon/__tests__/hooks-guard.test.ts`:
`refreshWatchedRepos closes and drops a watcher whose repo left the index (relocated or removed)`.
It took 5,306.67ms against the unchanged 5,000ms deadline. No assertion was
weakened and no deadline changed. The first static failure is retained too:
rebase changed Board's locked `invadrs` from 0.2.1 to 0.3.0, while `node_modules`
was still on 0.2.1. `bun install --frozen-lockfile --ignore-scripts` installed one
package inside huan, leaving source and lock unchanged. Independent review
approved that causal disposition; the entire static gate then passed.

## Bounded watcher diagnostic

The independent reviewer specified at most ten instrumented runs, stopping on
the first failure or operation over one second. It stopped on its **first** run.
An ignored copy preserves the five tests and normal deadlines, adds phase
timings, and uses the existing `watchFn` seam to time the actual native watcher
and its actual `close()`. An external supervisor samples the owned Bun process
when a phase lasts more than one second.

The reconciliation case passed in 3,100.54ms, but native watcher creation took
571.25ms and the two closures took 1,489.73ms and 1,028.39ms. The sample captured
the main thread waiting in `_os_unfair_lock_lock_slow` while the CFThreadLoop
was mostly in FSEvents registration RPC and partly in unregister RPC. Both
repair-preflight paths had no managed hooks in the isolated HOME. This directly
localizes latency in the diagnostic. It does not reconstruct the exact original
5,306ms timeout, prove every historical timeout has the same cause, or establish
a completed fix. No further passing repetitions were requested.

## Review and next action

The independent code reviewer approved the five-file scope with no findings;
full verification was explicitly pending. The same reviewer approved the
post-rebase dependency correction and required the bounded watcher diagnostic.
F2a remains stopped after the root failure. F2b and every live integration task
remain blocked.

The next proposed change is a separate test-only correction: inject a controlled
watcher into both watcher bookkeeping tests using the existing seam, retain
all original assertions, and add explicit closure/lifetime assertions. A first
candidate changing reconciliation alone exposed the same timeout in the
manual-error test (5,496ms), so that candidate is retained as failed. The revised
candidate passes five tests and 26 assertions; two deliberate production-copy
mutations prove its added assertions detect both stale-watcher and error-path
leaks. This deliberately removes native watcher registration from those two
unit tests; it does not fix native Bun/macOS watcher latency. Real Git repair
and creation-error tests remain. The [exact proposal](../plans/2026-10-05-f2a-watcher-test-proposal.md)
was independently approved with no findings. It requires user approval because
it changes an existing file outside F2a scope; the patch remains unapplied.

Commands, source hashes, logs and diagnostic artifact hashes are recorded in
the [evidence manifest](2026-10-05-harness-foundation-f2a-evidence.json). Raw logs,
stack samples and temporary diagnostics remain local and ignored.
