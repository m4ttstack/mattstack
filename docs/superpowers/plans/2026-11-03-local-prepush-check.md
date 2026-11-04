# Local Pre-push Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt check` runs a repo's own scoped check in a tree; `git_push` refuses a red push and posts the verdict on the pushed sha as a GitHub commit status.

**Architecture:** A library under `lib/check/` (settings read, command run, summary parse, result cache, forge status) with a CLI verb in `commands/check.ts` over it and a pre/post seam in the `git_push` MCP tool. mattstack's own check command is a script that reuses `scripts/ci/test-scope.ts`. Every external effect (git, the command, `gh`, the clock, the cache file) is a dep so the tests run with fakes.

**Tech Stack:** Bun, TypeScript, `bun test`, `gh` CLI for the GitHub statuses API, the rt settings resolver (`@mattstack/rt-client`), the rt output layer (`lib/ui/out.ts`).

**Spec:** `docs/superpowers/specs/2026-11-03-local-prepush-check-design.md`

## Global Constraints

- Settings: one declared key `rt.check`, `repoScoped: true`, `repoOnly: true`, `scopes: ["user", "machine"]`, `merge: "deep"`, `default: {}`; read only through `getSetting`.
- Output: every human line through `lib/ui/out.ts`; a red check is a `failure`; "not configured" is a `refused` note and exit 0; `--json` goes through `out.json` and is pinned byte for byte; `lib/` code warns through `warn()` from `lib/ui/warn.ts`, never `console.*`.
- The CLI stays UI-free (no `.tsx`, no UI frameworks).
- Status context is `rt/local-check`; states `success`, `failure`, `error`; description capped at 140 characters.
- GitHub only: a GitLab host gets `{ posted: false, reason: "gitlab-not-supported" }`.
- Command env: `RT_CHECK_BASE`, `RT_CHECK_HEAD`, `RT_CHECK_TREE`, `RT_CHECK_FULL` (`"1"` or unset). Default `timeoutSeconds` 600.
- Cache: a green result is reused for 3_600_000 ms when tree root, HEAD sha, command string match and the tree is clean.
- `git_push` refusal is an `ok` result: `{ pushed: false, refusal: "check-red" | "check-error", check, next: "rt check" }`.
- Repo purity: no employer host, ticket id or customer name anywhere, fixtures included.
- Every agent-safe leaf declares `--json`; `rt check` sets `agentSafe: true` and `agentTimeoutMs: 660_000`.
- Each plugin change (the regenerated mcp-tools reference, a block edit) bumps `plugins/mattstack/.claude-plugin/plugin.json`; one bump per PR, one past main's at merge time.

## Review Focus

1. A check command that prints no JSON line and exits 0 must read as green with `mode: "exit"` and the measured wall time, never as an error. (Task 2 test `no summary line is a green exit`.)
2. A dirty tree still gates the push but must never post a status; the result says `status.posted: false, reason: "dirty-tree"`. (Task 3 test `a dirty tree gates but is not posted`.)
3. `gh` missing or unauthenticated must leave the push `pushed: true` with `check.status.posted: false` and a shown warning, never an error. (Task 5 test `a forge refusal never fails the push`.)
4. A command whose last stdout line is JSON but not an object (an array, a number) must be treated as no summary, not crash the parser. (Task 2 test `a non-object last line is no summary`.)
5. `skipCheck: true` must spawn nothing and post nothing, even on a repo with a configured command. (Task 7 test `skipCheck runs nothing and posts nothing`.)

---

