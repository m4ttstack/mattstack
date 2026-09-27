/**
 * Daemon-or-local dispatch for `rt repos reidentify`, the same rule as
 * repo-locate-dispatch: the daemon is the registry's single writer, so when
 * evidence says one is present (pid or socket file) an unanswered request is
 * a hard stop, never a local fallback that would race the reconciler.
 */

import { existsSync } from "fs";
import { daemonSocketQuery } from "./daemon-client.ts";
import { DAEMON_SOCK_PATH, isDaemonProcessRunning } from "./daemon-config.ts";
import { reidentify, type ReidentifyReport } from "./repo-reidentify.ts";

export const REIDENTIFY_TIMEOUT_MS = 2 * 60_000;

export type ReidentifyOutcome =
  | { via: "daemon" | "local"; ok: true; report: ReidentifyReport }
  | { via: "daemon" | "local"; ok: false; error: string; report?: ReidentifyReport };

function daemonPresent(): boolean {
  return isDaemonProcessRunning() || existsSync(DAEMON_SOCK_PATH);
}

export async function reidentifyRepo(req: { from: string; to: string; dryRun?: boolean }): Promise<ReidentifyOutcome> {
  const dryRun = req.dryRun === true;
  if (daemonPresent()) {
    const res = await daemonSocketQuery("repos:reidentify", { from: req.from, to: req.to, dryRun }, REIDENTIFY_TIMEOUT_MS);
    if (!res) {
      return { via: "daemon", ok: false, error: "the rt daemon is present but did not answer repos:reidentify; not applying locally (would race the worktree reconciler); check `rt daemon status` and retry" };
    }
    if (!res.ok) return { via: "daemon", ok: false, error: res.error ?? "repos:reidentify failed", ...(res.data ? { report: res.data as ReidentifyReport } : {}) };
    return { via: "daemon", ok: true, report: res.data as ReidentifyReport };
  }
  const report = await reidentify(req.from, req.to, { dryRun });
  if ("error" in report) return { via: "local", ok: false, error: report.error };
  if (!report.ok) {
    const refused = report.stores.filter((s) => s.status === "refused").map((s) => s.store).join(", ");
    return { via: "local", ok: false, error: `refused: ${refused}`, report };
  }
  return { via: "local", ok: true, report };
}
