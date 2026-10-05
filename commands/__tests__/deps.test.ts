import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HELPERS_DIR, RT_BUNDLE_PATH, __test__ as bundleLayoutTest } from "../../lib/bundle-layout.ts";
import { setSetting } from "../../lib/settings/write.ts";
import { fakeProbes, type FakeProbesOpts } from "../../lib/setup/__tests__/fakes.ts";
import { linkPath } from "../../lib/deps/links.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { depsLink, depsReconcile, depsResolve, depsUnlink } from "../deps.ts";
import { toolsInstall } from "../tools.ts";

const LOCK = {
  schema: 1,
  arch: "arm64",
  tools: [
    {
      name: "gh", version: "2.0.0", license: "MIT", url: "https://x/gh.tar.gz", sha256: "a".repeat(64),
      archive: "tar.gz", extract: "gh", bundlePath: `${HELPERS_DIR}/gh`, exec: [`${HELPERS_DIR}/gh`],
      exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
    },
  ],
};

/** Mocks process.exit to throw a sentinel so the real test process never dies, and reads console calls and stream writes through one capture. */
async function runCapturingExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; logs: string[]; errors: string[]; stderr: string }> {
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  const read = () => ({ logs: io.lines(), errors: io.errLines(), stderr: io.stderr() });
  try {
    await fn();
    return { exitCode: undefined, ...read() };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, ...read() };
  } finally {
    io.restore();
    exitSpy.mockRestore();
  }
}

