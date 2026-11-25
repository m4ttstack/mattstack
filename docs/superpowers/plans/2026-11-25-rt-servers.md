# rt servers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt servers` lists every running dev server rt intercepted in this repo, grouped by ticket across all its worktrees, and lets a person pick some to stop.

**Architecture:** A pure finder (`lib/endpoint/servers.ts`) turns one process snapshot plus the repo's rules, roles and claims into servers. A system module (`lib/endpoint/servers-system.ts`) reads that snapshot and stops whole process trees. A pure grouper (`lib/endpoint/server-groups.ts`) joins servers to ticket and MR data. `commands/servers.ts` is the command. No daemon change.

**Order:** Part A (Tasks 1 to 4) runs as the plan. Part B (Task 5, the picker) is UI, built live with Matt after Part A.

**Tech Stack:** Bun, TypeScript, `bun:test`, the existing output layer and `rt-ui` picker.

**Spec:** `docs/superpowers/specs/2026-11-25-rt-servers-design.md`

## Global Constraints

- Everything printed goes through `lib/ui/out.ts`. No `console.*`, no raw escapes, no UI code in TypeScript. `failed` status is for failures only.
- No sync spawns: `runCapture` from `lib/subprocess.ts` for every child.
- The picker opens only when `process.stdin.isTTY && !json && !process.env.RT_BATCH`.
- `--json` prints through `out.json` with an empty stderr.
- A `bun test` run goes from the repo root and names its files. Never the full suite.
- Public repo: fixtures use `sample-app`, `api`, `web`, `docs`. No employer names, tickets or paths.
- A comment states a constraint the code cannot show, or is not written.
- Command descriptions are one plain sentence.

## Review Focus

1. `ps` or `lsof` fails or times out: the command fails, and never says nothing is running. (Task 2, Task 4)
2. A worktree on a detached HEAD, or nested inside the main checkout: its servers are listed under the right tree. (Task 1, Task 3)
3. An intercepted command that runs the same intercepted command again: one server, one row. (Task 1)
4. Escape, or a server that exits or whose pid is reused while the picker is open: nothing is signalled. (Task 2, Task 4)
5. The ticket or MR lookup fails, hangs or answers late: the picker and the list still work, and marks survive the late answer. (Task 4, Task 5)

---

### Task 1: find the servers

**Files:**
- Create: `lib/endpoint/servers.ts`
- Modify: `lib/daemon/worktree-process-kill.ts` (add `agentNameOf` beside `isUserOrAgentProcess`)
- Test: `lib/endpoint/__tests__/servers.test.ts`
- Test: `lib/daemon/__tests__/worktree-process-kill.test.ts` (one test added)

**Interfaces:**
- Consumes: `matchInvocation`, `InterceptRule` (`lib/endpoint/shim.ts`); `RoleConfig` (`lib/endpoint/config.ts`); `EndpointClaim` (`lib/state/index.ts`); `canon` (`lib/fs-canon.ts`); `isUserOrAgentProcess`, `KillCandidate` (`lib/daemon/worktree-process-kill.ts`).
- Produces:

```ts
// lib/daemon/worktree-process-kill.ts
export function agentNameOf(proc: KillCandidate): string | null; // the DEFAULT_AI_AGENT_NAMES entry it answers to

// lib/endpoint/servers.ts
export interface ServerProc { pid: number; ppid: number; etime: string; startTime: string; args: string }
export interface ServerSnapshot {
  procs: ServerProc[];
  cwds: Map<number, string>;
  listeners: Map<number, number[]>; // pid -> its listening ports, ascending
  worktrees: Array<{ path: string; branch: string | null }>;
}
/** `rules` holds this repo's rules only. */
export interface ServerRules { rules: InterceptRule[]; roles: Record<string, RoleConfig>; claims: EndpointClaim[] }
export interface RunningServer {
  role: string;
  port: number | null;
  listening: boolean;
  worktree: { path: string; name: string }; // name = basename(path)
  branch: string | null;
  pid: number;
  pids: number[]; // the whole tree, ascending, agents and their descendants left out
  startTime: string;
  etime: string;
  leftBehind: boolean;
  agent: string | null;
}
export function parseServerProcs(psOutput: string): ServerProc[];
export function interceptCommandOf(args: string): { command: string; args: string[] } | null;
export function ancestorPids(procs: ServerProc[], pid: number): number[]; // nearest first, stops below pid 1
export function findServers(snapshot: ServerSnapshot, rules: ServerRules): RunningServer[]; // sorted by worktree name, role, port
```

