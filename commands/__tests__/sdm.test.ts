import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { logsDir } from "../../lib/rt-paths.ts";
import type { SdmConnection } from "../../lib/sdm/browse.ts";
import type { SdmHealth, SdmResourceState, SdmSnapshot } from "../../lib/sdm/core.ts";
import type { GuidedTarget } from "../../lib/sdm/flow.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { connectCmd, loginCmd, __test__ } from "../sdm.ts";

// mock.module mutates the live namespace in place, so the real functions are kept before any mock.
const realApp = await import("../../lib/sdm/app.ts");
const realEnsureSdmApp = realApp.ensureSdmApp;
const realBrowserLogin = await import("../../lib/sdm/browser-login.ts");
const realRunBrowserLogin = realBrowserLogin.runBrowserLogin;
const realCore = await import("../../lib/sdm/core.ts");
const realConnectResource = realCore.connectResource;
const realRequestAccess = realCore.requestAccess;
const realFlow = await import("../../lib/sdm/flow.ts");
const realRunGuidedConnect = realFlow.runGuidedConnect;

const FAKE = resolve(import.meta.dir, "..", "..", "lib", "ui", "__tests__", "fake-rt-ui.ts");
const target: GuidedTarget = { key: "demo:q", label: "Acme QA", sdmResource: "example-q", tier: "qa", db: { database: "acme", schema: "app" } };
const failed = (f: out.FailureInput): string => renderPlain([out.failure(f)]);

