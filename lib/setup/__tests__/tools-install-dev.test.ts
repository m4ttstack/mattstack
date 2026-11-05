import { describe, expect, test } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { installDevTool } from "../tools-install.ts";

const HOME = "/Users/collab";

describe("installDevTool", () => {
  test("bun runs the official installer pinned to the version, then verifies ~/.bun/bin/bun", async () => {
    const p = fakeProbes({
      home: HOME,
      env: { TMPDIR: "/tmp" },
      exec: (argv) => ({ code: 0, stdout: argv.at(-1) === "--version" ? "1.4.2" : "", stderr: "" }),
    });
    const r = await installDevTool(p, "bun", "1.4.2");
    expect(r.ok).toBe(true);
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", "https://bun.sh/install", "-o", "/tmp/rt-vendor-install/bun.sh"]);
    expect(p.calls.exec).toContainEqual(["bash", "/tmp/rt-vendor-install/bun.sh", "bun-v1.4.2"]);
    expect(p.calls.exec).toContainEqual([`${HOME}/.bun/bin/bun`, "--version"]);
  });

  const SHA = "c".repeat(64);
  const goReleases = JSON.stringify([
    { version: "go1.27rc1", stable: false, files: [{ filename: "go1.27rc1.darwin-arm64.tar.gz", os: "darwin", arch: "arm64", kind: "archive", sha256: "d".repeat(64) }] },
    { version: "go1.26.5", stable: true, files: [
      { filename: "go1.26.5.darwin-arm64.tar.gz", os: "darwin", arch: "arm64", kind: "archive", sha256: SHA },
      { filename: "go1.26.5.darwin-amd64.tar.gz", os: "darwin", arch: "amd64", kind: "archive", sha256: "e".repeat(64) },
      { filename: "go1.26.5.darwin-arm64.pkg", os: "darwin", arch: "arm64", kind: "installer", sha256: "f".repeat(64) },
    ] },
    { version: "go1.26.4", stable: true, files: [{ filename: "go1.26.4.darwin-arm64.tar.gz", os: "darwin", arch: "arm64", kind: "archive", sha256: "a".repeat(64) }] },
  ]);
  const goProbes = (sha = SHA) => fakeProbes({
    home: HOME,
    env: { TMPDIR: "/tmp" },
    fetch: async () => ({ status: 200, body: goReleases, headers: {} }),
    exec: (argv) => (argv[0] === "shasum" ? { code: 0, stdout: `${sha}  ${argv[3]}\n`, stderr: "" } : { code: 0, stdout: "go version go1.26.5 darwin/arm64", stderr: "" }),
  });

  test("go installs the newest stable patch of the pin from go.dev, checked against go.dev's sha256, linked into ~/.local/bin", async () => {
    const p = goProbes();
    const r = await installDevTool(p, "go", "1.26", { hostArch: () => "arm64" });
    expect(r).toEqual({ via: "download", ok: true, detail: "installed go1.26.5 from go.dev" });
    expect(p.calls.fetch).toEqual(["https://go.dev/dl/?mode=json&include=all"]);
    const file = "/tmp/rt-dev-install/go1.26.5.darwin-arm64.tar.gz";
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", "https://go.dev/dl/go1.26.5.darwin-arm64.tar.gz", "-o", file]);
    expect(p.calls.exec).toContainEqual(["shasum", "-a", "256", file]);
    const toolchain = `${HOME}/.mattstack/toolchains/go1.26.5`;
    expect(p.calls.exec).toContainEqual(["tar", "-xzf", file, "-C", toolchain]);
    expect(p.calls.exec).toContainEqual(["ln", "-sfn", `${toolchain}/go/bin/go`, `${HOME}/.local/bin/go`]);
    expect(p.calls.exec).toContainEqual(["ln", "-sfn", `${toolchain}/go/bin/gofmt`, `${HOME}/.local/bin/gofmt`]);
    expect(p.calls.exec).toContainEqual([`${HOME}/.local/bin/go`, "version"]);
  });

  test("an exact pin and an Intel Mac pick that release's amd64 archive", async () => {
    const p = goProbes("e".repeat(64));
    const r = await installDevTool(p, "go", "1.26.5", { hostArch: () => "x86_64" });
    expect(r.ok).toBe(true);
    expect(p.calls.exec.find((argv) => argv[0] === "curl")![2]).toBe("https://go.dev/dl/go1.26.5.darwin-amd64.tar.gz");
  });

  test("a sha256 that does not match go.dev's installs nothing", async () => {
    const p = goProbes("0".repeat(64));
    const r = await installDevTool(p, "go", "1.26", { hostArch: () => "arm64" });
    expect(r).toMatchObject({ ok: false, via: "download" });
    expect(r.detail).toContain("sha256");
    expect(p.calls.exec.some((argv) => argv[0] === "tar" || argv[0] === "ln")).toBe(false);
  });

  test("no matching release is a plain error pointing at the download page", async () => {
    const p = goProbes();
    await expect(installDevTool(p, "go", "1.99", { hostArch: () => "arm64" })).rejects.toMatchObject({ code: "dev-tool-no-release", next: "open https://go.dev/dl/" });
  });

  test("go.dev not answering is a plain error pointing at the download page", async () => {
    const p = fakeProbes({ fetch: async () => ({ status: 503, body: "", headers: {} }) });
    await expect(installDevTool(p, "go", "1.26", { hostArch: () => "arm64" })).rejects.toMatchObject({ code: "dev-tool-no-release", next: "open https://go.dev/dl/" });
  });

  test("a failed installer is ok:false with the reason", async () => {
    const p = fakeProbes({ env: { TMPDIR: "/tmp" }, exec: (argv) => (argv[0] === "bash" ? { code: 1, stdout: "", stderr: "unsupported" } : { code: 0, stdout: "", stderr: "" }) });
    const r = await installDevTool(p, "bun", "1.4.2");
    expect(r).toMatchObject({ ok: false, via: "vendor" });
    expect(r.detail).toContain("unsupported");
  });
});
