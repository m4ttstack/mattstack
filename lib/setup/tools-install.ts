/**
 * `rt tools install|setup` — what the plan's `{type:"install", tool, via}`
 * rows spawn when a user clicks Install, and what a "run this setup verb"
 * row spawns for a tool that owns its own post-install wiring (herdr's
 * Claude integration, fast-browser's runtime, the editor extension).
 *
 * Every exec here is bounded and re-probed: an installer's exit code alone
 * is never trusted as proof the tool now works (an installer can exit 0 on a
 * broken shim), and apple-clt's `xcode-select --install` triggers an
 * asynchronous OS dialog that can never be waited on — this never reports
 * more than "the dialog was triggered."
 */

import { dirname, join } from "path";
import { link, type LinkOutcome } from "../deps/links.ts";
import { appBundlePath, bundledToolExec, resolveTool } from "../deps/resolve.ts";
import { detectEditors, type DetectedEditor } from "../editors.ts";
import { UserActionableError } from "../errors.ts";
import { GIT_FLOOR, gitBelowFloor } from "./git-floor.ts";
import type { Probes } from "./probes.ts";
import type { HostArch, PackRequirements, ToolDownloadPin } from "./requirements.ts";
import { updateSetupState } from "./state.ts";

/**
 * URLs only — never a shell command. R-T21-a: nothing in this file ever
 * splices a URL into an `sh -c` string; `runVendorInstaller` fetches the URL
 * to a fixed local path via argv-only `curl`, then runs that local path as
 * its own argv step. R-T21-b: this table is rt's OWN short, hardcoded list —
 * a team-declared `install.url` from a pack's requirements.jsonc is never
 * looked up here and never auto-executed (see the `manual-install-required`
 * refusal in installTool).
 *
 * These run even on a Mac with Homebrew: brew's claude-code and herdr put
 * the binary somewhere setup's later rows did not find it. Both scripts
 * install into ~/.local/bin, which is where the install is verified.
 * `shell` is the one each vendor's own docs pipe the script to.
 */
export const VENDOR_INSTALLERS: Record<string, { url: string; shell: "sh" | "bash" }> = {
  herdr: { url: "https://herdr.dev/install.sh", shell: "sh" },
  claude: { url: "https://claude.ai/install.sh", shell: "bash" },
};

/** The only hosts a hardcoded VENDOR_INSTALLERS entry may point at — closes the door on a future entry (or a typo) silently widening what rt will fetch-and-run. */
const VENDOR_ALLOWED_HOSTS = new Set(["herdr.dev", "claude.ai", "bun.sh"]);

/** Where a vendor script installs `tool`. The board runs Claude Code from this exact path, since launchd's PATH has no claude on it. */
export function vendorBinPath(home: string, tool: string): string {
  return join(home, ".local", "bin", tool);
}

/** A team-declared `--version`/probe must never hang `rt tools install` forever. */
const PROBE_TIMEOUT_MS = 5000;
/** Downloads and vendor installs are slow and network-bound; bounded, never run in tests. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const EXTENSION_INSTALL_TIMEOUT_MS = 30_000;

// ─── injectable seams ──────────────────────────────────────────────────────

export interface ToolsInstallSeams {
  resolveTool: typeof resolveTool;
  bundledToolExec: typeof bundledToolExec;
  link: typeof link;
  detectEditors: typeof detectEditors;
  findVsixes: (p: Pick<Probes, "exists" | "home">) => string[];
  /** The processor whose pinned download installTool takes; the running binary's by default. */
  hostArch?: () => HostArch;
}

/** process.arch names the slice of the universal rt binary that is running. */
export function hostArch(): HostArch {
  return process.arch === "x64" ? "x86_64" : "arm64";
}

/** The editor extensions the app bundle carries, in install order. */
export const BUNDLED_VSIX_FILES = ["rt-context.vsix", "skill-blocks.vsix"] as const;

/** Each bundled file that exists: `<appPath>/Contents/Resources/<file>` first (the bundle rt runs from), else next to the running binary. */
export function findBundledVsixes(p: Pick<Probes, "exists" | "home">, besideBinaryDir: string = dirname(process.execPath)): string[] {
  const appPath = appBundlePath(p);
  const found: string[] = [];
  for (const file of BUNDLED_VSIX_FILES) {
    const bundled = appPath ? join(appPath, "Contents", "Resources", file) : null;
    if (bundled && p.exists(bundled)) found.push(bundled);
    else if (p.exists(join(besideBinaryDir, file))) found.push(join(besideBinaryDir, file));
  }
  return found;
}

