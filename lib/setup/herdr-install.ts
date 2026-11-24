/**
 * Installs the newest m4ttstack/herdr fork build into ~/.local/bin/herdr.
 * The download is checked against the build list's sha256 and its own
 * `--version` before it replaces anything, so a failure leaves the binary
 * that was there. Running servers move onto a build that changes the server
 * when `serverNeedsMove` says so, through herdr's live handoff; nothing
 * here ever ends a pane.
 */

import { dirname, join } from "path";
import { resolveTool } from "../deps/resolve.ts";
import { shellQuote } from "../herdr-launch.ts";
import { fetchHerdrBuilds, herdrVerdict, newestBuild, parseHerdrVersion, serverNeedsMove, type HerdrBuildAsset, type HerdrBuilds } from "./herdr-builds.ts";
import { vendorBinPath, type InstallResult } from "./install-result.ts";
import type { Probes } from "./probes.ts";
import type { HostArch } from "./requirements.ts";

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

/** Running sessions whose server must move onto `version` (`serverNeedsMove`). One whose server version cannot be read is left out: rt has nothing to hand off or restart it against. */
export async function staleHerdrSessions(p: Probes, herdr: string[], version: string, list: HerdrBuilds | null): Promise<HerdrSession[]> {
  const running = (await herdrSessions(p, herdr)).filter((s) => s.running);
  const versions = await Promise.all(running.map((s) => serverVersion(p, herdr, s.socket)));
  return running.filter((_, i) => versions[i] !== null && serverNeedsMove(versions[i]!, version, list));
}

export interface HomebrewHerdr {
  herdr: string;
  brew: string;
}

export function homebrewHerdrs(p: Probes): HomebrewHerdr[] {
  return HOMEBREW_BIN_DIRS.map((dir) => ({ herdr: join(dir, "herdr"), brew: join(dir, "brew") })).filter((b) => p.readlink(b.herdr)?.includes("/Cellar/herdr/"));
}

export function homebrewUninstallCommands(brews: readonly HomebrewHerdr[]): string[] {
  return brews.map((b) => `${shellQuote(b.brew)} uninstall herdr`);
}

