/**
 * Installs the notarized Flock app from m4ttstack/flock's latest release.
 * The download is verified (bundle id, Developer ID team, notarization)
 * before it is placed, and an installed Flock is never replaced or touched:
 * Sparkle updates it from there.
 */

import { join } from "path";
import type { InstallResult } from "./install-result.ts";
import { readMacosVersion } from "./macos-version.ts";
import type { ExecResult, Probes } from "./probes.ts";

export const FLOCK_APPCAST_URL = "https://github.com/m4ttstack/flock/releases/latest/download/appcast.xml";
export const FLOCK_DOWNLOAD_PREFIX = "https://github.com/m4ttstack/flock/releases/download/";
export const FLOCK_BUNDLE_ID = "dev.mattstack.Flock";
export const FLOCK_TEAM_ID = "5BF66B3X4V";
export const FLOCK_MIN_MACOS = 15;

export const flockNeedsMacos = (major: number = FLOCK_MIN_MACOS): string => `Flock needs macOS ${major} or newer`;

const FEED_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const VERIFY_TIMEOUT_MS = 60_000;

export function flockAppDirs(home: string): string[] {
  return ["/Applications", join(home, "Applications")];
}

export interface FlockRelease {
  version: string;
  build: number;
  url: string;
}

function firstLine(s: string): string {
  return s.trim().split("\n")[0] ?? "";
}

