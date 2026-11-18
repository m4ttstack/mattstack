/**
 * The version ping: what this Mac reports about the rt it runs, and nothing
 * else. Every field is read on its own, so one reader that throws leaves that
 * field null or empty and never drops the ping.
 */

import { basename, join } from "path";
import { resolveClaudeBin } from "../claude-bin.ts";
import { getDaemonLogger } from "../daemon-logger.ts";
import { appBundlePath } from "../deps/resolve.ts";
import { processFlavor, type Flavor } from "../flavor.ts";
import { legacyDirsPresent, orgDirUnder } from "../rt-paths.ts";
import { MIGRATION_IDS } from "../setup/migrations/ids.ts";
import { readServedPacks } from "../setup/pack-cache.ts";
import type { Probes } from "../setup/probes.ts";
import { readSetupState } from "../setup/state.ts";
import { discoverOrgs } from "../setup/team-settings.ts";
import { rtVersion } from "../setup/update.ts";
import { ENGINE_PACK_REF } from "../skills/installed-plugins.ts";
import { installedVersionFor, type PluginListEntry } from "../skills/sources.ts";
import { markerState } from "../team/org-marker.ts";
import { readTeamLocal } from "../team/team-local.ts";
import type { CloneHealth, StaleSkill } from "./clone-health.ts";
import { readInstallId } from "./install-id.ts";

export interface TelemetryPing {
  installId: string;
  usernames: string[];
  appVersion: string | null;
  rtVersion: string;
  pluginVersion: string | null;
  flavor: Flavor;
  macosVersion: string | null;
  migrationsRecorded: string[];
  migrationsKnown: string[];
  legacyDirs: string[];
  /** `clone` only from the daemon's ping, null when it could not be read. */
  orgs: { org: string; layout: number | null; clone?: CloneHealth | null }[];
  /** `stale` only from the daemon's ping: the skills this Mac reads as waiting for compile. */
  packs: { id: string; version: string | null; stale?: StaleSkill[] | null }[];
  appUpdate: AppUpdateStatus | null;
}

/** What the daemon adds to a ping so a clone in a bad state can be diagnosed from the relay. */
export interface PingHealthDeps {
  cloneHealth(slug: string): Promise<CloneHealth | null>;
  staleSkills(packName: string): Promise<StaleSkill[] | null>;
}

/** What the app's updater last did, as the tray writes it (`UpdateStatus.swift`). */
export interface AppUpdateStatus {
  lastCheckAt: string | null;
  offeredVersion: string | null;
  heldVersion: string | null;
  hold: string | null;
}

export interface PingVersions {
  appVersion: string | null;
  rtVersion: string;
}

const EXEC_TIMEOUT_MS = 10_000;

async function field<T>(name: string, fallback: T, read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    try {
      (await getDaemonLogger()).childLogger("telemetry").debug({ err, field: name }, "telemetry field unreadable");
    } catch {
      // A logger that cannot start must not turn a swallowed failure into a visible one.
    }
    return fallback;
  }
}

async function execText(p: Probes, argv: string[]): Promise<string | null> {
  const res = await p.exec(argv, { timeoutMs: EXEC_TIMEOUT_MS });
  const text = res.stdout.trim();
  return res.code === 0 && text !== "" ? text : null;
}

async function readAppVersion(p: Probes): Promise<string | null> {
  const root = appBundlePath(p);
  if (!root) return null;
  return execText(p, ["/usr/libexec/PlistBuddy", "-c", "Print CFBundleShortVersionString", join(root, "Contents", "Info.plist")]);
}

/** An app older than the status file, or the dev flavor, which never checks, writes none. */
export function readAppUpdate(p: Probes): AppUpdateStatus | null {
  const text = p.readFile(join(p.home, ".mattstack", "rt", "app-update.json"));
  if (text === null) return null;
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const pick = (key: keyof AppUpdateStatus): string | null => {
    const value = record[key];
    return typeof value === "string" && value.length <= 128 ? value : null;
  };
  return { lastCheckAt: pick("lastCheckAt"), offeredVersion: pick("offeredVersion"), heldVersion: pick("heldVersion"), hold: pick("hold") };
}

/** `kern.hv_vmm_present` is 1 under a hypervisor; an unreadable answer counts as a real Mac. */
export async function runningInVirtualMachine(p: Probes): Promise<boolean> {
  return (await execText(p, ["sysctl", "-n", "kern.hv_vmm_present"])) === "1";
}

export async function readPingVersions(p: Probes): Promise<PingVersions> {
  return { appVersion: await field("appVersion", null, () => readAppVersion(p)), rtVersion: rtVersion() };
}

