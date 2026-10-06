# Isolated harness foundation F2a — implementation and verification

**Status: approved watcher prerequisite applied; F2a completion still BLOCKED.**
The five disconnected foundation files and the separately approved watcher test
prerequisite are implemented. No existing production caller is wired to the new
contracts. The latest full suite passed 14,573 tests and failed three other
cases; this is not a completed F2a or passing release claim.

## Approved prerequisite verification — 2026-10-06

The user approved the exact watcher patch at checkpoint `9e3d77e36` with
“approved”. Target and patch hashes were checked before application, and
`/root/f2a_review` independently confirmed that the applied diff matches the
reviewed candidate, preserves existing assertions/deadlines, and changes no
production code. Work remains entirely in huan.

| Required check after application | Result |
| --- | --- |
| Watcher focused suite | 5 passed; 26 assertions |
| Unchanged compatibility | 130 passed; 419 assertions |
| Foundation tests | 11 passed; 27 assertions |
| rt-client build | Passed |
| Full static check | Passed; 12/12 final tasks, 8 cached |
| Compiled CLI selection | 42 passed; 189 assertions |
| Full root suite | 14,573 passed, 3 skipped, 3 failed; 41,018 assertions; 882 files |

The watcher tests passed in the full run. The three remaining failures are:

1. The API WebSocket-origin test failed during server startup, before its
   security assertions: port 49364 remained unavailable after six bind attempts
   (2,607.46ms). API test and server source match `origin/main`.
2. Marketplace publication into an empty local repo timed out at 7,164.78ms
   against its 5,000ms deadline, with empty child output.
3. Marketplace deletion propagation timed out at 5,001.18ms; its `git ls-tree`
   command failed. These are offline fixtures using local bare repositories.

All logs and the failed run remain recorded. No deadlines, assertions or
production paths were changed in response, and the full suite was not rerun.
The earlier watcher/static failures below remain historical evidence.

### Bounded API diagnostic

The independent reviewer specified one instrumented copy with unchanged tests,
retry policy and deadlines. The first invocation omitted Bun's `./` path prefix
and ran no tests; that error log is retained. The corrected invocation ran once:
10 passed, 35 assertions, no bind retry. **The collision was not reproduced.**

The copy records native server/probe hostnames and ports, requested/resolved
settings, retry warnings, and stop-promise timing. All ten probe shutdown
settlement callbacks were observed after API startup began. Probe hostname was reported as
`localhost`, API hostname as `127.0.0.1`; these strings do not establish the
actual socket address family. Neither this sequence nor the passing diagnostic
proves the original collision's cause. The test's logger discarded the original
port-holder evidence. A later read-only socket observation shows OrbStack's
local port 49320 connected to remote 49364; it does not identify the owner of
the failed listening endpoint.

The suggested port-zero candidate was not pursued: production uses the requested
port in its 404 docs URL, so that candidate cannot preserve the existing URL
assertion without another behavior/coverage decision. No API test patch has
been applied or approved. F2b and all live integration work remain blocked.


### Marketplace trace analysis and next boundary

Read-only analysis maps the empty-publish case to a roughly 7,059ms interval
between stage initialization and the next test, with no later remote/fetch/push
trace for that stage. This mapping partly depends on sequential test order.
In the dropped-file case, both local pushes exited zero, and recorded top-level
Git calls total about 321ms. Two stage-init-to-remote gaps account for roughly
4,281ms; the failing final `ls-tree` has no native Git start event.

Those gaps include uninstrumented script work and process dispatch/cancellation;
they are not evidence that Git, Python or optional Claude validation caused the
timeouts. The test and script match the run commit and the inspected remote
source. The detailed timeline and mapping limits are retained in the manifest's
`marketplace-analysis` artifacts. No marketplace test was rerun.

**Next work:** prepare a separately reviewed baseline-reliability investigation
covering (1) actual API probe socket addresses and port ownership at a failing
bind, and (2) marketplace script-phase/child-process timings, including parent
cancellation and cleanup. Use bounded diagnostics with existing assertions,
Git/native selection and deadlines. Do not resume full-suite repetitions or
F2b based on the passing API diagnostic. No additional API/marketplace source
change is authorized by the watcher approval.

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

## Earlier review and watcher proposal

The independent code reviewer approved the five-file scope with no findings;
full verification was explicitly pending. The same reviewer approved the
post-rebase dependency correction and required the bounded watcher diagnostic.
At this earlier checkpoint F2a stopped after the watcher failure. F2b and every
live integration task remain blocked.

The separate test-only correction proposed at that checkpoint was: inject a controlled
watcher into both watcher bookkeeping tests using the existing seam, retain
all original assertions, and add explicit closure/lifetime assertions. A first
candidate changing reconciliation alone exposed the same timeout in the
manual-error test (5,496ms), so that candidate is retained as failed. The revised
candidate passes five tests and 26 assertions; two deliberate production-copy
mutations prove its added assertions detect both stale-watcher and error-path
leaks. This deliberately removes native watcher registration from those two
unit tests; it does not fix native Bun/macOS watcher latency. Real Git repair
and creation-error tests remain. The [exact proposal](../plans/2026-10-05-f2a-watcher-test-proposal.md)
was independently approved with no findings and subsequently approved by the
user and applied, as recorded above.

Commands, source hashes, logs and diagnostic artifact hashes are recorded in
the [evidence manifest](2026-10-05-harness-foundation-f2a-evidence.json). Raw logs,
stack samples and temporary diagnostics remain local and ignored.
