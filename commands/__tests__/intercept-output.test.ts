import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as cliLogger from "../../lib/cli-logger.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { teamSettingsPath } from "../../lib/rt-paths.ts";
import { runInterception } from "../../lib/endpoint/run.ts";
import {
  installBlocks,
  interceptInstall,
  interceptNote,
  interceptRun,
  interceptStatus,
  interceptUninstall,
  isDebugTrace,
  statusBlocks,
  uninstallBlocks,
} from "../intercept.ts";

const origHome = process.env.HOME;
let home: string;
let io: CapturedOut;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-intercept-out-")));
  process.env.HOME = home;
  closeStateDb();
  io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
});

afterEach(() => {
  io.restore();
  process.env.HOME = origHome;
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
});

describe("rt intercept --json is frozen", () => {
  test("status on a fresh home", async () => {
    await interceptStatus(["--json"]);
    expect(io.stdout()).toBe('{"ok":true,"shims":[],"rulesByRepo":{},"daemonUp":false,"stale":{"stale":false}}\n');
  });

  test("install with no rules", async () => {
    await interceptInstall(["--json"]);
    expect(io.stdout()).toBe('{"ok":true,"installed":[],"current":[],"skipped":[],"rules":0}\n');
  });

  test("uninstall with nothing to remove", async () => {
    await interceptUninstall(["--json"]);
    expect(io.stdout()).toBe('{"ok":true,"removed":[]}\n');
  });
});

