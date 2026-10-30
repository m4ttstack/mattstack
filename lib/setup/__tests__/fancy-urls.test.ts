import { describe, expect, test } from "bun:test";
import { join } from "path";
import { DEV_TRAY_APP_BUNDLE, TRAY_APP_BUNDLE } from "../../rt-paths.ts";
import { fancyUrlsState } from "../fancy-urls.ts";
import { setupStatePath, type SetupState } from "../state.ts";
import { PORTLESS_LAUNCHD_PLIST, PROXY_INSTALLER_MISSING, PROXY_VERSION_PATH, portlessCaPath } from "../steps/services.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/fake-home";

interface Machine {
  proxy?: boolean;
  trusted?: boolean;
  brew?: boolean;
  homebrew?: SetupState["homebrew"];
  noHelper?: boolean;
}

function machine(m: Machine) {
  const files: Record<string, string> = {};
  if (m.proxy) {
    files[PORTLESS_LAUNCHD_PLIST] = "<plist/>";
    files[PROXY_VERSION_PATH] = "0.15.6\n";
    files[portlessCaPath(HOME)] = "-----BEGIN CERTIFICATE-----";
  }
  if (m.brew) files["/opt/homebrew/bin/brew"] = "brew";
  if (m.homebrew) files[setupStatePath(HOME)] = JSON.stringify({ v: 2, homebrew: m.homebrew });
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

  test("proxy installed, certificate trusted and Homebrew present reads done", async () => {
    expect(await fancyUrlsState(machine({ proxy: true, trusted: true, brew: true }))).toEqual({ state: "done", detail: "Allowed", brewMissing: false });
  });

  test("a trusted proxy without Homebrew, never attempted, is still to do", async () => {
    const s = await fancyUrlsState(machine({ proxy: true, trusted: true }));
    expect(s).toMatchObject({ state: "todo", brewMissing: true });
  });

  test("a failed Homebrew attempt does not hold P1", async () => {
    const s = await fancyUrlsState(machine({ proxy: true, trusted: true, homebrew: { at: "2026-10-30T08:00:00.000Z", outcome: "failed", detail: "curl: (6) Could not resolve host" } }));
    expect(s).toEqual({ state: "done", detail: "Homebrew did not install. Tools that need it say so on their own rows", brewMissing: true });
  });

  test("an untrusted certificate is still to do", async () => {
    const s = await fancyUrlsState(machine({ proxy: true, trusted: false, brew: true }));
    expect(s).toMatchObject({ state: "todo", brewMissing: false });
  });

  test("no proxy at all is to do", async () => {
    const s = await fancyUrlsState(machine({ brew: true }));
    expect(s).toMatchObject({ state: "todo", brewMissing: false });
  });
});
