import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { createNotifyOnce, runDevAutoUpdate, type DevAutoDeps } from "../auto-update.ts";
import type { CloneCheck } from "../clone-guards.ts";
import type { DevSeams, StageRunner } from "../seams.ts";

const CLONE = "/Users/collab/Documents/GitHub/mattstack";
const BUN = "/Users/collab/.bun/bin/bun";
const GO = "/opt/homebrew/bin/go";
const runner: StageRunner = async (_t, task) => task({ sub: () => {}, pause: (fn) => fn() });

interface World {
  installed?: string;
  releaseBuild?: boolean;
  release?: string;
  originGo?: string;
  flavor?: "dev" | "prod";
  appBuildFails?: boolean;
}

function setup(w: World = {}) {
  const order: string[] = [];
  const once = (step: string) => { if (!order.includes(step)) order.push(step); };
  const files: Record<string, string> = {
    [`${CLONE}/cli.ts`]: "",
    [`${CLONE}/package.json`]: JSON.stringify({ packageManager: "bun@1.4.2" }),
    [`${CLONE}/ui/go.mod`]: "go 1.26.5\n",
    [`${CLONE}/ui/dist/rt-ui`]: "",
    [`${CLONE}/apps/console/mattstack.deck.json`]: JSON.stringify({ dev: { build: "bun run build" } }),
    "/usr/bin/git": "",
    [BUN]: "",
    [GO]: "",
    "/Applications/mattstack-dev.app/Contents/Info.plist": "",
    "/scratch/unpacked/mattstack-dev.app/Contents/Info.plist": "",
  };
  const release = w.release ?? "2.23.0";
  const probes = fakeProbes({
    home: "/Users/collab",
    env: { PATH: "/usr/bin" },
    files,
    dirs: { "/Applications/mattstack-dev.app": ["Contents"] },
    fetch: async () => ({ status: 200, headers: {}, body: `abc123  mattstack-dev-${release}.zip\n` }),
    exec: (argv) => {
      const a = argv.join(" ");
      if (a === "/usr/bin/git --version") { once("tools"); return { code: 0, stdout: "git version 2.50.1", stderr: "" }; }
      if (a === `${BUN} --version`) return { code: 0, stdout: "1.4.2", stderr: "" };
      if (a === `${GO} version`) return { code: 0, stdout: "go version go1.26.5 darwin/arm64", stderr: "" };
      if (a === `git -C ${CLONE} show origin/main:package.json`) return { code: 0, stdout: JSON.stringify({ packageManager: "bun@1.4.2" }), stderr: "" };
      if (a === `git -C ${CLONE} show origin/main:ui/go.mod`) return { code: 0, stdout: `go ${w.originGo ?? "1.26.5"}\n`, stderr: "" };
      if (argv[0] === "find") return { code: 0, stdout: `${CLONE}/ui/cmd/rt-ui/main.go\n`, stderr: "" };
      if (a === `${BUN} run ui:build`) { once("ui"); return { code: 0, stdout: "", stderr: "" }; }
      if (a.includes(" register --dir ")) { once("register"); return { code: 0, stdout: "", stderr: "" }; }
      if (argv[0] === "/bin/sh" && argv[2] === "bun run build") { once("apps"); return { code: w.appBuildFails ? 1 : 0, stdout: "", stderr: "vite failed" }; }
      if (a.includes("CFBundleShortVersionString")) return { code: 0, stdout: `${w.installed ?? "2.22.0"}\n`, stderr: "" };
      if (a.includes("MSDevReleaseBuild")) return w.releaseBuild === false ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: "true\n", stderr: "" };
      if (a.includes("api repos/m4ttstack/mattstack/releases")) {
        return {
          code: 0,
          stderr: "",
          stdout: JSON.stringify([{
            tag_name: `v${release}`, draft: false, prerelease: false,
            assets: [{ name: `mattstack-dev-${release}.zip`, browser_download_url: "https://dl/z" }, { name: "SHA256SUMS", browser_download_url: "https://dl/s" }],
          }]),
        };
      }
      if (argv[0] === "shasum") return { code: 0, stdout: "abc123  x\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const s: DevSeams = {
    probes,
    swap: { exec: async () => { once("swap"); return { stdout: "", stderr: "", exitCode: 0 }; }, sleep: async () => {} },
    download: async () => {},
    scratchDir: () => "/scratch",
    flavor: w.flavor ?? "dev",
    interactive: false,
    prodVersion: "dev",
    confirm: async () => false,
    repoRoot: () => "/Users/collab/Documents/GitHub",
    storedSourcePath: () => CLONE,
    saveSourcePath: () => {},
    installDevTool: async () => ({ via: "vendor", ok: true, detail: "" }),
    gh: () => ["gh"],
    devWrapperOwnsRt: () => true,
  };
  const statuses: Array<{ offeredVersion: string | null; heldVersion: string | null; hold: string | null }> = [];
  const notices: Array<[string, string, string]> = [];
  let checked = 0;
  const state = { autoUpdate: true, busy: false, clone: { ok: true, behind: 3 } as CloneCheck, installExit: 0, ffExit: 0, cleared: 0 };
  const d: DevAutoDeps = {
    autoUpdateOn: () => state.autoUpdate,
    daemonBusy: async () => state.busy,
    checkClone: async () => { checked++; once("fetch"); return state.clone; },
    fastForward: async () => { once("ff"); return { exitCode: state.ffExit, stderr: "" }; },
    install: async () => { once("install"); return { exitCode: state.installExit, tail: "lockfile changed" }; },
    restartDaemon: async () => { once("restart"); },
    writeStatus: (st) => { statuses.push(st); },
    clearHeld: () => { state.cleared++; },
    notifyOnce: (version, hold, detail) => { notices.push([version, hold, detail]); },
    lock: async (fn) => fn(),
  };
  return { s, d, order, statuses, notices, state, checked: () => checked };
}

describe("runDevAutoUpdate", () => {
  test("no newer release: current, and nothing is checked or written", async () => {
    const t = setup({ installed: "2.23.0" });
    expect(await runDevAutoUpdate(t.s, runner, t.d)).toEqual({ kind: "current" });
    expect(t.checked()).toBe(0);
    expect(t.statuses).toEqual([]);
    expect(t.state.cleared).toBe(1);
  });

  test("a locally built dev app: current, the clone is never fetched", async () => {
    const t = setup({ releaseBuild: false });
    expect(await runDevAutoUpdate(t.s, runner, t.d)).toEqual({ kind: "current" });
    expect(t.checked()).toBe(0);
    expect(t.statuses).toEqual([]);
  });

  test("a prod Mac: current, nothing touched", async () => {
    const t = setup({ flavor: "prod" });
    expect(await runDevAutoUpdate(t.s, runner, t.d)).toEqual({ kind: "current" });
    expect(t.order).toEqual([]);
  });

  test("setting off: held orgOff, status says so, no notification, clone untouched", async () => {
    const t = setup();
    t.state.autoUpdate = false;
    const out = await runDevAutoUpdate(t.s, runner, t.d);
    expect(out).toMatchObject({ kind: "held", version: "2.23.0", hold: "orgOff" });
    expect(t.statuses).toEqual([{ offeredVersion: "2.23.0", heldVersion: null, hold: "orgOff" }]);
    expect(t.notices).toEqual([]);
    expect(t.checked()).toBe(0);
  });

  test.each(["notOnMain", "localCommits", "dirtyTree", "mergeInProgress", "fetchFailed"] as const)(
    "clone hold %s: nothing is pulled, built or swapped; one notification",
    async (hold) => {
      const t = setup();
      t.state.clone = { ok: false, hold, detail: "Your clone has uncommitted changes." };
      const out = await runDevAutoUpdate(t.s, runner, t.d);
      expect(out).toEqual({ kind: "held", version: "2.23.0", hold, detail: "Your clone has uncommitted changes." });
      expect(t.order).toEqual(["fetch"]);
      expect(t.notices).toEqual([["2.23.0", hold, "Your clone has uncommitted changes."]]);
      expect(t.statuses).toEqual([{ offeredVersion: "2.23.0", heldVersion: "2.23.0", hold }]);
    },
  );

  test("a busy daemon holds after the clone passes", async () => {
    const t = setup();
    t.state.busy = true;
    expect(await runDevAutoUpdate(t.s, runner, t.d)).toMatchObject({ kind: "held", hold: "daemonBusy" });
    expect(t.order).toEqual(["fetch"]);
  });

  test("a daemon that does not answer does not hold", async () => {
    const t = setup();
    t.d.daemonBusy = async () => false;
    expect(await runDevAutoUpdate(t.s, runner, t.d)).toEqual({ kind: "updated", version: "2.23.0" });
  });

  test("all clear: fast-forward, install, helper, register, then swap, then restart, in that order", async () => {
    const t = setup();
    expect(await runDevAutoUpdate(t.s, runner, t.d)).toEqual({ kind: "updated", version: "2.23.0" });
    expect(t.order).toEqual(["fetch", "tools", "ff", "install", "ui", "apps", "register", "swap", "restart"]);
  });

  test("a failed install is held updateFailed naming bun install, and the app is not swapped", async () => {
    const t = setup();
    t.state.installExit = 1;
    const out = await runDevAutoUpdate(t.s, runner, t.d);
    expect(out).toMatchObject({ kind: "held", hold: "updateFailed" });
    expect((out as { detail: string }).detail).toContain("bun install");
    expect(t.order).not.toContain("swap");
    expect(t.order).not.toContain("restart");
  });

  test("a served app that does not build is held updateFailed naming it, and the app is not swapped", async () => {
    const t = setup({ appBuildFails: true });
    const out = await runDevAutoUpdate(t.s, runner, t.d);
    expect(out).toMatchObject({ kind: "held", hold: "updateFailed" });
    expect((out as { detail: string }).detail).toContain("console");
    expect(t.order).not.toContain("swap");
  });

  test("a missing tool is held before the fast-forward", async () => {
    const t = setup({ originGo: "1.27.0" });
    const out = await runDevAutoUpdate(t.s, runner, t.d);
    expect(out).toMatchObject({ kind: "held", hold: "updateFailed" });
    expect((out as { detail: string }).detail).toContain("go 1.27.0");
    expect(t.order).not.toContain("ff");
  });

  test("a run while another holds the lock returns locked and does nothing", async () => {
    const t = setup();
    t.d.lock = async () => "locked";
    expect(await runDevAutoUpdate(t.s, runner, t.d)).toBe("locked");
    expect(t.order).toEqual([]);
  });

  test("an update clears the held status", async () => {
    const t = setup();
    await runDevAutoUpdate(t.s, runner, t.d);
    expect(t.statuses.at(-1)).toEqual({ offeredVersion: "2.23.0", heldVersion: null, hold: null });
  });
});

describe("createNotifyOnce", () => {
  function store() {
    const kv = new Map<string, string>();
    const sent: Array<{ title: string; message: string; id: string }> = [];
    const notifyOnce = createNotifyOnce({
      read: () => kv.get("announced") ?? null,
      write: (v) => { kv.set("announced", v); },
      notify: (n) => { sent.push(n); },
    });
    return { notifyOnce, sent };
  }

  test("a second run for the same version and hold does not notify again", () => {
    const { notifyOnce, sent } = store();
    notifyOnce("2.23.0", "dirtyTree", "Your clone has uncommitted changes.");
    notifyOnce("2.23.0", "dirtyTree", "Your clone has uncommitted changes.");
    expect(sent).toEqual([{
      title: "A mattstack update is waiting",
      message: "mattstack-dev 2.23.0 is ready. Your clone has uncommitted changes.",
      id: "dev_update:2.23.0:dirtyTree",
    }]);
  });

  test("holds that alternate for one version notify once each", () => {
    const { notifyOnce, sent } = store();
    notifyOnce("2.23.0", "daemonBusy", "a");
    notifyOnce("2.23.0", "updateFailed", "b");
    notifyOnce("2.23.0", "daemonBusy", "a");
    notifyOnce("2.23.0", "updateFailed", "b");
    expect(sent.map((n) => n.id)).toEqual(["dev_update:2.23.0:daemonBusy", "dev_update:2.23.0:updateFailed"]);
  });

  test("a new version starts afresh", () => {
    const { notifyOnce, sent } = store();
    notifyOnce("2.23.0", "dirtyTree", "a");
    notifyOnce("2.24.0", "dirtyTree", "a");
    notifyOnce("2.23.0", "dirtyTree", "a");
    expect(sent.map((n) => n.id)).toEqual(["dev_update:2.23.0:dirtyTree", "dev_update:2.24.0:dirtyTree", "dev_update:2.23.0:dirtyTree"]);
  });

  test("a different hold for the same version notifies once more", () => {
    const { notifyOnce, sent } = store();
    notifyOnce("2.23.0", "dirtyTree", "a");
    notifyOnce("2.23.0", "notOnMain", "b");
    notifyOnce("2.23.0", "notOnMain", "b");
    expect(sent.map((n) => n.id)).toEqual(["dev_update:2.23.0:dirtyTree", "dev_update:2.23.0:notOnMain"]);
  });
});
