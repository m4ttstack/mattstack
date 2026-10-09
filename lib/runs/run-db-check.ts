import { basename, isAbsolute } from "path";
import { runsRoot } from "./paths.ts";

/** A caller-supplied runDb must resolve under the runs root and name the
    run store's own file, or it is a path into arbitrary state the daemon
    was never asked to write. The root is realpathed too (tolerating one
    that does not exist yet): a root behind a symlink (macOS /var and /tmp)
    would otherwise fail confinement against the runDb run_start returned. */
export function checkRunDb(runDb: string, env: NodeJS.ProcessEnv, realpath: (p: string) => string): { ok: true; real: string } | { ok: false; error: string } {
  if (!isAbsolute(runDb)) return { ok: false, error: '"runDb" must be an absolute path' };
  let real: string;
  try { real = realpath(runDb); } catch { return { ok: false, error: `runDb ${runDb} does not resolve` }; }
  const rawRoot = typeof env.RT_RUNS_ROOT === "string" && env.RT_RUNS_ROOT !== "" ? env.RT_RUNS_ROOT : runsRoot();
  if (!rawRoot) return { ok: false, error: "no runs root is configured" };
  let root = rawRoot;
  try { root = realpath(rawRoot); } catch { /* root need not exist yet; compare against it unresolved */ }
  if (real !== root && !real.startsWith(root.endsWith("/") ? root : `${root}/`)) return { ok: false, error: `runDb must be under the runs root (${root})` };
  if (basename(real) !== "state.db") return { ok: false, error: 'runDb must name a run store\'s "state.db"' };
  return { ok: true, real };
}
