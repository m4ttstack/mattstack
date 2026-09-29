import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import { toolsSetup } from "../tools.ts";

describe("rt tools setup fast-browser", () => {
  let home: string;
  let log: ReturnType<typeof spyOn>;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tools-setup-")));
    log = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
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
  let log: ReturnType<typeof spyOn>;
  let err: ReturnType<typeof spyOn>;
  let exit: ReturnType<typeof spyOn>;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tools-setup-")));
    log = spyOn(console, "log").mockImplementation(() => {});
    err = spyOn(console, "error").mockImplementation(() => {});
    exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
  });
  afterEach(() => {
    log.mockRestore();
    err.mockRestore();
    exit.mockRestore();
    rmSync(home, { recursive: true, force: true });
  });

  // The app shows a failed row action's stderr; a detail only on stdout reads as a bare "exit 1".
  test("fast-browser's own first stderr line reaches stderr, not only the stdout envelope", async () => {
    const refusal = "fast-browser: mattstack marketplace is configured from a different source";
    const p = fakeProbes({ home, env: { PATH: "/usr/local/bin" }, files: { "/usr/local/bin/fast-browser": "bin" }, exec: async () => ({ code: 1, stdout: "", stderr: `${refusal}\nmore` }) });
    await expect(toolsSetup(["fast-browser", "--json"], {}, p)).rejects.toThrow("exit 1");
    expect(err.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")).toContain(refusal);
  });
});
