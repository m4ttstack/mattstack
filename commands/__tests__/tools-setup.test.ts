import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { toolsInstall, toolsSetup } from "../tools.ts";

describe("rt tools setup fast-browser", () => {
  let home: string;
  let io: CapturedOut;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tools-setup-")));
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    rmSync(home, { recursive: true, force: true });
  });

  test("passes the registered mattstack marketplace, with its .git suffix, as --source", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" }, files: { "/usr/local/bin/fast-browser": "bin" }, exec: async () => ok("") });
    await toolsSetup(["fast-browser", "--json"], {}, p);
    expect(p.calls.exec).toEqual([["/usr/local/bin/fast-browser", "setup", "--host", "claude", "--source", "https://github.com/m4ttstack/mattstack-marketplace.git"]]);
  });

  test("an RT_MATTSTACK_MARKETPLACE override is the source the verb passes", async () => {
    const env = { PATH: "/usr/local/bin", RT_MATTSTACK_MARKETPLACE: "file:///tmp/dev-marketplace" };
    const p = fakeProbes({ home, env, files: { "/usr/local/bin/fast-browser": "bin" }, exec: async () => ok("") });
    await toolsSetup(["fast-browser", "--json"], {}, p);
    expect(p.calls.exec).toEqual([["/usr/local/bin/fast-browser", "setup", "--host", "claude", "--source", "file:///tmp/dev-marketplace.git"]]);
  });
});

describe("rt tools setup --json failure", () => {
  let home: string;
  let io: CapturedOut;
  let exit: ReturnType<typeof spyOn>;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tools-setup-")));
    io = captureOut();
    out.__test__.setHuman(() => false);
    exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
  });
  afterEach(() => {
    exit.mockRestore();
    io.restore();
    rmSync(home, { recursive: true, force: true });
  });

  // The app shows a failed row action's stderr; a detail only on stdout reads as a bare "exit 1".
  test("a failed setup under --json leads stderr with the reason", async () => {
    const refusal = "fast-browser: mattstack marketplace is configured from a different source";
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" }, files: { "/usr/local/bin/fast-browser": "bin" }, exec: async () => ({ code: 1, stdout: "", stderr: `${refusal}\nmore` }) });
    await expect(toolsSetup(["fast-browser", "--json"], {}, p)).rejects.toThrow("exit 1");
    expect(io.stderr().split("\n")[0]).toContain(refusal);
    expect(io.stderr()).not.toContain("[failed]");
    expect(io.stderr().startsWith("\n")).toBe(false);
    expect(JSON.parse(io.stdout()).ok).toBe(false);
  });
});

describe("rt tools, read by a person", () => {
  let home: string;
  let io: CapturedOut;
  let exit: ReturnType<typeof spyOn>;
  let savedTTY: boolean | undefined;
  let savedBatch: string | undefined;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tools-human-")));
    savedTTY = process.stdin.isTTY;
    savedBatch = process.env.RT_BATCH;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true, writable: true });
    delete process.env.RT_BATCH;
    io = captureOut();
    out.__test__.setHuman(() => false);
    exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
  });
  afterEach(() => {
    exit.mockRestore();
    io.restore();
    Object.defineProperty(process.stdin, "isTTY", { value: savedTTY, configurable: true, writable: true });
    if (savedBatch === undefined) delete process.env.RT_BATCH;
    else process.env.RT_BATCH = savedBatch;
    rmSync(home, { recursive: true, force: true });
  });

  test("no tool named, off a terminal: a plain question and the command, exit 2", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" } });
    await expect(toolsInstall([], {}, p)).rejects.toThrow("exit 2");
    expect(io.stderr()).toBe("Which tool?\n  next: rt tools install <tool>\n");
    expect(io.stdout()).toBe("");
    await expect(toolsSetup([], {}, p)).rejects.toThrow("exit 2");
    expect(io.stderr()).toContain("Which tool?\n  next: rt tools setup <tool>\n");
  });

  test("the --json usage error is the envelope it always was", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" } });
    await expect(toolsInstall(["--json"], {}, p)).rejects.toThrow("exit 2");
    const body = JSON.parse(io.stdout());
    expect(body.error).toEqual({ code: "usage", message: "usage: rt tools install <tool> [--json]" });
    expect(io.stderr()).toBe("");
  });

  test("a setup that worked is one done line", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" }, files: { "/usr/local/bin/fast-browser": "bin" }, exec: async () => ok("") });
    await toolsSetup(["fast-browser"], {}, p);
    expect(io.stdout()).toStartWith("[ok] Set up fast-browser  ");
    expect(io.stderr()).toBe("");
  });

  test("a setup that failed is a failure on stderr, exit 1", async () => {
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" }, files: { "/usr/local/bin/fast-browser": "bin" }, exec: async () => ({ code: 1, stdout: "", stderr: "fast-browser: no host found\nmore" }) });
    await expect(toolsSetup(["fast-browser"], {}, p)).rejects.toThrow("exit 1");
    expect(io.stderr()).toStartWith("fast-browser was not set up\n  why: ");
    expect(io.stderr()).toContain("no host found");
    expect(io.stdout()).toBe("");
  });
});
