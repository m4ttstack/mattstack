# Chat sign-in hook: a short daemon retry budget (RT-616)

## Intent

Since daemon restart continuity (#1255), an `rt` call keeps retrying for up to
20s while the daemon is unreachable. The chat plugin's SessionStart sign-in
hook (`marketplace/plugins/chat/hooks/auto-sign-in.sh`) has a 10s limit. With
the daemon down for good, Claude Code kills it at 10s, where it used to skip at
once, so every new session starts slowly with a failed hook.

## Goals

- With no daemon, the sign-in hook ends well inside 10s and exits 0.
- With the daemon mid-restart (a gap of about 1s), the hook still signs in.
- Every other hook that calls `rt` stays inside its own limit.

Non-goals: changing rt's 20s default, its cool-off, or any interactive call.

## Approaches

1. **In the hook, via `RT_DAEMON_RETRY_BUDGET_MS` (picked).** The hook runs
   `rt chat sign-in` with `RT_DAEMON_RETRY_BUDGET_MS=2000`. rt-client has read
   that variable at call time since #1255, so this works with every rt that has
   the 20s retry, and an older rt ignores it. The variable becomes a documented
   contract for hook callers.
2. In rt, a new `--hook` flag on `rt chat sign-in`. The behavior is named in
   rt, but the plugin and rt must ship in step.
3. A shorter default for `rt chat sign-in` everywhere. No plugin change, but an
   interactive sign-in during a restart also gets only 3s.

The shepherd picked 1.

## Design

- `auto-sign-in.sh`: prefix the sign-in call with
  `RT_DAEMON_RETRY_BUDGET_MS=2000`. `rt settings get` runs in-process and never
  touches the daemon, so it needs no budget.
- Sign-in makes two daemon calls before it gives up with no daemon. First
  `liveSelfPaneRef()` (`lib/self-pane.ts`) asks `pane:self`, since the hook
  runs only with `HERDR_PANE_ID` set and Claude Code exports
  `CLAUDE_CODE_SESSION_ID`; it falls back to the env pane on failure. Then
  `chatSignIn`, which fails the command (`chatJoin` runs only after it
  succeeds). The env var overrides each call's own budget (the lookup's 2s
  included), and a 2s budget never reaches the 20s cool-off threshold, so each
  call retries its full 2s: about 4s of retrying, plus two rt process starts
  and git spawns. That leaves several seconds of the 10s limit.
- A restart: the pane lookup absorbs the first 2s of the gap and sign-in the
  next 2s, so a gap of up to about 4s still signs in. The old daemon can answer
  "stopping" for up to 5s while in-flight requests drain, so a long drain can
  outlast it; the hook then skips, as it does with no daemon, and the user
  signs in by hand. Fitting 5s would cost the no-daemon case its margin.
- Bump the chat plugin's `version` one past main's right before the push.
- Docs: in `docs/release-and-distribution.md`, under "The daemon restart", add a
  bullet: a caller on its own time limit shortens the retry with
  `RT_DAEMON_RETRY_BUDGET_MS=<ms>`, or with a per-call timeout of 5s or less.
  The chat sign-in hook sets 2000. The file has that section twice,
  word for word (a merge artifact); delete the second copy.

## Other hooks (checked on main)

| Hook | Limit | Bound today |
|---|---|---|
| chat `session-end.sh` (`rt chat sign-out`) | 5s | CLI passes `timeoutMs: 3000`, so the retry is 3s |
| `scripts/hooks/gate-fork.sh` (`rt gate fork-check`) | 10s | `timeoutMs: 5000`, so the retry is 5s |
| mattstack `pipeline-gate-stop.sh` | 30s | `bounded_rt` caps all `rt` calls at 25s |
| mattstack `superpowers-execution-note.sh` | 5s | `settings get` (no daemon), 3s subprocess cap |
| fresh-context mod exit call | n/a | `timeoutMs: 1000`, so the retry is 1s |
| mattstack `account-record.sh` (`rt usage record-account`) | 5s | local, no rt-client transport |
| mattstack `disable-model-invocation-reapply.sh` (`rt skills disable-model-invocation reapply`) | 5s | local, no rt-client transport |
| mattstack `progress-record.sh` (`rt progress record`) | 5s | local, no rt-client transport |

Nothing else needs a change.

## Tests

- `marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh`: the stub records
  the `RT_DAEMON_RETRY_BUDGET_MS` it receives, and the case asserts the sign-in
  call gets `2000` while the settings read gets nothing.
- The same file, real path: when the repo's `cli.ts` is reachable, the hook
  runs against real `rt chat sign-in` (only the settings read is stubbed) under
  a sandbox HOME and socket, with `HERDR_PANE_ID` and `CLAUDE_CODE_SESSION_ID`
  set. With no daemon it ends inside 7s, silently, exit 0. With a fake daemon
  that binds the socket 1s in, it prints the signed-in note.
- `packages/rt-client/test/transport.test.ts`: with the env var at 2000, a
  missing and a stale socket give up in about 2s, and a server that binds 1s
  late is answered.

## Left to the builder

The exact test file in `packages/rt-client/test/` and the docs wording.
Note: the chat hook tests are not run by CI today (`checks.yml` runs only the
mattstack plugin's hook tests). Wiring them in is outside this job's write
fence, so the report flags it.
