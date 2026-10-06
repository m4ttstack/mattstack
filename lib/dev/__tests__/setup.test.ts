import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { DevSeams, StageRunner } from "../seams.ts";
import { runDevSetup } from "../setup.ts";
import { isMattstackRemote } from "../stages.ts";

const HOME = "/Users/collab";
const ROOT = `${HOME}/Documents/GitHub`;
const CLONE = `${ROOT}/mattstack`;
const BUN = `${HOME}/.bun/bin/bun`;
const GO = "/opt/homebrew/bin/go";
const GH = ["/Applications/mattstack.app/Contents/Helpers/gh"];
const PINS = { pkg: JSON.stringify({ packageManager: "bun@1.4.2" }), goMod: "go 1.26.5\n" };
const SHA = "abc123";

/** Records pause() calls so a test can prove every prompt ran with the step off screen. */
function recordingRunner() {
  const paused: string[] = [];
  const runner: StageRunner = async (title, task) =>
    task({
      sub: () => {},
      pause: async (fn) => {
        paused.push(title);
        return fn();
      },
    });
  return { runner, paused };
}
const runner = recordingRunner().runner;

interface World {
  clone?: "ours" | "empty" | "other";
  pushAccess?: string;
  ghLoggedIn?: boolean;
  repoRoot?: string | null;
  bun?: string;
  interactive?: boolean;
  confirm?: boolean;
  online?: boolean;
  takeoverAfterOpen?: boolean;
  flavor?: "dev" | "prod";
  wrapperOwns?: boolean;
  stored?: string | null;
  noDevZip?: boolean;
}

