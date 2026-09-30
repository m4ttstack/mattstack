import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { defaultHerdrRunner, herdrAgentSessionId, herdrAgentWait, launchInWorkspace, loginPathHerdrProbe, resolveHerdrBin, type HerdrRunner } from "../agent-herdr.ts";

function scripted(responses: Record<string, { stdout: string; exitCode?: number }>) {
  const calls: string[][] = [];
  const runner: HerdrRunner = async (args) => {
    calls.push(args);
    const r = responses[args.slice(0, 2).join(" ")] ?? { stdout: "{}" };
    return { stdout: r.stdout, exitCode: r.exitCode ?? 0 };
  };
  return { calls, runner };
}

const WS_CREATE = JSON.stringify({
  result: {
    root_pane: { pane_id: "wA:p1", tab_id: "wA:t1", workspace_id: "wA" },
    tab: { tab_id: "wA:t1" },
    workspace: { workspace_id: "wA" },
  },
});
const TAB_CREATE = JSON.stringify({
  result: { root_pane: { pane_id: "wA:p2", tab_id: "wA:t2", workspace_id: "wA" } },
});

test("no workspace: create, rename initial tab, pane run", async () => {
  const { calls, runner } = scripted({
    "workspace list": { stdout: JSON.stringify({ result: { workspaces: [] } }) },
    "workspace create": { stdout: WS_CREATE },
  });
  const out = await launchInWorkspace({ workspaceLabel: "reviews", tabLabel: "!7", paneCommand: "cd '/r' && claude" }, runner);
  expect(calls).toEqual([
    ["workspace", "list"],
    ["workspace", "create", "--label", "reviews", "--no-focus"],
    ["tab", "rename", "wA:t1", "!7"],
    ["pane", "run", "wA:p1", "cd '/r' && claude"],
  ]);
  expect(out).toEqual({ workspaceId: "wA", tabId: "wA:t1", paneId: "wA:p1", focusedExisting: false });
});

test("workspace exists, tab label free: tab create + pane run", async () => {
  const { calls, runner } = scripted({
    "workspace list": { stdout: JSON.stringify({ result: { workspaces: [{ workspace_id: "wA", label: "reviews" }] } }) },
    "tab list": { stdout: JSON.stringify({ result: { tabs: [{ tab_id: "wA:t1", label: "other" }] } }) },
    "tab create": { stdout: TAB_CREATE },
  });
  const out = await launchInWorkspace({ workspaceLabel: "reviews", tabLabel: "!7", paneCommand: "X" }, runner);
  expect(calls[1]).toEqual(["tab", "list", "--workspace", "wA"]);
  expect(calls[2]).toEqual(["tab", "create", "--workspace", "wA", "--label", "!7", "--no-focus"]);
  expect(calls[3]).toEqual(["pane", "run", "wA:p2", "X"]);
  expect(out.focusedExisting).toBe(false);
});

test("live tab with same label: focus, never re-run", async () => {
  const { calls, runner } = scripted({
    "workspace list": { stdout: JSON.stringify({ result: { workspaces: [{ workspace_id: "wA", label: "reviews" }] } }) },
    "tab list": { stdout: JSON.stringify({ result: { tabs: [{ tab_id: "wA:t9", label: "!7" }] } }) },
  });
  const out = await launchInWorkspace({ workspaceLabel: "reviews", tabLabel: "!7", paneCommand: "X" }, runner);
  expect(calls.map((c) => c[0])).toEqual(["workspace", "tab", "tab"]);
  expect(calls[2]).toEqual(["tab", "focus", "wA:t9"]);
  expect(out.focusedExisting).toBe(true);
  expect(calls.flat()).not.toContain("run");
});

test("herdr failure propagates as a throw", async () => {
  const runner: HerdrRunner = async () => ({ stdout: "boom", exitCode: 1 });
  await expect(launchInWorkspace({ workspaceLabel: "w", tabLabel: "t", paneCommand: "X" }, runner)).rejects.toThrow(/herdr/);
});

