import { describe, expect, test } from "bun:test";
import { join } from "path";
import { FLOCK_APPCAST_URL, FLOCK_BUNDLE_ID, fetchFlockRelease, flockAppDirs, installFlock, installedFlock, parseFlockAppcast } from "../flock-install.ts";
import type { ExecResult } from "../probes.ts";
import { fakeProbes, ok, type FakeProbesOpts } from "./fakes.ts";

const HOME = "/fake-home";
const TMP = "/fake-tmp";
const WORK = join(TMP, `rt-flock-install-${process.pid}`);
const ZIP = join(WORK, "Flock.zip");
const UNPACKED = join(WORK, "unpacked");
const APP = join(UNPACKED, "Flock.app");
const URL_0_12_2 = "https://github.com/m4ttstack/flock/releases/download/v0.12.2/Flock-0.12.2.zip";
const URL_0_12_1 = "https://github.com/m4ttstack/flock/releases/download/v0.12.1/Flock-0.12.1.zip";
const SYSTEM = "/Applications/Flock.app";
const USER = join(HOME, "Applications", "Flock.app");
const stagedIn = (dir: string) => join(dir, `.Flock-${process.pid}.new`);

const item = (build: number, version: string, url: string, minimum?: string) => `
    <item>
      <title>Version ${version}</title>${minimum ? `\n      <sparkle:minimumSystemVersion>${minimum}</sparkle:minimumSystemVersion>` : ""}
      <sparkle:version>${build}</sparkle:version>
      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
      <enclosure url="${url}" length="1" type="application/octet-stream" />
    </item>`;
const feed = (...items: string[]) => `<?xml version="1.0"?><rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel>${items.join("")}</channel></rss>`;
const APPCAST = feed(item(1171, "0.12.1", URL_0_12_1), item(1173, "0.12.2", URL_0_12_2));

const plistOf = (app: string) => join(app, "Contents", "Info.plist");

interface Script {
  /** Bundle id per app path, answering plutil. */
  ids?: Record<string, string>;
  versions?: Record<string, string>;
  curl?: ExecResult;
  /** Runs when the download starts, to change the machine mid-install. */
  onCurl?: () => void;
  unzip?: ExecResult;
  /** The plutil answer for the unpacked download, in place of its bundle id. */
  plutilApp?: ExecResult;
  codesignVerify?: ExecResult;
  codesignDetails?: ExecResult;
  spctl?: ExecResult;
  copy?: ExecResult;
  /** What `sw_vers -productVersion` prints; an empty answer reads as unreadable. */
  macos?: ExecResult;
}

function flockExec(script: Script) {
  const ids = { [APP]: FLOCK_BUNDLE_ID, ...(script.ids ?? {}) };
  return (argv: string[]): ExecResult => {
    if (argv[0] === "/usr/bin/plutil") {
      const app = argv[6]!.replace(/\/Contents\/Info\.plist$/, "");
      if (app === APP && script.plutilApp) return script.plutilApp;
      if (argv[2] === "CFBundleIdentifier") return ids[app] ? ok(`${ids[app]}\n`) : { code: 1, stdout: "", stderr: "no plist" };
      return ok(`${script.versions?.[app] ?? "0.12.2"}\n`);
    }
    if (argv[0] === "sw_vers") return script.macos ?? ok();
    if (argv[0] === "curl") {
      script.onCurl?.();
      return script.curl ?? ok();
    }
    if (argv[0] === "ditto" && argv[1] === "-x") return script.unzip ?? ok();
    if (argv[0] === "ditto") return script.copy ?? ok();
    if (argv[0] === "/usr/bin/codesign" && argv[1] === "--verify") return script.codesignVerify ?? ok();
    if (argv[0] === "/usr/bin/codesign" && argv[1] === "-dv") return script.codesignDetails ?? { code: 0, stdout: "", stderr: "Identifier=dev.mattstack.Flock\nTeamIdentifier=5BF66B3X4V\n" };
    if (argv[0] === "/usr/sbin/spctl") return script.spctl ?? ok();
    return ok();
  };
}

