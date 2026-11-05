import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HELPERS_DIR, RT_BUNDLE_PATH, __test__ as bundleLayoutTest } from "../../bundle-layout.ts";
import { setSetting } from "../../settings/write.ts";
import { fakeProbes, type FakeProbesOpts } from "../../setup/__tests__/fakes.ts";
import {
  appBundlePath, bundledToolExec, bundledToolPath, DECK_RESTART_TIMEOUT_MS, isOurLink, LINK_TAG, linkPath, resolveTool, restartAppWithDeck, userCopyOnPath,
} from "../resolve.ts";

const LOCK = {
  schema: 1,
  arch: "arm64",
  tools: [
    {
      name: "gh", version: "2.0.0", license: "MIT", url: "https://x/gh.tar.gz", sha256: "a".repeat(64),
      archive: "tar.gz", extract: "gh", bundlePath: `${HELPERS_DIR}/gh`, exec: [`${HELPERS_DIR}/gh`],
      exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
    },
    {
      name: "fast-browser", version: "0.1.0", license: "MIT", url: "https://x/fb.tgz", sha256: "b".repeat(64),
      archive: "npm", extract: "package", bundlePath: `${HELPERS_DIR}/fast-browser`,
      exec: [`${HELPERS_DIR}/node/bin/node`, `${HELPERS_DIR}/fast-browser/bin/fast-browser.mjs`],
      exposeByDefault: true, entitlements: "none", status: "bundled", kind: "helper",
    },
    {
      // Real row from rt-tray/deps.lock (F6): a buildtool's paths are
      // deps-dir-relative, not bundle-relative — bundle-layout.ts throws for
      // it by design; resolve.ts must turn that into null, never propagate it.
      name: "sparkle", version: "2.9.6", license: "MIT", url: "https://x/Sparkle-2.9.6.tar.xz", sha256: "c".repeat(64),
      archive: "tar.xz", extract: "", bundlePath: "tools/sparkle", exec: ["tools/sparkle/bin/generate_appcast"],
      exposeByDefault: false, entitlements: "none", status: "bundled", kind: "buildtool",
    },
  ],
};

