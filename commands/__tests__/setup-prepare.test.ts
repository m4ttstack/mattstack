import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupPrepare, type PrepareDeps } from "../setup-prepare.ts";
import { __test__ as closedPipes } from "../../lib/setup/closed-pipes.ts";
import { fakeProbes, missing, ok } from "../../lib/setup/__tests__/fakes.ts";
import type { installTool } from "../../lib/setup/tools-install.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

function deps(json?: (v: unknown) => void) {
  const lines: string[] = [];
  const installed: string[] = [];
  const install: typeof installTool = async (_p, tool) => {
    installed.push(tool);
    return { via: "brew", ok: true, detail: "ok" };
  };
  const d: PrepareDeps = {
    probes: fakeProbes({ home: "/fake-home", exec: (argv) => (argv[1] === "--version" && argv[0] !== "brew" ? missing(argv[0]!) : ok()) }),
    reqs: () => [],
    json: json ?? ((v) => lines.push(JSON.stringify(v))),
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    install,
    alive: () => false,
  };
  return { d, lines, installed };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ExitSentinel) return err.code;
    throw err;
  }
}

let quiet: CapturedOut;
beforeEach(() => {
  quiet = capturePlain();
});
afterEach(() => quiet.restore());

describe("rt setup prepare", () => {
  test("--json prints the result envelope", async () => {
    const t = deps();
    expect(await exitCode(() => setupPrepare(["accounts", "--json"], {}, t.d))).toBeUndefined();
    expect(t.lines).toHaveLength(1);
    expect(JSON.parse(t.lines[0]!)).toEqual({ contract: 1, at: "2026-01-01T00:00:00.000Z", stage: "accounts", installed: ["claude", "herdr"], failed: [] });
  });

  test("an unknown stage is a usage error", async () => {
    const t = deps();
    expect(await exitCode(() => setupPrepare(["later", "--json"], {}, t.d))).toBe(2);
    expect(JSON.parse(t.lines[0]!).error).toMatchObject({ code: "bad-stage" });
    expect(t.installed).toEqual([]);
    const human = deps();
    expect(await exitCode(() => setupPrepare([], {}, human.d))).toBe(2);
    expect(quiet.stderr()).toStartWith("Pick a part of setup");
  });

  test("a json write that throws does not stop the run", async () => {
    let calls = 0;
    const t = deps(() => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    });
    expect(await exitCode(() => setupPrepare(["accounts", "--json"], {}, t.d))).toBeUndefined();
    expect(t.installed).toEqual(["claude", "herdr"]);
    expect(calls).toBe(1);
  });

  test("--json listens for errors on both pipes, so an app that quits never ends an install", async () => {
    closedPipes.reset();
    try {
      const listeners = () => [process.stdout.listenerCount("error"), process.stderr.listenerCount("error")];
      const before = listeners();
      await setupPrepare(["accounts", "--json"], {}, deps().d);
      await setupPrepare(["accounts", "--json"], {}, deps().d);
      expect(listeners()).toEqual([before[0]! + 1, before[1]! + 1]);
    } finally {
      closedPipes.reset();
    }
  });

  test("human output prints a line per tool", async () => {
    const t = deps();
    await setupPrepare(["accounts"], {}, t.d);
    const lines = quiet.stdout().trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Installed claude");
  });
});
