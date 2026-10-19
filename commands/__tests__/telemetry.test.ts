import { afterEach, describe, expect, test } from "bun:test";
import { UserActionableError } from "../../lib/errors.ts";
import { telemetryOpen, telemetryPageUrl, type TelemetryOpenDeps } from "../telemetry.ts";
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
