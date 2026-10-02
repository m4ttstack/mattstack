/**
 * rt home — the git-backed ~/.mattstack/user personal repo, plus per-machine
 * provisioning of the ~/.mattstack tree around it.
 *
 *   rt home init [--dry-run] [--url <remote>] [--profile <key>] [--new-profile] [--no-materialize]
 *                                                     print, then run, the provisioning plan
 *   rt home key export                          print the age private key once, for a password manager
 *   rt home key import [--stdin] [--force]      bring an external age key into the keychain
 *   rt home snapshot [--status]                       run (or report on) the auto-commit daemon
 *   rt home claim <zone> [--owner] [--note] [--force]  tell the daemon to leave a path alone
 *   rt home release <zone>                             let the daemon resume auto-committing a path
 *
 * `init` gathers state, prints the plan from lib/home/init-plan.ts, and
 * (unless --dry-run) runs it through lib/home/init-exec.ts's injected seam.
 * On a fresh machine (no ~/.mattstack/machine-key yet) it also resolves
 * which `user/local/<key>/` profile to adopt or create — see
 * `chooseMachineProfile` in lib/home/init-plan.ts and the "machine profile
 * picker" section of `homeInit` below. `--profile`/`--new-profile` are only
 * meaningful on that fresh-machine path; passing either once machine-key is
 * already pinned is refused.
 * `key export`/`key import` delegate to lib/home/age-key.ts.
 * `snapshot`/`snapshot --status` are a thin round-trip to the daemon's
 * `home:snapshot`/`home:snapshot-status` handlers (lib/daemon/handlers/home.ts).
 * `claim`/`release` write user/snapshot-owners.jsonc directly via
 * lib/home/snapshot-owners.ts — no daemon round trip — the daemon picks up
 * the change on its next cycle like any other tracked file. A zone is
 * either a directory ("prefs/", or just "prefs" — claims everything under
 * it) or a single file ("scripts/deploy.sh" — claims exactly that path,
 * nothing else): `claim` decides which by checking whether the path is
 * currently a real file on disk. `claim` on a zone already claimed by a
 * DIFFERENT owner refuses unless `--force`; `release` prints who it
 * released, or says so plainly when there was nothing to release.
 */

import { existsSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { isCompiledRt } from "../lib/rt-self.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { openStep, type StepHandle } from "../lib/ui/spawn.ts";
import { interactive } from "../lib/ui/gate.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
import { withoutUrls } from "../lib/team/redact.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { isSafeMachineKeySegment, machineKey, mattstackHome } from "../lib/rt-paths.ts";
import { resolveInitialMachineKey } from "../lib/home/machine-id.ts";
import {
  buildInitPlan,
  chooseMachineProfile,
  InvalidMachineKeyError,
  InvalidProfileKeyError,
  ProfileChoiceRequiredError,
  ProfileNameCollisionError,
  STATE_DIR_NAMES,
  UnknownProfileFlagError,
  type ChooseMachineProfileResult,
  type HomeState,
  type InitPlan,
  type InitStep,
} from "../lib/home/init-plan.ts";
import { createRealExecSeam, executeInitPlan, INIT_OUTPUT_CAPTION, INIT_STEP_FAILED, type ExecSeam, type InitResult } from "../lib/home/init-exec.ts";
import {
  AgeKeyAbsentError,
  createRealAgeKeySeam,
  ensureAgeKey,
  importAgeKey,
  keyExport,
  renderSopsYaml,
  sopsYamlRecipient,
  type AgeKeySeam,
} from "../lib/home/age-key.ts";
import { claimZone, InvalidZoneError, normalizeZone, readOwners, releaseZone, ZoneOwnedByOthersError, type ZoneKind } from "../lib/home/snapshot-owners.ts";
import { promptSecret, type PromptIO } from "../lib/prompt-secret.ts";
import { daemonQuery, type DaemonResponse } from "../lib/daemon-client.ts";
import type { SnapshotResult, SnapshotStatus } from "../lib/daemon/home-snapshot.ts";
import {
  planMaterialize,
  runMaterialize,
  RT_OWN_STEP_KINDS,
  type MaterializeEnv,
  type MaterializeExecSeam,
  type MaterializeResult,
  type MaterializeStep,
} from "../lib/home/materialize.ts";
import { runCapture } from "../lib/subprocess.ts";
import { loadRepoIndex } from "../lib/daemon/repo-index.ts";
import { loadMachineRepoTracking } from "../lib/repo-tracking.ts";
import { isDaemonInstalled } from "../lib/daemon-config.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import { readIntent as readIntentFromDisk, type SetupIntent } from "../lib/setup/intent.ts";
import { deckHelperLabel } from "../lib/setup/need.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import { processFlavor } from "../lib/flavor.ts";

export interface HomeProbes {
  isGitRepo(dir: string): boolean;
  exists(path: string): boolean;
  /** The symlink's target, or null when `path` is absent or not a symlink. */
  readSymlinkTarget(path: string): string | null;
  /** True when `path` exists and is a regular file (not a directory, not a symlink-to-dir) — decides whether `rt home claim` writes a file zone or a dir zone. */
  isFile(path: string): boolean;
  /** Directory names directly under `userLocalDir` that carry settings.local.jsonc — the adoptable machine profiles. Empty (not thrown) when the dir doesn't exist yet. */
  listProfiles(userLocalDir: string): string[];
}

export interface SopsYamlSeam {
  read(path: string): string | null;
  write(path: string, content: string): void;
}

function defaultSopsYamlSeam(): SopsYamlSeam {
  return {
    read: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    write: (path, content) => writeFileSync(path, content),
  };
}

function defaultProbes(): HomeProbes {
  return {
    isGitRepo: (dir) => existsSync(join(dir, ".git")),
    exists: (path) => existsSync(path),
    readSymlinkTarget: (path) => {
      try {
        return readlinkSync(path);
      } catch {
        return null;
      }
    },
    isFile: (path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    listProfiles: (userLocalDir) => {
      let entries: string[];
      try {
        entries = readdirSync(userLocalDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        return [];
      }
      return entries.filter((name) => existsSync(join(userLocalDir, name, "settings.local.jsonc")));
    },
  };
}

const SKILLS_SYMLINK_TARGET = join("user", "skills.jsonc");

export function gatherHomeState(home: string, probes: HomeProbes, machineKeyValue: string): HomeState {
  const userRepoPresent = probes.isGitRepo(join(home, "user"));
  const machineKeyFilePresent = probes.exists(join(home, "machine-key"));
  const profileDirPresent = probes.exists(join(home, "user", "local", machineKeyValue));

  const skillsPath = join(home, "skills.jsonc");
  const symlinkTarget = probes.readSymlinkTarget(skillsPath);
  const skillsSymlinkPresent = symlinkTarget === SKILLS_SYMLINK_TARGET;
  const skillsSymlinkBlocked = symlinkTarget === null && probes.exists(skillsPath);

  const stateDirsMissing = STATE_DIR_NAMES.filter((name) => !probes.exists(join(home, name)));

  return {
    userRepoPresent,
    machineKeyFilePresent,
    profileDirPresent,
    skillsSymlinkPresent,
    skillsSymlinkBlocked,
    stateDirsMissing,
  };
}

function describeStep(step: InitStep): { title: string; hint?: string } {
  switch (step.kind) {
    case "ensureStateDirs":
      return { title: "Create the folders rt keeps its state in", hint: step.dirs.join(", ") };
    case "cloneUserRepo":
      return { title: "Clone your home repo", hint: step.url };
    case "initUserRepo":
      return { title: "Start a home repo on this Mac only", hint: "no remote" };
    case "commitInitialUserRepo":
      return { title: "Commit the first version of your home repo" };
    case "writeGitignore":
      return { title: "Add the home repo's ignore file" };
    case "writeOwners":
      return { title: "Add the list of paths you commit by hand" };
    case "writeMachineKey":
      return { title: "Name this Mac", hint: step.key };
    case "ensureProfileDir":
      return { title: "Create this Mac's profile", hint: step.key };
    case "writeSkillsSymlink":
      return { title: "Link your skills list into your home repo" };
  }
}

/** Where a stage ended. `failed` ends its rt-ui step failing; any other status ends it in place, in that state. */
interface StageEnding {
  status: Exclude<RenderStatus, "running">;
  title: string;
  hint?: string;
}

/**
 * One rt-ui step per stage a person watches: its progress is the step's
 * sub-line (cleared when the step ends done, kept when it fails) and goes to
 * the CLI log. Off a terminal, or when the helper cannot start or dies, the
 * same ending prints as one plain line.
 */
async function stage(title: string, task: (sub: (text: string) => void) => Promise<StageEnding>): Promise<StageEnding> {
  let step: StepHandle | null = null;
  if (interactive()) {
    try {
      step = openStep(title);
    } catch {
      step = null;
    }
  }
  const sub = (text: string) => {
    step?.sub(text);
    // A clone url can carry a token: neither --url nor RT_HOME_URL is checked for credentials.
    logCliEvent("debug", "home", withoutUrls(text));
  };
  let ending: StageEnding;
  try {
    ending = await task(sub);
  } catch (err) {
    if (step) await step.fail(title);
    throw err;
  }
  const painted =
    step === null
      ? false
      : ending.status === "failed"
        ? await step.fail(ending.title, ending.hint)
        : await step.done(ending.title, ending.hint, ending.status === "done" ? undefined : ending.status);
  if (!painted) out.print(out.line(ending.status, ending.title, ending.hint));
  return ending;
}

function failInit(failure: out.FailureInput, ...after: Block[]): never {
  out.fail(failure, ...after);
  process.exit(1);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What a child process said, under the failure: the title stays one clean line and the renderer strips its escapes. */
function childOutput(text: string): Block[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 ? [out.verbatim(lines, INIT_OUTPUT_CAPTION)] : [];
}

function planBlock(home: string, steps: InitStep[]): Block {
  return out.section(
    "Setting up your home folder",
    home,
    ...steps.map((step) => {
      const { title, hint } = describeStep(step);
      return out.line("pending", title, hint);
    }),
  );
}

function skillsLinkBlocked(home: string): Block[] {
  return [out.line("needs-you", "A file is in the way of your skills link", join(home, "skills.jsonc")), out.callout("fix", "Move it aside, then run this again")];
}

/** One stage per plan step, stopping at the first failure as executeInitPlan does. */
async function runInitSteps(steps: InitStep[], exec: ExecSeam): Promise<InitResult> {
  for (const step of steps) {
    const { title, hint } = describeStep(step);
    const outcome: { result?: InitResult } = {};
    await stage(title, async (sub) => {
      outcome.result = await executeInitPlan([step], exec, sub);
      return { status: outcome.result.ok ? "done" : "failed", title, hint };
    });
    if (outcome.result && !outcome.result.ok) return outcome.result;
  }
  return { ok: true };
}

/** Thrown by parseUrlArg for a `--url` with no usable value — never silently absorbed into a default or into the next flag. */
export class InvalidUrlArgError extends Error {}

function parseUrlArg(args: string[]): string | null {
  const idx = args.indexOf("--url");
  if (idx === -1) return null;

  const value = args[idx + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new InvalidUrlArgError("Give it the address of your home repo.");
  }
  return value;
}

/**
 * The precedence chain for which repo `rt home init` provisions: an explicit
 * `--url` beats the setup intent's `homeRepo` (set once, ahead of time, by
 * `create`/`join`, or under `restore.homeRepo` in restore mode — ignoring the
 * restore rung would provision a local-only repo that then squats the path
 * `home.restore` needs, unrecoverably), which beats `RT_HOME_URL` (a
 * per-invocation override).
 * `null` means no rung supplied one — a deliberate, first-class outcome, not
 * a fallback to any repo this operator never chose.
 */
export function resolveHomeUrl(
  args: string[],
  seams: { readIntent: () => SetupIntent | null; env: Record<string, string | undefined> },
): string | null {
  const fromFlag = parseUrlArg(args);
  if (fromFlag !== null) return fromFlag;
  const intent = seams.readIntent();
  const fromIntent = intent?.homeRepo ?? intent?.restore?.homeRepo;
  if (fromIntent) return fromIntent;
  // An exported-but-empty RT_HOME_URL is "unset", never a clone of "".
  return seams.env.RT_HOME_URL || null;
}

/** Thrown by parseProfileArg for a `--profile` with no usable value. */
export class InvalidProfileArgError extends Error {}

function parseProfileArg(args: string[]): string | undefined {
  const idx = args.indexOf("--profile");
  if (idx === -1) return undefined;

  const value = args[idx + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new InvalidProfileArgError("Give it the name of a machine profile.");
  }
  return value;
}

/** Seam for the interactive machine-profile prompt: real impl below uses filterableSelect (lib/pick-wrappers.ts); tests inject a fake so no real picker/TTY is ever touched. */
export interface MachineProfilePickerSeam {
  /** Returns the chosen key, or null when the user backed out (Esc/Ctrl-C). */
  pick(profiles: string[], hostnameSlug: string): Promise<string | null>;
}

export function createRealMachineProfilePickerSeam(): MachineProfilePickerSeam {
  return {
    async pick(profiles, hostnameSlug) {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      const options = [
        ...profiles.map((p) => ({ value: p, label: p })),
        { value: hostnameSlug, label: `new profile (${hostnameSlug})` },
      ];
      return filterableSelect({ message: "Pick a machine profile", options });
    },
  };
}

export type EnsureHomeAgeKeyResult = { ok: true } | { ok: false; failure: out.FailureInput };

/**
 * The sole mint site: `key export` (lib/home/age-key.ts:keyExport) refuses
 * to mint, precisely so a keychain-access error there can never be mistaken
 * for "no key yet". Idempotent (ensureAgeKey mints only on provable
 * absence), so it's safe to run on every init — including a fully-
 * provisioned machine, for a home repo that predates this step.
 *
 * Also (re)writes `.sops.yaml` whenever it's missing or its recipient
 * doesn't match the current key — the one place `rt secrets set` gets a
 * creation rule to encrypt against. A hand-edited file already carrying the
 * right recipient is left untouched. `.sops.yaml` is a TRACKED file, so a
 * write here needs a human commit — the snapshot daemon doesn't exist yet.
 *
 * EXCEPT when this call's key was JUST MINTED (readAgeKey found the
 * keychain provably empty) and an existing `.sops.yaml` already names a
 * DIFFERENT recipient: that recipient is what the just-cloned `user/secrets/*.json`
 * were actually encrypted to, on some other machine. Rewriting here would
 * silently orphan them (undecryptable on this machine) and, once committed,
 * break every other machine still holding the real key — so this refuses
 * instead, leaving the file untouched. A rotation on a machine that ALREADY
 * held the right key (not minted) is unchanged: that's a deliberate rotation,
 * not a fresh machine guessing.
 *
 * Called only after the init plan (which clones user/ when it's missing)
 * has run to completion, so user/ always already exists by the time this
 * writes into it.
 */
async function ensureHomeAgeKey(
  seams: AgeKeySeam,
  sopsYamlSeam: SopsYamlSeam = defaultSopsYamlSeam(),
): Promise<EnsureHomeAgeKeyResult> {
  const { publicKey, minted } = await ensureAgeKey(seams);

  // Lives under user/ (not the repo root): sops matches path_regex cwd-relative
  // and every sops spawn pins cwd to <mattstackHome>/user (store.ts), so
  // .sops.yaml must sit there too for that discovery to find it.
  const userDir = join(mattstackHome(), "user");
  const sopsYamlPath = join(userDir, ".sops.yaml");
  const existing = sopsYamlSeam.read(sopsYamlPath);
  const existingRecipient = existing === null ? null : sopsYamlRecipient(existing);
  const mismatched = existing !== null && existingRecipient !== publicKey;

  if (mismatched && minted) {
    return {
      ok: false,
      failure: {
        title: "This Mac's key cannot open your secrets",
        why: `They are locked to ${existingRecipient ?? "a key rt does not recognise"}. A new key was already minted and stored for this Mac, and it is not the one they need.`,
        next: out.cmd("rt home key import --force"),
      },
    };
  }

  // RULED: never silently rewrite .sops.yaml on a recipient mismatch, even
  // for a key this machine already held before this call (not just-minted).
  // Rewriting would orphan every secret still encrypted to the recipient
  // .sops.yaml currently names — that's either a wrong-key accident (fixed
  // by importing the right key) or a deliberate rotation (a ceremony a
  // human must run by hand, not something init silently does for them).
  if (mismatched) {
    return {
      ok: false,
      failure: {
        title: "This Mac's key does not match your secrets",
        why: `They are locked to ${truncateKey(existingRecipient ?? "a key rt does not recognise")}, and this Mac holds ${truncateKey(publicKey)}. rt will not change which key they are locked to by itself.`,
        next: out.cmd("rt home key import --force"),
        details: "To change the key on purpose is a deliberate ceremony: rewrite the recipient in your home repo by hand, then save each secret again with rt secrets set.",
      },
    };
  }

  if (existing === null) {
    sopsYamlSeam.write(sopsYamlPath, renderSopsYaml(publicKey));
    out.print(
      out.line("done", "Set up secrets for your home repo", "this adds one tracked file"),
      out.callout("next", "Commit it:"),
      out.copy(`git -C ${userDir} add .sops.yaml && git -C ${userDir} commit -m "home: sops recipient"`),
    );
  }

  out.print(out.line("done", "This Mac's secrets key is ready", truncateKey(publicKey)), out.callout("next", ["Save it to your password manager: ", out.cmd("rt home key export")]));

  return { ok: true };
}

/** buildInitPlan's only checked failure (InvalidMachineKeyError) turned into the CLI's print-and-exit(1) — shared by every one of homeInit's three plan builds so the three don't drift. */
function planOrExit(state: HomeState, config: { url: string | null; machineKey: string }): InitPlan {
  try {
    return buildInitPlan(state, config);
  } catch (err) {
    if (err instanceof InvalidMachineKeyError) {
      failInit({ title: "rt cannot use that name for this Mac", why: err.message });
    }
    throw err;
  }
}

// ─── materialize (init's last phase) ────────────────────────────────────────

function defaultMaterializeExec(): MaterializeExecSeam {
  return { run: (argv, opts) => runCapture(argv, { stderr: "pipe", ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) }) };
}

/**
 * The argv[0] rt-own materialize steps self-invoke. From source,
 * `process.execPath` is `bun` itself, not rt, so this returns the bare "rt"
 * name instead: on PATH or not, that is the honest dev-mode failure, not a
 * silent `bun intercept install`.
 */
function rtSelfBin(): string {
  return isCompiledRt() ? process.execPath : "rt";
}

/** Reads `~/.mattstack/deck/api.json` (port, pid) and probes deck's own `/healthz`. Injectable so tests never touch a real file or the network. */
export interface DeckHealthProbe {
  /** The port deck is (supposedly) listening on, or null if the file is absent/corrupt. Never throws. */
  readPort(): number | null;
  /** True only on a 200 from `/healthz`. Never throws — a refused connection, timeout, or non-2xx all resolve false. */
  checkHealthz(port: number): Promise<boolean>;
}

const DECK_HEALTHZ_TIMEOUT_MS = 1_500;

function defaultDeckHealthProbe(): DeckHealthProbe {
  return {
    readPort(): number | null {
      try {
        const raw = JSON.parse(readFileSync(join(mattstackHome(), "deck", "api.json"), "utf8"));
        return typeof raw.port === "number" ? raw.port : null;
      } catch {
        return null;
      }
    },
    async checkHealthz(port: number): Promise<boolean> {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(DECK_HEALTHZ_TIMEOUT_MS) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

/** `deckSetup` re-bootstraps deck under launchd — restarts the live proxy, blipping every `*.localhost` app — so this must be checked before planning it, not run unconditionally. */
export async function probeDeckHealthy(probe: DeckHealthProbe): Promise<boolean> {
  const port = probe.readPort();
  if (port === null) return false;
  return probe.checkHealthz(port);
}

/**
 * `which deck`, deck's own health, the repo index, `rt.repoTracking`, and
 * the daemon-install marker. All read-only; a throw here is caught by
 * homeInit's materialize try/catch and reported as a non-rt-own failure,
 * never a crash.
 */
export async function defaultMaterializeEnv(
  exec: MaterializeExecSeam,
  deckHealth: DeckHealthProbe = defaultDeckHealthProbe(),
  deckHelper: () => string | null = () => deckHelperLabel(processFlavor(), createRealProbes()),
): Promise<MaterializeEnv> {
  // Deliberately not run through STEP_TIMEOUT_MS (runMaterialize's steps) — a
  // plain `which` never blocks like `rt daemon install`'s tray poll does, so
  // it keeps runCapture's short default.
  const which = await exec.run(["which", "deck"]);
  const deckOnPath = which.exitCode === 0 && which.stdout.trim().length > 0;
  const deckHealthy = deckOnPath && (await probeDeckHealthy(deckHealth));

  const index = loadRepoIndex();
  const boardRepoPath = index["mr-board"] ?? null;

  const tracking = loadMachineRepoTracking();
  const trackedRepos = Object.keys(tracking)
    .sort()
    .map((name) => {
      const path = index[name] ?? "";
      return { name, path, present: path !== "" && existsSync(path) };
    });

  const helperLabel = deckOnPath && !deckHealthy ? deckHelper() : null;
  return { deckOnPath, deckHealthy, deckHelperLabel: helperLabel, boardRepoPath, daemonInstalled: isDaemonInstalled(), trackedRepos };
}

/** The plan row for a refresh step: what it is, and how a dry run expects it to end. */
function describeMaterializeStep(step: MaterializeStep): { title: string; status: StageEnding["status"]; hint?: string } {
  switch (step.kind) {
    case "rtInterceptInstall":
      return { title: "Set up rt's git intercept", status: "pending" };
    case "rtDaemonInstall":
      return { title: "Set up the rt daemon", status: "pending" };
    case "reportMissingRepos":
      return { title: "Some tracked repos are not on this Mac yet", status: "needs-you", hint: step.names.join(", ") };
    case "deckSetup":
      return { title: "Set up deck", status: "pending" };
    case "reportDeckHealthy":
      return { title: "Set up deck", status: "skipped", hint: "deck is already running well" };
    case "reportDeckUnhealthy":
      return { title: "Set up deck", status: "skipped", hint: "the app's deck helper owns deck" };
    case "boardSetup":
      return { title: "Set up mr-board", status: "needs-you", hint: "you run this one yourself" };
  }
}

/** A failed step is coral only when it is one rt owns: that is the only kind that fails the run. */
function refreshEnding(result: MaterializeResult): StageEnding {
  const { title, status, hint } = describeMaterializeStep(result.step);
  if (!result.ok) return { status: RT_OWN_STEP_KINDS.has(result.step.kind) ? "failed" : "warn", title };
  return { status: status === "pending" ? "done" : status, title, hint };
}

/** One stage per refresh step; every step runs whatever an earlier one did, as runMaterialize does. True when a step rt owns failed. */
async function runRefreshSteps(steps: MaterializeStep[], exec: MaterializeExecSeam, rtBin: string): Promise<boolean> {
  let rtOwnFailed = false;
  for (const step of steps) {
    const outcome: { result?: MaterializeResult } = {};
    await stage(describeMaterializeStep(step).title, async () => {
      [outcome.result] = await runMaterialize([step], exec, rtBin);
      return refreshEnding(outcome.result!);
    });
    const result = outcome.result!;
    // A sub-line clears when its step ends done, and this guidance must outlive the step.
    const detail = [result.ok ? "" : result.stderr, result.stdout, result.note].filter((text) => text !== "").flatMap((text) => text.split("\n"));
    if (detail.length > 0) out.print(out.verbatim(detail));
    if (!result.ok && RT_OWN_STEP_KINDS.has(step.kind)) rtOwnFailed = true;
  }
  return rtOwnFailed;
}

/**
 * `claude.marketplaces`/`claude.plugins` replay is the installer's job, not
 * init's. This only points at it when either resolves to a value, so a
 * machine with nothing configured stays silent.
 */
export function claudePluginsPointerMessage(marketplaces: unknown, plugins: unknown): string | null {
  if (marketplaces === undefined && plugins === undefined) return null;
  return "Your Claude plugin and marketplace settings are applied by the mattstack installer, not by rt home init. Run the installer again if this Mac needs them.";
}

function printClaudePluginsPointer(): void {
  const message = claudePluginsPointerMessage(getSetting<unknown>("claude.marketplaces").value, getSetting<unknown>("claude.plugins").value);
  if (message) out.print(out.paragraph(message));
}

export interface HomeInitSeams {
  probes?: HomeProbes;
  exec?: ExecSeam;
  ageKeySeam?: AgeKeySeam;
  sopsYamlSeam?: SopsYamlSeam;
  /**
   * Evaluated at call time, like every other default here — a real fs read
   * (~/.mattstack/machine-key), so tests inject a fixed value instead of
   * depending on the test-runner's actual hostname/override file. When the
   * machine-key file is absent this doubles as the hostname-slug fallback
   * the profile chooser below offers ("new profile (<this>)").
   */
  key?: string;
  pickerSeam?: MachineProfilePickerSeam;
  isInteractive?: () => boolean;
  /** Gathers the materialize phase's inputs (which deck, repo index, rt.repoTracking, daemon-install marker). Defaults to real reads; tests inject a fixed env instead of faking each underlying probe. */
  materializeEnv?: () => Promise<MaterializeEnv>;
  /** Runs each materialize step's subprocess. Defaults to a real `runCapture` wrap; tests inject a fake that never touches a real binary. */
  materializeExec?: MaterializeExecSeam;
  /** Defaults to a real read of ~/.mattstack/rt/setup-intent.json; tests inject a fixed value instead of writing that file for real. */
  readIntent?: () => SetupIntent | null;
  /** Defaults to `process.env` — resolveHomeUrl's RT_HOME_URL rung; tests inject a fixed value instead of depending on the ambient shell's environment. */
  env?: Record<string, string | undefined>;
}

export async function homeInit(args: string[], _ctx: CommandContext = {}, seams: HomeInitSeams = {}): Promise<void> {
  const probes = seams.probes ?? defaultProbes();
  const exec = seams.exec ?? createRealExecSeam(mattstackHome());
  const ageKeySeam = seams.ageKeySeam ?? createRealAgeKeySeam();
  const sopsYamlSeam = seams.sopsYamlSeam ?? defaultSopsYamlSeam();
  const key = seams.key ?? (await resolveInitialMachineKey(mattstackHome(), probes));
  const pickerSeam = seams.pickerSeam ?? createRealMachineProfilePickerSeam();
  const isInteractive = seams.isInteractive ?? (() => Boolean(process.stdin.isTTY));
  const materializeExec = seams.materializeExec ?? defaultMaterializeExec();
  const materializeEnv = seams.materializeEnv ?? (() => defaultMaterializeEnv(materializeExec));
  const readIntent =
    seams.readIntent ??
    (() =>
      readIntentFromDisk({
        readFile: (path) => {
          try {
            return readFileSync(path, "utf8");
          } catch {
            return null;
          }
        },
        // The OS home, not mattstackHome(): intentPath() appends `.mattstack`
        // itself, and every writer (setup, team create/join) passes Probes.home.
        home: process.env.HOME ?? homedir(),
      }));
  const env = seams.env ?? process.env;

  const dryRun = args.includes("--dry-run");
  const noMaterialize = args.includes("--no-materialize");
  const home = mattstackHome();

  let resolvedUrl: string | null;
  let profileFlag: string | undefined;
  try {
    resolvedUrl = resolveHomeUrl(args, { readIntent, env });
    profileFlag = parseProfileArg(args);
  } catch (err) {
    if (err instanceof InvalidUrlArgError) failInit(usageFailure("Which repo should rt clone?", "rt home init --url <remote>", err.message));
    if (err instanceof InvalidProfileArgError) failInit(usageFailure("Which machine profile?", "rt home init --profile <key>", err.message));
    throw err;
  }
  const newProfileFlag = args.includes("--new-profile");

  let state = gatherHomeState(home, probes, key);
  let chosenKey = key;

  // The profile list under user/local/ only exists once user/ is cloned, but
  // this machine's key (and thus which profile it should adopt) can only be
  // decided from that list — so a machine-key-less machine picks its key
  // AFTER the clone lands, never before. A machine that already has
  // machine-key written is already provisioned; the picker never runs for it.
  if (!state.machineKeyFilePresent) {
    if (!state.userRepoPresent) {
      if (dryRun) {
        const previewPlan = planOrExit(state, { url: resolvedUrl, machineKey: key });
        out.print(
          planBlock(home, previewPlan.steps),
          out.callout("note", `This Mac has no machine-key file yet, and its profiles are only known once the repo above is cloned, so "${key}" is a stand-in. Name the profile ahead of time to settle it.`),
          out.callout("next", out.cmd("rt home init --profile <key>")),
          // The refresh depends on what the clone lands, so it cannot be previewed from here; staying silent would let a fresh Mac's dry run imply provisioning is the whole story.
          ...(noMaterialize ? [] : [out.callout("note", "rt will also refresh what it generates from your settings. That plan can only be shown once your home repo is cloned.")]),
        );
        if (previewPlan.blocked === "skills-symlink-real-file") out.print(...skillsLinkBlocked(home));
        return;
      }

      // Phase 1: clone only. writeMachineKey/ensureProfileDir/writeSkillsSymlink
      // all wait for phase 2 (below) — the first two because the key isn't
      // chosen yet, the symlink just to keep this phase minimal and focused.
      const cloneOnlyState: HomeState = {
        ...state,
        machineKeyFilePresent: true,
        profileDirPresent: true,
        skillsSymlinkPresent: true,
        skillsSymlinkBlocked: false,
      };
      const clonePlan = planOrExit(cloneOnlyState, { url: resolvedUrl, machineKey: key });
      out.print(planBlock(home, clonePlan.steps));

      const cloneResult = await runInitSteps(clonePlan.steps, exec);
      if (!cloneResult.ok) failInit({ title: INIT_STEP_FAILED[cloneResult.failedStep] }, ...childOutput(cloneResult.stderr));

      // Known true from the steps that just succeeded, not re-probed: fake
      // probes in tests are static and wouldn't reflect the clone anyway,
      // and in production a fresh fs read here would just re-derive the
      // same facts the exec seam already confirmed.
      state = { ...state, userRepoPresent: true, stateDirsMissing: [] };
    }

    const userLocalDir = join(home, "user", "local");
    const profiles = probes.listProfiles(userLocalDir);

    let choice: ChooseMachineProfileResult;
    try {
      choice = chooseMachineProfile({
        profiles,
        hostnameSlug: key,
        flags: { profile: profileFlag, newProfile: newProfileFlag },
        interactive: isInteractive(),
      });
    } catch (err) {
      if (
        err instanceof UnknownProfileFlagError ||
        err instanceof ProfileChoiceRequiredError ||
        err instanceof ProfileNameCollisionError ||
        err instanceof InvalidProfileKeyError
      ) {
        const next =
          err instanceof UnknownProfileFlagError
            ? `rt home init --profile ${err.profile} --new-profile`
            : err instanceof ProfileNameCollisionError
              ? "rt home init --profile <name> --new-profile"
              : "rt home init --profile <key>";
        failInit({
          title: err instanceof ProfileChoiceRequiredError ? "Which machine profile should this Mac use?" : "That machine profile will not work",
          why: err.message,
          next: out.cmd(next),
        });
      }
      throw err;
    }

    if (choice.source === "prompt-needed") {
      if (dryRun) {
        out.print(
          out.line("needs-you", "This Mac needs a machine profile", `existing: ${profiles.join(", ")}`),
          out.callout("note", `A live run asks you to pick one, or to start a new one called ${key}.`),
          out.callout("next", out.cmd("rt home init --profile <key>")),
        );
        return;
      }
      const picked = await pickerSeam.pick(profiles, key);
      if (picked === null || !isSafeMachineKeySegment(picked)) {
        failInit({ title: "No machine profile was chosen", next: out.cmd("rt home init --profile <key>") });
      }
      chosenKey = picked;
    } else {
      chosenKey = choice.key;
    }

    state = { ...state, profileDirPresent: profiles.includes(chosenKey) };
  } else if (profileFlag !== undefined || newProfileFlag) {
    // --profile/--new-profile only make sense while this machine is still
    // choosing its FIRST profile. Once machine-key is pinned, silently
    // ignoring them would look like the flag worked (see: "fully
    // provisioned" printing on an already-keyed machine passed --profile
    // other-box) when nothing happened at all.
    refuse(
      "This Mac already has a machine profile",
      out.callout("why", `It is pinned to "${key}" in its machine-key file. Naming a profile only applies while a Mac is choosing its first one.`),
    );
  }

  const plan = planOrExit(state, { url: resolvedUrl, machineKey: chosenKey });

  // Env gathering is read-only (which deck, the repo index, rt.repoTracking,
  // the daemon-install marker) — safe to run under --dry-run, so the preview
  // below reflects what materialize would actually do instead of silently
  // omitting init's last phase. Gathered ONLY for dry-run, and only when the
  // plan isn't already blocked (the live run exits 1 before ever reaching
  // materialize on a blocked plan, so a preview there would promise
  // something that never happens). The live path below gathers its own
  // (possibly different, if state changed) env right before actually
  // running it. A throw here never aborts --dry-run: it's reported and
  // treated as "nothing to preview," same as --no-materialize.
  let materializeSteps: MaterializeStep[] = [];
  if (dryRun && !noMaterialize && !plan.blocked) {
    try {
      materializeSteps = planMaterialize(await materializeEnv());
    } catch (err) {
      out.print(out.line("warn", "rt could not preview what it would refresh", errorMessage(err)));
    }
  }

  if (plan.steps.length > 0) {
    out.print(planBlock(home, plan.steps));
  } else if (!plan.blocked && (dryRun ? materializeSteps.length === 0 : noMaterialize)) {
    // Live run: materialize always does at least rtInterceptInstall unless
    // --no-materialize was passed, so "nothing to do" would otherwise be
    // said one breath before materialize does something — dishonest.
    out.print(out.line("skipped", "Nothing to set up", "your home folder is already in place"));
  }

  if (plan.blocked === "skills-symlink-real-file") out.print(...skillsLinkBlocked(home));

  if (dryRun) {
    if (materializeSteps.length > 0) {
      const rows = materializeSteps.map((step) => {
        const { title, status, hint } = describeMaterializeStep(step);
        return out.line(status, title, hint);
      });
      out.print(out.section("rt would also refresh what it generates from your settings", undefined, ...rows));
    }
    return;
  }

  const result = await runInitSteps(plan.steps, exec);
  if (!result.ok) failInit({ title: INIT_STEP_FAILED[result.failedStep] }, ...childOutput(result.stderr));

  // Mint (or backfill) BEFORE the success line: printing success ahead of a
  // failed mint would tell the operator init worked while `rt secrets set`
  // still has no key or creation rule to encrypt against.
  const ageKeyResult = await ensureHomeAgeKey(ageKeySeam, sopsYamlSeam);
  if (!ageKeyResult.ok) failInit(ageKeyResult.failure);

  if (plan.blocked === "skills-symlink-real-file") {
    refuse(
      "Your home folder is set up, apart from your skills link",
      out.callout("why", `${join(home, "skills.jsonc")} is a real file, and rt will not overwrite it.`),
      out.callout("fix", "Move it aside, then run this again"),
    );
  }

  // Materialize is init's LAST phase, run on every non-dry-run invocation —
  // including an already-fully-provisioned machine — so re-derivable state
  // (PATH shims, daemon registration, each installed tool's own setup)
  // stays current without a separate command to remember to run. A throw
  // anywhere in here (env gathering, a step, printing) is caught and
  // reported as a non-rt-own failure: provisioning already succeeded above,
  // so this must never crash init to a bare exception after that.
  let materializeFailed = false;
  if (noMaterialize) {
    out.print(out.line("skipped", "Skipped the refresh of what rt generates from your settings"));
  } else {
    try {
      const env = await materializeEnv();
      materializeFailed = await runRefreshSteps(planMaterialize(env), materializeExec, rtSelfBin());
    } catch (err) {
      out.print(out.line("warn", "rt could not refresh what it generates from your settings", errorMessage(err)));
    }
  }

  try {
    printClaudePluginsPointer();
  } catch (err) {
    out.print(out.line("warn", "rt could not check your Claude plugin settings", errorMessage(err)));
  }

  // Checked BEFORE the success line — printing "provisioned" ahead of a
  // known rt-own materialize failure would tell the operator init fully
  // worked when a regenerated piece of rt's own state (PATH shims, daemon
  // registration) is known broken.
  if (materializeFailed) {
    failInit({ title: "rt could not refresh one of its own pieces", why: "The step marked failed above is one rt needs.", next: out.cmd("rt home init") });
  }

  out.print(out.line("done", "This Mac is set up", home));
}

/** rt declining by policy rather than failing: a refused line on stderr, never a failure block; `home` exits 1 either way. */
function refuse(title: string, ...callouts: Block[]): never {
  out.note(out.line("refused", title), ...callouts);
  process.exit(1);
}

export async function homeKeyExport(
  _args: string[],
  _ctx: CommandContext = {},
  seams: AgeKeySeam = createRealAgeKeySeam(),
): Promise<void> {
  out.payloadOnStdout();
  try {
    // The key and its header are a payload: a person pipes them to a
    // password manager, so they are never styled and nothing else joins them.
    await keyExport(seams, (text) => out.payload(`${text}\n`));
  } catch (err) {
    if (err instanceof AgeKeyAbsentError) {
      out.fail({ title: "This Mac has no secrets key yet", next: out.cmd("rt home init") });
      process.exit(1);
    }
    throw err;
  }
}

export interface AgeKeyInputSeam {
  fromStdin(): Promise<string>;
  fromPrompt(): Promise<string>;
}

/** `stream` is injectable so tests exercise the trimming behavior without touching the real process.stdin. */
export async function readStdinTrimmed(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/**
 * Both input paths must yield the same shape of value — a `--stdin` paste
 * and a typed-then-Enter prompt answer are otherwise indistinguishable to
 * `importAgeKey`, so both are trimmed here rather than one trimmed
 * (readStdinTrimmed) and the other not. `promptIO`, when passed, is forwarded
 * to `promptSecret` so tests can drive the prompt path without a real TTY.
 */
export function defaultAgeKeyInputSeam(promptIO?: PromptIO): AgeKeyInputSeam {
  return {
    fromStdin: () => readStdinTrimmed(),
    fromPrompt: () => promptSecret("Paste the age private key", promptIO).then((value) => value.trim()),
  };
}

/** First 12 chars + an ellipsis — enough to eyeball-match two recipients in a warning without printing the full key. */
function truncateKey(key: string): string {
  return `${key.slice(0, 12)}…`;
}

/**
 * The counterpart to `rt home init`'s mint-refusal: when a cloned repo's
 * secrets are encrypted to a key this machine doesn't hold, this is what
 * gets it in. Only THIS command's success writes the keychain item from
 * outside key material — `ensureAgeKey` mints, this imports; the two never
 * run against the same "no key yet" state for different reasons.
 *
 * The recipient check runs AFTER a successful import (not before) so the
 * refusal message can name the ACTUAL derived recipient of what was just
 * pasted, not a guess — a wrong paste that happens to parse still gets
 * caught here before the operator believes their secrets are decryptable.
 */
/** The unmistakable prefix of a pasted age private key — never a legitimate flag or value for anything else this command takes. */
const AGE_PRIVATE_KEY_PREFIX = "AGE-SECRET-KEY-1";

export async function homeKeyImport(
  args: string[],
  _ctx: CommandContext = {},
  seams: AgeKeySeam = createRealAgeKeySeam(),
  sopsYamlSeam: SopsYamlSeam = defaultSopsYamlSeam(),
  input: AgeKeyInputSeam = defaultAgeKeyInputSeam(),
): Promise<void> {
  // The key must arrive via --stdin or the hidden interactive prompt — never
  // as a positional argument. By the time it shows up here as one, it has
  // already landed in the operator's shell history and rt's own CLI log
  // (dispatch() logs every command's args) — refuse outright rather than
  // silently proceeding as if the leak never happened.
  const pastedKeyArg = args.find((a) => a.startsWith(AGE_PRIVATE_KEY_PREFIX));
  if (pastedKeyArg !== undefined) {
    refuse(
      "rt will not import a key passed as a positional argument",
      out.callout("why", "It just landed in your shell history and in rt's own log, so treat it as leaked and rotate it before you use it for anything."),
      out.callout("next", out.cmd("rt home key import --stdin")),
    );
  }

  const force = args.includes("--force");

  let privateKey: string;
  try {
    privateKey = args.includes("--stdin") ? await input.fromStdin() : await input.fromPrompt();
  } catch (err) {
    out.fail({ title: "rt could not read the key", hint: (err as Error).message });
    process.exit(1);
  }

  const result = await importAgeKey(seams, privateKey, { force });

  if (!result.ok) {
    if (result.reason === "malformed") {
      out.fail({ title: "That is not a valid age private key", why: "A key starts with AGE-SECRET-KEY-1." });
      process.exit(1);
    }
    refuse(
      "This Mac already has a secrets key",
      out.callout("why", `Its recipient is ${truncateKey(result.existingPublicKey)}.`),
      out.callout("next", out.cmd("rt home key import --force")),
    );
  }

  const { publicKey } = result;

  const userDir = join(mattstackHome(), "user");
  const sopsYamlPath = join(userDir, ".sops.yaml");
  const existing = sopsYamlSeam.read(sopsYamlPath);
  const existingRecipient = existing === null ? null : sopsYamlRecipient(existing);

  if (existingRecipient !== null && existingRecipient !== publicKey) {
    out.fail({
      title: "That key cannot open the secrets in your home repo",
      why: `It is ${truncateKey(publicKey)}, and they are locked to ${truncateKey(existingRecipient)}. The key you just imported is stored now, so import the right one over it.`,
      next: out.cmd("rt home key import --force"),
    });
    process.exit(2);
  }

  out.print(out.line("done", "Imported your secrets key", truncateKey(publicKey)), out.callout("note", "Secrets locked to this key can now be opened on this Mac"));
}

// ─── snapshot / claim / release ─────────────────────────────────────────────

/** Reaches the daemon's `home:snapshot`/`home:snapshot-status` handlers — daemon-internal, no typed rt-client wrapper, same posture as settings.ts. */
export interface HomeDaemonSeam {
  query(cmd: string, payload?: Record<string, any>): Promise<DaemonResponse | null>;
}

function defaultHomeDaemonSeam(): HomeDaemonSeam {
  return { query: daemonQuery };
}

function daemonDownAndExit(command: string): never {
  out.fail({ title: "The rt daemon is not running", next: out.cmd("rt daemon start") });
  process.exit(1);
  throw new Error(`unreachable: process.exit did not stop ${command}`);
}

function formatTimestamp(ms: number): string {
  return ms === 0 ? "never" : new Date(ms).toLocaleString();
}

function snapshotResultBlocks(result: SnapshotResult): Block[] {
  if (result.skipped) return [out.line("skipped", "Nothing was saved", result.skipped)];
  if (!result.committed) return [out.line("skipped", "Nothing has changed since the last save")];
  return [
    out.line("done", "Saved your home repo", result.sha ? result.sha.slice(0, 8) : undefined),
    out.kv("paths", result.paths.length > 0 ? result.paths.join(", ") : "none"),
  ];
}

function snapshotStatusBlocks(status: SnapshotStatus): Block[] {
  const push = status.pushPending ? "waiting to push" : status.lastPushAt !== 0 ? `last pushed ${formatTimestamp(status.lastPushAt)}` : "never pushed";
  return [
    out.line(status.enabled ? "running" : "off", status.enabled ? "Saving your home repo is enabled" : "Saving your home repo is disabled", status.repoDir),
    out.kv("watching", status.watching ? "yes" : "no"),
    out.kv("last run", formatTimestamp(status.lastRunAt)),
    out.kv("last commit", status.lastCommit ? `${status.lastCommit.sha.slice(0, 8)} ${status.lastCommit.message}` : "none"),
    out.kv("push", push),
    out.kv("claimed zones", status.claimedZones.length > 0 ? status.claimedZones.join(", ") : "none"),
    ...(status.lastCommitError ? [out.line("warn", "The last save did not commit", status.lastCommitError)] : []),
    ...(status.lastPushError ? [out.line("warn", "The last push did not go through", status.lastPushError)] : []),
    ...(status.ownersError ? [out.line("warn", "The list of claimed paths could not be read", status.ownersError)] : []),
  ];
}

export async function homeSnapshot(
  args: string[],
  _ctx: CommandContext = {},
  daemon: HomeDaemonSeam = defaultHomeDaemonSeam(),
): Promise<void> {
  if (args.includes("--status")) {
    const res = await daemon.query("home:snapshot-status");
    if (!res) daemonDownAndExit("rt home snapshot --status");
    if (!res.ok) {
      out.fail({ title: "rt could not read the snapshot status", hint: res.error ?? "the daemon gave no reason" });
      process.exit(1);
    }
    out.print(...snapshotStatusBlocks(res.data as SnapshotStatus));
    return;
  }

  const res = await daemon.query("home:snapshot", { reason: "manual" });
  if (!res) daemonDownAndExit("rt home snapshot");
  if (!res.ok) {
    out.fail({ title: "rt could not save your home repo", hint: res.error ?? "the daemon gave no reason" });
    process.exit(1);
  }
  out.print(...snapshotResultBlocks(res.data as SnapshotResult));
}

function defaultOwnersPath(): string {
  return join(mattstackHome(), "user", "snapshot-owners.jsonc");
}

function defaultOwner(): string {
  return `${process.env.USER ?? "unknown"}@${machineKey()}`;
}

/** Splits `args` into `{ zone, owner?, note?, force }`, tolerating `--flag value` and `--flag=value`. */
function parseClaimArgs(args: string[]): { zone: string | undefined; owner: string | undefined; note: string | undefined; force: boolean } {
  let owner: string | undefined;
  let note: string | undefined;
  let force = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--owner") owner = args[++i];
    else if (arg.startsWith("--owner=")) owner = arg.slice("--owner=".length);
    else if (arg === "--note") note = args[++i];
    else if (arg.startsWith("--note=")) note = arg.slice("--note=".length);
    else if (arg === "--force") force = true;
    else positional.push(arg);
  }
  return { zone: positional[0], owner, note, force };
}

/** A word a POSIX shell reads back unchanged: bare when it is plain, else single-quoted. */
function shellWord(word: string): string {
  return /^[A-Za-z0-9_./:@=+-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

function homeRepoRoot(): string {
  return join(mattstackHome(), "user");
}

/** Shared by claim/release: writing (or even mkdir-ing the dir for) snapshot-owners.jsonc into a tree `rt home init` never provisioned would create a bare, non-git ~/.mattstack/user — refuse instead. */
function refuseUnlessProvisioned(_command: string, probes: HomeProbes): void {
  if (!probes.isGitRepo(homeRepoRoot())) {
    out.fail({ title: "Your home repo is not set up yet", next: out.cmd("rt home init") });
    process.exit(1);
  }
}

export async function homeClaim(
  args: string[],
  _ctx: CommandContext = {},
  ownersPath: string = defaultOwnersPath(),
  probes: HomeProbes = defaultProbes(),
): Promise<void> {
  const { zone: zoneArg, owner: ownerArg, note, force } = parseClaimArgs(args);
  let zone = zoneArg;
  if (!zone) {
    if (process.stdin.isTTY && !process.env.RT_BATCH) {
      const { textInput } = await import("../lib/rt-render.ts");
      zone = await textInput({ message: "Zone to claim (path relative to the home repo)", placeholder: "prefs/ or scripts/deploy.sh" });
      if (!zone) process.exit(0);
    } else {
      out.fail(usageFailure("Which path should rt leave for you to commit?", "rt home claim <zone>", "A zone is a folder such as prefs/ or one file such as scripts/deploy.sh."));
      process.exit(1);
    }
  }

  refuseUnlessProvisioned("claim", probes);

  const owner = ownerArg ?? defaultOwner();

  let kind: ZoneKind;
  try {
    // Stat the NORMALIZED bare path (kind:"file" never carries a trailing
    // slash), not the raw user string — `rt home claim scripts/deploy.sh/`
    // (a trailing slash on a real file) would otherwise make statSync see
    // ENOTDIR and default to "dir", storing an exclude pathspec that
    // (verified against real git) matches nothing. A REGULAR FILE claims
    // exactly that path; anything else (a directory, or a path that
    // doesn't exist yet — the common case for "claim this directory before
    // I create anything in it") claims the whole subtree.
    kind = probes.isFile(join(homeRepoRoot(), normalizeZone(zone, "file"))) ? "file" : "dir";
    claimZone(ownersPath, zone, owner, { note, kind, force });
  } catch (err) {
    if (err instanceof InvalidZoneError) {
      out.fail({ title: "That path cannot be claimed", why: err.message });
      process.exit(1);
    }
    if (err instanceof ZoneOwnedByOthersError) {
      const again = ["rt home claim", shellWord(err.zone), ...(ownerArg === undefined ? [] : ["--owner", shellWord(ownerArg)]), ...(note === undefined ? [] : ["--note", shellWord(note)]), "--force"];
      refuse(`${err.zone} is already claimed by ${err.existingOwner}`, out.callout("next", out.cmd(again.join(" "))));
    }
    throw err;
  }

  out.print(out.line("done", `Claimed ${normalizeZone(zone, kind)}`, `for ${owner}`), out.callout("note", "The daemon picks this up the next time it takes a snapshot"));
}

export async function homeRelease(
  args: string[],
  _ctx: CommandContext = {},
  ownersPath: string = defaultOwnersPath(),
  probes: HomeProbes = defaultProbes(),
): Promise<void> {
  let zone = args.find((arg) => !arg.startsWith("--"));
  if (!zone) {
    const claimed = process.stdin.isTTY && !process.env.RT_BATCH ? Object.entries(readOwners(ownersPath).zones) : [];
    if (claimed.length > 0) {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      zone =
        (await filterableSelect({
          message: "Zone to release",
          options: claimed.map(([z, entry]) => ({ value: z, label: z, hint: `claimed by ${entry.owner}` })),
        })) ?? undefined;
      if (!zone) process.exit(0);
    } else {
      out.fail(usageFailure("Which claimed path should rt take back?", "rt home release <zone>"));
      process.exit(1);
    }
  }

  refuseUnlessProvisioned("release", probes);

  let result: ReturnType<typeof releaseZone>;
  try {
    result = releaseZone(ownersPath, zone);
  } catch (err) {
    if (err instanceof InvalidZoneError) {
      out.fail({ title: "That path cannot be released", why: err.message });
      process.exit(1);
    }
    throw err;
  }

  if (!result.released) {
    out.print(out.line("skipped", "Nothing to release", `${zone} is not claimed`));
    return;
  }

  out.print(out.line("done", `Released ${result.zone}`, `was claimed by ${result.owner}`), out.callout("note", "The daemon picks this up the next time it takes a snapshot"));
}