- [ ] **Step 1: Write the failing parser tests**

```ts
const LSTART = "Tue Nov 24 14:45:47 2026";

test("a ps row splits into pid, ppid, etime, start time and the full command line", () => {
  expect(parseServerProcs(`  101     1 18:00:00 ${LSTART}     rt intercept run doppler -- run -- parcel src/index.html\nnot a row\n`)).toEqual([
    { pid: 101, ppid: 1, etime: "18:00:00", startTime: LSTART, args: "rt intercept run doppler -- run -- parcel src/index.html" },
  ]);
});

test("an intercepted command is read from the installed rt and from a source checkout", () => {
  const want = { command: "doppler", args: ["run", "--", "parcel"] };
  expect(interceptCommandOf("rt intercept run doppler -- run -- parcel")).toEqual(want);
  expect(interceptCommandOf("/Applications/mattstack.app/Contents/MacOS/rt intercept run doppler -- run -- parcel")).toEqual(want);
  expect(interceptCommandOf("/Users/me/.bun/bin/bun run --preload=/Users/me/restore-cwd.ts /code/rt/cli.ts intercept run doppler -- run -- parcel")).toEqual(want);
});

test("a shell, an agent or a search holding the same words is not an intercepted command", () => {
  expect(interceptCommandOf("/bin/zsh -c eval 'rt intercept run doppler -- run -- parcel'")).toBeNull();
  expect(interceptCommandOf("grep intercept run doppler -- run")).toBeNull();
  expect(interceptCommandOf("rt intercept status")).toBeNull();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun test lib/endpoint/__tests__/servers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `parseServerProcs` and `interceptCommandOf` in `lib/endpoint/servers.ts`**

`parseServerProcs` reads `ps -A -o pid=,ppid=,etime=,lstart=,args=`; `lstart` is five tokens and is kept as printed with runs of spaces collapsed. `interceptCommandOf` is anchored at the start of the line, so text that merely contains the phrase never matches:

```ts
const INTERCEPT_ARGV = /^(?:(?:\S*\/)?rt|(?:\S*\/)?bun(?: \S+)* \S*\/cli\.ts) intercept run ([A-Za-z0-9._-]+) -- ?(.*)$/;
```

- [ ] **Step 4: Run them and see them pass**

Run: `bun test lib/endpoint/__tests__/servers.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing finder tests**

Fixture: main checkout `/code/sample-app` on `main`, linked tree `/trees/calm-marble` on `feature/login`. Rules for command `doppler`: `apps/api{,/**}` + `src/server` is `api`; `apps/web{,/**}` + `parcel` is `web`; `apps/docs{,/**}` + `parcel` is `docs`. Roles: `api` pool `[10400, 10401]`; `web` pool `[4001]`, needs `api`; `docs` `fixedPort: 4002`. A `snap(...)` helper builds a `ServerSnapshot` from rows of `{pid, ppid, args, cwd, ports}`.

