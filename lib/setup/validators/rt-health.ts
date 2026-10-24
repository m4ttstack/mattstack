/**
 * tools-group validators — the checks `rt verify` used to run, reframed as
 * setup Rows.
 *
 * `checkRtContextExtension` lives here now (moved from commands/verify.ts,
 * which re-exports it) so both `rt verify` and the setup plan share one
 * implementation.
 */

import { join } from "path";
import { RT_BUNDLE_PATH } from "../../bundle-layout.ts";
import type { DaemonResponse } from "../../daemon-client.ts";
import { activeLaunchdLabel, isDaemonInstalled } from "../../daemon-config.ts";
import type { HomeSnapshotSettings } from "../../daemon/home-snapshot.ts";
import type { TeamSnapshotEntry, TeamSnapshotSettings } from "../../daemon/team-snapshots.ts";
import { clampPullIntervalSec, PULL_INTERVAL_FALLBACK_SEC } from "../../daemon/snapshot-interval.ts";
import { isDevModeWrapperContent } from "../../dev-mode.ts";
import { processFlavor } from "../../flavor.ts";
import { appBundlePath, linkPath } from "../../deps/resolve.ts";
import { interceptsOutOfDate, localBinDir, shimReport } from "../../endpoint/shim.ts";
import { DEV_TRAY_APP_BUNDLE, legacyDirsPresent, legacyTrayAppPaths, orgDirUnder, orgsDirUnder, RT_DIR_LABEL, TRAY_APP_BUNDLE } from "../../rt-paths.ts";
import { getSetting } from "../../settings/resolve.ts";
import { detectShellFrom, END_MARKER, MARKER, repairLegacyBlock, shellRcPathFor } from "../../shell-integration.ts";
import { readHomePushRecord, type HomePushRecord } from "../../home/push-record.ts";
import { keptTeams, type KeptTeam } from "../../team/org-cone.ts";
import { heldCopy, moveBlocker } from "../../team/org-data-branch.ts";
import { approvedBranches } from "../../team/approved-branch.ts";
import { isOrgAdmin } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { checkedOutBranch, shellQuote } from "../../team/org-branch.ts";
import { checkDataBranch, checkMainForOrgData, GONE_SENTENCE, MERGED_SENTENCE } from "../../team/data-branch-guard.ts";
import { roleFor } from "../../team/roles.ts";
import { holdSentence, layoutSentence, orgLayoutState } from "../../team/org-layout.ts";
import { markerOrg, ORG_LAYOUT } from "../../team/org-marker.ts";
import { agoPhrase, JANITOR_REF_PREFIX, packPhrase, packRemedySteps, packsInZone, uniquePacks, zoneOfJanitorRef, type PackRef } from "../../team/unpublished-packs.ts";
import { teamPackRel } from "../../team/team-pack-path.ts";
import { parsePorcelainZ } from "../../daemon/home-snapshot-plan.ts";
import { applyStepAction, row, type Action, type Row } from "../contract.ts";
import { hasCommits, hasRemote, isGitRepo, originPushState } from "../home-git.ts";
import { LOGIN_ITEMS_SETTINGS_ACTION } from "../permissions.ts";
import { memberPath } from "../member-path.ts";
import { execWithTimeout, type Probes } from "../probes.ts";
import { discoverOrgs } from "../team-settings.ts";
import { BUNDLED_VSIX_FILES } from "../tools-install.ts";
import { detectEditorsVia } from "../../editors.ts";
import { ONE_TEAM_RULE } from "../../team/one-team.ts";
import { named } from "./tools.ts";

// ─── rt-context extension check (moved from commands/verify.ts) ──────────────

export interface ExtensionCheckResult {
  name: string;
  status: "pass" | "warn" | "skip";
  detail: string;
  severity: "warning" | "info";
}

const RT_EXTENSIONS = [
  { label: "rt-context", prefix: "local.rt-context-" },
  { label: "skill-blocks", prefix: "local.skill-blocks-" },
];

/**
 * Directory reads only, no subprocess and no version comparison — the
 * extensions version independently of the CLI, so a version check is
 * underivable here. Every VS Code-family editor found in `appDirs` is
 * checked through its extensions folder under `home`; an editor whose folder
 * is not known is named as unchecked. Shape matches `rt verify`'s
 * CheckResult (name/status/detail/severity) so commands/verify.ts's
 * re-export slots straight into its existing `results.push(...)`.
 */
export function checkRtContextExtension(
  p: Pick<Probes, "exists" | "readDir" | "home">,
  appDirs: string[] = ["/Applications", join(p.home, "Applications")],
): ExtensionCheckResult {
  const complete: string[] = [];
  const partial: string[] = [];
  const bare: string[] = [];
  const unchecked: string[] = [];

  for (const editor of detectEditorsVia(p.exists, appDirs)) {
    if (!editor.extensionsDir) {
      unchecked.push(editor.name);
      continue;
    }
    const dir = join(p.home, editor.extensionsDir);
    let entries: string[] = [];
    try {
      if (p.exists(dir)) entries = p.readDir(dir).map((e) => e.toLowerCase());
    } catch {
      entries = [];
    }
    const missing = RT_EXTENSIONS.filter((x) => !entries.some((e) => e.startsWith(x.prefix))).map((x) => x.label);
    if (missing.length === 0) complete.push(editor.name);
    else if (missing.length < RT_EXTENSIONS.length) partial.push(`${editor.name} is missing ${missing.join(" and ")}`);
    else bare.push(editor.name);
  }

  const name = "rt-context extension";
  const uncheckedNote = unchecked.length > 0 ? `. rt can't check ${unchecked.join(", ")}` : "";
  if (partial.length > 0) return { name, status: "warn", detail: `${partial.join("; ")}. Run rt settings extension`, severity: "warning" };
  if (complete.length > 0) return { name, status: "pass", detail: `Installed in ${complete.join(", ")}${uncheckedNote}`, severity: "warning" };
  if (bare.length > 0) return { name, status: "warn", detail: `Not installed in ${bare.join(", ")}. Run rt settings extension`, severity: "warning" };
  if (unchecked.length > 0) return { name, status: "skip", detail: `rt can't check ${unchecked.join(", ")}`, severity: "info" };
  return { name, status: "skip", detail: "No VS Code-family editor found", severity: "info" };
}

// ─── injectable seams ─────────────────────────────────────────────────────────

// The bare exec, not `createRealProbes().exec`: a full Probes captures $HOME at
// construction, and this is module-load time.
const REAL_EXEC: Probes["exec"] = execWithTimeout;

// ─── row builders ──────────────────────────────────────────────────────────