describe("bundled-tool resolution", () => {
  const origHome = process.env.HOME;
  let home: string;
  let appRoot: string;
  let ghPath: string;
  let nodePath: string;
  let fbPath: string;
  let rtPath: string;

  beforeEach(() => {
    bundleLayoutTest.resetBundleLayoutMemo();
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-deps-home-")));
    process.env.HOME = home;

    appRoot = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-deps-app-"))), "mattstack.app");
    mkdirSync(join(appRoot, "Contents", "Resources"), { recursive: true });
    mkdirSync(join(appRoot, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(appRoot, HELPERS_DIR, "node", "bin"), { recursive: true });
    mkdirSync(join(appRoot, HELPERS_DIR, "fast-browser", "bin"), { recursive: true });
    writeFileSync(join(appRoot, "Contents", "Info.plist"), "<plist/>");
    writeFileSync(join(appRoot, "Contents", "Resources", "deps.lock"), JSON.stringify(LOCK));
    writeFileSync(join(appRoot, RT_BUNDLE_PATH), "rt-binary");
    writeFileSync(join(appRoot, HELPERS_DIR, "gh"), "gh-binary");
    writeFileSync(join(appRoot, HELPERS_DIR, "node", "bin", "node"), "node-binary");
    writeFileSync(join(appRoot, HELPERS_DIR, "fast-browser", "bin", "fast-browser.mjs"), "fb-binary");
    setSetting("mattstack.appPath", appRoot, "machine");

    ghPath = join(appRoot, HELPERS_DIR, "gh");
    nodePath = join(appRoot, HELPERS_DIR, "node", "bin", "node");
    fbPath = join(appRoot, HELPERS_DIR, "fast-browser", "bin", "fast-browser.mjs");
    rtPath = join(appRoot, RT_BUNDLE_PATH);
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
    bundleLayoutTest.resetBundleLayoutMemo();
  });

  /** A fakeProbes wired with the bundle's own helper files/dirs already tracked (so exists/fileSize/readDir behave like real fs would), merged with per-test extras. */
  function bundleProbe(extra: Partial<FakeProbesOpts> = {}): ReturnType<typeof fakeProbes> {
    return fakeProbes({
      home,
      ...extra,
      files: { [ghPath]: "gh-binary", [nodePath]: "node-binary", [fbPath]: "fb-binary", [rtPath]: "rt-binary", ...(extra.files ?? {}) },
      dirs: { [appRoot]: [], [join(appRoot, HELPERS_DIR, "fast-browser")]: ["bin"], ...(extra.dirs ?? {}) },
    });
  }

  test("appBundlePath resolves the seeded mattstack.appPath", () => {
    expect(appBundlePath(bundleProbe())).toBe(appRoot);
  });

  test("bundledToolPath resolves gh and rt", () => {
    const p = bundleProbe();
    expect(bundledToolPath(p, "gh")).toBe(ghPath);
    expect(bundledToolPath(p, "rt")).toBe(rtPath);
  });

  test("bundledToolExec returns the multi-entry argv for fast-browser; resolveTool mirrors it", () => {
    const p = bundleProbe();
    const exec = bundledToolExec(p, "fast-browser");
    expect(exec).toEqual([nodePath, fbPath]);

    const resolution = resolveTool(p, "fast-browser");
    expect(resolution.exec).toEqual(exec);
    expect(resolution.bundled).toBe(nodePath);
  });

  test("a kind:buildtool row (sparkle) resolves to null everywhere, never throws (F6)", () => {
    const p = bundleProbe();
    expect(() => bundledToolPath(p, "sparkle")).not.toThrow();
    expect(bundledToolPath(p, "sparkle")).toBeNull();
    expect(() => bundledToolExec(p, "sparkle")).not.toThrow();
    expect(bundledToolExec(p, "sparkle")).toBeNull();

    const resolution = resolveTool(p, "sparkle");
    expect(resolution.bundled).toBeNull();
    expect(resolution.exec).toBeNull();
  });

  test("userCopyOnPath finds a real copy on PATH", () => {
    const p = bundleProbe({ env: { PATH: "/opt/homebrew/bin:/Users/x/.local/bin" }, files: { "/opt/homebrew/bin/gh": "real-gh-binary" } });
    expect(userCopyOnPath(p, "gh")).toBe("/opt/homebrew/bin/gh");
  });

  test("userCopyOnPath returns null when the only hit is our own link into the bundle", () => {
    const linkedPath = linkPath(home, "gh");
    const p = bundleProbe({ env: { PATH: `/opt/homebrew/bin:${join(home, ".local", "bin")}` }, links: { [linkedPath]: ghPath } });
    expect(userCopyOnPath(p, "gh")).toBeNull();
  });

  test("userCopyOnPath skips fast-browser setup's shim into a deleted checkout, and counts a live one", () => {
    const slot = linkPath(home, "fast-browser");
    const shim = (entry: string) => `#!/bin/sh\n# Managed by fast-browser setup; rewritten on every setup run. Do not edit.\nexec /usr/bin/env node "${entry}" "$@"\n`;

    const disposed = bundleProbe({ env: { PATH: "/usr/bin" }, files: { [slot]: shim("/worktrees/gone/bin/fast-browser.mjs") } });
    expect(userCopyOnPath(disposed, "fast-browser")).toBeNull();

    const entry = "/src/fast-browser/bin/fast-browser.mjs";
    const live = bundleProbe({ env: { PATH: "/usr/bin" }, files: { [slot]: shim(entry), [entry]: "x" } });
    expect(userCopyOnPath(live, "fast-browser")).toBe(slot);
  });

  // Vendor installers (herdr, claude) land in ~/.local/bin next to rt's own
  // links — a real binary there is a user copy, and it must be found even
  // before Install has put that directory on PATH.
  test("userCopyOnPath counts a real vendor binary in ~/.local/bin, even when PATH lacks that dir", () => {
    const local = linkPath(home, "claude");
    const p = bundleProbe({ env: { PATH: "/usr/bin" }, files: { [local]: "#!/bin/sh\nreal-claude\n" } });
    expect(userCopyOnPath(p, "claude")).toBe(local);
  });

  describe("resolveTool under launchd's minimal PATH", () => {
    const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

    test("finds a tool that only Homebrew has, and runs that copy", () => {
      const brewed = "/opt/homebrew/bin/claude";
      const p = bundleProbe({ env: { PATH: LAUNCHD_PATH }, files: { [brewed]: "claude-binary" } });
      const resolution = resolveTool(p, "claude");
      expect(resolution.userCopy).toBe(brewed);
      expect(resolution.exec).toEqual([brewed]);
      expect(resolution.chosen).toBe(brewed);
    });

    test("finds a tool in /usr/local/bin too", () => {
      const p = bundleProbe({ env: { PATH: LAUNCHD_PATH }, files: { "/usr/local/bin/claude": "claude-binary" } });
      expect(resolveTool(p, "claude").exec).toEqual(["/usr/local/bin/claude"]);
    });

    test("PATH beats the well-known dirs", () => {
      const p = bundleProbe({ env: { PATH: `/custom/bin:${LAUNCHD_PATH}` }, files: { "/custom/bin/claude": "a", "/opt/homebrew/bin/claude": "b" } });
      expect(resolveTool(p, "claude").exec).toEqual(["/custom/bin/claude"]);
    });

    test("prefers ~/.local/bin over Homebrew, the order a bare exec resolves in", () => {
      const local = linkPath(home, "claude");
      const p = bundleProbe({ env: { PATH: LAUNCHD_PATH }, files: { [local]: "#!/bin/sh\nreal-claude\n", "/opt/homebrew/bin/claude": "b" } });
      expect(resolveTool(p, "claude").exec).toEqual([local]);
    });

    test("herdr's own install in ~/.local/bin beats a Homebrew copy earlier on PATH", () => {
      const local = linkPath(home, "herdr");
      const p = bundleProbe({ env: { PATH: `/opt/homebrew/bin:${LAUNCHD_PATH}:${join(home, ".local", "bin")}` }, files: { "/opt/homebrew/bin/herdr": "old", [local]: "#!/bin/sh\nreal-herdr\n" } });
      expect(resolveTool(p, "herdr").exec).toEqual([local]);
    });

    test("any other tool keeps PATH order over ~/.local/bin", () => {
      const p = bundleProbe({ env: { PATH: `/opt/homebrew/bin:${join(home, ".local", "bin")}` }, files: { "/opt/homebrew/bin/claude": "a", [linkPath(home, "claude")]: "#!/bin/sh\nreal-claude\n" } });
      expect(resolveTool(p, "claude").exec).toEqual(["/opt/homebrew/bin/claude"]);
    });

    test("finds nothing when no well-known dir has it", () => {
      const resolution = resolveTool(bundleProbe({ env: { PATH: LAUNCHD_PATH } }), "claude");
      expect(resolution.exec).toBeNull();
      expect(resolution.chosen).toBeNull();
    });

    test("a Homebrew symlink into the bundle is not a user copy", () => {
      const p = bundleProbe({ env: { PATH: LAUNCHD_PATH }, links: { "/opt/homebrew/bin/gh": ghPath } });
      expect(resolveTool(p, "gh").userCopy).toBeNull();
    });

    test("rt's own tagged wrapper is not a user copy, and the scan moves past it to Homebrew", () => {
      const local = linkPath(home, "gh");
      const wrapper = `#!/bin/sh\n${LINK_TAG} gh\nexec x\n`;
      expect(resolveTool(bundleProbe({ env: { PATH: LAUNCHD_PATH }, files: { [local]: wrapper } }), "gh").userCopy).toBeNull();
      const both = bundleProbe({ env: { PATH: LAUNCHD_PATH }, files: { [local]: wrapper, "/opt/homebrew/bin/gh": "real-gh" } });
      expect(resolveTool(both, "gh").userCopy).toBe("/opt/homebrew/bin/gh");
    });

    test("a non-executable file is skipped and the scan moves on to the next copy", () => {
      const p = bundleProbe({
        env: { PATH: LAUNCHD_PATH },
        files: { "/opt/homebrew/bin/claude": "notes", "/usr/local/bin/claude": "claude-binary" },
        modes: { "/opt/homebrew/bin/claude": 0o644, "/usr/local/bin/claude": 0o755 },
      });
      expect(resolveTool(p, "claude").exec).toEqual(["/usr/local/bin/claude"]);
    });

    test("a non-executable file alone reads as not found", () => {
      const p = bundleProbe({ env: { PATH: LAUNCHD_PATH }, files: { "/opt/homebrew/bin/claude": "notes" }, modes: { "/opt/homebrew/bin/claude": 0o644 } });
      expect(resolveTool(p, "claude").exec).toBeNull();
    });

    test("userCopyOnPath stays on PATH, so an app-run link is not refused by a namesake the shell's PATH may never reach", () => {
      const p = bundleProbe({ env: { PATH: LAUNCHD_PATH }, files: { "/opt/homebrew/bin/gh": "real-gh" } });
      expect(userCopyOnPath(p, "gh")).toBeNull();
    });
  });

  test("userCopyOnPath still ignores rt's own tagged wrapper in ~/.local/bin", () => {
    const local = linkPath(home, "gh");
    const p = bundleProbe({ env: { PATH: "/usr/bin" }, files: { [local]: `#!/bin/sh\n${LINK_TAG} gh\nexec x\n` } });
    expect(userCopyOnPath(p, "gh")).toBeNull();
  });

  test("userCopyOnPath never counts the bundle's own Contents/Helpers dir on PATH (F1: the daemon's boot-time prepend must not self-shadow)", () => {
    const p = bundleProbe({ env: { PATH: join(appRoot, HELPERS_DIR) } });
    expect(userCopyOnPath(p, "gh")).toBeNull();
    expect(userCopyOnPath(p, "fast-browser")).toBeNull();
  });

  test("userCopyOnPath never counts a directory as a user copy, even outside any bundle (F2)", () => {
    const p = fakeProbes({
      home,
      env: { PATH: "/opt/homebrew/bin" },
      dirs: { "/opt/homebrew/bin": ["fast-browser"], "/opt/homebrew/bin/fast-browser": [] },
    });
    expect(userCopyOnPath(p, "fast-browser")).toBeNull();
  });

  test("isOurLink's wrapper-tag check never reads an oversized file — a large regular file is never 'ours' (F3)", () => {
    const path = linkPath(home, "fast-browser");
    const taggedContent = `#!/bin/sh\n${LINK_TAG} fast-browser\nexec true "$@"\n`; // genuinely tagged, but reported oversized below
    const p = bundleProbe({ files: { [path]: taggedContent }, sizes: { [path]: 5_000_000 } });
    expect(isOurLink(p, "fast-browser")).toBe(false);
  });

  test("isOurLink reads a small tagged wrapper normally", () => {
    const path = linkPath(home, "fast-browser");
    const content = `#!/bin/sh\n${LINK_TAG} fast-browser\nexec true "$@"\n`;
    const p = bundleProbe({ files: { [path]: content } });
    expect(isOurLink(p, "fast-browser")).toBe(true);
  });

  test("isOurLink accepts a symlink into the OTHER flavor's canonical /Applications path, not just the active bundle root (F11)", () => {
    const path = linkPath(home, "gh");
    const p = { ...bundleProbe(), readlink: (candidate: string) => (candidate === path ? "/Applications/mattstack-dev.app/Contents/Helpers/gh" : null) };
    expect(isOurLink(p, "gh")).toBe(true);
  });

  test("isOurLink's docblock claim matches behavior: any path under the bundle root counts, not only Contents/Helpers or Contents/MacOS", () => {
    const path = linkPath(home, "gh");
    const p = { ...bundleProbe(), readlink: (candidate: string) => (candidate === path ? join(appRoot, "Contents", "Resources", "gh") : null) };
    expect(isOurLink(p, "gh")).toBe(true);
  });
});

describe("restartAppWithDeck", () => {
  test("a restart that outlasts its timeout reads as a failed one", async () => {
    const seen: Array<number | undefined> = [];
    const p = fakeProbes({
      exec: (_argv, opts) => {
        seen.push(opts?.timeoutMs);
        return { code: 124, stdout: "", stderr: "" };
      },
    });
    expect(await restartAppWithDeck(p, "board", "/opt/deck")).toBe(false);
    expect(seen).toEqual([DECK_RESTART_TIMEOUT_MS]);
    expect(DECK_RESTART_TIMEOUT_MS).toBe(60_000);
    expect(p.calls.exec).toEqual([["/opt/deck", "restart", "board"]]);
  });

  test("a restart that exits clean is true", async () => {
    const p = fakeProbes({ exec: () => ({ code: 0, stdout: "", stderr: "" }) });
    expect(await restartAppWithDeck(p, "board", "/opt/deck")).toBe(true);
  });
});
