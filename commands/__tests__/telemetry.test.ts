import { afterEach, describe, expect, test } from "bun:test";
import { UserActionableError } from "../../lib/errors.ts";
import { telemetryClones, telemetryOpen, telemetryPageUrl, type TelemetryClonesDeps, type TelemetryOpenDeps } from "../telemetry.ts";
import { capturePlain } from "./helpers/json-line.ts";

describe("telemetryPageUrl", () => {
  test("puts the key in the query, percent-encoded", () => {
    expect(telemetryPageUrl("https://relay.example", "a b&c/d")).toBe("https://relay.example/telemetry?key=a%20b%26c%2Fd");
  });
});

let cap: ReturnType<typeof capturePlain> | null = null;
afterEach(() => {
  cap?.restore();
  cap = null;
});

function deps(over: Partial<TelemetryOpenDeps> = {}): TelemetryOpenDeps & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    readKey: async () => "k3y",
    baseUrl: () => "https://relay.example",
    open: (url) => {
      opened.push(url);
      return true;
    },
    ...over,
  };
}

describe("telemetryOpen", () => {
  test("opens the page with the stored key and never prints it", async () => {
    cap = capturePlain();
    const d = deps();
    await telemetryOpen([], {}, d);
    expect(d.opened).toEqual(["https://relay.example/telemetry?key=k3y"]);
    expect(cap.stdout()).toContain("Opened the telemetry page");
    expect(cap.stdout() +cap.stderr()).not.toContain("k3y");
  });

  test("with no stored key, fails and points at rt secrets set", async () => {
    const d = deps({ readKey: async () => null });
    const err = await telemetryOpen([], {}, d).catch((e) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect(err.next).toBe("rt secrets set rt switchboardTelemetryToken");
    expect(d.opened).toEqual([]);
  });

  test("when the browser will not open, fails without showing the key", async () => {
    const d = deps({ open: () => false });
    const err = await telemetryOpen([], {}, d).catch((e) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect(`${err.message} ${err.why ?? ""} ${err.next ?? ""}`).not.toContain("k3y");
  });
});

const REPORT = {
  macs: [
    {
      installId: "i-1",
      label: "dev1",
      lastSeen: 0,
      running: true,
      appVersion: "2.32.0",
      rtVersion: "2.32.0",
      pluginVersion: null,
      macosVersion: null,
      orgs: [{ org: "acme", layout: 5, clone: null, flags: ["behind origin by 3"] }],
      packs: [],
    },
  ],
  events: [{ installId: "i-1", label: "dev1", at: 0, state: { clones: {}, stale: {} } }],
};

function cloneDeps(over: Partial<TelemetryClonesDeps> = {}): TelemetryClonesDeps & { asked: { url: string; key: string }[] } {
  const asked: { url: string; key: string }[] = [];
  return {
    asked,
    readKey: async () => "k3y",
    baseUrl: () => "https://relay.example",
    fetchReport: async (url, key) => {
      asked.push({ url, key });
      return { status: 200, body: JSON.stringify(REPORT) };
    },
    ...over,
  };
}

describe("telemetryClones", () => {
  test("--json prints the relay's report, sends the key as a header and never in the url", async () => {
    cap = capturePlain();
    const d = cloneDeps();
    await telemetryClones(["--user", "dev1", "--json"], {}, d);
    expect(d.asked).toEqual([{ url: "https://relay.example/telemetry/clones.json?user=dev1", key: "k3y" }]);
    expect(JSON.parse(cap.stdout())).toEqual(REPORT);
    expect(cap.stdout() + cap.stderr()).not.toContain("k3y");
  });

  test("the human view names each clone and what is wrong with it", async () => {
    cap = capturePlain();
    await telemetryClones([], {}, cloneDeps());
    expect(cap.stdout()).toContain("dev1");
    expect(cap.stdout()).toContain("behind origin by 3");
    expect(cap.stdout()).toContain("1 state change");
  });

  test("with no stored key, fails and points at rt secrets set", async () => {
    const err = await telemetryClones([], {}, cloneDeps({ readKey: async () => null })).catch((e) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect(err.next).toBe("rt secrets set rt switchboardTelemetryToken");
  });

  test("a relay that refuses the key fails without showing it", async () => {
    const err = await telemetryClones([], {}, cloneDeps({ fetchReport: async () => ({ status: 401, body: "unauthorized" }) })).catch((e) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect(`${err.message} ${err.why ?? ""}`).not.toContain("k3y");
  });
});
