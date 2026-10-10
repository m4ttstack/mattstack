import { describe, test, expect } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { mattstackFloor } from "../mattstack-floor.ts";
import type { ExecResult } from "../probes.ts";

const home = "/fake-home";
const claudeExec = ["/usr/local/bin/claude"];
const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });

const catalog = (source: unknown) => ({
  "/m/.claude-plugin/marketplace.json": JSON.stringify({ name: "mattstack", plugins: [{ name: "mattstack", source }] }),
});
const floorFile = { "/m/plugins/mattstack/pack/requires.json": JSON.stringify({ minEngine: "0.31.0" }) };
const registered = JSON.stringify([{ name: "mattstack", source: "git", installLocation: "/m" }]);

function setup(files: Record<string, string>, reply: (argv: string[]) => ExecResult) {
  const execs: string[][] = [];
  const p = fakeProbes({ home, env: {}, files, exec: async (argv) => (execs.push(argv), reply(argv)) });
  const run = async (args: string[]) => p.exec([...claudeExec, ...args]);
  return { p, run, execs };
}

const listing = (argv: string[]) => (argv.includes("list") ? ok(registered) : ok());

describe("mattstackFloor", () => {
  test("an inline catalog entry yields the published floor", async () => {
    const { p, run, execs } = setup({ ...catalog("./plugins/mattstack"), ...floorFile }, listing);
    expect(await mattstackFloor(p, run, { refresh: true })).toBe("0.31.0");
    expect(execs[0]).toEqual([...claudeExec, "plugin", "marketplace", "update", "mattstack"]);
  });

  test("a git-subdir catalog entry (a dev marketplace) yields no floor", async () => {
    const { p, run } = setup({ ...catalog({ source: "git-subdir", url: "file:///dev/mattstack", path: "plugins/mattstack" }), ...floorFile }, listing);
    expect(await mattstackFloor(p, run, { refresh: false })).toBeNull();
  });

  test("an offline refresh falls back to the cached copy", async () => {
    const { p, run } = setup({ ...catalog("./plugins/mattstack"), ...floorFile }, (argv) =>
      argv.includes("update") ? { code: 1, stdout: "", stderr: "offline" } : listing(argv),
    );
    expect(await mattstackFloor(p, run, { refresh: true })).toBe("0.31.0");
  });

  test("no registered mattstack marketplace yields no floor", async () => {
    const { p, run } = setup({}, (argv) => (argv.includes("list") ? ok("[]") : ok()));
    expect(await mattstackFloor(p, run, { refresh: true })).toBeNull();
  });

  test("refresh false runs no marketplace update", async () => {
    const { p, run, execs } = setup({ ...catalog("./plugins/mattstack"), ...floorFile }, listing);
    await mattstackFloor(p, run, { refresh: false });
    expect(execs.some((a) => a.includes("update"))).toBe(false);
  });
});
