import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BUNDLED_VSIX_FILES, VENDOR_INSTALLERS, VSIX_NOT_FOUND_DETAIL, claudeConfigDirs, findBundledVsixes, installRoute, installTool, parseCltLabel, setupTool, type ToolsInstallSeams } from "../tools-install.ts";
import { detectEditors } from "../../editors.ts";
import { processFlavor } from "../../flavor.ts";
import { DEV_TRAY_APP_BUNDLE, TRAY_APP_BUNDLE } from "../../rt-paths.ts";
import { fakeProbes, ok, missing } from "./fakes.ts";
import type { ExecScript } from "./fakes.ts";
import type { PackRequirements } from "../requirements.ts";
import type { ToolResolution } from "../../deps/resolve.ts";
import type { LinkOutcome } from "../../deps/links.ts";
import type { DetectedEditor } from "../../editors.ts";
import { UserActionableError } from "../../errors.ts";
import { readSetupState, updateSetupState } from "../state.ts";

function noopResolution(tool: string): ToolResolution {
  return { tool, bundled: null, exec: null, userCopy: null, linked: false, chosen: null };
}

/** No bundled tool, no editors, real resolveTool/link never invoked — the safe default for a test that only cares about one branch. */
const NOOP_SEAMS: ToolsInstallSeams = {
  resolveTool: (_p, tool) => noopResolution(tool),
  detectEditors: () => [],
  findVsixes: () => [],
  bundledToolExec: () => null,
  link: () => {
    throw new Error("link() should not be called in this test");
  },
};

describe("installTool — tool.herdr / tool.claude (vendor installers, never brew)", () => {
  test("herdr with brew present still runs herdr's own installer and never brew", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "brew" && argv[1] === "--version" ? ok("4.0.0") : ok());
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);
    expect(p.calls.exec.some((argv) => argv[0] === "brew")).toBe(false);
    expect(result).toEqual({ via: "vendor", ok: true, detail: "installed via vendor script" });
  });

  test("herdr without brew -> fetches the URL as its own argv element (curl -o), then runs the downloaded file as an argv step (never sh -c)", async () => {
    const exec: ExecScript = (argv) => {
      if (argv[0] === "brew" && argv[1] === "--version") return missing("brew");
      if (argv[0] === "curl") return ok();
      if (argv[0] === "sh") return ok();
      if (argv[0] === "herdr" && argv[1] === "--version") return ok("0.8.0");
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);

    const fetchCall = p.calls.exec.find((argv) => argv[0] === "curl");
    expect(fetchCall).toBeDefined();
    expect(fetchCall).toEqual(["curl", "-fsSL", VENDOR_INSTALLERS.herdr!.url, "-o", fetchCall![4]!]);

    const runCall = p.calls.exec.find((argv) => argv[0] === "sh");
    expect(runCall).toBeDefined();
    expect(runCall).toEqual(["sh", fetchCall![4]!]);

    expect(result.via).toBe("vendor");
    expect(result.ok).toBe(true);
  });

  test("no exec call ever constructs a shell string (no 'sh -c', no pipe-to-shell) — argv only, every element", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "brew" && argv[1] === "--version" ? missing("brew") : ok());
    const p = fakeProbes({ exec });
    await installTool(p, "herdr", [], NOOP_SEAMS);
    for (const argv of p.calls.exec) {
      expect(argv).not.toContain("-c");
      for (const arg of argv) expect(arg).not.toContain("|");
    }
  });

  test("claude runs its installer under bash, as its docs do, and is checked in ~/.local/bin", async () => {
    const exec: ExecScript = () => ok();
    const p = fakeProbes({ exec });
    const result = await installTool(p, "claude", [], NOOP_SEAMS);
    const fetchCall = p.calls.exec.find((argv) => argv[0] === "curl");
    expect(fetchCall?.[2]).toBe("https://claude.ai/install.sh");
    expect(p.calls.exec).toContainEqual(["bash", fetchCall![4]!]);
    expect(p.calls.exec).toContainEqual([join(p.home, ".local", "bin", "claude"), "--version"]);
    expect(p.calls.exec.some((argv) => argv[0] === "brew" && argv[1] === "install")).toBe(false);
    expect(result).toEqual({ via: "vendor", ok: true, detail: "installed via vendor script" });
  });

  test("the installer exits 0 but ~/.local/bin/herdr still isn't runnable -> not claimed installed (re-probe, never trust exit code alone)", async () => {
    const exec: ExecScript = (argv) => (argv[1] === "--version" && argv[0]!.endsWith("/herdr") ? missing("herdr") : ok());
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("still does not run");
  });

  test("the installer exits non-zero -> error, not claimed installed", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "sh" ? { code: 1, stdout: "", stderr: "boom" } : ok());
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);
    expect(result).toEqual({ via: "vendor", ok: false, detail: expect.stringContaining("exit 1") });
  });
});