function cliLogLines(): Record<string, unknown>[] {
  const dir = logsDir();
  if (!existsSync(dir)) return [];
  const file = readdirSync(dir).filter((f) => f.startsWith("cli.") && f.endsWith(".log")).sort().at(-1);
  if (!file) return [];
  return readFileSync(join(dir, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("withProgress", () => {
  let dir: string;
  let record: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-sdm-progress-"));
    record = join(dir, "record.ndjson");
    process.env.RT_UI_BIN = FAKE;
    process.env.RT_UI_FAKE = JSON.stringify({ record });
    // Whether a person is there is the gate's answer, never the real stdin; each test says which.
    gate.setInteractive(() => true);
  });
  afterEach(() => {
    gate.setInteractive(undefined);
    delete process.env.RT_UI_BIN;
    delete process.env.RT_UI_FAKE;
    rmSync(dir, { recursive: true, force: true });
  });

  const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  test("at a terminal the child's lines are sub-lines of a step that is cleared, and each reaches the log", async () => {
    const r = await __test__.withProgress("Connecting to Acme QA", true, async (onLine) => {
      onLine("dialing");
      onLine("tunnel up");
      return 7;
    });
    expect(r).toEqual({ value: 7, tail: ["dialing", "tunnel up"] });
    expect(sent()).toEqual([
      { t: "hello", protocol: 1 },
      { t: "start", title: "Connecting to Acme QA" },
      { t: "sub", text: "dialing" },
      { t: "sub", text: "tunnel up" },
      { t: "done", title: "Connecting to Acme QA", clear: true },
    ]);
    const logged = cliLogLines().filter((l) => l.module === "sdm").map((l) => [l.level, l.msg]);
    expect(logged.slice(-2)).toEqual([["debug", "dialing"], ["debug", "tunnel up"]]);
  });

  test("off a terminal no step is drawn, and the lines still come back and reach the log", async () => {
    gate.setInteractive(() => false);
    const r = await __test__.withProgress("Connecting to Acme QA", true, async (onLine) => {
      onLine("quiet line");
      return "ok";
    });
    expect(r).toEqual({ value: "ok", tail: ["quiet line"] });
    expect(existsSync(record)).toBe(false);
    expect(cliLogLines().filter((l) => l.module === "sdm").at(-1)?.msg).toBe("quiet line");
  });

  test("a caller that must stay quiet draws nothing even at a terminal", async () => {
    const r = await __test__.withProgress("Connecting to Acme QA", false, async () => 1);
    expect(r.value).toBe(1);
    expect(existsSync(record)).toBe(false);
  });

  test("a StrongDM auth url reaches the step, the tail and the log with its token redacted", async () => {
    const r = await __test__.withProgress("Logging in to StrongDM", true, async (onLine) => {
      onLine("open https://sdm.example/auth-confirm-native/tok123secret to finish");
      return null;
    });
    const redacted = "open https://sdm.example/auth-confirm-native/<redacted> to finish";
    expect(r.tail).toEqual([redacted]);
    expect(sent()).toContainEqual({ t: "sub", text: redacted });
    expect(cliLogLines().filter((l) => l.module === "sdm").at(-1)?.msg).toBe(redacted);
    expect(JSON.stringify(cliLogLines())).not.toContain("tok123secret");
  });

  test("logLine redacts on its own", () => {
    __test__.logLine("visit https://sdm.example/auth-confirm-native/tok456secret");
    expect(cliLogLines().filter((l) => l.module === "sdm").at(-1)?.msg).toBe("visit https://sdm.example/auth-confirm-native/<redacted>");
  });

  test("only the last five lines come back", async () => {
    gate.setInteractive(() => false);
    const r = await __test__.withProgress("x", true, async (onLine) => {
      for (const n of [1, 2, 3, 4, 5, 6, 7]) onLine(`line ${n}`);
      return null;
    });
    expect(r.tail).toEqual(["line 3", "line 4", "line 5", "line 6", "line 7"]);
  });

  test("a missing helper costs the step, never the task", async () => {
    process.env.RT_UI_BIN = join(dir, "no-such-binary");
    const r = await __test__.withProgress("Connecting to Acme QA", true, async (onLine) => {
      onLine("still works");
      return 3;
    });
    expect(r).toEqual({ value: 3, tail: ["still works"] });
  });

  test("a helper that dies mid-step does not fail the task", async () => {
    process.env.RT_UI_FAKE = JSON.stringify({ record, dieOn: "start" });
    const r = await __test__.withProgress("Connecting to Acme QA", true, async (onLine) => {
      await Bun.sleep(50);
      onLine("after the helper died");
      return 4;
    });
    expect(r).toEqual({ value: 4, tail: ["after the helper died"] });
  });

  test("a task that throws clears its step as failed", async () => {
    await expect(
      __test__.withProgress("Connecting to Acme QA", true, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(sent().at(-1)).toEqual({ t: "done", title: "Connecting to Acme QA", status: "failed", clear: true });
  });
});

describe("sdm blocks", () => {
  const verified = { ok: true, attempts: 1, latencyMs: 42, lastError: null };

  test("a verified connect is two done lines", () => {
    const text = renderPlain(__test__.connectedBlocks(target, { outcome: "connected", address: "127.0.0.1:15432", verify: verified }));
    expect(text).toBe("[ok] Acme QA is ready  127.0.0.1:15432 (acme/app)\n[ok] A test query worked  42ms, 1 attempt\n");
  });

  test("an unconfirmed tunnel is a warning with what to do, never a failure", () => {
    const text = renderPlain(
      __test__.connectedBlocks({ ...target, db: undefined }, { outcome: "connected", address: "127.0.0.1:15432", unverified: true, verify: { ok: false, attempts: 5, latencyMs: null, lastError: new Error("Connection closed") } }),
    );
    expect(text).toBe(
      "[ok] Acme QA is ready  127.0.0.1:15432\n" +
        "[warning] The tunnel is up, but a test query did not confirm it  Connection closed\n" +
        "  note: It is likely usable. Try your query again, and reconnect if it keeps failing.\n",
    );
  });

  test("a failed connect names the stage in plain words and the command the flow gave", () => {
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "health", error: "StrongDM did not answer." }))).toBe(
      "StrongDM is not available on this Mac\n  why: StrongDM did not answer.\n",
    );
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "login", error: "StrongDM says you are not logged in." }))).toBe(
      "You are not logged in to StrongDM\n  why: StrongDM says you are not logged in.\n  next: rt sdm login\n",
    );
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "connect", error: "no route to gateway", hint: "Log in to StrongDM again, then connect.", next: "rt sdm login" }))).toBe(
      "Could not connect to Acme QA\n  why: no route to gateway\n  next: rt sdm login\n",
    );
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "access", error: "denied", hint: "Check the connection name, or ask for access with a reason." }))).toBe(
      "Could not get access to Acme QA\n  why: denied\n  next: Check the connection name, or ask for access with a reason.\n",
    );
    expect(
      failed(__test__.connectFailure(target, { outcome: "failed", stage: "verify", error: "The tunnel did not answer: timeout", hint: "Connect again, or check this connection in the StrongDM app.", next: "rt sdm connect demo:q" })),
    ).toBe("Acme QA did not come up\n  why: The tunnel did not answer: timeout\n  next: rt sdm connect demo:q\n");
  });

  test("a health failure says what is wrong in plain words for each status", () => {
    expect(failed(__test__.healthFailure({ status: "not-authenticated", message: null }))).toBe("You are not logged in to StrongDM\n  next: rt sdm login\n");
    expect(failed(__test__.healthFailure({ status: "not-installed", message: null }))).toBe(
      "The StrongDM CLI is not installed\n  next: Install it from strongdm.com/docs/cli (https://www.strongdm.com/docs/cli/)\n",
    );
    expect(failed(__test__.healthFailure({ status: "error", message: "boom" }))).toBe("StrongDM is not answering\n  why: boom\n");
  });

  test("only a login that needs a person names the manual login on its next: line", () => {
    expect(failed(__test__.manualLoginFailure("No Chrome or Chromium browser found."))).toBe(
      "StrongDM needs you to log in by hand\n  why: No Chrome or Chromium browser found.\n  next: rt sdm login --manual\n",
    );
    // A silent login that failed: watch it next, with the manual login as a tip, never on the next: line.
    const silent = renderPlain([out.failure(__test__.loginFailure("The login did not finish.", false)), ...__test__.loginTip(false)]);
    expect(silent).toBe(
      "Could not log in to StrongDM\n  why: The login did not finish.\n  next: rt sdm login --visible\n  tip: If the browser login keeps failing, log in by hand: rt sdm login --manual\n",
    );
    expect(silent).not.toContain("next: rt sdm login --manual");
    // A watched login that failed: the manual login is what is left.
    expect(failed(__test__.loginFailure("The login did not finish.", true))).toBe(
      "Could not log in to StrongDM\n  why: The login did not finish.\n  next: rt sdm login --manual\n",
    );
    expect(__test__.loginTip(true)).toEqual([]);
  });

  const snapshot = (status: SdmHealth["status"], resources: Array<[string, SdmResourceState]> = []): SdmSnapshot => ({
    health: { status, message: status === "ok" ? null : "boom" },
    resources: new Map(resources),
  });

  test("status: a tunnel is a running row, a stopped app is off, and nothing is coral", () => {
    const text = renderPlain(
      __test__.statusBlocks(
        snapshot("ok", [
          ["example-q", { connected: true, address: "127.0.0.1:15432", expiry: "5h" }],
          ["example-d", { connected: false, address: null, expiry: null }],
        ]),
        false,
      ),
    );
    expect(text).toBe(
      "[off] The StrongDM app is not running  rt starts it when you connect\n" +
        "[ok] Logged in to StrongDM\n" +
        "[running] example-q  127.0.0.1:15432, until 5h\n",
    );
    expect(renderPlain(__test__.statusBlocks(snapshot("ok"), true))).toBe("[ok] Logged in to StrongDM\n[off] No tunnels open\n");
  });

  test("status: not logged in waits on the person, a missing CLI is not yet, only a dead CLI is a failure", () => {
    expect(renderPlain(__test__.statusBlocks(snapshot("not-authenticated"), true))).toBe("[needs you] You are not logged in to StrongDM\n  next: rt sdm login\n");
    expect(renderPlain(__test__.statusBlocks(snapshot("not-installed"), true))).toBe(
      "[not yet] The StrongDM CLI is not installed\n  note: Install it from strongdm.com/docs/cli (https://www.strongdm.com/docs/cli/)\n",
    );
    expect(renderPlain(__test__.statusBlocks(snapshot("error"), true))).toBe("[failed] StrongDM is not answering  boom\n");
  });

  test("connections is one table: state, label, tier, key", () => {
    const conn = (key: string, label: string, tier?: string, standingAccess = false): SdmConnection => ({ key, label, sdmResource: `example-${key}`, tier, standingAccess });
    const text = renderPlain(
      __test__.connectionsBlocks(
        [conn("demo:q", "Acme QA", "qa"), conn("demo:s", "Acme Staging", "staging", true), conn("demo:d", "Dev")],
        new Map([["example-demo:q", { connected: true, address: "127.0.0.1:15432", expiry: null }]]),
      ),
    );
    const cols = (cells: string[]): string => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd([15, 12, 7][i]!))).join("  ");
    expect(text).toBe(
      cols(["connected", "Acme QA", "qa", "demo:q"]) + "\n" + cols(["standing access", "Acme Staging", "staging", "demo:s"]) + "\n" + cols(["on request", "Dev", "", "demo:d"]) + "\n",
    );
    expect(renderPlain(__test__.connectionsBlocks([], new Map()))).toBe("[skipped] No StrongDM connections to show\n  next: rt sdm refresh\n");
  });

  test("refresh says how many it found, and a scan problem is a warning above the count", () => {
    expect(renderPlain(__test__.refreshBlocks(3))).toBe("[ok] Found 3 StrongDM connections\n");
    expect(renderPlain(__test__.refreshBlocks(0))).toBe("[skipped] Found 0 StrongDM connections  check your StrongDM access\n");
    expect(renderPlain(__test__.refreshBlocks(1, "timed out"))).toBe("[warning] The scan had a problem  timed out\n[ok] Found 1 StrongDM connection\n");
  });

  test("enrichment shows the file and how many connections have a label", () => {
    expect(renderPlain(__test__.enrichmentBlocks("/x/enrichment.jsonc", 0, 2))).toBe(
      "labels file: /x/enrichment.jsonc\n[not yet] 0 of 2 connections have a label  the rest show their StrongDM names\n",
    );
    expect(renderPlain(__test__.enrichmentBlocks("/x/enrichment.jsonc", 2, 2))).toBe("labels file: /x/enrichment.jsonc\n[ok] 2 of 2 connections have a label\n");
    expect(renderPlain(__test__.enrichmentBlocks("/x/enrichment.jsonc", 0, 0))).toBe("labels file: /x/enrichment.jsonc\n[skipped] StrongDM shows no connections to label\n");
  });

  test("enrichment counts read as English for one connection and for many", () => {
    const counted = (enriched: number, total: number): string => renderPlain(__test__.enrichmentBlocks("/x/e.jsonc", enriched, total)).split("\n")[1]!;
    expect(counted(1, 1)).toBe("[ok] 1 of 1 connection has a label");
    expect(counted(1, 3)).toBe("[not yet] 1 of 3 connections has a label  the rest show their StrongDM names");
    expect(counted(2, 3)).toBe("[not yet] 2 of 3 connections have a label  the rest show their StrongDM names");
    expect(counted(0, 1)).toBe("[not yet] 0 of 1 connection have a label  the rest show their StrongDM names");
  });

  test("a health or login failure keeps every line of its reason, since no excerpt follows it", () => {
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "health", error: "StrongDM could not reach its API\nCheck your network, then try again." }))).toBe(
      "StrongDM is not available on this Mac\n  why: StrongDM could not reach its API Check your network, then try again.\n",
    );
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "login", error: "session expired\nhttps://sdm.example/auth-confirm-native/tok1secret" }))).toBe(
      "You are not logged in to StrongDM\n  why: session expired https://sdm.example/auth-confirm-native/<redacted>\n  next: rt sdm login\n",
    );
  });

  test("a failed connect's why is the last line StrongDM printed, never the whole output squashed", () => {
    expect(failed(__test__.connectFailure(target, { outcome: "failed", stage: "connect", error: "dialing gateway\n\nerror: no route to gateway\n" }))).toBe(
      "Could not connect to Acme QA\n  why: error: no route to gateway\n",
    );
  });
});