const LINK_BUNDLED_RT: Action = { type: "link-bundled", label: "Use mattstack's", tool: "rt" };
const RECHECK_ACTION: Action = { type: "run", label: "Re-check", verb: ["setup", "status"] };
const REINSTALL_SHIMS_ACTION: Action = { type: "run", label: "Re-install shims", verb: ["intercept", "install"] };
/** Re-installing shims cannot change PATH; `path.link` writes the shell blocks that do. */
const SET_UP_PATH_ACTION: Action = { type: "run", label: "Set up PATH", verb: ["setup", "apply", "--only", "path.link"] };
const INSTALL_EXTENSION_ACTION: Action = { type: "run", label: "Install extension", verb: ["tools", "setup", "extension"] };
const HOME_BACKUP_PUSH_STEP = "git -C ~/.mattstack/user push origin HEAD, or wait for the daemon to push on its next cycle (up to 30 minutes)";
const HOME_BACKUP_ADD_REMOTE_ACTION: Action = {
  type: "form",
  label: "Add remote…",
  verb: ["home", "remote", "set"],
  fields: [{ name: "url", label: "Remote URL", secret: false, hint: "An empty private repo you own, e.g. https://github.com/you/mattstack-home.git" }],
  alternatives: [{ id: "create", label: "Create a private repo for me" }],
};
const HOME_BACKUP_PUSH_ACTION: Action = { type: "steps", label: "Show steps…", steps: [HOME_BACKUP_PUSH_STEP] };
const MERGE_LEGACY_STATE_ACTION: Action = {
  type: "steps",
  label: "Merge legacy state",
  steps: [
    "Compare each file under the legacy dir(s) named above with ~/.mattstack/rt",
    "Copy over anything ~/.mattstack/rt is missing",
    "Delete the legacy dir(s) once you've confirmed nothing is left to merge",
  ],
};

/** `rt --version` leads with "rt <version>", so the name comes off before `named` puts it back. */
function rtNamed(stdout: string): string {
  return named("rt", stdout.trim().split("\n")[0]!.replace(/^rt(\s+|$)/, ""));
}

async function rtRow(p: Probes): Promise<Row> {
  const base = { id: "tool.rt", kind: "tool" as const, title: "rt binary", why: "rt itself must be on PATH before anything else can run.", required: true };
  const res = await p.exec(["rt", "--version"]);
  if (res.code === 0) return row({ ...base, status: "ready", detail: rtNamed(res.stdout) });
  if (res.code === 127) {
    // ~/.local/bin joins PATH only in Install's own path step, so before
    // Install the link there is the only rt a fresh machine can have.
    const linked = linkPath(p.home, "rt");
    if (p.exists(linked)) {
      const viaLink = await p.exec([linked, "--version"]);
      if (viaLink.code === 0) return row({ ...base, status: "ready", detail: `${rtNamed(viaLink.stdout)} at ~/.local/bin, which Install added to your PATH` });
    }
    return row({ ...base, status: "missing", detail: "rt is not on your PATH yet", action: LINK_BUNDLED_RT });
  }
  return row({ ...base, status: "error", detail: `Could not run rt (exit ${res.code})` });
}

function rtLinkRow(p: Probes): Row {
  const base = {
    id: "tool.rt-link",
    kind: "tool" as const,
    title: "rt PATH link",
    why: "Prod mode's ~/.local/bin/rt must point at the rt inside mattstack.app.",
    required: false,
    optionalNote: "Cosmetic: without this, `rt` may resolve to a different copy on PATH than the one inside mattstack.app.",
  };

  const prefix = p.readPrefix(linkPath(p.home, "rt"));
  if (prefix !== null && isDevModeWrapperContent(prefix)) {
    return row({ ...base, status: "skipped", detail: "The dev app's source wrapper owns ~/.local/bin/rt" });
  }

  const root = appBundlePath(p);
  if (!root) return row({ ...base, status: "skipped", detail: "mattstack.app not found, so there is nothing to link into" });

  const expected = join(root, RT_BUNDLE_PATH);
  const actual = p.readlink(linkPath(p.home, "rt"));
  if (actual === expected) return row({ ...base, status: "ready", detail: "Linked into mattstack.app" });
  // A "run" action pointing at `setup apply --from path.link` would replay
  // the full 16-step chain from that point — buffered, one-shot, no
  // NeedBroker — and any `need` a later step raises (services.register,
  // proxy.install) would hang this cosmetic row for the full 10-minute
  // await timeout. `link-bundled` dispatches the single one-shot verb this
  // row actually needs (`rt deps link rt --json`).
  return row({ ...base, status: "needs-you", detail: "Not a link into mattstack.app. Run rt deps link rt", action: LINK_BUNDLED_RT });
}

function legacyDirsRow(): Row {
  const base = { id: "tool.legacy-dirs", kind: "tool" as const, title: "Legacy state dirs", why: `rt reads only ${RT_DIR_LABEL}, so a leftover legacy dir means state is split and silently ignored.`, required: true };
  const legacy = legacyDirsPresent();
  if (legacy.real.length > 0) {
    const plural = legacy.real.length !== 1 ? "s" : "";
    return row({
      ...base,
      status: "invalid",
      detail: `Old folder${plural} still present: ${legacy.real.join(", ")}. rt reads only ${RT_DIR_LABEL}`,
      action: MERGE_LEGACY_STATE_ACTION,
    });
  }
  if (legacy.symlinks.length > 0) {
    return row({ ...base, status: "ready", detail: `Old-location links still present: ${legacy.symlinks.join(", ")}` });
  }
  return row({ ...base, status: "ready", detail: `State lives only in ${RT_DIR_LABEL}` });
}

async function interceptsRow(p: Probes): Promise<Row> {
  const base = {
    id: "tool.intercepts",
    kind: "tool" as const,
    title: "Intercept shims",
    why: "Team command intercepts (git, gh, …) only fire once their PATH shims are installed and current.",
    required: false,
    optionalNote: "Works without this; team command intercepts (git, gh, …) just won't fire.",
  };

  let report: ReturnType<typeof shimReport>;
  let staleRules: Awaited<ReturnType<typeof interceptsOutOfDate>>;
  try {
    report = shimReport();
    staleRules = await interceptsOutOfDate();
  } catch (err) {
    return row({ ...base, status: "error", detail: `The check failed: ${(err as Error).message}` });
  }

  if (report.length === 0) return row({ ...base, status: "ready", detail: "Not needed: your team has no intercepts" });

  const missing = report.filter((r) => !r.installed);
  const stale = report.filter((r) => r.installed && !r.current);
  const binDir = localBinDir();
  const shellPath = await memberPath(p);
  const anyInstalled = report.some((r) => r.installed);
  const pathBroken = anyInstalled && shellPath !== null && !shellPath.includes(binDir);
  const pathNote = pathBroken ? `. Also, ${binDir} is not on your shell's PATH, so intercepts will not fire` : "";

  if (missing.length > 0) {
    return row({ ...base, status: "needs-you", detail: `Not installed yet: ${missing.map((r) => r.command).join(", ")}. Run rt intercept install${pathNote}`, action: REINSTALL_SHIMS_ACTION });
  }
  if (stale.length > 0) {
    return row({ ...base, status: "needs-you", detail: `Out of date: ${stale.map((r) => r.command).join(", ")}. Run rt intercept install${pathNote}`, action: REINSTALL_SHIMS_ACTION });
  }
  if (pathBroken) {
    return row({ ...base, status: "needs-you", detail: `Installed, but ${binDir} is not on your shell's PATH, so intercepts will not fire`, action: SET_UP_PATH_ACTION });
  }
  if (staleRules.stale) {
    return row({ ...base, status: "needs-you", detail: `Installed, but the rules are out of date (${staleRules.reason}). Run rt intercept install`, action: REINSTALL_SHIMS_ACTION });
  }
  if (shellPath === null) {
    return row({ ...base, status: "error", detail: "Installed, but rt could not read your shell's PATH to check that intercepts will fire", action: RECHECK_ACTION });
  }
  return row({ ...base, status: "ready", detail: `${report.length} installed and up to date` });
}

