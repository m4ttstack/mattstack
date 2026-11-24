import { describe, expect, test } from "bun:test";
import { join } from "path";
import { HERDR_ASSET_PREFIX } from "../herdr-builds.ts";
import { homebrewHerdrs, installHerdrBuild, removeHerdrBackups, restartStaleHerdrServers, staleHerdrSessions } from "../herdr-install.ts";
import type { ExecOpts, ExecResult } from "../probes.ts";
import { fakeProbes, ok, type FakeProbesOpts } from "./fakes.ts";

const HOME = "/fake-home";
const BIN = join(HOME, ".local", "bin");
const DEST = join(BIN, "herdr");
const TMP = "/fake-tmp";
const WORK = join(TMP, "rt-herdr-install");
const DOWNLOAD = join(WORK, "herdr");
const asset = (version: string, arch: "aarch64" | "x86_64") => ({ url: `${HERDR_ASSET_PREFIX}v${version}/herdr-macos-${arch}`, sha256: (arch === "aarch64" ? "a" : "b").repeat(64) });
const ARM = asset("0.9.5-ms.2", "aarch64");
const INTEL = asset("0.9.5-ms.2", "x86_64");
const staged = (version: string) => join(BIN, `.herdr-${version}.new`);
const STAGED = staged("0.9.5-ms.2");

/** Build version → changesServer; the last entry is the list's newest. */
type Builds = Record<string, boolean>;

