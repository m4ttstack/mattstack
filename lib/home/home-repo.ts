/**
 * A home repo's address: what `rt home restore` takes, the clone URL `git
 * clone` gets, and the `owner/repo` a clone's origin names.
 */

import { UserActionableError } from "../errors.ts";
import { isValidHostname } from "../setup/host-validate.ts";
import { HOME_REPO_PATTERN } from "../setup/intent.ts";
import { hasUrlCredentials } from "../team/redact.ts";

/** `rt home remote set --create` makes the home repo with `gh repo create`, so an `owner/repo` with no host is on GitHub. */
export const DEFAULT_HOME_HOST = "github.com";

export const RESTORE_USAGE = "rt home restore <owner>/<repo> --stdin";

export interface HomeRepoTarget {
  /** What `git clone` gets. */
  url: string;
  /** `owner/repo`, recorded on the intent and matched against the clone's origin. */
  homeRepo: string;
}

const SEGMENT = /^[\w.-]+$/;
const SCHEME_URL = /^([a-z][a-z0-9+.-]*):\/\/(?:([^\s/@]+)@)?([^\s/:@]+)(?::\d+)?\/(\S+)$/i;
const SCP_URL = /^(?:([^\s/:@]+)@)?([^\s/:@]+):(?!\/\/)(\S+)$/;
/** http and git:// carry the settings unencrypted. */
const CLONE_SCHEMES = new Set(["https", "ssh"]);

interface ParsedUrl {
  scheme: string | null;
  user: string | null;
  host: string;
  path: string;
}

function parseUrl(value: string): ParsedUrl | null {
  const scheme = SCHEME_URL.exec(value);
  if (scheme) return { scheme: scheme[1]!.toLowerCase(), user: scheme[2] ?? null, host: scheme[3]!, path: scheme[4]! };
  const scp = SCP_URL.exec(value);
  if (scp) return { scheme: null, user: scp[1] ?? null, host: scp[2]!, path: scp[3]! };
  return null;
}

/** The last two path segments: a nested GitLab group still ends in `group/repo`. Null when the path is not a repo. */
function repoPath(path: string): string | null {
  const segments = path.replace(/\/+$/, "").replace(/\.git$/, "").split("/");
  if (segments.length < 2 || segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) return null;
  const homeRepo = segments.slice(-2).join("/");
  return HOME_REPO_PATTERN.test(homeRepo) ? homeRepo : null;
}

function notARepo(): UserActionableError {
  return new UserActionableError("bad-repo", "That is not a settings repo rt can find", {}, {
    why: "Give it owner/repo, host/owner/repo or the repo's clone address.",
    next: RESTORE_USAGE,
  });
}

function badHost(): UserActionableError {
  return new UserActionableError("bad-host", "That host name will not work", {}, { why: "A host looks like github.com.", next: RESTORE_USAGE });
}

function homeRepoOf(path: string): string {
  const homeRepo = repoPath(path);
  if (homeRepo === null) throw notARepo();
  return homeRepo;
}

/**
 * Accepts `owner/repo` (on {@link DEFAULT_HOME_HOST}), `host/owner/repo`, or
 * an https, ssh or scp-style clone URL, used as given. A host is checked
 * with `isValidHostname`; a password in the URL, a plain-text scheme and a
 * leading dash (which `git` would read as an option) are refused.
 */
export function homeRepoTarget(raw: string): HomeRepoTarget {
  const value = raw.trim();
  if (value.startsWith("-")) throw notARepo();
  if (hasUrlCredentials(value)) {
    throw new UserActionableError("bad-repo", "That address carries a password", {}, {
      why: "Drop it and let a credential helper sign you in.",
      next: RESTORE_USAGE,
    });
  }
  const url = parseUrl(value);
  if (url) {
    if (url.scheme !== null && !CLONE_SCHEMES.has(url.scheme)) {
      throw new UserActionableError("bad-repo", "rt brings settings over https or ssh only", {}, {
        why: "An http or git address sends them unencrypted.",
        next: RESTORE_USAGE,
      });
    }
    if (url.user?.startsWith("-")) throw notARepo();
    if (!isValidHostname(url.host)) throw badHost();
    return { url: value, homeRepo: homeRepoOf(url.path) };
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

/** The `owner/repo` a git config's `origin` remote names, or null when it names none rt can read. */
export function originHomeRepo(gitConfig: string): string | null {
  const section = /\[remote "origin"\]([^[]*)/.exec(gitConfig)?.[1];
  const url = section === undefined ? undefined : /^\s*url\s*=\s*(\S+)\s*$/m.exec(section)?.[1];
  if (url === undefined) return null;
  const parsed = parseUrl(url);
  return parsed === null ? null : repoPath(parsed.path);
}

/** Forges match owner and repo names without case, so `JaneDoe/x` and `janedoe/x` are one repo. */
export function originNames(gitConfig: string | null, homeRepo: string): boolean {
  const origin = gitConfig === null ? null : originHomeRepo(gitConfig);
  return origin !== null && origin.toLowerCase() === homeRepo.toLowerCase();
}
