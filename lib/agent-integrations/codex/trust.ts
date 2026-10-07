/**
 * Whether Codex already trusts a folder, read from the active profile's own
 * config and never written. Codex 0.160's remote-resume terminal draws no
 * trust prompt: it saves trust for its folder without asking, so a Herdr
 * attach must not run anywhere Codex does not already trust.
 *
 * Codex records trust per folder, as `[projects."<path>"] trust_level =
 * "trusted"`. Only an entry for the folder itself counts: rt does not infer
 * trust from a parent folder or a repository root.
 */

import { readFileSync, realpathSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { LEGACY_DEFAULT_PROFILE } from "../session-store.ts";
import { isRecord } from "./protocol.ts";

/** The config of a canonical Codex profile (`canonicalCodexProfile`); a bare profile name locates none. */
export function codexConfigPath(profile: string, env: NodeJS.ProcessEnv): string | undefined {
  if (profile === LEGACY_DEFAULT_PROFILE) return join(env.HOME ?? homedir(), ".codex", "config.toml");
  return isAbsolute(profile) ? join(profile, "config.toml") : undefined;
}

const notReady = (message: string): Outcome<void> => ({ ok: false, error: { code: "not-ready", message } });

const untrusted = (cwd: string): Outcome<void> => notReady(
  `Codex does not trust ${cwd} yet, and a terminal opened there would trust it without asking you. Open Codex in that folder and trust it, then try again.`,
);

/** Both spellings name one folder, so either may carry the person's decision; any that is not "trusted" refuses. */
function spellings(cwd: string): string[] {
  try {
    const real = realpathSync(cwd);
    return real === cwd ? [cwd] : [cwd, real];
  } catch {
    return [cwd];
  }
}

export function codexFolderTrust(configPath: string | undefined, cwd: string): Outcome<void> {
  if (configPath === undefined) {
    return notReady(`rt cannot find the Codex settings for this profile, so it cannot tell whether Codex trusts ${cwd}. Open Codex in that folder and trust it, then try again.`);
  }
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return untrusted(cwd);
    return notReady(`rt could not read Codex's settings, so it cannot tell whether Codex trusts ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const projects = isRecord(parsed) && isRecord(parsed.projects) ? parsed.projects : {};
  const levels = spellings(cwd)
    .filter((path) => Object.hasOwn(projects, path))
    .map((path) => (isRecord(projects[path]) ? projects[path].trust_level : undefined));
  return levels.length > 0 && levels.every((level) => level === "trusted") ? { ok: true, data: undefined } : untrusted(cwd);
}
