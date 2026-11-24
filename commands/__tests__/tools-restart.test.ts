import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { toolsRestart } from "../tools.ts";

describe("rt tools restart", () => {
  let home: string;
  let io: CapturedOut;
  let exit: ReturnType<typeof spyOn>;
  let savedTTY: boolean | undefined;
  let savedBatch: string | undefined;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tools-restart-")));
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

  const sessions = [
    { name: "work", socket: "/s/work.sock", version: "0.9.5" },
    { name: "review", socket: "/s/review.sock", version: "0.9.5" },
    { name: "fresh", socket: "/s/fresh.sock", version: "0.9.5-ms.2" },
  ];

  function herdrProbes(opts: { stuck?: string[]; broken?: boolean } = {}) {
    return fakeProbes({
      home,
      exec: (argv, o) => {
        if (argv[1] === "--version") return opts.broken ? { code: 127, stdout: "", stderr: "" } : ok("herdr 0.9.5-ms.2\n");
        if (argv[1] === "session") return ok(JSON.stringify({ sessions: sessions.map((s) => ({ name: s.name, running: true, socket_path: s.socket })) }));
        if (argv[1] === "status") {
          const s = sessions.find((x) => x.socket === o?.env?.HERDR_SOCKET_PATH);
          return ok(JSON.stringify({ running: true, version: s?.version }));
        }
        if (argv[1] === "server" && argv[2] === "stop") {
          const s = sessions.find((x) => x.socket === o?.env?.HERDR_SOCKET_PATH);
          return opts.stuck?.includes(s!.name) ? { code: 1, stdout: "", stderr: "busy" } : ok("");
        }
        return ok("");
      },
    });
  }

  test("restart herdr stops stale servers and prints them", async () => {
    const p = herdrProbes();
    await toolsRestart(["herdr"], {}, p);
    const stops = p.calls.exec.filter((argv) => argv[1] === "server" && argv[2] === "stop");
    expect(stops).toHaveLength(2);
    expect(io.stdout()).toStartWith("[ok] Restarted herdr  ");
    expect(io.stdout()).toContain("work");
    expect(io.stdout()).toContain("review");
    expect(io.stdout()).not.toContain("fresh");
    expect(io.stderr()).toBe("");
  });

  test("--json is the stopped and failed lists", async () => {
    const p = herdrProbes({ stuck: ["review"] });
    await expect(toolsRestart(["herdr", "--json"], {}, p)).rejects.toThrow("exit 1");
    const body = JSON.parse(io.stdout());
    expect(body.stopped).toEqual(["work"]);
    expect(body.failed).toEqual(["review"]);
  });

  test("a server that would not stop is named in a failure, exit 1", async () => {
    const p = herdrProbes({ stuck: ["review"] });
    await expect(toolsRestart(["herdr"], {}, p)).rejects.toThrow("exit 1");
    expect(io.stderr()).toStartWith("herdr did not stop every server\n");
    expect(io.stderr()).toContain("review");
    expect(io.stdout()).not.toContain("Restarted herdr");
  });

  test("a herdr that does not run is a failure, never Restarted herdr", async () => {
    const p = herdrProbes({ broken: true });
    await expect(toolsRestart(["herdr"], {}, p)).rejects.toThrow("exit 1");
    expect(io.stderr()).toContain("does not run");
    expect(io.stdout()).not.toContain("Restarted herdr");
    expect(p.calls.exec.some((argv) => argv[2] === "stop")).toBe(false);
  });

  test("no stale server says so instead of claiming a restart", async () => {
    const p = fakeProbes({ home, exec: (argv) => (argv[1] === "--version" ? ok("herdr 0.9.5-ms.2\n") : ok(JSON.stringify({ sessions: [] }))) });
    await toolsRestart(["herdr"], {}, p);
    expect(io.stdout()).not.toContain("Restarted herdr");
    expect(io.stdout()).toContain("already");
  });

  test("restart rejects another tool", async () => {
    const p = herdrProbes();
    await expect(toolsRestart(["claude"], {}, p)).rejects.toThrow("exit 2");
    expect(io.stderr()).toStartWith("rt can only restart herdr\n  next: rt tools restart herdr\n");
    expect(p.calls.exec).toEqual([]);
  });

  test("restart rejects another tool under --json with the usage envelope", async () => {
    await expect(toolsRestart(["claude", "--json"], {}, herdrProbes())).rejects.toThrow("exit 2");
    expect(JSON.parse(io.stdout()).error).toEqual({ code: "usage", message: "usage: rt tools restart herdr [--json]" });
    expect(io.stderr()).toBe("");
  });

  test("no tool named, off a terminal: a plain question and the command, exit 2", async () => {
    await expect(toolsRestart([], {}, herdrProbes())).rejects.toThrow("exit 2");
    expect(io.stderr()).toBe("Which tool?\n  next: rt tools restart herdr\n");
  });
});
