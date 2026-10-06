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

  test("go installs with brew and verifies with `go version` at brew's prefix", async () => {
    const p = fakeProbes({
      exec: (argv) => {
        if (argv[0] === "brew" && argv[1] === "--prefix") return { code: 0, stdout: "/opt/homebrew\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const r = await installDevTool(p, "go", "1.26.5");
    expect(r.ok).toBe(true);
    expect(p.calls.exec).toContainEqual(["brew", "install", "go"]);
    expect(p.calls.exec).toContainEqual(["/opt/homebrew/bin/go", "version"]);
  });

  test("no Homebrew is a plain error pointing at the download page", async () => {
    const p = fakeProbes({ exec: (argv) => (argv[0] === "brew" ? { code: 127, stdout: "", stderr: "ENOENT" } : { code: 0, stdout: "", stderr: "" }) });
    await expect(installDevTool(p, "node", "20.0.0")).rejects.toMatchObject({ code: "dev-tool-no-brew", next: "open https://nodejs.org/en/download" });
  });

  test("a failed installer is ok:false with the reason", async () => {
    const p = fakeProbes({ env: { TMPDIR: "/tmp" }, exec: (argv) => (argv[0] === "bash" ? { code: 1, stdout: "", stderr: "unsupported" } : { code: 0, stdout: "", stderr: "" }) });
    const r = await installDevTool(p, "bun", "1.4.2");
    expect(r).toMatchObject({ ok: false, via: "vendor" });
    expect(r.detail).toContain("unsupported");
  });
});