async function appRow(p: Probes): Promise<Row> {
  const base = {
    id: "tool.app",
    kind: "tool" as const,
    title: "mattstack.app",
    why: "The tray app hosts the daemon, permissions, and every bundled tool.",
    required: true,
    recheck: "on-activate" as const,
  };
  const root = appBundlePath(p);
  if (!root) return row({ ...base, status: "missing", detail: "mattstack.app is not in /Applications or ~/Applications" });

  const plist = join(root, "Contents", "Info.plist");
  const res = await p.exec(["/usr/libexec/PlistBuddy", "-c", "Print CFBundleShortVersionString", plist]);
  const version = res.code === 0 ? res.stdout.trim() : null;
  let detail = version ? `${root} (v${version})` : root;

  const legacyHits = legacyTrayAppPaths().filter((path) => p.exists(path));
  if (legacyHits.length > 0) detail += `. An old copy is still present: ${legacyHits.join(", ")}`;

  return row({ ...base, status: "ready", detail });
}

function vsixRow(p: Probes): Row {
  const base = {
    id: "tool.vsix",
    kind: "tool" as const,
    title: "Bundled extension",
    why: "mattstack.app can carry rt's editor extensions, rt-context and skill-blocks, pre-bundled.",
    required: false,
    optionalNote: "Works without this; rt's editor extensions just won't be pre-installed for you.",
  };
  const root = appBundlePath(p);
  if (!root) return row({ ...base, status: "skipped", detail: "mattstack.app not found" });

  const missing = BUNDLED_VSIX_FILES.filter((file) => !p.exists(join(root, "Contents", "Resources", file)));
  if (missing.length === 0) return row({ ...base, status: "ready", detail: "Both editor extensions ship in the app" });
  if (missing.length === BUNDLED_VSIX_FILES.length) return row({ ...base, status: "skipped", detail: "This build does not ship the editor extensions" });
  return row({ ...base, status: "skipped", detail: `This build does not ship ${missing.join(" or ")}` });
}

function extensionRow(p: Probes): Row {
  const base = {
    id: "tool.extension",
    kind: "tool" as const,
    title: "rt-context extension",
    why: "Gives your editor rt-aware context.",
    required: false,
    optionalNote: "Works without this; your editor just won't have rt-aware context.",
  };
  const result = checkRtContextExtension(p);
  if (result.status === "pass") return row({ ...base, status: "ready", detail: result.detail });
  if (result.status === "warn") return row({ ...base, status: "needs-you", detail: result.detail, action: INSTALL_EXTENSION_ACTION });
  return row({ ...base, status: "skipped", detail: result.detail });
}

/** `path.link` is the step that writes the rc block; `--only` runs just it (lib/setup/apply.ts). */
const ADD_TO_SHELL_ACTION: Action = { type: "run", label: "Add to shell", verb: ["setup", "apply", "--only", "path.link"] };
const UPDATE_SHELL_BLOCK_ACTION: Action = { ...ADD_TO_SHELL_ACTION, label: "Update shell block" };

function shellRow(p: Probes): Row {
  const base = {
    id: "tool.shell",
    kind: "tool" as const,
    title: "Shell integration",
    why: "The rtcd alias and PATH precedence come from your shell rc file.",
    required: false,
    optionalNote: "Works without this; you can still run `rt cd` directly, just not the `rtcd` shell alias.",
  };
  const shell = detectShellFrom(p.env.SHELL ?? "");
  const rc = shellRcPathFor(shell, p.home);
  if (rc) {
    const content = p.readFile(rc) ?? "";
    if (content.includes("rtcd")) return row({ ...base, status: "ready", detail: `The rtcd alias is in ${rc}` });
    // An old block with no end marker: path.link updates it when rt can tell its own lines apart, else its button would change nothing.
    const markerAt = content.indexOf(MARKER);
    if (markerAt !== -1 && content.indexOf(END_MARKER, markerAt) === -1) {
      if (shell !== "fish" && repairLegacyBlock(content) !== null) {
        return row({ ...base, status: "needs-you", detail: `An old rt block in ${rc} needs updating`, action: UPDATE_SHELL_BLOCK_ACTION });
      }
      return row({ ...base, status: "needs-you", detail: `Remove the old rt block from ${rc} by hand, then Re-check`, action: RECHECK_ACTION });
    }
    return row({ ...base, status: "needs-you", detail: "Shell integration not added yet", action: ADD_TO_SHELL_ACTION });
  }
  return row({ ...base, status: "needs-you", detail: "rt does not know this shell, so add the rtcd alias yourself" });
}

async function daemonRow(p: Probes, opts: { ci: boolean }): Promise<Row> {
  const base = {
    id: "tool.daemon",
    kind: "tool" as const,
    title: "Daemon",
    why: "The daemon watches your repos and backs MRs and notifications.",
    required: true,
    recheck: "on-activate" as const,
  };

  // The marker is written only by services.register, but the app also
  // registers the daemon at launch; one that answers is installed either way.
  const ping = await p.daemon("ping");
  const answers = ping?.ok === true;
  if (!answers && !isDaemonInstalled()) return row({ ...base, status: "missing", detail: "Not registered yet", action: applyStepAction("Register services", "services.register") });
  if (!answers) {
    if (opts.ci) return row({ ...base, status: "needs-you", detail: "Not running (expected in CI)" });
    return row({ ...base, status: "needs-you", detail: "Installed but not responding. Approve it in Login Items", action: LOGIN_ITEMS_SETTINGS_ACTION });
  }

  const [statusRes, launchd, worktrees] = await Promise.all([
    p.daemon("status"),
    p.exec(["launchctl", "list", activeLaunchdLabel()]),
    p.daemon("worktrees"),
  ]);

  const data = (statusRes?.data ?? {}) as { pid?: number; uptime?: number; watchedRepos?: number };

  // launchctl exiting 124 (this module's own timeout code) or 127 (not
  // found) means the probe never produced an answer — that is "could not
  // determine", not "determined not registered". Only a clean exit whose
  // output actually says so is a real negative. Same distinction for
  // `worktrees === null`, which is the daemon-client's transport-failure
  // sentinel, not the endpoint answering "no".
  const launchdInconclusive = launchd.code === 124 || launchd.code === 127;
  const launchdOk = !launchdInconclusive && launchd.code === 0 && !launchd.stdout.includes("Could not find");
  const launchdMissing = !launchdInconclusive && !launchdOk;
  const worktreesInconclusive = worktrees === null;

  const parts: string[] = [];
  if (data.pid !== undefined) parts.push(`pid ${data.pid}`);
  if (typeof data.uptime === "number") parts.push(`uptime ${Math.floor(data.uptime / 1000)}s`);
  if (typeof data.watchedRepos === "number") parts.push(`watching ${data.watchedRepos} repos`);

  // A daemon that answers ping but fails a sub-fact is a real negative
  // signal, not cosmetic: launchd registration is what makes it survive a
  // login, and the worktrees endpoint is the daemon's own smoke test
  // (`rt verify` today hard-fails on exactly this — verify.ts's "daemon api"
  // check). Folding these into a "ready" detail would let a structurally
  // broken daemon enable Install.
  const inconclusive: string[] = [];
  if (launchdInconclusive) inconclusive.push(`launchctl check failed (${launchd.code === 124 ? "timed out" : "not found"})`);
  if (worktreesInconclusive) inconclusive.push("worktrees endpoint check failed (daemon unreachable)");

  const missing: string[] = [];
  if (launchdMissing) missing.push("not registered with launchd");

  // Any inconclusive sub-fact makes the whole row "could not determine" —
  // never "invalid" alongside evidence that never actually arrived.
  if (inconclusive.length > 0) return row({ ...base, status: "error", detail: [...parts, ...missing, ...inconclusive].join(", ") });
  if (missing.length > 0) return row({ ...base, status: "invalid", detail: [...parts, ...missing].join(", ") });

  parts.push("registered with launchd", "worktrees endpoint responding");
  return row({ ...base, status: "ready", detail: parts.join(", ") });
}