function world(w: World = {}) {
  const files: Record<string, string> = { "/usr/bin/git": "", [GO]: "", "/opt/homebrew/bin/node": "" };
  if (w.bun !== "missing") files[BUN] = "";
  const dirs: Record<string, string[]> = {};
  if (w.clone === "ours" || w.clone === "other") {
    files[`${CLONE}/package.json`] = PINS.pkg;
    files[`${CLONE}/ui/go.mod`] = PINS.goMod;
    dirs[CLONE] = ["package.json", "ui"];
  }
  if (w.clone === "empty") dirs[CLONE] = [];
  let opened = false;
  const saved: Array<[string, string]> = [];
  const installs: string[] = [];
  const probes = fakeProbes({
    home: HOME,
    env: { PATH: "/usr/bin" },
    files,
    dirs,
    fetch: async (url) =>
      w.online === false
        ? { status: 0, body: "", headers: {} }
        : url.endsWith("package.json")
          ? { status: 200, body: PINS.pkg, headers: {} }
          : url.endsWith("go.mod")
            ? { status: 200, body: PINS.goMod, headers: {} }
            : { status: 200, body: `${SHA}  mattstack-dev-2.22.0.zip\n`, headers: {} },
    exec: (argv) => {
      const a = argv.join(" ");
      if (a === "/usr/bin/git --version") return { code: 0, stdout: "git version 2.50.1", stderr: "" };
      if (a === `${BUN} --version`) return { code: 0, stdout: w.bun ?? "1.4.2", stderr: "" };
      if (a === `${GO} version`) return { code: 0, stdout: "go version go1.26.5 darwin/arm64", stderr: "" };
      if (a === "/opt/homebrew/bin/node --version") return { code: 0, stdout: "v22.0.0", stderr: "" };
      if (a.endsWith("auth status")) return { code: w.ghLoggedIn === false ? 1 : 0, stdout: "", stderr: "" };
      if (a.includes("--jq .permissions.push")) return { code: 0, stdout: `${w.pushAccess ?? "true"}\n`, stderr: "" };
      if (a.includes("api repos/m4ttstack/mattstack/releases")) {
        const list = w.noDevZip
          ? []
          : [
              {
                tag_name: "v2.22.0",
                draft: false,
                prerelease: false,
                assets: [
                  { name: "mattstack-dev-2.22.0.zip", browser_download_url: "https://dl/z" },
                  { name: "SHA256SUMS", browser_download_url: "https://dl/s" },
                ],
              },
            ];
        return { code: 0, stderr: "", stdout: JSON.stringify(list) };
      }
      if (a === `git -C ${CLONE} remote get-url origin`) {
        return { code: 0, stdout: w.clone === "other" ? "https://github.com/someone/else.git\n" : "https://github.com/m4ttstack/mattstack.git\n", stderr: "" };
      }
      if (a.startsWith("shasum")) return { code: 0, stdout: `${SHA}  x\n`, stderr: "" };
      if (a.includes("/usr/bin/open")) {
        opened = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const seams: DevSeams = {
    probes,
    swap: { exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), sleep: async () => {} },
    download: async () => {},
    scratchDir: () => "/scratch",
    flavor: w.flavor ?? "prod",
    interactive: w.interactive ?? true,
    prodVersion: "2.22.0",
    confirm: async () => w.confirm ?? true,
    repoRoot: () => (w.repoRoot === undefined ? ROOT : w.repoRoot),
    storedSourcePath: () => w.stored ?? null,
    saveSourcePath: (sp, bp) => {
      saved.push([sp, bp]);
    },
    installDevTool: async (tool, version) => {
      installs.push(`${tool}@${version}`);
      return { via: "vendor", ok: true, detail: "ok" };
    },
    gh: () => GH,
    devWrapperOwnsRt: () => (w.wrapperOwns ?? false) || (opened && (w.takeoverAfterOpen ?? true)),
  };
  return { seams, probes, saved, installs };
}

const cmds = (p: ReturnType<typeof world>["probes"]) => p.calls.exec.map((a) => a.join(" "));
const cloned = (p: ReturnType<typeof world>["probes"]) => cmds(p).some((c) => c.startsWith("git clone"));

describe("runDevSetup", () => {
  test("a fresh prod Mac: clones, builds, stores the source, installs and opens the dev app, registers apps", async () => {
    const { seams, probes, saved } = world();
    const r = await runDevSetup(seams, runner);
    expect(r.kind).toBe("done");
    expect(cmds(probes)).toContain(`git clone https://github.com/m4ttstack/mattstack.git ${CLONE}`);
    expect(cmds(probes)).toContain(`${BUN} install`);
    expect(cmds(probes)).toContain(`${BUN} run ui:build`);
    expect(saved).toEqual([[CLONE, BUN]]);
    expect(cmds(probes).some((c) => c.includes("/usr/bin/open /Applications/mattstack-dev.app"))).toBe(true);
    for (const app of ["board", "console", "chat", "boxscore", "deck"]) {
      expect(cmds(probes)).toContain(`/Applications/mattstack-dev.app/Contents/Helpers/deck register --dir ${CLONE}/apps/${app}`);
    }
  });

  test("the changing stages run only after every check passes, in order", async () => {
    const titles: string[] = [];
    const { seams } = world();
    const order: StageRunner = async (title, task) => {
      titles.push(title);
      return task({ sub: () => {}, pause: (fn) => fn() });
    };
    await runDevSetup(seams, order);
    expect(titles).toEqual([
      "Check your tools",
      "Check you can push to mattstack",
      "Find the dev app",
      "Clone mattstack",
      "Build your clone",
      "Point rt at your clone",
      "Install the dev app",
      "Switch to the dev app",
      "Serve the apps from your clone",
    ]);
  });

  test("already on dev with the wrapper: reports already set up before reading anything else", async () => {
    const { seams, probes } = world({ flavor: "dev", wrapperOwns: true, stored: CLONE, repoRoot: null });
    expect(await runDevSetup(seams, runner)).toEqual({ kind: "already", clone: CLONE });
    expect(probes.calls.exec).toEqual([]);
  });

  test("no repo root: refuses before cloning (Review Focus 1)", async () => {
    const { seams, probes } = world({ repoRoot: null });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-no-repo-root", next: "rt setup repo-root set <folder>" });
    expect(cloned(probes)).toBe(false);
  });

  test("an existing mattstack clone is reused untouched (Review Focus 2)", async () => {
    const { seams, probes } = world({ clone: "ours" });
    await runDevSetup(seams, runner);
    expect(cloned(probes)).toBe(false);
    expect(cmds(probes).some((c) => /git (-C \S+ )?(checkout|pull|reset|fetch)/.test(c))).toBe(false);
  });

  test("an empty folder at the clone path is cloned into", async () => {
    const { seams, probes } = world({ clone: "empty" });
    await runDevSetup(seams, runner);
    expect(cloned(probes)).toBe(true);
  });

  test("a folder holding something else is a refusal", async () => {
    const { seams, probes } = world({ clone: "other" });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-clone-path-taken" });
    expect(cloned(probes)).toBe(false);
  });

  test("no push access refuses before cloning", async () => {
    const { seams, probes } = world({ pushAccess: "false" });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-no-push-access" });
    expect(cloned(probes)).toBe(false);
  });

  test("no release with a dev app refuses before cloning", async () => {
    const { seams, probes } = world({ noDevZip: true });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-no-dev-zip" });
    expect(cloned(probes)).toBe(false);
  });

  test("not logged in to GitHub, non-interactive: refuses naming gh auth login", async () => {
    const { seams } = world({ ghLoggedIn: false, interactive: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-gh-login", next: `${GH[0]} auth login` });
  });

  test("not logged in, interactive: the login runs with the step paused", async () => {
    const { seams, probes } = world({ ghLoggedIn: false });
    const { runner: r, paused } = recordingRunner();
    await expect(runDevSetup(seams, r)).rejects.toMatchObject({ code: "dev-gh-login" });
    expect(paused).toContain("Check you can push to mattstack");
    expect(cmds(probes)).toContain(`${GH[0]} auth login --git-protocol https --web`);
  });

  test("missing bun, non-interactive: refuses with the install command, installs nothing", async () => {
    const { seams, installs } = world({ bun: "missing", interactive: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-tool-missing", next: "curl -fsSL https://bun.sh/install | bash -s bun-v1.4.2" });
    expect(installs).toEqual([]);
  });

  test("missing bun, interactive but declined: refuses with the install command, installs nothing", async () => {
    const { seams, installs } = world({ bun: "missing", confirm: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-tool-missing", next: "curl -fsSL https://bun.sh/install | bash -s bun-v1.4.2" });
    expect(installs).toEqual([]);
  });

  test("too-old bun, interactive and accepted: asks with the step paused, installs the pinned version", async () => {
    const { seams, installs } = world({ bun: "1.3.0" });
    const { runner: r, paused } = recordingRunner();
    // the fake still reports 1.3.0 after the install, so the post-install re-probe fails loudly
    await expect(runDevSetup(seams, r)).rejects.toMatchObject({ code: "dev-tool-install-failed" });
    expect(installs).toEqual(["bun@1.4.2"]);
    expect(paused).toContain("Check your tools");
  });

  test("offline before the clone: plain error, nothing changed (Review Focus 5)", async () => {
    const { seams, probes } = world({ online: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-pins-unreadable" });
    expect(probes.calls.exec).toEqual([]);
  });

  test("the dev app never takes over: times out pointing back at prod", async () => {
    const { seams } = world({ takeoverAfterOpen: false });
    await expect(runDevSetup(seams, runner)).rejects.toMatchObject({ code: "dev-switch-timeout", next: "open /Applications/mattstack.app" });
  });
});

describe("isMattstackRemote", () => {
  test("https and ssh forms", () => {
    expect(isMattstackRemote("https://github.com/m4ttstack/mattstack.git")).toBe(true);
    expect(isMattstackRemote("git@github.com:m4ttstack/mattstack.git")).toBe(true);
    expect(isMattstackRemote("https://github.com/m4ttstack/mattstack")).toBe(true);
    expect(isMattstackRemote("https://github.com/someone/mattstack.git")).toBe(false);
  });
});