function tag(block: string, name: string): string | null {
  return block.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`))?.[1] ?? null;
}

/** Dotted numbers compared part by part, so 15.10 is newer than 15.4. */
function versionAtLeast(have: string, min: string): boolean {
  const a = have.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export interface FlockFeed {
  /** The highest build that fits this Mac; null when none does. */
  release: FlockRelease | null;
  /** The lowest macOS any usable item asks for, so a feed with nothing that fits can say what would. */
  lowestMinimum: string | null;
}

/** Items are zips under the m4ttstack/flock release downloads; `macos` null or absent keeps every item in play. */
export function readFlockFeed(xml: string, macos?: string | null): FlockFeed {
  let release: FlockRelease | null = null;
  let lowestMinimum: string | null = null;
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const block = item[1]!;
    const build = tag(block, "sparkle:version");
    const version = tag(block, "sparkle:shortVersionString");
    const url = block.match(/<enclosure\b[^>]*?\burl="([^"]+)"/)?.[1];
    if (!build || !/^\d+$/.test(build) || !version || !url) continue;
    if (!url.startsWith(FLOCK_DOWNLOAD_PREFIX) || !url.endsWith(".zip") || url.includes("..")) continue;
    const minimum = tag(block, "sparkle:minimumSystemVersion");
    if (minimum && (!lowestMinimum || versionAtLeast(lowestMinimum, minimum))) lowestMinimum = minimum;
    if (macos && minimum && !versionAtLeast(macos, minimum)) continue;
    if (!release || Number(build) > release.build) release = { version, build: Number(build), url };
  }
  return { release, lowestMinimum };
}

export function parseFlockAppcast(xml: string, macos?: string | null): FlockRelease | null {
  return readFlockFeed(xml, macos).release;
}

async function fetchFlockFeed(p: Pick<Probes, "fetch">, macos?: string | null): Promise<FlockFeed | null> {
  try {
    const res = await p.fetch(FLOCK_APPCAST_URL, { timeoutMs: FEED_TIMEOUT_MS });
    return res.status === 200 ? readFlockFeed(res.body, macos) : null;
  } catch {
    return null;
  }
}

export async function fetchFlockRelease(p: Pick<Probes, "fetch">, macos?: string | null): Promise<FlockRelease | null> {
  return (await fetchFlockFeed(p, macos))?.release ?? null;
}

/** A probe that throws counts as unreadable here: Flock's floor must never fail a row or an install on its own. */
const macosOrNull = (p: Pick<Probes, "exec">) => readMacosVersion(p).catch(() => null);

/** True only on a Mac whose version could be read and is below the floor. */
export async function flockBelowFloor(p: Pick<Probes, "exec">): Promise<boolean> {
  const macos = await macosOrNull(p);
  return macos !== null && macos.major < FLOCK_MIN_MACOS;
}

export interface InstalledFlock {
  path: string;
  version: string | null;
}

async function plutilRead(p: Probes, plist: string, key: string): Promise<ExecResult | null> {
  return p.exec(["/usr/bin/plutil", "-extract", key, "raw", "-o", "-", plist], { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
}

async function plistValue(p: Probes, plist: string, key: string): Promise<string | null> {
  const res = await plutilRead(p, plist, key);
  return res && res.code === 0 ? res.stdout.trim() : null;
}

export async function installedFlock(p: Probes): Promise<InstalledFlock | null> {
  for (const dir of flockAppDirs(p.home)) {
    const path = join(dir, "Flock.app");
    const plist = join(path, "Contents", "Info.plist");
    if (!p.exists(plist)) continue;
    if ((await plistValue(p, plist, "CFBundleIdentifier")) !== FLOCK_BUNDLE_ID) continue;
    return { path, version: (await plistValue(p, plist, "CFBundleShortVersionString")) || null };
  }
  return null;
}

/** "timeout" is kept apart from "bad": a slow Mac must not read as a forged download. */
async function verifyFlock(p: Probes, app: string): Promise<"ok" | "bad" | "timeout"> {
  const checks: [() => Promise<ExecResult | null>, (r: ExecResult) => boolean][] = [
    [() => plutilRead(p, join(app, "Contents", "Info.plist"), "CFBundleIdentifier"), (r) => r.stdout.trim() === FLOCK_BUNDLE_ID],
    [() => p.exec(["/usr/bin/codesign", "--verify", "--deep", "--strict", `-R=anchor apple generic and certificate leaf[subject.OU] = "${FLOCK_TEAM_ID}" and notarized`, app], { timeoutMs: VERIFY_TIMEOUT_MS }), () => true],
    [() => p.exec(["/usr/bin/codesign", "-dv", app], { timeoutMs: PROBE_TIMEOUT_MS }), (r) => new RegExp(`^TeamIdentifier=${FLOCK_TEAM_ID}$`, "m").test(r.stderr)],
    [() => p.exec(["/usr/sbin/spctl", "--assess", "--type", "execute", app], { timeoutMs: VERIFY_TIMEOUT_MS }), () => true],
  ];
  for (const [run, passes] of checks) {
    const res = await run();
    if (res?.code === 124) return "timeout";
    if (!res || res.code !== 0 || !passes(res)) return "bad";
  }
  return "ok";
}

function shown(home: string, dir: string): string {
  return dir === join(home, "Applications") ? "~/Applications" : dir;
}

export async function installFlock(p: Probes): Promise<InstallResult> {
  const fail = (detail: string): InstallResult => ({ via: "download", ok: false, detail });
  const already = (f: InstalledFlock): InstallResult => ({ via: "download", ok: true, detail: `Flock ${f.version ? `${f.version} ` : ""}is already installed` });

  const work = join(p.env.TMPDIR || "/tmp", `rt-flock-install-${process.pid}`);
  let staged: string | null = null;
  try {
    const present = await installedFlock(p);
    if (present) return already(present);

    const macos = await macosOrNull(p);
    if (macos && macos.major < FLOCK_MIN_MACOS) return fail(flockNeedsMacos());

    const feed = await fetchFlockFeed(p, macos?.version);
    if (feed?.lowestMinimum && !feed.release) return fail(flockNeedsMacos(Number.parseInt(feed.lowestMinimum, 10)));
    const release = feed?.release;
    if (!release) return fail("rt could not read Flock's release feed from m4ttstack/flock");

    await p.exec(["rm", "-rf", work], { timeoutMs: PROBE_TIMEOUT_MS });
    p.mkdirp(work);
    const zip = join(work, "Flock.zip");
    const fetched = await p.exec(["curl", "-fsSL", release.url, "-o", zip], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    if (fetched.code === 124) return fail("Downloading Flock did not finish in time");
    if (fetched.code !== 0) return fail(`Downloading Flock failed (exit ${fetched.code}): ${firstLine(fetched.stderr || fetched.stdout)}`);

    const unpacked = join(work, "unpacked");
    const unzipped = await p.exec(["ditto", "-x", "-k", zip, unpacked], { timeoutMs: VERIFY_TIMEOUT_MS });
    if (unzipped.code === 124) return fail("Unpacking the Flock download did not finish in time");
    if (unzipped.code !== 0) return fail(`Unpacking the Flock download failed: ${firstLine(unzipped.stderr || unzipped.stdout)}`);
    const app = join(unpacked, "Flock.app");
    if (!p.exists(app)) return fail("The Flock download has no Flock.app in it, so nothing was installed");

    const verdict = await verifyFlock(p, app);
    if (verdict === "timeout") return fail("Checking the Flock download's signature did not finish in time, so nothing was installed");
    if (verdict === "bad") return fail("The Flock download is not signed and notarized by mattstack, so nothing was installed");

    const target = p.statPath("/Applications")?.writable ? "/Applications" : join(p.home, "Applications");
    const targetShown = shown(p.home, target);
    if (target !== "/Applications") p.mkdirp(target);
    const appeared = await installedFlock(p);
    if (appeared) return already(appeared);
    const dest = join(target, "Flock.app");
    if (p.exists(dest)) return fail(`Something else is at ${targetShown}/Flock.app, so nothing was installed`);

    // A copy killed midway must never leave a half-written Flock.app that reads ready, so it lands under a staged name and is renamed whole.
    staged = join(target, `.Flock-${process.pid}.new`);
    if (p.exists(staged)) p.removeDir(staged);
    const copied = await p.exec(["ditto", app, staged], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    if (copied.code !== 0) {
      p.removeDir(staged);
      return fail(copied.code === 124 ? `Copying Flock into ${targetShown} did not finish in time` : `Copying Flock into ${targetShown} failed: ${firstLine(copied.stderr || copied.stdout)}`);
    }
    try {
      p.rename(staged, dest);
    } catch (e) {
      p.removeDir(staged);
      const raced = await installedFlock(p);
      return raced ? already(raced) : fail(`Copying Flock into ${targetShown} failed: ${(e as Error).message}`);
    }
    return { via: "download", ok: true, placed: true, detail: `Installed Flock ${release.version} in ${targetShown}` };
  } catch (e) {
    if (staged) p.removeDir(staged);
    return fail(`Installing Flock failed: ${(e as Error).message}`);
  } finally {
    p.removeDir(work);
  }
}
