import { describe, expect, test } from "bun:test";
import { join } from "path";
import { HERDR_ASSET_PREFIX } from "../herdr-builds.ts";
import { homebrewHerdr, installHerdrBuild, removeHerdrBackups, restartStaleHerdrServers, staleHerdrSessions } from "../herdr-install.ts";
import type { ExecOpts, ExecResult } from "../probes.ts";
import { fakeProbes, ok, type FakeProbesOpts } from "./fakes.ts";

const HOME = "/fake-home";
const BIN = join(HOME, ".local", "bin");
const DEST = join(BIN, "herdr");
const STAGED = join(BIN, ".herdr-0.9.5-ms.2.new");
const TMP = "/fake-tmp";
const DOWNLOAD = join(TMP, "rt-herdr-install", "herdr");
const ARM = { url: `${HERDR_ASSET_PREFIX}v0.9.5-ms.2/herdr-macos-aarch64`, sha256: "a".repeat(64) };
const INTEL = { url: `${HERDR_ASSET_PREFIX}v0.9.5-ms.2/herdr-macos-x86_64`, sha256: "b".repeat(64) };

function listBody(changesServer = true): string {
  return JSON.stringify({
    schema: 1,
    newest: "0.9.5-ms.2",
    builds: [{ version: "0.9.5-ms.2", herdr: "0.9.5", revision: 2, changesServer, assets: { arm64: ARM, x86_64: INTEL }, supersedes: [] }],
  });
}

interface Session {
  name: string;
  socket: string;
  version: string;
}

interface Script {
  sha?: string;
  stagedVersion?: string;
  sessions?: Session[];
  handoff?: ExecResult;
  brewUninstall?: ExecResult;
}

type Seen = { argv: string[]; env?: Record<string, string> };

function herdrExec(script: Script, seen: Seen[]) {
  const sessions = script.sessions ?? [];
  return (argv: string[], opts?: ExecOpts): ExecResult => {
    seen.push({ argv, env: opts?.env });
    if (argv[0] === "shasum") return ok(`${script.sha ?? ARM.sha256}  ${argv[3]}\n`);
    if (argv[0] === STAGED && argv[1] === "--version") return ok(`herdr ${script.stagedVersion ?? "0.9.5-ms.2"}\n`);
    if (argv[0] === DEST && argv[1] === "--version") return ok("herdr 0.9.5-ms.2\n");
    if (argv[1] === "session" && argv[2] === "list") {
      return ok(JSON.stringify({ sessions: sessions.map((s) => ({ name: s.name, running: true, socket_path: s.socket, panes: 3 })) }));
    }
    if (argv[1] === "status" && argv[2] === "server") {
      const s = sessions.find((x) => x.socket === opts?.env?.HERDR_SOCKET_PATH);
      return s ? ok(JSON.stringify({ running: true, version: s.version })) : { code: 1, stdout: "", stderr: "no server" };
    }
    if (argv[1] === "server" && argv[2] === "live-handoff") return script.handoff ?? ok("live handoff complete\n");
    if (argv[1] === "uninstall") return script.brewUninstall ?? ok();
    return ok();
  };
}

function setup(script: Script = {}, extra: FakeProbesOpts = {}, fetchStatus = 200, changesServer = true) {
  const seen: Seen[] = [];
  const p = fakeProbes({
    home: HOME,
    env: { TMPDIR: TMP },
    exec: herdrExec(script, seen),
    fetch: async () => ({ status: fetchStatus, body: fetchStatus === 200 ? listBody(changesServer) : "Not Found", headers: {} }),
    ...extra,
  });
  return { p, seen };
}