```ts
test("a server is its whole tree, its role and the port claimed for it", () => {
  // 10 rt intercept run doppler -- run -- node src/server (cwd /trees/calm-marble/apps/api)
  // 11 doppler (ppid 10), 12 node watcher (ppid 11), 13 node server (ppid 12, listens 9229 and 10400)
  // claims: api on /trees/calm-marble, port 10400
  expect(found).toEqual([expect.objectContaining({
    role: "api", port: 10400, listening: true, worktree: { path: "/trees/calm-marble", name: "calm-marble" },
    branch: "feature/login", pid: 10, pids: [10, 11, 12, 13], leftBehind: false, agent: null,
  })]);
});
test("a one-off run of the same tool matches no rule and is left out", () => { /* rt intercept run doppler -- secrets, cwd apps/api */ expect(found).toEqual([]); });
test("a process in another repo's folder is left out", () => { /* cwd /code/other/apps/api */ expect(found).toEqual([]); });
test("a fixed-port role shows with no claim row", () => { expect(found[0]).toMatchObject({ role: "docs", port: 4002, listening: true }); });
test("a needed role's claim is not a server of its own", () => {
  // web running with a claim for web 4001 and one for api 10400 under web's pid; nothing listens on 10400
  expect(found.map((s) => s.role)).toEqual(["web"]);
});
test("a run with no claim takes the lowest port its tree listens on", () => { expect(found[0]!.port).toBe(4100); });
test("a tree that listens on nothing shows its claimed port as not listening", () => { expect(found[0]).toMatchObject({ port: 10400, listening: false }); });
test("a tree with no port and no claim has a null port", () => { expect(found[0]).toMatchObject({ port: null, listening: false }); });
test("a detached worktree's server is listed with no branch", () => { expect(found[0]!.branch).toBeNull(); });
test("a tree nested in the main checkout owns its own server", () => {
  // worktrees: /code/sample-app and /code/sample-app/.worktrees/fix; cwd in the nested apps/api
  expect(found[0]!.worktree.path).toBe("/code/sample-app/.worktrees/fix");
});
test("the same intercepted command nested in itself is one server", () => {
  // 10 matches api; 12, under it, is a second rt intercept run matching api in the same tree
  expect(found.map((s) => s.pid)).toEqual([10]);
});
test("a nested server of another role is its own row and its pids leave the outer tree", () => {
  expect(found.map((s) => [s.role, s.pids])).toEqual([["api", [10, 11]], ["web", [20, 21]]]); // 20 sits under 11
});
test("a live agent above the server is named", () => { /* claude pid 5 -> zsh 6 -> 10 */ expect(found[0]!.agent).toBe("claude"); });
test("an agent inside a tree, and everything under it, is not in the tree's pids", () => { expect(found[0]!.pids).toEqual([10, 11]); });

test("a server whose rt process is gone is left behind, from the topmost process in the same folder", () => {
  // claim api 10400 on calm-marble; 11 doppler (ppid 1) -> 12 -> 13 listens 10400, all cwd apps/api; no pid 10
  expect(found).toEqual([expect.objectContaining({ role: "api", port: 10400, listening: true, leftBehind: true, pid: 11, pids: [11, 12, 13] })]);
});
test("a left-behind tree never climbs into the process that started other servers", () => {
  // 9 turbo (cwd the worktree root) -> 11 doppler (apps/api) -> 13 listens 10400
  expect(found[0]!.pid).toBe(11);
});
test("a left-behind fixed port counts only from that role's folder", () => {
  // 30 listens 4002 with cwd apps/docs; 31 listens 4002 with cwd apps/api
  expect(found.map((s) => [s.role, s.pid])).toEqual([["docs", 30]]);
});
test("an agent or shell holding a role's port is never a server", () => { expect(found).toEqual([]); });
test("a listener on a claimed port from another worktree is not that claim's server", () => { expect(found).toEqual([]); });
```

In `lib/daemon/__tests__/worktree-process-kill.test.ts`:

```ts
test("agentNameOf names the agent a process is, through an interpreter too", () => {
  expect(agentNameOf({ pid: 1, ppid: 0, command: "claude", fullCommand: "/Users/me/.local/bin/claude --resume x" })).toBe("claude");
  expect(agentNameOf({ pid: 1, ppid: 0, command: "node", fullCommand: "node /opt/bin/codex" })).toBe("codex");
  expect(agentNameOf({ pid: 1, ppid: 0, command: "node", fullCommand: "node server.js" })).toBeNull();
});
```

- [ ] **Step 6: Run them and see them fail**

Run: `bun test lib/endpoint/__tests__/servers.test.ts lib/daemon/__tests__/worktree-process-kill.test.ts`
Expected: the new tests FAIL; the rest pass.

- [ ] **Step 7: Implement `agentNameOf`, `ancestorPids` and `findServers`**

