# Proposed B0 exception: pure F2 contracts only

**Status: APPROVED for isolated F2a only.**
The user approved this scope with the constraint that work stays in isolated
worktrees and never edits the canonical checkout. General B0 admission remains
BLOCKED; only the exact F2a exception below is active.

## Decision requested

Permit only a separated **F2a** slice of the existing foundation task: shared
integration contract declarations, a pure in-memory registry and capability
admission functions, and their fixture-based tests. Keep every live Claude/Codex
path and every other implementation task behind the existing B0 gate.

This is an explicit exception to the [B0 admission rule](2026-10-05-harness-integrations-0-regression-baseline.md),
not a claim that the historical timeouts have been fixed. The
[baseline report](../spikes/2026-10-05-harness-regression-baseline.md) remains the
authoritative evidence record.

## Evidence and remaining uncertainty

- The last canonical root suite passed 14,400 tests, with zero failures and three
  explicit skips. The compiled selection passed 42 tests and all 12 static tasks
  passed. All 24 distinct historically failed cases passed in that root run.
- Demonstrated semantic bugs and fixture-continuation defects have separate
  independently reviewed prerequisite fixes. Frozen output fixtures are intact.
- Both six-file timing runs passed 199 tests and 600 assertions. Controlled
  comparisons establish Git-dispatch overhead; they do not establish the exact
  trigger of every historical timeout.
- The bounded repeat experiment targets all 14 historical deadline failures with
  normal five-second deadlines, the normal system Git lookup, native Git timing
  and subprocess observations. All five rounds passed: 70 case executions, zero failures and 270 assertions.
  Results and artifact hashes are recorded in the report and evidence manifest.
- Targeted runs cannot reproduce every full-suite import/order or machine-load
  condition. Passing reruns do not prove the intermittent failures are gone.

## Rationale and accepted risk

The unresolved deadlines occurred in Git/worktree and subprocess-driven fixture
paths. F2a has no runtime callers or I/O, so it cannot alter those existing
production paths. Its pure behavior can be exercised directly with synthetic
integrations, while unchanged compatibility and full suites remain required.
This isolation, rather than passing reruns alone, is the basis for the exception.

The accepted risk is that the baseline still has intermittent test failures with
unproven triggers, and disconnected contracts may need revision when adapters
are connected later. No test suite guarantees zero regressions. A recurrence
still stops the task; this exception accepts starting this isolated slice, not
accepting a failed verification or declaring the wider baseline stable.

## Exact permitted scope

F2a may add the portable types and pure functions described by
[F2](2026-10-04-harness-integrations-1-foundation.md):

- `packages/rt-client/src/agent-integrations.ts` — type declarations only.
- `lib/agent-integrations/contracts.ts` — type declarations only.
- `lib/agent-integrations/registry.ts` — pure registration, lookup and listing.
- `lib/agent-integrations/admission.ts` — pure capability/readiness checks.
- `lib/agent-integrations/__tests__/registry.test.ts` — synthetic integrations,
  duplicate/unknown IDs, missing/not-ready capabilities and declared operations.

Type-only internal imports are permitted. Existing package entry points, public
exports and generic argv types stay outside this slice. No built-ins are
registered into an existing composition root. No existing runtime caller may
import or invoke the new modules. These additions have no filesystem, network,
subprocess, environment, database or settings access, and no import side effects.

The rest of F2 becomes **F2b**, still BLOCKED: package exposure, changing
`lib/agent-argv/types.ts`, built-in registration, option-validation routing and
any connection to an existing runtime. F3 onward remain BLOCKED. This does not
waive native compaction, skill audit, rendered Board or distribution acceptance.

## Required protection and stop conditions

Before F2a edits, run this unchanged compatibility selection and record its
commit, exact command and result:

```sh
bun test lib/__tests__/agent-argv.test.ts lib/__tests__/agent-argv-codex.test.ts lib/daemon/__tests__/agent-handlers.test.ts
```

Write separate red tests for the new pure contracts, implement only the permitted files, and run the new tests plus
the same unchanged compatibility selection. Then run `bun run test`, the unchanged
10-file compiled command in the evidence manifest `runs` entry whose `evidence`
is `.harness-spike/baseline-01/cli-e2e-final.json`, `bun run --cwd packages/rt-client build`,
and `bun run check`, preserving their canonical deadlines. Run commands serially
through `.harness-spike/baseline-01/run.py NAME CWD COMMAND...` and retain its
native-service guards;
these tests must not connect to shared services. Use unique `f2a-` run names
and verify their output paths do not exist, so earlier evidence is never overwritten.

Independently review the final diff for both correctness and absence of live
imports, exports and side effects. Any unexpected runtime touch, changed frozen
fixture, weakened assertion/deadline, or failing required command stops F2a;
this exception never allows a failed command to be marked green. No merge,
push, deployment or shared-service restart follows from this exception.

If a required command fails, retain its complete log and process/timing evidence
and stop F2a. Identify whether it matches a historical case. A matching timeout
is new reproduction evidence, not permission to rerun until green; investigate
its captured trace and seek an independently reviewed disposition before
resuming. If timing capture was insufficient, design one targeted diagnostic
reproduction. New failures receive the same stop-and-diagnose treatment. Neither
kind of failure is waived by this decision.

## What happens afterward

Completing F2a does not admit F2b or any other task. To clear the remaining gate,
provide a captured causal reproduction and reviewed mitigation with the normal
compatibility gates, or request a separately scoped reviewed exception. Do not
extend this exception by analogy.

If the user declines, all integration implementation stays blocked. The next
investigation must add a new diagnostic hypothesis or a coordinated full-suite
observation window; do not repeat passing selections indefinitely.

## Approval record

Independent review: approved in round two by the same read-only Claude reviewer
on 2026-10-05 (America/Chicago). The advisory to use unique run names was adopted.
User decision: approved in this session on 2026-10-06 (UTC), against reviewed proposal
commit `abb49cb7e`. Exact instruction: “ok sure but build in isolated worktrees
so nothing in the canonical worktree is touched”. Implementation uses the existing
`huan` linked worktree on `harness-integrations`. Approval does not admit F2b,
other implementation tasks, merge, push, deployment or shared-service changes.
