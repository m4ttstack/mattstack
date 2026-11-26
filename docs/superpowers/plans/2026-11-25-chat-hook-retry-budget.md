# Chat sign-in hook retry budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat plugin's SessionStart sign-in hook gives up in about 4s of retrying (two daemon calls at 2s each) when no daemon answers, and still signs in through a daemon restart.

**Architecture:** No rt code change. The hook sets `RT_DAEMON_RETRY_BUDGET_MS=2000` on its `rt chat sign-in` call; rt-client reads that variable at call time (`retryBudgetOverride()` in `packages/rt-client/src/transport.ts`) and it overrides every call's own budget. Sign-in makes two daemon calls before it fails with no daemon: `pane:self` (via `liveSelfPaneRef()`, `lib/self-pane.ts`) then `chat:sign-in`. Tests pin rt-client's handling of the budget, the hook passing it, and the real hook path end to end.

**Tech Stack:** bash (hook + its offline test), bun test (rt-client).

**Spec:** `docs/superpowers/specs/2026-11-25-chat-hook-retry-budget-design.md`

## Global Constraints

- Budget value: `2000` (ms), set only on the `rt chat sign-in` call, never on `rt settings get`.
- The hook still always exits 0 and prints nothing on failure.
- Chat plugin `version` in `marketplace/plugins/chat/.claude-plugin/plugin.json` goes one past main's right before the push (main is `0.6.1` today).
- Run tests from the worktree root. rt-client: `bun test packages/rt-client/test/transport.test.ts`. Hook: `bash marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh`.
- Real-rt runs only under a sandbox HOME with `RT_DAEMON_SOCK` and `RT_APP_SOCKET` pointed into the sandbox, `NODE_ENV=test`, `RT_SKIP_SETUP=1`, `CI=true`. Never against the real HOME or daemon.
- No em or en dashes in docs prose.

## Review Focus

1. A stale `rt.sock` (a bound socket whose owner died) must give up inside the same budget, not return at once or hang. Task 1 uses the file's `staleSocket()` helper and bounds both sides.
2. The prefix assignment `RT_DAEMON_RETRY_BUDGET_MS=2000 rt ...` must still find `rt` on PATH and keep the session cwd. Task 2's cwd assertion (`@ $REPO`) on the sign-in call covers it.
3. A non-JSON or failed sign-in still exits 0 silently. Existing cases in `test-auto-sign-in.sh` stay green (Task 2 Step 4).
4. The settings read does not get the variable. Task 2 asserts `budget=` on it.
5. The test preload sets `RT_DAEMON_RETRY_BUDGET_MS=0`; Task 1 tests set and restore it themselves, and Task 3 sets it only through the hook (its `env` clears any inherited value).
6. The pane lookup is a second daemon call that also takes the env budget. Task 3 runs with `HERDR_PANE_ID` and `CLAUDE_CODE_SESSION_ID` set, so its timing includes it.

---

### Task 1: rt-client honours a 2s hook budget; docs name the knob

**Files:**
- Test: `packages/rt-client/test/transport.test.ts` (inside `describe("rtCommand: retry while the daemon restarts", ...)`, next to the `RT_DAEMON_RETRY_BUDGET_MS=0` test)
- Modify: `docs/release-and-distribution.md`

**Interfaces:**
- Consumes: `rtCommand`, and the describe block's helpers `freshSock()`, `staleSocket()`, `serveLater(sock, ms)` (replies `{ ok: true, data: { n: 1 } }`), `stops`.
- Produces: nothing new.