function listBody(builds: Builds): string {
  const versions = Object.keys(builds);
  return JSON.stringify({
    schema: 1,
    newest: versions.at(-1),
    builds: versions.map((version) => ({
      version,
      herdr: "0.9.5",
      revision: Number(version.split("-ms.")[1]),
      changesServer: builds[version],
      assets: { arm64: asset(version, "aarch64"), x86_64: asset(version, "x86_64") },
      supersedes: [],
    })),
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
  installedVersion?: string;
  sessions?: Session[];
  handoff?: ExecResult;
  brewUninstall?: ExecResult;
  curl?: ExecResult;
  install?: ExecResult;
  xattr?: ExecResult;
}

type Seen = { argv: string[]; env?: Record<string, string> };

function herdrExec(script: Script, seen: Seen[]) {
  const sessions = script.sessions ?? [];
  return (argv: string[], opts?: ExecOpts): ExecResult => {
    seen.push({ argv, env: opts?.env });
    if (argv[0] === "curl") return script.curl ?? ok();
    if (argv[0] === "install") return script.install ?? ok();
    if (argv[0] === "/usr/bin/xattr") return script.xattr ?? ok();
    if (argv[0] === "shasum") return ok(`${script.sha ?? ARM.sha256}  ${argv[3]}\n`);
    if (argv[0]!.endsWith(".new") && argv[1] === "--version") return ok(`herdr ${script.stagedVersion ?? argv[0]!.slice(argv[0]!.indexOf(".herdr-") + 7, -4)}\n`);
    if (argv[0] === DEST && argv[1] === "--version") return script.installedVersion === "" ? { code: 127, stdout: "", stderr: "ENOENT" } : ok(`herdr ${script.installedVersion ?? "0.9.5-ms.2"}\n`);
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

function setup(script: Script = {}, extra: FakeProbesOpts = {}, opts: { fetchStatus?: number; builds?: Builds } = {}) {
  const seen: Seen[] = [];
  const fetchStatus = opts.fetchStatus ?? 200;
  const builds = opts.builds ?? { "0.9.5-ms.2": true };
  const p = fakeProbes({
    home: HOME,
    env: { TMPDIR: TMP },
    exec: herdrExec(script, seen),
    fetch: async () => ({ status: fetchStatus, body: fetchStatus === 200 ? listBody(builds) : "Not Found", headers: {} }),
    files: { [DEST]: "old herdr" },
    ...extra,
  });
  return { p, seen };
}

const handoffs = (seen: Seen[]) => seen.filter((c) => c.argv[1] === "server" && c.argv[2] === "live-handoff");

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
    expect(p.calls.removed).toContain(WORK);
  });

  test("clears quarantine on the staged copy before running it or swapping it in", async () => {
    const { p } = setup();
    await installHerdrBuild(p, "arm64");
    const xattr = p.calls.exec.findIndex((argv) => argv.join(" ") === `/usr/bin/xattr -d com.apple.quarantine ${STAGED}`);
    const version = p.calls.exec.findIndex((argv) => argv[0] === STAGED && argv[1] === "--version");
    expect(xattr).toBeGreaterThan(p.calls.exec.findIndex((argv) => argv[0] === "install"));
    expect(xattr).toBeLessThan(version);
    expect(p.calls.renames).toEqual([[STAGED, DEST]]);
  });

  test("a copy with no quarantine attribute still installs", async () => {
    const { p } = setup({ xattr: { code: 1, stdout: "", stderr: `xattr: ${STAGED}: No such xattr: com.apple.quarantine\n` } });
    const result = await installHerdrBuild(p, "arm64");
    expect(result.ok).toBe(true);
    expect(p.calls.renames).toEqual([[STAGED, DEST]]);
  });

  test("an Intel Mac downloads the x86_64 asset", async () => {
    const { p } = setup({ sha: INTEL.sha256 });
    const result = await installHerdrBuild(p, "x86_64");
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", INTEL.url, "-o", DOWNLOAD]);
    expect(result.ok).toBe(true);
  });

  test("an empty TMPDIR downloads under /tmp, never a path relative to the cwd", async () => {
    const { p } = setup({}, { env: { TMPDIR: "" } });
    await installHerdrBuild(p, "arm64");
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", ARM.url, "-o", "/tmp/rt-herdr-install/herdr"]);
  });

  test("sha mismatch installs nothing", async () => {
    const { p } = setup({ sha: "c".repeat(64) });
    const result = await installHerdrBuild(p, "arm64");
    expect(result).toEqual({ via: "download", ok: false, detail: "The herdr download did not match the build list's sha256, so nothing was installed" });
    expect(p.calls.renames).toEqual([]);
    expect(p.calls.exec.some((argv) => argv[0] === "install")).toBe(false);
    expect(p.calls.removed).toContain(WORK);
  });

  test("wrong --version installs nothing", async () => {
    const { p } = setup({ stagedVersion: "0.9.5" });
    const result = await installHerdrBuild(p, "arm64");
    expect(result).toEqual({ via: "download", ok: false, detail: "The herdr download reports version 0.9.5, not 0.9.5-ms.2, so nothing was installed" });
    expect(p.calls.removed).toContain(STAGED);
    expect(p.calls.renames).toEqual([]);
    expect(p.readFile(DEST)).toBe("old herdr");
  });

  test("a failed download installs nothing", async () => {
    const { p } = setup({ curl: { code: 22, stdout: "", stderr: "curl: (22) 404\n" } });
    const result = await installHerdrBuild(p, "arm64");
    expect(result).toEqual({ via: "download", ok: false, detail: "Downloading herdr failed (exit 22): curl: (22) 404" });
    expect(p.calls.exec.some((argv) => argv[0] === "shasum" || argv[0] === "install")).toBe(false);
    expect(p.readFile(DEST)).toBe("old herdr");
    expect(p.calls.removed).toContain(WORK);
  });

  test("a download that times out installs nothing", async () => {
    const { p } = setup({ curl: { code: 124, stdout: "", stderr: "" } });
    const result = await installHerdrBuild(p, "arm64");
    expect(result).toEqual({ via: "download", ok: false, detail: "Downloading herdr did not finish in time" });
    expect(p.readFile(DEST)).toBe("old herdr");
    expect(p.calls.removed).toContain(WORK);
  });

  test("a failed copy into ~/.local/bin installs nothing", async () => {
    const { p } = setup({ install: { code: 71, stdout: "", stderr: "install: Permission denied\n" } });
    const result = await installHerdrBuild(p, "arm64");
    expect(result).toEqual({ via: "download", ok: false, detail: "Copying herdr into ~/.local/bin failed: install: Permission denied" });
    expect(p.calls.renames).toEqual([]);
    expect(p.readFile(DEST)).toBe("old herdr");
    expect(p.calls.removed).toContain(WORK);
  });

  test("a rename that throws removes the staged copy and keeps the old binary", async () => {
    const { p } = setup();
    p.rename = () => {
      throw new Error("EACCES: permission denied");
    };
    const result = await installHerdrBuild(p, "arm64");
    expect(result).toEqual({ via: "download", ok: false, detail: "Replacing ~/.local/bin/herdr failed: EACCES: permission denied" });
    expect(p.calls.removed).toContain(STAGED);
    expect(p.readFile(DEST)).toBe("old herdr");
    expect(p.calls.removed).toContain(WORK);
  });

  test("install fails without touching the binary when the list is unreachable", async () => {
    const { p } = setup({}, {}, { fetchStatus: 404 });
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
    const present = setup({}, { files: { [DEST]: "old herdr", [backup]: "stock" } });
    await installHerdrBuild(present.p, "arm64");
    expect(present.p.calls.removed).toContain(backup);

    const absent = setup();
    await installHerdrBuild(absent.p, "arm64");
    expect(absent.p.calls.removed).not.toContain(backup);
  });

  const BREW_ARM = { "/opt/homebrew/bin/herdr": "../Cellar/herdr/0.9.5/bin/herdr" };
  const BREW_BOTH = { ...BREW_ARM, "/usr/local/bin/herdr": "../Cellar/herdr/0.9.5/bin/herdr" };
  const uninstalls = (seen: Seen[]) => seen.filter((c) => c.argv[1] === "uninstall").map((c) => c.argv);

  test("a stock herdr beside Homebrew's gets the build, then Homebrew's copy is removed", async () => {
    const { p, seen } = setup({ installedVersion: "0.9.5" }, { links: BREW_ARM });
    const result = await installHerdrBuild(p, "arm64");
    expect(p.calls.renames).toEqual([[STAGED, DEST]]);
    expect(uninstalls(seen)).toEqual([["/opt/homebrew/bin/brew", "uninstall", "herdr"]]);
    expect(result).toEqual({ via: "download", ok: true, detail: "Installed herdr 0.9.5-ms.2; removed Homebrew's herdr" });
  });

  test("every Homebrew prefix is uninstalled in one press", async () => {
    const { p, seen } = setup({ installedVersion: "0.9.5" }, { links: BREW_BOTH });
    const result = await installHerdrBuild(p, "arm64");
    expect(uninstalls(seen)).toEqual([
      ["/opt/homebrew/bin/brew", "uninstall", "herdr"],
      ["/usr/local/bin/brew", "uninstall", "herdr"],
    ]);
    expect(result.ok).toBe(true);
  });

  test("Homebrew's herdr beside a current build is only uninstalled, never downloaded over", async () => {
    const { p, seen } = setup({}, { links: BREW_ARM });
    const result = await installHerdrBuild(p, "arm64");
    expect(p.calls.exec.some((argv) => argv[0] === "curl")).toBe(false);
    expect(p.calls.renames).toEqual([]);
    expect(uninstalls(seen)).toEqual([["/opt/homebrew/bin/brew", "uninstall", "herdr"]]);
    expect(result).toEqual({ via: "download", ok: true, detail: "Removed Homebrew's herdr" });
  });

  test("a dev build newer than the list's newest is never downgraded to remove Homebrew's herdr", async () => {
    const { p } = setup({ installedVersion: "0.9.5-ms.9" }, { links: BREW_ARM });
    await installHerdrBuild(p, "arm64");
    expect(p.calls.exec.some((argv) => argv[0] === "curl")).toBe(false);
    expect(p.calls.renames).toEqual([]);
  });

  test("Homebrew's herdr beside a current build is removed with the build list unreachable", async () => {
    const { p, seen } = setup({}, { links: BREW_ARM }, { fetchStatus: 404 });
    const result = await installHerdrBuild(p, "arm64");
    expect(uninstalls(seen)).toHaveLength(1);
    expect(result.ok).toBe(true);
  });

  test("a Homebrew uninstall that fails is a failed install naming the command to run", async () => {
    const { p } = setup({ brewUninstall: { code: 1, stdout: "", stderr: "Error: permission denied" } }, { links: BREW_ARM });
    expect(await installHerdrBuild(p, "arm64")).toEqual({
      via: "download",
      ok: false,
      detail: "Homebrew's herdr is still installed (brew uninstall exit 1). Remove it in a terminal: /opt/homebrew/bin/brew uninstall herdr",
      remedy: "Run /opt/homebrew/bin/brew uninstall herdr in a terminal",
    });
  });

  test("a Homebrew uninstall that fails after a download keeps the build and still fails", async () => {
    const { p } = setup({ installedVersion: "0.9.5", brewUninstall: { code: 1, stdout: "", stderr: "Error" } }, { links: BREW_ARM });
    const result = await installHerdrBuild(p, "arm64");
    expect(p.calls.renames).toEqual([[STAGED, DEST]]);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("Installed herdr 0.9.5-ms.2; Homebrew's herdr is still installed (brew uninstall exit 1). Remove it in a terminal: /opt/homebrew/bin/brew uninstall herdr");
  });

  test("hands off each stale running session", async () => {
    const { p, seen } = setup({
      sessions: [
        { name: "work", socket: "/s/work.sock", version: "0.9.5" },
        { name: "fresh", socket: "/s/fresh.sock", version: "0.9.5-ms.2" },
      ],
    });
    const result = await installHerdrBuild(p, "arm64");
    expect(handoffs(seen)).toHaveLength(1);
    expect(handoffs(seen)[0]!.argv).toEqual([DEST, "server", "live-handoff", "--import-exe", DEST, "--expected-version", "0.9.5-ms.2"]);
    expect(handoffs(seen)[0]!.env).toEqual({ HERDR_SOCKET_PATH: "/s/work.sock" });
    expect(result.detail).toContain("moved 1 running herdr server onto it");
    expect(result.detail).not.toContain("restart herdr");
  });

  test("a stock server is handed off even when the newest build keeps the server", async () => {
    const { p, seen } = setup({ sessions: [{ name: "work", socket: "/s/work.sock", version: "0.9.5" }] }, {}, { builds: { "0.9.5-ms.2": false } });
    await installHerdrBuild(p, "arm64");
    expect(handoffs(seen)).toHaveLength(1);
  });

  test("a fork server is left alone when no build after it changes the server", async () => {
    const { p, seen } = setup({ sessions: [{ name: "work", socket: "/s/work.sock", version: "0.9.5-ms.1" }] }, {}, { builds: { "0.9.5-ms.1": true, "0.9.5-ms.2": false } });
    const result = await installHerdrBuild(p, "arm64");
    expect(handoffs(seen)).toHaveLength(0);
    expect(result.detail).toBe("Installed herdr 0.9.5-ms.2");
  });

  test("a fork server is handed off when a build between it and the new one changes the server", async () => {
    const { p, seen } = setup(
      { sha: asset("0.9.5-ms.3", "aarch64").sha256, sessions: [{ name: "work", socket: "/s/work.sock", version: "0.9.5-ms.1" }] },
      {},
      { builds: { "0.9.5-ms.1": false, "0.9.5-ms.2": true, "0.9.5-ms.3": false } },
    );
    await installHerdrBuild(p, "arm64");
    expect(handoffs(seen).map((c) => c.argv.at(-1))).toEqual(["0.9.5-ms.3"]);
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

  test("restartStaleHerdrServers leaves a server no build since has changed", async () => {
    const { p, seen } = setup({ sessions: [{ name: "work", socket: "/s/work.sock", version: "0.9.5-ms.1" }] }, {}, { builds: { "0.9.5-ms.1": true, "0.9.5-ms.2": false } });
    expect(await restartStaleHerdrServers(p)).toEqual({ stopped: [], failed: [] });
    expect(seen.some((c) => c.argv[2] === "stop")).toBe(false);
  });

  test("restartStaleHerdrServers says so when ~/.local/bin/herdr does not run", async () => {
    const { p, seen } = setup({ installedVersion: "", sessions: [{ name: "work", socket: "/s/work.sock", version: "0.9.5" }] });
    expect(await restartStaleHerdrServers(p)).toEqual({ stopped: [], failed: [], error: "~/.local/bin/herdr does not run (exit 127), so rt restarted nothing" });
    expect(seen.some((c) => c.argv[2] === "stop")).toBe(false);
  });

  test("staleHerdrSessions is empty when herdr cannot list sessions", async () => {
    const p = fakeProbes({ exec: () => ({ code: 127, stdout: "", stderr: "ENOENT" }) });
    expect(await staleHerdrSessions(p, [DEST], "0.9.5-ms.2", null)).toEqual([]);
  });

  test("homebrewHerdrs finds an Intel Homebrew copy and ignores a non-Cellar link", () => {
    expect(homebrewHerdrs(fakeProbes({ links: { "/usr/local/bin/herdr": "../Cellar/herdr/0.9.5/bin/herdr" } }))).toEqual([{ herdr: "/usr/local/bin/herdr", brew: "/usr/local/bin/brew" }]);
    expect(homebrewHerdrs(fakeProbes({ links: { "/opt/homebrew/bin/herdr": "/Users/x/.cargo/bin/herdr" } }))).toEqual([]);
  });

  test("homebrewHerdrs finds both Homebrew prefixes", () => {
    const links = { "/opt/homebrew/bin/herdr": "../Cellar/herdr/0.9.5/bin/herdr", "/usr/local/bin/herdr": "../Cellar/herdr/0.9.4/bin/herdr" };
    expect(homebrewHerdrs(fakeProbes({ links })).map((b) => b.brew)).toEqual(["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]);
  });

  test("removeHerdrBackups names what it removed", () => {
    const backup = join(BIN, "herdr.pre-mouse-backup");
    expect(removeHerdrBackups(fakeProbes({ home: HOME, files: { [backup]: "stock" } }))).toEqual([backup]);
    expect(removeHerdrBackups(fakeProbes({ home: HOME }))).toEqual([]);
  });
});
