import { describe, test, expect } from "bun:test";
import { join } from "path";
import testedVersions from "../../../scripts/acceptance/tested-versions.json";
import { RELEASE_BINARIES, installTool, type ToolsInstallSeams } from "../tools-install.ts";
import { fakeProbes, ok, missing, type ExecScript } from "./fakes.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import type { ExecResult } from "../probes.ts";

const HOME = "/Users/member";
const TMP = "/private/var/folders/xx/T";
const DEST = join(HOME, ".local", "bin", "codex");
const PINNED = RELEASE_BINARIES.codex!;
const BINARY_SHA = "b".repeat(64);

const SEAMS: ToolsInstallSeams = {
  resolveTool: (_p, tool) => ({ tool, bundled: null, exec: null, userCopy: null, linked: false, chosen: null }),
  detectEditors: () => [],
  findVsix: () => null,
  bundledToolExec: () => null,
  link: () => {
    throw new Error("link() should not be called for codex");
  },
};

type Overrides = Partial<Record<"uname" | "curl" | "archiveSha" | "tar" | "binarySha" | "destSha" | "install" | "verify" | "brew", ExecResult>>;

function codexInstallMac(overrides: Overrides = {}, files: Record<string, string> = {}, links: Record<string, string> = {}, onCurl?: (p: ReturnType<typeof fakeProbes>) => void) {
  const exec: ExecScript = (argv) => {
    const [cmd] = argv;
    if (cmd === "curl") onCurl?.(p);
    if (cmd === "uname") return overrides.uname ?? ok("arm64\n");
    if (cmd === "brew") return overrides.brew ?? ok("Homebrew 4.0.0");
    if (cmd === "curl") return overrides.curl ?? ok();
    if (cmd === "shasum") {
      const target = argv.at(-1)!;
      if (target.endsWith(".tar.gz")) return overrides.archiveSha ?? ok(`${PINNED.sha256}  ${target}\n`);
      if (target === DEST) return overrides.destSha ?? ok(`${BINARY_SHA}  ${target}\n`);
      return overrides.binarySha ?? ok(`${BINARY_SHA}  ${target}\n`);
    }
    if (cmd === "tar") return overrides.tar ?? ok();
    if (cmd === "install") return overrides.install ?? ok();
    if (cmd === DEST) return overrides.verify ?? ok("codex-cli 0.160.0\n");
    return missing(cmd ?? "");
  };
  const p = fakeProbes({ home: HOME, env: { TMPDIR: TMP }, exec, files, links });
  return p;
}

const ON = { releases: true };
const commands = (calls: string[][]) => calls.map((argv) => argv[0]);

