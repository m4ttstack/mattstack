import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { rmSync } from "fs";
import { tmpdir, userInfo } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { postOverSocket } from "../src/transport.ts";
import { fakeDaemon } from "./fake-daemon.ts";

const PKG = resolve(import.meta.dir, "..");
const stops: Array<() => void> = [];
afterEach(() => { while (stops.length) stops.pop()!(); });

// mise's node shim fails under the test HOME, so resolve the real binary with the account's HOME (read-only).
function nodeBin(): string {
  const r = spawnSync("mise", ["which", "node"], { encoding: "utf8", env: { ...process.env, HOME: userInfo().homedir } });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : "node";
}

const HEADERS = { "Content-Type": "application/json" };

describe("postOverSocket", () => {
  test("postOverSocket returns the daemon's status and body", async () => {
    const reply = { ok: true, data: { panes: [] } };
    const d = fakeDaemon({ "pane:list": reply });
    stops.push(d.stop);
    const res = await postOverSocket(d.sock, "pane:list", "{}", HEADERS, 2000);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual(reply);
    expect(d.seen[0]).toEqual({ cmd: "pane:list", payload: {} });
  });

  test("postOverSocket rejects with TimeoutError past the budget", async () => {
    const sock = join(tmpdir(), `rt-client-hang-${process.pid}.sock`);
    const server = Bun.serve({ unix: sock, fetch: () => new Promise<Response>(() => {}) });
    stops.push(() => { server.stop(true); rmSync(sock, { force: true }); });
    const err = await postOverSocket(sock, "pane:list", "{}", HEADERS, 50).catch((e: unknown) => e);
    expect((err as Error).name).toBe("TimeoutError");
  });

  test("postOverSocket rejects on a missing socket", async () => {
    const sock = join(tmpdir(), `nope-${process.pid}.sock`);
    await expect(postOverSocket(sock, "pane:list", "{}", HEADERS, 2000)).rejects.toBeDefined();
  });
});

describe("rtCommand under node: retry while the daemon restarts", () => {
  /** Builds the node bundle once per call and runs `body` (an async module script that sees `m`) under plain node. */
  async function underNode(body: string): Promise<unknown> {
    const outDir = join(PKG, "node_modules", `.tmp-node-retry-${process.pid}-${Math.random().toString(36).slice(2)}`);
    stops.push(() => rmSync(outDir, { recursive: true, force: true }));
    const build = spawnSync(
      "bun", ["build", "src/index.ts", "--outdir", outDir, "--target", "node", "--format", "esm", "--packages", "external"],
      { cwd: PKG, encoding: "utf8" },
    );
    expect(build.status).toBe(0);
    const distUrl = pathToFileURL(join(outDir, "index.js")).href;
    const script = `const m = await import(${JSON.stringify(distUrl)});\n${body}`;
    const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "development" };
    delete env.RT_DAEMON_RETRY_BUDGET_MS;
    const proc = Bun.spawn([nodeBin(), "--input-type=module", "-e", script], { env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    return JSON.parse(stdout);
  }

  test("socket file missing, then a server appears: the call succeeds", async () => {
    const sock = join(tmpdir(), `nl-${process.pid}.sock`);
    const res = await underNode(`
import { createServer } from "node:http";
const sock = ${JSON.stringify(sock)};
setTimeout(() => {
  const server = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, data: { n: 1 } })); });
  server.listen(sock);
  server.unref();
}, 300);
const res = await m.rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5000 });
process.stdout.write(JSON.stringify(res));
process.exit(0);`);
    stops.push(() => rmSync(sock, { force: true }));
    expect(res).toEqual({ ok: true, data: { n: 1 } });
  }, 60_000);

  test("stale socket file (no listener): the call retries, then reports the daemon unreachable", async () => {
    const sock = join(tmpdir(), `ns-${process.pid}.sock`);
    const res = await underNode(`
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
const sock = ${JSON.stringify(sock)};
// A child binds the socket and is killed, leaving the file with no listener.
spawnSync(process.execPath, ["-e", "require('node:net').createServer().listen(" + JSON.stringify(sock) + ", () => process.kill(process.pid, 'SIGKILL'))"]);
const started = Date.now();
const res = await m.rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 400 });
process.stdout.write(JSON.stringify({ res, waited: Date.now() - started }));`) as { res: { ok: boolean; error: string }; waited: number };
    stops.push(() => rmSync(sock, { force: true }));
    expect(res.res.ok).toBe(false);
    expect(res.res.error).toContain("ECONNREFUSED");
    expect(res.waited).toBeGreaterThanOrEqual(400);
  }, 60_000);

  test("a connection the server accepted and then closed is sent exactly once", async () => {
    const sock = join(tmpdir(), `nd-${process.pid}.sock`);
    const res = await underNode(`
import { createServer } from "node:net";
const sock = ${JSON.stringify(sock)};
let hits = 0;
const server = createServer((conn) => { conn.on("data", () => { hits++; conn.destroy(); }); });
await new Promise((resolve) => server.listen(sock, resolve));
const res = await m.rtCommand("chat:post", { text: "hi" }, { sockPath: sock, retryBudgetMs: 2000 });
process.stdout.write(JSON.stringify({ ok: res.ok, hits }));
process.exit(0);`);
    stops.push(() => rmSync(sock, { force: true }));
    expect(res).toEqual({ ok: false, hits: 1 });
  }, 60_000);
});

describe("rtCommand under node", () => {
  test("the node build talks to the daemon from plain node", async () => {
    // A fresh bundle of the same build entry, under node_modules so node resolves its external packages.
    const outDir = join(PKG, "node_modules", `.tmp-node-transport-${process.pid}`);
    stops.push(() => rmSync(outDir, { recursive: true, force: true }));
    const build = spawnSync(
      "bun", ["build", "src/index.ts", "--outdir", outDir, "--target", "node", "--format", "esm", "--packages", "external"],
      { cwd: PKG, encoding: "utf8" },
    );
    expect(build.stderr).toBe("");
    expect(build.status).toBe(0);
    const d = fakeDaemon({ "pane:list": { ok: true, data: { panes: [] } } });
    stops.push(d.stop);
    const distUrl = pathToFileURL(join(outDir, "index.js")).href;
    const script = `const m = await import(${JSON.stringify(distUrl)});
const res = await m.paneList({ sockPath: ${JSON.stringify(d.sock)} });
process.stdout.write(JSON.stringify(res));`;
    // Async spawn: a sync one would block the in-process fake daemon from answering.
    const proc = Bun.spawn([nodeBin(), "--input-type=module", "-e", script], {
      env: { ...process.env, NODE_ENV: "development" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true, data: { panes: [] } });
  }, 60_000);
});
