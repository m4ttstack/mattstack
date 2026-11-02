/**
 * `rt home restore`: brings a Mac's settings over from its home repo in one
 * run. The order is load-bearing: the recovery key goes into the keychain
 * first, because `rt home init` with no key mints one and then cannot open
 * the cloned secrets; init clones the repo next; the restore intent is
 * recorded last, since recording it moves setup on to its run.
 *
 * Every step checks what is already in place, so a run after a partial one
 * finishes the job. The recovery key never reaches an error, a log line or
 * argv: it travels only on the age seam's stdin and the keychain write.
 */

import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { homeGitDir } from "../setup/home-paths.ts";
import { writeIntent } from "../setup/intent.ts";
import type { Probes } from "../setup/probes.ts";
import { CHECK_ABOVE_REMEDY, failureDetail, homeInitRemedy } from "../setup/steps/home.ts";
import { scrub } from "../team/redact.ts";
import { importAgeKey, PRIVATE_KEY_PREFIX, readAgeKey, removeAgeKeyIf, sopsYamlRecipients, type AgeKeySeam } from "./age-key.ts";
import { homeRepoTarget, originNames, RESTORE_USAGE, type HomeRepoTarget } from "./home-repo.ts";

export { DEFAULT_HOME_HOST, homeRepoCloneUrl, homeRepoTarget, RESTORE_USAGE, type HomeRepoTarget } from "./home-repo.ts";

/** A clone through `--url` runs inside `rt home init`, which reaches the network. */
const HOME_INIT_TIMEOUT_MS = 180_000;

export type KeyOutcome = "imported" | "kept";

function badKey(): UserActionableError {
  return new UserActionableError("bad-key", "That is not a recovery key", {}, {
    why: "A recovery key starts with AGE-SECRET-KEY-1. On your old Mac, rt home key export prints it.",
    next: RESTORE_USAGE,
  });
}

function wrongKey(arg: string): UserActionableError {
  return new UserActionableError("wrong-key", "That recovery key can't open these settings", {}, {
    why: "Use the key from the Mac these settings came from.",
    next: `rt home restore ${arg} --stdin`,
  });
}

function otherKey(arg: string): UserActionableError {
  return new UserActionableError("other-key", "This Mac already has a different recovery key", {}, {
    why: "rt replaces a key only when you ask, so nothing changed.",
    next: "rt home key import --force",
    thenRun: `rt home restore ${arg} --stdin`,
  });
}

function storedKeyUnreadable(arg: string): UserActionableError {
  return new UserActionableError("stored-key", "The recovery key already on this Mac cannot be read", {}, {
    why: "Replace it with the key from your old Mac.",
    next: "rt home key import --force",
    thenRun: `rt home restore ${arg} --stdin`,
  });
}

function keychainError(title: string, arg: string, err: unknown): UserActionableError {
  return new UserActionableError("keychain", title, {}, {
    why: "Unlock your keychain, then try again.",
    next: `rt home restore ${arg} --stdin`,
    log: scrub(err instanceof Error ? err.message : String(err)),
  });
}

/** The public recipient a private key opens, or null when age cannot read it. */
async function recipientOf(seam: AgeKeySeam, privateKey: string): Promise<string | null> {
  const derived = await seam.run(["age-keygen", "-y"], { input: privateKey, sensitive: true });
  return derived.code === 0 ? derived.stdout.trim() : null;
}

/** Who the cloned secrets are locked to; empty with no clone or no secrets yet. */
function cloneRecipients(p: Pick<Probes, "readFile" | "home">): string[] {
  const raw = p.readFile(join(p.home, ".mattstack", "user", ".sops.yaml"));
  return raw === null ? [] : sopsYamlRecipients(raw);
}

function locksOut(p: Pick<Probes, "readFile" | "home">, pasted: string): boolean {
  const recipients = cloneRecipients(p);
  return recipients.length > 0 && !recipients.includes(pasted);
}

/**
 * The same key already in the keychain is kept; a different one is refused
 * and never touched. This Mac's key is also its team identity (team join
 * registers it, the org's secrets encrypt to it), so only a person replaces
 * it, with `rt home key import --force`.
 */
async function placeKey(seam: AgeKeySeam, privateKey: string, pasted: string, arg: string): Promise<KeyOutcome> {
  let existing: Awaited<ReturnType<typeof readAgeKey>>;
  try {
    existing = await readAgeKey(seam);
  } catch (err) {
    throw keychainError("rt could not read your keychain", arg, err);
  }
  if ("key" in existing) {
    const held = await recipientOf(seam, existing.key);
    if (held === pasted) return "kept";
    throw held === null ? storedKeyUnreadable(arg) : otherKey(arg);
  }
  let result: Awaited<ReturnType<typeof importAgeKey>>;
  try {
    result = await importAgeKey(seam, privateKey);
  } catch (err) {
    throw keychainError("rt could not save your recovery key to the keychain", arg, err);
  }
  if (result.ok) return "imported";
  if (result.reason === "malformed") throw badKey();
  throw otherKey(arg);
}

function machineKeyPath(home: string): string {
  return join(home, ".mattstack", "machine-key");
}

