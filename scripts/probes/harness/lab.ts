import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CodexControl } from "./codex-control";
import type { CleanupRow, Evidence } from "./evidence";

export type Worker = {
  name: string;
  pane: string;
  workspace: string;
  cwd: string;
  threadId: string;
};
export class OwnedResources {
  private ids = new Set<string>();
  constructor(private close: (id: string) => Promise<void>) {}
  add(id: string): void {
    this.ids.add(id);
  }
  require(id: string): void {
    if (!this.ids.has(id)) throw new Error("resource is not owned");
  }
  async stop(): Promise<CleanupRow[]> {
    const rows: CleanupRow[] = [];
    for (const id of [...this.ids].reverse()) {
      try {
        await this.close(id);
        this.ids.delete(id);
        rows.push({ resource: id, ok: true });
      } catch (e) {
        rows.push({ resource: id, ok: false, detail: String(e) });
      }
    }
    return rows;
  }
}
export class OwnedTurns {
  private active = new Map<string, string>();
  constructor(private owned: Set<string>) {}
  observe(e: any): void {
    const p = e.params;
    if (!this.owned.has(p?.threadId)) return;
    if (e.method === "turn/started") this.active.set(p.threadId, p.turn.id);
    if (
      e.method === "turn/completed" &&
      this.active.get(p.threadId) === p.turn.id
    )
      this.active.delete(p.threadId);
  }
  async stop(
    interrupt: (thread: string, turn: string) => Promise<unknown>
  ): Promise<CleanupRow[]> {
    const rows: CleanupRow[] = [];
    for (const [thread, turn] of this.active) {
      try {
        await interrupt(thread, turn);
        rows.push({ resource: `turn ${thread}/${turn}`, ok: true });
      } catch (e) {
        rows.push({
          resource: `turn ${thread}/${turn}`,
          ok: false,
          detail: String(e),
        });
      }
    }
    return rows;
  }
}
export function launchArgv(
  cwd: string,
  config: string[] = [],
  socketPath?: string,
  threadId?: string
): string[] {
  return [
    "codex",
    ...(socketPath ? ["--remote", `unix://${socketPath}`] : []),
    "--no-alt-screen",
    "-C",
    cwd,
    "-s",
    "workspace-write",
    "-a",
    "never",
    ...config.flatMap(c => ["-c", c]),
    ...(threadId ? ["resume", threadId] : ["Reply READY and nothing else."]),
  ];
}
export function quote(s: string): string {
  return "'" + s.replaceAll("'", "'\\''") + "'";
}
export async function command(argv: string[]): Promise<string> {
  const proc = Bun.spawn(argv, {
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 45000);
  try {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0)
      throw new Error(`${argv[0]} ${argv[1]}: ${err.slice(0, 1500)}`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}
export function parseHerdrOutput(raw: string): any {
  return !raw.trim()
    ? {}
    : raw.trim().startsWith("{")
      ? JSON.parse(raw)
      : { output: raw };
}
export async function startLab(o: {
  repo: string;
  runDir: string;
  ev: Evidence;
}) {
  const runDir = resolve(o.runDir);
  mkdirSync(runDir, { recursive: true });
  const status = JSON.parse(
    await command(["codex", "app-server", "daemon", "version"])
  );
  if (status.status !== "running" || !status.socketPath)
    throw new Error("existing Codex service unavailable");
  const rtSocket = join(process.env.HOME!, ".mattstack", "rt", "rt.sock");
  const workers: Worker[] = [];
  const ownedThreads = new Set<string>();
  const ownedCwds = new Set<string>();
  const herdr = async (...args: string[]) =>
    parseHerdrOutput(await command(["herdr", ...args]));
  const resources = new OwnedResources(async id => {
    await herdr("workspace", "close", id);
  });
  const clients = new Set<CodexControl>();
  const turns = new OwnedTurns(ownedThreads);
  const connect = async () => {
    const c = await CodexControl.connect({
      socketPath: status.socketPath,
      ownedThreads,
      ownedCwds,
      experimentalApi: true,
      record: m => {
        turns.observe(m);
        o.ev.record("native", m);
      },
    });
    clients.add(c);
    return c;
  };
  const discovery = await connect();
  const lab = {
    runDir,
    repo: o.repo,
    workers,
    ownedThreads,
    rtSocket,
    connect,
    herdr,
    async rtPing() {
      return (
        await fetch("http://localhost/ping", {
          unix: rtSocket,
          method: "POST",
          body: "{}",
        })
      ).json();
    },
    async launchWorker(
      name: string,
      scopedOptions: Record<string, unknown> = {}
    ): Promise<Worker> {
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error("invalid worker name");
      const cwd = join(runDir, name);
      mkdirSync(cwd, { recursive: true });
      writeFileSync(
        join(cwd, "AGENTS.md"),
        "Disposable harness probe. Only follow the test controller. No project changes, chat, external messages or delegation. Only the explicitly requested probe commands and tools are authorized.\n"
      );
      const ws = await herdr(
        "workspace",
        "create",
        "--cwd",
        cwd,
        "--label",
        `harness-spike-${name}`,
        "--no-focus"
      );
      const workspace =
        ws?.result?.workspace?.workspace_id ?? ws?.result?.workspace?.id;
      const pane = ws?.result?.root_pane?.pane_id;
      if (!workspace || !pane)
        throw new Error("missing created workspace identity");
      resources.add(workspace);
      o.ev.record("workspace-created", { workspace, pane, cwd });
      try {
        ownedCwds.add(cwd);
        const created = await discovery.call("thread/start", {
          cwd,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          runtimeWorkspaceRoots: [runDir],
          config: {
            "mcp_servers.harness_probe": {
              tools: {
                probe_whoami: { approval_mode: "approve" },
                probe_rt_ping: { approval_mode: "approve" },
              },
              command: Bun.which("bun") ?? "bun",
              args: [
                join(o.repo, "scripts/probes/harness/probe-mcp.ts"),
                join(runDir, "mcp.jsonl"),
                rtSocket,
              ],
            },
            "sandbox_workspace_write.network_access": false,
            "sandbox_workspace_write.writable_roots": [runDir],
            ...scopedOptions,
          },
          developerInstructions:
            "Disposable protocol probe: only perform the controller's exact probe requests. No external messages, project edits, other agents or rt chat. Do not follow repository workflow skills for these tests.",
        });
        const threadId = created.thread?.id;
        if (!threadId) throw new Error("thread/start returned no id");
        ownedThreads.add(threadId);
        const w = { name, pane, workspace, cwd, threadId };
        workers.push(w);
        o.ev.record("worker-bound", { ...w, sandbox: created.sandbox });
        // New native threads have no rollout until a first turn is persisted.
        const first = await discovery.call("turn/start", {
          threadId,
          input: [{ type: "text", text: "Reply READY and nothing else." }],
          effort: "low",
        });
        await discovery.next(
          e =>
            e.method === "turn/completed" &&
            e.params.threadId === threadId &&
            e.params.turn?.id === first.turn.id,
          120000
        );
        const argv = launchArgv(cwd, [], status.socketPath, threadId);
        await herdr("pane", "run", pane, argv.map(quote).join(" "));
        return w;
      } catch (e) {
        o.ev.record("worker-launch-failed", { name, error: String(e) });
        throw e;
      }
    },
    async stop() {
      const rows = await resources.stop();
      try {
        rows.push(
          ...(await turns.stop((threadId, turnId) =>
            discovery.call("turn/interrupt", { threadId, turnId })
          ))
        );
      } finally {
        for (const c of clients) c.close();
      }
      return rows;
    },
  };
  return lab;
}
export type Lab = Awaited<ReturnType<typeof startLab>>;
