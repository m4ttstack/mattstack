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
  orgs: { org: string; layout: number | null }[];
  packs: { id: string; version: string | null }[];
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
export async function collectPing(p: Probes): Promise<TelemetryPing> {
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
    slugs.map((slug) => {
      const marker = markerState(p, orgDirUnder(p.home, slug));
      return { org: slug, layout: marker.kind === "org" ? marker.layout : null };
    }),
  );

  const packs = await field("packs", [] as TelemetryPing["packs"], () => {
    const ids = new Set(slugs.flatMap((slug) => readServedPacks(p, slug).packs.map((pack) => pack.id)));
    return [...ids].sort().map((id) => ({ id, version: installedVersion(id) }));
  });

  return {
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
  };
}