describe("RELEASE_BINARIES — the pinned Codex release", () => {
  test("carries the exact pinned values", () => {
    expect(PINNED).toEqual({
      version: "0.160.0",
      url: "https://github.com/openai/codex/releases/download/rust-v0.160.0/codex-aarch64-apple-darwin.tar.gz",
      sha256: "07c3c7ca376a8f791115342f53138dda37e97cfa29b8125d0652d93784894b5d",
      member: "codex-aarch64-apple-darwin",
    });
  });

  test("the pinned version is the newest Codex the acceptance matrix tested, and the URL names it", () => {
    const tested = [...testedVersions.harnesses.codex.versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    expect(PINNED.version).toBe(tested.at(-1)!);
    expect(PINNED.url).toContain(`/rust-v${PINNED.version}/`);
  });
});

describe("installTool — codex from OpenAI's release binary", () => {
  test("downloads, checks the checksum, extracts only the member, installs it 755 into ~/.local/bin and re-probes it", async () => {
    const p = codexInstallMac();
    const result = await installTool(p, "codex", [], SEAMS, ON);

    expect(result).toEqual({ via: "vendor", ok: true, detail: `Installed Codex 0.160.0 at ${DEST}` });
    const curl = p.calls.exec.find((a) => a[0] === "curl")!;
    const archive = curl.at(-1)!;
    expect(curl).toEqual(["curl", "-fsSL", "--proto", "=https", "--proto-redir", "=https", PINNED.url, "-o", archive]);
    expect(archive.startsWith(join(TMP, "rt-vendor-install"))).toBe(true);

    const order = commands(p.calls.exec);
    expect(order.indexOf("shasum")).toBeGreaterThan(order.indexOf("curl"));
    expect(order.indexOf("tar")).toBeGreaterThan(order.indexOf("shasum"));
    expect(p.calls.exec.find((a) => a[0] === "shasum")).toEqual(["shasum", "-a", "256", archive]);

    const tar = p.calls.exec.find((a) => a[0] === "tar")!;
    expect(tar).toEqual(["tar", "-xzf", archive, "-C", tar[4]!, PINNED.member]);

    const install = p.calls.exec.find((a) => a[0] === "install")!;
    expect(install.slice(0, 4)).toEqual(["install", "-m", "755", join(tar[4]!, PINNED.member)]);
    expect(p.calls.renames).toContainEqual([install[4]!, DEST]);
    expect(p.exists(join(HOME, ".local", "bin"))).toBe(true);

    expect(p.calls.exec.at(-1)).toEqual([DEST, "--version"]);
  });

  test("records the binary it wrote, so a later run knows the file is rt's", async () => {
    const p = codexInstallMac();
    await installTool(p, "codex", [], SEAMS, ON);
    expect(readSetupState(p).releaseInstalls).toEqual({ [DEST]: BINARY_SHA });
  });

  test("never brew, never npm, never a shell string, even with Homebrew present", async () => {
    const p = codexInstallMac();
    await installTool(p, "codex", [], SEAMS, ON);
    for (const argv of p.calls.exec) {
      expect(["brew", "npm", "sh", "bash"]).not.toContain(argv[0]!);
      expect(argv).not.toContain("-c");
      for (const arg of argv) expect(arg).not.toContain("|");
    }
  });

  test("a checksum mismatch deletes the download and installs nothing", async () => {
    const p = codexInstallMac({ archiveSha: ok(`${"0".repeat(64)}  x.tar.gz\n`) });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "The Codex download did not match its expected checksum, so rt deleted it" });
    const archive = p.calls.exec.find((a) => a[0] === "curl")!.at(-1)!;
    expect(p.calls.removed).toContain(archive);
    expect(commands(p.calls.exec)).not.toContain("tar");
    expect(commands(p.calls.exec)).not.toContain("install");
    expect(p.calls.renames).toEqual([]);
  });

  test("a checksum check that cannot run deletes the download too", async () => {
    const p = codexInstallMac({ archiveSha: { code: 1, stdout: "", stderr: "shasum: boom" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result.ok).toBe(false);
    expect(p.calls.removed).toContain(p.calls.exec.find((a) => a[0] === "curl")!.at(-1)!);
    expect(commands(p.calls.exec)).not.toContain("tar");
  });

  test("a failed download is honest and nothing after it runs", async () => {
    const p = codexInstallMac({ curl: { code: 22, stdout: "", stderr: "curl: (22) The requested URL returned error: 404" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "Downloading Codex failed (exit 22): curl: (22) The requested URL returned error: 404" });
    expect(commands(p.calls.exec)).not.toContain("shasum");
  });

  test("a download that times out is honest", async () => {
    const p = codexInstallMac({ curl: { code: 124, stdout: "", stderr: "" } });
    expect(await installTool(p, "codex", [], SEAMS, ON)).toEqual({ via: "vendor", ok: false, detail: "Downloading Codex did not finish in time" });
  });

  test("a failed unpack installs nothing", async () => {
    const p = codexInstallMac({ tar: { code: 1, stdout: "", stderr: "tar: codex-aarch64-apple-darwin: Not found in archive" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "Unpacking Codex failed (exit 1): tar: codex-aarch64-apple-darwin: Not found in archive" });
    expect(commands(p.calls.exec)).not.toContain("install");
  });

  test("an installed binary that does not run is not claimed installed", async () => {
    const p = codexInstallMac({ verify: { code: 137, stdout: "", stderr: "" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: `Codex was put at ${DEST}, but it does not run (exit 137)` });
  });

  test("a codex at ~/.local/bin that rt did not put there is left alone", async () => {
    const p = codexInstallMac({}, { [DEST]: "someone else's codex" });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, reason: "occupied", detail: `Something that rt did not put there is already at ${DEST}` });
    expect(commands(p.calls.exec)).not.toContain("curl");
    expect(commands(p.calls.exec)).not.toContain("install");
    expect(p.calls.renames).toEqual([]);
    expect(p.calls.removed).not.toContain(DEST);
  });

  test("a dangling symlink at ~/.local/bin/codex is someone else's too", async () => {
    const p = codexInstallMac({}, {}, { [DEST]: "/nowhere/codex" });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toMatchObject({ ok: false, reason: "occupied" });
    expect(commands(p.calls.exec)).not.toContain("curl");
  });

  test("a file rt recorded, but whose bytes changed since, is no longer rt's", async () => {
    const p = codexInstallMac({ destSha: ok(`${"c".repeat(64)}  ${DEST}\n`) }, { [DEST]: "replaced" });
    updateSetupState(p, (s) => ({ ...s, releaseInstalls: { [DEST]: BINARY_SHA } }));
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toMatchObject({ ok: false, reason: "occupied" });
    expect(commands(p.calls.exec)).not.toContain("curl");
  });

  test("rt's own earlier install is replaced", async () => {
    const p = codexInstallMac({}, { [DEST]: "rt's codex" });
    updateSetupState(p, (s) => ({ ...s, releaseInstalls: { [DEST]: BINARY_SHA } }));
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toMatchObject({ via: "vendor", ok: true });
    expect(p.calls.renames.some(([, to]) => to === DEST)).toBe(true);
  });

  test("an Intel Mac is refused before anything downloads", async () => {
    const p = codexInstallMac({ uname: ok("x86_64\n") });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "Codex's release build runs only on Apple silicon, and this Mac is x86_64" });
    expect(commands(p.calls.exec)).toEqual(["uname"]);
  });

  for (const [label, opts] of [["switched off", { releases: false }], ["not opted in", undefined]] as const) {
    test(`release binaries ${label}: codex has no install method, as before they existed`, async () => {
      const p = codexInstallMac({ brew: missing("brew") });
      await expect(installTool(p, "codex", [], SEAMS, opts)).rejects.toThrow("no install method known for codex");
      expect(commands(p.calls.exec)).toEqual(["brew"]);
    });
  }

  test("a codex someone else puts at ~/.local/bin during the download is left alone", async () => {
    const p = codexInstallMac({}, {}, {}, (probes) => probes.writeFile(DEST, "someone else's codex"));
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, reason: "occupied", detail: `Something that rt did not put there is already at ${DEST}` });
    expect(p.calls.renames.some(([, to]) => to === DEST)).toBe(false);
    expect(p.readFile(DEST)).toBe("someone else's codex");
    expect(p.calls.removed).toContain(`${DEST}.rt-new`);
    expect(readSetupState(p).releaseInstalls).toBeUndefined();
  });

  test("a failed install removes the partly written staging file", async () => {
    const p = codexInstallMac({ install: { code: 1, stdout: "", stderr: "install: write failed" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: `Putting Codex in ${join(HOME, ".local", "bin")} failed (exit 1): install: write failed` });
    expect(p.calls.removed).toContain(`${DEST}.rt-new`);
    expect(p.calls.renames).toEqual([]);
  });

  test("a processor check that cannot run is refused too", async () => {
    const p = codexInstallMac({ uname: { code: 1, stdout: "", stderr: "" } });
    const result = await installTool(p, "codex", [], SEAMS, ON);
    expect(result).toEqual({ via: "vendor", ok: false, detail: "rt could not read this Mac's processor type" });
    expect(commands(p.calls.exec)).toEqual(["uname"]);
  });
});