describe("installHerdrBuild", () => {
  test("installs the newest build for arm64", async () => {
    const { p } = setup();
    const result = await installHerdrBuild(p, "arm64");
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", ARM.url, "-o", DOWNLOAD]);
    expect(p.calls.exec).toContainEqual(["shasum", "-a", "256", DOWNLOAD]);
    expect(p.calls.exec).toContainEqual(["install", "-m", "0755", DOWNLOAD, STAGED]);
    expect(p.calls.exec).toContainEqual([STAGED, "--version"]);
    expect(p.calls.renames).toEqual([[STAGED, DEST]]);
    expect(result.via).toBe("download");
    expect(result.ok).toBe(true);
    expect(result.detail.startsWith("Installed herdr 0.9.5-ms.2")).toBe(true);
  });

  test("an Intel Mac downloads the x86_64 asset", async () => {
    const { p } = setup({ sha: INTEL.sha256 });
    const result = await installHerdrBuild(p, "x86_64");
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", INTEL.url, "-o", DOWNLOAD]);
    expect(result.ok).toBe(true);
  });

  test("sha mismatch installs nothing", async () => {
    const { p } = setup({ sha: "c".repeat(64) });
    const result = await installHerdrBuild(p, "arm64");
    expect(result).toEqual({ via: "download", ok: false, detail: "The herdr download did not match the build list's sha256, so nothing was installed" });
    expect(p.calls.renames).toEqual([]);
    expect(p.calls.exec.some((argv) => argv[0] === "install")).toBe(false);
  });

  test("wrong --version installs nothing", async () => {
    const { p } = setup({ stagedVersion: "0.9.5" });
    const result = await installHerdrBuild(p, "arm64");
    expect(result.ok).toBe(false);
    expect(p.calls.removed).toContain(STAGED);
    expect(p.calls.renames).toEqual([]);
  });

  test("install fails without touching the binary when the list is unreachable", async () => {
    const { p } = setup({}, {}, 404);
    const result = await installHerdrBuild(p, "arm64");
    expect(result).toEqual({ via: "download", ok: false, detail: "rt could not read herdr's build list from m4ttstack/herdr" });
    expect(p.calls.exec.some((argv) => argv[0] === "curl")).toBe(false);
    expect(p.calls.renames).toEqual([]);
  });

  test("a build with no asset for this processor installs nothing", async () => {
    const seen: Seen[] = [];
    const body = JSON.stringify({
      schema: 1,
      newest: "0.9.5-ms.2",
      builds: [{ version: "0.9.5-ms.2", herdr: "0.9.5", revision: 2, changesServer: false, assets: { arm64: ARM }, supersedes: [] }],
    });
    const p = fakeProbes({ home: HOME, env: { TMPDIR: TMP }, exec: herdrExec({}, seen), fetch: async () => ({ status: 200, body, headers: {} }) });
    const result = await installHerdrBuild(p, "x86_64");
    expect(result).toEqual({ via: "download", ok: false, detail: "The newest herdr build has no download for this Mac's processor (x86_64)" });
    expect(p.calls.exec.some((argv) => argv[0] === "curl")).toBe(false);
  });

  test("deletes flock's stock backup", async () => {
    const backup = join(BIN, "herdr.pre-mouse-backup");
    const present = setup({}, { files: { [backup]: "stock" } });
    await installHerdrBuild(present.p, "arm64");
    expect(present.p.calls.removed).toContain(backup);

    const absent = setup();
    await installHerdrBuild(absent.p, "arm64");
    expect(absent.p.calls.removed).not.toContain(backup);
  });

  test("uninstalls Homebrew herdr", async () => {
    const { p } = setup({}, { links: { "/opt/homebrew/bin/herdr": "../Cellar/herdr/0.9.5/bin/herdr" } });
    const result = await installHerdrBuild(p, "arm64");
    expect(p.calls.exec).toContainEqual(["/opt/homebrew/bin/brew", "uninstall", "herdr"]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("removed Homebrew's herdr");
  });

  test("a Homebrew uninstall that fails is noted, not a failed install", async () => {
    const { p } = setup({ brewUninstall: { code: 1, stdout: "", stderr: "Error: permission denied" } }, { links: { "/opt/homebrew/bin/herdr": "../Cellar/herdr/0.9.5/bin/herdr" } });
    const result = await installHerdrBuild(p, "arm64");
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("Homebrew");
    expect(result.detail).not.toContain("removed Homebrew's herdr");
  });

  test("hands off each stale running session", async () => {
    const { p, seen } = setup({
      sessions: [
        { name: "work", socket: "/s/work.sock", version: "0.9.5" },
        { name: "fresh", socket: "/s/fresh.sock", version: "0.9.5-ms.2" },
      ],
    });
    const result = await installHerdrBuild(p, "arm64");
    const handoffs = seen.filter((c) => c.argv[1] === "server" && c.argv[2] === "live-handoff");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.argv).toEqual([DEST, "server", "live-handoff", "--import-exe", DEST, "--expected-version", "0.9.5-ms.2"]);
    expect(handoffs[0]!.env).toEqual({ HERDR_SOCKET_PATH: "/s/work.sock" });
    expect(result.detail).toContain("moved 1 running herdr server onto it");
    expect(result.detail).not.toContain("restart herdr");
  });

  test("a build that keeps the server never hands off", async () => {
    const { p, seen } = setup({ sessions: [{ name: "work", socket: "/s/work.sock", version: "0.9.5" }] }, {}, 200, false);
    const result = await installHerdrBuild(p, "arm64");
    expect(seen.some((c) => c.argv[2] === "live-handoff")).toBe(false);
    expect(result.detail).toBe("Installed herdr 0.9.5-ms.2");
  });

  test("refused handoff leaves the server and reports restart", async () => {
    const { p, seen } = setup({ sessions: [{ name: "work", socket: "/s/work.sock", version: "0.9.5" }], handoff: { code: 1, stdout: "", stderr: "protocol mismatch" } });
    const result = await installHerdrBuild(p, "arm64");
    expect(result.ok).toBe(true);
    expect(seen.some((c) => c.argv[1] === "server" && c.argv[2] === "stop")).toBe(false);
    expect(result.detail.endsWith("restart herdr when your agents are done")).toBe(true);
  });

  test("a handoff that exits 0 without saying it completed counts as refused", async () => {
    const { p } = setup({ sessions: [{ name: "work", socket: "/s/work.sock", version: "0.9.5" }], handoff: ok("nothing to do\n") });
    const result = await installHerdrBuild(p, "arm64");
    expect(result.detail.endsWith("restart herdr when your agents are done")).toBe(true);
  });
});

