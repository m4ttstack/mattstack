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
import { isValidHostname } from "../setup/host-validate.ts";
import { homeGitDir } from "../setup/home-paths.ts";
import { HOME_REPO_PATTERN, writeIntent } from "../setup/intent.ts";
import type { Probes } from "../setup/probes.ts";
import { failureDetail } from "../setup/steps/home.ts";
import { hasUrlCredentials, scrub } from "../team/redact.ts";
import { importAgeKey, PRIVATE_KEY_PREFIX, readAgeKey, type AgeKeySeam } from "./age-key.ts";

/** `rt home remote set --create` makes the home repo with `gh repo create`, so an `owner/repo` with no host is on GitHub. */
export const DEFAULT_HOME_HOST = "github.com";

/** A clone through `--url` runs inside `rt home init`, which reaches the network. */
const HOME_INIT_TIMEOUT_MS = 180_000;

export const RESTORE_USAGE = "rt home restore <owner>/<repo> --stdin";

export interface HomeRepoTarget {
  /** What `git clone` gets. */
  url: string;
  /** `owner/repo`, recorded on the intent and matched against the clone's origin. */
  homeRepo: string;
}

const SEGMENT = /^[\w.-]+$/;
const SCHEME_URL = /^(?:https?|ssh|git):\/\/(?:[^\s/@]+@)?([^\s/:@]+)(?::\d+)?\/(\S+)$/i;
const SCP_URL = /^(?:[\w.-]+@)?([^\s/:@]+):(?!\/\/)(\S+)$/;

function notARepo(): UserActionableError {
  return new UserActionableError("bad-repo", "That is not a settings repo rt can find", {}, {
    why: "Give it owner/repo, host/owner/repo or the repo's clone address.",
    next: RESTORE_USAGE,
  });
}

function badHost(): UserActionableError {
  return new UserActionableError("bad-host", "That host name will not work", {}, { why: "A host looks like github.com.", next: RESTORE_USAGE });
}

/** The last two path segments: a nested GitLab group still ends in `group/repo`, which is what the clone's origin is checked for. */
function homeRepoOf(path: string): string {
  const segments = path.replace(/\/+$/, "").replace(/\.git$/, "").split("/");
  if (segments.length < 2 || segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) throw notARepo();
  const homeRepo = segments.slice(-2).join("/");
  if (!HOME_REPO_PATTERN.test(homeRepo)) throw notARepo();
  return homeRepo;
}

/**
 * Accepts `owner/repo` (on {@link DEFAULT_HOME_HOST}), `host/owner/repo`, or
 * a clone URL (https, ssh, git or scp style), used as given. A host is
 * checked with `isValidHostname`; a URL carrying a password is refused.
 */
export function homeRepoTarget(raw: string): HomeRepoTarget {
  const value = raw.trim();
  if (hasUrlCredentials(value)) {
    throw new UserActionableError("bad-repo", "That address carries a password", {}, {
      why: "Drop it and let a credential helper sign you in.",
      next: RESTORE_USAGE,
    });
  }
  const url = SCHEME_URL.exec(value) ?? SCP_URL.exec(value);
  if (url) {
    if (!isValidHostname(url[1]!)) throw badHost();
    return { url: value, homeRepo: homeRepoOf(url[2]!) };
  }
  const segments = value.split("/");
  if (segments.length < 2) throw notARepo();
  if (segments.length === 2) {
    const homeRepo = homeRepoOf(value);
    return { url: `https://${DEFAULT_HOME_HOST}/${homeRepo}.git`, homeRepo };
  }
  const [host, ...rest] = segments;
  // A dotless first segment reads as a group, not a host, so it never becomes one by accident.
  if (!host!.includes(".") || !isValidHostname(host!)) throw badHost();
  const path = rest.join("/").replace(/\.git$/, "");
  const homeRepo = homeRepoOf(path);
  return { url: `https://${host}/${path}.git`, homeRepo };
}

/** {@link homeRepoTarget}'s URL, or the value unchanged when it cannot be read, so `git clone` reports the problem in its own words. */
export function homeRepoCloneUrl(value: string): string {
  try {
    return homeRepoTarget(value).url;
  } catch {
    return value;
  }
}

export type KeyOutcome = "imported" | "kept";

function badKey(): UserActionableError {
  return new UserActionableError("bad-key", "That is not a recovery key", {}, {
    why: "A recovery key starts with AGE-SECRET-KEY-1. On your old Mac, rt home key export prints it.",
    next: RESTORE_USAGE,
  });
}

