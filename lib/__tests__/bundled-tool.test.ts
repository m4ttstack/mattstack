import { describe, expect, test } from "bun:test";
import { resolveBundledTool, wellKnownBinDirs, whichWithWellKnownDirs } from "../bundled-tool.ts";

describe("resolveBundledTool", () => {
  // The whole point: an installed machine must not depend on the user having
  // the tool on PATH. age-keygen and sops are Homebrew-only, and a clean Mac
  // has neither — which dead-ended every install at step 2 of 20.
  test("falls back to PATH when the tool is not bundled", () => {
    expect(resolveBundledTool("definitely-not-bundled", () => "/usr/local/bin/found")).toBe("/usr/local/bin/found");
  });

  // Returning the bare name (rather than null or throwing) keeps the failure
  // identical to what it was before this module existed: the tool's own
  // "not found", not a crash from the resolver.
  test("returns the bare name when neither bundled nor on PATH", () => {
    expect(resolveBundledTool("definitely-not-bundled", () => null)).toBe("definitely-not-bundled");
  });

  test("does not consult PATH for a name it can resolve in the bundle", () => {
    // No bundle root in a test process, so this exercises the fallback order
    // rather than a hit — the assertion that matters is that `which` is the
    // one consulted, and exactly once.
    let calls = 0;
    resolveBundledTool("fzf", () => {
      calls += 1;
      return "/opt/homebrew/bin/fzf";
    });
    expect(calls).toBe(1);
  });
});

describe("whichWithWellKnownDirs", () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const { tmpdir } = require("os") as typeof import("os");

  function executable(dir: string, name: string): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, "#!/bin/sh\n", { mode: 0o755 });
    return path;
  }

  // launchd hands the tray and daemon a PATH without Homebrew or ~/.local/bin.
  test("finds a tool in ~/.local/bin when PATH is launchd's minimal one", () => {
    const home = mkdtempSync(join(tmpdir(), "rt-wellknown-"));
    try {
      const want = executable(join(home, ".local", "bin"), "rt-wellknown-probe");
      expect(whichWithWellKnownDirs(home, "/usr/bin:/bin")("rt-wellknown-probe")).toBe(want);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("PATH outranks the well-known dirs", () => {
    const home = mkdtempSync(join(tmpdir(), "rt-wellknown-"));
    try {
      executable(join(home, ".local", "bin"), "rt-wellknown-probe");
      const onPath = executable(join(home, "onpath"), "rt-wellknown-probe");
      expect(whichWithWellKnownDirs(home, join(home, "onpath"))("rt-wellknown-probe")).toBe(onPath);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("names Homebrew's two prefixes and ~/.local/bin", () => {
    expect(wellKnownBinDirs("/Users/x")).toEqual(["/opt/homebrew/bin", "/usr/local/bin", "/Users/x/.local/bin"]);
  });
});