describe("sdm verbs", () => {
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    io = captureOut();
    io.reset();
    out.__test__.setHuman(() => false);
    gate.setInteractive(() => false);
  });
  afterEach(() => {
    io.restore();
    gate.setInteractive(undefined);
    // The verbs report through process.exitCode; a value left behind would fail the whole run.
    process.exitCode = 0;
  });

  test("connect with --json and no key writes the same envelope", async () => {
    await connectCmd(["--json"]);
    expect(io.stdout()).toBe(
      '{\n  "ok": false,\n  "stage": "health",\n  "error": "a connection key is required with --json",\n  "hint": "rt sdm connections --json lists valid keys"\n}\n',
    );
    expect(io.stderr()).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("a production connect from a script is refused on stderr and stdout stays empty", async () => {
    await __test__.guidedConnect({ ...target, production: true }, { interactive: false });
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe(
      "[refused] Acme QA is a production connection\n  why: A person has to say yes to a production connection.\n  next: rt sdm connect demo:q --confirm-production\n",
    );
    expect(process.exitCode).toBe(1);
  });

  test("the same refusal under --json is the envelope on stdout and nothing on stderr", async () => {
    await __test__.guidedConnect({ ...target, production: true }, { interactive: false, json: true });
    expect(io.stdout()).toBe(
      '{\n  "ok": false,\n  "stage": "confirm",\n  "error": "Acme QA is a production resource; a human must approve. Re-run with --confirm-production.",\n  "hint": null\n}\n',
    );
    expect(io.stderr()).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("a failure's excerpt is the last five child lines, indented under a caption", () => {
    out.fail(__test__.connectFailure(target, { outcome: "failed", stage: "connect", error: "exit 1" }), ...__test__.excerpt(["dialing", "\x1b[2J[ok] forged", "gave up"]));
    expect(io.stderr()).toBe("Could not connect to Acme QA\n  why: exit 1\nwhat StrongDM printed:\n  dialing\n  [ok] forged\n  gave up\n");
    expect(__test__.excerpt([])).toEqual([]);
  });

  test("the excerpt leaves out the line the why already shows, and is dropped when nothing else is left", () => {
    expect(renderPlain(__test__.excerpt(["dialing", "error: refused"], "error: refused"))).toBe("what StrongDM printed:\n  dialing\n");
    expect(__test__.excerpt(["error: refused"], "error: refused")).toEqual([]);
  });

  describe("a connect that fails", () => {
    const fakeAccess = (lines: (reason: string) => string[], result: (reason: string) => { ok: boolean; error?: string }): void => {
      mock.module("../../lib/sdm/core.ts", () => ({
        ...realCore,
        requestAccess: async (_resource: string, _duration: string, reason: string, onLine: (line: string) => void) => {
          for (const l of lines(reason)) onLine(l);
          return result(reason);
        },
      }));
    };
    const fakeConnect = (lines: string[], result: { ok: boolean; error?: string }): void => {
      mock.module("../../lib/sdm/core.ts", () => ({
        ...realCore,
        connectResource: async (_resource: string, onLine: (line: string) => void) => {
          for (const l of lines) onLine(l);
          return result;
        },
      }));
    };
    const fakeFlow = (after: (connected: { ok: boolean; error?: string }) => unknown): void => {
      mock.module("../../lib/sdm/flow.ts", () => ({
        ...realFlow,
        runGuidedConnect: async (t: GuidedTarget, _opts: unknown, deps: { connect: (r: string) => Promise<{ ok: boolean; error?: string }> }) => after(await deps.connect(t.sdmResource)),
      }));
    };
    afterEach(() => {
      mock.module("../../lib/sdm/core.ts", () => ({ ...realCore, connectResource: realConnectResource, requestAccess: realRequestAccess }));
      mock.module("../../lib/sdm/flow.ts", () => ({ ...realFlow, runGuidedConnect: realRunGuidedConnect }));
    });

    test("prints StrongDM's output once: the last line as the why, the rest under a caption", async () => {
      const printed = ["dialing gateway", "gateway refused the tunnel", "error: no route to gateway"];
      fakeConnect(printed, { ok: false, error: printed.slice(1).join("\n") });
      fakeFlow((c) => ({ outcome: "failed", stage: "connect", error: c.error }));
      await __test__.guidedConnect(target, { interactive: false });
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe(
        "Could not connect to Acme QA\n  why: error: no route to gateway\nwhat StrongDM printed:\n  dialing gateway\n  gateway refused the tunnel\n",
      );
      expect(process.exitCode).toBe(1);
    });

    test("the access reason never reaches the log, the excerpt or stderr, even when StrongDM echoes it", async () => {
      const reason = "ticket 4411 customer refund dispute";
      fakeAccess(
        (r) => [`requesting access for ops@example.test: ${r}`, "waiting on approval"],
        (r) => ({ ok: false, error: `denied: ${r}` }),
      );
      mock.module("../../lib/sdm/flow.ts", () => ({
        ...realFlow,
        runGuidedConnect: async (t: GuidedTarget, _opts: unknown, deps: { requestAccess: (r: string, d: string, why: string) => Promise<{ ok: boolean; error?: string }> }) => {
          const access = await deps.requestAccess(t.sdmResource, "1h", reason);
          return { outcome: "failed", stage: "access", error: access.error };
        },
      }));
      await __test__.guidedConnect(target, { interactive: false });
      expect(io.stderr()).toBe(
        "Could not get access to Acme QA\n  why: denied: [redacted]\nwhat StrongDM printed:\n  requesting access for ops@example.test: [redacted]\n  waiting on approval\n",
      );
      const logged = cliLogLines().filter((l) => l.module === "sdm").map((l) => l.msg);
      expect(logged).toContain("requesting access for ops@example.test: [redacted]");
      expect(JSON.stringify(cliLogLines())).not.toContain(reason);
      expect(process.exitCode).toBe(1);
    });

    test("a test query that fails after a good connect shows none of the connect's lines", async () => {
      fakeConnect(["tunnel up on 127.0.0.1:15432"], { ok: true });
      fakeFlow(() => ({ outcome: "failed", stage: "verify", error: "The tunnel did not answer: timeout" }));
      await __test__.guidedConnect(target, { interactive: false });
      expect(io.stderr()).toBe("Acme QA did not come up\n  why: The tunnel did not answer: timeout\n");
      expect(process.exitCode).toBe(1);
    });
  });

  test("a failed browser login never shows the auth url's token, in the why or anywhere on stderr", async () => {
    mock.module("../../lib/sdm/app.ts", () => ({ ...realApp, ensureSdmApp: async () => ({ ok: true }) }));
    mock.module("../../lib/sdm/browser-login.ts", () => ({
      ...realBrowserLogin,
      runBrowserLogin: async () => ({ outcome: "failed", error: "sdm login exited unsuccessfully: open https://sdm.example/auth-confirm-native/tok999secret to finish" }),
    }));
    try {
      await loginCmd([]);
      expect(io.stderr()).toContain("  why: sdm login exited unsuccessfully: open https://sdm.example/auth-confirm-native/<redacted> to finish\n");
      expect(io.stderr()).not.toContain("tok999secret");
      expect(io.stdout()).not.toContain("tok999secret");
      expect(process.exitCode).toBe(1);
    } finally {
      mock.module("../../lib/sdm/app.ts", () => ({ ...realApp, ensureSdmApp: realEnsureSdmApp }));
      mock.module("../../lib/sdm/browser-login.ts", () => ({ ...realBrowserLogin, runBrowserLogin: realRunBrowserLogin }));
    }
  });

  test("redact covers the upper-case and url-encoded forms and stops at a quote", () => {
    expect(__test__.redact("https://sdm.example/AUTH-CONFIRM-NATIVE/Tok1")).toBe("https://sdm.example/AUTH-CONFIRM-NATIVE/<redacted>");
    expect(__test__.redact("next=https%3A%2F%2Fsdm.example%2Fauth-confirm-native%2Ftok2&x=1")).toBe("next=https%3A%2F%2Fsdm.example%2Fauth-confirm-native%2F<redacted>");
    expect(__test__.redact("next=https%3a%2f%2fsdm.example%2fAuth-Confirm-Native%2ftok3")).toBe("next=https%3a%2f%2fsdm.example%2fAuth-Confirm-Native%2f<redacted>");
    expect(__test__.redact('href="https://sdm.example/auth-confirm-native/tok4">')).toBe('href="https://sdm.example/auth-confirm-native/<redacted>">');
  });

  test("a failure's excerpt never shows an auth url's token", () => {
    expect(renderPlain(__test__.excerpt(["https://sdm.example/auth-confirm-native/tok789secret"]))).toBe("what StrongDM printed:\n  https://sdm.example/auth-confirm-native/<redacted>\n");
  });
});