- The owning worktree of a cwd is the longest `canon`'d worktree path that contains it.
- Match with each rule's `repoRemote` set to null, since `rules` is already this repo's.
- A root is a matched candidate with no matched ancestor of the same role and worktree. Every process belongs to its nearest root.
- `KillCandidate.command` is the argv0 basename.
- Left-behind: for a claim, a listener on its port whose owning worktree is the claim's (compared through `canon`); for a `fixedPort`, a listener whose cwd, relative to its worktree, matches a `cwdGlob` of that role. Skip a listener owned by a root, or that is `isUserOrAgentProcess`. Its root is the last of its ancestors, climbing while the cwd equals the listener's and it is not `isUserOrAgentProcess`. One row per root.

- [ ] **Step 8: Run them and see them pass**

Run: `bun test lib/endpoint/__tests__/servers.test.ts lib/daemon/__tests__/worktree-process-kill.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/endpoint/servers.ts lib/endpoint/__tests__/servers.test.ts lib/daemon
git commit -m "endpoint: find a repo's running intercepted servers by process"
```

---

### Task 2: read the snapshot and stop trees

**Files:**
- Create: `lib/endpoint/servers-system.ts`
- Test: `lib/endpoint/__tests__/servers-system.test.ts`

**Interfaces:**
- Consumes: Task 1's types, `parseServerProcs`, `ancestorPids`; `runCapture`, `RunResult` (`lib/subprocess.ts`); `listWorktreesAsync` (`lib/worktree/git-async.ts`); `parseListeningLsof`, `parseCwdMap` (`lib/port-scanner.ts`).
- Produces:

```ts
export interface ServerSystem {
  run(argv: [string, ...string[]], opts: { timeoutMs: number; env?: Record<string, string | undefined> }): Promise<RunResult>;
  worktrees(repoRoot: string): Promise<Array<{ path: string; branch: string | null }> | null>;
  signal(pid: number, sig: "SIGTERM" | "SIGKILL" | 0): void; // throws errno errors, as process.kill does
  sleep(ms: number): Promise<void>;
}
export const realServerSystem: ServerSystem;
/** Null when any read failed, so a caller never mistakes that for nothing running. */
export function readServerSnapshot(repoRoot: string, system?: ServerSystem): Promise<ServerSnapshot | null>;
export interface StopOutcome { server: RunningServer; result: "stopped" | "gone" | "failed"; why?: string }
export function stopServers(picked: RunningServer[], fresh: RunningServer[], spare: Set<number>, system?: ServerSystem): Promise<StopOutcome[]>;
```

- [ ] **Step 1: Write the failing tests**

