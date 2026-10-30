import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HELPERS_DIR, RT_BUNDLE_PATH, __test__ as bundleLayoutTest } from "../../bundle-layout.ts";
import { setSetting } from "../../settings/write.ts";
import type { Probes } from "../probes.ts";
import { listServedAppsFromDeck, REAL_APPS_RESTART_SEAMS, restartServedApps, servedAppNames, type AppsRestartSeams, type ServedAppsList } from "../steps/apps-restart.ts";
import { fakeProbes, type ExecScript } from "./fakes.ts";

const row = (name: string, managedBy: string, extra: Record<string, unknown> = {}) => ({ name, managedBy, enabled: true, record: { kind: "service", command: null, workingDirectory: null }, ...extra });

function seams(listed: ServedAppsList, restart: (name: string) => boolean | Promise<boolean> = () => true): AppsRestartSeams & { restarted: string[] } {
  const restarted: string[] = [];
  return {
    restarted,
    listServedApps: async () => listed,
    restartApp: async (_p, name) => {
      restarted.push(name);
      return restart(name);
    },
  };
}

describe("servedAppNames", () => {
  test("keeps only the switched-on services rt registered, sorted", () => {
    const body = JSON.stringify({
      apps: [
        row("chat", "rt"),
        row("board", "rt"),
        row("deck", "deck"),
        row("mything", "user"),
        row("console", "rt", { enabled: false }),
        row("docs", "rt", { record: { kind: "external", command: null, workingDirectory: null } }),
        row("legacy", "rt", { record: null }),
      ],
    });
    expect(servedAppNames(body)).toEqual(["board", "chat"]);
  });

  test("an answer that is not an app list reads as unreadable", () => {
    expect(servedAppNames("not json")).toBeNull();
    expect(servedAppNames(JSON.stringify({ error: "deck is still starting its apps" }))).toBeNull();
  });
});

describe("restartServedApps", () => {
  test("restarts each served app once, with one log line per app", async () => {
    const s = seams({ kind: "apps", names: ["board", "chat", "console"] });
    const logs: string[] = [];
    const outcome = await restartServedApps(fakeProbes(), (l) => logs.push(l), s);
    expect(s.restarted).toEqual(["board", "chat", "console"]);
    expect(outcome).toEqual({ state: "done", detail: "Restarted board, chat, console" });
    expect(logs).toEqual(["Restarted board", "Restarted chat", "Restarted console"]);
  });

  test("a deck error on one app is partial with that app's remedy, and the rest still restart", async () => {
    const s = seams({ kind: "apps", names: ["board", "chat"] }, (name) => name !== "board");
    const logs: string[] = [];
    const outcome = await restartServedApps(fakeProbes(), (l) => logs.push(l), s);
    expect(s.restarted).toEqual(["board", "chat"]);
    expect(outcome).toEqual({ state: "partial", detail: "Couldn't restart board", remedy: "Run deck restart board" });
    expect(logs).toEqual(["deck restart board failed", "Restarted chat"]);
  });

  test("several failures point at deck's managed restart", async () => {
    const s = seams({ kind: "apps", names: ["board", "chat"] }, () => {
      throw new Error("spawn boom");
    });
    const logs: string[] = [];
    const outcome = await restartServedApps(fakeProbes(), (l) => logs.push(l), s);
    expect(outcome).toEqual({ state: "partial", detail: "Couldn't restart board, chat", remedy: "Run deck restart --managed" });
    expect(logs).toContain("deck restart board threw: spawn boom");
  });

  test("a list deck could not answer is partial, and nothing restarts", async () => {
    const s = seams({ kind: "error", detail: "Couldn't list your apps: deck answered 503" });
    const outcome = await restartServedApps(fakeProbes(), () => {}, s);
    expect(outcome).toEqual({ state: "partial", detail: "Couldn't list your apps: deck answered 503", remedy: "Run deck restart --managed" });
    expect(s.restarted).toEqual([]);
  });

  test("deck not running, or nothing served, is skipped", async () => {
    expect(await restartServedApps(fakeProbes(), () => {}, seams({ kind: "skip", detail: "Deck is not running, so no apps to restart" }))).toEqual({
      state: "skipped",
      detail: "Deck is not running, so no apps to restart",
    });
    expect(await restartServedApps(fakeProbes(), () => {}, seams({ kind: "apps", names: [] }))).toEqual({ state: "skipped", detail: "No apps to restart" });
  });
});

describe("listServedAppsFromDeck and the real restart", () => {
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

  function bundledProbes(overrides: { files?: Record<string, string>; fetch?: Probes["fetch"]; exec?: ExecScript } = {}): ReturnType<typeof fakeProbes> {
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
      files: { [join(appRoot, RT_BUNDLE_PATH)]: "rt-binary", [join(appRoot, HELPERS_DIR, "deck")]: "deck-binary", ...overrides.files },
      dirs: { [appRoot]: [] },
      ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
      ...(overrides.exec ? { exec: overrides.exec } : {}),
    });
  }

  const apiJson = () => ({ [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 7777 }) });

  test("no deck in the bundle is skipped without asking anything", async () => {
    const p = fakeProbes({ home });
    expect(await listServedAppsFromDeck(p)).toEqual({ kind: "skip", detail: "Deck is not in this build yet" });
    expect(p.calls.fetch).toEqual([]);
  });

  test("deck with no api.json, or refusing the connection, is skipped", async () => {
    expect(await listServedAppsFromDeck(bundledProbes())).toEqual({ kind: "skip", detail: "Deck is not running, so no apps to restart" });
    expect(await listServedAppsFromDeck(bundledProbes({ files: apiJson() }))).toEqual({ kind: "skip", detail: "Deck is not running, so no apps to restart" });
  });

  test("deck still starting its apps is an error the step reports", async () => {
    const p = bundledProbes({ files: apiJson(), fetch: async () => ({ status: 503, body: "{}", headers: {} }) });
    expect(await listServedAppsFromDeck(p)).toEqual({ kind: "error", detail: "Couldn't list your apps: deck answered 503" });
  });

  test("lists from deck's own api, then restarts each by name through the bundled deck", async () => {
    const fetch: Probes["fetch"] = async (url) =>
      url === "http://127.0.0.1:7777/api/v1/apps" ? { status: 200, body: JSON.stringify({ apps: [row("board", "rt"), row("deck", "deck"), row("chat", "rt")] }), headers: {} } : { status: 404, body: "", headers: {} };
    const p = bundledProbes({ files: apiJson(), fetch });
    const outcome = await restartServedApps(p, () => {}, REAL_APPS_RESTART_SEAMS);
    const deckBin = join(appRoot, HELPERS_DIR, "deck");
    expect(p.calls.exec).toEqual([
      [deckBin, "restart", "board"],
      [deckBin, "restart", "chat"],
    ]);
    expect(outcome).toEqual({ state: "done", detail: "Restarted board, chat" });
  });
});