describe("rt intercept, read by a person", () => {
  const report = [
    { command: "pnpm", repo: "example.com/acme/widgets", installed: true, current: true },
    { command: "doppler", repo: "example.com/acme/widgets", installed: true, current: false },
    { command: "vite", repo: "example.com/acme/gadgets", installed: false, current: false },
  ];

  // staleIntercepts()'s own wording (lib/endpoint/shim.ts), not this slice's to change.
  const staleReason = "/Users/sample/.mattstack/user/settings.jsonc newer than the cached intercept rules";

  test("status: a shim that is not installed yet is pending, never coral", () => {
    const text = renderPlain(statusBlocks(report, { "example.com/acme/widgets": 2, "example.com/acme/gadgets": 1 }, true, { stale: true, reason: staleReason }));
    expect(text).toBe(
      [
        "[running] The rt daemon is running",
        "[ok] pnpm  example.com/acme/widgets, 2 rules",
        "[out of date] doppler  example.com/acme/widgets, 2 rules; its shim is out of date",
        "[not yet] vite  example.com/acme/gadgets, 1 rule; not installed yet",
        `[out of date] The saved rules are behind your settings  ${staleReason}`,
        "  next: rt intercept install",
        "",
      ].join("\n"),
    );
    expect(text).not.toContain("[failed]");
  });

  test("status with no rules says how to add one", () => {
    expect(renderPlain(statusBlocks([], {}, false, { stale: false }))).toBe(
      "[off] The rt daemon is not running  intercepted commands run as they are\n[not yet] No commands are intercepted yet\n  next: Add rules under rt.intercepts in your settings, then run rt intercept install\n",
    );
  });

  test("status with no rules and a stale cache points at install alone", () => {
    expect(renderPlain(statusBlocks([], {}, true, { stale: true, reason: staleReason }))).toBe(
      `[running] The rt daemon is running\n[not yet] No commands are intercepted yet\n[out of date] The saved rules are behind your settings  ${staleReason}\n  next: rt intercept install\n`,
    );
  });

  test("status with everything current needs no next step", () => {
    expect(renderPlain(statusBlocks([report[0]!], { "example.com/acme/widgets": 2 }, true, { stale: false }))).toBe(
      "[running] The rt daemon is running\n[ok] pnpm  example.com/acme/widgets, 2 rules\n",
    );
  });

  test("install: what was written, what was current, and what rt left alone", () => {
    expect(renderPlain(installBlocks({ installed: ["pnpm"], current: ["vite"], skipped: ["doppler"], rules: 3 }))).toBe(
      "[ok] Installed  pnpm\n[ok] Already current  vite\n[refused] Left alone, because rt did not make them  doppler\nRules: 3\n",
    );
    expect(renderPlain(installBlocks({ installed: [], current: [], skipped: [], rules: 0 }))).toBe("[skipped] No commands to intercept\nRules: 0\n");
  });

  test("uninstall: removed, or nothing to remove", () => {
    expect(renderPlain(uninstallBlocks({ removed: ["pnpm", "vite"] }))).toBe("[ok] Removed  pnpm, vite\n");
    expect(renderPlain(uninstallBlocks({ removed: [] }))).toBe("[skipped] Nothing to remove\n");
  });

  test("the human status goes to stdout through the layer", async () => {
    await interceptStatus([]);
    expect(io.stdout()).toBe("[off] The rt daemon is not running  intercepted commands run as they are\n[not yet] No commands are intercepted yet\n  next: Add rules under rt.intercepts in your settings, then run rt intercept install\n");
  });

  test("the human install and uninstall go to stdout through the layer", async () => {
    await interceptInstall([]);
    await interceptUninstall([]);
    expect(io.stdout()).toBe("[skipped] No commands to intercept\nRules: 0\n[skipped] Nothing to remove\n");
    expect(io.stderr()).toBe("");
  });

  describe("run with no command", () => {
    let savedTTY: boolean | undefined;
    const setTTY = (value: boolean | undefined) => Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });

    beforeEach(() => {
      savedTTY = process.stdin.isTTY;
      setTTY(false);
    });
    afterEach(() => setTTY(savedTTY));

    test("is a usage failure on stderr, nothing on stdout, exit 1", async () => {
      const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`);
      }) as typeof process.exit);
      try {
        await expect(interceptRun([])).rejects.toThrow("exit 1");
      } finally {
        exit.mockRestore();
      }
      expect(io.stderr()).toBe("Which command should rt run?\n  next: rt intercept run <command> -- [args...]\n");
      expect(io.stdout()).toBe("");
    });
  });

  test("a shim note is one warn line on stderr and nothing on stdout", () => {
    interceptNote('rt-intercept: passthrough ... role "web" is not declared for repo "widgets"');
    expect(io.stderr()).toBe('[warning] rt-intercept: passthrough ... role "web" is not declared for repo "widgets"\n');
    expect(io.stdout()).toBe("");
  });

  describe("a debug trace is a log line, never a warning", () => {
    const traces = ["rt-intercept: match command=pnpm repo=widgets role=web cwd=/w/widgets", 'rt-intercept: claim result={"ok":false}'];
    let logged: ReturnType<typeof spyOn>;
    const savedLevel = process.env.RT_LOG_LEVEL;
    const savedDebug = process.env.RT_INTERCEPT_DEBUG;

    beforeEach(() => {
      logged = spyOn(cliLogger, "logCliEvent").mockImplementation(() => {});
      delete process.env.RT_LOG_LEVEL;
      delete process.env.RT_INTERCEPT_DEBUG;
    });
    afterEach(() => {
      logged.mockRestore();
      if (savedLevel === undefined) delete process.env.RT_LOG_LEVEL;
      else process.env.RT_LOG_LEVEL = savedLevel;
      if (savedDebug === undefined) delete process.env.RT_INTERCEPT_DEBUG;
      else process.env.RT_INTERCEPT_DEBUG = savedDebug;
    });

    test("at the default level it goes to the log at debug and prints nothing", () => {
      for (const t of traces) interceptNote(t);
      expect(logged.mock.calls).toEqual(traces.map((t) => ["debug", "intercept", t]));
      expect(io.stderr()).toBe("");
      expect(io.stdout()).toBe("");
    });

    test("under RT_LOG_LEVEL=debug it is also a plain line on stderr", () => {
      process.env.RT_LOG_LEVEL = "debug";
      for (const t of traces) interceptNote(t);
      expect(logged.mock.calls).toEqual(traces.map((t) => ["debug", "intercept", t]));
      expect(io.stderr()).toBe(traces.map((t) => `  ${t}\n`).join(""));
      expect(io.stderr()).not.toContain("[warning]");
      expect(io.stdout()).toBe("");
    });

    test("under RT_INTERCEPT_DEBUG=1 it is also a plain line on stderr", () => {
      process.env.RT_INTERCEPT_DEBUG = "1";
      for (const t of traces) interceptNote(t);
      expect(logged.mock.calls).toEqual(traces.map((t) => ["debug", "intercept", t]));
      expect(io.stderr()).toBe(traces.map((t) => `  ${t}\n`).join(""));
      expect(io.stdout()).toBe("");
    });

    test("the log copy has its credentials redacted", () => {
      interceptNote('rt-intercept: claim result={"ok":false,"error":"fetch https://oauth2:sample-secret@example.com/acme/widgets.git failed"}');
      expect(logged.mock.calls).toEqual([["debug", "intercept", 'rt-intercept: claim result={"ok":false,"error":"fetch https://[redacted]@example.com/acme/widgets.git failed"}']]);
    });
  });

  describe("the trace test matches what the shim's core actually says", () => {
    function writeRepoRoles(identity: string, roles: unknown): void {
      const path = teamSettingsPath("acme");
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, JSON.stringify({ repos: { [identity]: { "rt.roles": roles } } }));
    }

    test("match and claim result are traces, a passthrough is not", async () => {
      writeRepoRoles("x/test/r1", { web: { env: { PORT: "${port}" } } });
      const warned: string[] = [];
      const deps = {
        rules: [{ command: "fakecmd", repo: "r1", repoRemote: "git@x:test/r1.git", matches: [{ cwdGlob: ".", argPattern: "serve", role: "web" }] }],
        gitToplevel: async () => "/wt/a",
        gitRemote: async () => "git@x:test/r1.git",
        claim: async () => null,
        execReal: async (): Promise<never> => {
          throw new Error("EXEC");
        },
        resolveRealBinary: () => "/usr/bin/fakecmd",
        warn: (m: string) => warned.push(m),
      };
      await runInterception(deps as any, "fakecmd", ["serve"], "/wt/a", { PATH: "/usr/bin", RT_INTERCEPT_DEBUG: "1" }, 42).catch((e: Error) => {
        if (e.message !== "EXEC") throw e;
      });
      expect(warned).toHaveLength(3);
      expect(warned.filter(isDebugTrace)).toEqual([warned[0]!, warned[1]!]);
      expect(warned[0]).toStartWith("rt-intercept: match ");
      expect(warned[1]).toStartWith("rt-intercept: claim result=");
      expect(warned[2]).toContain("passthrough");
      expect(isDebugTrace(warned[2]!)).toBe(false);
    });
  });

  test("a note that cannot be written never throws", () => {
    const real = process.stderr.write;
    process.stderr.write = (() => {
      throw new Error("EPIPE");
    }) as typeof process.stderr.write;
    try {
      expect(() => interceptNote("rt-intercept: passthrough")).not.toThrow();
    } finally {
      process.stderr.write = real;
    }
  });
});
