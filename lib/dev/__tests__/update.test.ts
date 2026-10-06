import { describe, expect, test } from "bun:test";
import { basename } from "path";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { DevSeams, StageRunner } from "../seams.ts";
import { runDevUpdate, rtUiStale } from "../update.ts";

const CLONE = "/Users/collab/Documents/GitHub/mattstack";
const BUN = "/Users/collab/.bun/bin/bun";
const GO = "/opt/homebrew/bin/go";
const runner: StageRunner = async (_t, task) => task({ sub: () => {}, pause: (fn) => fn() });

function seams(opts: { flavor?: "dev" | "prod"; source?: string | null; uiBinary?: boolean; newerUnderUi?: boolean; installedVersion?: string; releaseBuild?: boolean }) {
  const files: Record<string, string> = {
    [`${CLONE}/package.json`]: JSON.stringify({ packageManager: "bun@1.4.2" }),
    [`${CLONE}/ui/go.mod`]: "go 1.26.5\n",
    "/usr/bin/git": "",
    [BUN]: "",
    [GO]: "",
    "/Applications/mattstack-dev.app/Contents/Info.plist": "",
  };
  if (opts.uiBinary !== false) files[`${CLONE}/ui/dist/rt-ui`] = "";
  const uiBuilds: { cwd?: string; path?: string }[] = [];
  const probes = fakeProbes({
    home: "/Users/collab",
    env: { PATH: "/usr/bin" },
    files,
    fetch: async () => ({ status: 200, headers: {}, body: "abc123  mattstack-dev-2.23.0.zip\n" }),
    exec: (argv, execOpts) => {
      const a = argv.join(" ");
      if (a === `${BUN} run ui:build`) uiBuilds.push({ cwd: execOpts?.cwd, path: execOpts?.env?.PATH });
      if (a === "/usr/bin/git --version") return { code: 0, stdout: "git version 2.50.1", stderr: "" };
      if (a === `${BUN} --version`) return { code: 0, stdout: "1.4.2", stderr: "" };
      if (a === `${GO} version`) return { code: 0, stdout: "go version go1.26.5 darwin/arm64", stderr: "" };
      if (argv[0] === "find") return { code: 0, stdout: opts.newerUnderUi ? `${CLONE}/ui/cmd/rt-ui/main.go\n` : "", stderr: "" };
      if (a.includes("CFBundleShortVersionString")) return { code: 0, stdout: `${opts.installedVersion ?? "2.22.0"}\n`, stderr: "" };
      if (a.includes("MSDevReleaseBuild")) return opts.releaseBuild === false ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: "true\n", stderr: "" };
      if (a.includes("api repos/m4ttstack/mattstack/releases")) {
        return {
          code: 0,
          stderr: "",
          stdout: JSON.stringify([
            {
              tag_name: "v2.23.0",
              draft: false,
              prerelease: false,
              assets: [
                { name: "mattstack-dev-2.23.0.zip", browser_download_url: "https://dl/z" },
                { name: "SHA256SUMS", browser_download_url: "https://dl/s" },
              ],
            },
          ]),
        };
      }
      if (argv[0] === "shasum") return { code: 0, stdout: "abc123  x\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const swapCmds: string[] = [];
  const s: DevSeams = {
    probes,
    swap: {
      exec: async (argv) => {
        swapCmds.push(argv.join(" "));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      sleep: async () => {},
    },
    download: async () => {},
    scratchDir: () => "/scratch",
    flavor: opts.flavor ?? "dev",
    interactive: false,
    prodVersion: "dev",
    confirm: async () => false,
    repoRoot: () => "/Users/collab/Documents/GitHub",
    storedSourcePath: () => (opts.source === undefined ? CLONE : opts.source),
    saveSourcePath: () => {},
    installDevTool: async () => ({ via: "vendor", ok: true, detail: "" }),
    gh: () => ["gh"],
    devWrapperOwnsRt: () => true,
  };
  return { s, probes, swapCmds, uiBuilds };
}

describe("runDevUpdate", () => {
  test("from prod: refuses, pointing at setup", async () => {
    const { s } = seams({ flavor: "prod" });
    await expect(runDevUpdate(s, runner)).rejects.toMatchObject({ code: "dev-not-set-up", next: "rt dev setup" });
  });

  test("on dev with no stored clone: refuses, pointing at setup", async () => {
    const { s } = seams({ source: null });
    await expect(runDevUpdate(s, runner)).rejects.toMatchObject({ code: "dev-not-set-up", next: "rt dev setup" });
  });

  test("swaps in a newer release dev app, then re-registers the apps", async () => {
    const { s, probes, swapCmds } = seams({});
    const r = await runDevUpdate(s, runner);
    expect(r.stages.map((x) => x.status)).toEqual(["done", "skipped", "done", "done"]);
    expect(swapCmds.some((c) => c.startsWith("ditto") && c.endsWith("/Applications/mattstack-dev.app"))).toBe(true);
    expect(probes.calls.exec.map((a) => a.join(" "))).toContain(`/Applications/mattstack-dev.app/Contents/Helpers/deck register --dir ${CLONE}/apps/board`);
  });

  test("a stale rt-ui binary is rebuilt with bun", async () => {
    const { s, uiBuilds } = seams({ newerUnderUi: true });
    const r = await runDevUpdate(s, runner);
    expect(r.stages[1]!.status).toBe("done");
    expect(uiBuilds).toEqual([{ cwd: CLONE, path: "/opt/homebrew/bin:/Users/collab/.bun/bin:/usr/bin" }]);
  });

  test("a locally built dev app is left alone", async () => {
    const { s, swapCmds } = seams({ releaseBuild: false });
    const r = await runDevUpdate(s, runner);
    expect(r.stages[2]!.status).toBe("skipped");
    expect(swapCmds).toEqual([]);
  });

  test("never pulls, rebases or checks out the clone", async () => {
    const { s, probes } = seams({});
    await runDevUpdate(s, runner);
    const gitCalls = probes.calls.exec.filter((a) => basename(a[0]!) === "git");
    expect(gitCalls.length).toBeGreaterThan(0);
    const changing = ["pull", "rebase", "checkout", "fetch", "reset", "switch", "merge", "stash"];
    expect(gitCalls.filter((a) => changing.some((v) => a.includes(v)))).toEqual([]);
  });
});

describe("rtUiStale", () => {
  test("missing binary is stale", async () => expect(await rtUiStale(seams({ uiBinary: false }).s, CLONE)).toBe(true));
  test("a newer source file is stale", async () => expect(await rtUiStale(seams({ newerUnderUi: true }).s, CLONE)).toBe(true));
  test("fresh is not stale", async () => expect(await rtUiStale(seams({}).s, CLONE)).toBe(false));
});
