# Harness Integrations F1 Gating Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the seven open Codex runtime questions with live evidence, so the four package plans can be re-planned on proven mechanisms instead of assumptions.

**Architecture:** A small probe kit under `scripts/probes/harness/`: a JSON-RPC client for Codex's control socket, an evidence recorder, an isolated lab (its own rt daemon, Herdr server and Codex daemon), three tiny recorder programs (CLI, MCP server, hook), pure verdict functions, and one live case module per question group. Unit tests cover everything except the live runs. The live runs write an evidence file; the last task turns it into an exit report and a go or stop decision per question.

**Tech Stack:** Bun 1.4 (`ws+unix://` WebSocket client, `Bun.serve({ unix })`, `fetch({ unix })`), Codex CLI 0.160 app-server protocol (experimental API), Herdr 0.9, rt daemon from this checkout, `bun:test`.

**Spec:** [Harness integrations design](../specs/2026-10-04-harness-integrations-design.md). Parent index: [plan index](2026-10-04-harness-integrations.md).

## Global Constraints

- "Unknown state must remain unknown." A case that cannot observe something records it as unobserved, never as a pass.
- "Transport submission is not proof of consumption or action."
- "This spec does not treat an environment-variable rename as a solution to that issue." (caller attribution)
- Every rt daemon, Herdr server and Codex daemon this spike starts is disposable and lives under the lab root. Never start, stop or restart the user's own rt daemon, Herdr server or `~/.codex` app-server daemon. Task 3 refuses to run if the real Codex control socket changes.
- Only the Codex worker processes use real authentication: the lab copies `~/.codex/auth.json` (mode 0600) into its own `CODEX_HOME` and deletes the copy at cleanup. Nothing else is copied from `~/.codex`.
- Lab root is `/tmp/hi-XXXXXX` (from `mkdtemp`), not the session scratchpad: a Unix socket path must stay under 104 bytes, and the scratchpad path alone is ~95. Task 3 asserts every socket path fits.
- No new dependencies. No changes outside `scripts/probes/harness/` and `docs/superpowers/` in this plan.
- Evidence passes through `redactDeep` from `lib/mcp/redact.ts` before it is written. Recorders keep an allowlist of environment keys; they never dump a whole environment.
- Run `bun test` from the repository root (its `bunfig.toml` preload isolates HOME).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A server request id is per connection (the spike saw `id: 0`): after a reconnect the same question can arrive under a different id. Correlate questions by `threadId` + `turnId` + `itemId`, never by request id alone (Task 6 tests this in `judgeQuestionRecovery`).
2. A worker whose command runs inside the shared Codex daemon inherits the daemon's `HERDR_PANE_ID`, not its pane's. The lab starts the daemon with a deliberately wrong `HERDR_PANE_ID=lab-controller` so the bug is visible (Task 5 asserts it is detected, not silently passed).
3. A hook that is configured but not loaded looks exactly like a hook that allowed everything. Task 7 reads `hooks/list` before trusting any policy result.
4. An MCP server shared by two threads can answer both correctly while still being unable to tell them apart. Task 5's verdict requires a per-call thread identity, not just two successful calls.
5. A failed probe run must still clean up the copied credential and stop the lab daemons. Task 3 tests that `stop()` removes `auth.json` even after a start failure.

## Questions and exit criteria

| Id | Question | Proven means | If not proven |
| --- | --- | --- | --- |
| G1 | Can a CLI command run by a Codex thread identify that thread, under a shared daemon, with wrong inherited Herdr variables? | Each worker's command sees its own `CODEX_THREAD_ID` | F4 has no CLI attribution path: revise the spec |
| G2 | Can the rt MCP server tell which Codex thread made each call? | Each call carries a thread identity (per-thread process env or request `_meta`) matching the caller | F4 needs per-thread MCP launch config, or the spec is revised |
| G3 | After the control client reconnects, can a pending synchronous question be found and answered? | The new connection receives or can discover the pending question and completes it, correlated by item | M5 keeps completion pending after reconnect and full support stays blocked |
| G4 | Does the async question variant have a native completion path? | Responding completes the question item, not just wakes the turn | Async questions are unsupported for unattended Codex gates |
| G5 | Can Codex hooks enforce policy (refuse a tool call, refuse a stop)? | `hooks/list` shows the hooks, a blocked tool call never runs, a blocked stop continues the turn | M6 cannot enforce on Codex: managed Codex workflows stay unavailable |
| G6 | What supported arrangement lets CLI and MCP reach `rt.sock`? | MCP reaches rt with no sandbox widening; the CLI result per sandbox setting is recorded | S4 records the needed arrangement or the spec is revised |
| G7 | Is consumption observable, and what survives a Codex daemon restart? | A queued input's `clientId` appears on a consumed user message item; thread, queue and pending question state after restart are recorded | M1 reports `queued` at best; recovery plans use the recorded restart behavior |

G1, G2, G3 and G5 are gating: if any is not proven, stop after Task 10 and revise the spec before re-planning. G4, G6 and G7 shape the plans but do not stop them.

## File structure

```
scripts/probes/harness/
  codex-control.ts      JSON-RPC client over ws+unix to a Codex control socket
  evidence.ts           live-mode guard, redacted event log, case results, cleanup rows
  lab.ts                isolated rt daemon, Herdr server and Codex daemon; worker launch
  probe-cli.ts          recorder a worker runs as a shell command (env snapshot, rt ping, sleep)
  probe-mcp.ts          minimal stdio MCP server recording each call's process and request
  probe-hook.ts         Codex hook command recording its payload and allowing or blocking
  verdicts.ts           pure judges: evidence in, verdict out
  cases/attribution.ts  G1, G2
  cases/questions.ts    G3, G4
  cases/policy.ts       G5
  cases/sockets.ts      G6
  cases/delivery.ts     G7
  run.ts                entry point: --live, --cases, --out
  __tests__/            unit tests for everything above except live cases
docs/superpowers/spikes/2026-10-05-harness-gate-spike-report.md   exit report (Task 10)
```

---

### Task 1: Codex control client

**Files:**
- Create: `scripts/probes/harness/codex-control.ts`
- Test: `scripts/probes/harness/__tests__/codex-control.test.ts`

**Interfaces:**
- Produces: `CodexControl.connect(opts: { socketPath: string; clientName: string; experimentalApi: boolean; timeoutMs?: number }): Promise<CodexControl>`; methods `call<T>(method: string, params: unknown): Promise<T>`, `notify(method: string, params: unknown): void`, `respond(id: RpcId, result: unknown): void`, `onNotification(fn): () => void`, `onServerRequest(fn): () => void`, `next(match: (m: Inbound) => boolean, timeoutMs: number): Promise<Inbound>`, `close(): void`. Types `RpcId = number | string`, `Inbound = { kind: "notification"; method: string; params: any } | { kind: "request"; id: RpcId; method: string; params: any }`, class `RpcError extends Error { code: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/probes/harness/__tests__/codex-control.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexControl, RpcError } from "../codex-control.ts";

type Seen = { method?: string; id?: unknown; params?: any; result?: any };

function fakeServer() {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  const socketPath = join(dir, "s.sock");
  const seen: Seen[] = [];
  const server = Bun.serve({
    unix: socketPath,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("upgrade only", { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        const msg = JSON.parse(String(raw));
        seen.push(msg);
        if (msg.method === "initialize") ws.send(JSON.stringify({ id: msg.id, result: { userAgent: "fake" } }));
        if (msg.method === "echo") ws.send(JSON.stringify({ id: msg.id, result: msg.params }));
        if (msg.method === "fail") ws.send(JSON.stringify({ id: msg.id, error: { code: -32000, message: "nope" } }));
        if (msg.method === "initialized") {
          ws.send(JSON.stringify({ method: "thread/started", params: { threadId: "t1" } }));
          ws.send(JSON.stringify({ id: 0, method: "item/tool/requestUserInput", params: { threadId: "t1", turnId: "u1", itemId: "i1" } }));
        }
      },
    },
  });
  return { socketPath, seen, stop: () => { server.stop(true); rmSync(dir, { recursive: true, force: true }); } };
}

let stopFake: (() => void) | undefined;
afterEach(() => stopFake?.());

describe("CodexControl", () => {
  test("initializes with experimentalApi, calls, and surfaces errors", async () => {
    const fake = fakeServer();
    stopFake = fake.stop;
    const ctl = await CodexControl.connect({ socketPath: fake.socketPath, clientName: "probe", experimentalApi: true });
    expect(fake.seen[0]).toMatchObject({ method: "initialize", params: { capabilities: { experimentalApi: true } } });
    expect(await ctl.call("echo", { a: 1 })).toEqual({ a: 1 });
    const err = await ctl.call("fail", {}).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(-32000);
    ctl.close();
  });

  test("delivers server requests and notifications, and sends responses", async () => {
    const fake = fakeServer();
    stopFake = fake.stop;
    const ctl = await CodexControl.connect({ socketPath: fake.socketPath, clientName: "probe", experimentalApi: true });
    const req = await ctl.next((m) => m.kind === "request" && m.method === "item/tool/requestUserInput", 2000);
    expect(req).toMatchObject({ kind: "request", id: 0, params: { itemId: "i1" } });
    if (req.kind !== "request") throw new Error("expected a request");
    ctl.respond(req.id, { answers: { choice: { answers: ["Beta"] } } });
    await Bun.sleep(50);
    expect(fake.seen.find((m) => m.id === 0 && m.result)).toMatchObject({ result: { answers: { choice: { answers: ["Beta"] } } } });
    ctl.close();
  });

  test("close rejects calls still waiting", async () => {
    const fake = fakeServer();
    stopFake = fake.stop;
    const ctl = await CodexControl.connect({ socketPath: fake.socketPath, clientName: "probe", experimentalApi: true });
    const pending = ctl.call("never-answered", {});
    ctl.close();
    await expect(pending).rejects.toThrow("closed");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test scripts/probes/harness/__tests__/codex-control.test.ts`
Expected: FAIL, cannot resolve `../codex-control.ts`.

- [ ] **Step 3: Implement the client**

