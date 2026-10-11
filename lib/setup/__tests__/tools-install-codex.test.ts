import { describe, test, expect } from "bun:test";
import { join } from "path";
import testedVersions from "../../../scripts/acceptance/tested-versions.json";
import { RELEASE_INSTALLERS, installTool, type ToolsInstallSeams } from "../tools-install.ts";
import { fakeProbes, ok, missing, type ExecScript } from "./fakes.ts";
import { setupStatePath } from "../state.ts";
import type { ExecResult, Probes } from "../probes.ts";

const HOME = "/Users/member";
const TMP = "/private/var/folders/xx/T";
const DEST = join(HOME, ".local", "bin", "codex");
const PINNED = RELEASE_INSTALLERS.codex!;

const SEAMS: ToolsInstallSeams = {
  resolveTool: (_p, tool) => ({ tool, bundled: null, exec: null, userCopy: null, linked: false, chosen: null }),
  detectEditors: () => [],
  findVsix: () => null,
  bundledToolExec: () => null,
  link: () => {
    throw new Error("link() should not be called for codex");
  },
};

type Overrides = Partial<Record<"uname" | "curl" | "sha" | "installer" | "verify" | "brew", ExecResult>>;
type ExecOpts = Parameters<Probes["exec"]>[1];

function codexInstallMac(overrides: Overrides = {}) {
  const opts: Array<{ argv: string[]; opts: ExecOpts }> = [];
  const exec: ExecScript = (argv, execOpts) => {
    opts.push({ argv, opts: execOpts });
    const [cmd] = argv;
    if (cmd === "uname") return overrides.uname ?? ok("arm64\n");
    if (cmd === "brew") return overrides.brew ?? ok("Homebrew 4.0.0");
    if (cmd === "curl") return overrides.curl ?? ok();
    if (cmd === "shasum") return overrides.sha ?? ok(`${PINNED.sha256}  ${argv.at(-1)}\n`);
    if (cmd === "sh") return overrides.installer ?? ok("Codex CLI 0.160.0 installed\n");
    if (cmd === DEST) return overrides.verify ?? ok("codex-cli 0.160.0\n");
    return missing(cmd ?? "");
  };
  const p = fakeProbes({ home: HOME, env: { TMPDIR: TMP }, exec });
  return Object.assign(p, { execOpts: opts });
}

const ON = { releases: true };
const commands = (calls: string[][]) => calls.map((argv) => argv[0]);
const installerPath = (p: ReturnType<typeof codexInstallMac>) => p.calls.exec.find((a) => a[0] === "curl")!.at(-1)!;