test("a failed pane run makes the launch throw, not report success", async () => {
  const { runner } = scripted({
    "workspace list": { stdout: JSON.stringify({ result: { workspaces: [] } }) },
    "workspace create": { stdout: WS_CREATE },
    "pane run": { stdout: "claude: command not found", exitCode: 127 },
  });
  await expect(
    launchInWorkspace({ workspaceLabel: "reviews", tabLabel: "!7", paneCommand: "cd '/r' && claude" }, runner),
  ).rejects.toThrow(/herdr pane run/);
});

test("a failed herdr call names its verb and cause, never the pane command it carried", async () => {
  const { runner } = scripted({
    "workspace list": { stdout: JSON.stringify({ result: { workspaces: [] } }) },
    "workspace create": { stdout: WS_CREATE },
    "pane run": { stdout: "claude: command not found", exitCode: 127 },
  });
  const err = await launchInWorkspace(
    { workspaceLabel: "reviews", tabLabel: "!7", paneCommand: "cd '/r' && SECRET_TOKEN=abc claude --settings '{}' 'review this'" },
    runner,
  ).catch((e: Error) => e);
  expect((err as Error).message).toBe("herdr pane run failed (127): claude: command not found");
});

test("malformed workspace list JSON (exit 0) makes the launch throw", async () => {
  const runner: HerdrRunner = async () => ({ stdout: "not json", exitCode: 0 });
  await expect(
    launchInWorkspace({ workspaceLabel: "reviews", tabLabel: "!7", paneCommand: "X" }, runner),
  ).rejects.toThrow(/invalid JSON/);
});

test("herdrAgentWait builds the current verb (agent wait --until)", async () => {
  const { calls, runner } = scripted({ "agent wait": { stdout: "" } });
  await herdrAgentWait("wA:p1", ["idle", "done"], 45000, runner);
  expect(calls[0]).toEqual(["agent", "wait", "wA:p1", "--until", "idle", "--until", "done", "--timeout", "45000"]);
});

// Real `herdr agent get` output, observed 2026-09-15, after codex's first
// prompt completed: {"result":{"agent":{"agent_session":{"agent":"codex",
// "kind":"id","source":"herdr:codex","value":"<uuid>"},...},"type":"agent_info"}}
// A freshly launched, not-yet-prompted pane has no `agent_session` key at
// all -- that shape is what the "still empty" call below models.
test("herdrAgentSessionId returns the id once herdr reports it", async () => {
  let call = 0;
  const runner: HerdrRunner = async (args) => {
    call += 1;
    if (args[0] === "agent" && args[1] === "get") {
      return call < 2
        ? { stdout: JSON.stringify({ result: { agent: {} } }), exitCode: 0 }
        : { stdout: JSON.stringify({ result: { agent: { agent_session: { value: "s_herdr_456" } } } }), exitCode: 0 };
    }
    throw new Error(`unexpected herdr call: ${args.join(" ")}`);
  };
  const sid = await herdrAgentSessionId("pane-1", 5000, runner);
  expect(sid).toBe("s_herdr_456");
});

test("herdrAgentSessionId gives up at the timeout", async () => {
  const runner: HerdrRunner = async () => ({ stdout: JSON.stringify({ result: { agent: {} } }), exitCode: 0 });
  const sid = await herdrAgentSessionId("pane-1", 600, runner);
  expect(sid).toBeUndefined();
});

test("resolveHerdrBin prefers HERDR_BIN over everything else", () => {
  const bin = resolveHerdrBin({ HERDR_BIN: "/custom/herdr", HOME: "/home/x" }, () => "/opt/homebrew/bin/herdr");
  expect(bin).toBe("/custom/herdr");
});

test("resolveHerdrBin prefers a PATH-resolved herdr over the ~/.local/bin fallback", () => {
  const bin = resolveHerdrBin({ HOME: "/home/x" }, () => "/opt/homebrew/bin/herdr");
  expect(bin).toBe("/opt/homebrew/bin/herdr");
});

test("resolveHerdrBin falls back to ~/.local/bin/herdr when PATH resolution fails", () => {
  const bin = resolveHerdrBin({ HOME: "/home/x" }, () => null);
  expect(bin).toBe("/home/x/.local/bin/herdr");
});