/** A settings repo already on this Mac stays: rt did not make it for this restore, so rt left it alone. */
function checkExistingClone(p: Pick<Probes, "exists" | "readFile" | "home">, target: HomeRepoTarget, arg: string): void {
  const gitDir = homeGitDir(p.home);
  if (!p.exists(gitDir)) return;
  if (originNames(p.readFile(join(gitDir, "config")), target.homeRepo)) return;
  throw new UserActionableError("other-home-repo", "This Mac already has a different settings repo", {}, {
    why: `rt did not make the one at ${join(p.home, ".mattstack", "user")}, so rt left it alone. Move it aside, then try again.`,
    next: `rt home restore ${arg} --stdin`,
  });
}

/**
 * A restoring Mac takes a new machine profile: the old Mac's profile holds
 * that Mac's own paths, and two Macs adopting one profile overwrite each
 * other's machine settings. Once this Mac has a machine key it already has
 * its profile, and init refuses a profile flag.
 */
function initArgs(p: Pick<Probes, "exists" | "home">, target: HomeRepoTarget, profile: string | undefined): string[] {
  const args = ["home", "init", "--url", target.url, "--no-materialize"];
  if (p.exists(machineKeyPath(p.home))) return args;
  return [...args, ...(profile !== undefined ? ["--profile", profile] : []), "--new-profile"];
}

export interface HomeRestoreOptions {
  /** This Mac's hardware id, the name init gives a fresh Mac's profile: `stableMachineId` for real. */
  machineId: () => Promise<string | null>;
}

async function cloneAndProvision(
  p: Pick<Probes, "exists" | "home" | "runRt">,
  target: HomeRepoTarget,
  arg: string,
  profile: string | undefined,
  opts: HomeRestoreOptions,
): Promise<void> {
  let result = await p.runRt(initArgs(p, target, profile), { timeoutMs: HOME_INIT_TIMEOUT_MS });
  if (result.code === 0) return;
  // A clone that landed with no machine key written stopped at the profile choice, the one init step between the two.
  const stoppedAtProfile = () => p.exists(homeGitDir(p.home)) && !p.exists(machineKeyPath(p.home));
  if (stoppedAtProfile() && profile === undefined) {
    // This same Mac set up before: its profile is already named by its hardware id, so the new profile collides with it.
    const id = await opts.machineId();
    if (id !== null && p.exists(join(p.home, ".mattstack", "user", "local", id, "settings.local.jsonc"))) {
      result = await p.runRt(["home", "init", "--url", target.url, "--no-materialize", "--profile", id], { timeoutMs: HOME_INIT_TIMEOUT_MS });
      if (result.code === 0) return;
    }
  }
  const detail = failureDetail(result.stderr) || "rt could not set up your settings repo";
  if (stoppedAtProfile()) {
    throw new UserActionableError("profile", "This Mac needs a profile name of its own", {}, {
      why: detail,
      next: `rt home restore ${arg} --stdin --profile <name>`,
      log: result.stderr,
    });
  }
  const remedy = homeInitRemedy(result.stderr);
  // The app shows no error above this one, so the generic remedy would point at nothing.
  const why = remedy === CHECK_ABOVE_REMEDY ? "Retry, or run rt home restore in a terminal to see why." : remedy;
  throw new UserActionableError("init-failed", detail, {}, { why, next: `rt home restore ${arg} --stdin`, log: result.stderr });
}

export type HomeRestoreProbes = Pick<Probes, "exists" | "readFile" | "writeFile" | "mkdirp" | "home" | "now" | "runRt">;

export interface HomeRestoreInput {
  /** What the person typed: `owner/repo`, `host/owner/repo` or a clone URL. */
  repo: string;
  privateKey: string;
  /** A name for this Mac's new profile, when its default name is taken. */
  profile?: string;
}

export interface HomeRestoreResult extends HomeRepoTarget {
  key: KeyOutcome;
}

async function takeBack(seam: AgeKeySeam, pasted: string): Promise<boolean> {
  try {
    return await removeAgeKeyIf(seam, pasted);
  } catch {
    return false;
  }
}

export async function runHomeRestore(p: HomeRestoreProbes, seam: AgeKeySeam, input: HomeRestoreInput, opts: HomeRestoreOptions): Promise<HomeRestoreResult> {
  const target = homeRepoTarget(input.repo);
  const arg = input.repo.trim();
  if (!input.privateKey.startsWith(PRIVATE_KEY_PREFIX)) throw badKey();
  const pasted = await recipientOf(seam, input.privateKey);
  if (pasted === null) throw badKey();
  checkExistingClone(p, target, arg);
  if (p.exists(homeGitDir(p.home)) && locksOut(p, pasted)) throw wrongKey(arg);
  const key = await placeKey(seam, input.privateKey, pasted, arg);
  try {
    await cloneAndProvision(p, target, arg, input.profile, opts);
  } catch (err) {
    if (!locksOut(p, pasted)) throw err;
    // Only the key this run imported is taken back; any other key in the keychain stays as it was.
    if (key === "imported" && !(await takeBack(seam, pasted))) {
      throw new UserActionableError("wrong-key", "That recovery key can't open these settings", {}, {
        why: "rt could not take it back out of your keychain.",
        next: "rt home key import --force",
        thenRun: `rt home restore ${arg} --stdin`,
      });
    }
    throw wrongKey(arg);
  }
  writeIntent(p, { v: 1, at: p.now().toISOString(), mode: "restore", restore: { homeRepo: target.homeRepo, url: target.url } });
  return { ...target, key };
}