/**
 * Compares this CLI's own flavor with a LIVE daemon's ping, and fails only
 * when a running daemon actually disagrees. A daemon that never answers
 * (down, uninstalled, unreachable) is `tool.daemon`'s failure to report, not
 * this row's: CI's clean-room gate runs verify with no daemon at all, so
 * that leg reading "n/a" must always resolve `ready` here or a headless run
 * could never pass.
 */
async function flavorRow(p: Probes): Promise<Row> {
  const base = {
    id: "tool.flavor",
    kind: "tool" as const,
    title: "Flavor coherence",
    why: "One app serves this machine; a daemon of the other app means stale code answering fresh CLIs.",
    required: true,
    recheck: "on-activate" as const,
  };
  const cli = processFlavor();
  const ping = await p.daemon("ping");
  const flavor = ping && ping.ok ? (ping as DaemonResponse & { flavor?: unknown }).flavor : undefined;
  const daemonFlavor = flavor ? String(flavor) : null;

  if (daemonFlavor === null) {
    return row({ ...base, status: "ready", detail: `${cli} CLI, no daemon` });
  }
  if (daemonFlavor === cli) {
    return row({ ...base, status: "ready", detail: `${cli} CLI and daemon` });
  }
  const app = cli === "dev" ? DEV_TRAY_APP_BUNDLE : TRAY_APP_BUNDLE;
  return row({
    ...base,
    status: "invalid",
    detail: `A ${daemonFlavor} daemon is answering this ${cli} CLI. Open ${app}, quitting it first if it is running`,
  });
}

