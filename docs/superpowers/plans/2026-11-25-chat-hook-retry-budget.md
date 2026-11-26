# Chat sign-in hook retry budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat plugin's SessionStart sign-in hook gives up in about 3s when no daemon answers, and still signs in through a daemon restart.

**Architecture:** No rt code change. The hook sets `RT_DAEMON_RETRY_BUDGET_MS=3000` on its `rt chat sign-in` call; rt-client already reads that variable at call time (`retryBudgetOverride()` in `packages/rt-client/src/transport.ts`). Tests pin both halves: the hook passes the variable, and rt-client honours a 3000ms budget against a dead and a late socket. Docs name the variable as the hook knob.

**Tech Stack:** bash (hook + its offline test), bun test (rt-client).

**Spec:** `docs/superpowers/specs/2026-11-25-chat-hook-retry-budget-design.md`

## Global Constraints

- Budget value: `3000` (ms), set only on the `rt chat sign-in` call, not on `rt settings get`.
- The hook still always exits 0 and prints nothing on failure.
- Chat plugin `version` in `marketplace/plugins/chat/.claude-plugin/plugin.json` goes one past main's right before the push (main is `0.6.1` today, so `0.6.2` unless main moved).
- Run tests from the worktree root. rt-client tests: `bun test packages/rt-client/test/transport.test.ts`.
- No em or en dashes in docs prose.

## Review Focus

1. A socket file that exists with no listener (stale `rt.sock` after a crash): must give up inside the same 3s, not hang. Covered by Task 1's dead-socket test using `freshSock()` (missing file) and the existing stale-socket path; Task 1 adds a stale-file variant.
2. The `env VAR=... rt` form must still find `rt` on PATH and keep the session cwd. Covered by Task 2's existing cwd assertion (`@ $REPO`) on the sign-in call.
3. A non-JSON or failed sign-in still exits 0 silently. Existing cases in `test-auto-sign-in.sh` cover it; Task 2 must keep them green.
4. The settings read must not get the variable (it would be harmless, but the spec scopes it to sign-in). Covered by Task 2's assertion.
5. The test preload sets `RT_DAEMON_RETRY_BUDGET_MS=0`; Task 1 tests must set and restore it themselves, or they prove nothing.

---

### Task 1: rt-client honours a 3s hook budget; docs name the knob

**Files:**
- Test: `packages/rt-client/test/transport.test.ts` (inside `describe("rtCommand: retry while the daemon restarts", ...)`, next to the `RT_DAEMON_RETRY_BUDGET_MS=0` test)
- Modify: `docs/release-and-distribution.md` ("### The daemon restart" bullet list)

**Interfaces:**
- Consumes: `rtCommand`, and the file's existing helpers `freshSock()`, `serveLater(sock, ms)`, `stops`.
- Produces: nothing new.

These tests characterise behaviour that already exists, so they are expected to pass on first run. To prove each can fail, temporarily set the env value in the test to `"20000"` and confirm the first test fails its upper bound (then revert).

- [ ] **Step 1: Write the tests**

Both set `process.env.RT_DAEMON_RETRY_BUDGET_MS = "3000"` and restore the prior value in `finally` (same pattern as the `=0` test), and call `rtCommand("ping", {}, { sockPath: sock })` with no `timeoutMs` and no `retryBudgetMs`.

```ts
test("RT_DAEMON_RETRY_BUDGET_MS=3000 (the chat hook's budget): no daemon gives up in about 3s", ...)
  // sock = freshSock(), nothing ever listens
  expect(res.ok).toBe(false);
  expect(elapsed).toBeGreaterThanOrEqual(2_900);
  expect(elapsed).toBeLessThan(4_500);

test("RT_DAEMON_RETRY_BUDGET_MS=3000: a stale socket file with no listener also gives up in about 3s", ...)
  // sock = freshSock(); writeFileSync(sock, "") before the call
  expect(res.ok).toBe(false);
  expect(elapsed).toBeLessThan(4_500);

test("RT_DAEMON_RETRY_BUDGET_MS=3000: a daemon that comes up 1s later is answered", ...)
  // sock = freshSock(); serveLater(sock, 1_000)
  expect(res).toEqual({ ok: true, data: { n: 1 } });
```