```ts
test("the snapshot joins processes, folders, ports and worktrees", async () => { /* canned ps, two lsof outputs, two worktrees */ });
test("ps runs under LC_ALL=C, because lstart follows the locale", () => { expect(psCall.opts.env!.LC_ALL).toBe("C"); });
test("a ps failure, a cwd read with no output, a listener read that timed out, or a failed worktree list is null", async () => { /* each alone */ });
test("a listener read that exits 1 with no output is no listeners, not a failure", async () => { expect(snapshot!.listeners.size).toBe(0); });

test("stopping signals every pid in the tree with SIGTERM", async () => { expect(sent).toEqual([[10, "SIGTERM"], [11, "SIGTERM"], [12, "SIGTERM"]]); expect(result).toBe("stopped"); });
test("the fresh tree's pids are the ones signalled", async () => { /* picked pids [10, 11], fresh [10, 12] */ });
test("what is left after 5 seconds gets SIGKILL", async () => { /* 12 stays alive through 5000ms of sleeps */ expect(killed).toEqual([12]); expect(result).toBe("stopped"); });
test("what survives SIGKILL is a failure that says so", async () => { expect(outcome).toMatchObject({ result: "failed", why: "It did not stop." }); });
test("a server missing from the fresh list, or with a new start time, is gone and never signalled", async () => { expect(sent).toEqual([]); });
test("a process owned by someone else is a failure that says why", async () => { /* EPERM */ expect(outcome.why).toBe("It belongs to another user or to macOS."); });
test("a pid that is already gone when signalled is not a failure", async () => { /* ESRCH */ expect(result).toBe("stopped"); });
test("spared pids and pids of 1 or less are never signalled", async () => { /* tree [0, 1, 10, 11], spare {11} */ expect(sent).toEqual([[10, "SIGTERM"]]); });
test("several servers share one wait", async () => { /* three trees, one that needs SIGKILL */ expect(totalSlept).toBeLessThanOrEqual(7_000); });
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun test lib/endpoint/__tests__/servers-system.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both functions in `lib/endpoint/servers-system.ts`**

Reads run together: `ps -A -o pid=,ppid=,etime=,lstart=,args=` (5s), `lsof -d cwd -Fpn` (10s), `lsof -nP -iTCP -sTCP:LISTEN` (10s), and the worktrees. `ps` failing is a non-zero exit; the cwd read failing is no output; the listener read failing is `timedOut` or exit -1. Stop polls with signal 0 every 100ms, SIGKILLs survivors at 5000ms, and gives up 2000ms later. `signal` with EPERM on the poll counts as alive.

- [ ] **Step 4: Run them and see them pass**

Run: `bun test lib/endpoint/__tests__/servers-system.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/endpoint/servers-system.ts lib/endpoint/__tests__/servers-system.test.ts
git commit -m "endpoint: read what is running and stop whole server trees"
```

---

### Task 3: group servers by ticket

**Files:**
- Create: `lib/endpoint/server-groups.ts`
- Modify: `lib/enrich.ts` (export `mrSegments`; no behavior change)
- Test: `lib/endpoint/__tests__/server-groups.test.ts`

**Interfaces:**
- Consumes: `RunningServer` (Task 1); `EnrichedBranch`, `MRInfo`, `mrSegments` (`lib/enrich.ts`); `extractLinearId` (`lib/linear.ts`); `LinearTicket` (`lib/linear.ts`).
- Produces:

```ts
export interface GroupedServer {
  server: RunningServer;
  branch: string | null; // set only when the group spans several branches
  mr: MRInfo | null;     // set only when the group spans several branches
}
export interface ServerGroup {
  key: string;           // ticket id, else branch, else worktree path
  ticketId: string | null;
  ticket: LinearTicket | null;
  title: string;         // ticket title, else MR title, else branch, else worktree name
  detached: boolean;
  mr: MRInfo | null;     // set only when every server in the group is on one branch
  servers: GroupedServer[];
}
export function groupServers(servers: RunningServer[], enriched: Map<string, EnrichedBranch>): ServerGroup[]; // enriched is keyed by worktree path
export function serverMatch(group: ServerGroup, row: GroupedServer): string; // the row's filter text
export function mrText(mr: MRInfo): string; // "!412 open  checks passed"
```

- [ ] **Step 1: Write the failing tests**

```ts
test("servers of one ticket on one branch are one group, its MR on the group", () => {
  expect(groups).toEqual([expect.objectContaining({ key: "WEB-214", ticketId: "WEB-214", title: "Add a login rate limit", detached: false, mr: expect.objectContaining({ iid: 412 }) })]);
  expect(groups[0]!.servers.map((r) => [r.server.role, r.branch, r.mr])).toEqual([["api", null, null], ["web", null, null]]);
});
test("one ticket on two branches is one group, branch and MR on the rows", () => {
  expect(groups).toHaveLength(1);
  expect(groups[0]!.mr).toBeNull();
  expect(groups[0]!.servers.map((r) => [r.branch, r.mr?.iid])).toEqual([["web-240-forms", 423], ["web-240-shell", 420], ["web-240-shell", 420]]);
});
test("before enrichment the ticket id comes from the branch, and the title is the branch", () => { expect(groupServers(servers, new Map())[0]).toMatchObject({ key: "WEB-214", ticketId: "WEB-214", ticket: null, title: "web-214-login-rate-limit", mr: null }); });
test("with several branches and no ticket yet, the title is the ticket id", () => { expect(groups[0]).toMatchObject({ key: "WEB-240", title: "WEB-240" }); });
test("a ticket id found only in the MR title groups by that ticket", () => { /* enriched.linearId WEB-250, branch export-retry */ expect(groups[0]!.key).toBe("WEB-250"); });
test("no ticket: the MR's title, else the branch", () => { expect(titles).toEqual(["Retry the export job on timeout", "main"]); });
test("a detached worktree groups by itself under its own name", () => { expect(groups[0]).toMatchObject({ key: "/trees/slow-comet", title: "slow-comet", detached: true }); });
test("groups run oldest server first, rows by branch then role", () => { expect(order).toEqual(["WEB-240", "WEB-198", "WEB-214", "main"]); });
test("the filter text holds role, port, ticket, state, title, branch, MR title and MR state", () => {
  expect(serverMatch(group, row)).toBe("api :10400 WEB-198 Done Fix rounding in order totals web-198-order-totals Fix totals merged");
});
test("a server with no port is filtered by its other words", () => { expect(serverMatch(group, row)).toStartWith("api WEB-231 "); });
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun test lib/endpoint/__tests__/server-groups.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/endpoint/server-groups.ts`**

Age is `Date.parse(server.startTime)`. `mrText` joins `mrSegments(mr)`'s text.

- [ ] **Step 4: Run them and see them pass**

Run: `bun test lib/endpoint/__tests__/server-groups.test.ts lib/__tests__/enrich-branch-segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/endpoint/server-groups.ts lib/endpoint/__tests__/server-groups.test.ts lib/enrich.ts
git commit -m "endpoint: group running servers by ticket"
```

---

### Task 4: the command, list and JSON

The picker is behind `deps.pick` here; its rows and look are Task 5.

**Files:**
- Create: `commands/servers.ts`, `lib/uptime.ts`
- Modify: `commands/port.ts` (import `formatUptime` from `lib/uptime.ts`; its `__test__` keeps exposing it)
- Modify: `lib/command-tree-def.ts` (after `port`), `lib/module-registry.ts`
- Modify: `sites/docs/docs/rt/first-commands.mdx` (Status section), generated reference pages via `bun run docs:gen`
- Test: `commands/__tests__/servers.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3; `loadInterceptRules` (`lib/endpoint/shim.ts`), `loadEndpointConfig` (`lib/endpoint/config.ts`), `loadClaims` (`lib/endpoint/store.ts`), `parseIdentity` (`lib/settings/identity.ts`), `enrichBranches` (`lib/enrich.ts`), `repoLabel`, `withTransientStep`, `CommandContext`.
- Produces:

