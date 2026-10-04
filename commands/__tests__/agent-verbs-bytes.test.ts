/** Agent-only stdout, stderr and exit codes are frozen; never regenerate this fixture after capture. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { gateAnswer, gateClose, gateList, gatePark, gateSubscribe, gateUnsubscribe, gateWait, gateAsk, waitForGate } from "../gate.ts";
import { eventsEmit, eventsList, eventsTail, eventsWait } from "../events.ts";
import { mcpToolsList, mcpToolsPayload } from "../mcp.ts";
import { ciLeaseClaim, ciLeaseHeartbeat, ciLeaseRelease, ciLeaseShow } from "../ci.ts";
import { runsFind } from "../runs-find.ts";
import { runsRunStart, runsStageStart } from "../runs-write.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "agent-verbs-bytes.json");

class Exit extends Error {
  constructor(public code: number) {
    super("process.exit sentinel");
  }
}

async function runVerb(fn: (args: string[]) => Promise<void>, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Exit(code ?? 0);
  }) as unknown as typeof process.exit);
  let code = 0;
  try {
    await fn(args);
  } catch (err) {
    if (err instanceof Exit) code = err.code;
    else throw err;
  } finally {
    exit.mockRestore();
    io.restore();
  }
  const r = { code, stdout: io.stdout(), stderr: io.stderr() };
  return r;
}

let home: string;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "rt-agent-bytes-"));
  for (const k of ["RT_DAEMON_SOCK", "RT_RUNS_ROOT", "RT_RUN_EMIT", "MATTSTACK_ATTENDANTS_DIR", "CLAUDE_CODE_SESSION_ID"]) saved[k] = process.env[k];
  // No daemon may listen on the test socket.
  process.env.RT_DAEMON_SOCK = join(home, "no-daemon.sock");
  process.env.RT_RUNS_ROOT = join(home, "runs");
  process.env.RT_RUN_EMIT = "0";
  process.env.MATTSTACK_ATTENDANTS_DIR = join(home, "attendants");
  process.env.CLAUDE_CODE_SESSION_ID = "s1";
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});

describe("agent-only verbs (frozen bytes)", () => {
  test("every captured path writes what it wrote before the output layer", async () => {
    const got: Record<string, { code: number; stdout: string; stderr: string }> = {};
    const stable = (s: string) => s.replaceAll(home, "<home>");
    const run = async (name: string, fn: (args: string[]) => Promise<void>, args: string[]) => {
      const r = await runVerb(fn, args);
      got[name] = { code: r.code, stdout: stable(r.stdout), stderr: stable(r.stderr) };
    };

    await run("gate-wait-no-id", gateWait, []);
    await run("gate-wait-bad-timeout", gateWait, ["g1", "--timeout", "soon"]);
    await run("gate-park-no-id", gatePark, []);
    await run("gate-close-no-reason", gateClose, ["g1"]);
    await run("gate-close-bad-reason", gateClose, ["g1", "--reason", "bored"]);
    await run("gate-subscribe-no-flags", gateSubscribe, []);
    await run("gate-unsubscribe-no-id", gateUnsubscribe, []);
    await run("gate-list-bad-limit", gateList, ["--limit", "many"]);
    await run("gate-ask-no-questions", gateAsk, []);
    await run("gate-ask-bad-json", gateAsk, ["--questions", "{nope"]);
    await run("gate-answer-no-id", gateAnswer, []);
    await run("events-emit-no-topic", eventsEmit, []);
    await run("events-emit-bad-json", eventsEmit, ["t.x", "--json", "{nope"]);
    await run("events-wait-no-pattern", eventsWait, []);
    await run("events-wait-bad-after", eventsWait, ["t.*", "--after", "x"]);
    await run("events-list-bad-limit", eventsList, ["--limit", "x"]);
    await run("events-tail-bad-after", eventsTail, ["--after", "x"]);
    await run("gate-wait-retry-then-answered", async () => {
      let calls = 0;
      const wait = async () => (calls++ === 0 ? { ok: false, error: "socket closed" } : { ok: true, data: { status: "answered", row: { id: "g1" } } });
      await waitForGate("g1", null, wait as never, async () => {});
    }, []);
    await run("ci-claim-no-url", ciLeaseClaim, []);
    await run("ci-claim-no-url-json", ciLeaseClaim, ["--json"]);
    await run("ci-claim-bad-holder", ciLeaseClaim, ["https://gitlab.example.com/a/b/-/merge_requests/1", "--holder", "me"]);
    await run("ci-heartbeat-no-lease", ciLeaseHeartbeat, ["https://gitlab.example.com/a/b/-/merge_requests/1", "--holder", "doctor"]);
    await run("ci-release-no-lease", ciLeaseRelease, ["https://gitlab.example.com/a/b/-/merge_requests/1", "--holder", "doctor"]);
    await run("ci-show-none", ciLeaseShow, ["https://gitlab.example.com/a/b/-/merge_requests/1"]);
    await run("ci-show-none-json", ciLeaseShow, ["https://gitlab.example.com/a/b/-/merge_requests/1", "--json"]);
    await run("runs-find-no-session", runsFind, []);
    await run("runs-find-none", runsFind, ["--session", "s-none"]);
    await run("runs-run-start-no-args", runsRunStart, []);
    await run("runs-stage-start-no-args", runsStageStart, []);

    if (process.env.RT_UPDATE_AGENT_BYTES) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      const ascii = JSON.stringify(got, null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      writeFileSync(FIXTURE, ascii + "\n");
    }
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  }, 60_000);

  test("mcp tools lists every tool name, one per line, from the roster itself", async () => {
    const r = await runVerb(mcpToolsList, []);
    expect(r).toEqual({ code: 0, stdout: mcpToolsPayload().tools.map((t) => `${t.name}\n`).join(""), stderr: "" });
  });
});
