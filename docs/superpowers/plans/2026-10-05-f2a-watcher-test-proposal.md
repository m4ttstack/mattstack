# Proposed watcher-test prerequisite for F2a

**Status: independently reviewed and approved as a proposal; not applied; user decision pending.**

## Exact decision

Authorize the [attached patch](../spikes/2026-10-05-f2a-hooks-guard-test.patch) to
one existing file, `lib/daemon/__tests__/hooks-guard.test.ts`, outside the five
new files covered by the current F2a approval. Apply only in the isolated huan
worktree. Production watcher code, test deadlines, existing assertions, frozen
fixtures and the canonical checkout stay unchanged.

## Why this is proposed

The full root suite passed 14,575 cases and failed only the watcher reconciliation
test at 5,306.67ms. A bounded instrumented copy captured native watcher creation
at 571ms and closures at 1,490ms and 1,028ms. Native sampling showed the main
thread waiting on a lock while the filesystem-event thread was in FSEvents RPCs.
This localizes the observed diagnostic delay, not the exact original timeout's
cause or the reason the OS was slow.

The first candidate isolated reconciliation alone, but its unchanged manual-error
test then timed out at 5,496ms. That failed candidate is retained. The revised
proposal isolates both bookkeeping tests using the already-existing `watchFn`
seam and EventEmitter-backed controlled watchers. The production guard and real
fixture paths still execute. Both tests retain their original assertions and
add close-count checks; reconciliation also checks retained identity, no extra
watcher creation and idempotent `closeAll`.

This deliberately removes native watcher registration/closure from those two
unit tests. It does not preserve that native coverage in this file, repair native
watcher performance, validate delivery of real filesystem events, or claim a
runtime guarantee. The two real Git repair tests and synchronous watch-creation
error test remain unchanged. Native watcher behavior remains a distinct runtime
concern; no supported version or service readiness claim follows from this patch.

## Candidate evidence

The revised ignored candidate passes all five tests and 26 assertions at the
normal deadlines. A controlled ignored copy of production code with only the
stale-watcher close removed causes the strengthened test to fail (expected one
close, observed zero). A separate control omitting error-path closure also fails
its new close-count assertion. Original source and tests have not been changed. Exact
commands and hashes are in the [F2a evidence manifest](../spikes/2026-10-05-harness-foundation-f2a-evidence.json); the failed root and failed
first candidate are not replaced by the passing candidate.

## Execution if approved

1. Verify the target file still has SHA256
   `93987f489b4f15ceef304cd841d36f3648054a3a47d161c03fc2dc65f55c3e99`.
   Verify the reviewed patch hash, then use `git apply --check --unidiff-zero`
   and `git apply --unidiff-zero` on the attached patch (zero-context format).
   Apply only the named test file, then run its normal focused suite.
2. Independently review the applied diff and verify no existing assertion/deadline or
   production code changed. Record this as a separate test prerequisite.
3. Run the required unchanged compatibility selection, new F2a tests, static
   check, compiled selection and full root suite with unique evidence names,
   normal deadlines and native-service guards. The prior rt-client build remains
   applicable only if its source/dependencies have not changed.
4. A new failure stops work for diagnosis and reviewed disposition. Do not rerun
   until green without a cause or disposition. Complete F2a only after all its
   required checks pass. F2b and every live integration task stay blocked.

No merge, push, deployment, shared-service restart, runtime watcher change or
broader test conversion is authorized by this decision. If declined, retain the
implementation checkpoint and mark F2a stopped; do not silently weaken its gate.

## Review and approval record

Independent candidate review: Approved by `/root/f2a_review` on 2026-10-06,
with no remaining findings. The reviewer verified the final patch against the
tested candidate, target and artifact hashes, both failed runs, and both
expected-red mutation controls. User decision: pending. Review approval only
makes this a concrete proposal; it does not authorize applying the patch.