```ts
// lib/uptime.ts
export function formatUptime(etime: string): string; // moved unchanged from commands/port.ts

// commands/servers.ts
export interface ServersDeps {
  rules(identity: string): ServerRules;
  snapshot(repoRoot: string): Promise<ServerSnapshot | null>;
  enrich(servers: RunningServer[], opts: { remoteUrl?: string; silent: boolean }): Promise<Map<string, EnrichedBranch>>;
  pick(label: string, servers: RunningServer[], enriched: Promise<Map<string, EnrichedBranch>>): Promise<number[] | null>; // root pids
  stop: typeof stopServers;
  canAsk(): boolean; // stdin is a TTY and RT_BATCH is unset
  sleep(ms: number): Promise<void>;
}
export function serverBlocks(label: string, groups: ServerGroup[]): Block[];
export function serverHints(s: RunningServer): string[]; // "Claude session" | "<agent> session", "not listening", "left behind"
export function serversCommand(args: string[], ctx: CommandContext, deps?: ServersDeps): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

```ts
test("the list is a tree per ticket: id, state, title and MR, then each server", () => {
  expect(renderPlain(serverBlocks("sample-app", GROUPS))).toBe(
    "sample-app\n" +
    "WEB-240  [In Progress]  Split the settings page\n" +
    "  - api  :10402  3d  web-240-shell  !420 open  checks failed\n" +
    "WEB-198  [Done]  Fix rounding in order totals  !398 merged\n" +
    "  - api  :10400  22h  not listening\n" +
    "  - web  :4003   22h\n");
});
test("a server with no port says no port, and a detached group says detached", () => {
  expect(renderPlain(serverBlocks("sample-app", DETACHED))).toBe("sample-app\nslow-comet  detached\n  - api  no port  41m  Claude session, not listening\n");
});
test("no servers is one off line", () => { expect(renderPlain(serverBlocks("sample-app", []))).toBe("[off] No dev servers are running here  sample-app\n"); });
test("a repo with no intercept rules says that instead, and reads no processes", async () => { expect(io.stdout()).toBe("[off] rt does not intercept any commands here  sample-app\n"); expect(snapshotCalls).toBe(0); });
test("when it cannot ask it lists and never picks or stops", async () => { expect(io.stdout()).toStartWith("sample-app\n"); expect([pickCalls, stopCalls]).toEqual([0, 0]); });
test("the list waits three seconds for ticket data, then prints without it", async () => { /* enrich never settles */ expect(slept).toEqual([3_000]); expect(io.stdout()).toContain("web-214-login-rate-limit"); });
test("a failed ticket lookup still lists", async () => { /* enrich rejects */ expect(io.stdout()).toContain(":10401"); expect(process.exitCode).toBeFalsy(); });
test("the real gate needs a TTY and no RT_BATCH", () => { /* TTY on, then RT_BATCH=1, then TTY off */ expect([a, b, c]).toEqual([true, false, false]); });
test("--json is frozen, with an empty stderr, and never picks or looks up tickets", async () => {
  expect(JSON.parse(io.stdout())).toEqual({ ok: true, repo: IDENTITY, servers: [{
    role: "web", port: 4001, listening: true, worktree: { path: "/trees/calm-marble", name: "calm-marble" }, branch: "web-214-login-rate-limit",
    pid: 10, pids: [10, 11], startedAt: new Date("Tue Nov 24 14:45:47 2026").toISOString(), leftBehind: false, agent: null }] });
  expect(io.stderr()).toBe("");
  expect([pickCalls, enrichCalls]).toEqual([0, 0]);
});
test("--json with no rules is an empty list", async () => { expect(JSON.parse(io.stdout())).toEqual({ ok: true, repo: IDENTITY, servers: [] }); });
test("a failed read fails and lists nothing", async () => { expect(io.stdout()).toBe(""); expect(io.stderr()).toContain("rt could not read what is running"); expect(process.exitCode).toBe(1); });
test("a failed read under --json is an ok:false envelope", async () => { expect(JSON.parse(io.stdout())).toEqual({ ok: false, error: "rt could not read what is running" }); });
test("the picker opens before ticket data arrives", async () => { /* enrich never settles; pick resolves null */ expect(pickCalls).toBe(1); });
test("picking re-reads, then stops the picked ones and names each by port and title", async () => {
  expect(io.stdout()).toBe("[ok] Stopped web  :4001, Add a login rate limit\n[skipped] api had already stopped  :10401, Add a login rate limit\n");
});
test("a stop that failed is a failure with its reason", async () => { expect(io.stderr()).toBe("Could not stop api  :10400, Fix rounding in order totals\n  why: It did not stop.\n"); expect(process.exitCode).toBe(1); });
test("escaping the picker, or picking nothing, stops nothing", async () => { expect(io.stdout()).toBe("[skipped] Nothing selected\n"); expect(stopCalls).toBe(0); });
test("a re-read that fails after the pick stops nothing", async () => { expect(stopCalls).toBe(0); expect(process.exitCode).toBe(1); });
test("rt's own process and its ancestors are passed as spared", async () => { expect(spare.has(process.pid)).toBe(true); });
```

Reset `process.exitCode` to 0 in `afterEach`.

- [ ] **Step 2: Run them and see them fail**

Run: `bun test commands/__tests__/servers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `commands/servers.ts` and move `formatUptime`**