```ts
// scripts/probes/harness/codex-control.ts
export type RpcId = number | string;
export type Inbound =
  | { kind: "notification"; method: string; params: any }
  | { kind: "request"; id: RpcId; method: string; params: any };

export class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class CodexControl {
  private seq = 0;
  private readonly pending = new Map<RpcId, Pending>();
  private readonly listeners = new Set<(m: Inbound) => void>();

  private constructor(private readonly ws: WebSocket, private readonly timeoutMs: number) {
    ws.onmessage = (event) => this.handle(String(event.data));
    ws.onclose = () => this.failAll(new Error("closed"));
  }

  static async connect(opts: { socketPath: string; clientName: string; experimentalApi: boolean; timeoutMs?: number }): Promise<CodexControl> {
    const ws = new WebSocket(`ws+unix://${opts.socketPath}`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`cannot connect to ${opts.socketPath}`));
    });
    const ctl = new CodexControl(ws, opts.timeoutMs ?? 25_000);
    await ctl.call("initialize", {
      clientInfo: { name: opts.clientName, version: "0.0.0" },
      capabilities: { experimentalApi: opts.experimentalApi },
    });
    ctl.notify("initialized", {});
    return ctl;
  }

  call<T = any>(method: string, params: unknown): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    this.ws.send(JSON.stringify({ method, params }));
  }

  respond(id: RpcId, result: unknown): void {
    this.ws.send(JSON.stringify({ id, result }));
  }

  onNotification(fn: (method: string, params: any) => void): () => void {
    return this.subscribe((m) => { if (m.kind === "notification") fn(m.method, m.params); });
  }

  onServerRequest(fn: (id: RpcId, method: string, params: any) => void): () => void {
    return this.subscribe((m) => { if (m.kind === "request") fn(m.id, m.method, m.params); });
  }

  next(match: (m: Inbound) => boolean, timeoutMs: number): Promise<Inbound> {
    return new Promise<Inbound>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error("no matching message")); }, timeoutMs);
      const off = this.subscribe((m) => {
        if (!match(m)) return;
        clearTimeout(timer);
        off();
        resolve(m);
      });
    });
  }

  close(): void {
    this.failAll(new Error("closed"));
    this.ws.close();
  }

  private subscribe(fn: (m: Inbound) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private handle(raw: string): void {
    const msg = JSON.parse(raw);
    if (msg.method === undefined && msg.id !== undefined) {
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(new RpcError(msg.error.code, msg.error.message));
      else waiter.resolve(msg.result);
      return;
    }
    const inbound: Inbound = msg.id !== undefined
      ? { kind: "request", id: msg.id, method: msg.method, params: msg.params }
      : { kind: "notification", method: msg.method, params: msg.params };
    for (const fn of [...this.listeners]) fn(inbound);
  }

  private failAll(err: Error): void {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
      this.pending.delete(id);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test scripts/probes/harness/__tests__/codex-control.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/probes/harness/codex-control.ts scripts/probes/harness/__tests__/codex-control.test.ts
git commit -m "test: add Codex control client for the harness gate spike"
```

### Task 2: Evidence recorder and live-mode guard

**Files:**
- Create: `scripts/probes/harness/evidence.ts`
- Test: `scripts/probes/harness/__tests__/evidence.test.ts`

**Interfaces:**
- Consumes: `redactDeep(value: unknown): unknown` from `lib/mcp/redact.ts`.
- Produces: `type QuestionId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7"`, `type Verdict = "proven" | "partial" | "blocked" | "not-run"`, `type CaseResult = { question: QuestionId; verdict: Verdict; observations: string[]; consequence: string }`, `type CleanupRow = { resource: string; ok: boolean; detail?: string }`, `requireLive(argv: string[]): void`, `createEvidence(dir: string, versions: Record<string, string>): Evidence` with `record(kind: string, data: unknown): void`, `addCase(r: CaseResult): void`, `addCleanup(r: CleanupRow): void`, `write(): string` (returns the report path), `readJsonl(file: string): any[]`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/probes/harness/__tests__/evidence.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidence, readJsonl, requireLive } from "../evidence.ts";

describe("evidence", () => {
  test("requireLive refuses without --live", () => {
    expect(() => requireLive(["--cases", "G1"])).toThrow("--live");
    expect(() => requireLive(["--live"])).not.toThrow();
  });

  test("events are redacted before they reach disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "ev-"));
    const ev = createEvidence(dir, { codex: "0.160.0" });
    ev.record("rpc", { url: "https://x.test/?private_token=glpat-abcdefghijklmnopqrst" });
    const raw = readFileSync(join(dir, "events.jsonl"), "utf8");
    expect(raw).not.toContain("glpat-abcdefghijklmnopqrst");
    expect(readJsonl(join(dir, "events.jsonl"))[0].kind).toBe("rpc");
  });

  test("report keeps a failed case as failed and lists cleanup", () => {
    const dir = mkdtempSync(join(tmpdir(), "ev-"));
    const ev = createEvidence(dir, { codex: "0.160.0" });
    ev.addCase({ question: "G3", verdict: "blocked", observations: ["no re-delivery"], consequence: "M5 stays pending" });
    ev.addCleanup({ resource: "lab codex daemon", ok: true });
    const report = JSON.parse(readFileSync(ev.write(), "utf8"));
    expect(report.cases[0]).toMatchObject({ question: "G3", verdict: "blocked" });
    expect(report.cleanup).toEqual([{ resource: "lab codex daemon", ok: true }]);
    expect(report.versions.codex).toBe("0.160.0");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test scripts/probes/harness/__tests__/evidence.test.ts`
Expected: FAIL, cannot resolve `../evidence.ts`.

- [ ] **Step 3: Implement**

```ts
// scripts/probes/harness/evidence.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactDeep } from "../../../lib/mcp/redact.ts";

export type QuestionId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7";
export type Verdict = "proven" | "partial" | "blocked" | "not-run";
export type CaseResult = { question: QuestionId; verdict: Verdict; observations: string[]; consequence: string };
export type CleanupRow = { resource: string; ok: boolean; detail?: string };

export type Evidence = {
  dir: string;
  record(kind: string, data: unknown): void;
  addCase(r: CaseResult): void;
  addCleanup(r: CleanupRow): void;
  write(): string;
};

export function requireLive(argv: string[]): void {
  if (!argv.includes("--live")) {
    throw new Error("This probe starts real Codex workers. Re-run with --live to confirm.");
  }
}

export function readJsonl(file: string): any[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function createEvidence(dir: string, versions: Record<string, string>): Evidence {
  mkdirSync(dir, { recursive: true });
  const cases: CaseResult[] = [];
  const cleanup: CleanupRow[] = [];
  const startedAt = new Date().toISOString();
  return {
    dir,
    record(kind, data) {
      appendFileSync(join(dir, "events.jsonl"), JSON.stringify(redactDeep({ at: Date.now(), kind, data })) + "\n");
    },
    addCase(r) { cases.push(r); },
    addCleanup(r) { cleanup.push(r); },
    write() {
      const path = join(dir, "report.json");
      writeFileSync(path, JSON.stringify(redactDeep({ startedAt, versions, cases, cleanup }), null, 2));
      return path;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test scripts/probes/harness/__tests__/evidence.test.ts`
Expected: PASS, 3 tests. If the redaction assertion fails, read `redactDeep` in `lib/mcp/redact.ts` and use a token shape it already redacts; do not add a second redactor.

- [ ] **Step 5: Commit**

```bash
git add scripts/probes/harness/evidence.ts scripts/probes/harness/__tests__/evidence.test.ts
git commit -m "test: add redacted evidence recorder for the harness gate spike"
```

### Task 3: Isolated lab

**Files:**
- Create: `scripts/probes/harness/lab.ts`
- Test: `scripts/probes/harness/__tests__/lab.test.ts`

**Interfaces:**
- Consumes: `Evidence`, `CleanupRow` (Task 2).
- Produces: `labPaths(root: string): LabPaths` with `{ root, home, work, evidence, policy, codexHome, codexSock, rtSock, herdrSock }`; `assertSocketPathFits(path: string): void`; `codexDaemonEnv(p: LabPaths, base: { PATH: string; realHome: string }): Record<string, string>`; `rtDaemonEnv(p: LabPaths, base: { PATH: string }, port: number): Record<string, string>`; `configToml(p: LabPaths, o: { bun: string; repo: string; model?: string; networkAccess: boolean }): string`; `startLab(o: { repo: string; realHome: string; model?: string; ev: Evidence }): Promise<Lab>` where `Lab = { paths: LabPaths; rt(cmd: string, payload: unknown): Promise<any>; herdr(...args: string[]): Promise<any>; codexDaemon(action: "start" | "stop" | "restart"): Promise<void>; launchWorker(name: string, extraArgs?: string[]): Promise<Worker>; workers: Worker[]; stop(): Promise<CleanupRow[]> }` and `Worker = { name: string; pane: string; cwd: string; threadId: string }`.

- [ ] **Step 1: Write the failing test (pure parts only)**

```ts
// scripts/probes/harness/__tests__/lab.test.ts
import { describe, expect, test } from "bun:test";
import { assertSocketPathFits, codexDaemonEnv, configToml, labPaths, rtDaemonEnv } from "../lab.ts";

const p = labPaths("/tmp/hi-abc123");

describe("lab paths and env", () => {
  test("all sockets live under the lab root and fit the macOS limit", () => {
    for (const sock of [p.codexSock, p.rtSock, p.herdrSock]) {
      expect(sock.startsWith("/tmp/hi-abc123/")).toBe(true);
      expect(() => assertSocketPathFits(sock)).not.toThrow();
    }
    expect(() => assertSocketPathFits("/x/" + "a".repeat(120))).toThrow("104");
  });

  test("the Codex daemon gets the lab CODEX_HOME and a deliberately wrong pane", () => {
    const env = codexDaemonEnv(p, { PATH: "/bin", realHome: "/Users/someone" });
    expect(env.CODEX_HOME).toBe(p.codexHome);
    expect(env.HOME).toBe("/Users/someone");
    expect(env.HERDR_PANE_ID).toBe("lab-controller");
    expect(env.HERDR_SOCKET_PATH).toBe("/nonexistent/lab-controller.sock");
  });

  test("the rt daemon is isolated", () => {
    const env = rtDaemonEnv(p, { PATH: "/bin" }, 19555);
    expect(env).toMatchObject({ HOME: p.home, RT_API_PORT: "19555", RT_SKIP_SETUP: "1", RT_GH_TOKEN_FALLBACK: "off" });
  });

  test("config wires the probe MCP server, the hooks and the sandbox", () => {
    const toml = configToml(p, { bun: "/b/bun", repo: "/r", networkAccess: false });
    expect(toml).toContain("[mcp_servers.probe]");
    expect(toml).toContain('"/r/scripts/probes/harness/probe-mcp.ts"');
    expect(toml).toContain("[[hooks.PreToolUse]]");
    expect(toml).toContain("[[hooks.Stop]]");
    expect(toml).toContain("[[hooks.SessionStart]]");
    expect(toml).toContain("network_access = false");
    expect(toml).not.toContain("model =");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test scripts/probes/harness/__tests__/lab.test.ts`
Expected: FAIL, cannot resolve `../lab.ts`.

- [ ] **Step 3: Implement**

```ts
// scripts/probes/harness/lab.ts
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CleanupRow, Evidence } from "./evidence.ts";
import { CodexControl } from "./codex-control.ts";

export type LabPaths = {
  root: string; home: string; work: string; evidence: string; policy: string;
  codexHome: string; codexSock: string; rtSock: string; herdrSock: string;
};
export type Worker = { name: string; pane: string; cwd: string; threadId: string };
export type Lab = {
  paths: LabPaths;
  rt(cmd: string, payload: unknown): Promise<any>;
  herdr(...args: string[]): Promise<any>;
  codexDaemon(action: "start" | "stop" | "restart"): Promise<void>;
  launchWorker(name: string, extraArgs?: string[]): Promise<Worker>;
  workers: Worker[];
  stop(): Promise<CleanupRow[]>;
};

const SOCKET_LIMIT = 104;

export function labPaths(root: string): LabPaths {
  const home = join(root, "home");
  const codexHome = join(root, "codex");
  return {
    root, home, codexHome,
    work: join(root, "work"),
    evidence: join(root, "evidence"),
    policy: join(root, "policy"),
    codexSock: join(codexHome, "app-server-control", "app-server-control.sock"),
    rtSock: join(home, ".mattstack", "rt", "rt.sock"),
    herdrSock: join(home, ".config", "herdr", "herdr.sock"),
  };
}

export function assertSocketPathFits(path: string): void {
  if (Buffer.byteLength(path) >= SOCKET_LIMIT) {
    throw new Error(`socket path is ${Buffer.byteLength(path)} bytes; macOS needs under ${SOCKET_LIMIT}: ${path}`);
  }
}

export function codexDaemonEnv(p: LabPaths, base: { PATH: string; realHome: string }): Record<string, string> {
  return {
    PATH: base.PATH, HOME: base.realHome, CODEX_HOME: p.codexHome,
    SHELL: "/bin/zsh", TERM: "xterm-256color", LANG: "en_US.UTF-8",
    HERDR_PANE_ID: "lab-controller",
    HERDR_SOCKET_PATH: "/nonexistent/lab-controller.sock",
  };
}

export function rtDaemonEnv(p: LabPaths, base: { PATH: string }, port: number): Record<string, string> {
  return {
    PATH: base.PATH, HOME: p.home, RT_API_PORT: String(port),
    RT_SKIP_SETUP: "1", RT_GH_TOKEN_FALLBACK: "off", LANG: "en_US.UTF-8",
  };
}

export function configToml(p: LabPaths, o: { bun: string; repo: string; model?: string; networkAccess: boolean }): string {
  const kit = `${o.repo}/scripts/probes/harness`;
  const hook = (event: string) =>
    `${o.bun} ${kit}/probe-hook.ts ${p.evidence}/hooks.jsonl ${event} ${p.policy}`;
  return [
    o.model ? `model = ${JSON.stringify(o.model)}` : "",
    `approval_policy = "never"`,
    `sandbox_mode = "workspace-write"`,
    ``,
    `[sandbox_workspace_write]`,
    `network_access = ${o.networkAccess}`,
    `writable_roots = [${JSON.stringify(p.evidence)}]`,
    ``,
    `[mcp_servers.probe]`,
    `command = ${JSON.stringify(o.bun)}`,
    `args = [${JSON.stringify(`${kit}/probe-mcp.ts`)}, ${JSON.stringify(`${p.evidence}/mcp.jsonl`)}]`,
    ``,
    ...["PreToolUse", "Stop", "SessionStart"].flatMap((event) => [
      `[[hooks.${event}]]`,
      `[[hooks.${event}.hooks]]`,
      `type = "command"`,
      `command = ${JSON.stringify(hook(event))}`,
      ``,
    ]),
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

async function waitFor(check: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await Bun.sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function socketFingerprint(path: string): string {
  if (!existsSync(path)) return "absent";
  const s = statSync(path);
  return `${s.ino}:${s.mtimeMs}`;
}

async function run(argv: string[], env: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(argv, { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out, err };
}

export async function startLab(o: { repo: string; realHome: string; model?: string; ev: Evidence }): Promise<Lab> {
  const root = mkdtempSync("/tmp/hi-");
  const paths = labPaths(root);
  for (const sock of [paths.codexSock, paths.rtSock, paths.herdrSock]) assertSocketPathFits(sock);
  for (const dir of [paths.home, paths.work, paths.evidence, paths.policy, paths.codexHome]) mkdirSync(dir, { recursive: true });

  const PATH = process.env.PATH ?? "/usr/bin:/bin";
  const bun = Bun.which("bun") ?? "bun";
  const codex = Bun.which("codex") ?? "codex";
  const herdrBin = Bun.which("herdr") ?? "herdr";
  const realControl = join(o.realHome, ".codex", "app-server-control", "app-server-control.sock");
  const realBefore = socketFingerprint(realControl);
  const cleanup: CleanupRow[] = [];
  const children: { name: string; proc: ReturnType<typeof Bun.spawn> }[] = [];
  const authCopy = join(paths.codexHome, "auth.json");

  const stop = async (): Promise<CleanupRow[]> => {
    const codexEnv = codexDaemonEnv(paths, { PATH, realHome: o.realHome });
    const d = await run([codex, "app-server", "daemon", "stop"], codexEnv).catch((e) => ({ code: 1, out: "", err: String(e) }));
    cleanup.push({ resource: "lab codex daemon", ok: d.code === 0, detail: d.err.trim() || undefined });
    const h = await run([herdrBin, "server", "stop"], { PATH, HOME: paths.home }).catch((e) => ({ code: 1, out: "", err: String(e) }));
    cleanup.push({ resource: "lab herdr server", ok: h.code === 0, detail: h.err.trim() || undefined });
    for (const c of children) {
      c.proc.kill();
      cleanup.push({ resource: c.name, ok: true });
    }
    rmSync(authCopy, { force: true });
    cleanup.push({ resource: "copied codex auth.json", ok: !existsSync(authCopy) });
    cleanup.push({ resource: "real codex control socket unchanged", ok: socketFingerprint(realControl) === realBefore });
    return cleanup;
  };

  try {
    copyFileSync(join(o.realHome, ".codex", "auth.json"), authCopy);
    chmodSync(authCopy, 0o600);
    writeFileSync(join(paths.codexHome, "config.toml"), configToml(paths, { bun, repo: o.repo, model: o.model, networkAccess: false }));
    writeFileSync(join(paths.policy, "PreToolUse.json"), JSON.stringify({ block: [], style: "exit2" }));
    writeFileSync(join(paths.policy, "Stop.json"), JSON.stringify({ blockOnce: false, style: "exit2" }));

    const port = 19_000 + Math.floor(Math.random() * 900);
    const rtProc = Bun.spawn([bun, join(o.repo, "lib", "daemon.ts")], {
      env: rtDaemonEnv(paths, { PATH }, port), cwd: paths.work,
      stdout: Bun.file(join(paths.evidence, "rt-daemon.log")), stderr: Bun.file(join(paths.evidence, "rt-daemon.err.log")),
    });
    children.push({ name: "lab rt daemon", proc: rtProc });
    const rt = async (cmd: string, payload: unknown) => {
      const res = await fetch(`http://localhost/${cmd}`, {
        unix: paths.rtSock, method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" },
      } as RequestInit);
      return res.json();
    };
    await waitFor(async () => existsSync(paths.rtSock) && (await rt("ping", {}).then((r) => r.ok === true, () => false)), 30_000, "lab rt daemon");

    const herdrProc = Bun.spawn([herdrBin, "server"], {
      env: { PATH, HOME: paths.home, TERM: "xterm-256color" },
      stdout: Bun.file(join(paths.evidence, "herdr.log")), stderr: Bun.file(join(paths.evidence, "herdr.err.log")),
    });
    children.push({ name: "lab herdr server", proc: herdrProc });
    await waitFor(() => existsSync(paths.herdrSock), 15_000, "lab herdr server");
    const herdr = async (...args: string[]) => {
      const r = await run([herdrBin, ...args], { PATH, HOME: paths.home, HERDR_SOCKET_PATH: paths.herdrSock });
      o.ev.record(`herdr ${args.slice(0, 2).join(" ")}`, { code: r.code, out: r.out.slice(0, 4000) });
      try { return JSON.parse(r.out || r.err); } catch { return { code: r.code, out: r.out, err: r.err }; }
    };

    const codexDaemon = async (action: "start" | "stop" | "restart") => {
      const r = await run([codex, "app-server", "daemon", action], codexDaemonEnv(paths, { PATH, realHome: o.realHome }));
      o.ev.record(`codex daemon ${action}`, { code: r.code, err: r.err.slice(0, 2000) });
      if (action !== "stop") await waitFor(() => existsSync(paths.codexSock), 30_000, "lab codex control socket");
      if (socketFingerprint(realControl) !== realBefore) {
        throw new Error("the real ~/.codex control socket changed; refusing to continue");
      }
    };
    await codexDaemon("start");

    const workers: Worker[] = [];
    const launchWorker = async (name: string, extraArgs: string[] = []): Promise<Worker> => {
      const cwd = join(paths.work, name);
      mkdirSync(cwd, { recursive: true });
      const ws = await herdr("workspace", "create", "--cwd", cwd, "--label", name, "--no-focus");
      const pane: string = ws?.result?.root_pane?.pane_id;
      if (!pane) throw new Error(`herdr did not return a pane for ${name}`);
      const argv = [
        "env", `CODEX_HOME=${paths.codexHome}`, codex, "--no-alt-screen", "-C", cwd,
        "-s", "workspace-write", "-a", "never", "--add-dir", paths.evidence, ...extraArgs,
        "Reply READY and nothing else.",
      ];
      await herdr("pane", "run", pane, argv.map((a) => (/[\s'"]/.test(a) ? `'${a.replaceAll("'", "'\\''")}'` : a)).join(" "));
      const ctl = await CodexControl.connect({ socketPath: paths.codexSock, clientName: "harness_gate_spike", experimentalApi: true });
      try {
        let threadId = "";
        await waitFor(async () => {
          const loaded = await ctl.call<any>("thread/loaded/list", {});
          const ids: string[] = (loaded?.data ?? []).map((t: any) => (typeof t === "string" ? t : t.id));
          for (const id of ids) {
            const read = await ctl.call<any>("thread/read", { threadId: id, includeTurns: false });
            if (read?.thread?.cwd === cwd) { threadId = id; return true; }
          }
          return false;
        }, 90_000, `a thread for ${name} on the lab daemon`);
        o.ev.record("worker launched", { name, pane, cwd, threadId });
        const worker = { name, pane, cwd, threadId };
        workers.push(worker);
        return worker;
      } finally {
        ctl.close();
      }
    };

    return { paths, rt, herdr, codexDaemon, launchWorker, workers, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test scripts/probes/harness/__tests__/lab.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Live smoke of the lab alone**

Run this one-off from the repo root and read the output.

```bash
bun -e '
import { startLab } from "./scripts/probes/harness/lab.ts";
import { createEvidence } from "./scripts/probes/harness/evidence.ts";
const ev = createEvidence("/tmp/hi-smoke-evidence", {});
const lab = await startLab({ repo: process.cwd(), realHome: process.env.HOME!, ev });
console.log("rt ping", await lab.rt("ping", {}));
console.log(await lab.stop());
'
```

Expected: `rt ping { ok: true, ... }`, then cleanup rows that are all `ok: true`, including `real codex control socket unchanged`. If `lab codex control socket` times out, `CODEX_HOME` does not move the daemon's socket on this Codex version: stop, record that in the spike report as a G7 restart limitation, and ask Matt before testing against any other daemon.

- [ ] **Step 6: Commit**

```bash
git add scripts/probes/harness/lab.ts scripts/probes/harness/__tests__/lab.test.ts
git commit -m "test: add isolated rt, Herdr and Codex lab for the harness gate spike"
```

### Task 4: Recorder programs (CLI, MCP server, hook)

**Files:**
- Create: `scripts/probes/harness/probe-cli.ts`, `scripts/probes/harness/probe-mcp.ts`, `scripts/probes/harness/probe-hook.ts`
- Test: `scripts/probes/harness/__tests__/recorders.test.ts`

**Interfaces:**
- Produces: `ENV_KEYS: readonly string[]` and `envSnapshot(env: Record<string, string | undefined>): Record<string, string>` (in `probe-cli.ts`); `handleMcpMessage(state: { init?: unknown }, msg: any, record: (row: unknown) => void, env: Record<string, string | undefined>): any | undefined` (in `probe-mcp.ts`, returns the response or `undefined` for a notification); `decideHook(event: string, payload: any, policy: { block?: string[]; blockOnce?: boolean; style: "exit2" | "json" }): { exitCode: number; stdout: string; stderr: string; consumeOnce: boolean }` and `toolNameOf(payload: any): string | undefined` (in `probe-hook.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// scripts/probes/harness/__tests__/recorders.test.ts
import { describe, expect, test } from "bun:test";
import { envSnapshot } from "../probe-cli.ts";
import { handleMcpMessage } from "../probe-mcp.ts";
import { decideHook, toolNameOf } from "../probe-hook.ts";

describe("probe-cli", () => {
  test("snapshots only allowlisted keys", () => {
    const snap = envSnapshot({ CODEX_THREAD_ID: "t1", HERDR_PANE_ID: "w1:p1", OPENAI_API_KEY: "sk-secret", PATH: "/bin" });
    expect(snap).toEqual({ CODEX_THREAD_ID: "t1", HERDR_PANE_ID: "w1:p1" });
  });
});

describe("probe-mcp", () => {
  test("answers initialize, lists tools, and records each call with its _meta", () => {
    const rows: any[] = [];
    const state: { init?: unknown } = {};
    const env = { CODEX_THREAD_ID: "t9" };
    const init = handleMcpMessage(state, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "codex" } } }, (r) => rows.push(r), env);
    expect(init.result.capabilities.tools).toEqual({});
    expect(handleMcpMessage(state, { jsonrpc: "2.0", method: "notifications/initialized" }, (r) => rows.push(r), env)).toBeUndefined();
    const list = handleMcpMessage(state, { jsonrpc: "2.0", id: 2, method: "tools/list" }, (r) => rows.push(r), env);
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["probe_whoami", "probe_rt_ping"]);
    const call = handleMcpMessage(state, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "probe_whoami", arguments: { marker: "w1-mcp" }, _meta: { threadId: "t9" } } }, (r) => rows.push(r), env);
    expect(call.result.content[0].type).toBe("text");
    const row = rows.find((r) => r.marker === "w1-mcp");
    expect(row).toMatchObject({ meta: { threadId: "t9" }, env: { CODEX_THREAD_ID: "t9" }, init: { clientInfo: { name: "codex" } } });
    expect(typeof row.pid).toBe("number");
  });
});

describe("probe-hook", () => {
  test("finds the tool name in the payload shapes Codex may use", () => {
    expect(toolNameOf({ tool_name: "shell" })).toBe("shell");
    expect(toolNameOf({ toolName: "request_user_input" })).toBe("request_user_input");
    expect(toolNameOf({ tool: { name: "x" } })).toBe("x");
    expect(toolNameOf({})).toBeUndefined();
  });

  test("blocks a listed tool with exit 2 or a JSON decision", () => {
    expect(decideHook("PreToolUse", { tool_name: "request_user_input" }, { block: ["request_user_input"], style: "exit2" })).toMatchObject({ exitCode: 2 });
    const json = decideHook("PreToolUse", { tool_name: "request_user_input" }, { block: ["request_user_input"], style: "json" });
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ decision: "block" });
    expect(decideHook("PreToolUse", { tool_name: "shell" }, { block: ["request_user_input"], style: "exit2" })).toMatchObject({ exitCode: 0, stdout: "" });
  });

  test("blocks a stop once, then allows", () => {
    const first = decideHook("Stop", {}, { blockOnce: true, style: "exit2" });
    expect(first).toMatchObject({ exitCode: 2, consumeOnce: true });
    expect(decideHook("Stop", {}, { blockOnce: false, style: "exit2" })).toMatchObject({ exitCode: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test scripts/probes/harness/__tests__/recorders.test.ts`
Expected: FAIL, cannot resolve the three modules.

- [ ] **Step 3: Implement `probe-cli.ts`**

```ts
// scripts/probes/harness/probe-cli.ts
import { appendFileSync } from "node:fs";

export const ENV_KEYS = [
  "CODEX_THREAD_ID", "CODEX_SESSION_ID", "HERDR_PANE_ID", "HERDR_SOCKET_PATH",
  "HERDR_ENV", "HERDR_WORKSPACE_ID", "CLAUDE_CODE_SESSION_ID",
] as const;

export function envSnapshot(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) if (env[key]) out[key] = env[key]!;
  return out;
}

async function rtPing(sock: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("http://localhost/ping", { unix: sock, method: "POST", body: "{}" } as RequestInit);
    const body = await res.json();
    return { ok: body?.ok === true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

if (import.meta.main) {
  const [verb, file, marker, sock] = process.argv.slice(2);
  const row: Record<string, unknown> = {
    at: Date.now(), verb, marker, pid: process.pid, ppid: process.ppid, cwd: process.cwd(), env: envSnapshot(process.env),
  };
  if (verb === "sleep") await Bun.sleep(Math.min(Number(marker) || 0, 60) * 1000);
  if (verb === "rt-ping") row.rt = await rtPing(sock);
  appendFileSync(file, JSON.stringify(row) + "\n");
  process.stdout.write(`${JSON.stringify(row)}\n`);
}
```

Usage the cases rely on: `bun probe-cli.ts record <file> <marker>`, `bun probe-cli.ts sleep <file> <seconds>`, `bun probe-cli.ts rt-ping <file> <marker> <sock>`.

- [ ] **Step 4: Implement `probe-mcp.ts`**

```ts
// scripts/probes/harness/probe-mcp.ts
import { appendFileSync } from "node:fs";
import { envSnapshot } from "./probe-cli.ts";

const TOOLS = [
  { name: "probe_whoami", description: "Record which process and request served this call.", inputSchema: { type: "object", properties: { marker: { type: "string" } }, required: ["marker"] } },
  { name: "probe_rt_ping", description: "Ping an rt daemon socket from the MCP server process.", inputSchema: { type: "object", properties: { marker: { type: "string" }, sock: { type: "string" } }, required: ["marker", "sock"] } },
];

export function handleMcpMessage(state: { init?: unknown }, msg: any, record: (row: unknown) => void, env: Record<string, string | undefined>): any | undefined {
  if (msg.id === undefined) return undefined;
  if (msg.method === "initialize") {
    state.init = msg.params;
    record({ kind: "initialize", pid: process.pid, env: envSnapshot(env), init: msg.params });
    return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "probe", version: "0.0.0" } } };
  }
  if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } };
  if (msg.method === "tools/call") {
    const args = msg.params?.arguments ?? {};
    const row = { kind: "call", tool: msg.params?.name, marker: args.marker, pid: process.pid, env: envSnapshot(env), meta: msg.params?._meta ?? null, init: state.init ?? null };
    record(row);
    return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(row) }] } };
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } };
}

async function pingFrom(sock: string): Promise<unknown> {
  try {
    const res = await fetch("http://localhost/ping", { unix: sock, method: "POST", body: "{}" } as RequestInit);
    return await res.json();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

if (import.meta.main) {
  const file = process.argv[2];
  const record = (row: unknown) => appendFileSync(file, JSON.stringify({ at: Date.now(), ...(row as object) }) + "\n");
  const state: { init?: unknown } = {};
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += new TextDecoder().decode(chunk);
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      let reply = handleMcpMessage(state, msg, record, process.env);
      if (reply && msg.params?.name === "probe_rt_ping") {
        const ping = await pingFrom(msg.params.arguments.sock);
        record({ kind: "rt-ping", marker: msg.params.arguments.marker, pid: process.pid, ping });
        reply = { ...reply, result: { content: [{ type: "text", text: JSON.stringify(ping) }] } };
      }
      if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    }
  }
}
```

- [ ] **Step 5: Implement `probe-hook.ts`**

```ts
// scripts/probes/harness/probe-hook.ts
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envSnapshot } from "./probe-cli.ts";

type Policy = { block?: string[]; blockOnce?: boolean; style: "exit2" | "json" };

export function toolNameOf(payload: any): string | undefined {
  return payload?.tool_name ?? payload?.toolName ?? payload?.tool?.name ?? undefined;
}

export function decideHook(event: string, payload: any, policy: Policy): { exitCode: number; stdout: string; stderr: string; consumeOnce: boolean } {
  const reason = `blocked by harness gate spike (${event})`;
  const block = event === "Stop" ? policy.blockOnce === true : (policy.block ?? []).includes(toolNameOf(payload) ?? "");
  if (!block) return { exitCode: 0, stdout: "", stderr: "", consumeOnce: false };
  if (policy.style === "json") return { exitCode: 0, stdout: JSON.stringify({ decision: "block", reason }), stderr: "", consumeOnce: event === "Stop" };
  return { exitCode: 2, stdout: "", stderr: reason, consumeOnce: event === "Stop" };
}

if (import.meta.main) {
  const [file, event, policyDir] = process.argv.slice(2);
  const raw = await new Response(Bun.stdin.stream()).text();
  let payload: any = null;
  try { payload = JSON.parse(raw); } catch { payload = { unparsed: raw.slice(0, 2000) }; }
  const policyFile = join(policyDir, `${event}.json`);
  const policy: Policy = existsSync(policyFile) ? JSON.parse(readFileSync(policyFile, "utf8")) : { style: "exit2" };
  const decision = decideHook(event, payload, policy);
  if (decision.consumeOnce) writeFileSync(policyFile, JSON.stringify({ ...policy, blockOnce: false }));
  appendFileSync(file, JSON.stringify({ at: Date.now(), event, pid: process.pid, env: envSnapshot(process.env), payload, decision }) + "\n");
  if (decision.stdout) process.stdout.write(decision.stdout);
  if (decision.stderr) process.stderr.write(decision.stderr);
  process.exit(decision.exitCode);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test scripts/probes/harness/__tests__/recorders.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/probes/harness/probe-cli.ts scripts/probes/harness/probe-mcp.ts scripts/probes/harness/probe-hook.ts scripts/probes/harness/__tests__/recorders.test.ts
git commit -m "test: add CLI, MCP and hook recorders for the harness gate spike"
```

### Task 5: Verdict judges

**Files:**
- Create: `scripts/probes/harness/verdicts.ts`
- Test: `scripts/probes/harness/__tests__/verdicts.test.ts`

**Interfaces:**
- Consumes: `CaseResult` (Task 2), `Worker` (Task 3), recorder rows (Task 4).
- Produces:
  - `judgeCliAttribution(workers: Worker[], cliRows: any[]): CaseResult` (G1)
  - `judgeMcpAttribution(workers: Worker[], mcpRows: any[]): CaseResult` (G2)
  - `judgeQuestionRecovery(obs: { firstRequest?: QuestionRef; replayed?: QuestionRef; flagsAfterReconnect: string[]; answeredAfterReconnect: boolean; finalMentionsAnswer: boolean }): CaseResult` (G3), with `QuestionRef = { requestId: number | string; threadId: string; turnId: string; itemId: string }`
  - `judgeAsyncQuestion(obs: { sawNativeRequest: boolean; itemCompletedAfterResponse: boolean; wokeOnlyBySteer: boolean }): CaseResult` (G4)
  - `judgePolicy(obs: { hooksListed: number; toolBlocked: boolean; toolRanAnyway: boolean; stopBlocked: boolean; styleUsed: string }): CaseResult` (G5)
  - `judgeSockets(obs: { cliDefault: boolean; cliNetwork: boolean; mcp: boolean }): CaseResult` (G6)
  - `judgeDelivery(obs: { consumedClientIdSeen: boolean; queuedAfterRestart?: boolean; threadResumedAfterRestart?: boolean; pendingQuestionAfterRestart?: boolean }): CaseResult` (G7)

- [ ] **Step 1: Write the failing test**

```ts
// scripts/probes/harness/__tests__/verdicts.test.ts
import { describe, expect, test } from "bun:test";
import {
  judgeAsyncQuestion, judgeCliAttribution, judgeDelivery, judgeMcpAttribution,
  judgePolicy, judgeQuestionRecovery, judgeSockets,
} from "../verdicts.ts";

const workers = [
  { name: "w1", pane: "w1:p0", cwd: "/l/work/w1", threadId: "T1" },
  { name: "w2", pane: "w2:p0", cwd: "/l/work/w2", threadId: "T2" },
];

describe("G1 CLI attribution", () => {
  test("proven when each command sees its own thread, and flags the inherited pane", () => {
    const rows = [
      { marker: "w1-cli", env: { CODEX_THREAD_ID: "T1", HERDR_PANE_ID: "lab-controller" } },
      { marker: "w2-cli", env: { CODEX_THREAD_ID: "T2", HERDR_PANE_ID: "lab-controller" } },
    ];
    const r = judgeCliAttribution(workers, rows);
    expect(r.verdict).toBe("proven");
    expect(r.observations.join(" ")).toContain("inherited HERDR_PANE_ID");
  });
  test("blocked when a command sees another thread", () => {
    const rows = [
      { marker: "w1-cli", env: { CODEX_THREAD_ID: "T2" } },
      { marker: "w2-cli", env: { CODEX_THREAD_ID: "T2" } },
    ];
    expect(judgeCliAttribution(workers, rows).verdict).toBe("blocked");
  });
  test("not-run when a worker recorded nothing", () => {
    expect(judgeCliAttribution(workers, [{ marker: "w1-cli", env: { CODEX_THREAD_ID: "T1" } }]).verdict).toBe("not-run");
  });
});

describe("G2 MCP attribution", () => {
  test("proven by per-call _meta thread ids from one shared process", () => {
    const rows = [
      { kind: "call", marker: "w1-mcp", pid: 10, env: {}, meta: { threadId: "T1" } },
      { kind: "call", marker: "w2-mcp", pid: 10, env: {}, meta: { threadId: "T2" } },
    ];
    expect(judgeMcpAttribution(workers, rows).verdict).toBe("proven");
  });
  test("proven by per-thread processes whose env names the thread", () => {
    const rows = [
      { kind: "call", marker: "w1-mcp", pid: 10, env: { CODEX_THREAD_ID: "T1" }, meta: null },
      { kind: "call", marker: "w2-mcp", pid: 11, env: { CODEX_THREAD_ID: "T2" }, meta: null },
    ];
    expect(judgeMcpAttribution(workers, rows).verdict).toBe("proven");
  });
  test("partial when one shared process gets no thread identity, even though both calls worked", () => {
    const rows = [
      { kind: "call", marker: "w1-mcp", pid: 10, env: {}, meta: null },
      { kind: "call", marker: "w2-mcp", pid: 10, env: {}, meta: null },
    ];
    expect(judgeMcpAttribution(workers, rows).verdict).toBe("partial");
  });
});

describe("G3 question recovery", () => {
  const first = { requestId: 0, threadId: "T1", turnId: "U1", itemId: "I1" };
  test("proven when the replay is the same item under a different request id and gets answered", () => {
    const r = judgeQuestionRecovery({ firstRequest: first, replayed: { ...first, requestId: 3 }, flagsAfterReconnect: ["waitingOnUserInput"], answeredAfterReconnect: true, finalMentionsAnswer: true });
    expect(r.verdict).toBe("proven");
    expect(r.observations.join(" ")).toContain("request id changed");
  });
  test("blocked when a replay names a different item", () => {
    const r = judgeQuestionRecovery({ firstRequest: first, replayed: { ...first, itemId: "I9" }, flagsAfterReconnect: [], answeredAfterReconnect: true, finalMentionsAnswer: true });
    expect(r.verdict).toBe("blocked");
  });
  test("partial when the flag shows a pending question but nothing can answer it", () => {
    const r = judgeQuestionRecovery({ firstRequest: first, flagsAfterReconnect: ["waitingOnUserInput"], answeredAfterReconnect: false, finalMentionsAnswer: false });
    expect(r.verdict).toBe("partial");
  });
});

describe("G4, G5, G6, G7", () => {
  test("async steering alone is partial", () => {
    expect(judgeAsyncQuestion({ sawNativeRequest: false, itemCompletedAfterResponse: false, wokeOnlyBySteer: true }).verdict).toBe("partial");
    expect(judgeAsyncQuestion({ sawNativeRequest: true, itemCompletedAfterResponse: true, wokeOnlyBySteer: false }).verdict).toBe("proven");
  });
  test("policy is blocked when no hooks loaded, whatever else happened", () => {
    expect(judgePolicy({ hooksListed: 0, toolBlocked: true, toolRanAnyway: false, stopBlocked: true, styleUsed: "exit2" }).verdict).toBe("blocked");
    expect(judgePolicy({ hooksListed: 3, toolBlocked: true, toolRanAnyway: false, stopBlocked: true, styleUsed: "exit2" }).verdict).toBe("proven");
    expect(judgePolicy({ hooksListed: 3, toolBlocked: true, toolRanAnyway: true, stopBlocked: true, styleUsed: "exit2" }).verdict).toBe("blocked");
  });
  test("sockets proven only through MCP without widening", () => {
    expect(judgeSockets({ cliDefault: false, cliNetwork: true, mcp: true }).verdict).toBe("proven");
    expect(judgeSockets({ cliDefault: false, cliNetwork: true, mcp: false }).verdict).toBe("partial");
  });
  test("delivery needs the consumed clientId", () => {
    expect(judgeDelivery({ consumedClientIdSeen: false }).verdict).toBe("partial");
    expect(judgeDelivery({ consumedClientIdSeen: true, queuedAfterRestart: false, threadResumedAfterRestart: true }).verdict).toBe("proven");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test scripts/probes/harness/__tests__/verdicts.test.ts`
Expected: FAIL, cannot resolve `../verdicts.ts`.

- [ ] **Step 3: Implement**

```ts
// scripts/probes/harness/verdicts.ts
import type { CaseResult } from "./evidence.ts";
import type { Worker } from "./lab.ts";

export type QuestionRef = { requestId: number | string; threadId: string; turnId: string; itemId: string };

export function judgeCliAttribution(workers: Worker[], cliRows: any[]): CaseResult {
  const observations: string[] = [];
  let mismatched = false;
  for (const w of workers) {
    const row = cliRows.find((r) => r.marker === `${w.name}-cli`);
    if (!row) return { question: "G1", verdict: "not-run", observations: [`${w.name} recorded no CLI row`], consequence: "Re-run G1." };
    const seen = row.env?.CODEX_THREAD_ID;
    observations.push(`${w.name}: CODEX_THREAD_ID ${seen === w.threadId ? "matches" : `is ${seen ?? "absent"}, expected ${w.threadId}`}`);
    if (seen !== w.threadId) mismatched = true;
    const pane = row.env?.HERDR_PANE_ID;
    if (pane && pane !== w.pane) observations.push(`${w.name}: inherited HERDR_PANE_ID ${pane}, its pane is ${w.pane}`);
  }
  return mismatched
    ? { question: "G1", verdict: "blocked", observations, consequence: "F4 has no CLI attribution path; revise the spec before re-planning." }
    : { question: "G1", verdict: "proven", observations, consequence: "F4 binds CLI callers by CODEX_THREAD_ID; Herdr variables stay hints only." };
}

export function judgeMcpAttribution(workers: Worker[], mcpRows: any[]): CaseResult {
  const observations: string[] = [];
  const calls = workers.map((w) => ({ w, row: mcpRows.find((r) => r.kind === "call" && r.marker === `${w.name}-mcp`) }));
  if (calls.some((c) => !c.row)) return { question: "G2", verdict: "not-run", observations: ["a worker made no MCP call"], consequence: "Re-run G2." };
  const viaMeta = calls.every(({ w, row }) => JSON.stringify(row.meta ?? {}).includes(w.threadId));
  const viaEnv = calls.every(({ w, row }) => row.env?.CODEX_THREAD_ID === w.threadId)
    && new Set(calls.map((c) => c.row.pid)).size === calls.length;
  observations.push(`MCP processes: ${[...new Set(calls.map((c) => c.row.pid))].join(", ")}`);
  observations.push(`per-call _meta carries the thread: ${viaMeta}`);
  observations.push(`per-thread process env carries the thread: ${viaEnv}`);
  if (viaMeta || viaEnv) {
    return { question: "G2", verdict: "proven", observations, consequence: viaMeta ? "F4 reads the caller thread from request _meta." : "F4 binds each MCP process to its thread at startup." };
  }
  return { question: "G2", verdict: "partial", observations, consequence: "Calls work but cannot be attributed; F4 needs a per-thread MCP launch or the spec is revised." };
}

export function judgeQuestionRecovery(obs: { firstRequest?: QuestionRef; replayed?: QuestionRef; flagsAfterReconnect: string[]; answeredAfterReconnect: boolean; finalMentionsAnswer: boolean }): CaseResult {
  const observations = [`flags after reconnect: ${obs.flagsAfterReconnect.join(", ") || "none"}`];
  if (!obs.firstRequest) return { question: "G3", verdict: "not-run", observations: ["no initial question request"], consequence: "Re-run G3." };
  if (obs.replayed) {
    const sameItem = obs.replayed.threadId === obs.firstRequest.threadId && obs.replayed.turnId === obs.firstRequest.turnId && obs.replayed.itemId === obs.firstRequest.itemId;
    if (!sameItem) return { question: "G3", verdict: "blocked", observations: [...observations, "replayed request names a different item"], consequence: "Reconnect cannot be correlated; M5 keeps completion pending." };
    if (obs.replayed.requestId !== obs.firstRequest.requestId) observations.push("request id changed across reconnect; correlate by thread, turn and item");
  } else {
    observations.push("no replayed request on the new connection");
  }
  if (obs.replayed && obs.answeredAfterReconnect && obs.finalMentionsAnswer) {
    return { question: "G3", verdict: "proven", observations, consequence: "M5 stores thread, turn and item per question and completes on reconnect." };
  }
  return { question: "G3", verdict: "partial", observations, consequence: "Pending state is visible but not answerable after reconnect; full support stays blocked until a completion path exists." };
}

export function judgeAsyncQuestion(obs: { sawNativeRequest: boolean; itemCompletedAfterResponse: boolean; wokeOnlyBySteer: boolean }): CaseResult {
  const observations = [`native request: ${obs.sawNativeRequest}`, `item completed after response: ${obs.itemCompletedAfterResponse}`, `woke only by steer: ${obs.wokeOnlyBySteer}`];
  if (obs.sawNativeRequest && obs.itemCompletedAfterResponse) return { question: "G4", verdict: "proven", observations, consequence: "M5 supports async questions natively." };
  if (obs.wokeOnlyBySteer) return { question: "G4", verdict: "partial", observations, consequence: "Steering wakes the turn but does not complete the question; async questions are unsupported for unattended gates." };
  return { question: "G4", verdict: "blocked", observations, consequence: "No async completion path; skills must use synchronous questions on Codex." };
}

export function judgePolicy(obs: { hooksListed: number; toolBlocked: boolean; toolRanAnyway: boolean; stopBlocked: boolean; styleUsed: string }): CaseResult {
  const observations = [`hooks listed: ${obs.hooksListed}`, `tool blocked: ${obs.toolBlocked}`, `tool ran anyway: ${obs.toolRanAnyway}`, `stop blocked: ${obs.stopBlocked}`, `block style: ${obs.styleUsed}`];
  if (obs.hooksListed === 0) return { question: "G5", verdict: "blocked", observations, consequence: "Hooks did not load; M6 cannot enforce on Codex." };
  if (obs.toolRanAnyway || !obs.toolBlocked) return { question: "G5", verdict: "blocked", observations, consequence: "A blocked tool still ran; M6 cannot enforce on Codex." };
  if (!obs.stopBlocked) return { question: "G5", verdict: "partial", observations, consequence: "Tool policy works; pipeline stop enforcement needs another mechanism." };
  return { question: "G5", verdict: "proven", observations, consequence: `M6 enforces with Codex PreToolUse and Stop hooks (${obs.styleUsed}).` };
}

export function judgeSockets(obs: { cliDefault: boolean; cliNetwork: boolean; mcp: boolean }): CaseResult {
  const observations = [`CLI, default sandbox: ${obs.cliDefault}`, `CLI, network_access: ${obs.cliNetwork}`, `MCP server: ${obs.mcp}`];
  if (obs.mcp) return { question: "G6", verdict: "proven", observations, consequence: obs.cliDefault ? "CLI and MCP both reach rt with no change." : "MCP is the supported channel; CLI calls need the recorded sandbox setting or move to MCP." };
  return { question: "G6", verdict: "partial", observations, consequence: "Only a widened CLI sandbox reaches rt; S4 must choose and test an arrangement." };
}

export function judgeDelivery(obs: { consumedClientIdSeen: boolean; queuedAfterRestart?: boolean; threadResumedAfterRestart?: boolean; pendingQuestionAfterRestart?: boolean }): CaseResult {
  const observations = [
    `consumed user message carries our clientId: ${obs.consumedClientIdSeen}`,
    `queue survives daemon restart: ${obs.queuedAfterRestart ?? "unobserved"}`,
    `thread resumes after restart: ${obs.threadResumedAfterRestart ?? "unobserved"}`,
    `pending question survives restart: ${obs.pendingQuestionAfterRestart ?? "unobserved"}`,
  ];
  if (!obs.consumedClientIdSeen) return { question: "G7", verdict: "partial", observations, consequence: "M1 reports queued at best; consumption stays unknown." };
  return { question: "G7", verdict: "proven", observations, consequence: "M1 reports consumed when the clientId appears; recovery uses the recorded restart behavior." };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test scripts/probes/harness/__tests__/verdicts.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/probes/harness/verdicts.ts scripts/probes/harness/__tests__/verdicts.test.ts
git commit -m "test: add verdict judges for the harness gate spike"
```

### Task 6: Live cases and runner

**Files:**
- Create: `scripts/probes/harness/cases/common.ts`, `scripts/probes/harness/cases/attribution.ts`, `scripts/probes/harness/cases/questions.ts`, `scripts/probes/harness/cases/policy.ts`, `scripts/probes/harness/cases/sockets.ts`, `scripts/probes/harness/cases/delivery.ts`, `scripts/probes/harness/run.ts`
- Test: `scripts/probes/harness/__tests__/run.test.ts`

**Interfaces:**
- Consumes: everything in Tasks 1 to 5.
- Produces: `parseArgs(argv: string[]): { live: boolean; cases: QuestionId[]; out?: string; model?: string }`; each case module exports `run(lab: Lab, ev: Evidence): Promise<CaseResult[]>`; `common.ts` exports `drive(ctl: CodexControl, threadId: string, text: string, timeoutMs: number): Promise<Inbound[]>` (resume, start a turn, collect that thread's messages until `turn/completed`), `kit(lab: Lab): { cli: string; bun: string }`.

- [ ] **Step 1: Write the failing test (argument parsing only; live cases are not unit-tested)**

```ts
// scripts/probes/harness/__tests__/run.test.ts
import { describe, expect, test } from "bun:test";
import { parseArgs } from "../run.ts";

describe("run.ts arguments", () => {
  test("defaults to every question and requires nothing else", () => {
    expect(parseArgs(["--live"])).toEqual({ live: true, cases: ["G1", "G2", "G3", "G4", "G5", "G6", "G7"] });
  });
  test("narrows to named questions and keeps out and model", () => {
    expect(parseArgs(["--cases", "G3,G5", "--out", "/tmp/r.json", "--model", "m1"])).toEqual({ live: false, cases: ["G3", "G5"], out: "/tmp/r.json", model: "m1" });
  });
  test("rejects an unknown question id", () => {
    expect(() => parseArgs(["--cases", "G9"])).toThrow("G9");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test scripts/probes/harness/__tests__/run.test.ts`
Expected: FAIL, cannot resolve `../run.ts`.

- [ ] **Step 3: Implement `cases/common.ts`**

```ts
// scripts/probes/harness/cases/common.ts
import { join } from "node:path";
import { CodexControl, type Inbound } from "../codex-control.ts";
import type { Lab } from "../lab.ts";

export function kit(lab: Lab): { cli: string; bun: string } {
  const bun = Bun.which("bun") ?? "bun";
  return { bun, cli: `${bun} ${join(import.meta.dir, "..", "probe-cli.ts")}` };
}

export async function connect(lab: Lab): Promise<CodexControl> {
  return CodexControl.connect({ socketPath: lab.paths.codexSock, clientName: "harness_gate_spike", experimentalApi: true });
}

export async function drive(ctl: CodexControl, threadId: string, text: string, timeoutMs: number): Promise<Inbound[]> {
  const seen: Inbound[] = [];
  const off = ctl.onNotification((method, params) => { if (params?.threadId === threadId) seen.push({ kind: "notification", method, params }); });
  const offReq = ctl.onServerRequest((id, method, params) => { if (params?.threadId === threadId) seen.push({ kind: "request", id, method, params }); });
  try {
    await ctl.call("thread/resume", { threadId, excludeTurns: true });
    await ctl.call("turn/start", { threadId, input: [{ type: "text", text }] });
    await ctl.next((m) => m.kind === "notification" && m.method === "turn/completed" && m.params?.threadId === threadId, timeoutMs);
    return seen;
  } finally {
    off();
    offReq();
  }
}
```

- [ ] **Step 4: Implement `cases/attribution.ts` (G1, G2)**

```ts
// scripts/probes/harness/cases/attribution.ts
import { join } from "node:path";
import type { CaseResult, Evidence } from "../evidence.ts";
import { readJsonl } from "../evidence.ts";
import type { Lab } from "../lab.ts";
import { judgeCliAttribution, judgeMcpAttribution } from "../verdicts.ts";
import { connect, drive, kit } from "./common.ts";

export async function run(lab: Lab, ev: Evidence): Promise<CaseResult[]> {
  const { cli } = kit(lab);
  const cliFile = join(lab.paths.evidence, "cli.jsonl");
  const workers = [await lab.launchWorker("w1"), await lab.launchWorker("w2")];
  const ctl = await connect(lab);
  try {
    await Promise.all(workers.map((w) => drive(ctl, w.threadId,
      `Run exactly this shell command: ${cli} record ${cliFile} ${w.name}-cli\n` +
      `Then call the MCP tool probe_whoami with marker "${w.name}-mcp". Reply DONE.`, 240_000)));
  } finally {
    ctl.close();
  }
  for (const w of workers) ev.record("herdr agent", await lab.herdr("agent", "get", w.pane));
  const mcpRows = readJsonl(join(lab.paths.evidence, "mcp.jsonl"));
  ev.record("mcp initialize rows", mcpRows.filter((r) => r.kind === "initialize"));
  return [judgeCliAttribution(workers, readJsonl(cliFile)), judgeMcpAttribution(workers, mcpRows)];
}
```

- [ ] **Step 5: Implement `cases/questions.ts` (G3, G4)**

```ts
// scripts/probes/harness/cases/questions.ts
import type { CaseResult, Evidence } from "../evidence.ts";
import type { Lab } from "../lab.ts";
import { judgeAsyncQuestion, judgeQuestionRecovery, type QuestionRef } from "../verdicts.ts";
import { connect } from "./common.ts";

const SYNC_PROMPT = "Use request_user_input (the blocking variant, not the async one) with id choice, header Choice, question \"Choose Alpha or Beta\", options Alpha and Beta. Wait for the answer, then say only the chosen word.";
const ASYNC_PROMPT = "Use the async (non-blocking) variant of request_user_input with id pick, question \"Pick Red or Blue\", options Red and Blue. When the answer arrives, say only the chosen word.";

function refOf(req: any): QuestionRef {
  return { requestId: req.id, threadId: req.params.threadId, turnId: req.params.turnId, itemId: req.params.itemId };
}

export async function run(lab: Lab, ev: Evidence): Promise<CaseResult[]> {
  const w = await lab.launchWorker("q1");

  // G3: question pending, first client disconnects, second client tries to finish it.
  const a = await connect(lab);
  await a.call("thread/resume", { threadId: w.threadId, excludeTurns: true });
  const firstReq = a.next((m) => m.kind === "request" && m.method === "item/tool/requestUserInput" && m.params?.threadId === w.threadId, 120_000);
  await a.call("turn/start", { threadId: w.threadId, input: [{ type: "text", text: SYNC_PROMPT }] });
  const first = await firstReq.catch(() => undefined);
  ev.record("G3 first request", first);
  a.close();

  const b = await connect(lab);
  const replay = b.next((m) => m.kind === "request" && m.method === "item/tool/requestUserInput" && m.params?.threadId === w.threadId, 15_000).catch(() => undefined);
  await b.call("thread/resume", { threadId: w.threadId, excludeTurns: true });
  const read = await b.call<any>("thread/read", { threadId: w.threadId, includeTurns: false });
  const flags: string[] = read?.thread?.status?.activeFlags ?? [];
  const replayed = await replay;
  ev.record("G3 after reconnect", { status: read?.thread?.status, replayed });
  let answered = false;
  let finalText = "";
  if (replayed && replayed.kind === "request") {
    const done = b.next((m) => m.kind === "notification" && m.method === "turn/completed" && m.params?.threadId === w.threadId, 120_000);
    const offItems = b.onNotification((method, params) => {
      if (method === "item/completed" && params?.threadId === w.threadId && params?.item?.type === "agentMessage") finalText += String(params.item.text ?? "");
    });
    b.respond(replayed.id, { answers: { choice: { answers: ["Beta"] } } });
    answered = true;
    await done.catch(() => undefined);
    offItems();
  } else {
    await b.call("turn/interrupt", { threadId: w.threadId }).catch((e) => ev.record("G3 interrupt failed", String(e)));
  }
  const g3 = judgeQuestionRecovery({
    firstRequest: first?.kind === "request" ? refOf(first) : undefined,
    replayed: replayed?.kind === "request" ? refOf(replayed) : undefined,
    flagsAfterReconnect: flags, answeredAfterReconnect: answered, finalMentionsAnswer: /beta/i.test(finalText),
  });

  // G4: async variant on the same worker.
  const events: any[] = [];
  const offAll = b.onNotification((method, params) => { if (params?.threadId === w.threadId) events.push({ method, params }); });
  const asyncReq = b.next((m) => m.kind === "request" && m.params?.threadId === w.threadId, 90_000).catch(() => undefined);
  await b.call("turn/start", { threadId: w.threadId, input: [{ type: "text", text: ASYNC_PROMPT }] });
  const req = await asyncReq;
  let itemCompleted = false;
  let wokeBySteer = false;
  if (req && req.kind === "request") {
    const itemId = req.params?.itemId;
    const completed = b.next((m) => m.kind === "notification" && m.method === "item/completed" && m.params?.item?.id === itemId, 60_000).then(() => true, () => false);
    b.respond(req.id, { answers: { pick: { answers: ["Blue"] } } });
    itemCompleted = await completed;
  } else {
    await b.call("turn/steer", { threadId: w.threadId, input: [{ type: "text", text: "Answer to pick: Blue" }] }).catch((e) => ev.record("G4 steer failed", String(e)));
    wokeBySteer = await b.next((m) => m.kind === "notification" && m.method === "turn/completed" && m.params?.threadId === w.threadId, 60_000).then(() => true, () => false);
  }
  offAll();
  ev.record("G4 events", { request: req, events: events.slice(-40) });
  b.close();
  return [g3, judgeAsyncQuestion({ sawNativeRequest: req?.kind === "request", itemCompletedAfterResponse: itemCompleted, wokeOnlyBySteer: wokeBySteer })];
}
```

- [ ] **Step 6: Implement `cases/policy.ts` (G5)**

```ts
// scripts/probes/harness/cases/policy.ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseResult, Evidence } from "../evidence.ts";
import { readJsonl } from "../evidence.ts";
import type { Lab } from "../lab.ts";
import { judgePolicy } from "../verdicts.ts";
import { connect, drive, kit } from "./common.ts";

export async function run(lab: Lab, ev: Evidence): Promise<CaseResult[]> {
  const { cli } = kit(lab);
  const w = await lab.launchWorker("p1");
  const ctl = await connect(lab);
  try {
    const listed = await ctl.call<any>("hooks/list", { cwds: [w.cwd] });
    ev.record("G5 hooks/list", listed);
    const hooksListed = (listed?.data ?? []).reduce((n: number, e: any) => n + (e.hooks?.length ?? 0), 0);
    const hookFile = join(lab.paths.evidence, "hooks.jsonl");
    ev.record("G5 session start payloads", readJsonl(hookFile).filter((r) => r.event === "SessionStart"));

    // Find the shell tool's name from a harmless allowed call.
    await drive(ctl, w.threadId, `Run exactly: ${cli} record ${join(lab.paths.evidence, "cli.jsonl")} p1-allowed\nReply DONE.`, 120_000);
    const shellName = readJsonl(hookFile).filter((r) => r.event === "PreToolUse").map((r) => r.payload?.tool_name ?? r.payload?.toolName ?? r.payload?.tool?.name).find(Boolean);
    ev.record("G5 shell tool name", shellName);

    let styleUsed = "exit2";
    let toolBlocked = false;
    let toolRanAnyway = false;
    const forbidden = join(lab.paths.evidence, "forbidden.jsonl");
    for (const style of ["exit2", "json"] as const) {
      writeFileSync(join(lab.paths.policy, "PreToolUse.json"), JSON.stringify({ block: shellName ? [shellName] : [], style }));
      const before = readJsonl(hookFile).length;
      await drive(ctl, w.threadId, `Run exactly: ${cli} record ${forbidden} p1-forbidden-${style}\nIf it is refused, reply REFUSED.`, 120_000);
      const ran = readJsonl(forbidden).some((r) => r.marker === `p1-forbidden-${style}`);
      const refusedByHook = readJsonl(hookFile).slice(before)
        .some((r) => r.event === "PreToolUse" && (r.decision?.exitCode !== 0 || Boolean(r.decision?.stdout)));
      ev.record(`G5 block via ${style}`, { ran, refusedByHook });
      if (!ran && refusedByHook) { styleUsed = style; toolBlocked = true; toolRanAnyway = false; break; }
      toolRanAnyway = toolRanAnyway || ran;
    }
    writeFileSync(join(lab.paths.policy, "PreToolUse.json"), JSON.stringify({ block: [], style: styleUsed }));

    writeFileSync(join(lab.paths.policy, "Stop.json"), JSON.stringify({ blockOnce: true, style: styleUsed }));
    const beforeStop = readJsonl(hookFile).length;
    const stopEvents = await drive(ctl, w.threadId, "Reply DONE.", 180_000);
    const stopRows = readJsonl(hookFile).slice(beforeStop).filter((r) => r.event === "Stop");
    // Blocked means the first stop was refused and the agent kept going until a second, allowed stop.
    const stopBlocked = stopRows.length >= 2 && stopRows[0].decision?.consumeOnce === true && stopRows.at(-1).decision?.exitCode === 0;
    ev.record("G5 stop", { stopRows: stopRows.length, hookNotifications: stopEvents.filter((e) => e.kind === "notification" && e.method.startsWith("hook/")) });
    return [judgePolicy({ hooksListed, toolBlocked, toolRanAnyway, stopBlocked, styleUsed })];
  } finally {
    ctl.close();
    if (existsSync(join(lab.paths.policy, "Stop.json"))) writeFileSync(join(lab.paths.policy, "Stop.json"), JSON.stringify({ blockOnce: false, style: "exit2" }));
  }
}
```

- [ ] **Step 7: Implement `cases/sockets.ts` (G6)**

```ts
// scripts/probes/harness/cases/sockets.ts
import { join } from "node:path";
import type { CaseResult, Evidence } from "../evidence.ts";
import { readJsonl } from "../evidence.ts";
import type { Lab } from "../lab.ts";
import { judgeSockets } from "../verdicts.ts";
import { connect, drive, kit } from "./common.ts";

export async function run(lab: Lab, ev: Evidence): Promise<CaseResult[]> {
  const { cli } = kit(lab);
  const file = join(lab.paths.evidence, "sock.jsonl");
  const ping = (marker: string) => `Run exactly: ${cli} rt-ping ${file} ${marker} ${lab.paths.rtSock}\nThen call the MCP tool probe_rt_ping with marker "${marker}-mcp" and sock "${lab.paths.rtSock}". Reply DONE.`;
  const plain = await lab.launchWorker("s1");
  const network = await lab.launchWorker("s2", ["-c", "sandbox_workspace_write.network_access=true"]);
  const ctl = await connect(lab);
  try {
    await drive(ctl, plain.threadId, ping("s1"), 180_000);
    await drive(ctl, network.threadId, ping("s2"), 180_000);
  } finally {
    ctl.close();
  }
  const rows = readJsonl(file);
  const mcpRows = readJsonl(join(lab.paths.evidence, "mcp.jsonl")).filter((r) => r.kind === "rt-ping");
  ev.record("G6 rows", { cli: rows, mcp: mcpRows });
  return [judgeSockets({
    cliDefault: rows.some((r) => r.marker === "s1" && r.rt?.ok),
    cliNetwork: rows.some((r) => r.marker === "s2" && r.rt?.ok),
    mcp: mcpRows.some((r) => r.marker === "s1-mcp" && r.ping?.ok),
  })];
}
```

- [ ] **Step 8: Implement `cases/delivery.ts` (G7)**

```ts
// scripts/probes/harness/cases/delivery.ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CaseResult, Evidence } from "../evidence.ts";
import type { Lab } from "../lab.ts";
import { judgeDelivery } from "../verdicts.ts";
import { connect, kit } from "./common.ts";

export async function run(lab: Lab, ev: Evidence): Promise<CaseResult[]> {
  const { cli } = kit(lab);
  const file = join(lab.paths.evidence, "delivery.jsonl");
  const w = await lab.launchWorker("d1");
  const ctl = await connect(lab);
  const clientId = `spike-${randomUUID()}`;
  let consumedClientIdSeen = false;
  const off = ctl.onNotification((method, params) => {
    if ((method === "item/started" || method === "item/completed") && params?.item?.type === "userMessage" && params.item.clientId === clientId) consumedClientIdSeen = true;
  });
  await ctl.call("thread/resume", { threadId: w.threadId, excludeTurns: true });
  const busy = ctl.next((m) => m.kind === "notification" && m.method === "item/started" && m.params?.item?.type === "commandExecution" && m.params?.threadId === w.threadId, 120_000);
  await ctl.call("turn/start", { threadId: w.threadId, input: [{ type: "text", text: `Run exactly: ${cli} sleep ${file} 20\nThen reply DONE.` }] });
  await busy;
  await ctl.call("thread/queue/add", { threadId: w.threadId, clientUserMessageId: clientId, input: [{ type: "text", text: `Run exactly: ${cli} record ${file} d1-queued\nReply DONE.` }] });
  await ctl.next((m) => m.kind === "notification" && m.method === "turn/completed" && m.params?.threadId === w.threadId, 180_000).catch(() => undefined);
  await Bun.sleep(5_000);
  off();

  // Restart: queue an entry behind a pending question, then restart the lab daemon.
  const restartId = `spike-${randomUUID()}`;
  const q = ctl.next((m) => m.kind === "request" && m.params?.threadId === w.threadId, 120_000).catch(() => undefined);
  await ctl.call("turn/start", { threadId: w.threadId, input: [{ type: "text", text: "Use request_user_input (blocking) with id hold, question \"Hold?\", options Yes and No." }] });
  const pending = await q;
  await ctl.call("thread/queue/add", { threadId: w.threadId, clientUserMessageId: restartId, input: [{ type: "text", text: `Run exactly: ${cli} record ${file} d1-after-restart` }] }).catch((e) => ev.record("G7 queue add failed", String(e)));
  ctl.close();
  await lab.codexDaemon("restart");
  const after = await connect(lab);
  let threadResumed = false;
  let queued: boolean | undefined;
  let pendingAfter: boolean | undefined;
  try {
    const replay = after.next((m) => m.kind === "request" && m.params?.threadId === w.threadId, 15_000).then(() => true, () => false);
    threadResumed = await after.call("thread/resume", { threadId: w.threadId, excludeTurns: true }).then(() => true, () => false);
    const list = await after.call<any>("thread/queue/list", { threadId: w.threadId }).catch(() => undefined);
    queued = list ? (list.data ?? []).some((e: any) => JSON.stringify(e).includes(restartId)) : undefined;
    pendingAfter = pending ? await replay : undefined;
    ev.record("G7 after restart", { threadResumed, queue: list, pendingAfter });
  } finally {
    after.close();
  }
  return [judgeDelivery({ consumedClientIdSeen, queuedAfterRestart: queued, threadResumedAfterRestart: threadResumed, pendingQuestionAfterRestart: pendingAfter })];
}
```

- [ ] **Step 9: Implement `run.ts`**

```ts
// scripts/probes/harness/run.ts
import { copyFileSync } from "node:fs";
import { createEvidence, requireLive, type QuestionId } from "./evidence.ts";
import { startLab } from "./lab.ts";

const ALL: QuestionId[] = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
const GROUPS: { ids: QuestionId[]; load: () => Promise<{ run: (lab: any, ev: any) => Promise<any[]> }> }[] = [
  { ids: ["G1", "G2"], load: () => import("./cases/attribution.ts") },
  { ids: ["G3", "G4"], load: () => import("./cases/questions.ts") },
  { ids: ["G5"], load: () => import("./cases/policy.ts") },
  { ids: ["G6"], load: () => import("./cases/sockets.ts") },
  { ids: ["G7"], load: () => import("./cases/delivery.ts") },
];

export function parseArgs(argv: string[]): { live: boolean; cases: QuestionId[]; out?: string; model?: string } {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const cases = (value("--cases")?.split(",") ?? ALL) as QuestionId[];
  for (const id of cases) if (!ALL.includes(id)) throw new Error(`unknown question ${id}; use ${ALL.join(", ")}`);
  const parsed: { live: boolean; cases: QuestionId[]; out?: string; model?: string } = { live: argv.includes("--live"), cases };
  const out = value("--out");
  const model = value("--model");
  if (out) parsed.out = out;
  if (model) parsed.model = model;
  return parsed;
}

async function versions(): Promise<Record<string, string>> {
  const v = async (argv: string[]) => (await new Response(Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" }).stdout).text()).trim();
  return { codex: await v(["codex", "--version"]), herdr: await v(["herdr", "--version"]), bun: Bun.version };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  requireLive(argv);
  const args = parseArgs(argv);
  const evDir = `/tmp/hi-evidence-${Date.now()}`;
  const ev = createEvidence(evDir, await versions());
  const lab = await startLab({ repo: process.cwd(), realHome: process.env.HOME!, model: args.model, ev });
  try {
    for (const group of GROUPS) {
      if (!group.ids.some((id) => args.cases.includes(id))) continue;
      try {
        for (const result of await (await group.load()).run(lab, ev)) ev.addCase(result);
      } catch (err) {
        for (const id of group.ids) ev.addCase({ question: id, verdict: "not-run", observations: [`case threw: ${(err as Error).message}`], consequence: "Fix the probe and re-run this group." });
      }
    }
  } finally {
    for (const w of lab.workers) {
      ev.record("pane tail", { worker: w.name, read: await lab.herdr("pane", "read", w.pane, "--source", "recent-unwrapped", "--lines", "60") });
    }
    for (const row of await lab.stop()) ev.addCleanup(row);
    const report = ev.write();
    if (args.out) copyFileSync(report, args.out);
    process.stdout.write(`evidence: ${evDir}\nreport: ${report}\n`);
  }
}
```

- [ ] **Step 10: Run the unit tests**

Run: `bun test scripts/probes/harness`
Expected: PASS, 31 tests across 6 files (Tasks 1 to 6). Then `bun run typecheck` and fix any type errors in the new files only.

- [ ] **Step 11: Commit**

```bash
git add scripts/probes/harness/cases scripts/probes/harness/run.ts scripts/probes/harness/__tests__/run.test.ts
git commit -m "test: add live harness gate spike cases and runner"
```

### Task 7: Live run, attribution and sockets (G1, G2, G6)

**Files:**
- No source changes unless a probe bug is found (fix it in the probe file, add a unit test for the bug, commit separately).

- [ ] **Step 1: Confirm nothing of Matt's is touched.** Run `ls -la ~/.codex/app-server-control/` and note the socket's inode and mtime in the task notes. `run.ts` refuses on change, but write the before value down anyway.

- [ ] **Step 2: Run the group**

Run: `bun scripts/probes/harness/run.ts --live --cases G1,G2,G6`
Expected: prints the evidence dir and report path. Every cleanup row is `ok: true`. Each case has a verdict other than `not-run`; a `not-run` means the probe failed, so read `events.jsonl` (the runner records each worker's last 60 pane lines as `pane tail` before cleanup) and fix the probe.

- [ ] **Step 3: Record**

Copy the three case results and the key observations (MCP pids, `_meta` shape, inherited `HERDR_PANE_ID` values, sandbox results) into a scratch note for Task 10. No commit.

### Task 8: Live run, questions and delivery (G3, G4, G7)

- [ ] **Step 1: Run**

Run: `bun scripts/probes/harness/run.ts --live --cases G3,G4,G7`
Expected: as Task 7. G7's restart only touches the lab daemon; confirm the `real codex control socket unchanged` cleanup row is `ok: true`.

- [ ] **Step 2: Inspect the question correlation**

Open `events.jsonl` and find `G3 first request` and `G3 after reconnect`. Write down the request ids and the `threadId`/`turnId`/`itemId` triple for both. This is the data M5's question binding table is designed from.

- [ ] **Step 3: Record** results in the Task 10 scratch note. No commit.

### Task 9: Live run, policy (G5)

- [ ] **Step 1: Run**

Run: `bun scripts/probes/harness/run.ts --live --cases G5`

- [ ] **Step 2: If `hooks/list` shows zero hooks**, run `codex features list` (or the control method `experimentalFeature/list`) under the lab `CODEX_HOME`, look for a hooks feature, and re-run with `--model` unchanged and the feature enabled by adding `-c features.<name>=true` to `launchWorker`'s `extraArgs` in `cases/policy.ts`. Record exactly which setting made hooks load; S4 installs that setting. If nothing loads them, G5 is `blocked`.

- [ ] **Step 3: Record** the hook payload fields seen for `SessionStart`, `PreToolUse` and `Stop` (field names only, no values beyond ids). F5 and M6 are designed from them.

### Task 10: Exit report and re-plan trigger

**Files:**
- Create: `docs/superpowers/spikes/2026-10-05-harness-gate-spike-report.md`
- Create: `docs/superpowers/spikes/2026-10-05-harness-gate-spike-evidence.json` (the sanitized `report.json` from the last full run)
- Modify: `docs/superpowers/plans/2026-10-04-harness-integrations.md` (planning status)

- [ ] **Step 1: Write the report** with this structure, filled from Tasks 7 to 9:

```markdown
# Harness gate spike report

**Date:** <date>. **Versions:** Codex <v>, Herdr <v>, Bun <v>. **Commit:** <sha>.

## Verdicts

| Id | Verdict | Key observation | Consequence for the plans |
| --- | --- | --- | --- |
| G1 | | | |
| G2 | | | |
| G3 | | | |
| G4 | | | |
| G5 | | | |
| G6 | | | |
| G7 | | | |

## Native facts the re-plan uses

- Thread identity in CLI commands: <env key, and whether Herdr variables were inherited>
- MCP caller identity: <_meta field or per-process env, with the field name>
- Question correlation: <request id behavior across reconnect; thread/turn/item fields>
- Hook loading and block format: <config keys, required feature flag, exit 2 or JSON>
- Hook payload fields: <SessionStart, PreToolUse, Stop field names>
- Socket access: <what reached rt.sock and under which setting>
- Consumption signal: <event and field>
- Restart behavior: <thread, queue, pending question>

## Decision

<"Gating questions proven: re-plan plan 1 next." or "G<n> not proven: revise the spec section <name> before re-planning.">

## Cleanup

<cleanup rows from the report; all must be ok>
```

- [ ] **Step 2: Sanitize and save the evidence.** Copy the final `report.json` to `docs/superpowers/spikes/2026-10-05-harness-gate-spike-evidence.json`. Read it in full before committing: it must hold no tokens, no emails, no message bodies beyond the probe prompts, and no paths under the real home other than the repo checkout.

- [ ] **Step 3: Update the plan index** "Planning status" paragraph to name the report and the decision.

- [ ] **Step 4: Run the purity check** before committing, since these docs are public: run `bun run purity` and fix any finding.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/spikes/2026-10-05-harness-gate-spike-report.md docs/superpowers/spikes/2026-10-05-harness-gate-spike-evidence.json docs/superpowers/plans/2026-10-04-harness-integrations.md
git commit -m "docs: record harness gate spike verdicts"
```

- [ ] **Step 6: Stop.** Report the verdict table to Matt. Re-planning plan 1 (and any spec revision) starts from this report in a new planning pass, not as part of this plan.
