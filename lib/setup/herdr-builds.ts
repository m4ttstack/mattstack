/**
 * The m4ttstack/herdr fork's build list, herdr's version string, and the
 * verdict setup draws from the two: a fork build at or past the list's
 * newest is current, an older one is outdated, and every stock herdr needs
 * the fork build however new its version.
 */

import type { Probes } from "./probes.ts";
import type { HostArch } from "./requirements.ts";
import { atLeast } from "./semver.ts";

export const HERDR_BUILDS_URL = "https://github.com/m4ttstack/herdr/releases/latest/download/herdr-builds.json";
export const HERDR_MIN_BUILD = "0.9.5-ms.1";
export const HERDR_ASSET_PREFIX = "https://github.com/m4ttstack/herdr/releases/download/";

const FETCH_TIMEOUT_MS = 10_000;
const HOST_ARCHES: readonly HostArch[] = ["arm64", "x86_64"];
const SHA256 = /^[0-9a-f]{64}$/;
const FORK_VERSION = /^(\d+(?:\.\d+)*)-ms\.(\d+)$/;

export interface HerdrBuildAsset {
  url: string;
  sha256: string;
}

export interface HerdrBuild {
  version: string;
  herdr: string;
  revision: number;
  changesServer: boolean;
  assets: Partial<Record<HostArch, HerdrBuildAsset>>;
  supersedes: string[];
}

export interface HerdrBuilds {
  schema: 1;
  newest: string;
  builds: HerdrBuild[];
}

export interface ForkVersion {
  herdr: string;
  revision: number;
}

export type HerdrVerdict =
  | { kind: "current"; version: string; checked: boolean }
  | { kind: "outdated"; version: string; target: string; belowMinimum: boolean }
  | { kind: "stock"; version: string; target: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A dot segment would pass a plain prefix check and still leave the fork once resolved, so only a URL already in its resolved form counts. */
function isCanonicalForkUrl(url: string): boolean {
  try {
    return new URL(url).href === url && url.startsWith(HERDR_ASSET_PREFIX);
  } catch {
    return false;
  }
}

function parseAsset(raw: unknown): HerdrBuildAsset | null {
  if (!isRecord(raw) || typeof raw.url !== "string" || typeof raw.sha256 !== "string") return null;
  if (!isCanonicalForkUrl(raw.url) || !SHA256.test(raw.sha256)) return null;
  return { url: raw.url, sha256: raw.sha256 };
}

function parseBuild(raw: unknown): HerdrBuild | null {
  if (!isRecord(raw)) return null;
  const { version, herdr, revision, changesServer, assets, supersedes } = raw;
  if (typeof version !== "string" || typeof herdr !== "string" || typeof revision !== "number" || typeof changesServer !== "boolean") return null;
  const fork = forkOf(version);
  if (!fork || fork.herdr !== herdr || fork.revision !== revision) return null;
  if (!isRecord(assets) || !Array.isArray(supersedes) || !supersedes.every((s) => typeof s === "string")) return null;
  const parsed: Partial<Record<HostArch, HerdrBuildAsset>> = {};
  for (const [arch, entry] of Object.entries(assets)) {
    const asset = parseAsset(entry);
    if (!asset) return null;
    if ((HOST_ARCHES as readonly string[]).includes(arch)) parsed[arch as HostArch] = asset;
  }
  return { version, herdr, revision, changesServer, assets: parsed, supersedes: supersedes as string[] };
}

export function parseHerdrBuilds(text: string): HerdrBuilds | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.schema !== 1 || typeof raw.newest !== "string" || !Array.isArray(raw.builds)) return null;
  const builds: HerdrBuild[] = [];
  for (const entry of raw.builds) {
    const build = parseBuild(entry);
    if (!build) return null;
    builds.push(build);
  }
  if (!builds.some((b) => b.version === raw.newest)) return null;
  return { schema: 1, newest: raw.newest, builds };
}

function forkOf(version: string): ForkVersion | null {
  const m = version.match(FORK_VERSION);
  return m ? { herdr: m[1]!, revision: Number.parseInt(m[2]!, 10) } : null;
}

export function parseHerdrVersion(stdout: string): { version: string; fork: ForkVersion | null } {
  const line = stdout.trim().split("\n")[0] ?? "";
  const version = line.match(/^herdr\s+(\S+)/)?.[1] ?? line.trim();
  return { version, fork: forkOf(version) };
}

export function compareForkVersions(a: ForkVersion, b: ForkVersion): number {
  const aAtLeastB = atLeast(a.herdr, b.herdr);
  const bAtLeastA = atLeast(b.herdr, a.herdr);
  if (aAtLeastB && !bAtLeastA) return 1;
  if (bAtLeastA && !aAtLeastB) return -1;
  return a.revision - b.revision;
}

export function newestBuild(list: HerdrBuilds): HerdrBuild {
  return list.builds.find((b) => b.version === list.newest)!;
}

export function herdrVerdict(installed: ReturnType<typeof parseHerdrVersion>, list: HerdrBuilds | null, minimum: string = HERDR_MIN_BUILD): HerdrVerdict {
  const { version, fork } = installed;
  const target = list?.newest ?? minimum;
  if (!fork) return { kind: "stock", version, target };
  const floor = forkOf(minimum);
  if (floor && compareForkVersions(fork, floor) < 0) return { kind: "outdated", version, target, belowMinimum: true };
  if (!list) return { kind: "current", version, checked: false };
  const newest = forkOf(list.newest);
  if (newest && compareForkVersions(fork, newest) < 0) return { kind: "outdated", version, target, belowMinimum: false };
  return { kind: "current", version, checked: true };
}

/**
 * Whether a running server must move onto the installed build: a stock
 * server always does, and a fork server does when a listed build after it,
 * up to the installed one, changes the server. Without the list, or for an
 * installed build the list does not name, any other version moves.
 */
export function serverNeedsMove(server: string, installed: string, list: HerdrBuilds | null): boolean {
  if (server === installed) return false;
  const from = forkOf(server);
  const to = forkOf(installed);
  if (!from || !to || !list || !list.builds.some((b) => b.version === installed)) return true;
  return list.builds.some((b) => {
    const fork = forkOf(b.version)!;
    return b.changesServer && compareForkVersions(fork, from) > 0 && compareForkVersions(fork, to) <= 0;
  });
}

export async function fetchHerdrBuilds(p: Pick<Probes, "fetch">): Promise<HerdrBuilds | null> {
  const res = await p.fetch(HERDR_BUILDS_URL, { timeoutMs: FETCH_TIMEOUT_MS }).catch(() => null);
  if (!res || res.status !== 200) return null;
  return parseHerdrBuilds(res.body);
}
