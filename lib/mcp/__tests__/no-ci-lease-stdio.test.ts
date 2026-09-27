/**
 * ci_lease_* over real JSON-RPC stdio, two `mcp serve` processes spawned
 * from source standing in for two Claude Code sessions. The lease tools are
 * file-only (packages/rt-client/src/ci-lease.ts), so unlike
 * e2e/tests/mcp-serve.test.ts this needs no daemon socket.
 *
 * Named no-* per AGENTS.md: a test that spawns cli.ts is not selected by
 * `bun test --changed`, so it must carry this prefix to run on a
 * TypeScript-only PR at all.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { childEnv } from "../../subprocess.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "..", "cli.ts");
const MR = "https://gitlab.example.com/grp/proj/-/merge_requests/42";

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) yield buf;
}

/**
 * `stdin: "pipe"` must stay a literal in this call, not a variable: Bun.spawn's
 * `const In` type parameter only narrows `proc.stdin` to `FileSink` when it
 * infers a single literal, so a variable typed as a union of stdin modes
 * makes it infer `number | FileSink | undefined` instead.
 */
function spawnServer(env: Record<string, string | undefined>) {
  return Bun.spawn(["bun", "run", CLI_PATH, "mcp", "serve"], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

interface Server {
  proc: ReturnType<typeof spawnServer>;
  nextId: number;
  pending: Map<number, (res: JsonRpcResponse) => void>;
  stderrChunks: string[];
}

function send(server: Server, msg: object): void {
  server.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  server.proc.stdin.flush();
}

async function request(server: Server, method: string, params?: object, timeoutMs = 10_000): Promise<JsonRpcResponse> {
  const id = server.nextId++;
  const settled = new Promise<JsonRpcResponse>((resolve) => server.pending.set(id, resolve));
  send(server, { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<JsonRpcResponse>((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      `mcp serve: timed out waiting for "${method}" (id ${id})\n--- captured stderr ---\n${server.stderrChunks.join("\n")}`,
    )), timeoutMs);
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer);
    server.pending.delete(id);
  }
}

/**
 * Spawns `bun cli.ts mcp serve` from source under an isolated env and
 * completes the initialize handshake. `liveProcs` gets the process the
 * instant it exists, before the handshake, so a throw partway through this
 * function (a second server's spawn or handshake failing) still leaves the
 * first server registered for the caller's afterEach to kill.
 */
async function startServer(sessionId: string, home: string, attDir: string, liveProcs: Array<ReturnType<typeof spawnServer>>): Promise<Server> {
  const proc = spawnServer({
    ...childEnv(),
    HOME: home,
    MATTSTACK_ATTENDANTS_DIR: attDir,
    RT_SKIP_SETUP: "1",
    CI: "true",
    CLAUDE_CODE_SESSION_ID: sessionId,
  });
  liveProcs.push(proc);

  const server: Server = { proc, nextId: 1, pending: new Map(), stderrChunks: [] };

  void (async () => {
    for await (const line of lines(proc.stdout as unknown as ReadableStream<Uint8Array>)) {
      if (line.length === 0) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id === "number") server.pending.get(msg.id)?.(msg);
    }
  })();
  void (async () => {
    for await (const line of lines(proc.stderr as unknown as ReadableStream<Uint8Array>)) {
      server.stderrChunks.push(line);
    }
  })();

  const init = await request(server, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "rt-ci-lease-e2e", version: "0.0.0" },
  });
  if (init.error) throw new Error(`initialize failed: ${init.error.message}`);
  send(server, { jsonrpc: "2.0", method: "notifications/initialized" });

  return server;
}

/** Calls a tool and parses its JSON result body, the same envelope every ci_lease_* tool returns. */
async function call(server: Server, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await request(server, "tools/call", { name, arguments: args });
  if (res.error) throw new Error(`tools/call ${name} failed: ${res.error.message}`);
  const result = res.result as { isError?: boolean; content: Array<{ type: string; text: string }> };
  if (result.isError) throw new Error(`${name} returned a tool error: ${result.content[0]?.text}`);
  return JSON.parse(result.content[0]!.text);
}

/** Ends stdin and waits for a real exit (the server drains in-flight calls on EOF), falling back to a kill. */
async function stop(server: Server): Promise<void> {
  try { server.proc.stdin.end(); } catch { /* already closed */ }
  const exitedInTime = await Promise.race([
    server.proc.exited.then(() => true),
    Bun.sleep(3000).then(() => false),
  ]);
  if (!exitedInTime) {
    try { server.proc.kill(); } catch { /* already gone */ }
    await server.proc.exited;
  }
}

describe("ci_lease_* over mcp stdio (two sessions)", () => {
  const homes: string[] = [];
  const liveProcs: Array<ReturnType<typeof spawnServer>> = [];

  afterEach(async () => {
    for (const p of liveProcs.splice(0)) {
      try { p.kill(); } catch { /* already gone */ }
    }
    for (const h of homes.splice(0)) {
      rmSync(h, { recursive: true, force: true });
    }
  });

  test("second session is refused, then takes over after the lease lapses", async () => {
    const home = mkdtempSync(join(tmpdir(), "rt-ci-lease-stdio-"));
    const attDir = join(home, "att");
    homes.push(home);

    const a = await startServer("sess-a", home, attDir, liveProcs);
    const b = await startServer("sess-b", home, attDir, liveProcs);

    expect(await call(a, "ci_lease_claim", { mrUrl: MR })).toMatchObject({ claimed: true });
    expect(await call(b, "ci_lease_claim", { mrUrl: MR })).toMatchObject({
      claimed: false,
      holder: { owner: "session:sess-a" },
    });

    // Lapse the lease by backdating heartbeatAt on disk past its TTL, rather
    // than waiting out the real default (600s).
    const path = join(attDir, "grp-proj-42.json");
    const lease = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...lease, heartbeatAt: Date.now() - 700_000 }));

    expect(await call(b, "ci_lease_claim", { mrUrl: MR })).toMatchObject({
      claimed: true,
      previousOwner: "session:sess-a",
    });
    expect(await call(a, "ci_lease_heartbeat", { mrUrl: MR })).toMatchObject({ ok: false, reason: "lost" });

    await stop(a);
    await stop(b);
  }, 30_000);
});
