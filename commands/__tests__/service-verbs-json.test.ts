/**
 * The service verbs' --json replies are read by the tray and by agents.
 * Pinned before the output layer touches the files; only a human sentence
 * inside an exit-2 envelope (error.message) may change words after.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { appsList, type AppsDeps } from "../apps.ts";
import { servicesList, type ServicesDeps } from "../services.ts";
import { bgRelease, bgStatus, bgStop } from "../bg.ts";
import { reconcilerClear, reconcilerStatus } from "../reconciler.ts";
import { fakeProbes, fakeTray } from "../../lib/setup/__tests__/fakes.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const at = (s: string) => s.replace(/"at":"[^"]+"/g, '"at":"<at>"');

let home: string;
let origHome: string | undefined;
let server: ReturnType<typeof Bun.serve>;
let replies: Record<string, unknown> = {};

beforeAll(() => {
  origHome = process.env.HOME;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-service-json-")));
  process.env.HOME = home;
  mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
  server = Bun.serve({
    unix: join(home, ".mattstack", "rt", "rt.sock"),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      return Response.json(replies[cmd] ?? { ok: false, error: `unknown command: ${cmd}` });
    },
  });
});

afterAll(() => {
  server.stop(true);
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

class Exit extends Error {
  constructor(public code: number) {
    super("exit");
  }
}

async function captured(fn: () => Promise<void>): Promise<{ code: number; stdout: string }> {
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new Exit(c ?? 0);
  }) as unknown as typeof process.exit);
  let code = 0;
  try {
    await fn();
  } catch (e) {
    if (e instanceof Exit) code = e.code;
    else throw e;
  } finally {
    exit.mockRestore();
    io.restore();
  }
  const r = { code, stdout: io.stdout() };
  return r;
}

function appsDeps(lines: string[], deck: Record<string, () => { status: number; body: string }>): AppsDeps {
  const probes = fakeProbes({ home: "/home/x" });
  return {
    probes: { ...probes, fetch: async (url: string, init?: { method?: string }) => (deck[`${init?.method ?? "GET"} ${new URL(url).pathname}`] ?? (() => ({ status: 404, body: "", headers: {} })))() } as never,
    print: (s) => lines.push(s),
    exit: ((c: number) => {
      throw new Exit(c);
    }) as never,
  };
}

describe("service verbs --json (frozen shape)", () => {
  test("apps list --json, deck down, keeps its envelope shape and code", async () => {
    const lines: string[] = [];
    await expect(appsList(["--json"], {}, appsDeps(lines, {}))).rejects.toThrow();
    const body = JSON.parse(lines[0]!);
    expect(Object.keys(body).sort()).toEqual(["at", "contract", "error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.error.code).toBe("deck-not-running");
  });

  test("services list --json is the agents envelope", async () => {
    const lines: string[] = [];
    const agents = [{ label: "com.mattstack.daemon", status: "enabled" }];
    const deps: ServicesDeps = {
      probes: fakeProbes({ home: "/home/x", tray: fakeTray({ "GET /services": () => ({ status: 200, json: { agents } }) }) }),
      print: (s) => lines.push(s),
      warn: () => {},
      exit: ((c: number) => {
        throw new Exit(c);
      }) as never,
    };
    await servicesList(["--json"], {}, deps);
    expect(at(lines[0]!)).toBe('{"contract":1,"at":"<at>","agents":[{"label":"com.mattstack.daemon","status":"enabled"}]}');
  });

  test("bg and reconciler --json lines are the daemon data spread after ok", async () => {
    replies = { "bg:status": { ok: true, data: { up: true, socket: "/tmp/bg.sock", claims: [{ owner: "runner", pane: "bg:w1:p1", createdAt: 1 }] } } };
    expect((await captured(() => bgStatus(["--json"]))).stdout).toBe('{"ok":true,"up":true,"socket":"/tmp/bg.sock","claims":[{"owner":"runner","pane":"bg:w1:p1","createdAt":1}]}\n');
    replies = { "bg:release": { ok: true, data: { released: true } } };
    expect((await captured(() => bgRelease(["runner", "--json"]))).stdout).toBe('{"ok":true,"released":true}\n');
    replies = { "bg:stop": { ok: true, data: { stopped: true } } };
    expect((await captured(() => bgStop(["--json"]))).stdout).toBe('{"ok":true,"stopped":true}\n');
    replies = { "reconciler:status": { ok: true, data: { sweptAt: 0, herdrReachable: true, executors: [] } } };
    expect((await captured(() => reconcilerStatus(["--json"]))).stdout).toBe('{"ok":true,"sweptAt":0,"herdrReachable":true,"executors":[]}\n');
    replies = { "reconciler:clear": { ok: true, data: { cleared: true } } };
    expect((await captured(() => reconcilerClear(["ag-1", "--json"]))).stdout).toBe('{"ok":true,"cleared":true}\n');
  });

  test("bg stop --json with live claims: stdout empty, exit 1", async () => {
    replies = { "bg:stop": { ok: false, error: "bg server has live claims: runner, herd:h-1" } };
    expect(await captured(() => bgStop(["--json"]))).toEqual({ code: 1, stdout: "" });
  });
});
