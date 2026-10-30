import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HELPERS_DIR, RT_BUNDLE_PATH, __test__ as bundleLayoutTest } from "../../bundle-layout.ts";
import { setSetting } from "../../settings/write.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import type { ApplyContext } from "../apply.ts";
import { appsRestartOwed, makeAppsRestartStep, oweAppsRestart, parseManagedRestart, restartServedApps, type AppsRestartSeams } from "../steps/apps-restart.ts";
import { fakeProbes, type ExecScript } from "./fakes.ts";

const DASH = String.fromCharCode(0x2014);
const failedLine = (name: string, err = "kickstart failed") => `failed to restart ${name} ${DASH} ${err}`;

describe("parseManagedRestart", () => {
  test("reads deck's restarted and failed lines, ignoring anything else", () => {
    expect(parseManagedRestart("restarted board\nrestarted chat\n", `${failedLine("console")}\nsome noise\n`)).toEqual({ restarted: ["board", "chat"], failed: ["console"] });
    expect(parseManagedRestart("", "")).toEqual({ restarted: [], failed: [] });
  });
});

describe("restartServedApps", () => {
  const origHome = process.env.HOME;
  let home: string;
  let appRoot: string;

  beforeEach(() => {
    bundleLayoutTest.resetBundleLayoutMemo();
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-apps-restart-home-")));
    process.env.HOME = home;
    appRoot = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-apps-restart-app-"))), "mattstack.app");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(join(appRoot, ".."), { recursive: true, force: true });
    bundleLayoutTest.resetBundleLayoutMemo();
  });

  const API_JSON = () => join(home, ".mattstack", "deck", "api.json");
  const deckBin = () => join(appRoot, HELPERS_DIR, "deck");

  function bundledProbes(opts: { apiJson?: boolean; exec?: ExecScript; fetch?: Probes["fetch"] } = {}): ReturnType<typeof fakeProbes> {
    mkdirSync(join(appRoot, "Contents", "Resources"), { recursive: true });
    mkdirSync(join(appRoot, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(appRoot, HELPERS_DIR), { recursive: true });
    writeFileSync(join(appRoot, "Contents", "Info.plist"), "<plist/>");
    const deckTool = { name: "deck", version: "0.1.0", license: "MIT", url: "https://x/deck.tgz", sha256: "0".repeat(64), archive: "raw", extract: "", bundlePath: `${HELPERS_DIR}/deck`, exec: [`${HELPERS_DIR}/deck`], exposeByDefault: true, entitlements: "none", status: "bundled", kind: "helper" };
    writeFileSync(join(appRoot, "Contents", "Resources", "deps.lock"), JSON.stringify({ schema: 1, arch: "arm64", tools: [deckTool] }));
    writeFileSync(join(appRoot, RT_BUNDLE_PATH), "rt-binary");
    writeFileSync(join(appRoot, HELPERS_DIR, "deck"), "deck-binary");
    setSetting("mattstack.appPath", appRoot, "machine");
    return fakeProbes({
      home,
      env: { PATH: "" },
      files: {
        [join(appRoot, RT_BUNDLE_PATH)]: "rt-binary",
        [deckBin()]: "deck-binary",
        ...(opts.apiJson === false ? {} : { [API_JSON()]: JSON.stringify({ port: 7777 }) }),
      },
      dirs: { [appRoot]: [] },
      ...(opts.exec ? { exec: opts.exec } : {}),
      fetch: opts.fetch ?? healthy(),
    });
  }

  const reply = (code: number, stdout = "", stderr = ""): ExecScript => async (): Promise<ExecResult> => ({ code, stdout, stderr });
  const appsBody = (rows: Array<{ name: string; ok: boolean | null }>) =>
    JSON.stringify({ apps: rows.map((r) => ({ name: r.name, managedBy: "rt", health: r.ok === null ? null : { ok: r.ok, status: r.ok ? 200 : null, ms: 1 } })) });
  function healthy(): Probes["fetch"] {
    return async () => ({ status: 200, body: appsBody([{ name: "board", ok: true }, { name: "chat", ok: true }]), headers: {} });
  }
  /** A clock that moves only by the step's own sleeps, plus whatever a fake fetch spends. */
  function seams(): AppsRestartSeams & { sleeps: number[]; clock: { ms: number } } {
    const sleeps: number[] = [];
    const clock = { ms: 0 };
    return {
      sleeps,
      clock,
      now: () => clock.ms,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.ms += ms;
      },
    };
  }

  test("no deck in the bundle is skipped without running anything", async () => {
    const p = fakeProbes({ home });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "skipped", detail: "Deck is not in this build yet" });
    expect(p.calls.exec).toEqual([]);
  });

  test("deck with no api.json is skipped without running anything", async () => {
    const p = bundledProbes({ apiJson: false });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "skipped", detail: "Deck is not running, so no apps to restart" });
    expect(p.calls.exec).toEqual([]);
  });

  test("one deck restart --managed, one log line per app deck restarted", async () => {
    const p = bundledProbes({ exec: reply(0, "restarted board\nrestarted chat\n") });
    const logs: string[] = [];
    const s = seams();
    expect(await restartServedApps(p, (l) => logs.push(l), s)).toEqual({ state: "done", detail: "Restarted board, chat" });
    expect(p.calls.exec).toEqual([[deckBin(), "restart", "--managed"]]);
    expect(logs).toEqual(["Restarted board", "Restarted chat"]);
    expect(s.sleeps).toEqual([]);
  });

  test("waits a bounded while for the restarted apps to answer", async () => {
    let asks = 0;
    const fetch: Probes["fetch"] = async () => {
      asks++;
      return { status: 200, body: appsBody([{ name: "board", ok: asks >= 3 }, { name: "chat", ok: null }]), headers: {} };
    };
    const s = seams();
    const p = bundledProbes({ exec: reply(0, "restarted board\nrestarted chat\n"), fetch });
    expect(await restartServedApps(p, () => {}, s)).toEqual({ state: "done", detail: "Restarted board, chat" });
    expect(s.sleeps).toEqual([500, 500]);
  });

  test("an app that never answers is logged, and the restart still counts as done", async () => {
    const fetch: Probes["fetch"] = async () => ({ status: 200, body: appsBody([{ name: "board", ok: false }]), headers: {} });
    const s = seams();
    const logs: string[] = [];
    const p = bundledProbes({ exec: reply(0, "restarted board\n"), fetch });
    expect(await restartServedApps(p, (l) => logs.push(l), s)).toEqual({ state: "done", detail: "Restarted board" });
    expect(s.sleeps).toHaveLength(9);
    expect(logs).toContain("Still starting: board");
  });

  test("a deck that hangs on every health ask is given up on at one deadline, with short asks", async () => {
    const s = seams();
    const asks: number[] = [];
    const fetch: Probes["fetch"] = async (_url, opts) => {
      asks.push(opts?.timeoutMs ?? -1);
      s.clock.ms += opts?.timeoutMs ?? 0;
      return { status: 0, body: "", headers: {} };
    };
    const logs: string[] = [];
    const p = bundledProbes({ exec: reply(0, "restarted board\n"), fetch });
    expect(await restartServedApps(p, (l) => logs.push(l), s)).toEqual({ state: "done", detail: "Restarted board" });
    expect(Math.max(...asks)).toBeLessThanOrEqual(1_000);
    expect(s.clock.ms).toBeLessThanOrEqual(5_000);
    expect(logs).toContain("Still starting: board");
  });

  test("a deck error on one app is partial with that app's remedy", async () => {
    const logs: string[] = [];
    const p = bundledProbes({ exec: reply(1, "restarted chat\n", `${failedLine("board")}\n`) });
    expect(await restartServedApps(p, (l) => logs.push(l), seams())).toEqual({ state: "partial", detail: "Couldn't restart board", remedy: "Run deck restart board" });
    expect(logs).toEqual(["Restarted chat", "deck restart board failed"]);
  });

  test("several failures point at deck's managed restart", async () => {
    const p = bundledProbes({ exec: reply(1, "", `${failedLine("board")}\n${failedLine("chat")}\n`) });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "partial", detail: "Couldn't restart board, chat", remedy: "Run deck restart --managed" });
  });

  test("deck still running its boot sweep is skipped, not a failure", async () => {
    const p = bundledProbes({ exec: reply(1, "", "deck is still starting its apps\n") });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "skipped", detail: "Deck is still starting your apps" });
  });

  test("a deck that stopped answering is skipped", async () => {
    const p = bundledProbes({ exec: reply(1, "", "Deck isn't running. Open mattstack.app\n") });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "skipped", detail: "Deck is not running, so no apps to restart" });
  });

  test("a restart that outlasts its timeout is partial, never read as deck being down", async () => {
    const p = bundledProbes({ exec: reply(124) });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "partial", detail: "Deck took too long to restart your apps", remedy: "Run deck restart --managed" });
  });

  test("any other deck error is partial with deck's first line", async () => {
    const p = bundledProbes({ exec: reply(1, "", "failed (500)\n") });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "partial", detail: "Deck couldn't restart your apps: failed (500)", remedy: "Run deck restart --managed" });
  });

  test("an exec that throws is partial", async () => {
    const p = bundledProbes({
      exec: async () => {
        throw new Error("spawn boom");
      },
    });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "partial", detail: "Deck couldn't restart your apps: spawn boom", remedy: "Run deck restart --managed" });
  });

  test("nothing for deck to restart is skipped", async () => {
    const p = bundledProbes({ exec: reply(0) });
    expect(await restartServedApps(p, () => {}, seams())).toEqual({ state: "skipped", detail: "No apps to restart" });
  });

  test("a done or skipped restart settles the owed mark; a partial one keeps it", async () => {
    const done = bundledProbes({ exec: reply(0, "restarted board\n") });
    oweAppsRestart(done);
    await restartServedApps(done, () => {}, seams());
    expect(appsRestartOwed(done)).toBe(false);

    const skipped = fakeProbes({ home });
    oweAppsRestart(skipped);
    await restartServedApps(skipped, () => {}, seams());
    expect(appsRestartOwed(skipped)).toBe(false);

    const partial = bundledProbes({ exec: reply(1, "", `${failedLine("board")}\n`) });
    updateSetupState(partial, (s) => ({ ...s, appsRestartOwed: true }));
    await restartServedApps(partial, () => {}, seams());
    expect(readSetupState(partial).appsRestartOwed).toBe(true);
  });

  // Else a partial end restart plus Finish's own restart catches the board as P7 opens it.
  test("as a run's end step it settles the owed mark whatever the outcome", async () => {
    const partial = bundledProbes({ exec: reply(1, "", `${failedLine("board")}\n`) });
    oweAppsRestart(partial);
    const ctx = { p: partial, log: () => {} } as unknown as ApplyContext;
    expect((await makeAppsRestartStep(seams()).run(ctx)).state).toBe("partial");
    expect(appsRestartOwed(partial)).toBe(false);
  });
});
