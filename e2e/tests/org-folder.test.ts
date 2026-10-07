import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome, RT_BINARY } from "../harness.ts";

async function waitForSocket(sockPath: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(sockPath)) {
    if (Date.now() > deadline) throw new Error(`daemon socket never appeared at ${sockPath}`);
    await Bun.sleep(100);
  }
}

function freePort(): number {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = srv.port;
  srv.stop(true);
  if (!port) throw new Error("failed to allocate a free port");
  return port;
}

let apiPort = 0;
const children: Array<ReturnType<typeof Bun.spawn>> = [];

function runRt(args: string[], home: string) {
  const bunDir = join(process.execPath, "..");
  const proc = Bun.spawn([RT_BINARY, ...args], {
    env: {
      HOME: home,
      PATH: `${join(RT_BINARY, "..")}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
      TERM: "xterm-256color",
      RT_SKIP_SETUP: "1",
      CI: "true",
      RT_API_PORT: String(apiPort),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(proc);
  return proc;
}

describe("org:move through the daemon", () => {
  let home: string;
  let cleanup: () => void;
  let sock: string;
  let daemon: ReturnType<typeof runRt>;

  function clone(root: string, folder: string, org: string): string {
    const dir = join(home, ".mattstack", root, folder);
    mkdirSync(join(dir, "mattstack", "org"), { recursive: true });
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync("git remote add origin https://gitlab.example.com/acme/org.git", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org }));
    writeFileSync(join(dir, "mattstack", "org", "settings.org.jsonc"), "{}\n");
    execSync("git add -A && git -c user.email=dev1@gitlab.example.com -c user.name=dev1 commit -q -m init", { cwd: dir, stdio: "pipe" });
    return dir;
  }

  async function send(cmd: string, payload: unknown): Promise<any> {
    const res = await fetch(`http://localhost/${cmd}`, { unix: sock, method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } });
    return res.json();
  }

  beforeAll(async () => {
    apiPort = freePort();
    ({ path: home, cleanup } = createTestHome());
    mkdirSync(join(home, ".mattstack", "rt", "teams"), { recursive: true });
    writeFileSync(join(home, ".mattstack", "rt", "teams", "widgets.json"), JSON.stringify({ forgeUsername: "dev1" }));
    clone("teams", "widgets", "acme");
    daemon = runRt(["--daemon"], home);
    sock = join(home, ".mattstack", "rt", "rt.sock");
    await waitForSocket(sock);
    if (daemon.exitCode !== null) throw new Error(`daemon exited (code ${daemon.exitCode}) right after creating its socket`);
  });

  afterAll(async () => {
    for (const child of children) { try { child.kill(); } catch { /* already gone */ } }
    await Promise.all(children.map((c) => c.exited));
    cleanup();
  });

  test("moves a legacy clone, carries its record and the snapshot engine follows", async () => {
    const from = join(home, ".mattstack", "teams", "widgets");
    const to = join(home, ".mattstack", "orgs", "acme");
    const res = await send("org:move", { from, to });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ ok: true, folderMoved: true, records: { teams: "copied", invites: "none" } });
    expect(existsSync(to)).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(JSON.parse(readFileSync(join(home, ".mattstack", "rt", "teams", "acme.json"), "utf8"))).toMatchObject({ forgeUsername: "dev1" });
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "widgets.json"))).toBe(false);

    // The status read can race the daemon finishing its reply, so a short bounded poll absorbs that.
    let status = await send("team:snapshot-status", {});
    for (let i = 0; i < 20 && status.ok && status.data.length === 0; i++) {
      await Bun.sleep(100);
      status = await send("team:snapshot-status", {});
    }
    expect(status.ok).toBe(true);
    expect(status.data.map((e: { slug: string }) => e.slug)).toEqual(["acme"]);
    expect(status.data[0].repoDir).toBe(to);
  }, 30_000);

  test("a second move of the same clone is refused because the source is gone", async () => {
    const res = await send("org:move", { from: join(home, ".mattstack", "teams", "widgets"), to: join(home, ".mattstack", "orgs", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "from-missing" } });
  });
});
