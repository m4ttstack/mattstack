/**
 * The PATH a member's terminal sees. The app runs setup checks under
 * launchd, whose PATH is not the member's, so a row that judges PATH asks a
 * fresh interactive login shell instead: a terminal tab is exactly that, and
 * on macOS only the interactive rc runs after /etc/zprofile's path_helper
 * has reordered PATH.
 */

import type { Probes } from "./probes.ts";

export const MEMBER_PATH_SENTINEL = "__RT_MEMBER_PATH__";

const PROBE_TIMEOUT_MS = 5000;
/** What `login` hands a new terminal before any rc file runs; the probe must not inherit the app's PATH, which rt's own exec prepends ~/.local/bin to. */
const LOGIN_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const SCRIPT = `printf '\\n${MEMBER_PATH_SENTINEL}%s${MEMBER_PATH_SENTINEL}\\n' "$PATH"`;

const cache = new WeakMap<Probes, Promise<string[] | null>>();

/** The member's PATH entries, or null when the shell could not be asked or never answered. One probe per Probes, so one per verify run. */
export function memberPath(p: Probes): Promise<string[] | null> {
  let pending = cache.get(p);
  if (!pending) {
    pending = probe(p);
    cache.set(p, pending);
  }
  return pending;
}

async function probe(p: Probes): Promise<string[] | null> {
  const shell = p.env.SHELL;
  if (!shell?.startsWith("/")) return null;
  const env = [`HOME=${p.home}`, `SHELL=${shell}`, `PATH=${LOGIN_PATH}`, "TERM=dumb"];
  for (const key of ["USER", "LOGNAME", "TMPDIR"]) {
    const value = p.env[key];
    if (value) env.push(`${key}=${value}`);
  }
  const res = await p.exec(["/usr/bin/env", "-i", ...env, shell, "-i", "-l", "-c", SCRIPT], { timeoutMs: PROBE_TIMEOUT_MS });
  const match = res.stdout.match(new RegExp(`${MEMBER_PATH_SENTINEL}(.*?)${MEMBER_PATH_SENTINEL}`));
  if (!match) return null;
  return match[1]!.split(":").filter(Boolean).map((entry) => (entry.length > 1 ? entry.replace(/\/+$/, "") : entry));
}
