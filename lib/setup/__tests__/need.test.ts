import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HELPERS_DIR, __test__ as bundleLayoutTest } from "../../bundle-layout.ts";
import { setSetting } from "../../settings/write.ts";
import { askAppDirectly, awaitNeed, deckHelperLabel, servicePlists, SERVICE_PLISTS } from "../need.ts";
import { fakeProbes, fakeTray } from "./fakes.ts";

const DECK_LOCK = {
  schema: 1,
  arch: "arm64",
  tools: [
    {
      name: "deck",
      version: "1.0.0",
      license: "MIT",
      url: "https://x/deck.tar.gz",
      sha256: "d".repeat(64),
      archive: "tar.gz",
      extract: "deck",
      bundlePath: `${HELPERS_DIR}/deck`,
      exec: [`${HELPERS_DIR}/deck`],
      exposeByDefault: false,
      entitlements: "none",
      status: "bundled",
      kind: "helper",
    },
  ],
};

describe("servicePlists", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    bundleLayoutTest.resetBundleLayoutMemo();
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-need-home-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
    bundleLayoutTest.resetBundleLayoutMemo();
  });

  test("deck bundled -> daemon + deck, flavored by mode", () => {
    const appRoot = join(realpathSync(mkdtempSync(join(tmpdir(), "rt-need-app-"))), "mattstack.app");
    mkdirSync(join(appRoot, "Contents", "Resources"), { recursive: true });
    mkdirSync(join(appRoot, HELPERS_DIR), { recursive: true });
    writeFileSync(join(appRoot, "Contents", "Resources", "deps.lock"), JSON.stringify(DECK_LOCK));
    writeFileSync(join(appRoot, HELPERS_DIR, "deck"), "deck-binary");
    setSetting("mattstack.appPath", appRoot, "machine");

    const deckPath = join(appRoot, HELPERS_DIR, "deck");
    const p = fakeProbes({ home, files: { [deckPath]: "deck-binary" }, dirs: { [appRoot]: [] } });

    expect(servicePlists("dev", p)).toEqual({ plists: ["com.mattstack.daemon.dev.plist", "com.mattstack.deck.dev.plist"], deckOmitted: false });
    expect(servicePlists("prod", p)).toEqual({ plists: ["com.mattstack.daemon.plist", "com.mattstack.deck.plist"], deckOmitted: false });
    expect(deckHelperLabel("dev", p)).toBe("com.mattstack.deck.dev");
    expect(deckHelperLabel("prod", p)).toBe("com.mattstack.deck");
  });

  test("deck not bundled -> daemon only, deckOmitted true", () => {
    const p = fakeProbes({ home });
    expect(servicePlists("dev", p)).toEqual({ plists: ["com.mattstack.daemon.dev.plist"], deckOmitted: true });
    expect(servicePlists("prod", p)).toEqual({ plists: ["com.mattstack.daemon.plist"], deckOmitted: true });
    expect(deckHelperLabel("dev", p)).toBeNull();
    expect(deckHelperLabel("prod", p)).toBeNull();
  });

  test("SERVICE_PLISTS names the prod-flavor pair", () => {
    expect(SERVICE_PLISTS).toEqual(["com.mattstack.daemon.plist", "com.mattstack.deck.plist"]);
  });
});

function fakeClock(startMs = 0) {
  let elapsed = startMs;
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
  };
}

describe("awaitNeed", () => {
  test("done after two pending polls", async () => {
    let calls = 0;
    const tray = fakeTray({
      "GET /setup/need/services.register": () => {
        calls += 1;
        if (calls < 3) return { status: 200, json: { state: "pending" } };
        return { status: 200, json: { state: "done", detail: "registered" } };
      },
    });
    const { now, sleep } = fakeClock();
    const result = await awaitNeed(tray, "services.register", { timeoutMs: 60_000, pollMs: 1_000, now, sleep });
    expect(result).toEqual({ ok: true, detail: "registered" });
    expect(calls).toBe(3);
  });

  test("failed terminal state maps to ok:false with detail", async () => {
    const tray = fakeTray({
      "GET /setup/need/proxy.install": () => ({ status: 200, json: { state: "failed", detail: "denied" } }),
    });
    const { now, sleep } = fakeClock();
    const result = await awaitNeed(tray, "proxy.install", { now, sleep });
    expect(result).toEqual({ ok: false, detail: "denied" });
  });

  test("a 404 is tolerated as pending, not a failure", async () => {
    let calls = 0;
    const tray = fakeTray({
      "GET /setup/need/services.register": () => {
        calls += 1;
        if (calls === 1) return { status: 404, json: null };
        return { status: 200, json: { state: "done", detail: "registered" } };
      },
    });
    const { now, sleep } = fakeClock();
    const result = await awaitNeed(tray, "services.register", { now, sleep });
    expect(result).toEqual({ ok: true, detail: "registered" });
    expect(calls).toBe(2);
  });

  test('stays pending past the timeout -> "timeout"', async () => {
    const tray = fakeTray({
      "GET /setup/need/services.register": () => ({ status: 200, json: { state: "pending" } }),
    });
    const { now, sleep } = fakeClock();
    const result = await awaitNeed(tray, "services.register", { timeoutMs: 3_000, pollMs: 1_000, now, sleep });
    expect(result).toBe("timeout");
  });

  test('tray unreachable three times in a row -> "app-gone"', async () => {
    let attempts = 0;
    const tray = fakeTray({
      "GET /setup/need/services.register": () => {
        attempts += 1;
        return { status: 0, json: null };
      },
    });
    const { now, sleep } = fakeClock();
    const result = await awaitNeed(tray, "services.register", { timeoutMs: 60_000, pollMs: 1_000, now, sleep });
    expect(result).toBe("app-gone");
    // stops right at the third consecutive miss — never keeps polling toward the full timeout
    expect(attempts).toBe(3);
  });

  test("a reply in between resets the app-gone counter", async () => {
    let attempts = 0;
    const tray = fakeTray({
      "GET /setup/need/services.register": () => {
        attempts += 1;
        if (attempts === 2) return { status: 200, json: { state: "pending" } };
        if (attempts === 5) return { status: 200, json: { state: "done", detail: "registered" } };
        return { status: 0, json: null };
      },
    });
    const { now, sleep } = fakeClock();
    const result = await awaitNeed(tray, "services.register", { timeoutMs: 60_000, pollMs: 1_000, now, sleep });
    expect(result).toEqual({ ok: true, detail: "registered" });
    expect(attempts).toBe(5);
  });

  test("polls an UninstallActionId (EventId, not just StepId) — needed for services.unregister/proxy.remove", async () => {
    const tray = fakeTray({
      "GET /setup/need/services.unregister": () => ({ status: 200, json: { state: "done", detail: "unregistered" } }),
    });
    const { now, sleep } = fakeClock();
    const result = await awaitNeed(tray, "services.unregister", { now, sleep });
    expect(result).toEqual({ ok: true, detail: "unregistered" });
  });
});