`rules(identity)` keeps only rules whose `repo === identity`, reads roles with `loadEndpointConfig({ repoIdentity: <the remote id, or null>, repoName: identity })`, and claims with `loadClaims(identity)`. `enrich` sends only worktrees with a branch, with `ctx.identity.remoteUrl`; `silent` is true for the picker and false for the list. Reads run under `withTransientStep("Looking for running servers", ...)`, the stop under `withTransientStep("Stopping servers", ...)`. Until Task 5 the real `pick` calls `filterableMultiselect` with one plain row per server, `match` from `serverMatch`.

- [ ] **Step 4: Add the node and the registry entry**

```ts
  servers: {
    description: "See this repo's running dev servers and stop them",
    module: "./commands/servers.ts",
    fn: "serversCommand",
    context: "repo",
    args: [
      { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Print the running servers as JSON and stop nothing" },
    ],
  },
```

Registry: `"./commands/servers.ts": () => import("../commands/servers.ts"),`. No `omitBehavior`: the leaf has no positional.

- [ ] **Step 5: Docs**

Add under Status in `sites/docs/docs/rt/first-commands.mdx`: ``- [`rt servers`](/rt/reference/servers) ... see this repo's running dev servers, by ticket, and stop them.`` Then run `bun run docs:gen`.