describe("rt deps commands", () => {
  const origHome = process.env.HOME;
  let home: string;
  let appRoot: string;
  let ghPath: string;

  beforeEach(() => {
    bundleLayoutTest.resetBundleLayoutMemo();
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-deps-cmd-home-")));
    process.env.HOME = home;

    appRoot = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-deps-cmd-app-"))), "mattstack.app");
    mkdirSync(join(appRoot, "Contents", "Resources"), { recursive: true });
    mkdirSync(join(appRoot, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(appRoot, HELPERS_DIR), { recursive: true });
    writeFileSync(join(appRoot, "Contents", "Info.plist"), "<plist/>");
    writeFileSync(join(appRoot, "Contents", "Resources", "deps.lock"), JSON.stringify(LOCK));
    writeFileSync(join(appRoot, RT_BUNDLE_PATH), "rt-binary");
    writeFileSync(join(appRoot, HELPERS_DIR, "gh"), "gh-binary");
    setSetting("mattstack.appPath", appRoot, "machine");

    ghPath = join(appRoot, HELPERS_DIR, "gh");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
    bundleLayoutTest.resetBundleLayoutMemo();
  });

  function bundleProbe(extra: Partial<FakeProbesOpts> = {}): ReturnType<typeof fakeProbes> {
    return fakeProbes({
      home,
      ...extra,
      files: { [ghPath]: "gh-binary", ...(extra.files ?? {}) },
      dirs: { [appRoot]: [], ...(extra.dirs ?? {}) },
    });
  }

  test("depsResolve --json prints a contract:1 envelope with the resolved exec array", async () => {
    const { logs } = await runCapturingExit(() => depsResolve(["gh", "--json"], {}, bundleProbe()));
    expect(logs).toHaveLength(1);
    const body = JSON.parse(logs[0]!);
    expect(body.contract).toBe(1);
    expect(typeof body.at).toBe("string");
    expect(body.tool).toBe("gh");
    expect(body.exec).toEqual([ghPath]);
  });

  test("depsResolve (human) prints the resolution without crashing on an unbundled tool", async () => {
    const { logs, exitCode } = await runCapturingExit(() => depsResolve(["nonexistent-tool"], {}, bundleProbe()));
    expect(exitCode).toBeUndefined();
    expect(logs.join("\n")).toContain("not bundled");
  });

  test("depsLink links a bundled tool and prints a success line", async () => {
    const p = bundleProbe();
    const { logs, exitCode } = await runCapturingExit(() => depsLink(["gh"], {}, p));
    expect(exitCode).toBeUndefined();
    expect(logs).toEqual([`[ok] Linked gh  ${linkPath(home, "gh")}`]);
    expect(p.calls.symlinks[linkPath(home, "gh")]).toBe(ghPath);
  });

  test("a refusal by policy is refused, not a failure, with --force as the next step, exit 2", async () => {
    const path = linkPath(home, "gh");
    const p = bundleProbe({ files: { [path]: "#!/bin/sh\necho unrelated\n" } });
    const { exitCode, logs, stderr } = await runCapturingExit(() => depsLink(["gh"], {}, p));
    expect(exitCode).toBe(2);
    expect(logs).toEqual([]);
    expect(stderr).toBe(`[refused] Something that rt did not put there is already at ${path}\n  next: rt deps link gh --force\n`);
  });

  test("depsLink --json also exits 2 on refusal, with the contract's {error} envelope an app can decode", async () => {
    const path = linkPath(home, "gh");
    const p = bundleProbe({ files: { [path]: "#!/bin/sh\necho unrelated\n" } });
    const { exitCode, logs } = await runCapturingExit(() => depsLink(["gh", "--json"], {}, p));
    expect(exitCode).toBe(2);
    expect(logs).toHaveLength(1);
    const body = JSON.parse(logs[0]!);
    expect(body.error.code).toBe("occupied");
    expect(body.error.message).toBe(`Something that rt did not put there is already at ${path}`);
    expect(Object.keys(body.error)).toEqual(["code", "message"]);
  });

  test("depsLink --force overrides the occupied refusal", async () => {
    const path = linkPath(home, "gh");
    const p = bundleProbe({ files: { [path]: "#!/bin/sh\necho unrelated\n" } });
    const { exitCode, logs } = await runCapturingExit(() => depsLink(["gh", "--force"], {}, p));
    expect(exitCode).toBeUndefined();
    expect(logs.join("\n")).toContain("[ok] Linked gh");
  });

  test("depsUnlink removes our own link and reports removed:false for a user's file", async () => {
    const p = bundleProbe();
    await runCapturingExit(() => depsLink(["gh"], {}, p));

    const removed = await runCapturingExit(() => depsUnlink(["gh"], {}, p));
    expect(removed.logs.join("\n")).toContain("[ok] Unlinked gh");

    const userPath = linkPath(home, "deck");
    p.writeFile(userPath, "#!/bin/sh\necho not ours\n");
    const untouched = await runCapturingExit(() => depsUnlink(["deck"], {}, p));
    expect(untouched.exitCode).toBeUndefined();
    expect(untouched.logs).toEqual([]);
    expect(untouched.stderr).toBe("[refused] deck is not a link rt made  left as it is\n");
  });

  test("depsReconcile reports nothing to tidy, then reports an auto-unlink once a user copy appears", async () => {
    const p = bundleProbe();
    await runCapturingExit(() => depsLink(["gh"], {}, p));

    const idle = await runCapturingExit(() => depsReconcile([], {}, p));
    expect(idle.logs.join("\n")).toContain("[skipped] Nothing to tidy");

    p.env.PATH = "/opt/homebrew/bin";
    p.writeFile("/opt/homebrew/bin/gh", "real-gh-binary");

    const active = await runCapturingExit(() => depsReconcile(["--json"], {}, p));
    const body = JSON.parse(active.logs[0]!);
    expect(body.removed).toEqual(["gh"]);
  });

  test("a tool the app does not ship is a failure, not a refusal, exit 2", async () => {
    const { exitCode, stderr, logs } = await runCapturingExit(() => depsLink(["nope-tool"], {}, bundleProbe()));
    expect(exitCode).toBe(2);
    expect(stderr).toBe("mattstack.app does not ship a tool called nope-tool\n");
    expect(logs).toEqual([]);
  });

  test("resolve prints each fact on its own line", async () => {
    const { logs } = await runCapturingExit(() => depsResolve(["gh"], {}, bundleProbe()));
    expect(logs).toEqual(["Tool: gh", `Bundled: ${ghPath}`, "Your copy: none on your PATH", "Linked: no", `Uses: ${ghPath}`]);
  });

  test("no tool named, off a terminal: a plain question and the command, exit 1", async () => {
    const savedTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true, writable: true });
    try {
      const { exitCode, stderr, logs } = await runCapturingExit(() => depsLink([], {}, bundleProbe()));
      expect(exitCode).toBe(1);
      expect(stderr).toBe("Which tool?\n  next: rt deps link <tool>\n");
      expect(logs).toEqual([]);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: savedTTY, configurable: true, writable: true });
    }
  });

  test("a reconcile that removed links says what and why", async () => {
    const p = bundleProbe();
    await runCapturingExit(() => depsLink(["gh"], {}, p));
    p.env.PATH = "/opt/homebrew/bin";
    p.writeFile("/opt/homebrew/bin/gh", "real-gh-binary");
    const { logs } = await runCapturingExit(() => depsReconcile([], {}, p));
    expect(logs).toEqual(["[ok] Removed links you no longer need  gh", "  note: Your own copy of each is on your PATH now."]);
  });

  describe("what the app reads, pinned before the conversion", () => {
    test("deps link --json, linked: the envelope's keys, exit 0", async () => {
      const { exitCode, logs, stderr } = await runCapturingExit(() => depsLink(["gh", "--json"], {}, bundleProbe()));
      expect(exitCode).toBeUndefined();
      expect(logs).toHaveLength(1);
      const body = JSON.parse(logs[0]!);
      expect(Object.keys(body)).toEqual(["contract", "at", "ok", "path", "state"]);
      expect(body).toMatchObject({ contract: 1, ok: true, path: linkPath(home, "gh"), state: "linked" });
      expect(stderr).toBe("");
    });

    test("deps unlink --json: removed, then a file rt did not make, exit 0 both times", async () => {
      const p = bundleProbe();
      await runCapturingExit(() => depsLink(["gh"], {}, p));
      const removed = await runCapturingExit(() => depsUnlink(["gh", "--json"], {}, p));
      expect(removed.exitCode).toBeUndefined();
      const body = JSON.parse(removed.logs[0]!);
      expect(Object.keys(body)).toEqual(["contract", "at", "removed"]);
      expect(body.removed).toBe(true);

      p.writeFile(linkPath(home, "deck"), "#!/bin/sh\necho not ours\n");
      const untouched = await runCapturingExit(() => depsUnlink(["deck", "--json"], {}, p));
      expect(untouched.exitCode).toBeUndefined();
      expect(untouched.logs).toHaveLength(1);
      expect(JSON.parse(untouched.logs[0]!).removed).toBe(false);
      expect(untouched.stderr).toBe("");
    });

    test("tools install of a bundled tool --json, linked: the envelope's keys, exit 0", async () => {
      const { exitCode, logs, stderr } = await runCapturingExit(() => toolsInstall(["gh", "--json"], {}, bundleProbe()));
      expect(exitCode).toBeUndefined();
      expect(logs).toHaveLength(1);
      const body = JSON.parse(logs[0]!);
      expect(Object.keys(body)).toEqual(["contract", "at", "via", "ok", "detail"]);
      expect(body).toMatchObject({ contract: 1, via: "bundled-link", ok: true, detail: `linked at ${linkPath(home, "gh")}` });
      expect(stderr).toBe("");
    });

    test("tools install of a bundled tool --json, refused: the envelope, the refusal on stderr, exit 1", async () => {
      const path = linkPath(home, "gh");
      const p = bundleProbe({ files: { [path]: "#!/bin/sh\necho unrelated\n" } });
      const { exitCode, logs, stderr } = await runCapturingExit(() => toolsInstall(["gh", "--json"], {}, p));
      expect(exitCode).toBe(1);
      expect(logs).toHaveLength(1);
      const body = JSON.parse(logs[0]!);
      expect(Object.keys(body)).toEqual(["contract", "at", "via", "ok", "detail"]);
      expect(body).toMatchObject({ contract: 1, via: "bundled-link", ok: false });
      expect(body.detail).toContain(path);
      expect(stderr).toBe(`[refused] rt left your gh alone  ${body.detail}\n`);
    });
  });
});
