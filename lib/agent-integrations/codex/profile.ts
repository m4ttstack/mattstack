import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import { LEGACY_DEFAULT_PROFILE } from "../session-store.ts";

/**
 * The one spelling of a Codex profile. A Codex home holds its own thread
 * store, so the home is the profile; the CLI, the MCP server and the session
 * adapter run in different processes and must arrive at the same string for
 * one home. An unset home and an explicit `~/.codex` are the same ambient
 * home, `"default"`. A bare name is kept as given.
 */
export function canonicalCodexProfile(explicit: string | undefined, env: NodeJS.ProcessEnv): string {
  const named = [explicit, env.CODEX_HOME].map((v) => v?.trim()).find((v) => v !== undefined && v !== "");
  if (named === undefined) return LEGACY_DEFAULT_PROFILE;
  const home = env.HOME ?? process.env.HOME ?? homedir();
  const expanded = named === "~" ? home : named.startsWith("~/") ? join(home, named.slice(2)) : named;
  if (!isAbsolute(expanded)) return named;
  const path = resolve(expanded);
  return path === resolve(home, ".codex") ? LEGACY_DEFAULT_PROFILE : path;
}