/** Uninstalls Homebrew's herdr from each prefix; a note for the result's detail, and whether every one went. */
async function uninstallHomebrewHerdr(p: Probes, brews: readonly HomebrewHerdr[]): Promise<{ ok: boolean; note: string; remedy?: string }> {
  const left: { brew: HomebrewHerdr; code: number }[] = [];
  for (const brew of brews) {
    const res = await p.exec([brew.brew, "uninstall", "herdr"], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    if (res.code !== 0) left.push({ brew, code: res.code });
  }
  if (left.length === 0) return { ok: true, note: "removed Homebrew's herdr" };
  const commands = homebrewUninstallCommands(left.map((l) => l.brew)).join(" && ");
  return { ok: false, note: `Homebrew's herdr is still installed (brew uninstall exit ${left[0]!.code}). Remove it in a terminal: ${commands}`, remedy: `Run ${commands} in a terminal` };
}

/** Whether the herdr setup runs is already a current fork build, so only Homebrew's copy is left to remove. */
async function runsCurrentBuild(p: Probes, list: HerdrBuilds | null): Promise<boolean> {
  const herdr = resolveTool(p, "herdr").exec;
  if (!herdr) return false;
  const res = await p.exec([...herdr, "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
  return res.code === 0 && herdrVerdict(parseHerdrVersion(res.stdout), list).kind === "current";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

/** Downloads, verifies and swaps the build into ~/.local/bin/herdr; a failure's copy, or null once the binary is in place. */
async function placeBuild(p: Probes, work: string, asset: HerdrBuildAsset, version: string): Promise<string | null> {
  await p.exec(["rm", "-rf", work], { timeoutMs: PROBE_TIMEOUT_MS });
  p.mkdirp(work);
  const file = join(work, "herdr");
  const fetched = await p.exec(["curl", "-fsSL", asset.url, "-o", file], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
  if (fetched.code === 124) return "Downloading herdr did not finish in time";
  if (fetched.code !== 0) return `Downloading herdr failed (exit ${fetched.code}): ${firstLine(fetched.stderr || fetched.stdout)}`;

  const sum = await p.exec(["shasum", "-a", "256", file], { timeoutMs: PROBE_TIMEOUT_MS });
  if (sum.code !== 0 || sum.stdout.trim().split(/\s+/)[0] !== asset.sha256) return "The herdr download did not match the build list's sha256, so nothing was installed";

  const dest = vendorBinPath(p.home, "herdr");
  const staged = join(dirname(dest), `.herdr-${version}.new`);
  p.mkdirp(dirname(dest));
  const placed = await p.exec(["install", "-m", "0755", file, staged], { timeoutMs: PROBE_TIMEOUT_MS });
  if (placed.code !== 0) {
    p.removeFile(staged);
    return `Copying herdr into ~/.local/bin failed: ${firstLine(placed.stderr || placed.stdout)}`;
  }
  // The fork's builds are signed but not notarized, so Gatekeeper blocks a quarantined copy. A copy with no quarantine makes xattr exit non-zero, and any other failure shows up in the --version check below.
  await p.exec(["/usr/bin/xattr", "-d", "com.apple.quarantine", staged], { timeoutMs: PROBE_TIMEOUT_MS });
  const reported = await p.exec([staged, "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
  const got = reported.code === 0 ? parseHerdrVersion(reported.stdout).version : null;
  if (got !== version) {
    p.removeFile(staged);
    return `The herdr download reports ${got ? `version ${got}` : "no version"}, not ${version}, so nothing was installed`;
  }
  try {
    p.rename(staged, dest);
  } catch (e) {
    p.removeFile(staged);
    return `Replacing ~/.local/bin/herdr failed: ${(e as Error).message}`;
  }
  return null;
}

export async function installHerdrBuild(p: Probes, arch: HostArch): Promise<InstallResult> {
  const fail = (detail: string): InstallResult => ({ via: "download", ok: false, detail });

  const list = await fetchHerdrBuilds(p);
  const brews = homebrewHerdrs(p);
  if (brews.length > 0 && (await runsCurrentBuild(p, list))) {
    const removed = await uninstallHomebrewHerdr(p, brews);
    return { via: "download", ok: removed.ok, detail: capitalize(removed.note), ...(removed.remedy ? { remedy: removed.remedy } : {}) };
  }
  if (!list) return fail("rt could not read herdr's build list from m4ttstack/herdr");
  const build = newestBuild(list);
  const asset = build.assets[arch];
  if (!asset) return fail(`The newest herdr build has no download for this Mac's processor (${arch})`);

  const work = join(p.env.TMPDIR || "/tmp", "rt-herdr-install");
  try {
    const placed = await placeBuild(p, work, asset, build.version);
    if (placed) return fail(placed);
  } finally {
    p.removeDir(work);
  }
  const dest = vendorBinPath(p.home, "herdr");

  removeHerdrBackups(p);

  const notes: string[] = [];
  const removed = brews.length > 0 ? await uninstallHomebrewHerdr(p, brews) : null;

  let moved = 0;
  let refused = 0;
  for (const session of await staleHerdrSessions(p, [dest], build.version, list)) {
    if (await handOff(p, dest, session, build.version)) moved++;
    else refused++;
  }
  if (moved > 0) notes.push(`moved ${moved} running herdr ${moved === 1 ? "server" : "servers"} onto it`);
  if (refused > 0) notes.push("restart herdr when your agents are done");
  if (removed) notes.push(removed.note);

  return { via: "download", ok: removed?.ok ?? true, detail: [`Installed herdr ${build.version}`, ...notes].join("; "), ...(removed?.remedy ? { remedy: removed.remedy } : {}) };
}

/** `error` is set when ~/.local/bin/herdr itself does not run, so nothing was checked or stopped. */
export async function restartStaleHerdrServers(p: Probes): Promise<{ stopped: string[]; failed: string[]; error?: string }> {
  const herdr = vendorBinPath(p.home, "herdr");
  const reported = await p.exec([herdr, "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
  if (reported.code !== 0) return { stopped: [], failed: [], error: `~/.local/bin/herdr does not run (exit ${reported.code}), so rt restarted nothing` };
  const { version } = parseHerdrVersion(reported.stdout);
  const stale = await staleHerdrSessions(p, [herdr], version, await fetchHerdrBuilds(p));
  const results = await Promise.all(stale.map((s) => p.exec([herdr, "server", "stop"], { env: { HERDR_SOCKET_PATH: s.socket }, timeoutMs: PROBE_TIMEOUT_MS })));
  return {
    stopped: stale.filter((_, i) => results[i]!.code === 0).map((s) => s.name),
    failed: stale.filter((_, i) => results[i]!.code !== 0).map((s) => s.name),
  };
}