function setup(script: Script = {}, extra: FakeProbesOpts = {}, opts: { fetchStatus?: number; body?: string } = {}) {
  const status = opts.fetchStatus ?? 200;
  return fakeProbes({
    home: HOME,
    env: { TMPDIR: TMP },
    exec: flockExec(script),
    fetch: async () => ({ status, body: status === 200 ? (opts.body ?? APPCAST) : "Not Found", headers: {} }),
    statPaths: { "/Applications": { isDirectory: true, writable: true } },
    dirs: { [APP]: [] },
    files: { [plistOf(APP)]: "plist" },
    ...extra,
  });
}

const copies = (p: ReturnType<typeof setup>) => p.calls.exec.filter((a) => a[0] === "ditto" && a[1] !== "-x");

describe("parseFlockAppcast", () => {
  test("takes the highest build", () => {
    expect(parseFlockAppcast(APPCAST)).toEqual({ version: "0.12.2", build: 1173, url: URL_0_12_2 });
  });

  test("rejects an enclosure outside the repo", () => {
    expect(parseFlockAppcast(feed(item(1, "0.1.0", "https://example.com/Flock.zip")))).toBeNull();
    expect(parseFlockAppcast(feed(item(1, "0.1.0", "https://github.com/m4ttstack/flock/releases/download/v0.1.0/Flock.dmg")))).toBeNull();
    expect(parseFlockAppcast("not xml at all")).toBeNull();
  });

  test("rejects an enclosure that climbs out of the release folder", () => {
    expect(parseFlockAppcast(feed(item(1, "0.1.0", "https://github.com/m4ttstack/flock/releases/download/../../../evil/Flock.zip")))).toBeNull();
  });

  test("skips an item with no integer build and takes the best of the rest", () => {
    const bad = item(1, "9.9.9", URL_0_12_2).replace("<sparkle:version>1</sparkle:version>", "<sparkle:version>abc</sparkle:version>");
    expect(parseFlockAppcast(feed(bad, item(1171, "0.12.1", URL_0_12_1)))?.version).toBe("0.12.1");
  });
});

describe("parseFlockAppcast and the Mac's macOS", () => {
  const needs15 = item(1171, "0.12.1", URL_0_12_1, "15.0");
  const needs16 = item(1173, "0.12.2", URL_0_12_2, "16.0");

  test("takes the highest build that fits this Mac", () => {
    expect(parseFlockAppcast(feed(needs15, needs16), "15.2")?.version).toBe("0.12.1");
    expect(parseFlockAppcast(feed(needs15, needs16), "16.0")?.version).toBe("0.12.2");
  });

  test("compares dotted numbers, not just the major", () => {
    const x = feed(item(1173, "0.12.2", URL_0_12_2, "15.4"));
    expect(parseFlockAppcast(x, "15.3.9")).toBeNull();
    expect(parseFlockAppcast(x, "15.4")?.version).toBe("0.12.2");
    expect(parseFlockAppcast(x, "15.4.1")?.version).toBe("0.12.2");
    expect(parseFlockAppcast(x, "15.10")?.version).toBe("0.12.2");
  });

  test("an item with no minimum fits, and so does an unknown macOS", () => {
    expect(parseFlockAppcast(feed(item(1171, "0.12.1", URL_0_12_1), needs16), "14.0")?.version).toBe("0.12.1");
    expect(parseFlockAppcast(feed(needs16), null)?.version).toBe("0.12.2");
    expect(parseFlockAppcast(feed(needs16))?.version).toBe("0.12.2");
  });
});

describe("fetchFlockRelease", () => {
  test("reads the latest feed and returns null on 404", async () => {
    const p = setup();
    expect((await fetchFlockRelease(p))?.version).toBe("0.12.2");
    expect(p.calls.fetch[0]).toBe(FLOCK_APPCAST_URL);
    expect(await fetchFlockRelease(setup({}, {}, { fetchStatus: 404 }))).toBeNull();
  });

  test("a throwing fetch is null", async () => {
    const p = setup({}, { fetch: async () => { throw new Error("offline"); } });
    expect(await fetchFlockRelease(p)).toBeNull();
  });
});

