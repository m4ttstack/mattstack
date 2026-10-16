# Provision Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `worktree_provision` opt-in refusal codes, a read-only precheck, reuse of an existing tree (or a surviving local branch), run recording of `branch`/`worktree`, and an optional `run_budget` charge on refusal, while a default call behaves exactly as today.

**Architecture:** A new read-only daemon verb `worktree:provision-check` shares provision's branch-intent step through one extracted helper. The MCP tool in `lib/mcp/worktree-tools.ts` composes that verb, `worktree:provision`, and the `run_field_set`/`run_budget` handlers it finds in `runToolDefs()`. Pure ticket-matching helpers live in `lib/worktree/branch-name.ts`.

**Tech Stack:** Bun, TypeScript, `bun:test`, rt daemon IPC through `packages/rt-client`.

**Spec:** `docs/superpowers/specs/2026-10-16-provision-tools-design.md`

## Global Constraints

- No behavior change on a default call (no `codes`, `precheck`, `reuse`, `runDb`, `budget`): success adds only `kind: "provisioned"`; refusal text is byte-identical to today (`explainError(raw)`, or `resolveRepoTarget`'s message).
- Daemon error strings never change; the tool parses them.
- No skill edits; no new MCP tool; no CLI change; no edit to `lib/mcp/run-tools.ts`, `lib/mcp/mr-target.ts`, `lib/mcp/shared.ts`, `lib/explain-error.ts`.
- Write fence: `lib/mcp/worktree-tools.ts`, `lib/worktree/branch-name.ts`, `lib/daemon/handlers/worktree.ts`, `packages/rt-client/src/commands.ts`, the `__tests__` beside them, `plugins/mattstack/attachments/mcp-tools/reference.md`, `plugins/mattstack/.claude-plugin/plugin.json` (version line), `docs/superpowers/`.
- Run `bun test` from the worktree root, targeted files only. Never run a built rt binary outside an isolated HOME; never start a daemon.
- Comments only for constraints the code cannot show (`clean-code-comments` rule).
- Commit after each task, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- An rt daemon older than this change gets `precheck: true`: it must answer `daemon-outdated` and never provision (Task 4 test).
- A hand-made branch in another case (`CV-12-Fix`) still counts for ticket `cv-12` (Task 1 and Task 2 tests).
- Ticket `cv-1` must not claim `cv-12-...` or `cv-10` (Task 1 test).
- A run write that fails after a tree was claimed still returns the tree (Task 5 test).
- A default call's refusal text, including the multi-line `create-failed`, is exactly `explainError(raw)` (Task 3 test).

---

### Task 1: Ticket-match helpers

**Files:**
- Modify: `lib/worktree/branch-name.ts`
- Test: `lib/worktree/__tests__/names.test.ts`

**Interfaces:**
- Produces: `export function belongsToTicket(branch: string, ticket: string, format: string): boolean`

Rule (spec, "Precheck"): `head` = `format` up to the first `<slug>` (whole format when absent) with every `<ticket>` replaced by the sanitized ticket (lowercase, non-alphanumerics to `-`, trimmed, the same `sanitize` `slugifyTicketTitle` uses). When `head` contains the sanitized ticket, `stem` = `head` with trailing non-alphanumerics removed, and a branch belongs when `branch.toLowerCase()` equals `stem` or starts with `stem` followed by a non-alphanumeric character. Otherwise (no `<ticket>` before `<slug>`) a branch belongs when the sanitized ticket appears in the lowercased branch bounded by the string's ends or non-alphanumerics (escape it for the regex).

- [ ] **Step 1: Write the failing tests** in a new `describe("belongsToTicket")`:
  - `belongsToTicket("cv-12-fix-login", "CV-12", "<ticket>-<slug>")` → true
  - `belongsToTicket("CV-12-Fix", "cv-12", "<ticket>-<slug>")` → true
  - `belongsToTicket("cv-12", "cv-12", "<ticket>-<slug>")` → true
  - `belongsToTicket("cv-12-fix-2", "cv-12", "<ticket>-<slug>")` → true
  - `belongsToTicket("cv-123-x", "cv-12", "<ticket>-<slug>")` → false; `belongsToTicket("cv-10", "cv-1", "<ticket>-<slug>")` → false
  - `belongsToTicket("feature/cv-12/fix", "cv-12", "feature/<ticket>/<slug>")` → true; `("cv-12-fix", "cv-12", "feature/<ticket>/<slug>")` → false
  - slug-first format `"<slug>-<ticket>"`: `("fix-login-cv-12", "cv-12", …)` → true, `("fix-cv-123", "cv-12", …)` → false
- [ ] **Step 2:** `bun test lib/worktree/__tests__/names.test.ts` → FAIL (`belongsToTicket` is not exported).
- [ ] **Step 3:** Implement `belongsToTicket` in `lib/worktree/branch-name.ts`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `branch-name: belongsToTicket matches a branch to its ticket under the branch format`.

### Task 2: `worktree:provision-check` daemon verb

**Files:**
- Modify: `lib/daemon/handlers/worktree.ts` (step 1 of `worktree:provision`, around lines 314-341; the handler map's key union at line 264; a new handler)
- Modify: `packages/rt-client/src/commands.ts` (types beside `WorktreeProvisionData` at line 576; `Commands` at line 1133; `COMMAND_NAMES` beside `"worktree:provision"`)
- Test: `lib/daemon/__tests__/worktree-handlers.test.ts`

**Interfaces:**
- Consumes: `belongsToTicket` (Task 1).
- Produces (rt-client, exported from `commands.ts` and the package index the same way `WorktreeProvisionData` is):
  ```ts
  export interface WorktreeTreeRef {
    tree: string; path: string; branch: string;
    treeKind: "main" | "ephemeral" | "unmanaged" | "golden";
    state?: "creating" | "on-deck" | "claimed" | "disposable";
    owner?: string; disposal?: "merge" | "job"; claimedAt?: string;
  }
  export interface WorktreeProvisionCheckData {
    branch: string; base: string; localBranch: boolean;
    attached: WorktreeTreeRef[]; sameTicket: WorktreeTreeRef[]; sameSlug: WorktreeTreeRef[];
  }
  // Commands:
  "worktree:provision-check": { payload: { repoName: string; ticket?: string; ticketTitle?: string; branch?: string }; data: WorktreeProvisionCheckData };
  ```
- Produces (daemon, module-private is fine): `async function resolveProvisionBranch(payload: any, branchFormat: string, trees: TreeRecord[], repoPath: string): Promise<{ ok: true; branch: string; base: string; mode: "branch" | "ticket" } | { ok: false; error: string }>` — today's step 1 verbatim (explicit `branch` wins; else ticket → `slugifyTicketTitle(...).replace(/-+$/, "")` = `base`, then `disambiguate` against local branches and registered branches = `branch`; else `branch-unresolved`), followed by `validateGitRef(branch)`. In branch mode `base === branch`.

`worktree:provision-check`: decode the repo and look up `repoPath` exactly as provision does (`repo-unknown`); load config and registry; call `resolveProvisionBranch`; then, with no lock, fetch or registry write: `localBranch = await branchExistsLocalAsync(repoPath, base)`; `attached` = registry trees with `branch === base`; `sameTicket` (ticket mode only) = trees whose non-null branch `belongsToTicket(branch, payload.ticket, cfg.branchFormat)`; `sameSlug` (ticket mode with a non-empty sanitized title only) = trees whose lowercased branch starts with `base`. Each ref maps `name→tree`, `kind→treeKind`, and copies `path`, `branch`, `state`, `owner`, `disposal`, `claimedAt` when set. Skip trees whose branch is null.

- [ ] **Step 1: Write the failing tests** in a new `describe("worktree:provision-check")`, using `makeRepo`, `seedOnDeck`, `seedClaimed`, `makeHandlers`:
  - ticket mode, a claimed tree on `rt-99-do-the-thing` and another on `rt-99-other`: `{repoName, ticket: "RT-99", ticketTitle: "Do the thing"}` returns `base: "rt-99-do-the-thing"`, `branch: "rt-99-do-the-thing-2"`, `attached` = the first tree (with `treeKind: "ephemeral"`, `state: "claimed"`), `sameTicket` = both, `sameSlug` = the first only, `localBranch: true`.
  - registry and handoff untouched: `loadRegistry(repoName)` deep-equals its value before the call; no `worktree:claimed` event; `kicks` is 0.
  - an on-deck tree is never in any list.
  - branch mode `{repoName, branch: "feat-x"}` with no tree: `base` and `branch` both `"feat-x"`, empty lists, `localBranch: false`; after `git branch feat-x` in the repo, `localBranch: true`.
  - `{repoName}` alone → `{ok: false, error: "branch-unresolved"}`; an unknown identity → `repo-unknown`; `branch: "--upload-pack=x"` → the `unsafe git ref` error.
- [ ] **Step 2:** `bun test lib/daemon/__tests__/worktree-handlers.test.ts` → the new tests FAIL; every existing test still passes.
- [ ] **Step 3:** Extract `resolveProvisionBranch`, call it from `worktree:provision` step 1 (behavior unchanged), add the handler and the rt-client types and name.
- [ ] **Step 4:** Same command → all PASS. Then `bun run --cwd packages/rt-client build` and `bun test packages/rt-client/test/dist-freshness.test.ts` → PASS.
- [ ] **Step 5:** Commit `daemon: worktree:provision-check reports the branch a provision would use and the trees already on it`.

### Task 3: Opt-in refusal codes and repo classification

**Files:**
- Modify: `lib/mcp/worktree-tools.ts`
- Test: `lib/mcp/__tests__/worktree-tools.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProvisionRefusal {
    kind: "refused"; code: string; error: string;
    tree?: string; trees?: string[]; step?: string; detail?: string; reason?: string;
    budget?: Record<string, unknown>;
  }
  export function parseProvisionError(raw: string): ProvisionRefusal;
  export interface WorktreeToolDeps {
    command: typeof rtCommand;
    runTools?: () => McpToolDef[];   // Task 5 uses it; default () => runToolDefs()
    resolveRepo?: (repoName: unknown) => Promise<{ identity: string } | { error: string; unknown: boolean }>;
  }
  export function worktreeToolDefs(deps?: WorktreeToolDeps): McpToolDef[];
  ```
- `parseProvisionError` follows the spec's "Refusal codes" table; `error` is always `explainError(raw)`. `create-failed`: first line after `create-failed:` is `step`; the remaining lines, joined with `\n`, are `detail` (omitted when empty). `unsafe git ref ...` → `unsafe-ref`; `rt daemon unreachable at ...` → `daemon-unreachable`; `daemon at version ... does not know "..."` → `daemon-outdated`; the last three and `error` carry `detail: raw`.
- Default `resolveRepo`: `resolveRepoTarget({repoName})`; on failure, `unknown` is true when `typeof repoName === "string"` and `tryResolveRepoArg(repoName)` gives kind `"none"`, or gives an identity that `isRepoRegistered` rejects; false otherwise (ambiguous, or not a string).
- `optedIn(input)` = `codes === true || precheck === true || reuse === true || runDb !== undefined || budget !== undefined`.
- Provision handler: success → `ok({ kind: "provisioned", ...data })` in every case. Daemon refusal → default `err(explainError(raw))`; opted in → `err(JSON.stringify(parseProvisionError(raw)))`. Repo failure → default `err(error)`; opted in and `unknown` → `err(JSON.stringify({kind: "refused", code: "repo-unknown", error}))`; opted in and not unknown → `err(error)`.
- `codes` joins the input schema and `checkOptional` as a boolean.

- [ ] **Step 1: Write the failing tests** (extend `fake()` so the command can return a chosen `{ok: false, error}` and `resolveRepo` can be injected):
  - a table test: for each raw in `["busy", "repo-unknown", "branch-unresolved", "branch-duplicated", "branch-attached:frodo", "checkout-failed:boom", "create-failed:pnpm-install\nERR 1\nERR 2\n1 on-deck tree held by retry backoff until 2026-10-16T00:00:00.000Z", "claim-write-failed", "handoff-write-failed", "unsafe git ref (starts with '-' or empty): -x", "rt daemon unreachable at /tmp/rt.sock: ENOENT", "daemon at version 2.1.0 does not know \"worktree:provision-check\"; restart or upgrade rt (rt daemon restart)", "something new"]`, `parseProvisionError(raw)` has the code from the spec table, `error === explainError(raw)`, and `branch-attached` gives `tree: "frodo"`, `create-failed` gives `step: "pnpm-install"` and `detail` starting `"ERR 1"`, `checkout-failed` gives `detail: "boom"`.
  - default call refused with `"create-failed:pnpm-install\nERR 1"` → `r.ok === false`, `r.error === explainError("create-failed:pnpm-install\nERR 1")`.
  - same call with `codes: true` → `JSON.parse(r.error!)` deep-equals `parseProvisionError(raw)`.
  - default success → `r.body` equals `{kind: "provisioned", ...data}`.
  - `resolveRepo` returning `{error: "repoName \"x\" did not match ...", unknown: true}`: default → `r.error` is that message and no daemon call; with `codes: true` → JSON with `code: "repo-unknown"` and that `error`; with `unknown: false` and `codes: true` → plain message.
  - `codes: "yes"` → input error.
- [ ] **Step 2:** `bun test lib/mcp/__tests__/worktree-tools.test.ts` → new tests FAIL, existing pass.
- [ ] **Step 3:** Implement as above. `worktree_dispose` and `worktree_stop_holders` keep `fromResponse` and the old `resolveRepoTarget` path.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `worktree_provision: opt-in refusal codes; a default call keeps today's text`.

### Task 4: Precheck and reuse

**Files:**
- Modify: `lib/mcp/worktree-tools.ts`
- Test: `lib/mcp/__tests__/worktree-tools.test.ts`

**Interfaces:**
- Consumes: `worktree:provision-check` and `WorktreeProvisionCheckData`, `WorktreeTreeRef` (Task 2); `parseProvisionError`, `optedIn`, `WorktreeToolDeps` (Task 3).
- Check call: `deps.command("worktree:provision-check", {repoName: identity, ticket?, ticketTitle?, branch?}, { timeoutMs: 30_000 })`.
- `precheck: true` (needs ticket or branch, as today) → check call only; ok → `ok({ kind: "precheck", ...data })`; not ok → `err(JSON.stringify(refusal))` (Task 5 adds `budget`).
- `reuse: true`: check call first (a failed check is a refusal as above, never a provision), then with `attached`:
  - one ref, reusable (`treeKind === "unmanaged"`, or `treeKind === "ephemeral" && state === "claimed"`) → `ok({ kind: "reused", tree, path, branch, treeKind, state?, owner?, disposal? })`, no further daemon call;
  - one ref, not reusable → refusal `{kind: "refused", code: "branch-attached", tree, reason, error: explainError("branch-attached:" + tree)}`, `reason` = `"main-checkout"` for `treeKind === "main"`, `"disposable"` for that state, else `state ?? treeKind`;
  - two or more → `{kind: "refused", code: "branch-duplicated", trees: names, error: explainError("branch-duplicated")}`;
  - none, ticket mode (no `branch` string given) and `localBranch` → `worktree:provision` with `{repoName, branch: base, owner?, disposal?}` (no ticket/title);
  - none otherwise → the ordinary provision payload.
- `precheck` with `reuse` → input error `"precheck and reuse are separate calls"`.

- [ ] **Step 1: Write the failing tests** (the fake routes by command name):
  - precheck returns `{kind: "precheck", ...checkData}` and the calls are exactly `["worktree:provision-check"]`.
  - precheck against a check reply `{ok: false, error: 'daemon at version 2.1.0 does not know "worktree:provision-check"; restart or upgrade rt (rt daemon restart)'}` → `isError`, JSON `code: "daemon-outdated"`, and no `worktree:provision` call.
  - reuse with one claimed ephemeral ref → `kind: "reused"` with its `tree`, `path`, `owner`, `disposal`; calls `["worktree:provision-check"]`.
  - reuse with one unmanaged ref → reused.
  - reuse with a main ref → JSON `code: "branch-attached"`, `reason: "main-checkout"`; with a disposable ephemeral ref → `reason: "disposable"`; neither calls provision.
  - reuse with two refs → `code: "branch-duplicated"`, `trees` both names.
  - reuse, ticket mode, no refs, `localBranch: true`, `base: "cv-1-fix"` → the provision payload is `{repoName, branch: "cv-1-fix", owner: "o", disposal: "job"}` with no `ticket`.
  - reuse, no refs, `localBranch: false` → the provision payload carries `ticket` and `ticketTitle`; the result is `kind: "provisioned"`.
  - reuse with `branch` and `ticket` both given and `localBranch: true` → ordinary payload (branch mode).
  - `precheck: true, reuse: true` → input error, no calls.
- [ ] **Step 2:** `bun test lib/mcp/__tests__/worktree-tools.test.ts` → new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `worktree_provision: precheck and reuse through worktree:provision-check`.

### Task 5: Run recording and the retry budget

**Files:**
- Modify: `lib/mcp/worktree-tools.ts`
- Test: `lib/mcp/__tests__/worktree-tools.test.ts`

**Interfaces:**
- Consumes: `runToolDefs` from `./run-tools.ts` (default for `deps.runTools`); the tool named `run_field_set` (`{runDb, key, value, stage}`) and, when present, `run_budget` (`{runDb, key, limit, stage}` → body `{key, spent, limit, remaining, exhausted}`); Tasks 3 and 4.
- Inputs: `runDb` (string; must be absolute with basename `state.db`, else input error `'"runDb" must be the absolute path of a run\'s state.db'`), `stage` (string, default `"provision"`), `budget` (`{key: non-empty string, limit: integer ≥ 1}`, else input error; without `runDb` → input error `'"budget" needs "runDb"'`). All checks run before any daemon call. The handler takes `env` and passes it to the run tool handlers.
- After a `provisioned` or `reused` outcome with `runDb`: call `run_field_set` with `key: "branch"`, `value: result.branch`, then `key: "worktree"`, `value: result.path`, both with `stage`; all ok → add `recorded: true`; first failure → stop and add `recordError: <its error>`. Missing `run_field_set` tool → `recordError: "run_field_set is not available"`. Never on `precheck` or a refusal.
- On every refusal (daemon, check, reuse, repo-unknown) with `budget`: `run_budget` handler `{runDb, key: budget.key, limit: budget.limit, stage}`; ok → `refusal.budget = body`; not ok → `{error}`; tool absent → `{error: "run_budget is not available on this rt"}`. No charge on success or on an input error.

- [ ] **Step 1: Write the failing tests** with an injected `runTools` returning fake `run_field_set` / `run_budget` defs that record their inputs:
  - provisioned with `runDb: "/runs/x/state.db"` → field writes `[{key: "branch", value: <branch>, stage: "provision"}, {key: "worktree", value: <path>, stage: "provision"}]` with `runDb` passed through; `recorded: true`.
  - reused with `stage: "checkout"` → both writes carry `stage: "checkout"`.
  - `run_field_set` failing on `branch` → result still ok with the tree, `recordError` set, no `worktree` write.
  - precheck and a refusal with `runDb` → no field writes.
  - `runDb: "relative/state.db"` and `runDb: "/runs/x/other.db"` → input error and no daemon call.
  - refused `busy` with `budget: {key: "provision", limit: 2}` → JSON `budget` equals the fake's body; the budget call got `{runDb, key: "provision", limit: 2, stage: "provision"}`.
  - success with `budget` → no budget call.
  - no `run_budget` in `runTools` → JSON `budget: {error: "run_budget is not available on this rt"}`; `run_budget` returning `{ok: false, error: "stage provision has no row in this run"}` → `budget: {error: "stage provision has no row in this run"}`.
  - `budget` without `runDb`, and `budget: {key: "", limit: 2}` / `{key: "k", limit: 0}` → input errors, no calls.
- [ ] **Step 2:** `bun test lib/mcp/__tests__/worktree-tools.test.ts` → new tests FAIL.
- [ ] **Step 3:** Implement. Rewrite the `worktree_provision` description to name: the four `kind`s; `codes` and that any new option makes a refusal's text JSON with `code` (list the codes); `precheck`; `reuse` (claimed or unmanaged tree; a surviving local branch in ticket mode); `runDb`/`stage` recording; `budget` charged per refusal through `run_budget` when that tool exists. Keep the existing `REPO_NAME_RULE` sentence. Plain words (`rt:ui-copy`).
- [ ] **Step 4:** Same command → PASS; also `bun test lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/shell-forms.test.ts` → PASS.
- [ ] **Step 5:** Commit `worktree_provision: record branch and worktree on the run; charge an optional run_budget on refusal`.

### Task 6: Generated reference, plugin version, full verification

**Files:**
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (generated)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version line only)

- [ ] **Step 1:** Regenerate: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md` (run under an isolated HOME: `env -i HOME=$(mktemp -d) PATH=$PATH bun cli.ts mcp tools --json | ...`). Expected: only the `worktree_provision` section changes.
- [ ] **Step 2:** Bump `plugin.json` `version` to the next patch above `origin/main`'s (`git fetch origin main && git show origin/main:plugins/mattstack/.claude-plugin/plugin.json | grep version`; 0.31.8 if main is still 0.31.7).
- [ ] **Step 3:** Run, all must pass: `bun test lib/worktree/__tests__/names.test.ts lib/daemon/__tests__/worktree-handlers.test.ts lib/mcp/__tests__/worktree-tools.test.ts lib/mcp/__tests__/tools.test.ts`; `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/mcp-serve.test.ts`; `bun run check`; `bun run purity`.
- [ ] **Step 4:** Commit `mattstack plugin: regenerate the mcp tools reference for worktree_provision options, bump to <version>`.