describe("installTool — a team's pinned download", () => {
  const armPin = { url: "https://example.com/doppler_darwin_arm64.tar.gz", sha256: "a".repeat(64), extract: "doppler" };
  const intelPin = { url: "https://example.com/doppler_darwin_amd64", sha256: "b".repeat(64), extract: "" };
  const reqsWith = (install: PackRequirements["tools"][number]["install"]): PackRequirements[] =>
    [{ pack: "somepack", integrations: [], tools: [{ name: "doppler", why: "reads secrets", install }] }];
  const seamsFor = (arch: "arm64" | "x86_64"): ToolsInstallSeams => ({ ...NOOP_SEAMS, hostArch: () => arch });
  const shaOk = (sha: string): ExecScript => (argv) => (argv[0] === "shasum" ? ok(`${sha}  ${argv[3]}\n`) : ok("3.0.0"));

  test("downloads this processor's pin, checks its sha256, unpacks it and installs it into ~/.local/bin", async () => {
    const p = fakeProbes({ exec: shaOk(armPin.sha256) });
    const result = await installTool(p, "doppler", reqsWith({ download: { arm64: armPin, x86_64: intelPin } }), seamsFor("arm64"));
    const curl = p.calls.exec.find((argv) => argv[0] === "curl")!;
    expect(curl.slice(0, 3)).toEqual(["curl", "-fsSL", armPin.url]);
    const file = curl[4]!;
    expect(p.calls.exec).toContainEqual(["shasum", "-a", "256", file]);
    const tar = p.calls.exec.find((argv) => argv[0] === "tar")!;
    expect(tar.slice(0, 3)).toEqual(["tar", "-xf", file]);
    const dest = join(p.home, ".local", "bin", "doppler");
    expect(p.calls.exec).toContainEqual(["install", "-m", "0755", join(tar[4]!, "doppler"), dest]);
    expect(p.calls.exec).toContainEqual([dest, "--version"]);
    expect(result).toEqual({ via: "download", ok: true, detail: "installed from the team's pinned download" });
  });

  test("an Intel Mac takes the x86_64 pin, and a pin with no extract installs the download itself", async () => {
    const p = fakeProbes({ exec: shaOk(intelPin.sha256) });
    const result = await installTool(p, "doppler", reqsWith({ download: { arm64: armPin, x86_64: intelPin } }), seamsFor("x86_64"));
    const curl = p.calls.exec.find((argv) => argv[0] === "curl")!;
    expect(curl[2]).toBe(intelPin.url);
    expect(p.calls.exec.some((argv) => argv[0] === "tar" || argv[0] === "ditto")).toBe(false);
    expect(p.calls.exec).toContainEqual(["install", "-m", "0755", curl[4]!, join(p.home, ".local", "bin", "doppler")]);
    expect(result.ok).toBe(true);
  });

  test("a sha256 that does not match installs nothing", async () => {
    const p = fakeProbes({ exec: shaOk("c".repeat(64)) });
    const result = await installTool(p, "doppler", reqsWith({ download: { arm64: armPin } }), seamsFor("arm64"));
    expect(result).toEqual({ via: "download", ok: false, detail: expect.stringContaining("did not match the team's pinned sha256") });
    expect(p.calls.exec.some((argv) => argv[0] === "tar" || argv[0] === "install")).toBe(false);
  });

  test("a failed download is honest and installs nothing", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "curl" ? { code: 22, stdout: "", stderr: "404" } : ok());
    const p = fakeProbes({ exec });
    const result = await installTool(p, "doppler", reqsWith({ download: { arm64: armPin } }), seamsFor("arm64"));
    expect(result).toEqual({ via: "download", ok: false, detail: expect.stringContaining("Downloading doppler failed") });
    expect(p.calls.exec.some((argv) => argv[0] === "shasum" || argv[0] === "install")).toBe(false);
  });

  test("installed, but the tool still does not run -> not claimed installed", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "shasum" ? ok(`${armPin.sha256}  x\n`) : argv[1] === "--version" ? missing("doppler") : ok());
    const p = fakeProbes({ exec });
    const result = await installTool(p, "doppler", reqsWith({ download: { arm64: armPin } }), seamsFor("arm64"));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("still does not run");
  });

  test("no pin for this processor sends the member to the pack's install link", async () => {
    const p = fakeProbes({ exec: shaOk(armPin.sha256) });
    await expect(installTool(p, "doppler", reqsWith({ url: "https://docs.example.com/install", download: { arm64: armPin } }), seamsFor("x86_64")))
      .rejects.toThrow(/Install it yourself: https:\/\/docs.example.com\/install/);
    expect(p.calls.exec.some((argv) => argv[0] === "curl")).toBe(false);
  });

  test("no pin for this processor and no link -> no-installer naming the processor", async () => {
    const p = fakeProbes({ exec: shaOk(armPin.sha256) });
    await expect(installTool(p, "doppler", reqsWith({ download: { arm64: armPin } }), seamsFor("x86_64"))).rejects.toThrow(/x86_64/);
  });

  test("no bundled tool, no pinned download, no vendor installer -> UserActionableError no-installer", async () => {
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: [], tools: [{ name: "mystery", why: "unlisted" }] }];
    const p = fakeProbes({ exec: () => ok() });
    await expect(installTool(p, "mystery", reqs, NOOP_SEAMS)).rejects.toThrow(UserActionableError);
  });
});