/** Wall-clock, not an injected `now()` — this row takes a bare `exec`, not a full Probes, so there is no seam to inject. */
function relativeWhen(at: Date | null): string {
  if (!at) return "recently";
  const mins = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** One line, bounded: a push failure's stderr can run to a paragraph, and this shares a row's `detail` with the count it explains. */
function pushFailureSummary(record: HomePushRecord): string | null {
  if (record.ok) return null;
  const firstLine = (record.error ?? "").split("\n").map((l) => l.trim()).find((l) => l !== "");
  if (!firstLine) return null;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}

/** Same key and fallback lib/daemon/home-snapshot.ts's schedulePush() reads (SETTINGS_FALLBACK.pushDelaySec): a user who raises the delay must not recreate the false alarm this exists to avoid. */
const HOME_PUSH_DELAY_FALLBACK_SEC = 60;
/** The daemon's own push exec is itself bounded to ~30s (PUSH_TIMEOUT_MS in home-snapshot.ts): a commit whose scheduled push is still running inside that window is not evidence of anything broken. */
const HOME_PUSH_GRACE_MS = 30_000;

function homePushDelaySec(): number {
  const raw = getSetting<HomeSnapshotSettings>("rt.homeSnapshot").value?.pushDelaySec;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : HOME_PUSH_DELAY_FALLBACK_SEC;
}

const CREATE_HOME_REPO_ACTION: Action = { type: "run", label: "Create home repo", verb: ["setup", "apply", "--only", "home.init"] };

/**
 * Green means a push actually happened, never merely that a remote is
 * configured — read from git's own remote-tracking ref, so this is right on
 * a machine where the daemon has never run and right when the user pushed
 * by hand. Takes a bare `repoDir` + `exec` (not the full `Probes`) so it can
 * be pointed at a real git repo directly, independent of the OS `$HOME` a
 * full `Probes` carries.
 *
 * `readLastPush` supplies only diagnostic detail — the daemon's own record of
 * its last push attempt. It never gates `ready`: a record saying "pushed fine"
 * on a repo whose tracking ref disagrees is exactly the shape-not-outcome
 * reading this row exists to refuse.
 */
export async function homeBackupRow(
  repoDir: string,
  exec: Probes["exec"] = REAL_EXEC,
  readLastPush: () => HomePushRecord | null = () => readHomePushRecord(),
): Promise<Row> {
  const base = {
    id: "home.backup",
    kind: "tool" as const,
    title: "Home repo backup",
    why: "Local-only is fully supported; this only confirms whether your settings are actually backed up anywhere, not just committed on this machine.",
    required: false,
    optionalNote: "Works without this; local-only just means this machine is the only copy of your settings.",
    recheck: "on-activate" as const,
  };

  if (!(await isGitRepo(exec, repoDir))) {
    return row({ ...base, status: "needs-you", detail: "No home repo yet, so nothing is backed up", action: CREATE_HOME_REPO_ACTION });
  }

  // Ahead of the remote check: an unborn repo is not "versioned on this
  // machine" either way, so a local-only one must not claim it is.
  if (!(await hasCommits(exec, repoDir))) {
    return row({ ...base, status: "needs-you", detail: "No commits yet, so nothing is versioned or backed up" });
  }

  if (!(await hasRemote(exec, repoDir))) {
    return row({ ...base, status: "needs-you", detail: "Local only: your settings are versioned on this Mac but backed up nowhere. Run rt home remote set <url>, or rt home remote set --create", action: HOME_BACKUP_ADD_REMOTE_ACTION });
  }

  const state = await originPushState(exec, repoDir);
  if (state.kind === "no-ref") return row({ ...base, status: "needs-you", detail: "Remote set, nothing pushed yet", action: HOME_BACKUP_PUSH_ACTION });
  if (state.kind === "unknown") return row({ ...base, status: "needs-you", detail: "Could not tell whether the remote is up to date" });

  const lastPush = readLastPush();
  if (state.kind === "ahead") {
    // A recorded failure is decisive either way, fresh or stale: the daemon
    // already told us the push didn't happen.
    if (lastPush && !lastPush.ok) {
      const why = pushFailureSummary(lastPush);
      const detail = `${state.count} commit${state.count === 1 ? "" : "s"} not pushed${why ? `. The last push failed: ${why}` : ""}`;
      return row({ ...base, status: "needs-you", detail });
    }

    const pushDelaySec = homePushDelaySec();
    // Bounded below as well as above: a committer date is whatever clock
    // wrote it, so a skewed one lands in the future, and an upper bound
    // alone would read that as freshly queued until the skew runs out.
    const ageMs = state.committedAt === null ? null : Date.now() - state.committedAt.getTime();
    const withinPushWindow = ageMs !== null && ageMs >= 0 && ageMs <= pushDelaySec * 1000 + HOME_PUSH_GRACE_MS;
    if (withinPushWindow) {
      return row({ ...base, status: "ready", detail: `${state.count} commit${state.count === 1 ? "" : "s"} waiting to back up; pushes within about ${pushDelaySec} seconds` });
    }
    // Outside the push window with no recorded failure: the daemon isn't
    // doing what it said it would, which is a real alarm again.
    return row({ ...base, status: "needs-you", detail: `${state.count} commit${state.count === 1 ? "" : "s"} not pushed, and the backup should have run by now` });
  }

  // `state.committedAt` is the tracking ref tip's COMMITTER date, not a push
  // time — a week-old commit pushed five minutes ago would read "last pushed
  // 7d ago". Only the daemon's record carries a real push timestamp, so the
  // wording changes with the evidence rather than overstating it.
  if (lastPush?.ok) return row({ ...base, status: "ready", detail: `Backed up, last pushed ${relativeWhen(new Date(lastPush.at))}` });
  return row({ ...base, status: "ready", detail: `Backed up, last commit ${relativeWhen(state.committedAt)}` });
}

/**
 * Opens `team.sync`'s detail when every problem is a clone that has yet to
 * pull, the one state `verify` re-reads through. Anchored at the start of the
 * detail, which no interpolated slug or git stderr can precede, so the two
 * other things that reach a detail cannot forge or trip it.
 */
const FIRST_PULL_PENDING = "Waiting for a first pull";

export function isTeamSyncFirstPullPending(detail: string): boolean {
  return detail.startsWith(`${FIRST_PULL_PENDING}: `);
}

/** Every clone's daemon-side sync state in one row: a joiner who cannot decrypt is almost always a clone that has not pulled the owner's recipients yet. */
export async function teamSyncRow(
  slugs: string[],
  readStatus: () => Promise<TeamSnapshotEntry[] | null>,
  now: () => number,
  pullIntervalSec: number,
  enabled = true,
): Promise<Row | null> {
  if (slugs.length === 0) return null;
  const base = {
    id: "team.sync",
    kind: "tool" as const,
    title: "Team sync",
    why: "Your team clone pulls the roster, recipients and packs on a timer and pushes your own team edits; this is whether that is keeping up.",
    required: false,
    optionalNote: "Works without this; `rt team pull` and `rt team publish` do the same by hand.",
    recheck: "on-activate" as const,
  };
  // Ahead of the daemon read: the supervisor stops every instance while the
  // setting is off, so the status list would be empty for the same reason a
  // clone with no origin is, and every clone would read as unwatched forever.
  if (!enabled) {
    return row({ ...base, status: "ready", detail: "Off: team sync is disabled in settings, so clones move only when you run rt team pull or rt team publish" });
  }

  const entries = await readStatus();
  if (entries === null) return row({ ...base, status: "missing", detail: "The rt daemon is not running. Team clones sync once it is" });

  const staleMs = clampPullIntervalSec(pullIntervalSec) * 2 * 1000;
  const problems: string[] = [];
  const neverPulled: string[] = [];
  for (const slug of slugs) {
    const e = entries.find((x) => x.slug === slug);
    if (!e) {
      problems.push(`${slug}: not watched (it has no origin remote)`);
      continue;
    }
    const stray = e.unownedDirty ?? [];
    if (stray.length > 0) {
      const files = stray.join(", ");
      problems.push(e.lastPullSkipped
        ? `${slug}: a pull stopped on a change that is not yours to push: ${files}. Undo the change, then pull again`
        : `${slug}: changed on this Mac but not yours to push: ${files}. Undo the change, or ask who owns it to make it`);
      continue;
    }
    if (e.conflicted) {
      // A pull-only clone cannot publish, so telling one to "rt team publish by hand" is an
      // instruction it will refuse (team-pull-only) the moment it tries. `=== true` rather than
      // truthy: a fixture or a pre-Task-6 entry missing the field must read as a pushing clone.
      const remedy = e.pullOnly === true ? "reset it to origin or ask an org admin" : "rebase it and run rt team publish";
      problems.push(`${slug}: a rebase conflict (${e.conflicted.detail}); ${remedy}`);
      continue;
    }
    // A pull-only clone's own failure mode: a fast-forward it refused. rt never resets that for
    // the user (see the `pullOnly` field doc in home-snapshot.ts), it only names the
    // clone so the user can. `=== true` rather than truthy: a fixture or a pre-Task-6 entry
    // missing the field must read as a pushing clone, not a silent pull-only skip.
    //
    // Gated on lastPullError too, because a failed FETCH sets both fields: the engine stores
    // the stderr as lastPullError and returns it as a skip, whose detail pullNow then copies
    // into lastPullSkipped. Without this, a revoked token reads as "cannot fast-forward, reset
    // it to origin", which is both the wrong diagnosis and advice that cannot help.
    if (e.pullOnly === true && e.lastPullError == null && e.lastPullSkipped && !e.layoutHold) {
      problems.push(`${slug}: cannot fast-forward (${e.lastPullSkipped}); reset it to origin or ask an org admin`);
      continue;
    }
    // Both fields come off the same redactCredentials(stderr) shape in the
    // engine, so "" is reachable for either; tested against null/undefined,
    // never a truthiness check `""` would fail past.
    //
    // A pull-only clone never pushes, so it has no push to fail; skip only
    // THIS check for it. Every check below (fetch failure, never-pulled, staleness) still applies
    // to a pull-only clone exactly as much as a pushing one: it fetches on the same timer, and a
    // broken fetch (expired token, revoked access) must not read as "ready" just because the
    // clone never pushes.
    if (e.pullOnly !== true && e.lastPushError != null) {
      problems.push(`${slug}: pushes are failing: ${e.lastPushError || "push failed"}`);
      continue;
    }
    if (e.lastPullError != null) {
      problems.push(`${slug}: fetches are failing: ${e.lastPullError || "fetch failed"}`);
      continue;
    }
    if (e.lastPullAt === 0) {
      neverPulled.push(slug);
      problems.push(`${slug}: not pulled yet`);
      continue;
    }
    if (now() - e.lastPullAt > staleMs) {
      problems.push(`${slug}: last pulled ${Math.round((now() - e.lastPullAt) / 60_000)} minutes ago`);
    }
  }
  const problemDetail = problems.length === 0 ? null : neverPulled.length === problems.length ? `${FIRST_PULL_PENDING}: ${neverPulled.join(", ")}` : problems.join("; ");
  // A held marketplace can be what makes a rebase refuse or a push bounce, so the hold leads.
  const held = slugs.filter((slug) => (entries.find((x) => x.slug === slug)?.heldBack ?? []).length > 0);
  if (held.length > 0) {
    const action: Action = { type: "steps", label: "Show steps…", steps: held.map((slug) => `Run: rt team publish --team ${slug}`) };
    const holds = held.map((slug) => `${slug}: a new pack is not shared yet, so its marketplace entry stays on this Mac`);
    return row({ ...base, status: "needs-you", detail: [...holds, ...(problemDetail ? [problemDetail] : [])].join("; "), action });
  }
  if (problemDetail !== null) return row({ ...base, status: "needs-you", detail: problemDetail, action: RECHECK_ACTION });

  // A pull skipped every tick (a dirty src/ refusing the rebase) is not a
  // failure, but it is why a member's store edits are not moving; say so
  // without changing the status.
  const skips = slugs.map((slug) => entries.find((x) => x.slug === slug)).map((e) => (e?.layoutHold ? undefined : e?.lastPullSkipped)).filter((d): d is string => !!d);
  const pullOnlySlugs = slugs.filter((slug) => entries.find((x) => x.slug === slug)?.pullOnly === true);
  const pullOnlyNote = pullOnlySlugs.length ? `. Pull-only, never pushes: ${pullOnlySlugs.join(", ")}` : "";
  const detail = `${slugs.length} clone${slugs.length === 1 ? "" : "s"} in sync${pullOnlyNote}${skips.length ? `. Last pull skipped: ${skips.join("; ")}` : ""}`;
  return row({ ...base, status: "ready", detail });
}

/** A machine with more than one team zone: `rt team join` and `rt team create` refuse to make one, so this is a zone that predates the refusal or was cloned by hand. */
export const ONE_TEAM_ROW_ID = "team.one-per-machine";

export function oneTeamRow(slugs: string[]): Row | null {
  if (slugs.length < 2) return null;
  const zones = [...slugs].sort();
  return row({
    id: ONE_TEAM_ROW_ID,
    kind: "tool",
    title: "One team per machine",
    why: "Team settings from every zone are folded together, so a second team silently overrides the first in every app.",
    required: false,
    status: "needs-you",
    detail: `this machine has ${zones.length} team zones (${zones.join(", ")}); ${ONE_TEAM_RULE}. Remove the extra zone, or wait for multi-team support.`,
    action: {
      type: "steps",
      label: "Show steps…",
      steps: [
        `Pick the one team this machine is for: ${zones.join(", ")}`,
        "Move every other org's folder out of ~/.mattstack/orgs",
        "Run: rt setup status",
      ],
    },
    recheck: "on-activate",
  });
}

/** The org clone's folder is its identity, and the marker inside must agree. A marked clone still under the old teams root has not been moved by the org.folder converge step. */
export const ORG_FOLDER_ROW_ID = "org.folder";

const ORG_FOLDER_CONVERGE_ACTION: Action = { type: "steps", label: "Show steps…", steps: ["Run: rt setup update --force"] };

export function orgFolderRow(p: Probes, orgs: string[]): Row | null {
  const legacyRoot = join(p.home, ".mattstack", "teams");
  const orgsRoot = orgsDirUnder(p.home);
  // discoverOrgs lists only clones with an org settings file; a clone still on the one-team layout has none, and its folder may still disagree with its marker.
  const folders = [...new Set([...orgs, ...p.readDir(orgsRoot).filter((name) => p.exists(join(orgsRoot, name, ".git", "config")))])].sort();
  const legacy = p.readDir(legacyRoot).flatMap((folder) => {
    const org = markerOrg(p, join(legacyRoot, folder));
    return org === null ? [] : [{ folder, org }];
  });
  if (folders.length === 0 && legacy.length === 0) return null;
  const mismatched = folders.flatMap((folder) => {
    const org = markerOrg(p, orgDirUnder(p.home, folder));
    return org !== null && org !== folder ? [{ folder, org }] : [];
  });
  const base = {
    id: ORG_FOLDER_ROW_ID,
    kind: "tool" as const,
    title: "Org folder",
    why: "rt reads the org clone from ~/.mattstack/orgs/<org>, and the folder name must match the org the clone's marker names.",
    required: false,
    recheck: "on-activate" as const,
  };
  if (mismatched.length > 0) {
    const detail = mismatched
      .map((m) => `the clone at ~/.mattstack/orgs/${m.folder} holds the ${m.org} org, so it belongs at ~/.mattstack/orgs/${m.org}`)
      .join("; ");
    return row({ ...base, status: "error", detail, action: ORG_FOLDER_CONVERGE_ACTION });
  }
  const inBoth = legacy.filter((l) => folders.includes(l.org));
  if (inBoth.length > 0) {
    const where = inBoth.map((l) => `the ${l.org} org sits in both ~/.mattstack/orgs/${l.org} and ~/.mattstack/teams/${l.folder}`).join("; ");
    return row({ ...base, status: "error", detail: `${where}. Move the old copy aside.` });
  }
  if (legacy.length > 0) {
    return row({
      ...base,
      status: "needs-you",
      detail: `your org has not moved yet: ${legacy.map((l) => l.folder).join(", ")} still sits under ~/.mattstack/teams`,
      action: ORG_FOLDER_CONVERGE_ACTION,
    });
  }
  return row({ ...base, status: "ready", detail: `${folders.join(", ")} under ~/.mattstack/orgs` });
}

export const ORG_LAYOUT_ROW_ID = "org.layout";
const UPDATE_APP_ACTION: Action = { type: "steps", label: "Show steps…", steps: ["Update mattstack from its menu bar icon, then reopen Setup status"] };

/** The org's layout against what this rt reads. A clone still on the one-team layout waits for the admin's conversion, and one whose org moved its data to another branch waits for rt to switch it; one past this rt, or a daemon holding the pull on a newer layout, needs the app update. */
export async function orgLayoutRow(p: Probes, readStatus: () => Promise<TeamSnapshotEntry[] | null>): Promise<Row | null> {
  const state = orgLayoutState(p);
  if (state.kind === "none") return null;
  const base = {
    id: ORG_LAYOUT_ROW_ID,
    kind: "tool" as const,
    title: "Org layout",
    why: "The org repo says what shape its files are in, and rt reads the shapes it knows. A newer shape waits for an app update; an older one waits for the org to move.",
    required: false,
    recheck: "on-activate" as const,
  };
  const hold = (await readStatus())?.find((e) => e.slug === state.slug)?.layoutHold ?? null;
  if (hold && "moved" in hold) {
    // The same check the move makes, so the row never says "rt will switch it" about a clone the move will hold.
    const blocker = await moveBlocker(p, orgDirUnder(p.home, state.slug));
    if (blocker?.kind === "held") {
      const { detail, remedy } = heldCopy(blocker);
      return row({ ...base, status: "needs-you", detail: `Your org's data moved to the ${hold.moved} branch. ${detail}`, action: { type: "steps", label: "Show steps…", steps: [remedy] } });
    }
    if (blocker?.kind === "failed") return row({ ...base, status: "error", detail: `Your org's data moved to the ${hold.moved} branch, but rt could not read your copy of the org: ${blocker.log}` });
    return row({ ...base, status: "skipped", detail: holdSentence(hold) });
  }
  if (hold) return row({ ...base, status: "needs-you", detail: holdSentence(hold), action: UPDATE_APP_ACTION });
  if (state.kind === "waiting") {
    return state.layout > ORG_LAYOUT
      ? row({ ...base, status: "needs-you", detail: layoutSentence(state), action: UPDATE_APP_ACTION })
      : row({ ...base, status: "skipped", detail: layoutSentence(state) });
  }
  return row({ ...base, status: "ready", detail: `${state.slug} on layout ${state.layout}` });
}

export const ORG_SPARSE_ROW_ID = "org.sparse";

function teamList(teams: string[]): string {
  return teams.length === 1 ? teams[0]! : `${teams.slice(0, -1).join(", ")} and ${teams.at(-1)}`;
}

/** Team folders the clone still holds after this Mac's role left them, because they hold changes the narrowing would lose. */
export async function orgSparseRow(p: Probes): Promise<Row | null> {
  const state = orgLayoutState(p);
  if (state.kind === "none") return null;
  const base = {
    id: ORG_SPARSE_ROW_ID,
    kind: "tool" as const,
    title: "Team folders",
    why: "Your copy of the org holds only the team folders your role reaches. A folder you have left stays until its changes are published or discarded.",
    required: false,
    recheck: "on-activate" as const,
  };
  let kept: KeptTeam[];
  try {
    kept = await keptTeams(p, orgDirUnder(p.home, state.slug), state.slug);
  } catch (err) {
    return row({ ...base, status: "error", detail: `rt could not read which team folders your copy holds: ${err instanceof Error ? err.message : String(err)}` });
  }
  const changed = kept.filter((k) => !k.onlyIgnored).map((k) => k.team);
  const ignored = kept.filter((k) => k.onlyIgnored).map((k) => k.team);
  const sentences = [
    ...(changed.length ? [`You're no longer on ${teamList(changed)}, but your copy has changes there. Publish or discard them and rt removes the folder.`] : []),
    ...(ignored.length ? [`You're no longer on ${teamList(ignored)}, but your copy has files there rt would delete. Move or delete them and rt removes the folder.`] : []),
  ];
  if (sentences.length > 0) return row({ ...base, status: "needs-you", detail: sentences.join(" ") });
  return row({ ...base, status: "ready", detail: "Your copy holds only the teams you are on" });
}

export const ORG_UNPUBLISHED_PACKS_ROW_ID = "org.unpublished-packs";

const PACKS_GIT_TIMEOUT_MS = 15_000;

/**
 * Pack edits rt kept but never published: a zone the snapshot janitor saved
 * to a local ref that is still dirty, or one the daemon says is holding back
 * the pull. A saved zone that is clean again was published or thrown away.
 */
export async function orgUnpublishedPacksRow(p: Probes, readStatus: () => Promise<TeamSnapshotEntry[] | null>): Promise<Row | null> {
  const state = orgLayoutState(p);
  if (state.kind === "none") return null;
  const dir = orgDirUnder(p.home, state.slug);
  const base = {
    id: ORG_UNPUBLISHED_PACKS_ROW_ID,
    kind: "tool" as const,
    title: "Unpublished packs",
    why: "A pack reaches your teammates only when you publish it with rt skills sync. Until then its edits stay on this Mac, and rt keeps a copy of any left for hours so nothing is lost.",
    required: false,
    recheck: "on-activate" as const,
  };
  const git = (args: string[]) => p.exec(["git", "-C", dir, ...args], { timeoutMs: PACKS_GIT_TIMEOUT_MS });
  const refs = await git(["for-each-ref", "--format=%(refname) %(authordate:unix)", JANITOR_REF_PREFIX]);
  if (refs.code !== 0) return row({ ...base, status: "error", detail: `rt could not read the copies it saved of your pack edits: ${refs.stderr.trim() || "git for-each-ref failed"}` });

  const found: PackRef[] = [];
  const since = new Map<string, number | null>();
  for (const line of refs.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "")) {
    const [ref, at] = line.split(" ");
    const zone = zoneOfJanitorRef(ref!);
    if (zone === null) continue;
    const status = await git(["status", "--porcelain=v1", "-uall", "-z", "--", zone]);
    if (status.code !== 0) return row({ ...base, status: "error", detail: `rt could not read your changes under ${zone}: ${status.stderr.trim() || "git status failed"}` });
    const paths = parsePorcelainZ(status.stdout).flatMap((e) => (e.origPath ? [e.path, e.origPath] : [e.path]));
    const savedAt = Number(at) * 1000;
    for (const pack of packsInZone(zone, paths)) {
      found.push(pack);
      since.set(pack.name, Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null);
    }
  }
  const blocking = (await readStatus())?.find((e) => e.slug === state.slug)?.pullBlockedBy ?? [];
  for (const name of blocking) {
    if (since.has(name)) continue;
    found.push({ name, team: p.exists(join(dir, teamPackRel(name))) });
    since.set(name, null);
  }
  if (found.length === 0) return row({ ...base, status: "ready", detail: "No pack edits have waited unpublished for hours" });

  const packs = uniquePacks(found);
  const now = p.now().getTime();
  const sentences = packs.map((pack) => {
    const at = since.get(pack.name);
    return `The ${pack.name} pack has unpublished changes${at == null ? "" : ` from ${agoPhrase(at, now)}`}.`;
  });
  if (packs.some((pack) => since.get(pack.name) != null)) sentences.push("rt saved a copy on this Mac and published nothing.");
  const held = packs.filter((pack) => blocking.includes(pack.name));
  if (held.length > 0) sentences.push(`Your copy of the org is not taking updates until ${packPhrase(held)} ${held.length === 1 ? "is" : "are"} published or thrown away.`);
  return row({
    ...base,
    status: "needs-you",
    detail: sentences.join(" "),
    action: { type: "steps", label: "Show steps…", steps: packRemedySteps(packs) },
  });
}