These tests characterise existing behaviour, so they pass on first run. Mutation check: set the value to `"20000"` in the first test and confirm it fails (by its bound or bun's 5s test timeout), then revert.

- [ ] **Step 1: Write the tests**

Each sets `process.env.RT_DAEMON_RETRY_BUDGET_MS = "2000"`, restores the prior value in `finally` (same pattern as the `=0` test), and calls `rtCommand("ping", {}, { sockPath: sock })` with no `timeoutMs` and no `retryBudgetMs`.

```ts
test("RT_DAEMON_RETRY_BUDGET_MS=2000 (the chat hook's budget): no daemon gives up in about 2s", ...)
  // sock = freshSock(), nothing ever listens
  expect(res.ok).toBe(false);
  expect(elapsed).toBeGreaterThanOrEqual(1_900);
  expect(elapsed).toBeLessThan(3_500);

test("RT_DAEMON_RETRY_BUDGET_MS=2000: a stale socket gives up in about 2s", ...)
  // sock = await staleSocket()
  expect(res.ok).toBe(false);
  expect(elapsed).toBeGreaterThanOrEqual(1_900);
  expect(elapsed).toBeLessThan(3_500);

test("RT_DAEMON_RETRY_BUDGET_MS=2000: a daemon that comes up 1s later is answered", ...)
  // sock = freshSock(); serveLater(sock, 1_000)
  expect(res).toEqual({ ok: true, data: { n: 1 } });
```

- [ ] **Step 2: Run**

Run: `bun test packages/rt-client/test/transport.test.ts`
Expected: all pass. Then the mutation check; revert.

- [ ] **Step 3: Docs**

`docs/release-and-distribution.md` has "### The daemon restart" twice, identical (lines 349-385 and 386-422 today). Delete the second copy (from its heading up to the line before "### Requiring an intermediate update"). Then, in the remaining section, after the bullet that ends "`rt events wait` and `rt gate wait` reconnect.", add:

```markdown
- A caller on a time limit of its own, such as a Claude Code hook, shortens
  the retry: set `RT_DAEMON_RETRY_BUDGET_MS=<ms>` in its environment, which
  bounds each daemon call it makes, or pass a per-call timeout of 5 seconds or
  less. The chat plugin's sign-in hook sets 2000; its sign-in makes two daemon
  calls, so with no daemon it gives up after about 4 seconds.
```

Run: `grep -c "### The daemon restart" docs/release-and-distribution.md` → `1`.

- [ ] **Step 4: Commit**

```bash
git add packages/rt-client/test/transport.test.ts docs/release-and-distribution.md
git commit -m "rt-client: pin the 2s hook retry budget; document RT_DAEMON_RETRY_BUDGET_MS"
```

### Task 2: the sign-in hook sets the budget

**Files:**
- Modify: `marketplace/plugins/chat/hooks/auto-sign-in.sh:34`
- Test: `marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh`

**Interfaces:**
- Produces: the hook line `result="$(RT_DAEMON_RETRY_BUDGET_MS=2000 rt chat sign-in --session "$session_id" --json 2>/dev/null)" || exit 0`.

- [ ] **Step 1: Write the failing test**

In the stub `rt` heredoc, record the variable it saw:

```bash
echo "$* @ $PWD budget=${RT_DAEMON_RETRY_BUDGET_MS:-}" >> "$RT_STUB_CALLS"
```

Update the expected-call constants:

```bash
SETTINGS_CALL="settings get chat.autoSignIn --repo $REPO --json @ $REPO budget="
SIGNIN_CALL="chat sign-in --session sess-a --json @ $REPO budget=2000"
```

Add `-u RT_DAEMON_RETRY_BUDGET_MS` to `run()`'s `env` call. Fix any other literal expected-call strings in the file the same way.

- [ ] **Step 2: Run to see it fail**

Run: `bash marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh`
Expected: `FAIL on: reads the setting, then signs in from the session cwd` (got `budget=` on the sign-in line).

- [ ] **Step 3: Change the hook**

`auto-sign-in.sh:34` becomes the Interfaces line, with one comment above it: the hook's limit is 10s, rt retries an absent daemon for 20s per call by default, and sign-in makes two daemon calls.

- [ ] **Step 4: Run all three chat hook tests**

Run: `for t in marketplace/plugins/chat/hooks/tests/test-*.sh; do bash "$t" || echo "FAILED $t"; done`
Expected: every line `ok`, no `FAILED`.

- [ ] **Step 5: Commit**

```bash
git add marketplace/plugins/chat/hooks/auto-sign-in.sh marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh
git commit -m "chat: sign-in hook gives up after about 4s when no daemon answers"
```

### Task 3: real-path test of the hook against real rt

**Files:**
- Test: `marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh` (a new section at the end, before the summary/exit)

**Interfaces:**
- Consumes: Task 2's hook line.

- [ ] **Step 1: Write the section**

Find the repo's `cli.ts` at `"$DIR/../../../../../cli.ts"`; if it or `bun` is missing (the published marketplace copy), print `skip real-rt: no cli.ts` and skip the section. Otherwise build a second sandbox `bin/rt` wrapper:
- `settings get` → answers `{"ok":true,"key":"chat.autoSignIn","value":true}` itself.
- anything else → `exec bun "$CLI" "$@"`.

Run the hook through a `real_run` helper like `run()` but with `env -u RT_DAEMON_RETRY_BUDGET_MS`, `HOME=$SANDBOX/realhome`, `RT_DAEMON_SOCK=$SANDBOX/rt.sock`, `RT_APP_SOCKET=$SANDBOX/tray.sock`, `NODE_ENV=test`, `RT_SKIP_SETUP=1`, `CI=true`, `CLAUDE_CODE_SESSION_ID=sess-r`, `HERDR_PANE_ID=w1:p1`, payload session id `sess-r`, timing it with `date +%s` (or `$SECONDS`).

Cases:

```bash
# no daemon: silent, exit 0, well inside the 10s hook limit
check "real rt, no daemon: no stdout" "" "$out"
check "real rt, no daemon: exits 0" "0" "$rc"
check "real rt, no daemon: ends inside 7s" "yes" "$([ "$elapsed" -lt 7 ] && echo yes || echo no)"

# a daemon that binds 1s in: signs in
# start: bun -e 'setTimeout(() => Bun.serve({ unix: SOCK, fetch(req) { ... } }), 1000)' &, kill its PID after
#   /pane:self    -> {"ok":true,"data":{"paneId":null}}
#   /chat:sign-in -> {"ok":true,"data":{"handle":"remy.k3f9","baseHandle":"remy","name":"mattstack-beorn"}}
#   /chat:join    -> {"ok":true,"data":{"memberCount":1}}
#   anything else -> {"ok":true,"data":{}}
check "real rt, late daemon: injects the signed-in note" "<expected note>" "$out"
```

The expected note uses whatever room the sandbox repo yields (`--json` prints `room`; a non-git cwd gives `null`, so expect the no-room note). Match the `chat:sign-in` data fields to `Commands["chat:sign-in"]["data"]` in `packages/rt-client/src/`. Kill the fake daemon by its PID only, and remove `$SANDBOX/rt.sock` before the next case.

- [ ] **Step 2: Run**

Run: `bash marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh`
Expected: all `ok`. Mutation check: temporarily set the hook's value to `20000` and confirm "ends inside 7s" fails; revert.

- [ ] **Step 3: Commit**

```bash
git add marketplace/plugins/chat/hooks/tests/test-auto-sign-in.sh
git commit -m "chat: test the sign-in hook against real rt with and without a daemon"
```

### At ship time (not a task)

Right before `git_push`: `git fetch origin main`, read main's chat `plugin.json` version, set ours one past it, commit `chat: bump to <v>`. Then `bun run typecheck`.