describe("Flock's macOS floor", () => {
  const tooNew = (min: string) => feed(item(1173, "0.12.2", URL_0_12_2, min));

  test("a Mac below macOS 15 is refused without a fetch", async () => {
    const p = setup({ macos: ok("14.7.1\n") });
    expect(await installFlock(p)).toEqual({ via: "download", ok: false, detail: "Flock needs macOS 15 or newer" });
    expect(p.calls.fetch).toEqual([]);
    expect(p.calls.exec.some((a) => a[0] === "curl")).toBe(false);
  });

  test("an installed Flock is reported installed on any macOS", async () => {
    const p = setup({ macos: ok("14.7.1\n"), ids: { [SYSTEM]: FLOCK_BUNDLE_ID } }, { files: { [plistOf(SYSTEM)]: "plist" } });
    expect(await installFlock(p)).toMatchObject({ ok: true, detail: "Flock 0.12.2 is already installed" });
  });

  test("macOS 15 installs the newest build that fits", async () => {
    const p = setup({ macos: ok("15.1\n") }, {}, { body: feed(item(1171, "0.12.1", URL_0_12_1, "15.0"), item(1173, "0.12.2", URL_0_12_2, "16.0")) });
    expect((await installFlock(p)).detail).toBe("Installed Flock 0.12.1 in /Applications");
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", URL_0_12_1, "-o", ZIP]);
  });

  test("a feed where nothing fits names the lowest minimum on offer", async () => {
    const p = setup({ macos: ok("15.1\n") }, {}, { body: feed(item(1171, "0.12.1", URL_0_12_1, "16.0"), item(1173, "0.12.2", URL_0_12_2, "17.0")) });
    expect(await installFlock(p)).toEqual({ via: "download", ok: false, detail: "Flock needs macOS 16 or newer" });
    expect(p.calls.exec.some((a) => a[0] === "curl")).toBe(false);
    expect((await installFlock(setup({ macos: ok("15.1\n") }, {}, { body: tooNew("16.2") }))).detail).toBe("Flock needs macOS 16 or newer");
  });

  test("a version that cannot be read does not count as too old", async () => {
    for (const macos of [ok(""), { code: 1, stdout: "", stderr: "boom" }]) {
      const p = setup({ macos });
      expect((await installFlock(p)).ok).toBe(true);
    }
  });
});

describe("installedFlock", () => {
  test("finds Flock in either folder and ignores Flock-dev", async () => {
    const inUser = setup({ ids: { [USER]: FLOCK_BUNDLE_ID } }, { files: { [plistOf(USER)]: "plist" } });
    expect(await installedFlock(inUser)).toEqual({ path: USER, version: "0.12.2" });
    const dev = setup({ ids: { [SYSTEM]: "dev.mattstack.Flock.dev" } }, { files: { [plistOf(SYSTEM)]: "plist" } });
    expect(await installedFlock(dev)).toBeNull();
  });

  test("flockAppDirs lists the system folder, then the user's", () => {
    expect(flockAppDirs(HOME)).toEqual(["/Applications", "/fake-home/Applications"]);
  });
});