export const ORG_BRANCH_ROW_ID = "org.branch";

/** Whether the daemon still auto-commits in this Mac's org clone: it does only on the data branch or a trial branch this Mac chose. */
export async function orgBranchRow(p: Probes): Promise<Row | null> {
  const state = orgLayoutState(p);
  if (state.kind === "none") return null;
  const dir = orgDirUnder(p.home, state.slug);
  const approved = approvedBranches(p, state.slug, dir);
  const branch = await checkedOutBranch(p, dir);
  const base = {
    id: ORG_BRANCH_ROW_ID,
    kind: "tool" as const,
    title: "Org branch",
    why: "rt saves your changes to the org automatically only on the org's data branch, or on a trial branch you chose.",
    required: false,
    recheck: "on-activate" as const,
  };
  if (branch !== null && approved.includes(branch)) return row({ ...base, status: "ready", detail: `Auto-commit follows ${branch}` });
  // rt team branch use refuses anyone but an org admin or owner, so a member is handed git's own switch back.
  const back = isOrgAdmin(roleFor(p, state.slug)) ? `rt team branch use ${approved[0]}` : `git -C ${shellQuote(dir)} switch ${shellQuote(approved[0]!)}`;
  return row({
    ...base,
    status: "needs-you",
    detail: `Auto-commit is paused: your copy of the org ${branch === null ? "has no branch checked out" : `is on ${branch}`}.`,
    action: { type: "steps", label: "Show steps…", steps: [back] },
  });
}

