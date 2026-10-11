import { beforeEach, describe, expect, test } from "bun:test";
import { codexAppServerStep, createCodexAppServerStep, createCodexInstall } from "../../agent-integrations/codex/install.ts";
import type { ApplyContext } from "../apply.ts";
import type { IntegrationSelection } from "../integration-selection.ts";
import type { ExecResult } from "../probes.ts";
import { codexAppServerRow } from "../validators/codex.ts";
import { toolRows } from "../validators/tools.ts";
import { fakeProbes, missing, ok } from "./fakes.ts";

const VERSION = "codex app-server daemon version";
const BOOTSTRAP = "codex app-server daemon bootstrap";
const RUNNING = ok(JSON.stringify({ status: "running", backend: "pid", socketPath: "/Users/member/.codex/app-server-control/app-server-control.sock" }));
const STOPPED = ok(JSON.stringify({ status: "stopped" }));
const UNPACKAGED: ExecResult = { code: 1, stdout: "", stderr: "Error: this CLI has no complete local package; install a packaged Codex CLI or use the standalone installer\n" };
const UNPACKAGED_COPY = "This Codex cannot run its app server. Uninstall it, then reinstall it with setup's Install, which uses OpenAI's installer";

/** `versions` answers each `version` probe in turn; the last answer repeats. */
function codexMac(versions: ExecResult[], bootstrap: ExecResult = ok(JSON.stringify({ status: "bootstrapped", backend: "pid" }))) {
  let probe = 0;
  return fakeProbes({
    home: "/Users/member",
    exec: (argv) => {
      const cmd = argv.join(" ");
      if (cmd === VERSION) return versions[Math.min(probe++, versions.length - 1)]!;
      if (cmd === BOOTSTRAP) return bootstrap;
      return missing(argv[0] ?? "");
    },
  });
}

function ctxFor(p: ReturnType<typeof fakeProbes>, extra: Partial<ApplyContext> = {}) {
  const logs: string[] = [];
  const ctx = { p, log: (_id: string, line: string) => logs.push(line), integrations: { switchOn: true, enabled: ["codex"] }, ...extra } as unknown as ApplyContext;
  return { ctx, logs };
}

const ran = (p: ReturnType<typeof fakeProbes>) => p.calls.exec.map((a) => a.join(" "));

describe("the Codex app server row", () => {
  test("running reads ready", async () => {
    expect(await codexAppServerRow(codexMac([RUNNING]))).toMatchObject({ id: "tool.codex-app-server", status: "ready", required: false, detail: "Running", action: null });
  });

  test("not running offers the step that starts it", async () => {
    for (const answer of [STOPPED, { code: 1, stdout: "", stderr: "not running" }]) {
      const row = await codexAppServerRow(codexMac([answer]));
      expect(row).toMatchObject({ status: "missing", detail: "Not running", optionalNote: "Started by Install (codex.app-server)." });
      expect(row.action).toEqual({ type: "run", label: "Start", verb: ["setup", "apply", "--only", "codex.app-server"] });
    }
  });

  test("a Codex that cannot run an app server asks for a reinstall, with no action rt cannot perform", async () => {
    const row = await codexAppServerRow(codexMac([UNPACKAGED]));
    expect(row).toMatchObject({ status: "needs-you", detail: UNPACKAGED_COPY, action: null });
  });

  test("no Codex: skipped, since the Codex row already asks for it", async () => {
    expect(await codexAppServerRow(codexMac([missing("codex")]))).toMatchObject({ status: "skipped", detail: "Codex is not installed yet", action: null });
  });

  test("a probe that times out is an error, never a start", async () => {
    expect(await codexAppServerRow(codexMac([{ code: 124, stdout: "", stderr: "" }]))).toMatchObject({ status: "error", action: null });
  });

  test("the plan lists it between the MCP entry and the hooks, only with Codex on", async () => {
    const secrets = { has: async () => null };
    const codexPolicy = async () => ({ ok: false as const, error: { code: "not-ready" as const, message: "x" } });
    const idsFor = async (integrations: IntegrationSelection) => {
      const p = codexMac([RUNNING]);
      const ids = (await toolRows(p, [], { hasBrew: false, secrets, integrations, codexPolicy })).map((r) => r.id);
      return { ids, probed: ran(p).includes(VERSION) };
    };
    const on = await idsFor({ switchOn: true, enabled: ["codex"] });
    expect(on.ids.indexOf("tool.codex-app-server")).toBe(on.ids.indexOf("tool.codex-mcp") + 1);
    expect(on.ids.indexOf("tool.codex-policy")).toBe(on.ids.indexOf("tool.codex-app-server") + 1);
    for (const integrations of [{ switchOn: false }, { switchOn: true, enabled: ["claude"] }] as IntegrationSelection[]) {
      const off = await idsFor(integrations);
      expect(off.ids).not.toContain("tool.codex-app-server");
      expect(off.probed).toBe(false);
    }
  });

  test("the row only reads: it never bootstraps", async () => {
    const p = codexMac([STOPPED]);
    await codexAppServerRow(p);
    expect(ran(p)).toEqual([VERSION]);
  });
});