describe("installTool — vendor security (R-T21): team-authored URLs are never auto-executed; only rt's own hardcoded, allowlisted, https URLs run, and only argv-only, fetch-then-run", () => {
  const originalHerdr = VENDOR_INSTALLERS.herdr!;
  afterEach(() => {
    VENDOR_INSTALLERS.herdr = originalHerdr;
  });

  test("a team-declared install.url is refused, never executed, even if it contains shell metacharacters", async () => {
    const reqs: PackRequirements[] = [
      { pack: "somepack", integrations: [], tools: [{ name: "widget", why: "does widget things", install: { url: "https://evil.example.com/x.sh; rm -rf ~" } }] },
    ];
    const exec: ExecScript = (argv) => (argv[0] === "brew" && argv[1] === "--version" ? missing("brew") : ok());
    const p = fakeProbes({ exec });
    await expect(installTool(p, "widget", reqs, NOOP_SEAMS)).rejects.toThrow(UserActionableError);
    await expect(installTool(p, "widget", reqs, NOOP_SEAMS)).rejects.toThrow(/manual-install-required|Install it yourself/);
    expect(p.calls.exec.some((argv) => argv[0] === "curl" || argv[0] === "sh")).toBe(false);
  });

  test("a hardcoded vendor URL that isn't https is refused, never fetched", async () => {
    VENDOR_INSTALLERS.herdr = { ...originalHerdr, url: "http://herdr.dev/install.sh" };
    const exec: ExecScript = (argv) => (argv[0] === "brew" && argv[1] === "--version" ? missing("brew") : ok());
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);
    expect(result.via).toBe("vendor");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("https");
    expect(p.calls.exec.some((argv) => argv[0] === "curl")).toBe(false);
  });

  test("a hardcoded vendor URL on a host outside the known list is refused, never fetched", async () => {
    VENDOR_INSTALLERS.herdr = { ...originalHerdr, url: "https://evil.example.com/install.sh" };
    const exec: ExecScript = (argv) => (argv[0] === "brew" && argv[1] === "--version" ? missing("brew") : ok());
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);
    expect(result.via).toBe("vendor");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("evil.example.com");
    expect(p.calls.exec.some((argv) => argv[0] === "curl")).toBe(false);
  });

  test("a malformed URL is refused, never fetched", async () => {
    VENDOR_INSTALLERS.herdr = { ...originalHerdr, url: "not a url" };
    const exec: ExecScript = (argv) => (argv[0] === "brew" && argv[1] === "--version" ? missing("brew") : ok());
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);
    expect(result.ok).toBe(false);
    expect(p.calls.exec.some((argv) => argv[0] === "curl")).toBe(false);
  });

  test("curl fetch failure is honest and never runs the (partial/missing) downloaded file", async () => {
    const exec: ExecScript = (argv) => {
      if (argv[0] === "brew" && argv[1] === "--version") return missing("brew");
      if (argv[0] === "curl") return { code: 22, stdout: "", stderr: "404" };
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);
    expect(result).toEqual({ via: "vendor", ok: false, detail: expect.stringContaining("Downloading the install script failed") });
    expect(p.calls.exec.some((argv) => argv[0] === "sh")).toBe(false);
  });

  test("curl fetch timeout is honest, never claimed as a run", async () => {
    const exec: ExecScript = (argv) => {
      if (argv[0] === "brew" && argv[1] === "--version") return missing("brew");
      if (argv[0] === "curl") return { code: 124, stdout: "", stderr: "" };
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await installTool(p, "herdr", [], NOOP_SEAMS);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("did not finish in time");
    expect(p.calls.exec.some((argv) => argv[0] === "sh")).toBe(false);
  });
});

describe("installTool — bundled-link", () => {
  for (const reason of ["user-copy", "dev-mode-owns-rt", "occupied", "no-bundle"] as const) {
    test(`bundled link preserves ${reason} internally`, async () => {
      const p = fakeProbes();
      const result = await installTool(p, "gh", [], {
        ...NOOP_SEAMS,
        bundledToolExec: () => ["/bundle/Contents/Helpers/gh"],
        link: () => ({ ok: false, reason, detail: "left alone" }),
      });
      expect(result).toEqual({ via: "bundled-link", ok: false, detail: "left alone", reason });
      expect(p.calls.exec).toEqual([]);
    });
  }

  test("gh -> link via bundled-link", async () => {
    const seams: ToolsInstallSeams = {
      ...NOOP_SEAMS,
      bundledToolExec: (_p, tool) => (tool === "gh" ? ["/bundle/Contents/Helpers/gh"] : null),
      link: (_p, tool) => ({ ok: true, path: `/fake-home/.local/bin/${tool}`, state: "linked" }) as LinkOutcome,
    };
    const p = fakeProbes();
    const result = await installTool(p, "gh", [], seams);
    expect(result).toEqual({ via: "bundled-link", ok: true, detail: expect.stringContaining("/fake-home/.local/bin/gh") });
    // bundled-link takes priority over brew/vendor — no exec call for install at all.
    expect(p.calls.exec.some((argv) => argv[0] === "brew")).toBe(false);
  });

  test("gh bundled but link() refuses (occupied) -> honest failure", async () => {
    const seams: ToolsInstallSeams = {
      ...NOOP_SEAMS,
      bundledToolExec: () => ["/bundle/Contents/Helpers/gh"],
      link: () => ({ ok: false, reason: "occupied", detail: "already occupied" }) as LinkOutcome,
    };
    const p = fakeProbes();
    const result = await installTool(p, "gh", [], seams);
    expect(result).toEqual({ via: "bundled-link", ok: false, detail: "already occupied", reason: "occupied" });
  });
});