export const ORG_DATA_BRANCH_ROW_ID = "org.data-branch";
export const ORG_MAIN_ROW_ID = "org.main";

/** Whether the forge still has the org's data branch; every Mac checks, since any admin's copy can push it back. */
export async function orgDataBranchRow(p: Probes, check: typeof checkDataBranch = checkDataBranch): Promise<Row | null> {
  const state = orgLayoutState(p);
  if (state.kind === "none") return null;
  const result = await check(p, state.slug);
  if (result === null) return null;
  const base = {
    id: ORG_DATA_BRANCH_ROW_ID,
    kind: "tool" as const,
    title: "Org data branch",
    why: "The org's settings, roster, packs and secrets live on this branch. Every Mac's copy holds all of it, so an org admin can push it back if the forge loses it.",
    required: false,
    recheck: "on-activate" as const,
  };
  if (result.kind === "present") return row({ ...base, status: "ready", detail: `The ${result.branch} branch is on the forge` });
  if (result.kind === "unknown") return row({ ...base, status: "skipped", detail: "rt could not reach the forge to check the data branch, so it checks again next time" });
  const admin = isOrgAdmin(roleFor(p, state.slug));
  if (result.kind === "lost") {
    return row({ ...base, status: "needs-you", detail: `The org's data branch is gone from the forge, and your copy does not have it either.`, action: { type: "steps", label: "Show steps…", steps: ["Ask an org admin whose copy has it to run rt team restore-data-branch"] } });
  }
  return row({
    ...base,
    status: "needs-you",
    detail: `${GONE_SENTENCE}.`,
    action: { type: "steps", label: "Show steps…", steps: admin ? ["rt team restore-data-branch"] : ["Ask an org admin to run rt team restore-data-branch"] },
  });
}