function otherKey(target: string): UserActionableError {
  return new UserActionableError("other-key", "This Mac already has a different recovery key", {}, {
    why: "rt replaces a key only when you ask, so nothing changed.",
    next: "rt home key import --force",
    thenRun: `rt home restore ${target} --stdin`,
  });
}

function keychainUnreadable(target: string, err: unknown): UserActionableError {
  return new UserActionableError("keychain", "rt could not read your keychain", {}, {
    why: "Unlock it, then try again.",
    next: `rt home restore ${target} --stdin`,
    log: scrub(err instanceof Error ? err.message : String(err)),
  });
}

/** The public recipient a private key opens, or null when age cannot read it. */
async function recipientOf(seam: AgeKeySeam, privateKey: string): Promise<string | null> {
  const derived = await seam.run(["age-keygen", "-y"], { input: privateKey, sensitive: true });
  return derived.code === 0 ? derived.stdout.trim() : null;
}

/** The same key already in the keychain is kept; a different one is refused, never overwritten. */
async function placeKey(seam: AgeKeySeam, privateKey: string, pasted: string, target: string): Promise<KeyOutcome> {
  let existing: Awaited<ReturnType<typeof readAgeKey>>;
  try {
    existing = await readAgeKey(seam);
  } catch (err) {
    throw keychainUnreadable(target, err);
  }
  if ("key" in existing) {
    const held = await recipientOf(seam, existing.key);
    if (held === null) throw keychainUnreadable(target, new Error("age-keygen -y could not read the key already in the keychain"));
    if (held === pasted) return "kept";
    throw otherKey(target);
  }
  let result: Awaited<ReturnType<typeof importAgeKey>>;
  try {
    result = await importAgeKey(seam, privateKey);
  } catch (err) {
    throw new UserActionableError("keychain", "rt could not save your recovery key to the keychain", {}, {
      why: "Unlock your keychain, then try again.",
      next: `rt home restore ${target} --stdin`,
      log: scrub(err instanceof Error ? err.message : String(err)),
    });
  }
  if (result.ok) return "imported";
  if (result.reason === "malformed") throw badKey();
  throw otherKey(target);
}

function machineKeyPath(home: string): string {
  return join(home, ".mattstack", "machine-key");
}

/** A settings repo already on this Mac stays: rt left it alone because rt did not clone it for this restore. */
function checkExistingClone(p: Pick<Probes, "exists" | "readFile" | "home">, target: HomeRepoTarget, arg: string): void {
  const gitDir = homeGitDir(p.home);
  if (!p.exists(gitDir)) return;
  const config = p.readFile(join(gitDir, "config")) ?? "";
  if (config.includes(target.homeRepo)) return;
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

async function cloneAndProvision(p: Pick<Probes, "exists" | "home" | "runRt">, target: HomeRepoTarget, arg: string, profile: string | undefined): Promise<void> {
  const result = await p.runRt(initArgs(p, target, profile), { timeoutMs: HOME_INIT_TIMEOUT_MS });
  if (result.code === 0) return;
  const detail = failureDetail(result.stderr) || "rt could not set up your settings repo";
  // A clone that landed with no machine key written stopped at the profile choice, the one init step between the two.
  if (p.exists(homeGitDir(p.home)) && !p.exists(machineKeyPath(p.home))) {
    throw new UserActionableError("profile", "This Mac needs a profile name of its own", {}, {
      why: detail,
      next: `rt home restore ${arg} --stdin --profile <name>`,
      log: result.stderr,
    });
  }
  throw new UserActionableError("init-failed", detail, {}, { next: `rt home restore ${arg} --stdin`, log: result.stderr });
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

export async function runHomeRestore(p: HomeRestoreProbes, seam: AgeKeySeam, input: HomeRestoreInput): Promise<HomeRestoreResult> {
  const target = homeRepoTarget(input.repo);
  const arg = input.repo.trim();
  if (!input.privateKey.startsWith(PRIVATE_KEY_PREFIX)) throw badKey();
  const pasted = await recipientOf(seam, input.privateKey);
  if (pasted === null) throw badKey();
  checkExistingClone(p, target, arg);
  const key = await placeKey(seam, input.privateKey, pasted, arg);
  await cloneAndProvision(p, target, arg, input.profile);
  writeIntent(p, { v: 1, at: p.now().toISOString(), mode: "restore", restore: { homeRepo: target.homeRepo, url: target.url } });
  return { ...target, key };
}
