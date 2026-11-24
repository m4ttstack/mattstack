/**
 * Installs the notarized Flock app from m4ttstack/flock's latest release.
 * The download is verified (bundle id, Developer ID team, notarization)
 * before it is placed, and an installed Flock is never replaced or touched:
 * Sparkle updates it from there.
 */

import { join } from "path";
import type { InstallResult } from "./install-result.ts";
import type { Probes } from "./probes.ts";

export const FLOCK_APPCAST_URL = "https://github.com/m4ttstack/flock/releases/latest/download/appcast.xml";
export const FLOCK_DOWNLOAD_PREFIX = "https://github.com/m4ttstack/flock/releases/download/";
export const FLOCK_BUNDLE_ID = "dev.mattstack.Flock";
export const FLOCK_TEAM_ID = "5BF66B3X4V";

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

/** The item with the highest `sparkle:version` whose enclosure is a zip under the m4ttstack/flock release downloads. */
export function parseFlockAppcast(xml: string): FlockRelease | null {
  let best: FlockRelease | null = null;
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const block = item[1]!;
    const build = tag(block, "sparkle:version");
    const version = tag(block, "sparkle:shortVersionString");
    const url = block.match(/<enclosure\b[^>]*?\burl="([^"]+)"/)?.[1];
    if (!build || !/^\d+$/.test(build) || !version || !url) continue;
    if (!url.startsWith(FLOCK_DOWNLOAD_PREFIX) || !url.endsWith(".zip")) continue;
    if (!best || Number(build) > best.build) best = { version, build: Number(build), url };
  }
  return best;
}

export async function fetchFlockRelease(p: Pick<Probes, "fetch">): Promise<FlockRelease | null> {
  try {
    const res = await p.fetch(FLOCK_APPCAST_URL, { timeoutMs: FEED_TIMEOUT_MS });
    return res.status === 200 ? parseFlockAppcast(res.body) : null;
  } catch {
    return null;
  }
}

export interface InstalledFlock {
  path: string;
  version: string | null;
}

async function plistValue(p: Probes, plist: string, key: string): Promise<string | null> {
  const res = await p.exec(["/usr/bin/plutil", "-extract", key, "raw", "-o", "-", plist], { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
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

/** Bundle id, team, signature and notarization, each by exit code. */
async function isMattstackFlock(p: Probes, app: string): Promise<boolean> {
  if ((await plistValue(p, join(app, "Contents", "Info.plist"), "CFBundleIdentifier")) !== FLOCK_BUNDLE_ID) return false;
  const strict = await p.exec(["/usr/bin/codesign", "--verify", "--deep", "--strict", app], { timeoutMs: VERIFY_TIMEOUT_MS });
  if (strict.code !== 0) return false;
  const details = await p.exec(["/usr/bin/codesign", "-dv", app], { timeoutMs: PROBE_TIMEOUT_MS });
  if (details.code !== 0 || !new RegExp(`^TeamIdentifier=${FLOCK_TEAM_ID}$`, "m").test(details.stderr)) return false;
  const assessed = await p.exec(["/usr/sbin/spctl", "--assess", "--type", "execute", app], { timeoutMs: VERIFY_TIMEOUT_MS });
  return assessed.code === 0;
}

function shown(home: string, dir: string): string {
  return dir === join(home, "Applications") ? "~/Applications" : dir;
}

export async function installFlock(p: Probes): Promise<InstallResult> {
  const fail = (detail: string): InstallResult => ({ via: "download", ok: false, detail });
  const already = (f: InstalledFlock): InstallResult => ({ via: "download", ok: true, detail: `Flock ${f.version ? `${f.version} ` : ""}is already installed` });

  const present = await installedFlock(p);
  if (present) return already(present);

  const release = await fetchFlockRelease(p);
  if (!release) return fail("rt could not read Flock's release feed from m4ttstack/flock");

  const work = join(p.env.TMPDIR || "/tmp", `rt-flock-install-${process.pid}`);
  try {
    await p.exec(["rm", "-rf", work], { timeoutMs: PROBE_TIMEOUT_MS });
    p.mkdirp(work);
    const zip = join(work, "Flock.zip");
    const fetched = await p.exec(["curl", "-fsSL", release.url, "-o", zip], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    if (fetched.code === 124) return fail("Downloading Flock did not finish in time");
    if (fetched.code !== 0) return fail(`Downloading Flock failed (exit ${fetched.code}): ${firstLine(fetched.stderr || fetched.stdout)}`);

    const unpacked = join(work, "unpacked");
    const unzipped = await p.exec(["ditto", "-x", "-k", zip, unpacked], { timeoutMs: VERIFY_TIMEOUT_MS });
    if (unzipped.code !== 0) return fail(`Unpacking the Flock download failed: ${firstLine(unzipped.stderr || unzipped.stdout)}`);
    const app = join(unpacked, "Flock.app");
    if (!p.exists(app)) return fail("The Flock download has no Flock.app in it, so nothing was installed");

    if (!(await isMattstackFlock(p, app))) return fail("The Flock download is not signed and notarized by mattstack, so nothing was installed");

    const target = p.statPath("/Applications")?.writable ? "/Applications" : join(p.home, "Applications");
    const targetShown = shown(p.home, target);
    if (target !== "/Applications") p.mkdirp(target);
    const appeared = await installedFlock(p);
    if (appeared) return already(appeared);
    const dest = join(target, "Flock.app");
    if (p.exists(dest)) return fail(`Something else is at ${targetShown}/Flock.app, so nothing was installed`);

    // A copy killed midway must never leave a half-written Flock.app that reads ready, so it lands under a staged name and is renamed whole.
    const staged = join(target, `.Flock-${process.pid}.app`);
    if (p.exists(staged)) p.removeDir(staged);
    const copied = await p.exec(["ditto", app, staged], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    if (copied.code !== 0) {
      p.removeDir(staged);
      return fail(`Copying Flock into ${targetShown} failed: ${firstLine(copied.stderr || copied.stdout)}`);
    }
    try {
      p.rename(staged, dest);
    } catch (e) {
      p.removeDir(staged);
      return fail(`Copying Flock into ${targetShown} failed: ${(e as Error).message}`);
    }
    return { via: "download", ok: true, detail: `Installed Flock ${release.version} in ${targetShown}` };
  } finally {
    p.removeDir(work);
  }
}
