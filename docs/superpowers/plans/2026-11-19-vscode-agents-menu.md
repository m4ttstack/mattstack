# VS Code agents menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A status-bar menu in the rt-context VS Code extension that lists the Claude agents tied to the open worktree and attaches a VS Code terminal to the one you pick.

**Architecture:** rt-client's `rtCommand` gains a Node transport so the extension host (Node) can call daemon verbs. A pure module turns `pane:list`, `agent:list` and `runs:list` into rows for this worktree. A vscode module shows the rows and, on pick, resumes if needed (`agent:resume`) and opens a terminal running the argv from `pane:attach-plan`.

**Tech Stack:** TypeScript, Bun tests, `node:http`, VS Code extension API, esbuild.

**Spec:** `docs/superpowers/specs/2026-11-19-vscode-agents-menu-design.md`

## Global Constraints

- No new daemon handlers and no new REST routes. The only rt-side change is `packages/rt-client/src/transport.ts`.
- The extension never runs `rt`. Terminals run the argv `pane:attach-plan` returns.
- `listRuns()` and `agentList({})` are called without a repo; rows are scoped by worktree path and session, which avoids identity-form mismatches (my call, narrows the spec's `runsList({ repo })`).
- Out of scope: hand-started finished sessions, and runs whose session has no `rt agent` record.
- After touching rt-client source, run `bun run build` in `packages/rt-client`. `test/dist-freshness.test.ts` guards it.
- Run `bun test` from the repo root for rt-client tests (`bunfig.toml` preload). The extension's tests run with `bun test src/__tests__` from `extensions/vscode/rt-context`.
- Run targeted tests only. CI runs the full suite.
- Comments state only constraints the code cannot show.

## Review Focus

1. **Path prefix collisions:** a pane in `/x/goldberry-2` must not show in the `/x/goldberry` window. Containment is by path segment (Task 2 test).
2. **The main checkout window:** panes inside nested worktrees (`.claude/worktrees/*`, rt pool trees) belong to those worktrees, not to main. The owner is the longest worktree root that contains the cwd (Task 2 test).
3. **Daemon down or herdr unavailable:** the menu shows a VS Code message carrying the error, and the status item reads plain `Agents`. Never an unhandled rejection (Task 3 test on `loadAgentRows`).
4. **A live session that also has a record:** one row (the live one), labelled with the record's caller (Task 2 test).
5. **A resume that comes back without a pane** (headless surface): the user gets "This session runs headless, so there is no pane to attach to", not a terminal that fails (Task 3 test on `paneForResume`).

---

### Task 1: rt-client Node transport

**Files:**
- Modify: `packages/rt-client/src/transport.ts` (inside `rtCommand`, around lines 89-130)
- Test: `packages/rt-client/test/transport-node.test.ts` (new)

**Interfaces:**
- Produces: `rtCommand` works unchanged under Node. A new exported helper, `postOverSocket(sockPath: string, cmd: string, body: string, headers: Record<string,string>, timeoutMs: number): Promise<{ status: number; text: string }>`, uses `node:http` `request({ socketPath, path: "/" + cmd, method: "POST" })` and rejects with an `Error` whose `name` is `"TimeoutError"` on timeout. `rtCommand` calls it when `typeof (globalThis as { Bun?: unknown }).Bun === "undefined"`, and Bun's `fetch({ unix })` otherwise. Both paths feed the same envelope, 413 and unreachable handling.

- [ ] **Step 1: Write the failing tests** in `transport-node.test.ts`, using `fakeDaemon` from `test/fake-daemon.ts`:
  - `postOverSocket returns the daemon's status and body`: with fake reply `{ "pane:list": { ok: true, data: { panes: [] } } }`, `JSON.parse(text)` equals that reply and `status === 200`. `seen[0]` is `{ cmd: "pane:list", payload: {} }`.
  - `postOverSocket rejects with TimeoutError past the budget`: a `Bun.serve({ unix })` whose fetch never resolves, with `timeoutMs: 50`, rejects with `name === "TimeoutError"`.
  - `postOverSocket rejects on a missing socket`: path `join(tmpdir(), "nope-<pid>.sock")` rejects (any error).
  - `the built dist talks to the daemon from plain node`: run `bun run build` in `packages/rt-client`, then `spawnSync("node", ["--input-type=module", "-e", script])`, where the script imports `dist/index.js` by absolute file URL, calls `paneList({ sockPath })` against `fakeDaemon`, and prints `JSON.stringify(res)`. Expect exit 0 and stdout parsed to `{ ok: true, data: { panes: [] } }`. Pass `env: { ...process.env, NODE_ENV: "development" }` so the test-isolation guard does not refuse the temp socket. The guard only blocks the real account socket, but keep the env explicit.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test packages/rt-client/test/transport-node.test.ts`
Expected: FAIL, because `postOverSocket` is not exported, and the dist test returns `ok: false` with `rt daemon unreachable`.

- [ ] **Step 3: Implement `postOverSocket` and the runtime branch in `rtCommand`.** Import `request` from `node:http`. `assertSockNotForbidden` still runs first on both paths. The 413 branch reads `status`; the rest reads `text`.

- [ ] **Step 4: Run, expect PASS.** Also run `bun test packages/rt-client/src/__tests__/transport-refusal.test.ts packages/rt-client/test/client.test.ts packages/rt-client/test/dist-cjs-safe.test.ts packages/rt-client/test/dist-freshness.test.ts`. All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/transport.ts packages/rt-client/test/transport-node.test.ts
git commit -m "rt-client: rtCommand reaches the daemon from Node over node:http"
```

### Task 2: Rows for this worktree (pure)

**Files:**
- Create: `extensions/vscode/rt-context/src/agentRows.ts`
- Test: `extensions/vscode/rt-context/src/__tests__/agentRows.test.ts`

**Interfaces:**
- Consumes: `ChatPane`, `AgentRecord`, `RunSummary` types from `@mattstack/rt-client`.
- Produces:

```ts
export type AgentRowStatus = 'working' | 'waiting' | 'idle' | 'done' | 'ended';
export interface AgentRow {
  key: string;                 // session id when known, else pane id or agent id
  group: 'running' | 'recent';
  title: string;               // handle, else agent label, else agent id, else pane id
  status: AgentRowStatus;
  startedBy: string;           // run work_type, else agent caller, else 'rt agent' when a record exists, else 'by hand'
  at: number;                  // ms: record finishedAt ?? lastResumedAt ?? createdAt; agent.startedAt for a live pane with a record; 0 otherwise
  target: { kind: 'pane'; paneId: string } | { kind: 'resume'; agentId: string };
}
export function ownerOf(cwd: string, worktreeRoots: string[]): string | null;
export function worktreeAgentRows(input: {
  worktreePath: string; worktreeRoots: string[]; branch: string | null;
  panes: ChatPane[]; agents: AgentRecord[]; runs: RunSummary[];
}): AgentRow[];
```

Rules (from the spec):
- `ownerOf` returns the longest root `r` where `cwd === r` or `cwd.startsWith(r + path.sep)`, else `null`.
- Live rows come from panes where `ownerOf(pane.cwd) === worktreePath`. Status maps `agentStatus` to `working`, `blocked`→`waiting`, `idle`, `done`, `unknown`→`idle`. A pane with a `gate` is `waiting`. The group is `running`.
- Recent rows come from records where `ownerOf(record.cwd) === worktreePath` and whose `sessionId` is not on a live row. They have status `ended` and group `recent`, with target `resume`.
- Runs: a run whose `branch === branch` and whose `session` equals a live or recent row's session sets that row's `startedBy` to the run's `work_type`, but only when the record has no `caller`. Otherwise the run is ignored. A run never adds a row.
- Order: `running` rows first, in pane order. Then `recent` rows by `at`, newest first.

- [ ] **Step 1: Write the failing tests:**
  - `ownerOf picks the longest containing root`: with roots `['/r', '/r/.claude/worktrees/a']`, cwd `/r/.claude/worktrees/a/src` gives `/r/.claude/worktrees/a`, and cwd `/r/lib` gives `/r`.
  - `ownerOf does not match a sibling with a shared prefix`: with roots `['/x/goldberry', '/x/goldberry-2']`, cwd `/x/goldberry-2` gives `/x/goldberry-2`, and with roots `['/x/goldberry']` it gives `null`.
  - `a live pane and its record make one running row`: a pane with sessionId `s1` and status `working`, plus a record with sessionId `s1` and caller `board:review`, give exactly one row: `{ group: 'running', status: 'working', startedBy: 'board:review', target: { kind: 'pane', paneId } }`.
  - `a finished record makes a recent resume row`: a record with `finishedAt: 5`, the same cwd and no pane gives `{ group: 'recent', status: 'ended', at: 5, target: { kind: 'resume', agentId } }`.
  - `a gate makes the row waiting`.
  - `a run labels its record's row and adds none`: a record with no caller, session `s2`, plus a run `{ branch: 'feat', session: 's2', work_type: 'work' }` give one row with `startedBy: 'work'`. A run with no matching session adds nothing.
  - `panes and records in other worktrees are left out`: with the main checkout as `worktreePath`, a pane in the nested worktree is excluded.
  - `recent rows are newest first`.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test src/__tests__/agentRows.test.ts` (from `extensions/vscode/rt-context`)
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `agentRows.ts`.** Import types only from `@mattstack/rt-client`, with no vscode import, so the module stays testable under Bun.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add extensions/vscode/rt-context/src/agentRows.ts extensions/vscode/rt-context/src/__tests__/agentRows.test.ts
git commit -m "rt-context: rows for the agents tied to a worktree"
```

### Task 3: The menu, status item and attach

**Files:**
- Create: `extensions/vscode/rt-context/src/agentsLoad.ts` (pure: data loading and the resume → pane step)
- Create: `extensions/vscode/rt-context/src/agentsMenu.ts` (vscode: status item, quick pick, terminal)
- Modify: `extensions/vscode/rt-context/src/extension.ts` (register `rtContext.showAgents`, init the item, refresh it on `onDaemonRefresh`)
- Modify: `extensions/vscode/rt-context/src/statusBar.ts` only if `agentsMenu` needs the current branch exported (add `getCurrentBranch(): string | null` beside the existing getters)
- Modify: `extensions/vscode/rt-context/package.json` (add command `rtContext.showAgents`, title `RT Context: Show Agents`)
- Test: `extensions/vscode/rt-context/src/__tests__/agentsLoad.test.ts`

**Interfaces:**
- Consumes: `worktreeAgentRows`, `AgentRow` (Task 2); `paneList`, `agentList`, `listRuns`, `agentResume`, `paneAttachPlan` from `@mattstack/rt-client` (Task 1 makes them work in Node); `listWorktrees(cwd)` from `./git`; `getCurrentWorktreePath()` from `./statusBar`.
- Produces:

```ts
// agentsLoad.ts
export interface AgentsDeps {
  paneList: typeof paneList; agentList: typeof agentList; listRuns: typeof listRuns;
  agentResume: typeof agentResume; paneAttachPlan: typeof paneAttachPlan;
}
export function loadAgentRows(
  ctx: { worktreePath: string; worktreeRoots: string[]; branch: string | null }, deps: AgentsDeps,
): Promise<{ rows: AgentRow[] } | { error: string }>;
export function paneForResume(agentId: string, deps: AgentsDeps): Promise<{ paneId: string } | { error: string }>;
export function attachPlanFor(paneId: string, deps: AgentsDeps): Promise<{ argv: string[]; env: Record<string, string> } | { error: string }>;
```

- `loadAgentRows`: an error from `paneList` returns `{ error }` with the daemon's message. A failing `agentList` or `listRuns` is treated as an empty list, so live panes still show. It never throws.
- `paneForResume`: calls `agentResume({ id })`. Not ok returns `{ error }`. An ok result with no `paneId` returns `{ error: 'This session runs headless, so there is no pane to attach to' }`.
- `agentsMenu.ts`: `initAgentsItem(context, priority)` creates the item at `priority - 3` with text `$(hubot) Agents`, plus ` (n)` when n live rows > 0, and command `rtContext.showAgents`; hidden when `getCurrentWorktreePath()` is null, shown otherwise even at zero (the spec's "not an rt-known repo" check is approximated by this: a window with no git worktree). `refreshAgentsItem()` reloads the count. It runs on init, on `onDaemonRefresh` and on `vscode.window.onDidChangeWindowState` focus. `showAgents()` loads rows and shows a `QuickPick` with `QuickPickItemKind.Separator` labels `Running` and `Recent`. Each item has label `title`, description `status · startedBy`, and detail as a relative time from `at` when `at > 0`. With no rows, it shows the information message `No agents have run in this worktree yet.` On pick, a `pane` target goes straight to `attachPlanFor`, and a `resume` target goes through `paneForResume` then `attachPlanFor`. Success calls `vscode.window.createTerminal({ name: title, shellPath: argv[0], shellArgs: argv.slice(1), env, cwd: worktreePath }).show()`. Any `{ error }` calls `vscode.window.showErrorMessage(error)`.

- [ ] **Step 1: Write the failing tests** in `agentsLoad.test.ts` with fake deps:
  - `daemon down: loadAgentRows returns the pane:list error`: given `paneList → { ok: false, error: 'rt daemon unreachable at /s: …' }`, the result is `{ error }` containing `rt daemon unreachable`.
  - `agent:list failing still shows live panes`.
  - `paneForResume returns the resumed pane`: given `agentResume → { ok: true, data: { paneId: 'w1-3', … } }`, the result is `{ paneId: 'w1-3' }`.
  - `paneForResume on a headless record says so`: a result with no `paneId` gives `{ error: 'This session runs headless, so there is no pane to attach to' }`.
  - `paneForResume passes the daemon error through`.
  - `attachPlanFor returns argv and env`.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test src/__tests__/agentsLoad.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `agentsLoad.ts`**, then `agentsMenu.ts`, then wire `extension.ts` and `package.json`.

- [ ] **Step 4: Run, expect PASS.** Also run `bun test src/__tests__/bundle-load.test.ts` (it builds the bundle and loads it in plain Node) and `bunx tsc --noEmit -p .`. Both pass.

- [ ] **Step 5: Commit**

```bash
git add extensions/vscode/rt-context
git commit -m "rt-context: Agents status item lists this worktree's agents and attaches a terminal"
```

### Task 4: Verify in a real editor

This is UI, so it isn't done until it has been rendered and looked at.

- [ ] **Step 1:** Run `bun run package` in `extensions/vscode/rt-context` to get the `.vsix`. Ask Matt before installing it into his editor (`install-local` runs `cursor --install-extension`), since that replaces the installed rt-context.
- [ ] **Step 2:** Open a worktree that has a live Claude pane and a finished `rt agent` record. Check:
  - the item shows `Agents (1)`
  - the menu shows one Running row and at least one Recent row
  - the main checkout window does not list the worktree's pane
- [ ] **Step 3:** Pick the live row: a terminal opens attached to the pane. Pick a Recent row: the session resumes in herdr and the terminal attaches. Repeat with a `bg:` pane if one exists.
- [ ] **Step 4:** Stop nothing live. Simulate daemon-down by pointing `RT_DAEMON_SOCK` at a missing path in a dev extension host (F5), and check that the menu shows the error message.
- [ ] **Step 5:** Screenshot the menu in a dark and a light editor theme (`screencapture -x`). Add one Human Todos `image` item with both, and say plainly anything that reads wrong.
