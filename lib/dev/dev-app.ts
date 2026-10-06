import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { DEV_APP_PATH, swapDevApp, type AppSwapSeams } from "../release/app-swap.ts";
import type { Probes } from "../setup/probes.ts";

export const DEV_RELEASE_REPO = "m4ttstack/mattstack";

export function devZipName(version: string): string {
  return `mattstack-dev-${version}.zip`;
}

export interface DevRelease {
  tag: string;
  version: string;
  zipUrl: string;
  sumsUrl: string;
}

interface ApiRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

export function devReleaseCandidates(releasesJson: string): DevRelease[] {
  let list: ApiRelease[];
  try {
    const parsed = JSON.parse(releasesJson);
    list = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
  const out: DevRelease[] = [];
  for (const r of list) {
    if (r.draft || r.prerelease || typeof r.tag_name !== "string") continue;
    const version = r.tag_name.replace(/^v/, "");
    const zip = r.assets?.find((a) => a.name === devZipName(version));
    const sums = r.assets?.find((a) => a.name === "SHA256SUMS");
    if (!zip?.browser_download_url || !sums?.browser_download_url) continue;
    out.push({ tag: r.tag_name, version, zipUrl: zip.browser_download_url, sumsUrl: sums.browser_download_url });
  }
  return out;
}

export function expectedSha(sums: string, fileName: string): string | null {
  for (const line of sums.split("\n")) {
    const m = line.match(/^([0-9a-f]+)\s+\*?(.+)$/i);
    if (m && m[2]!.trim() === fileName) return m[1]!.toLowerCase();
  }
  return null;
}

export async function chooseDevRelease(p: Probes, candidates: DevRelease[]): Promise<{ release: DevRelease; sha: string } | null> {
  for (const release of candidates) {
    const sums = await p.fetch(release.sumsUrl, { timeoutMs: 15_000 });
    if (sums.status !== 200) continue;
    const sha = expectedSha(sums.body, devZipName(release.version));
    if (sha) return { release, sha };
  }
  return null;
}

export async function listDevReleases(p: Probes, gh: string[]): Promise<DevRelease[]> {
  const r = await p.exec([...gh, "api", `repos/${DEV_RELEASE_REPO}/releases?per_page=20`], { timeoutMs: 30_000 });
  if (r.code !== 0) {
    throw new UserActionableError("dev-releases-unreadable", "rt could not list mattstack's releases", {}, { why: "GitHub did not answer.", log: r.stderr || r.stdout });
  }
  return devReleaseCandidates(r.stdout);
}

export interface InstalledDevApp {
  version: string;
  releaseBuild: boolean;
}

export async function readInstalledDevApp(p: Probes, appPath: string = DEV_APP_PATH): Promise<InstalledDevApp | null> {
  const plist = join(appPath, "Contents", "Info.plist");
  if (!p.exists(plist)) return null;
  const read = (key: string) => p.exec(["plutil", "-extract", key, "raw", "-o", "-", plist], { timeoutMs: 5000 });
  const version = await read("CFBundleShortVersionString");
  if (version.code !== 0) return null;
  const flag = await read("MSDevReleaseBuild");
  return { version: version.stdout.trim(), releaseBuild: flag.code === 0 && flag.stdout.trim() === "true" };
}

export interface DevAppInstallSeams {
  probes: Probes;
  swap: AppSwapSeams;
  download(url: string, dest: string): Promise<void>;
  scratchDir(): string;
}

export async function installDevAppFromRelease(
  s: DevAppInstallSeams,
  chosen: { release: DevRelease; sha: string },
): Promise<{ swapped: boolean; relaunchedPid: number | null }> {
  const p = s.probes;
  const scratch = s.scratchDir();
  const zip = join(scratch, devZipName(chosen.release.version));
  await s.download(chosen.release.zipUrl, zip);

  const sum = await p.exec(["shasum", "-a", "256", zip], { timeoutMs: 60_000 });
  const actual = sum.stdout.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (sum.code !== 0 || actual !== chosen.sha) {
    throw new UserActionableError(
      "dev-zip-checksum",
      "The downloaded dev app does not match its release checksum",
      {},
      {
        why: "rt did not install it. Try again; if it keeps happening, tell the maintainers.",
        log: `expected ${chosen.sha}, got ${actual || sum.stderr}`,
      },
    );
  }

  const unpacked = join(scratch, "unpacked");
  const unzip = await p.exec(["ditto", "-x", "-k", zip, unpacked], { timeoutMs: 120_000 });
  if (unzip.code !== 0) throw new UserActionableError("dev-zip-unpack", "rt could not unpack the dev app", {}, { log: unzip.stderr });
  const app = join(unpacked, "mattstack-dev.app");
  if (!p.exists(join(app, "Contents", "Info.plist"))) {
    throw new UserActionableError("dev-zip-unpack", "The downloaded dev app is incomplete", {}, { why: "rt did not install it. Tell the maintainers." });
  }

  // ditto onto an existing bundle merges into it, so anything already there, readable or not, is swapped.
  if (!p.exists(DEV_APP_PATH)) {
    const copy = await p.exec(["ditto", app, DEV_APP_PATH], { timeoutMs: 120_000 });
    if (copy.code !== 0) throw new UserActionableError("dev-app-swap", "Copying the dev app into Applications failed", {}, { log: copy.stderr || copy.stdout });
    return { swapped: false, relaunchedPid: null };
  }
  const swap = await swapDevApp(s.swap, app);
  if (!swap.ok) throw new UserActionableError("dev-app-swap", "rt could not swap in the new dev app", {}, { log: swap.error });
  return { swapped: true, relaunchedPid: swap.pid };
}