/** On an admin's Mac: whether `main` holds org files besides the pointer, which a merge of the data branch leaves there. */
export async function orgMainRow(p: Probes, check: typeof checkMainForOrgData = checkMainForOrgData): Promise<Row | null> {
  const state = orgLayoutState(p);
  if (state.kind === "none" || !isOrgAdmin(roleFor(p, state.slug))) return null;
  const result = await check(p, state.slug);
  if (result === null) return null;
  const base = {
    id: ORG_MAIN_ROW_ID,
    kind: "tool" as const,
    title: "Org files on main",
    why: "main belongs to the repo's developers and keeps only the org's .mattstack.jsonc pointer. The org's data stays on its own branch.",
    required: false,
    recheck: "on-activate" as const,
  };
  if (result.kind === "clean") return row({ ...base, status: "ready", detail: "main holds only the org's pointer" });
  if (result.kind === "unknown") return row({ ...base, status: "skipped", detail: "rt could not read main to check it, so it checks again next time" });
  const shown = result.files.slice(0, 3).join(", ");
  const more = result.files.length > 3 ? ` and ${result.files.length - 3} more` : "";
  return row({
    ...base,
    status: "needs-you",
    detail: `${MERGED_SENTENCE}. main now holds ${shown}${more}.`,
    action: {
      type: "steps",
      label: "Show steps…",
      steps: ["On main, find the commit that merged the org's data branch", "Revert it (git revert -m 1 <that commit>) and push main", "Leave .mattstack.jsonc as the only org file on main"],
    },
  });
}

// ─── entry point ────────────────────────────────────────────────────────────

function readTeamSnapshotSettings(): TeamSnapshotSettings | undefined {
  return getSetting<TeamSnapshotSettings>("rt.teamSnapshot").value;
}

export async function readTeamSnapshotStatus(p: Probes): Promise<TeamSnapshotEntry[] | null> {
  const res = await p.daemon("team:snapshot-status");
  if (!res || !res.ok) return null;
  return res.data as TeamSnapshotEntry[];
}

export async function rtHealthRows(
  p: Probes,
  opts: { ci: boolean },
  readSnapshotSettings: () => TeamSnapshotSettings | undefined = readTeamSnapshotSettings,
): Promise<Row[]> {
  // The settings read resolves the ambient HOME, and `buildGroup` turns a
  // throw here into one group-error row that replaces every row below, so it
  // stays behind the only condition that needs it.
  const slugs = discoverOrgs(p);
  const oneTeam = oneTeamRow(slugs);
  const orgFolder = orgFolderRow(p, slugs);
  const layout = orgLayoutState(p);
  const syncSlugs = layout.kind === "waiting" && !slugs.includes(layout.slug) ? [...slugs, layout.slug] : slugs;
  let statusRead: Promise<TeamSnapshotEntry[] | null> | null = null;
  const readStatus = () => (statusRead ??= readTeamSnapshotStatus(p));
  let teamSync: Row | null = null;
  if (syncSlugs.length > 0) {
    const settings = readSnapshotSettings();
    teamSync = await teamSyncRow(
      syncSlugs,
      readStatus,
      () => p.now().getTime(),
      settings?.pullIntervalSec ?? PULL_INTERVAL_FALLBACK_SEC,
      settings?.enabled !== false,
    );
  }

  const orgLayout = await orgLayoutRow(p, readStatus);
  const orgSparse = await orgSparseRow(p);
  const orgBranch = await orgBranchRow(p);
  const orgDataBranch = opts.ci ? null : await orgDataBranchRow(p);
  const orgMain = opts.ci ? null : await orgMainRow(p);
  const unpublishedPacks = await orgUnpublishedPacksRow(p, readStatus);

  return [
    await rtRow(p),
    rtLinkRow(p),
    legacyDirsRow(),
    await interceptsRow(p),
    await appRow(p),
    vsixRow(p),
    extensionRow(p),
    shellRow(p),
    await daemonRow(p, opts),
    await flavorRow(p),
    await homeBackupRow(join(p.home, ".mattstack", "user"), p.exec),
    ...(teamSync ? [teamSync] : []),
    ...(oneTeam ? [oneTeam] : []),
    ...(orgFolder ? [orgFolder] : []),
    ...(orgLayout ? [orgLayout] : []),
    ...(orgSparse ? [orgSparse] : []),
    ...(orgBranch ? [orgBranch] : []),
    ...(orgDataBranch ? [orgDataBranch] : []),
    ...(orgMain ? [orgMain] : []),
    ...(unpublishedPacks ? [unpublishedPacks] : []),
  ];
}
