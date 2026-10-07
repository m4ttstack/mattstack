/**
 * Whether Codex already trusts a folder, read from the active profile's own
 * config and never written. Codex 0.160's remote-resume terminal draws no
 * trust prompt: it saves trust for its folder without asking, so a Herdr
 * attach must not run anywhere Codex does not already trust.
 *
 * Codex records trust per folder, as `[projects."<path>"] trust_level =
 * "trusted"`. It reads the folder's own entry first; a folder with none
 * inherits from its git checkout's top-level folder, or for a linked worktree
 * from the main repository's (live-02). A plain parent folder passes nothing
 * on. Whatever cannot be resolved with certainty is not trusted.
 */

import { readFileSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { LEGACY_DEFAULT_PROFILE } from "../session-store.ts";
import { isRecord } from "./protocol.ts";

/** The config of a canonical Codex profile (`canonicalCodexProfile`); a bare profile name locates none. */
export function codexConfigPath(profile: string, env: NodeJS.ProcessEnv): string | undefined {
  if (profile === LEGACY_DEFAULT_PROFILE) return join(env.HOME ?? homedir(), ".codex", "config.toml");
  return isAbsolute(profile) ? join(profile, "config.toml") : undefined;
}

export type TrustLog = (message: string, context: Record<string, unknown>) => void;

const logToWarnings: TrustLog = (message, context) => {
  void import("../../ui/warn.ts").then(({ warn }) => warn("codex-trust", message, { context }));
};

const refuse = (message: string): Outcome<void> => ({ ok: false, error: { code: "refused", message } });

const untrusted = (cwd: string): Outcome<void> => refuse(
  `Codex does not trust ${cwd} yet, and a terminal opened there would trust it without asking you. Open Codex in that folder and trust it, then try again.`,
);

function real(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/** Both spellings name one folder, so either may carry the person's decision. */
function spellings(path: string): string[] {
  const resolved = real(path);
  return resolved === undefined || resolved === path ? [path] : [path, resolved];
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A linked worktree's `.git` file names its git dir under the main repository's `.git/worktrees/`. */
function mainRepoOfWorktree(dotGit: string): string | undefined {
  const pointer = /^gitdir:\s*(\S.*?)\s*$/.exec(readFileSync(dotGit, "utf8").trim());
  if (!pointer) return undefined;
  const gitDir = resolve(dirname(dotGit), pointer[1]!);
  if (basename(dirname(gitDir)) !== "worktrees") return undefined;
  const common = dirname(dirname(gitDir));
  const named = resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim());
  if ((real(named) ?? named) !== (real(common) ?? common) || basename(common) !== ".git" || !isDir(common)) return undefined;
  return dirname(common);
}

/**
 * The folder Codex inherits trust from: the nearest enclosing git checkout's
 * top-level folder, or a linked worktree's main repository. Undefined outside
 * git, and for any shape it cannot follow (a submodule, a bare repository).
 */
export function gitTrustRoot(cwd: string): string | undefined {
  try {
    for (let dir = real(cwd) ?? cwd; ; dir = dirname(dir)) {
      const dotGit = join(dir, ".git");
      let isDirectory: boolean;
      try {
        const stat = statSync(dotGit);
        if (!stat.isDirectory() && !stat.isFile()) return undefined;
        isDirectory = stat.isDirectory();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
        if (dirname(dir) === dir) return undefined;
        continue;
      }
      return isDirectory ? dir : mainRepoOfWorktree(dotGit);
    }
  } catch {
    return undefined;
  }
}

/** The trust levels recorded for any spelling of `path`; empty when Codex has no entry for it. */
function levelsAt(projects: Record<string, unknown>, path: string): unknown[] {
  return spellings(path)
    .filter((spelling) => Object.hasOwn(projects, spelling))
    .map((spelling) => {
      const entry = projects[spelling];
      return isRecord(entry) ? entry.trust_level : undefined;
    });
}

const allTrusted = (levels: unknown[]): boolean => levels.length > 0 && levels.every((level) => level === "trusted");

export function codexFolderTrust(configPath: string | undefined, cwd: string, log: TrustLog = logToWarnings): Outcome<void> {
  if (configPath === undefined) {
    return refuse(`rt cannot find Codex's settings for this profile, so it cannot tell whether Codex trusts ${cwd}. Open Codex in that folder and trust it, then try again.`);
  }
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return untrusted(cwd);
    log("rt could not open Codex's settings to check folder trust", { path: configPath, err: String(err) });
    return refuse(`rt could not open Codex's settings, so it cannot tell whether Codex trusts ${cwd}. Make sure Codex can open its settings, then try again.`);
  }
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(text);
  } catch (err) {
    log("rt could not parse Codex's settings to check folder trust", { path: configPath, err: String(err) });
    return refuse(`Codex's settings hold an entry rt cannot read, so it cannot tell whether Codex trusts ${cwd}. Fix or remove that entry in Codex's settings, then try again.`);
  }
  const projects = isRecord(parsed) && isRecord(parsed.projects) ? parsed.projects : {};
  const own = levelsAt(projects, cwd);
  if (own.length > 0) return allTrusted(own) ? { ok: true, data: undefined } : untrusted(cwd);
  const root = gitTrustRoot(cwd);
  return root !== undefined && allTrusted(levelsAt(projects, root)) ? { ok: true, data: undefined } : untrusted(cwd);
}
