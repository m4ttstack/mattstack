/**
 * Installs the newest m4ttstack/herdr fork build into ~/.local/bin/herdr.
 * The download is checked against the build list's sha256 and its own
 * `--version` before it replaces anything, so a failure leaves the binary
 * that was there. Running servers move onto a build that changes the server
 * through herdr's live handoff; nothing here ever ends a pane.
 */

import { dirname, join } from "path";
import { fetchHerdrBuilds, newestBuild, parseHerdrVersion } from "./herdr-builds.ts";
import type { Probes } from "./probes.ts";
import type { HostArch } from "./requirements.ts";
import { vendorBinPath, type InstallResult } from "./tools-install.ts";

export const HERDR_BACKUP_FILES = ["herdr.pre-mouse-backup"];

const PROBE_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const HANDOFF_TIMEOUT_MS = 5 * 60_000;
const HOMEBREW_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

export interface HerdrSession {
  name: string;
  running: boolean;
  socket: string;
}

function firstLine(s: string): string {
  return s.trim().split("\n")[0] ?? "";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function herdrSessions(p: Probes, herdr: string[]): Promise<HerdrSession[]> {
  const res = await p.exec([...herdr, "session", "list", "--json"], { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
  if (!res || res.code !== 0) return [];
  const parsed = parseJson(res.stdout) as { sessions?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.sessions)) return [];
  const sessions: HerdrSession[] = [];
  for (const s of parsed.sessions as Record<string, unknown>[]) {
    if (typeof s?.name !== "string" || typeof s.socket_path !== "string") continue;
    sessions.push({ name: s.name, running: s.running === true, socket: s.socket_path });
  }
  return sessions;
}

export async function serverVersion(p: Probes, herdr: string[], socket: string): Promise<string | null> {
  const res = await p.exec([...herdr, "status", "server", "--json"], { env: { HERDR_SOCKET_PATH: socket }, timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
  if (!res || res.code !== 0) return null;
  const parsed = parseJson(res.stdout) as { running?: unknown; version?: unknown } | null;
  if (!parsed || parsed.running !== true || typeof parsed.version !== "string") return null;
  return parsed.version;
}

/** A running session whose server version cannot be read is left out: rt has nothing to hand off or restart it against. */
export async function staleHerdrSessions(p: Probes, herdr: string[], version: string): Promise<HerdrSession[]> {
  const stale: HerdrSession[] = [];
  for (const session of await herdrSessions(p, herdr)) {
    if (!session.running) continue;
    const running = await serverVersion(p, herdr, session.socket);
    if (running !== null && running !== version) stale.push(session);
  }
  return stale;
}

export function homebrewHerdr(p: Probes): { herdr: string; brew: string } | null {
  for (const dir of HOMEBREW_BIN_DIRS) {
    const herdr = join(dir, "herdr");
    if (p.readlink(herdr)?.includes("/Cellar/herdr/")) return { herdr, brew: join(dir, "brew") };
  }
  return null;
}

export function removeHerdrBackups(p: Probes): string[] {
  const removed: string[] = [];
  for (const file of HERDR_BACKUP_FILES) {
    const path = join(p.home, ".local", "bin", file);
    if (!p.exists(path)) continue;
    p.removeFile(path);
    removed.push(path);
  }
  return removed;
}

async function handOff(p: Probes, herdr: string, session: HerdrSession, version: string): Promise<boolean> {
  const res = await p.exec([herdr, "server", "live-handoff", "--import-exe", herdr, "--expected-version", version], {
    env: { HERDR_SOCKET_PATH: session.socket },
    timeoutMs: HANDOFF_TIMEOUT_MS,
  });
  return res.code === 0 && `${res.stdout}\n${res.stderr}`.includes("live handoff complete");
}

export async function installHerdrBuild(p: Probes, arch: HostArch): Promise<InstallResult> {
  const fail = (detail: string): InstallResult => ({ via: "download", ok: false, detail });

  const list = await fetchHerdrBuilds(p);
  if (!list) return fail("rt could not read herdr's build list from m4ttstack/herdr");
  const build = newestBuild(list);
  const asset = build.assets[arch];
  if (!asset) return fail(`The newest herdr build has no download for this Mac's processor (${arch})`);

  const work = join(p.env.TMPDIR ?? "/tmp", "rt-herdr-install");
  await p.exec(["rm", "-rf", work], { timeoutMs: PROBE_TIMEOUT_MS });
  p.mkdirp(work);
  const file = join(work, "herdr");
  const fetched = await p.exec(["curl", "-fsSL", asset.url, "-o", file], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
  if (fetched.code === 124) return fail("Downloading herdr did not finish in time");
  if (fetched.code !== 0) return fail(`Downloading herdr failed (exit ${fetched.code}): ${firstLine(fetched.stderr || fetched.stdout)}`);

  const sum = await p.exec(["shasum", "-a", "256", file], { timeoutMs: PROBE_TIMEOUT_MS });
  if (sum.code !== 0 || sum.stdout.trim().split(/\s+/)[0] !== asset.sha256) {
    return fail("The herdr download did not match the build list's sha256, so nothing was installed");
  }

  const dest = vendorBinPath(p.home, "herdr");
  const staged = join(dirname(dest), `.herdr-${build.version}.new`);
  p.mkdirp(dirname(dest));
  const placed = await p.exec(["install", "-m", "0755", file, staged], { timeoutMs: PROBE_TIMEOUT_MS });
  if (placed.code !== 0) {
    if (p.exists(staged)) p.removeFile(staged);
    return fail(`Copying herdr into ~/.local/bin failed: ${firstLine(placed.stderr || placed.stdout)}`);
  }
  const reported = await p.exec([staged, "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
  const version = reported.code === 0 ? parseHerdrVersion(reported.stdout).version : null;
  if (version !== build.version) {
    p.removeFile(staged);
    return fail(`The herdr download reports ${version ? `version ${version}` : "no version"}, not ${build.version}, so nothing was installed`);
  }
  try {
    p.rename(staged, dest);
  } catch (e) {
    p.removeFile(staged);
    return fail(`Replacing ~/.local/bin/herdr failed: ${(e as Error).message}`);
  }

  removeHerdrBackups(p);

  const notes: string[] = [];
  const brew = homebrewHerdr(p);
  if (brew) {
    const res = await p.exec([brew.brew, "uninstall", "herdr"], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    notes.push(res.code === 0 ? "removed Homebrew's herdr" : `Homebrew's herdr is still installed (brew uninstall exit ${res.code})`);
  }

  if (build.changesServer) {
    let moved = 0;
    let refused = 0;
    for (const session of await staleHerdrSessions(p, [dest], build.version)) {
      if (await handOff(p, dest, session, build.version)) moved++;
      else refused++;
    }
    if (moved > 0) notes.push(`moved ${moved} running herdr ${moved === 1 ? "server" : "servers"} onto it`);
    if (refused > 0) notes.push("restart herdr when your agents are done");
  }

  return { via: "download", ok: true, detail: [`Installed herdr ${build.version}`, ...notes].join("; ") };
}

export async function restartStaleHerdrServers(p: Probes): Promise<{ stopped: string[]; failed: string[] }> {
  const herdr = vendorBinPath(p.home, "herdr");
  const reported = await p.exec([herdr, "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
  if (reported.code !== 0) return { stopped: [], failed: [] };
  const { version } = parseHerdrVersion(reported.stdout);
  const stopped: string[] = [];
  const failed: string[] = [];
  for (const session of await staleHerdrSessions(p, [herdr], version)) {
    const res = await p.exec([herdr, "server", "stop"], { env: { HERDR_SOCKET_PATH: session.socket }, timeoutMs: PROBE_TIMEOUT_MS });
    (res.code === 0 ? stopped : failed).push(session.name);
  }
  return { stopped, failed };
}