Match `serveLater`'s actual reply shape in the file if it differs from `{ ok: true, data: { n: 1 } }`. If the stale-file case is already covered with an env budget elsewhere in the file, drop it.

- [ ] **Step 2: Run**

Run: `bun test packages/rt-client/test/transport.test.ts`
Expected: all pass. Then the mutation check above: with `"20000"` the no-daemon test fails on `toBeLessThan(4_500)` (it will also need the test timeout raised; bun's default is 5s, so it fails by timeout, which counts). Revert.

- [ ] **Step 3: Docs bullet**

In `docs/release-and-distribution.md`, "### The daemon restart", after the bullet that ends "`rt events wait` and `rt gate wait` reconnect.", add:

```markdown
- A caller on a time limit of its own, such as a Claude Code hook, shortens
  the retry: set `RT_DAEMON_RETRY_BUDGET_MS=<ms>` in its environment, or pass
  a per-call timeout of 5 seconds or less. The chat plugin's sign-in hook
  sets 3000, so with no daemon it gives up in about 3 seconds.
```

- [ ] **Step 4: Commit**

```bash
git add packages/rt-client/test/transport.test.ts docs/release-and-distribution.md
git commit -m "rt-client: pin the 3s hook retry budget; document RT_DAEMON_RETRY_BUDGET_MS"
```

### Task 2: the sign-in hook sets the budget

**Files:**
- Modify: `marketplace/plugins/chat/hooks/auto-sign-in.sh:34`
- Test: `marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the hook line `result="$(RT_DAEMON_RETRY_BUDGET_MS=3000 rt chat sign-in --session "$session_id" --json 2>/dev/null)" || exit 0`.

- [ ] **Step 1: Write the failing test**

In the stub `rt` (the heredoc in `test-auto-sign-in.sh`), change the recorded line to include the variable it saw:

```bash
echo "$* @ $PWD budget=${RT_DAEMON_RETRY_BUDGET_MS:-}" >> "$RT_STUB_CALLS"
```

Update the two expected-call constants:

```bash
SETTINGS_CALL="settings get chat.autoSignIn --repo $REPO --json @ $REPO budget="
SIGNIN_CALL="chat sign-in --session sess-a --json @ $REPO budget=3000"
```

Make sure `run()` clears any inherited `RT_DAEMON_RETRY_BUDGET_MS` (add `-u RT_DAEMON_RETRY_BUDGET_MS` to its `env` call) so the assertion is about the hook, not the caller. Fix any other literal expected-call strings in the file the same way.

- [ ] **Step 2: Run to see it fail**

Run: `bash marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh`
Expected: `FAIL on: reads the setting, then signs in from the session cwd` (got `budget=` on the sign-in line).

- [ ] **Step 3: Change the hook**

`auto-sign-in.sh:34` becomes the line in Interfaces. Add one comment line above it stating the constraint: the hook's limit is 10s and rt retries an absent daemon for 20s by default.

- [ ] **Step 4: Run all three chat hook tests**

Run: `for t in marketplace/plugins/chat/hooks/tests/test-*.sh; do bash "$t" || echo "FAILED $t"; done`
Expected: every line `ok`, no `FAILED`.

- [ ] **Step 5: Commit**

```bash
git add marketplace/plugins/chat/hooks/auto-sign-in.sh marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh
git commit -m "chat: sign-in hook gives up after 3s when no daemon answers"
```

### At ship time (not a task)

Right before `git_push`: `git fetch origin main`, read main's chat `plugin.json` version, set ours one past it, commit `chat: bump to <v>`. Then `bun run typecheck`.