const REAL_SEAMS: ToolsInstallSeams = { resolveTool, bundledToolExec, link, detectEditors, findVsixes: (p) => findBundledVsixes(p) };

// ─── installTool ───────────────────────────────────────────────────────────

export type InstallVia = "download" | "vendor" | "apple-clt" | "bundled-link";
export interface InstallResult {
  via: InstallVia;
  ok: boolean;
  detail: string;
  /** Internal bundled-link classification, excluded from the JSON envelope. */
  reason?: Extract<LinkOutcome, { ok: false }>["reason"];
}

function firstLine(s: string): string {
  return s.trim().split("\n")[0] ?? "";
}

/** softwareupdate only lists Command Line Tools while this marker exists — the same trigger Homebrew and MDM tooling use. Best-effort removed afterwards; a stale marker only costs an extra listing. */
const CLT_ON_DEMAND_MARKER = "/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress";
const CLT_LIST_TIMEOUT_MS = 120_000;
export const CLT_INSTALL_TIMEOUT_MS = 45 * 60_000;

/**
 * The newest CLT label wins — softwareupdate lists one label per available
 * version, oldest first. Verified against a real macOS 26 catalog: the
 * modern form is "Command Line Tools for Xcode 26.6-26.6" (space before
 * the version, then a -version suffix); older macOS used
 * "Command Line Tools for Xcode-14.3". Match both.
 */
export function parseCltLabel(listOutput: string): string | null {
  const labels = [...listOutput.matchAll(/^\s*\*?\s*Label:\s*(Command Line Tools for Xcode[ -][\d.]+(?:-[\d.]+)?)\s*$/gm)].map((m) => m[1]!);
  if (labels.length === 0) return null;
  // Catalog order is not version order (observed 26.6 before 26.5 on a real
  // guest) — sort by the numeric version in the label and take the newest.
  const version = (label: string) => label.match(/([\d.]+)$/)?.[1] ?? "0";
  return labels.sort((a, b) => version(a).localeCompare(version(b), undefined, { numeric: true })).at(-1)!;
}

/**
 * The slick path: install CLT entirely headlessly via softwareupdate — no
 * Apple dialog, no Safari, no "now wait and re-run". Falls back to
 * triggering the classic `xcode-select --install` dialog when the catalog
 * has no CLT label or the install fails (e.g. softwareupdate refuses
 * without root); either way the caller polls `git --version` back to green.
 */