/** Async, unlike `listInstalledPlugins`: the daemon calls this, and a synchronous spawn would stall its socket for the length of `claude plugin list`. */
async function listPlugins(p: Probes): Promise<PluginListEntry[]> {
  const res = await p.exec([resolveClaudeBin() ?? "claude", "plugin", "list", "--json"], { timeoutMs: EXEC_TIMEOUT_MS });
  if (res.code !== 0) throw new Error(`claude plugin list exited ${res.code}`);
  const parsed: unknown = JSON.parse(res.stdout);
  if (!Array.isArray(parsed)) throw new Error("claude plugin list did not print an array");
  return parsed as PluginListEntry[];
}

/** Throws only when the install id cannot be kept; every other field degrades to null or empty. */
export async function collectPing(p: Probes, health?: PingHealthDeps): Promise<TelemetryPing> {
  const flavor = processFlavor();
  const installId = readInstallId(p, flavor);

  const slugs = await field("orgSlugs", [] as string[], () => discoverOrgs(p));
  const plugins = await field<PluginListEntry[] | null>("plugins", null, () => listPlugins(p));
  const installedVersion = (id: string): string | null => (plugins ? installedVersionFor(plugins, id) : null);

  const usernames = await field("usernames", [] as string[], () => {
    const names = slugs.map((slug) => readTeamLocal(p, slug).forgeUsername).filter((name): name is string => name !== undefined);
    return [...new Set(names)].sort();
  });

  const orgs = await field("orgs", [] as TelemetryPing["orgs"], () =>
    Promise.all(
      slugs.map(async (slug) => {
        const marker = markerState(p, orgDirUnder(p.home, slug));
        const entry = { org: slug, layout: marker.kind === "org" ? marker.layout : null };
        return health ? { ...entry, clone: await field("clone", null, () => health.cloneHealth(slug)) } : entry;
      }),
    ),
  );

  const packs = await field("packs", [] as TelemetryPing["packs"], async () => {
    const served = await Promise.all(slugs.map((slug) => readServedPacks(p, slug)));
    const byId = new Map(served.flatMap((s) => s.packs.map((pack) => [pack.id, pack.name] as const)));
    return Promise.all(
      [...byId.keys()].sort().map(async (id) => {
        const entry = { id, version: installedVersion(id) };
        return health ? { ...entry, stale: await field("stale", null, () => health.staleSkills(byId.get(id)!)) } : entry;
      }),
    );
  });

  return fitPing({
    installId,
    usernames,
    appVersion: await field("appVersion", null, () => readAppVersion(p)),
    rtVersion: rtVersion(),
    pluginVersion: await field("pluginVersion", null, () => installedVersion(ENGINE_PACK_REF)),
    flavor,
    macosVersion: await field("macosVersion", null, () => execText(p, ["sw_vers", "-productVersion"])),
    migrationsRecorded: await field("migrationsRecorded", [] as string[], () => readSetupState(p).migrations),
    migrationsKnown: [...MIGRATION_IDS],
    legacyDirs: await field("legacyDirs", [] as string[], () => {
      const { real, symlinks } = legacyDirsPresent();
      return [...real, ...symlinks].map((path) => basename(path)).sort();
    }),
    orgs,
    packs,
    appUpdate: await field("appUpdate", null, () => readAppUpdate(p)),
  });
}

/** Under the relay's 64 KB body cap, with room for headers. */
const PING_BUDGET_BYTES = 60_000;

const bytesOf = (ping: TelemetryPing): number => Buffer.byteLength(JSON.stringify(ping));

/**
 * The relay drops a whole ping over its cap, so the optional detail gives way
 * first: dirty paths shrink to 10 per clone, then to none, then the stale
 * lists go. Counts (`dirtyCount`) always stay true.
 */
export function fitPing(ping: TelemetryPing, budget: number = PING_BUDGET_BYTES): TelemetryPing {
  if (bytesOf(ping) <= budget) return ping;
  const withDirty = (keep: number): TelemetryPing => ({
    ...ping,
    orgs: ping.orgs.map((o) => (o.clone ? { ...o, clone: { ...o.clone, dirty: o.clone.dirty.slice(0, keep) } } : o)),
  });
  for (const keep of [10, 0]) {
    const trimmed = withDirty(keep);
    if (bytesOf(trimmed) <= budget) return trimmed;
  }
  const bare = withDirty(0);
  return { ...bare, packs: bare.packs.map((p) => (p.stale ? { ...p, stale: null } : p)) };
}