// A terminal `rt setup apply` has no app pumping its needs, so the requests
// the app also serves as plain routes go straight to them.
describe("askAppDirectly", () => {
  test("services register POSTs the plists and reports each one's status", async () => {
    let body: unknown;
    let timeoutMs: number | undefined;
    const tray = fakeTray({
      "POST /services/register": (b, init) => {
        body = b;
        timeoutMs = init?.timeoutMs;
        return { status: 200, json: { ok: true, results: [{ plist: "com.mattstack.daemon.plist", ok: true, status: "enabled" }] } };
      },
    });

    const reply = await askAppDirectly(tray, { type: "app-register-services", plists: ["com.mattstack.daemon.plist"] });

    expect(body).toEqual({ plists: ["com.mattstack.daemon.plist"] });
    // The route answers only once the work is done, admin prompt included.
    expect(timeoutMs).toBe(600_000);
    expect(reply).toEqual({ ok: true, detail: "com.mattstack.daemon.plist: enabled" });
  });

  test("a failed registration names the plists that failed", async () => {
    const tray = fakeTray({
      "POST /services/register": () => ({
        status: 200,
        json: {
          ok: false,
          results: [
            { plist: "a.plist", ok: true, status: "enabled" },
            { plist: "b.plist", ok: false, status: "requiresApproval", error: "needs approval in Login Items" },
            { plist: "c.plist", ok: false, status: "notFound" },
          ],
        },
      }),
    });

    const reply = await askAppDirectly(tray, { type: "app-register-services", plists: ["a.plist", "b.plist", "c.plist"] });

    expect(reply).toEqual({ ok: false, detail: "b.plist: needs approval in Login Items; c.plist: notFound" });
  });

  test("the privileged proxy ops hand back the helper's own result", async () => {
    const tray = fakeTray({
      "POST /privileged/proxy-install": () => ({ status: 200, json: { ok: true, detail: "installed\nMATTSTACK_TRUST=ok" } }),
      "POST /privileged/proxy-trust": () => ({ status: 200, json: { ok: false, detail: "declined" } }),
    });

    expect(await askAppDirectly(tray, { type: "app-privileged", op: "proxy-install" })).toEqual({ ok: true, detail: "installed\nMATTSTACK_TRUST=ok" });
    expect(await askAppDirectly(tray, { type: "app-privileged", op: "proxy-trust" })).toEqual({ ok: false, detail: "declined" });
  });

  test("a request the app serves no route for is left to the need protocol", async () => {
    const tray = fakeTray({});

    expect(await askAppDirectly(tray, { type: "app-unregister-services", plists: ["a.plist"] })).toBeNull();
    expect(await askAppDirectly(tray, { type: "app-privileged", op: "proxy-remove" })).toBeNull();
  });

  test("a request still unanswered at its deadline reads as a timeout, not a gone app", async () => {
    let clock = 0;
    const tray = fakeTray({
      "POST /privileged/proxy-install": (_b, init) => {
        clock += init?.timeoutMs ?? 0;
        return { status: 0, json: null };
      },
    });

    expect(await askAppDirectly(tray, { type: "app-privileged", op: "proxy-install" }, { now: () => clock })).toBe("timeout");
  });

  test("an app that drops the connection mid-request reads as gone", async () => {
    const tray = fakeTray({ "POST /services/register": () => ({ status: 0, json: null }) });

    expect(await askAppDirectly(tray, { type: "app-register-services", plists: ["a.plist"] })).toBe("app-gone");
  });

  test("a route that answers with an error status fails with that status", async () => {
    const tray = fakeTray({ "POST /privileged/proxy-install": () => ({ status: 500, json: { ok: false, error: "encode" } }) });

    expect(await askAppDirectly(tray, { type: "app-privileged", op: "proxy-install" })).toEqual({
      ok: false,
      detail: "mattstack.app answered /privileged/proxy-install with status 500",
    });
  });
});