describe("codex.app-server", () => {
  let waits: number[] = [];
  const step = createCodexAppServerStep({ sleep: async (ms) => void waits.push(ms) });
  beforeEach(() => {
    waits = [];
  });

  test("a server still coming up right after the bootstrap is read again until it runs", async () => {
    const p = codexMac([STOPPED, STOPPED, STOPPED, RUNNING]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "done", detail: "Started Codex's app server" });
    expect(ran(p)).toEqual([VERSION, BOOTSTRAP, VERSION, VERSION, VERSION]);
    expect(waits).toHaveLength(2);
  });

  test("the wait after the bootstrap is bounded to a few reads over about three seconds", async () => {
    const p = codexMac([STOPPED]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex said it started its app server, but it is not running" });
    expect(ran(p).filter((c) => c === VERSION)).toHaveLength(5);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3000);
  });

  test("no wait when the server runs at the first read after the bootstrap", async () => {
    await step.run(ctxFor(codexMac([STOPPED, RUNNING])).ctx);
    expect(waits).toEqual([]);
  });

  test("is an rt step, update-safe, and applies only with Codex turned on", () => {
    expect(codexAppServerStep).toMatchObject({ id: "codex.app-server", kind: "rt", updateSafe: true });
    expect(codexAppServerStep.applies(ctxFor(codexMac([RUNNING])).ctx)).toBe(true);
    expect(codexAppServerStep.applies(ctxFor(codexMac([RUNNING]), { integrations: { switchOn: true, enabled: ["claude"] } }).ctx)).toBe(false);
    expect(codexAppServerStep.applies(ctxFor(codexMac([RUNNING]), { integrations: { switchOn: false } }).ctx)).toBe(false);
  });

  test("Codex's adapter runs it after the MCP entry and before the policy hooks", () => {
    expect(createCodexInstall().steps().map((s) => s.id)).toEqual(["codex.mcp", "codex.app-server", "codex.policy"]);
  });

  test("already running: nothing is started", async () => {
    const p = codexMac([RUNNING]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "skipped", detail: "Already running" });
    expect(ran(p)).toEqual([VERSION]);
  });

  test("not running: bootstraps it, then reads it running", async () => {
    const p = codexMac([STOPPED, RUNNING]);
    const { ctx, logs } = ctxFor(p);
    expect(await step.run(ctx)).toEqual({ state: "done", detail: "Started Codex's app server" });
    expect(ran(p)).toEqual([VERSION, BOOTSTRAP, VERSION]);
    expect(logs).toEqual(["started Codex's app server"]);
  });

  test("an update run brings a stopped server back, the way a reboot leaves it", async () => {
    const p = codexMac([STOPPED, RUNNING]);
    expect(await step.run(ctxFor(p, { update: true }).ctx)).toEqual({ state: "done", detail: "Started Codex's app server" });
    expect(ran(p)).toEqual([VERSION, BOOTSTRAP, VERSION]);
  });

  test("a bootstrap that holds its output open past the deadline still counts once the server reads running", async () => {
    const p = codexMac([STOPPED, RUNNING], { code: 124, stdout: "", stderr: "" });
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "done", detail: "Started Codex's app server" });
  });

  test("a bootstrap that fails is a plain needs-you that does not stop Install", async () => {
    const p = codexMac([STOPPED], { code: 1, stdout: "", stderr: "Error: address in use\nmore" });
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex could not start its app server (exit 1): Error: address in use" });
  });

  test("a bootstrap that times out with nothing running says so", async () => {
    const p = codexMac([STOPPED], { code: 124, stdout: "", stderr: "" });
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex's app server did not start in time. Start it again from setup's checklist" });
  });

  test("a bootstrap that reports success but leaves nothing running is not claimed started", async () => {
    const p = codexMac([STOPPED]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex said it started its app server, but it is not running" });
  });

  test("a Codex without its packaged install asks for a reinstall, whether the probe or the bootstrap says so", async () => {
    const atProbe = codexMac([UNPACKAGED]);
    expect(await step.run(ctxFor(atProbe).ctx)).toEqual({ state: "needs-you", detail: UNPACKAGED_COPY });
    expect(ran(atProbe)).toEqual([VERSION]);

    const atBootstrap = codexMac([STOPPED], UNPACKAGED);
    expect(await step.run(ctxFor(atBootstrap).ctx)).toEqual({ state: "needs-you", detail: UNPACKAGED_COPY });
    expect(ran(atBootstrap)).toEqual([VERSION, BOOTSTRAP]);
  });

  test("no Codex: skipped, and nothing is started", async () => {
    const p = codexMac([missing("codex")]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "skipped", detail: "Codex is not installed yet" });
    expect(ran(p)).toEqual([VERSION]);
  });

  test("a probe that times out starts nothing", async () => {
    const p = codexMac([{ code: 124, stdout: "", stderr: "" }]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex did not say in time whether its app server is running. Check again in a moment" });
    expect(ran(p)).toEqual([VERSION]);
  });

  test("never asks for remote control, an update or a stop", async () => {
    const p = codexMac([STOPPED, RUNNING]);
    await step.run(ctxFor(p).ctx);
    for (const argv of p.calls.exec) {
      expect(argv).not.toContain("--remote-control");
      expect(argv).not.toContain("update");
      expect(argv).not.toContain("stop");
    }
  });
});
