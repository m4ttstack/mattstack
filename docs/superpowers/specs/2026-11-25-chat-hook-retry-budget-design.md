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
   `rt chat sign-in` with `RT_DAEMON_RETRY_BUDGET_MS=3000`. rt-client has read
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
  `RT_DAEMON_RETRY_BUDGET_MS=3000`. `rt settings get` runs in-process and never
  touches the daemon, so it needs no budget. With the daemon down, sign-in
  fails at its first daemon call (`chatSignIn`); `chatJoin` runs only after it
  succeeds. So the worst case is about 3s plus process start-up.
- 3s covers the ~1s restart gap with room for a slow launchd start, and leaves
  7s of the 10s limit for start-up and the settings read.
- Bump the chat plugin's `version` one past main's right before the push.
- Docs: in `docs/release-and-distribution.md`, under "The daemon restart", add a
  bullet: a caller on its own time limit shortens the retry with
  `RT_DAEMON_RETRY_BUDGET_MS=<ms>`, or with a per-call timeout of 5s or less.
  The chat sign-in hook sets 3000.

## Other hooks (checked on main)

| Hook | Limit | Bound today |
|---|---|---|
| chat `session-end.sh` (`rt chat sign-out`) | 5s | CLI passes `timeoutMs: 3000`, so the retry is 3s |
| `scripts/hooks/gate-fork.sh` (`rt gate fork-check`) | 10s | `timeoutMs: 5000`, so the retry is 5s |
| mattstack `pipeline-gate-stop.sh` | 30s | `bounded_rt` caps all `rt` calls at 25s |
| mattstack `superpowers-execution-note.sh` | 5s | `settings get` (no daemon), 3s subprocess cap |
| fresh-context mod exit call | n/a | `timeoutMs: 1000`, so the retry is 1s |

Nothing else needs a change.

## Tests

- `marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh`: the stub records
  the `RT_DAEMON_RETRY_BUDGET_MS` it receives, and the case asserts the sign-in
  call gets `3000` while the settings read gets nothing.
- `packages/rt-client/test/`: with `RT_DAEMON_RETRY_BUDGET_MS=3000`, an
  `rtCommand` to a socket nobody listens on returns within about 3.5s, and one
  whose server binds about 1s later is answered.

## Left to the builder

The exact test file in `packages/rt-client/test/` and the docs wording.
Note: the chat hook tests are not run by CI today (`checks.yml` runs only the
mattstack plugin's hook tests). Wiring them in is outside this job's write
fence, so the report flags it.