- [ ] **Step 6: Run the checks and see them pass**

Run: `bun test commands/__tests__/servers.test.ts commands/__tests__/port.test.ts lib/endpoint/__tests__ lib/__tests__/module-registry.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-ui-in-cli.test.ts lib/__tests__/picker-conformance.test.ts scripts/__tests__/docs-coverage.test.ts`
Expected: PASS.

Run: `bun run typecheck && bun run picker:check && bun run docs:check`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add commands lib sites
git commit -m "rt servers: list this repo's intercepted dev servers and stop picked ones"
```

---

## Part B: the picker, built live with Matt

Outside the review loop. Done inline in the session, against the boards, and iterated with Matt. No layout tests beyond the ones named here.

### Task 5: picker headings and rows

**Files:**
- Modify: `ui/internal/protocol/pick.go`, `ui/internal/views/picker/render.go`, `ui/internal/views/picker/picker.go`, `lib/ui/protocol.ts`, `lib/pick-wrappers.ts`, `ui/fixtures/pick-request.json`, `ui/fixtures/pick-update.json`
- Modify: `commands/servers.ts`
- Test: `ui/internal/protocol/pick_test.go`, `ui/internal/views/picker/picker_test.go`, `lib/ui/__tests__/protocol.test.ts`

**Interfaces:**
- Produces:

```ts
// lib/ui/protocol.ts; Go mirrors it in protocol/pick.go
export interface PickGroupHeading { left: PickSegment[]; right?: PickSegment[] }
// PickRequest and PickUpdate: groupHeadings?: Record<string, PickGroupHeading>, keyed by PickRow.group; an update replaces it whole
// lib/pick-wrappers.ts: filterableMultiselect opts gain groupHeadings and crumbSuffix, both passed through
```

- [ ] **Step 1: Failing contract tests, then the wire and the heading line.** The fixtures carry a heading with a `hex` segment and round-trip in both languages. In Go: a group with a heading paints its segments, its right side whole and its left clipped at 60 columns; a group without one paints exactly today's uppercase line; an update swaps headings with the cursor and marks kept. Run `bun run ui:test` and `bun test lib/ui/__tests__/protocol.test.ts`. Expected: PASS.
- [ ] **Step 2: The rows**, against `S1`, `S3` and `S4`: heading `[State]` padded to 15 in `stateColor`, title bold, right `mrSegments` then the ticket id; rows `role :port` as the one column segment, branch when set, hints, MR when set, uptime; `crumbSuffix` "ctrl-a marks all"; an action `{ id: "select", label: "stop", key: "enter", scope: "item", group: "mark", primary: true }`. The picker opens on `groupServers(servers, new Map())` and one `handle.update` carries rows and headings together.
- [ ] **Step 3: See it run.** In a repo with intercept rules, start harmless stand-ins from folders a rule covers, with `RT_INTERCEPT_BYPASS=1` (no claim, no hook) and `RT_INTERCEPT_REAL` pointing at a script that listens on a free port. From this worktree's source: the list off a terminal, `--json`, and the picker on a dark and a light terminal at 80 and 120 columns. Stop a stand-in from the picker and confirm its whole tree is gone. Kill another's rt process with SIGKILL and report what the list says about what is left. Hand Matt the pane.
- [ ] **Step 4: Commit** `rt servers: pick servers by ticket`, with `docs/design/servers/servers.pen`.
