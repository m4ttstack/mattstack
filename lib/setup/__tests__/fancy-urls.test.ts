import { describe, expect, test } from "bun:test";
import { join } from "path";
import { DEV_TRAY_APP_BUNDLE, TRAY_APP_BUNDLE } from "../../rt-paths.ts";
import { fancyUrlsState } from "../fancy-urls.ts";
import { setupStatePath } from "../state.ts";
import { PORTLESS_LAUNCHD_PLIST, PROXY_INSTALLER_MISSING, PROXY_VERSION_PATH, portlessCaPath } from "../steps/services.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/fake-home";

interface Machine {
  proxy?: boolean;
  trusted?: boolean;
  noHelper?: boolean;
  setupState?: string;
}

function machine(m: Machine) {
  const files: Record<string, string> = {};
  if (m.proxy) {
    files[PORTLESS_LAUNCHD_PLIST] = "<plist/>";
    files[PROXY_VERSION_PATH] = "0.15.6\n";
    files[portlessCaPath(HOME)] = "-----BEGIN CERTIFICATE-----";
  }
  if (m.setupState) files[setupStatePath(HOME)] = m.setupState;
  const dirs: Record<string, string[]> = m.noHelper ? { [join("/Applications", TRAY_APP_BUNDLE)]: [], [join("/Applications", DEV_TRAY_APP_BUNDLE)]: [] } : {};
  return fakeProbes({
    home: HOME,
    files,
    dirs,
    exec: (argv) => (argv[0] === "security" ? { code: m.trusted ? 0 : 1, stdout: "", stderr: "" } : { code: 127, stdout: "", stderr: `ENOENT: ${argv[0]}` }),
  });
}

describe("fancyUrlsState", () => {
  test("a dev build with no proxy helper reads done, so P1 never waits on it", async () => {
    const s = await fancyUrlsState(machine({ noHelper: true }));
    expect(s.state).toBe("done");
    expect(s.detail).toBe(PROXY_INSTALLER_MISSING);
  });

  test("proxy installed and certificate trusted reads done", async () => {
    expect(await fancyUrlsState(machine({ proxy: true, trusted: true }))).toEqual({ state: "done", detail: "Allowed" });
  });

  // A Mac set up by an older build can carry a homebrew record in setup state.
  test("a stale homebrew record in setup state changes nothing", async () => {
    const setupState = JSON.stringify({ v: 2, homebrew: { at: "2026-10-30T08:00:00.000Z", outcome: "failed" } });
    expect(await fancyUrlsState(machine({ proxy: true, trusted: true, setupState }))).toEqual({ state: "done", detail: "Allowed" });
  });

  test("an untrusted certificate is still to do", async () => {
    expect(await fancyUrlsState(machine({ proxy: true, trusted: false }))).toEqual({ state: "todo", detail: "Certificate not trusted yet" });
  });

  test("no proxy at all is to do", async () => {
    expect(await fancyUrlsState(machine({}))).toEqual({ state: "todo", detail: "Not set up yet" });
  });
});