### Task 1: The `rt.check` setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (beside `rt.hooks`, ~line 335)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (beside `"rt.hooks"`, ~line 191)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts` (beside `"rt.hooks"`, ~line 197)
- Modify: `apps/console/src/app/settings/groups.ts` (the `ci` group's `match`, ~line 63)
- Modify: `packages/rt-client/src/settings/schema.lock.json` (regenerated)

**Interfaces:**
- Produces: setting key `"rt.check"` with value type `Value<"rt.check">` = `{ command?: string; timeoutSeconds?: number }`.

- [ ] **Step 1: Add the registry row**

In `registry-defs.ts`, after `rt.hooks`:

```ts
{
  key: "rt.check",
  type: "object",
  scopes: ["user", "machine"],
  default: {},
  merge: "deep",
  repoScoped: true,
  repoOnly: true,
  description: "The repo's own pre-push check ({command, timeoutSeconds}). rt check runs command from the tree root with RT_CHECK_BASE, RT_CHECK_HEAD, RT_CHECK_TREE and RT_CHECK_FULL in its environment; exit 0 is green, and a last stdout line of JSON is the summary. git_push runs it first and refuses a red push. An empty object means no check: nothing runs and no status is posted. User or machine scope only, since the command runs without a prompt.",
},
```

- [ ] **Step 2: Add the schema**

In `registry-schemas.ts`:

```ts
"rt.check": z.looseObject({
  command: z.string().min(1).optional().meta({ title: "Command", description: "Run from the tree root by the shell; exit 0 is green" }),
  timeoutSeconds: z.number().int().positive().optional().meta({ title: "Timeout (seconds)", description: "A run past this posts error and refuses the push; default 600" }),
}),
```

- [ ] **Step 3: Add the examples**

In `schema-examples.ts`:

```ts
"rt.check": {
  good: [{}, { command: "bun scripts/ci/local-check.ts" }, { command: "bun run check:local", timeoutSeconds: 900 }],
  bad: [{ value: { command: 7 }, path: ["command"] }],
  layer: [{ timeoutSeconds: 300 }],
},
```

- [ ] **Step 4: Put the key in the console's `ci` group**

Change the `ci` group's `match` so it also admits `rt.check` (the group already matches `ci.`; use `key => key.startsWith('ci.') || key === 'rt.check'` or extend the existing `pattern`).

- [ ] **Step 5: Regenerate the lock and run the registry tests**

Run: `bun run cli.ts settings schema lock && bun test packages/rt-client/src/settings && bun run console:test -- groups`
Expected: PASS, and `git diff --stat` shows `schema.lock.json` changed.

- [ ] **Step 6: Rebuild rt-client's dist and commit**

```bash
(cd packages/rt-client && bun run build)
git add packages/rt-client/src/settings apps/console/src/app/settings/groups.ts
git commit -m "settings: declare rt.check, a repo's pre-push check command"
```

---

### Task 2: Summary parsing and the status description

**Files:**
- Create: `lib/check/summary.ts`
- Test: `lib/check/__tests__/summary.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CheckSummary = {
    mode: string;            // the command's word: "changed" | "full" | "skip" | "exit"
    selected: number | null;
    passed: number | null;
    failed: number | null;
    durationMs: number;
    failures: string[];
  };
  export type CheckVerdict = "green" | "red" | "error";
  export function parseSummary(stdout: string, exitCode: number, wallMs: number): CheckSummary;
  export function describe(verdict: CheckVerdict, summary: CheckSummary, machine: string, reason?: string): string;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe as group, expect, test } from "bun:test";
import { describe, parseSummary } from "../summary.ts";

group("parseSummary", () => {
  test("reads the last stdout line as the summary", () => {
    const s = parseSummary('noise\n{"mode":"changed","selected":95,"passed":95,"failed":0,"durationMs":41200,"failures":[]}\n', 0, 50_000);
    expect(s).toEqual({ mode: "changed", selected: 95, passed: 95, failed: 0, durationMs: 41200, failures: [] });
  });
  test("no summary line is a green exit", () => {
    expect(parseSummary("ran fine\n", 0, 12_000)).toEqual({ mode: "exit", selected: null, passed: null, failed: null, durationMs: 12_000, failures: [] });
  });
  test("a non-object last line is no summary", () => {
    expect(parseSummary("[1,2]\n", 0, 100).mode).toBe("exit");
    expect(parseSummary("42", 1, 100).mode).toBe("exit");
  });
  test("a partial object keeps what it has and fills the rest", () => {
    expect(parseSummary('{"mode":"full","failed":2}', 1, 9_000)).toEqual({ mode: "full", selected: null, passed: null, failed: 2, durationMs: 9_000, failures: [] });
  });
});

group("describe", () => {
  const green = { mode: "changed", selected: 95, passed: 95, failed: 0, durationMs: 41_200, failures: [] };
  test("green names mode, count, time and machine", () => {
    expect(describe("green", green, "hilbert")).toBe("changed: 95 tests in 41s on hilbert");
  });
  test("full and long runs read in minutes and seconds", () => {
    expect(describe("green", { ...green, mode: "full", selected: 22236, durationMs: 372_000 }, "hilbert")).toBe("full: 22236 tests in 6m12s on hilbert");
  });
  test("skip says nothing ran", () => {
    expect(describe("green", { ...green, mode: "skip", selected: 0 }, "hilbert")).toBe("skip: nothing to run for this diff");
  });
  test("red counts failures and names the first file with a +n tail", () => {
    const red = { ...green, failed: 2, failures: ["lib/__tests__/x.test.ts", "lib/__tests__/y.test.ts"] };
    expect(describe("red", red, "hilbert")).toBe("red: 2 of 95 failed, lib/__tests__/x.test.ts +1");
  });
  test("an exit-only green names the exit and the time", () => {
    expect(describe("green", { mode: "exit", selected: null, passed: null, failed: null, durationMs: 12_000, failures: [] }, "hilbert")).toBe("exit 0 in 12s on hilbert");
  });
  test("error carries its reason", () => {
    expect(describe("error", green, "hilbert", "timed out after 600s")).toBe("error: timed out after 600s");
  });
  test("never exceeds 140 characters", () => {
    const long = { ...green, failed: 1, failures: ["a/".repeat(90) + "z.test.ts"] };
    expect(describe("red", long, "hilbert").length).toBeLessThanOrEqual(140);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/check/__tests__/summary.test.ts`
Expected: FAIL, module `../summary.ts` not found.

- [ ] **Step 3: Implement `parseSummary` and `describe` in `lib/check/summary.ts`**

`parseSummary` takes the last non-empty stdout line, `JSON.parse` in a try, accepts only a plain object, and fills missing fields with `null`/`[]`; `durationMs` is the object's number when present, else `wallMs`. `describe` formats seconds under 60 as `41s` and otherwise `6m12s`, and truncates a too-long result to 137 characters plus `...`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/check/__tests__/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/check/summary.ts lib/check/__tests__/summary.test.ts
git commit -m "check: parse a command's summary line and word the status"
```

---

### Task 3: Running the configured check

**Files:**
- Create: `lib/check/run.ts`
- Test: `lib/check/__tests__/run.test.ts`

**Interfaces:**
- Consumes: `parseSummary`, `CheckSummary`, `CheckVerdict` (Task 2); `getSetting` from `@mattstack/rt-client` resolve as `lib/settings/resolve.ts` re-exports it; `identityForRootReadOnly(repoRoot)` from `lib/repo.ts`; `GitRunner` from `lib/mcp/git-tools.ts`; `runCapture` from `lib/subprocess.ts`.
- Produces:
  ```ts
  export type CheckConfig = { command: string; timeoutSeconds: number };
  export type CheckResult = {
    configured: true;
    verdict: CheckVerdict;
    summary: CheckSummary;
    sha: string;
    base: string;
    dirty: boolean;           // tracked modifications or non-ignored untracked files
    command: string;
    reason?: string;          // error verdict: "timed out after 600s" | "command could not start: ..."
    outputTail: string;       // last 20 lines of combined output, for a red
    fromCache: boolean;
  } | { configured: false };
  export type RunDeps = {
    git: GitRunner;
    exec: typeof runCapture;
    setting: (repoIdentity: string) => { command?: string; timeoutSeconds?: number };
    now: () => number;
  };
  export function readConfig(tree: string, deps: Pick<RunDeps, "setting">): CheckConfig | null;
  export async function runCheck(tree: string, opts: { full?: boolean; base?: string }, deps: RunDeps): Promise<CheckResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Fakes: a `GitRunner` keyed on the joined args (the pattern in `lib/mcp/__tests__/git-tools.test.ts`), answering `rev-parse --verify HEAD` → `abc123`, `symbolic-ref refs/remotes/origin/HEAD` → `refs/remotes/origin/main`, `merge-base HEAD origin/main` → `base456`, `status --porcelain` → `""` (clean) or `" M lib/x.ts"` (dirty). An `exec` fake records argv, cwd, env and returns a scripted `{ exitCode, stdout, stderr }`.

```ts
test("an unconfigured repo is configured: false and runs nothing", async () => { /* setting → {} ; exec never called */ });
test("runs the command from the tree root with the base, head, tree and full env", async () => {
  /* assert exec argv is ["/bin/sh", "-c", "bun x"], cwd is tree, env.RT_CHECK_BASE === "base456", RT_CHECK_HEAD === "abc123", RT_CHECK_TREE === tree, RT_CHECK_FULL undefined; with full: true it is "1" */
});
test("exit 0 with a summary line is green", async () => { /* verdict green, summary.selected 95, fromCache false */ });
test("exit 1 is red and carries the output tail", async () => { /* verdict red, outputTail is the last 20 lines */ });
test("a timeout is an error with its reason", async () => { /* exec returns exitCode null-ish/timedOut → verdict "error", reason "timed out after 600s"; timeoutMs passed to exec equals 600_000 */ });
test("a command that cannot start is an error", async () => { /* exec exitCode 127, stdout "" → verdict "error", reason starts "command could not start" */ });
test("a dirty tree gates but is not posted", async () => { /* status --porcelain non-empty → dirty: true; verdict still computed */ });
test("--base overrides the merge base", async () => { /* opts.base "origin/feat" → RT_CHECK_BASE "origin/feat" and no merge-base call */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/check/__tests__/run.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `readConfig` and `runCheck`**

`readConfig` resolves the identity with `identityForRootReadOnly(tree)` and reads `deps.setting(identity)`; a missing or empty `command` is `null`; `timeoutSeconds` defaults to 600. `runCheck` reads HEAD, the default branch (`symbolic-ref refs/remotes/origin/HEAD`, falling back to `main`), the merge base, and dirtiness, then runs `["/bin/sh", "-c", config.command]` through `deps.exec` with `cwd: tree`, `stderr: "pipe"`, `timeoutMs`, and `env: { ...childEnv(), RT_CHECK_BASE, RT_CHECK_HEAD, RT_CHECK_TREE, ...(full ? { RT_CHECK_FULL: "1" } : {}) }`. Verdict: timed out → `error`; exit 127 or a spawn failure → `error`; exit 0 → `green`; else `red`. `outputTail` is `outputTail(stdout + stderr, 20 lines)`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/check/__tests__/run.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/check/run.ts lib/check/__tests__/run.test.ts
git commit -m "check: run a repo's configured command against the push's base"
```

---

### Task 4: The green-result cache

**Files:**
- Create: `lib/check/cache.ts`
- Test: `lib/check/__tests__/cache.test.ts`

**Interfaces:**
- Consumes: `CheckResult` (Task 3); `rtDir()` from `lib/rt-paths.ts`.
- Produces:
  ```ts
  export const CHECK_CACHE_TTL_MS = 3_600_000;
  export type CacheDeps = { now: () => number; read: (path: string) => string | null; write: (path: string, body: string) => void };
  export function cachePath(): string;                       // join(rtDir(), "check-results.json")
  export function cacheKey(tree: string, sha: string, command: string): string;
  export function readCached(key: string, deps: CacheDeps): Extract<CheckResult, { configured: true }> | null;
  export function writeCached(key: string, result: Extract<CheckResult, { configured: true }>, deps: CacheDeps): void;
  ```
  Only a `green`, non-dirty result is ever written; `readCached` returns `null` past the TTL or on unreadable JSON; the returned result has `fromCache: true`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a green clean result is written and read back as fromCache", ...);
test("a red result is never written", ...);
test("a dirty green result is never written", ...);
test("an entry past one hour is not returned", ...);
test("a corrupt cache file reads as empty and is overwritten on the next write", ...);
test("the key separates tree, sha and command", ...);
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/check/__tests__/cache.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the cache**

One JSON object `{ [key]: { at: number, result } }` at `cachePath()`, written whole through `deps.write` (the real deps use `mkdirSync` + `writeFileSync` to a temp name and `renameSync`, as `lib/skills/plugin-list-cache.ts` does). Entries past the TTL are dropped on write.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/check/__tests__/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/check/cache.ts lib/check/__tests__/cache.test.ts
git commit -m "check: keep a green result for an hour so a push after rt check runs once"
```

---

### Task 5: Posting the commit status

**Files:**
- Create: `lib/check/status.ts`
- Test: `lib/check/__tests__/status.test.ts`

**Interfaces:**
- Consumes: `describe`, `CheckVerdict`, `CheckSummary` (Task 2); `repoHost(serialized)` and `repoLabel(serialized)` from `lib/repo-label.ts`; `warn` from `lib/ui/warn.ts`.
- Produces:
  ```ts
  export const STATUS_CONTEXT = "rt/local-check";
  export type StatusOutcome = { posted: true; context: string; state: "success" | "failure" | "error"; description: string } | { posted: false; reason: "dirty-tree" | "gitlab-not-supported" | "unknown-host" | "gh-failed" | "not-on-remote"; detail?: string };
  export type StatusDeps = { exec: typeof runCapture; hostname: () => string };
  export function stateFor(verdict: CheckVerdict): "success" | "failure" | "error";
  export async function postStatus(identity: string, sha: string, result: Extract<CheckResult, { configured: true }>, deps: StatusDeps): Promise<StatusOutcome>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("a github identity posts through gh api with context, state and description", async () => {
  /* exec argv: ["gh", "api", "repos/<owner>/<repo>/statuses/<sha>", "-f", "state=success", "-f", "context=rt/local-check", "-f", "description=changed: 95 tests in 41s on hilbert"]; posted true */
});
test("a dirty result is not posted", async () => { /* reason "dirty-tree", exec never called */ });
test("a gitlab identity is not posted and says so", async () => { /* reason "gitlab-not-supported" */ });
test("a forge refusal never fails the push", async () => { /* exec exitCode 1 stderr "gh: Not Found" → posted false, reason "gh-failed", detail carries stderr; a warning is logged via setWarningLog fake */ });
test("red maps to failure and error to error", () => { expect(stateFor("red")).toBe("failure"); expect(stateFor("error")).toBe("error"); });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/check/__tests__/status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `postStatus`**

Pick the backend by `repoHost(identity)`: `github.com` → `gh api` as the test spells it, owner/repo from `repoLabel(identity)`; a host whose provider is GitLab → `gitlab-not-supported`; anything else → `unknown-host`. A non-zero `gh` exit calls `warn("check", message, { show: "rt could not post the local check's status: <detail>" })` and returns `gh-failed`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/check/__tests__/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/check/status.ts lib/check/__tests__/status.test.ts
git commit -m "check: post the verdict as a GitHub commit status on the sha"
```

---

### Task 6: The `rt check` verb

**Files:**
- Create: `commands/check.ts`
- Create: `lib/check/index.ts` (the one entry both the verb and `git_push` call)
- Modify: `lib/command-tree-def.ts` (a top-level `check` node beside `sync`, ~line 1010)
- Modify: `lib/module-registry.ts` (`"./commands/check.ts"` entry)
- Modify: `lib/__tests__/agent-safe.test.ts` (add `"check"` to the listed leaves)
- Test: `commands/__tests__/check.test.ts`, `commands/__tests__/check-json-frozen.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces:
  ```ts
  // lib/check/index.ts
  export type CheckRun = { result: CheckResult; status: StatusOutcome | null };
  export type CheckDeps = RunDeps & CacheDeps & StatusDeps & { onRemote: (tree: string, sha: string) => Promise<boolean> };
  export const realCheckDeps: CheckDeps;
  export async function checkTree(tree: string, opts: { full?: boolean; base?: string; post: boolean }, deps: CheckDeps): Promise<CheckRun>;
  // commands/check.ts
  export async function checkCommand(ctx: CommandContext): Promise<void>;
  ```
  `checkTree` reads the cache first (green, clean, same key → `fromCache: true`, no run), runs otherwise, writes a green clean result, and posts only when `opts.post`, the tree is clean and `onRemote` is true; otherwise `status` carries the reason (`not-on-remote` when the sha is not on the remote).

- [ ] **Step 1: Write the failing tests**

`commands/__tests__/check.test.ts`, through `renderPlain`/`captureOut` as `commands/__tests__/skills*.test.ts` do, with `checkTree` faked through the command's deps seam:

```ts
test("unconfigured prints a refused note and exits 0", ...);           // stderr starts "No pre-push check is configured for <label>"; mentions `rt settings set rt.check`
test("green prints the result line", ...);                               // "changed: 95 tests in 41s"
test("red fails with the failing files as a verbatim block", ...);     // UserActionableError title "2 of 95 tests failed", next "rt check", verbatim lists failures
test("a cached result says so", ...);                                    // line carries "(from a run 3m ago)" style hint: "reused the green run from 14:32"
test("--no-status skips posting and says the status was not posted", ...);
```

`commands/__tests__/check-json-frozen.test.ts`, modelled on `commands/__tests__/settings-json-frozen.test.ts`: `rt check --json` on a faked green prints exactly

```json
{"configured":true,"verdict":"green","sha":"abc123","base":"base456","dirty":false,"fromCache":false,"summary":{"mode":"changed","selected":95,"passed":95,"failed":0,"durationMs":41200,"failures":[]},"status":{"posted":true,"context":"rt/local-check","state":"success","description":"changed: 95 tests in 41s on hilbert"}}
```

with an empty stderr, and the unconfigured case prints `{"configured":false}`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test commands/__tests__/check.test.ts commands/__tests__/check-json-frozen.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/check/index.ts`, `commands/check.ts`, the tree node and the registry entry**

Tree node (plain-language description per the command-tree rule):

```ts
check: {
  description: "Run this repo's own pre-push check here and post the result on the commit",
  module: "./commands/check.ts",
  fn: "checkCommand",
  agentSafe: true,
  agentTimeoutMs: 660_000,
  args: [
    { name: "Full", flag: "--full", type: "boolean", default: false, hint: "Ask the repo's command for its whole suite, not the scoped selection" },
    { name: "No status", flag: "--no-status", type: "boolean", default: false, hint: "Run without posting the result on the commit" },
    { name: "Base", flag: "--base", type: "text", placeholder: "origin/main", hint: "Diff against this ref instead of the merge base with the default branch" },
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Print the result as JSON" },
  ],
},
```

`checkCommand` resolves the tree from cwd through the same root lookup `commands/sync.ts` uses, calls `out.payloadOnStdout()` under `--json`, runs `checkTree` under one transient step ("Running this repo's check"), then prints: a `refused` note for unconfigured; a result `line` for green (with `on <machine>` and the posted/not-posted hint); `out.fail` for red with the `verbatim` failures block; `out.fail` for error with the reason and the output tail.

- [ ] **Step 4: Run the tests, the agent-safe test and the command-tree checks**

Run: `bun test commands/__tests__/check.test.ts commands/__tests__/check-json-frozen.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/command-tree*.test.ts lib/__tests__/module-registry.test.ts && bun run cli.ts check --json`
Expected: PASS; the live run in this worktree prints `{"configured":false}` (no setting yet).

- [ ] **Step 5: Commit**

```bash
git add commands/check.ts lib/check/index.ts lib/command-tree-def.ts lib/module-registry.ts lib/__tests__/agent-safe.test.ts commands/__tests__/check.test.ts commands/__tests__/check-json-frozen.test.ts
git commit -m "rt check: run the repo's pre-push check and post the status"
```

---

### Task 7: `git_push` runs the check

**Files:**
- Modify: `lib/mcp/git-tools.ts` (`GitToolDeps` ~line 600, the `git_push` def and handler ~lines 631-644, `gitPush` return ~line 166)
- Modify: `lib/mcp/__tests__/git-tools.test.ts` (the `git_push reports what it pushed` group, ~line 286)
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump)

**Interfaces:**
- Consumes: `checkTree`, `CheckDeps`, `realCheckDeps` (Task 6); `postStatus` (Task 5).
- Produces: `GitToolDeps.check?: (tree: string, opts: { post: boolean }) => Promise<CheckRun>` (default `(tree, o) => checkTree(tree, o, realCheckDeps)`) and `GitToolDeps.postCheck?: typeof postStatus`. `git_push` input gains `allowRed?: boolean` and `skipCheck?: boolean`. Result gains `check: CheckRun | null` on success and, on refusal, `{ pushed: false, refusal: "check-red" | "check-error", check: CheckRun, next: "rt check" }`.

- [ ] **Step 1: Write the failing tests**

In the existing `git_push` group, with a `check` fake on deps:

```ts
test("an unconfigured repo pushes with check: null and spawns no check", ...);
test("a green check pushes, then posts the status on the pushed sha", ...);   // order: check called before PUSH in calls, postCheck after, with sha "abc123"
test("a red check refuses with check-red and next rt check, and pushes nothing", ...); // body: { pushed: false, refusal: "check-red", next: "rt check", check }, PUSH not in calls
test("an error check refuses with check-error", ...);
test("allowRed pushes a red check and posts failure", ...);
test("skipCheck runs nothing and posts nothing", ...);                         // check never called, body.check === null
test("a cached green is reused and posted", ...);                              // check returns fromCache true; postCheck called
test("a forge refusal never fails the push", ...);                             // postCheck → { posted: false, reason: "gh-failed" }; body.pushed true
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/mcp/__tests__/git-tools.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

In the handler, after the lease check and before `gitPush`: `checkOptional` admits `allowRed` and `skipCheck` (booleans). Unless `skipCheck`, `const run = await (deps.check ?? defaultCheck)(path, { post: false })`; `configured: false` → proceed with `check: null`; verdict `red`/`error` and not `allowRed` → `ok({ pushed: false, refusal: run.result.verdict === "red" ? "check-red" : "check-error", check: run, next: "rt check" })`. After a successful push, `run.status = await (deps.postCheck ?? postStatus)(identity, sha, run.result, deps)` when the result is clean, else `{ posted: false, reason: "dirty-tree" }`; merge `check: run` into the result. `gitPush` itself is unchanged. Update the tool `description` to name the check, the two flags and the refusal keys, in the same register as the lease sentence.

- [ ] **Step 4: Run the tests, regenerate the reference, bump the plugin**

Run: `bun test lib/mcp && bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`
Then bump `version` in `plugins/mattstack/.claude-plugin/plugin.json` by one patch past main's current value (re-check at merge time).
Expected: tests PASS; `git diff --stat` shows the reference changed.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/git-tools.ts lib/mcp/__tests__/git-tools.test.ts plugins/mattstack/attachments/mcp-tools/reference.md plugins/mattstack/.claude-plugin/plugin.json
git commit -m "git_push: run the repo's check first, refuse red, post the status"
```

---

### Task 8: mattstack's own check command

**Files:**
- Create: `scripts/ci/local-check.ts`
- Test: `scripts/ci/__tests__/local-check.test.ts`
- Modify: `docs/ci.md` (a "Before you push" section)
- Modify: `.claude/rules/ci-and-tests.md` (one paragraph naming the local check and its selection)

**Interfaces:**
- Consumes: `collectSources`, `decide`, `selectedTests`, `unitDirs`, `shardCount` from `scripts/ci/test-scope.ts`; `readTimings` is module-private there, so export it.
- Produces: a script whose exit code is the verdict and whose last stdout line is the summary object from Task 2's contract. Exported for the test: `planLocalCheck(base: string, head: string, full: boolean, scope: ReturnType<typeof collectSources>, changed: string[]): { mode: "skip" | "changed" | "full"; dirs: string[]; changedArg: string | null; extra: string[]; processes: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a docs-only diff plans skip and nothing runs", ...);
test("a typescript diff plans --changed=<base> plus the read-by-path extras", ...);        // extra from decide()
test("RT_CHECK_FULL plans the full suite with no --changed", ...);
test("a full-mode decision (the scope script itself) plans full", ...);
test("processes is max(1, floor(cores / 2)) capped at 6", ...);
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/ci/__tests__/local-check.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `scripts/ci/local-check.ts`**

`planLocalCheck` maps `decide({ event: "pull_request", changed, ...scope })` to a plan: `skip` → nothing; `changed` → `bun test <dirs> --changed=<base> --shard=i/n --timings=test-timings.json` per process plus one `bun test <extra>` when extras exist; `full` or `RT_CHECK_FULL` → the shards with no `--changed`. The `no-*` guards are not added (CI's `guards` job owns them) except under `RT_CHECK_FULL`, where `alwaysRunPaths()` joins the run. `main` reads `RT_CHECK_BASE`/`RT_CHECK_HEAD` (`git diff --name-only base..head`), runs the processes in parallel with `Bun.spawn` and `childEnv()`, collects `(fail)` lines per file header for `failures`, counts selected tests through `selectedTests`, and prints the summary JSON last; exit 1 if any process failed.

- [ ] **Step 4: Run the tests and a live scoped run**

Run: `bun test scripts/ci/__tests__/local-check.test.ts && RT_CHECK_BASE=$(git merge-base HEAD origin/main) RT_CHECK_HEAD=HEAD RT_CHECK_TREE=$PWD bun scripts/ci/local-check.ts | tail -1`
Expected: PASS, and the last line is a JSON summary whose `mode` is `changed` or `skip`.

- [ ] **Step 5: Document and commit**

Add to `docs/ci.md` a "Before you push" section: what `rt check` runs here, the setting value (`bun scripts/ci/local-check.ts`), and that the status is `rt/local-check`. Add one paragraph to `.claude/rules/ci-and-tests.md`.

```bash
git add scripts/ci/local-check.ts scripts/ci/__tests__/local-check.test.ts scripts/ci/test-scope.ts docs/ci.md .claude/rules/ci-and-tests.md
git commit -m "ci: a local pre-push check that picks what the shards would"
```

---

### Task 9: The ship stage names the new refusal

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-ship/gate-push-refused.block.md`
- Modify: `plugins/mattstack/attachments/pipeline/ship/flow/gate-push-refused.block.md`
- Modify: the compiled skills those blocks feed (`rt skills check` names them)

**Interfaces:** none; prose only.

- [ ] **Step 1: Load the skill-editing guides**

Invoke `mattstack:editing-skills` and `superpowers:writing-skills` before touching a block; follow their RED/GREEN recipe.

- [ ] **Step 2: Edit the two blocks**

Add one sentence to each: a `check-red` or `check-error` refusal is the repo's own pre-push check, fixed by running `rt check`, reading its failures and committing the fix, then Iterate; `allowRed: true` is a deliberate WIP push and needs the human's answer at this gate.

- [ ] **Step 3: Recompile and check**

Run: `bun cli.ts skills check --pack-dir plugins/mattstack --mattstack-dir "$(mktemp -d)" --strict`
Expected: no drift reported.

- [ ] **Step 4: Commit**

```bash
git add plugins/mattstack
git commit -m "ship: name the pre-push check's refusal at the push gate"
```

---

### Task 10: Configure this repo and verify end to end

**Files:** none in the tree; a settings write and a live run.

- [ ] **Step 1: Set the repo's check command**

Run: `bun run cli.ts settings set rt.check '{"command": "bun scripts/ci/local-check.ts"}' --scope user --repo github.com/m4ttstack/mattstack`
Expected: the write is accepted; `bun run cli.ts settings explain rt.check --repo github.com/m4ttstack/mattstack` shows the user layer.

- [ ] **Step 2: Run the verb on this branch**

Run: `bun run cli.ts check --no-status`
Expected: a step, then a green or red result line naming the mode and count; `bun run cli.ts check --json --no-status | head -c 200` starts with `{"configured":true`.

- [ ] **Step 3: Push through the tool and read the status**

After the branch is pushed with the real `git_push` tool (`allowRed` only if the run is red for a reason the PR explains), run:
`gh api repos/m4ttstack/mattstack/commits/$(git rev-parse HEAD)/statuses --jq '.[] | select(.context=="rt/local-check") | "\(.state) \(.description)"'`
Expected: one line, `success changed: N tests in Ns on <machine>`.

- [ ] **Step 4: Record the evidence in the PR body**

Paste the status line into the PR's Verification section.