test("defaultHerdrRunner throws a clear error when the resolved bin does not exist", async () => {
  const runner = defaultHerdrRunner({ HERDR_BIN: "/nonexistent/herdr", HOME: "/home/x" });
  await expect(runner(["workspace", "list"])).rejects.toThrow(/herdr not found/);
});

test("defaultHerdrRunner passes the supplied env through to the child (C9: it must not fall back to bare process.env)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-herdr-env-"));
  const fakeHerdr = join(dir, "herdr");
  writeFileSync(fakeHerdr, "#!/bin/sh\necho \"$SENTINEL_VAR\"\n");
  chmodSync(fakeHerdr, 0o755);

  const runner = defaultHerdrRunner({ HERDR_BIN: fakeHerdr, HOME: dir, SENTINEL_VAR: "from-supplied-env" });
  const result = await runner(["workspace", "list"]);
  expect(result.stdout.trim()).toBe("from-supplied-env");
});

function fakeHerdrIn(dir: string): string {
  const bin = join(dir, "herdr");
  writeFileSync(bin, "#!/bin/sh\necho found-me\n");
  chmodSync(bin, 0o755);
  return bin;
}

/** Searches env.PATH only, so no test depends on a herdr installed on the machine running it. */
const pathOnly = (env: NodeJS.ProcessEnv) => resolveHerdrBin(env, (cmd) => Bun.which(cmd, { PATH: env.PATH ?? "" }));

test("resolveHerdrBin prefers herdr's own ~/.local/bin over the brew prefixes when PATH has none", () => {
  const home = mkdtempSync(join(tmpdir(), "agent-herdr-home-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const local = fakeHerdrIn(join(home, ".local", "bin"));
  expect(resolveHerdrBin({ HOME: home, PATH: "/usr/bin:/bin" })).toBe(local);
});

test("resolveHerdrBin searches the PATH passed in, not the PATH the process started with", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-herdr-path-"));
  const bin = fakeHerdrIn(dir);
  expect(resolveHerdrBin({ HOME: "/home/x", PATH: `/usr/bin:${dir}` })).toBe(bin);
});

test("defaultHerdrRunner asks the login PATH probe on a miss, so a herdr installed after boot is found", async () => {
  const home = mkdtempSync(join(tmpdir(), "agent-herdr-late-"));
  const lateDir = join(home, "late-bin");
  let probes = 0;
  const runner = defaultHerdrRunner({ HOME: home, PATH: "/usr/bin:/bin" }, {
    resolve: pathOnly,
    probe: async () => {
      probes++;
      return Bun.which("herdr", { PATH: lateDir });
    },
  });
  await expect(runner(["workspace", "list"])).rejects.toThrow(/herdr not found/);
  mkdirSync(lateDir);
  fakeHerdrIn(lateDir);
  const result = await runner(["workspace", "list"]);
  expect(result.stdout.trim()).toBe("found-me");
  expect(probes).toBe(2);
});

test("defaultHerdrRunner never probes when HERDR_BIN names the binary", async () => {
  let probes = 0;
  const runner = defaultHerdrRunner({ HERDR_BIN: "/nonexistent/herdr", HOME: "/home/x" }, {
    probe: async () => {
      probes++;
      return null;
    },
  });
  await expect(runner(["workspace", "list"])).rejects.toThrow(/herdr not found at \/nonexistent\/herdr/);
  expect(probes).toBe(0);
});

test("loginPathHerdrProbe keeps a herdr it found, so later launches spawn no login shell", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-herdr-probe-"));
  const bin = fakeHerdrIn(dir);
  let shells = 0;
  const probe = loginPathHerdrProbe(async () => {
    shells++;
    return `/usr/bin:${dir}`;
  });
  expect(await probe()).toBe(bin);
  expect(await probe()).toBe(bin);
  expect(shells).toBe(1);
});

test("loginPathHerdrProbe asks again once the herdr it found is gone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-herdr-probe-"));
  const bin = fakeHerdrIn(dir);
  let shells = 0;
  const probe = loginPathHerdrProbe(async () => {
    shells++;
    return `/usr/bin:${dir}`;
  });
  expect(await probe()).toBe(bin);
  rmSync(bin);
  expect(await probe()).toBeNull();
  expect(shells).toBe(2);
});