describe("RELEASE_INSTALLERS — OpenAI's pinned Codex installer", () => {
  test("carries the exact pinned values", () => {
    expect(PINNED).toEqual({
      version: "0.160.0",
      url: "https://github.com/openai/codex/releases/download/rust-v0.160.0/install.sh",
      sha256: "150e3cf675682efeaac115aa3747add3f27887896d04ce6d0b56478d8b428bf6",
      name: "Codex",
      env: { CODEX_NON_INTERACTIVE: "true" },
    });
  });

  test("the pinned release is the newest Codex the acceptance matrix tested, and the URL names it", () => {
    const tested = [...testedVersions.harnesses.codex.versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    expect(PINNED.version).toBe(tested.at(-1)!);
    expect(PINNED.url).toContain(`/rust-v${PINNED.version}/`);
  });
});

describe("installTool — codex with OpenAI's installer", () => {
  test("downloads the installer over https, checks its checksum, runs it pinned and non-interactive, then re-probes ~/.local/bin/codex", async () => {
    const p = codexInstallMac();
    const result = await installTool(p, "codex", [], SEAMS, ON);

    expect(result).toEqual({ via: "vendor", ok: true, detail: "Installed Codex 0.160.0 with OpenAI's installer" });
    const path = installerPath(p);
    expect(path.startsWith(join(TMP, "rt-vendor-install"))).toBe(true);
    expect(p.calls.exec.find((a) => a[0] === "curl")).toEqual(["curl", "-fsSL", "--proto", "=https", "--proto-redir", "=https", PINNED.url, "-o", path]);
    expect(p.calls.exec.find((a) => a[0] === "shasum")).toEqual(["shasum", "-a", "256", path]);

    const run = p.execOpts.find((c) => c.argv[0] === "sh")!;
    expect(run.argv).toEqual(["sh", path, "--release", "0.160.0"]);
    expect(run.opts?.env).toEqual({ CODEX_NON_INTERACTIVE: "true" });

    const order = commands(p.calls.exec);
    expect(order).toEqual(["uname", "curl", "shasum", "sh", DEST]);
    expect(p.calls.exec.at(-1)).toEqual([DEST, "--version"]);
  });

  test("the download folder is cleared before and removed after", async () => {
    const p = codexInstallMac();
    await installTool(p, "codex", [], SEAMS, ON);
    const work = join(TMP, "rt-vendor-install", "codex-release");
    expect(installerPath(p).startsWith(`${work}/`)).toBe(true);
    expect(p.calls.removed.filter((r) => r === work)).toHaveLength(2);
  });

  test("never brew, npm or a shell string, even with Homebrew present", async () => {
    const p = codexInstallMac();
    await installTool(p, "codex", [], SEAMS, ON);
    for (const argv of p.calls.exec) {
      expect(["brew", "npm", "bash", "zsh"]).not.toContain(argv[0]!);
      expect(argv).not.toContain("-c");
      for (const arg of argv) expect(arg).not.toContain("|");
    }
  });

  test("writes no setup-state record: the installer owns ~/.local/bin/codex and ~/.codex/packages", async () => {
    const p = codexInstallMac();
    await installTool(p, "codex", [], SEAMS, ON);
    expect(Object.keys(p.calls.writes)).not.toContain(setupStatePath(HOME));
    expect(p.calls.renames).toEqual([]);
  });

  test("a checksum mismatch deletes the installer and never runs it", async () => {
    const p = codexInstallMac({ sha: ok(`${"0".repeat(64)}  install.sh\n`) });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "Codex's installer did not match its expected checksum, so rt deleted it" });
    expect(p.calls.removed).toContain(installerPath(p));
    expect(commands(p.calls.exec)).not.toContain("sh");
  });

  test("a checksum check that cannot run deletes the installer too", async () => {
    const p = codexInstallMac({ sha: { code: 1, stdout: "", stderr: "shasum: boom" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result.ok).toBe(false);
    expect(p.calls.removed).toContain(installerPath(p));
    expect(commands(p.calls.exec)).not.toContain("sh");
  });

  test("a failed download is honest and nothing after it runs", async () => {
    const p = codexInstallMac({ curl: { code: 22, stdout: "", stderr: "curl: (22) The requested URL returned error: 404" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "Downloading Codex's installer failed (exit 22): curl: (22) The requested URL returned error: 404" });
    expect(commands(p.calls.exec)).not.toContain("shasum");
  });

  test("a download that times out is honest", async () => {
    const p = codexInstallMac({ curl: { code: 124, stdout: "", stderr: "" } });
    expect(await installTool(p, "codex", [], SEAMS, ON)).toEqual({ via: "vendor", ok: false, detail: "Downloading Codex's installer did not finish in time" });
  });

  test("a failed installer is honest and nothing is claimed installed", async () => {
    const p = codexInstallMac({ installer: { code: 1, stdout: "", stderr: "error: could not download codex-package\nmore" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "Codex's installer failed (exit 1): error: could not download codex-package" });
    expect(commands(p.calls.exec)).not.toContain(DEST);
  });

  test("an installer that does not finish in time is honest", async () => {
    const p = codexInstallMac({ installer: { code: 124, stdout: "", stderr: "" } });
    expect(await installTool(p, "codex", [], SEAMS, ON)).toEqual({ via: "vendor", ok: false, detail: "Codex's installer did not finish in time" });
  });

  test("a codex that does not run after the installer is not claimed installed", async () => {
    const p = codexInstallMac({ verify: { code: 127, stdout: "", stderr: "ENOENT" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: `Codex's installer finished, but ${DEST} does not run (exit 127)` });
  });

  test("a codex that reports another version is not claimed installed", async () => {
    const p = codexInstallMac({ verify: ok("codex-cli 0.161.2\n") });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: `Codex's installer finished, but ${DEST} reports codex-cli 0.161.2, not 0.160.0` });
  });

  test("an Intel Mac is refused before anything downloads", async () => {
    const p = codexInstallMac({ uname: ok("x86_64\n") });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "rt installs Codex only on Apple silicon, and this Mac is x86_64" });
    expect(commands(p.calls.exec)).toEqual(["uname"]);
  });

  test("a processor check that cannot run is refused too", async () => {
    const p = codexInstallMac({ uname: { code: 1, stdout: "", stderr: "" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "rt could not read this Mac's processor type" });
    expect(commands(p.calls.exec)).toEqual(["uname"]);
  });

  for (const [label, opts] of [["switched off", { releases: false }], ["not opted in", undefined]] as const) {
    test(`release installers ${label}: codex has no install method, as before they existed`, async () => {
      const p = codexInstallMac({ brew: missing("brew") });
      await expect(installTool(p, "codex", [], SEAMS, opts)).rejects.toThrow("no install method known for codex");
      expect(commands(p.calls.exec)).toEqual(["brew"]);
    });
  }
});