describe("installTool — apple-clt", () => {
  test("apple-clt already present (xcode-select -p + git both ok) -> ok without re-triggering anything", async () => {
    const exec: ExecScript = () => ok();
    const p = fakeProbes({ exec });
    const result = await installTool(p, "apple-clt", [], NOOP_SEAMS);
    expect(p.calls.exec).not.toContainEqual(["xcode-select", "--install"]);
    expect(result.via).toBe("apple-clt");
    expect(result.ok).toBe(true);
  });

  test("apple-clt headless: catalog label found -> softwareupdate -i, marker cleaned, no dialog", async () => {
    const exec: ExecScript = (argv) => {
      if (argv[0] === "xcode-select") return { code: 2, stdout: "", stderr: "no developer tools" };
      if (argv[0] === "softwareupdate" && argv[1] === "-l") {
        return ok("Software Update found:\n* Label: Command Line Tools for Xcode 26.5-26.5\n\tTitle: ...\n* Label: Command Line Tools for Xcode 26.6-26.6\n\tTitle: ...\n");
      }
      if (argv[0] === "git") return ok("git version 2.39.5 (Apple Git-154)");
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await installTool(p, "apple-clt", [], NOOP_SEAMS);
    expect(p.calls.exec).toContainEqual(["softwareupdate", "-i", "Command Line Tools for Xcode 26.6-26.6"]);
    expect(p.calls.exec).not.toContainEqual(["xcode-select", "--install"]);
    expect(p.calls.exec.some((argv) => argv[0] === "rm" && argv.includes("/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress"))).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("Installed Command Line Tools");
  });

  test("apple-clt headless: no catalog label -> falls back to the dialog trigger, marker still cleaned", async () => {
    const exec: ExecScript = (argv) => {
      if (argv[0] === "xcode-select" && argv[1] === "-p") return { code: 2, stdout: "", stderr: "" };
      if (argv[0] === "softwareupdate") return ok("No new software available.");
      if (argv[0] === "git") return { code: 1, stdout: "", stderr: "" };
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await installTool(p, "apple-clt", [], NOOP_SEAMS);
    expect(p.calls.exec).toContainEqual(["xcode-select", "--install"]);
    expect(p.calls.exec.some((argv) => argv[0] === "rm" && argv.includes("/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress"))).toBe(true);
    // A triggered dialog is progress, not completion — ok stays false until a
    // later probe verifies git.
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Opened Apple's Command Line Tools installer");
  });

  test("apple-clt with git older than 2.35: updates through softwareupdate, never answers already installed", async () => {
    let installed = false;
    const exec: ExecScript = (argv) => {
      if (argv[0] === "xcode-select" && argv[1] === "-p") return ok("/Library/Developer/CommandLineTools\n");
      if (argv[0] === "softwareupdate" && argv[1] === "-l") return ok("* Label: Command Line Tools for Xcode 16.4-16.4\n");
      if (argv[0] === "softwareupdate" && argv[1] === "-i") {
        installed = true;
        return ok();
      }
      if (argv[0] === "git") return ok(installed ? "git version 2.39.5 (Apple Git-154)" : "git version 2.24.3 (Apple Git-128)");
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await installTool(p, "apple-clt", [], NOOP_SEAMS);
    expect(p.calls.exec).toContainEqual(["softwareupdate", "-i", "Command Line Tools for Xcode 16.4-16.4"]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("2.39.5");
  });

  test("apple-clt with git older than 2.35 and no update offered: the manual reinstall, never the dialog", async () => {
    const exec: ExecScript = (argv) => {
      if (argv[0] === "xcode-select" && argv[1] === "-p") return ok("/Library/Developer/CommandLineTools\n");
      if (argv[0] === "softwareupdate") return ok("No new software available.");
      if (argv[0] === "git") return ok("git version 2.24.3 (Apple Git-128)");
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await installTool(p, "apple-clt", [], NOOP_SEAMS);
    expect(p.calls.exec).not.toContainEqual(["xcode-select", "--install"]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install");
  });

  test("apple-clt code 1 'already installed' -> ok (honest, not re-triggered)", async () => {
    const exec: ExecScript = () => ({ code: 1, stdout: "", stderr: "xcode-select: error: command line tools are already installed" });
    const p = fakeProbes({ exec });
    const result = await installTool(p, "apple-clt", [], NOOP_SEAMS);
    expect(result.ok).toBe(true);
    expect(result.via).toBe("apple-clt");
  });

  test("apple-clt code 1 for another reason -> honest failure, not ok", async () => {
    const exec: ExecScript = () => ({ code: 1, stdout: "", stderr: "some other failure" });
    const p = fakeProbes({ exec });
    const result = await installTool(p, "apple-clt", [], NOOP_SEAMS);
    expect(result.ok).toBe(false);
  });

  test("dialog fallback never claims completion — only the headless path may, and only after a green git re-probe", async () => {
    const exec: ExecScript = (argv) => {
      if (argv[0] === "xcode-select" && argv[1] === "-p") return { code: 2, stdout: "", stderr: "" };
      if (argv[0] === "softwareupdate") return ok("No new software available.");
      if (argv[0] === "git") return { code: 1, stdout: "", stderr: "" };
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await installTool(p, "apple-clt", [], NOOP_SEAMS);
    expect(result.detail).toContain("Finish it");
    expect(result.detail.toLowerCase()).not.toContain("installed \"");
  });
});

describe("setupTool — fast-browser", () => {
  const BUNDLED_FB = (_p: unknown, tool: string) => (tool === "fast-browser" ? { tool, bundled: "node", exec: ["node", "fast-browser.mjs"], userCopy: null, linked: false, chosen: "node" } : noopResolution(tool));
  const LINKED: ToolsInstallSeams["link"] = (p, tool) => ({ ok: true, path: `${p.home}/.local/bin/${tool}`, state: "linked" });

  test("exec=[node, mjs] records argv [node, mjs, setup]", async () => {
    const seams: ToolsInstallSeams = { ...NOOP_SEAMS, resolveTool: BUNDLED_FB, link: LINKED };
    const exec: ExecScript = (argv) => (argv[0] === "node" ? ok() : ok());
    const p = fakeProbes({ exec });
    const result = await setupTool(p, "fast-browser", { configDirs: [] }, seams);
    // Non-interactive fast-browser setup demands the host; rt wires Claude Code.
    expect(p.calls.exec).toContainEqual(["node", "fast-browser.mjs", "setup", "--host", "claude"]);
    const withSource = fakeProbes({ exec: async () => ok("") });
    await setupTool(withSource, "fast-browser", { configDirs: [], marketplaceSource: "https://github.com/m4ttstack/mattstack-marketplace.git" }, seams);
    expect(withSource.calls.exec).toContainEqual(["node", "fast-browser.mjs", "setup", "--host", "claude", "--source", "https://github.com/m4ttstack/mattstack-marketplace.git"]);
    expect(result.ok).toBe(true);
  });

  test("exec null -> UserActionableError tool-missing", async () => {
    const p = fakeProbes();
    await expect(setupTool(p, "fast-browser", { configDirs: [] }, NOOP_SEAMS)).rejects.toThrow(UserActionableError);
  });

  test("setup script exits non-zero -> honest failure", async () => {
    const seams: ToolsInstallSeams = { ...NOOP_SEAMS, resolveTool: BUNDLED_FB, link: LINKED };
    const exec: ExecScript = () => ({ code: 1, stdout: "", stderr: "boom" });
    const p = fakeProbes({ exec });
    const result = await setupTool(p, "fast-browser", { configDirs: [] }, seams);
    expect(result.ok).toBe(false);
  });

  // rt owns ~/.local/bin/fast-browser whenever the bundled copy is the one in
  // use; linking first means fast-browser setup finds rt's wrapper and leaves
  // it, instead of writing a shim that needs a system node.
  test("bundled: links the launcher before fast-browser setup runs", async () => {
    const order: string[] = [];
    const seams: ToolsInstallSeams = {
      ...NOOP_SEAMS,
      resolveTool: BUNDLED_FB,
      link: (p, tool) => {
        order.push(`link ${tool}`);
        return LINKED(p, tool);
      },
    };
    const p = fakeProbes({ exec: (argv) => { order.push(argv.slice(2, 3).join(" ")); return ok(); } });

    const result = await setupTool(p, "fast-browser", { configDirs: [] }, seams);

    expect(result.ok).toBe(true);
    expect(order).toEqual(["link fast-browser", "setup"]);
  });

  test("bundled: a refused link (a live user copy holds the slot) does not fail setup", async () => {
    const seams: ToolsInstallSeams = {
      ...NOOP_SEAMS,
      resolveTool: BUNDLED_FB,
      link: () => ({ ok: false, reason: "occupied", detail: "occupied" }),
    };
    const p = fakeProbes({ exec: () => ok() });
    expect((await setupTool(p, "fast-browser", { configDirs: [] }, seams)).ok).toBe(true);
  });

  test("a user copy (nothing bundled) runs setup without touching the launcher", async () => {
    const seams: ToolsInstallSeams = {
      ...NOOP_SEAMS,
      resolveTool: (_p, tool) => ({ tool, bundled: null, exec: ["/opt/fb/fast-browser"], userCopy: "/opt/fb/fast-browser", linked: false, chosen: "/opt/fb/fast-browser" }),
    };
    const p = fakeProbes({ exec: () => ok() });
    expect((await setupTool(p, "fast-browser", { configDirs: [] }, seams)).ok).toBe(true);
  });
});

describe("setupTool — herdr", () => {
  test("configDirs:[a,b] runs herdr integration install claude twice, once per dir, with CLAUDE_CONFIG_DIR", async () => {
    const seen: Array<{ argv: string[]; env?: Record<string, string> }> = [];
    const exec: ExecScript = (argv, opts) => {
      seen.push({ argv, env: opts?.env });
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await setupTool(p, "herdr", { configDirs: ["/a/.claude", "/b/.claude"] }, NOOP_SEAMS);
    const herdrCalls = seen.filter((c) => c.argv[0] === "herdr");
    expect(herdrCalls).toHaveLength(2);
    expect(herdrCalls[0]!.argv).toEqual(["herdr", "integration", "install", "claude"]);
    expect(herdrCalls[0]!.env).toEqual({ CLAUDE_CONFIG_DIR: "/a/.claude" });
    expect(herdrCalls[1]!.env).toEqual({ CLAUDE_CONFIG_DIR: "/b/.claude" });
    expect(result.ok).toBe(true);
  });

  test("runs the resolved copy, not a bare name", async () => {
    const seams: ToolsInstallSeams = { ...NOOP_SEAMS, resolveTool: (_p, tool) => ({ ...noopResolution(tool), exec: ["/opt/homebrew/bin/herdr"] }) };
    const p = fakeProbes({ exec: () => ok() });
    await setupTool(p, "herdr", { configDirs: ["/a/.claude"] }, seams);
    expect(p.calls.exec).toEqual([["/opt/homebrew/bin/herdr", "integration", "install", "claude"]]);
  });

  test("one dir fails -> ok:false, other dir's success still reported honestly", async () => {
    const exec: ExecScript = (argv, opts) => {
      if (opts?.env?.CLAUDE_CONFIG_DIR === "/b/.claude") return { code: 1, stdout: "", stderr: "boom" };
      return ok();
    };
    const p = fakeProbes({ exec });
    const result = await setupTool(p, "herdr", { configDirs: ["/a/.claude", "/b/.claude"] }, NOOP_SEAMS);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("/a/.claude");
    expect(result.detail).toContain("/b/.claude");
  });
});

describe("setupTool — extension", () => {
  test("installs into every detected editor and records editors in setup-state", async () => {
    const editors: DetectedEditor[] = [
      { name: "Cursor", cliPath: "/Applications/Cursor.app/cli", appPath: "/Applications/Cursor.app" },
      { name: "Visual Studio Code", cliPath: "/Applications/Code.app/cli", appPath: "/Applications/Code.app" },
    ];
    const seams: ToolsInstallSeams = { ...NOOP_SEAMS, findVsixes: () => ["/fake/rt-context.vsix"], detectEditors: () => editors };
    const exec: ExecScript = (argv) => (argv.includes("--install-extension") ? ok() : ok());
    const p = fakeProbes({ exec, home: "/fake-home" });
    const result = await setupTool(p, "extension", { configDirs: [] }, seams);
    expect(p.calls.exec).toContainEqual(["/Applications/Cursor.app/cli", "--install-extension", "/fake/rt-context.vsix", "--force"]);
    expect(p.calls.exec).toContainEqual(["/Applications/Code.app/cli", "--install-extension", "/fake/rt-context.vsix", "--force"]);
    expect(result.ok).toBe(true);

    const state = readSetupState(p);
    expect(state.extensionEditors).toContain("Cursor");
    expect(state.extensionEditors).toContain("Visual Studio Code");
  });

  test("no vsix found -> honest failure, no editors touched", async () => {
    const seams: ToolsInstallSeams = { ...NOOP_SEAMS, findVsixes: () => [], detectEditors: () => [{ name: "Cursor", cliPath: "/x/cli", appPath: "/x" }] };
    const p = fakeProbes({ home: "/fake-home" });
    const result = await setupTool(p, "extension", { configDirs: [] }, seams);
    expect(result.ok).toBe(false);
    expect(p.calls.exec).toHaveLength(0);
  });

  test("no editors detected -> honest failure", async () => {
    const seams: ToolsInstallSeams = { ...NOOP_SEAMS, findVsixes: () => ["/fake/rt-context.vsix"], detectEditors: () => [] };
    const p = fakeProbes({ home: "/fake-home" });
    const result = await setupTool(p, "extension", { configDirs: [] }, seams);
    expect(result.ok).toBe(false);
  });

  test("one editor's install fails -> ok:false but the other's success is still recorded (never claim a guess)", async () => {
    const editors: DetectedEditor[] = [
      { name: "Cursor", cliPath: "/x/cursor-cli", appPath: "/x/Cursor.app" },
      { name: "Windsurf", cliPath: "/x/windsurf-cli", appPath: "/x/Windsurf.app" },
    ];
    const seams: ToolsInstallSeams = { ...NOOP_SEAMS, findVsixes: () => ["/fake/rt-context.vsix"], detectEditors: () => editors };
    const exec: ExecScript = (argv) => (argv[0] === "/x/windsurf-cli" ? { code: 1, stdout: "", stderr: "boom" } : ok());
    const p = fakeProbes({ exec, home: "/fake-home" });
    const result = await setupTool(p, "extension", { configDirs: [] }, seams);
    expect(result.ok).toBe(false);

    const state = readSetupState(p);
    expect(state.extensionEditors).toEqual(["Cursor"]);
  });
});

describe("setupTool — extension, both bundled files", () => {
  const RT_CONTEXT = "/bundle/Contents/Resources/rt-context.vsix";
  const SKILL_BLOCKS = "/bundle/Contents/Resources/skill-blocks.vsix";
  let apps: string;

  afterEach(() => {
    if (apps) rmSync(apps, { recursive: true, force: true });
  });

  /** A fixture /Applications holding VS Code, Cursor and Antigravity, each with the CLI detectEditors looks for. */
  function fixtureApplications(): string {
    apps = mkdtempSync(join(tmpdir(), "rt-fixture-applications-"));
    for (const [app, cli] of [["Visual Studio Code.app", "code"], ["Cursor.app", "cursor"], ["Antigravity.app", "antigravity"]] as const) {
      const bin = join(apps, app, "Contents/Resources/app/bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, cli), "");
    }
    return apps;
  }

  function seamsFor(files: string[]): ToolsInstallSeams {
    const root = fixtureApplications();
    return { ...NOOP_SEAMS, findVsixes: () => files, detectEditors: () => detectEditors([root]) };
  }

  const installs = (calls: string[][]) => calls.filter((a) => a.includes("--install-extension")).map((a) => [a[0]!.split("/").at(-1), a[2]]);

  test("a fresh install puts both files into VS Code, Cursor and Antigravity and records all three", async () => {
    const seams = seamsFor([RT_CONTEXT, SKILL_BLOCKS]);
    const p = fakeProbes({ exec: () => ok(), home: "/fake-home" });
    const result = await setupTool(p, "extension", { configDirs: [] }, seams);
    expect(result.ok).toBe(true);
    for (const cli of ["code", "cursor", "antigravity"]) {
      expect(installs(p.calls.exec)).toContainEqual([cli, RT_CONTEXT]);
      expect(installs(p.calls.exec)).toContainEqual([cli, SKILL_BLOCKS]);
    }
    expect(installs(p.calls.exec)).toHaveLength(6);
    expect([...readSetupState(p).extensionEditors].sort()).toEqual(["Antigravity", "Cursor", "Visual Studio Code"]);
  });

  test("an update run gives skill-blocks to an existing rt-context user, only in the editors setup-state records", async () => {
    const seams = seamsFor([RT_CONTEXT, SKILL_BLOCKS]);
    const p = fakeProbes({ exec: () => ok(), home: "/fake-home" });
    updateSetupState(p, (s) => ({ ...s, extensionEditors: ["Cursor", "Antigravity"] }));
    const result = await setupTool(p, "extension", { configDirs: [], onlyEditors: readSetupState(p).extensionEditors }, seams);
    expect(result.ok).toBe(true);
    expect(installs(p.calls.exec).sort()).toEqual([
      ["antigravity", RT_CONTEXT],
      ["antigravity", SKILL_BLOCKS],
      ["cursor", RT_CONTEXT],
      ["cursor", SKILL_BLOCKS],
    ]);
    expect([...readSetupState(p).extensionEditors].sort()).toEqual(["Antigravity", "Cursor"]);
  });

  test("a bundle carrying only rt-context.vsix still installs it and is not a failure", async () => {
    const seams = seamsFor([RT_CONTEXT]);
    const p = fakeProbes({ exec: () => ok(), home: "/fake-home" });
    const result = await setupTool(p, "extension", { configDirs: [] }, seams);
    expect(result.ok).toBe(true);
    expect(result.detail).not.toBe(VSIX_NOT_FOUND_DETAIL);
    expect(installs(p.calls.exec).map((c) => c[1])).toEqual([RT_CONTEXT, RT_CONTEXT, RT_CONTEXT]);
  });

  test("one file failing in one editor leaves that editor unrecorded and the result failed", async () => {
    const seams = seamsFor([RT_CONTEXT, SKILL_BLOCKS]);
    const exec: ExecScript = (argv) => (argv[0]!.endsWith("/cursor") && argv[2] === SKILL_BLOCKS ? { code: 1, stdout: "", stderr: "boom" } : ok());
    const p = fakeProbes({ exec, home: "/fake-home" });
    const result = await setupTool(p, "extension", { configDirs: [] }, seams);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Cursor");
    expect([...readSetupState(p).extensionEditors].sort()).toEqual(["Antigravity", "Visual Studio Code"]);
  });

  test("a re-run never records an editor twice", async () => {
    const seams = seamsFor([RT_CONTEXT, SKILL_BLOCKS]);
    const p = fakeProbes({ exec: () => ok(), home: "/fake-home" });
    await setupTool(p, "extension", { configDirs: [] }, seams);
    await setupTool(p, "extension", { configDirs: [] }, seams);
    expect(readSetupState(p).extensionEditors).toHaveLength(3);
  });
});

describe("findBundledVsixes", () => {
  test("names both bundled files", () => {
    expect([...BUNDLED_VSIX_FILES]).toEqual(["rt-context.vsix", "skill-blocks.vsix"]);
  });

  test("takes each file from beside the binary when no app bundle carries it, and leaves out a file that ships nowhere", () => {
    const beside = "/fake-bin";
    const p = fakeProbes({ home: "/nonexistent-find-vsixes-home", files: { [join(beside, "rt-context.vsix")]: "" } });
    expect(findBundledVsixes(p, beside)).toEqual([join(beside, "rt-context.vsix")]);
  });

  test("an empty list when neither file ships", () => {
    const p = fakeProbes({ home: "/nonexistent-find-vsixes-home" });
    expect(findBundledVsixes(p, "/fake-bin")).toEqual([]);
  });

  test("the app bundle's Contents/Resources wins over beside the binary", () => {
    const app = join("/Applications", processFlavor() === "dev" ? DEV_TRAY_APP_BUNDLE : TRAY_APP_BUNDLE);
    const resources = join(app, "Contents", "Resources");
    const beside = "/fake-bin";
    const p = fakeProbes({
      home: "/nonexistent-find-vsixes-home",
      dirs: { [app]: [] },
      files: {
        [join(resources, "rt-context.vsix")]: "",
        [join(resources, "skill-blocks.vsix")]: "",
        [join(beside, "rt-context.vsix")]: "",
        [join(beside, "skill-blocks.vsix")]: "",
      },
    });
    expect(findBundledVsixes(p, beside)).toEqual([join(resources, "rt-context.vsix"), join(resources, "skill-blocks.vsix")]);
  });
});

describe("setupTool — unknown tool", () => {
  test("throws UserActionableError unknown-tool-setup", async () => {
    const p = fakeProbes();
    await expect(setupTool(p, "not-a-real-tool", { configDirs: [] }, NOOP_SEAMS)).rejects.toThrow(UserActionableError);
  });
});

describe("claudeConfigDirs", () => {
  test("defaults to ~/.claude when CLAUDE_CONFIG_DIR is unset, plus extras deduped", () => {
    const p = { env: {}, home: "/fake-home" };
    expect(claudeConfigDirs(p, ["/fake-home/.claude", "/other/.claude"])).toEqual(["/fake-home/.claude", "/other/.claude"]);
  });

  test("honors CLAUDE_CONFIG_DIR when set", () => {
    const p = { env: { CLAUDE_CONFIG_DIR: "/custom/.claude" }, home: "/fake-home" };
    expect(claudeConfigDirs(p, [])).toEqual(["/custom/.claude"]);
  });
});

describe("parseCltLabel", () => {
  test("modern macOS 26 format (verbatim from a real guest): picks the newest label", () => {
    const out = "Software Update found the following new or updated software:\n* Label: Command Line Tools for Xcode 26.5-26.5\n\tTitle: Command Line Tools for Xcode 26.5, Version: 26.5, Size: 920416KiB, Recommended: YES, \n* Label: Command Line Tools for Xcode 26.6-26.6\n\tTitle: Command Line Tools for Xcode 26.6, Version: 26.6, Size: 920431KiB, Recommended: YES, \n";
    expect(parseCltLabel(out)).toBe("Command Line Tools for Xcode 26.6-26.6");
  });

  test("legacy hyphenated format still parses", () => {
    const out = "* Label: Command Line Tools for Xcode-15.1\n* Label: Command Line Tools for Xcode-16.4\n";
    expect(parseCltLabel(out)).toBe("Command Line Tools for Xcode-16.4");
  });

  test("returns null when the catalog has no CLT entry", () => {
    expect(parseCltLabel("No new software available.")).toBeNull();
  });

  test("never matches a non-CLT label", () => {
    expect(parseCltLabel("* Label: macOS Tahoe 26.1 Update\n")).toBeNull();
  });
});

  
describe("parseCltLabel — catalog order", () => {
  test("catalog order is not version order — the numerically newest label wins regardless", () => {
    const out = "* Label: Command Line Tools for Xcode 26.6-26.6\n* Label: Command Line Tools for Xcode 26.5-26.5\n";
    expect(parseCltLabel(out)).toBe("Command Line Tools for Xcode 26.6-26.6");
  });
});

describe("installRoute", () => {
  const pin = { url: "https://example.com/jq-macos-arm64", sha256: "a".repeat(64), extract: "" };
  test("names the route installTool would take, without running anything", async () => {
    const reqs: PackRequirements[] = [{ pack: "widgets", integrations: [], tools: [{ name: "jq", why: "json", install: { download: { arm64: pin } } }] }];
    const p = fakeProbes();
    expect(await installRoute(p, "jq", reqs, { ...NOOP_SEAMS, hostArch: () => "arm64" })).toBe("download");
    expect(await installRoute(p, "jq", reqs, { ...NOOP_SEAMS, hostArch: () => "x86_64" })).toBeNull();
    expect(await installRoute(p, "claude", [], NOOP_SEAMS)).toBe("vendor");
    expect(await installRoute(p, "herdr", [], NOOP_SEAMS)).toBe("vendor");
    expect(await installRoute(p, "gh", [], { ...NOOP_SEAMS, bundledToolExec: () => ["/bundle/Contents/Helpers/gh"] })).toBe("bundled");
    expect(p.calls.exec).toEqual([]);
  });

  test("is null for a tool with only a link or nothing at all", async () => {
    const reqs: PackRequirements[] = [
      {
        pack: "widgets",
        integrations: [],
        tools: [
          { name: "acme-api", why: "the api", install: { url: "https://acme.example/install" } },
          { name: "steps", why: "by hand" },
        ],
      },
    ];
    const p = fakeProbes();
    for (const tool of ["acme-api", "steps"]) expect(await installRoute(p, tool, reqs, NOOP_SEAMS)).toBeNull();
  });
});