async function installAppleClt(p: Probes): Promise<InstallResult> {
  const already = await p.exec(["xcode-select", "-p"], { timeoutMs: PROBE_TIMEOUT_MS });
  let outdated = false;
  if (already.code === 0) {
    const git = await p.exec(["git", "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
    outdated = git.code === 0 && gitBelowFloor(git.stdout);
    if (git.code === 0 && !outdated) return { via: "apple-clt", ok: true, detail: "Command Line Tools already installed" };
  }

  // touch is best-effort: a marker left root-owned by an earlier trigger
  // still does its job, and the failed touch must not abort the flow.
  await p.exec(["touch", CLT_ON_DEMAND_MARKER], { timeoutMs: PROBE_TIMEOUT_MS });
  try {
    // A freshly-poked catalog can need one scan cycle before it exposes the
    // CLT labels (observed on a real macOS 26 guest: first -l empty, second
    // listed them) — retry briefly rather than concluding "no label".
    let label: string | null = null;
    for (let attempt = 0; attempt < 3 && !label; attempt++) {
      if (attempt > 0) await p.exec(["sleep", "10"], { timeoutMs: 15_000 });
      const list = await p.exec(["softwareupdate", "-l"], { timeoutMs: CLT_LIST_TIMEOUT_MS });
      label = list.code === 0 ? parseCltLabel(list.stdout) : null;
    }
    if (label) {
      const install = await p.exec(["softwareupdate", "-i", label], { timeoutMs: CLT_INSTALL_TIMEOUT_MS });
      const git = await p.exec(["git", "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
      if (install.code === 0 && git.code === 0 && !gitBelowFloor(git.stdout)) {
        return { via: "apple-clt", ok: true, detail: `Installed ${label}; ${git.stdout.trim()}` };
      }
    }
  } finally {
    await p.exec(["rm", "-f", CLT_ON_DEMAND_MARKER], { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => {});
  }

  // Apple's dialog refuses while any Command Line Tools are installed, so old ones have to go first, which needs an admin.
  if (outdated) {
    return {
      via: "apple-clt",
      ok: false,
      detail: `Your Command Line Tools have git older than ${GIT_FLOOR} and no update is offered. In Terminal, run: sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install`,
    };
  }

  const res = await p.exec(["xcode-select", "--install"], { timeoutMs: PROBE_TIMEOUT_MS });
  if (res.code === 124) return { via: "apple-clt", ok: false, detail: "The Command Line Tools installer did not answer in time" };
  if (res.code === 0) {
    // ok means "verified installed" (the headless path proves it with a git
    // re-probe); a triggered dialog is progress, not completion.
    return { via: "apple-clt", ok: false, detail: "Opened Apple's Command Line Tools installer. Finish it, then run rt setup status again" };
  }
  const combined = `${res.stdout} ${res.stderr}`.toLowerCase();
  if (res.code === 1 && combined.includes("already installed")) {
    return { via: "apple-clt", ok: true, detail: "Command Line Tools already installed" };
  }
  return { via: "apple-clt", ok: false, detail: `The Command Line Tools installer failed (exit ${res.code}): ${firstLine(res.stderr || res.stdout)}` };
}

function linkOutcomeDetail(outcome: LinkOutcome): string {
  return outcome.ok ? (outcome.state === "already" ? `already linked at ${outcome.path}` : `linked at ${outcome.path}`) : outcome.detail;
}

/** The branch `installTool` would take for `tool`, without installing; null where it would refuse (a team's download URL, a tap formula, or no method at all). */
export async function installRoute(p: Probes, tool: string, reqs: PackRequirements[], seams: ToolsInstallSeams = REAL_SEAMS): Promise<"bundled" | "download" | "vendor" | null> {
  if (seams.bundledToolExec(p, tool)) return "bundled";
  if (VENDOR_INSTALLERS[tool]) return "vendor";
  if (teamPin(reqs, tool, (seams.hostArch ?? hostArch)())) return "download";
  return null;
}

/** The team's pinned download for this processor, if the pack declares one. */
export function teamPin(reqs: PackRequirements[], tool: string, arch: HostArch): ToolDownloadPin | undefined {
  return reqs.flatMap((r) => r.tools).find((t) => t.name === tool)?.install?.download?.[arch];
}

export async function installTool(p: Probes, tool: string, reqs: PackRequirements[], seams: ToolsInstallSeams = REAL_SEAMS): Promise<InstallResult> {
  if (tool === "apple-clt") return installAppleClt(p);

  const bundled = seams.bundledToolExec(p, tool);
  if (bundled) {
    const outcome = seams.link(p, tool);
    return { via: "bundled-link", ok: outcome.ok, detail: linkOutcomeDetail(outcome), ...(outcome.ok ? {} : { reason: outcome.reason }) };
  }

  const teamTool = reqs.flatMap((r) => r.tools).find((t) => t.name === tool);

  const vendor = VENDOR_INSTALLERS[tool];
  if (vendor) return runVendorInstaller(p, tool, vendor.url, { shell: vendor.shell, verify: [vendorBinPath(p.home, tool), "--version"] });

  const arch = (seams.hostArch ?? hostArch)();
  const pin = teamPin(reqs, tool, arch);
  if (pin) return installPinnedDownload(p, tool, pin);

  // R-T21-b: a team pack's install.url is free-form text authored by
  // whoever wrote that team's requirements.jsonc — the same trust boundary
  // as the invite-pointer RCE earlier in this lane. rt shows it (this is
  // exactly what teamToolRemedyAction's open-url row already does); it never
  // auto-executes it. installTool must match that row, not exceed it.
  if (teamTool?.install?.url) {
    throw new UserActionableError(
      "manual-install-required",
      `${tool}'s team pack gives an install URL, and rt never runs a team's install script for you. Install it yourself: ${teamTool.install.url}`,
    );
  }

  if (teamTool?.install?.download) {
    throw new UserActionableError("no-installer", `${tool}'s team pack pins no download for this Mac's processor (${arch})`);
  }
  throw new UserActionableError("no-installer", `no install method known for ${tool}`);
}

const ARCHIVE_KINDS: [suffix: string, kind: "tar" | "zip"][] = [[".tar.gz", "tar"], [".tgz", "tar"], [".tar.xz", "tar"], [".tar", "tar"], [".zip", "zip"]];

function archiveKind(url: string): "tar" | "zip" | "raw" {
  const path = new URL(url).pathname.toLowerCase();
  return ARCHIVE_KINDS.find(([suffix]) => path.endsWith(suffix))?.[1] ?? "raw";
}

/**
 * The pin's url and sha256 come from the team's pack, so nothing here runs
 * before the sha256 check passes, and the install path is rt's own: the
 * pack's tool name, already checked as a bare command by the reader.
 */
async function installPinnedDownload(p: Probes, tool: string, pin: ToolDownloadPin): Promise<InstallResult> {
  const fail = (detail: string): InstallResult => ({ via: "download", ok: false, detail });
  const work = join(p.env.TMPDIR ?? "/tmp", "rt-team-install", tool);
  await p.exec(["rm", "-rf", work], { timeoutMs: PROBE_TIMEOUT_MS });
  p.mkdirp(work);
  const file = join(work, "download");

  const fetched = await p.exec(["curl", "-fsSL", pin.url, "-o", file], { timeoutMs: INSTALL_TIMEOUT_MS });
  if (fetched.code === 124) return fail(`Downloading ${tool} did not finish in time`);
  if (fetched.code !== 0) return fail(`Downloading ${tool} failed (exit ${fetched.code}): ${firstLine(fetched.stderr || fetched.stdout)}`);

  const sum = await p.exec(["shasum", "-a", "256", file], { timeoutMs: PROBE_TIMEOUT_MS });
  const got = sum.stdout.trim().split(/\s+/)[0] ?? "";
  if (sum.code !== 0 || got !== pin.sha256) return fail(`The ${tool} download did not match the team's pinned sha256, so nothing was installed`);

  let source = file;
  const kind = archiveKind(pin.url);
  if (kind !== "raw") {
    const unpacked = join(work, "unpacked");
    p.mkdirp(unpacked);
    const argv = kind === "zip" ? ["ditto", "-x", "-k", file, unpacked] : ["tar", "-xf", file, "-C", unpacked];
    const res = await p.exec(argv, { timeoutMs: INSTALL_TIMEOUT_MS });
    if (res.code !== 0) return fail(`Unpacking the ${tool} download failed: ${firstLine(res.stderr || res.stdout)}`);
    source = pin.extract ? join(unpacked, pin.extract) : unpacked;
  }

  const dest = join(p.home, ".local", "bin", tool);
  p.mkdirp(dirname(dest));
  const placed = await p.exec(["install", "-m", "0755", source, dest], { timeoutMs: PROBE_TIMEOUT_MS });
  if (placed.code !== 0) return fail(`Installing ${tool} into ~/.local/bin failed: ${firstLine(placed.stderr || placed.stdout)}`);

  const verify = await p.exec([dest, "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
  if (verify.code !== 0) return fail(`${tool} was installed, but it still does not run (exit ${verify.code})`);
  return { via: "download", ok: true, detail: "installed from the team's pinned download" };
}

export const BUN_INSTALLER_URL = "https://bun.sh/install";
export const GO_DOWNLOAD_PAGE = "https://go.dev/dl/";
const GO_RELEASES_URL = "https://go.dev/dl/?mode=json&include=all";

interface GoRelease {
  version: string;
  stable: boolean;
  files: { filename: string; os: string; arch: string; kind: string; sha256: string }[];
}

/**
 * The dev toolchain `rt dev setup` needs, installed for real rather than
 * linked from the app bundle: a dev checkout must keep working when the app
 * that shipped a binary is retired or updated. The version and arguments are
 * rt's own, never caller text.
 */
export async function installDevTool(p: Probes, tool: "bun" | "go", version: string, seams: Pick<ToolsInstallSeams, "hostArch"> = {}): Promise<InstallResult> {
  if (tool === "bun") {
    return runVendorInstaller(p, "bun", BUN_INSTALLER_URL, { shell: "bash", args: [`bun-v${version}`], verify: [join(p.home, ".bun", "bin", "bun"), "--version"] });
  }
  return installGo(p, version, (seams.hostArch ?? hostArch)());
}

function noGoRelease(why: string): UserActionableError {
  return new UserActionableError("dev-tool-no-release", "rt could not find the Go release to install", {}, { why, next: `open ${GO_DOWNLOAD_PAGE}` });
}

/** A "1.26" pin takes the newest stable 1.26.x; a "1.26.5" pin takes exactly that release. */
function pickGoArchive(releases: GoRelease[], pin: string, arch: HostArch): { version: string; filename: string; sha256: string } | null {
  const goArch = arch === "x86_64" ? "amd64" : "arm64";
  const matches = releases.filter((r) => r.stable && (r.version === `go${pin}` || r.version.startsWith(`go${pin}.`)));
  matches.sort((a, b) => b.version.slice(2).localeCompare(a.version.slice(2), undefined, { numeric: true }));
  for (const release of matches) {
    const file = release.files.find((f) => f.os === "darwin" && f.arch === goArch && f.kind === "archive");
    if (file) return { version: release.version, filename: file.filename, sha256: file.sha256 };
  }
  return null;
}

async function installGo(p: Probes, pin: string, arch: HostArch): Promise<InstallResult> {
  const fail = (detail: string): InstallResult => ({ via: "download", ok: false, detail });
  const res = await p.fetch(GO_RELEASES_URL, { timeoutMs: 30_000 }).catch(() => null);
  if (!res || res.status !== 200) throw noGoRelease("go.dev did not answer. Check your internet connection.");
  let releases: GoRelease[];
  try {
    releases = JSON.parse(res.body) as GoRelease[];
  } catch {
    throw noGoRelease("go.dev's release list could not be read.");
  }
  const archive = pickGoArchive(releases, pin, arch);
  if (!archive) throw noGoRelease(`go.dev lists no stable Go ${pin} for this Mac's processor (${arch}).`);

  const work = join(p.env.TMPDIR ?? "/tmp", "rt-dev-install");
  p.mkdirp(work);
  const file = join(work, archive.filename);
  const fetched = await p.exec(["curl", "-fsSL", `${GO_DOWNLOAD_PAGE}${archive.filename}`, "-o", file], { timeoutMs: INSTALL_TIMEOUT_MS });
  if (fetched.code !== 0) return fail(`Downloading ${archive.version} failed (exit ${fetched.code}): ${firstLine(fetched.stderr || fetched.stdout)}`);
  const sum = await p.exec(["shasum", "-a", "256", file], { timeoutMs: PROBE_TIMEOUT_MS });
  if (sum.code !== 0 || sum.stdout.trim().split(/\s+/)[0] !== archive.sha256) {
    return fail(`The ${archive.version} download did not match go.dev's sha256, so nothing was installed`);
  }

  const toolchain = join(p.home, ".mattstack", "toolchains", archive.version);
  await p.exec(["rm", "-rf", toolchain], { timeoutMs: PROBE_TIMEOUT_MS });
  p.mkdirp(toolchain);
  const unpacked = await p.exec(["tar", "-xzf", file, "-C", toolchain], { timeoutMs: INSTALL_TIMEOUT_MS });
  if (unpacked.code !== 0) return fail(`Unpacking ${archive.version} failed: ${firstLine(unpacked.stderr || unpacked.stdout)}`);

  const bin = join(p.home, ".local", "bin");
  p.mkdirp(bin);
  for (const name of ["go", "gofmt"]) {
    const linked = await p.exec(["ln", "-sfn", join(toolchain, "go", "bin", name), join(bin, name)], { timeoutMs: PROBE_TIMEOUT_MS });
    if (linked.code !== 0) return fail(`Linking ${name} into ~/.local/bin failed: ${firstLine(linked.stderr || linked.stdout)}`);
  }
  const verify = await p.exec([join(bin, "go"), "version"], { timeoutMs: PROBE_TIMEOUT_MS });
  if (verify.code !== 0) return fail(`${archive.version} was installed, but go still does not run (exit ${verify.code})`);
  return { via: "download", ok: true, detail: `installed ${archive.version} from go.dev` };
}

/**
 * Runs the installer argv, then re-probes `<tool> --version` before
 * reporting success — an installer's own exit code is never sufficient
 * proof by itself (an installer can exit 0 over a broken shim).
 */
async function runInstallerAndVerify(
  p: Probes,
  tool: string,
  via: "vendor",
  argv: string[],
  label: string,
  successDetail: string,
  verifyArgv: string[] = [tool, "--version"],
): Promise<InstallResult> {
  const res = await p.exec(argv, { timeoutMs: INSTALL_TIMEOUT_MS });
  if (res.code === 124) return { via, ok: false, detail: `${label} did not finish in time` };
  if (res.code !== 0) return { via, ok: false, detail: `${label} failed (exit ${res.code}): ${firstLine(res.stderr || res.stdout)}` };

  const verify = await p.exec(verifyArgv, { timeoutMs: PROBE_TIMEOUT_MS });
  if (verify.code !== 0) {
    return { via, ok: false, detail: `${label} finished, but ${tool} still does not run (exit ${verify.code})` };
  }
  return { via, ok: true, detail: successDetail };
}

/** Rejects anything but https on one of the known vendor hosts — a hardcoded VENDOR_INSTALLERS entry only, never a team-declared URL (see installTool). */
function validateVendorUrl(url: string): { ok: true } | { ok: false; detail: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, detail: `The install URL is not valid: ${url}` };
  }
  if (parsed.protocol !== "https:") return { ok: false, detail: `The install URL must use https, not ${parsed.protocol} (${url})` };
  if (!VENDOR_ALLOWED_HOSTS.has(parsed.hostname)) return { ok: false, detail: `The install URL's host ${parsed.hostname} is not a known vendor` };
  return { ok: true };
}

/** A fixed, rt-owned local path per tool — never derived from anything the URL or its response controls. */
function vendorDownloadPath(p: Pick<Probes, "env">, tool: string): string {
  return join(p.env.TMPDIR ?? "/tmp", "rt-vendor-install", `${tool}.sh`);
}

/**
 * R-T21-a: the URL is passed as its own argv element to `curl`, never
 * spliced into a shell string. R-T21-b: only ever called with a
 * VENDOR_INSTALLERS entry (rt's own short hardcoded list) — a team-declared
 * URL never reaches here. Fetch, then run the fetched file as its own argv
 * step (`["sh", path]` — a script FILE argument, not a `-c` command string)
 * — no pipe-to-shell anywhere in the sequence.
 */
async function runVendorInstaller(p: Probes, tool: string, url: string, opts: { shell?: "sh" | "bash"; args?: string[]; verify?: string[] } = {}): Promise<InstallResult> {
  const validated = validateVendorUrl(url);
  if (!validated.ok) return { via: "vendor", ok: false, detail: validated.detail };

  const path = vendorDownloadPath(p, tool);
  p.mkdirp(dirname(path));

  const fetchRes = await p.exec(["curl", "-fsSL", url, "-o", path], { timeoutMs: INSTALL_TIMEOUT_MS });
  if (fetchRes.code === 124) return { via: "vendor", ok: false, detail: "Downloading the install script did not finish in time" };
  if (fetchRes.code !== 0) return { via: "vendor", ok: false, detail: `Downloading the install script failed (exit ${fetchRes.code}): ${firstLine(fetchRes.stderr || fetchRes.stdout)}` };

  return runInstallerAndVerify(p, tool, "vendor", [opts.shell ?? "sh", path, ...(opts.args ?? [])], "install script", "installed via vendor script", opts.verify);
}

// ─── setupTool ───────────────────────────────────────────────────────────

export interface SetupResult {
  ok: boolean;
  detail: string;
}

async function setupFastBrowser(p: Probes, seams: ToolsInstallSeams, marketplaceSource: string | undefined): Promise<SetupResult> {
  const resolved = seams.resolveTool(p, "fast-browser");
  if (!resolved.exec) throw new UserActionableError("tool-missing", "fast-browser is not resolvable (not bundled, no user copy on PATH)");

  // rt owns ~/.local/bin/fast-browser whenever the bundled copy is the one in
  // use. Linking first means fast-browser setup finds rt's wrapper and leaves
  // it, rather than writing its own shim that needs a system node. A refusal
  // here is a live user copy holding the slot, which setup also leaves alone.
  if (resolved.bundled) seams.link(p, "fast-browser");

  // Non-interactive setup refuses to guess a host even when only one is
  // detected, and refuses a "mattstack" marketplace registered from any
  // source but the one it is told — so it is told the one plugins.install used.
  const args = ["setup", "--host", "claude", ...(marketplaceSource ? ["--source", marketplaceSource] : [])];
  const res = await p.exec([...resolved.exec, ...args], { timeoutMs: INSTALL_TIMEOUT_MS });
  if (res.code === 124) return { ok: false, detail: "Fast Browser's setup did not finish in time" };
  if (res.code !== 0) return { ok: false, detail: `Fast Browser's setup failed (exit ${res.code}): ${firstLine(res.stderr || res.stdout)}` };
  return { ok: true, detail: "Fast Browser is set up" };
}

async function setupHerdr(p: Probes, seams: ToolsInstallSeams, configDirs: string[]): Promise<SetupResult> {
  // A bare name could land on the rt wrapper the resolver just skipped.
  const herdr = seams.resolveTool(p, "herdr").exec ?? ["herdr"];
  const results: { dir: string; ok: boolean; detail: string }[] = [];
  for (const dir of configDirs) {
    const res = await p.exec([...herdr, "integration", "install", "claude"], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: INSTALL_TIMEOUT_MS });
    if (res.code === 124) results.push({ dir, ok: false, detail: "timed out" });
    else if (res.code !== 0) results.push({ dir, ok: false, detail: `exit ${res.code}` });
    else results.push({ dir, ok: true, detail: "ok" });
  }
  const ok = results.length > 0 && results.every((r) => r.ok);
  const detail = results.map((r) => `${r.dir}: ${r.detail}`).join("; ") || "No Claude config folders to set up";
  return { ok, detail };
}

/** Exported so a caller classifying `SetupResult.detail` (extension.install's apply step) matches against the same value this emits, rather than a copy of the prose. */
export const VSIX_NOT_FOUND_DETAIL = "The editor extension files were not found in the app or next to rt";
export const NO_EDITORS_DETAIL = "No compatible editor found";
export const NO_RECORDED_EDITORS_DETAIL = "No editor on this Mac has the extension from an earlier setup";

/** `onlyEditors` narrows the install to those editor names; an editor it leaves out is never touched. */
async function setupExtension(p: Probes, seams: ToolsInstallSeams, onlyEditors: readonly string[] | undefined): Promise<SetupResult> {
  const vsixes = seams.findVsixes(p);
  if (vsixes.length === 0) return { ok: false, detail: VSIX_NOT_FOUND_DETAIL };

  const detected: DetectedEditor[] = seams.detectEditors();
  if (detected.length === 0) return { ok: false, detail: NO_EDITORS_DETAIL };
  const editors = onlyEditors ? detected.filter((e) => onlyEditors.includes(e.name)) : detected;
  if (editors.length === 0) return { ok: false, detail: NO_RECORDED_EDITORS_DETAIL };

  const installed: string[] = [];
  const failed: string[] = [];
  for (const editor of editors) {
    const exits: number[] = [];
    for (const vsix of vsixes) {
      const res = await p.exec([editor.cliPath, "--install-extension", vsix, "--force"], { timeoutMs: EXTENSION_INSTALL_TIMEOUT_MS });
      if (res.code !== 0) exits.push(res.code);
    }
    if (exits.length === 0) installed.push(editor.name);
    else failed.push(`${editor.name} (exit ${exits.join(", ")})`);
  }

  // An editor is recorded only once every file installed into it: a
  // half-installed editor must never read as done.
  if (installed.length > 0) {
    updateSetupState(p, (s) => ({ ...s, extensionEditors: [...new Set([...s.extensionEditors, ...installed])] }));
  }

  const ok = installed.length > 0 && failed.length === 0;
  const detail = failed.length === 0 ? `Installed into ${installed.join(", ")}` : `Installed into ${installed.join(", ") || "none"}; failed in ${failed.join(", ")}`;
  return { ok, detail };
}

export async function setupTool(p: Probes, tool: string, opts: { configDirs: string[]; marketplaceSource?: string; onlyEditors?: readonly string[] }, seams: ToolsInstallSeams = REAL_SEAMS): Promise<SetupResult> {
  if (tool === "fast-browser") return setupFastBrowser(p, seams, opts.marketplaceSource);
  if (tool === "herdr") return setupHerdr(p, seams, opts.configDirs);
  if (tool === "extension") return setupExtension(p, seams, opts.onlyEditors);
  throw new UserActionableError("unknown-tool-setup", `no setup routine for "${tool}"`);
}

// ─── claudeConfigDirs ──────────────────────────────────────────────────────

/** [CLAUDE_CONFIG_DIR env ?? ~/.claude, ...extra], deduped. */
export function claudeConfigDirs(p: Pick<Probes, "env" | "home">, extra: string[]): string[] {
  const base = p.env.CLAUDE_CONFIG_DIR ?? join(p.home, ".claude");
  return [...new Set([base, ...extra])];
}