describe("herdr helpers", () => {
  test("restartStaleHerdrServers stops only stale servers", async () => {
    const { p, seen } = setup({
      sessions: [
        { name: "work", socket: "/s/work.sock", version: "0.9.5" },
        { name: "fresh", socket: "/s/fresh.sock", version: "0.9.5-ms.2" },
      ],
    });
    expect(await restartStaleHerdrServers(p)).toEqual({ stopped: ["work"], failed: [] });
    const stops = seen.filter((c) => c.argv[1] === "server" && c.argv[2] === "stop");
    expect(stops).toEqual([{ argv: [DEST, "server", "stop"], env: { HERDR_SOCKET_PATH: "/s/work.sock" } }]);
  });

  test("staleHerdrSessions is empty when herdr cannot list sessions", async () => {
    const p = fakeProbes({ exec: () => ({ code: 127, stdout: "", stderr: "ENOENT" }) });
    expect(await staleHerdrSessions(p, [DEST], "0.9.5-ms.2")).toEqual([]);
  });

  test("homebrewHerdr finds an Intel Homebrew copy and ignores a non-Cellar link", () => {
    expect(homebrewHerdr(fakeProbes({ links: { "/usr/local/bin/herdr": "../Cellar/herdr/0.9.5/bin/herdr" } }))).toEqual({ herdr: "/usr/local/bin/herdr", brew: "/usr/local/bin/brew" });
    expect(homebrewHerdr(fakeProbes({ links: { "/opt/homebrew/bin/herdr": "/Users/x/.cargo/bin/herdr" } }))).toBeNull();
  });

  test("removeHerdrBackups names what it removed", () => {
    const backup = join(BIN, "herdr.pre-mouse-backup");
    expect(removeHerdrBackups(fakeProbes({ home: HOME, files: { [backup]: "stock" } }))).toEqual([backup]);
    expect(removeHerdrBackups(fakeProbes({ home: HOME }))).toEqual([]);
  });
});