describe("installFlock", () => {
  test("installs the latest release into /Applications", async () => {
    const p = setup();
    const result = await installFlock(p);
    expect(p.calls.exec).toContainEqual(["curl", "-fsSL", URL_0_12_2, "-o", ZIP]);
    expect(p.calls.exec).toContainEqual(["ditto", "-x", "-k", ZIP, UNPACKED]);
    expect(p.calls.exec).toContainEqual(["ditto", APP, stagedIn("/Applications")]);
    expect(p.calls.renames).toEqual([[stagedIn("/Applications"), SYSTEM]]);
    expect(result).toEqual({ via: "download", ok: true, placed: true, detail: "Installed Flock 0.12.2 in /Applications" });
    expect(p.calls.removed).toContain(WORK);
    expect(p.calls.removed).not.toContain(SYSTEM);
  });

  test("installs into ~/Applications when /Applications is not writable", async () => {
    const p = setup({}, { statPaths: { "/Applications": { isDirectory: true, writable: false } } });
    const result = await installFlock(p);
    const userDir = join(HOME, "Applications");
    expect(p.calls.exec).toContainEqual(["ditto", APP, stagedIn(userDir)]);
    expect(p.calls.renames).toEqual([[stagedIn(userDir), USER]]);
    expect(p.exists(userDir)).toBe(true);
    expect(result.detail).toBe("Installed Flock 0.12.2 in ~/Applications");
  });

  test("already installed does nothing", async () => {
    const p = setup({ ids: { [SYSTEM]: FLOCK_BUNDLE_ID } }, { files: { [plistOf(SYSTEM)]: "plist" } });
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: true, detail: "Flock 0.12.2 is already installed" });
    expect(p.calls.fetch).toEqual([]);
    expect(p.calls.exec.some((a) => a[0] === "curl")).toBe(false);
  });

  test("feed unreachable installs nothing", async () => {
    const p = setup({}, {}, { fetchStatus: 404 });
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: false, detail: "rt could not read Flock's release feed from m4ttstack/flock" });
    expect(p.calls.exec.some((a) => a[0] === "curl")).toBe(false);
  });

  test("a download that fails or times out names why and installs nothing", async () => {
    const failed = setup({ curl: { code: 22, stdout: "", stderr: "curl: (22) 404\nmore" } });
    expect((await installFlock(failed)).detail).toBe("Downloading Flock failed (exit 22): curl: (22) 404");
    const slow = setup({ curl: { code: 124, stdout: "", stderr: "" } });
    expect((await installFlock(slow)).detail).toBe("Downloading Flock did not finish in time");
    expect(copies(failed)).toEqual([]);
    expect(failed.calls.removed).toContain(WORK);
  });

  test("a zip that will not unpack fails", async () => {
    const p = setup({ unzip: { code: 1, stdout: "", stderr: "bad zip\n" } });
    expect((await installFlock(p)).detail).toBe("Unpacking the Flock download failed: bad zip");
  });

  test("refuses a zip without Flock.app", async () => {
    const p = setup({}, { dirs: {}, files: {} });
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: false, detail: "The Flock download has no Flock.app in it, so nothing was installed" });
    expect(copies(p)).toEqual([]);
    expect(p.calls.removed).toContain(WORK);
  });

  test("refuses an app from another team", async () => {
    const p = setup({ codesignDetails: { code: 0, stdout: "", stderr: "TeamIdentifier=ABCDE12345\n" } });
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: false, detail: "The Flock download is not signed and notarized by mattstack, so nothing was installed" });
    expect(copies(p)).toEqual([]);
    expect(p.calls.renames).toEqual([]);
  });

  test("codesign itself pins the Developer ID team and notarization", async () => {
    const p = setup();
    await installFlock(p);
    expect(p.calls.exec).toContainEqual([
      "/usr/bin/codesign",
      "--verify",
      "--deep",
      "--strict",
      '-R=anchor apple generic and certificate leaf[subject.OU] = "5BF66B3X4V" and notarized',
      APP,
    ]);
  });

  test("refuses an app with another bundle id", async () => {
    const p = setup({ ids: { [APP]: "dev.mattstack.Flock.dev" } });
    expect((await installFlock(p)).ok).toBe(false);
    expect(copies(p)).toEqual([]);
  });

  test("refuses an app whose signature does not verify", async () => {
    const p = setup({ codesignVerify: { code: 1, stdout: "", stderr: "invalid" } });
    expect((await installFlock(p)).ok).toBe(false);
    expect(copies(p)).toEqual([]);
  });

  test("refuses an app spctl rejects", async () => {
    const p = setup({ spctl: { code: 3, stdout: "", stderr: "rejected" } });
    const result = await installFlock(p);
    expect(result.ok).toBe(false);
    expect(copies(p)).toEqual([]);
  });

  test("does not copy over a Flock that appeared during the download", async () => {
    const p: ReturnType<typeof setup> = setup({ ids: { [SYSTEM]: FLOCK_BUNDLE_ID }, onCurl: () => p.writeFile(plistOf(SYSTEM), "plist") });
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: true, detail: "Flock 0.12.2 is already installed" });
    expect(copies(p)).toEqual([]);
    expect(p.calls.renames).toEqual([]);
  });

  test("does not copy over something else named Flock.app", async () => {
    const p = setup({ ids: { [SYSTEM]: "com.example.NotFlock" } }, { dirs: { [APP]: [], [SYSTEM]: [] }, files: { [plistOf(APP)]: "plist", [plistOf(SYSTEM)]: "plist" } });
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: false, detail: "Something else is at /Applications/Flock.app, so nothing was installed" });
    expect(copies(p)).toEqual([]);
    expect(p.calls.removed).not.toContain(SYSTEM);
  });

  test("a failed copy removes only the staged copy", async () => {
    const p = setup({ copy: { code: 1, stdout: "", stderr: "No space left on device\nmore" } });
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: false, detail: "Copying Flock into /Applications failed: No space left on device" });
    expect(p.calls.removed).toContain(stagedIn("/Applications"));
    expect(p.calls.removed).not.toContain(SYSTEM);
    expect(p.calls.renames).toEqual([]);
  });

  test("a failed rename removes only the staged copy", async () => {
    const p = setup();
    p.rename = (from, to) => {
      p.calls.renames.push([from, to]);
      throw new Error("EXDEV: cross-device link");
    };
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: false, detail: "Copying Flock into /Applications failed: EXDEV: cross-device link" });
    expect(p.calls.removed).toContain(stagedIn("/Applications"));
    expect(p.calls.removed).not.toContain(SYSTEM);
  });

  test("a rename that fails because Flock appeared during the copy reports it installed", async () => {
    const p: ReturnType<typeof setup> = setup({ ids: { [SYSTEM]: FLOCK_BUNDLE_ID } });
    p.rename = (from, to) => {
      p.calls.renames.push([from, to]);
      p.writeFile(plistOf(SYSTEM), "plist");
      throw new Error("ENOTEMPTY: directory not empty");
    };
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: true, detail: "Flock 0.12.2 is already installed" });
    expect(p.calls.removed).toContain(stagedIn("/Applications"));
    expect(p.calls.removed).not.toContain(SYSTEM);
  });

  test("unpacking and copying that time out say so", async () => {
    const slowUnzip = setup({ unzip: { code: 124, stdout: "", stderr: "" } });
    expect((await installFlock(slowUnzip)).detail).toBe("Unpacking the Flock download did not finish in time");
    const slowCopy = setup({ copy: { code: 124, stdout: "", stderr: "" } });
    expect((await installFlock(slowCopy)).detail).toBe("Copying Flock into /Applications did not finish in time");
    expect(slowCopy.calls.removed).toContain(stagedIn("/Applications"));
  });

  test("a verification command that times out is not read as a bad signature", async () => {
    const timedOut = { code: 124, stdout: "", stderr: "" };
    for (const script of [{ plutilApp: timedOut }, { codesignVerify: timedOut }, { codesignDetails: timedOut }, { spctl: timedOut }]) {
      const p = setup(script);
      expect(await installFlock(p)).toEqual({ via: "download", ok: false, detail: "Checking the Flock download's signature did not finish in time, so nothing was installed" });
      expect(copies(p)).toEqual([]);
    }
  });

  test("a throw while installing becomes a failure and the work folder still goes", async () => {
    const p = setup({}, { statPaths: { "/Applications": { isDirectory: true, writable: false } } });
    const mkdirp = p.mkdirp.bind(p);
    p.mkdirp = (path, mode) => {
      if (path === join(HOME, "Applications")) throw new Error("EACCES: permission denied");
      mkdirp(path, mode);
    };
    const result = await installFlock(p);
    expect(result).toEqual({ via: "download", ok: false, detail: "Installing Flock failed: EACCES: permission denied" });
    expect(p.calls.removed).toContain(WORK);
  });

  test("a stale staged copy for this pid is removed before the copy", async () => {
    const stale = stagedIn("/Applications");
    const p = setup({}, { dirs: { [APP]: [], [stale]: [] } });
    const result = await installFlock(p);
    expect(result.ok).toBe(true);
    expect(p.calls.removed).toContain(stale);
  });

  test("a result that put the app in place says so, and one that found it already there does not", async () => {
    expect(await installFlock(setup())).toMatchObject({ ok: true, placed: true });
    const there = setup({ ids: { [SYSTEM]: FLOCK_BUNDLE_ID } }, { files: { [plistOf(SYSTEM)]: "plist" } });
    expect((await installFlock(there)).placed).toBeUndefined();
  });
});
