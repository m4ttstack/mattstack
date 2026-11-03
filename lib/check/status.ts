import { hostname as osHostname } from "os";
import { isGitLabRemote } from "../enrich.ts";
import { repoHost, repoLabelQualified } from "../repo-label.ts";
import { runCapture } from "../subprocess.ts";
import { warn } from "../ui/warn.ts";
import type { CheckResult } from "./run.ts";
import { describe, type CheckVerdict } from "./summary.ts";

export const STATUS_CONTEXT = "rt/local-check";

const GH_TIMEOUT_MS = 15_000;

export type StatusState = "success" | "failure" | "error";

export type StatusOutcome =
  | { posted: true; context: string; state: StatusState; description: string }
  | {
      posted: false;
      reason: "dirty-tree" | "gitlab-not-supported" | "unknown-host" | "gh-failed" | "not-on-remote";
      detail?: string;
    };

export type StatusDeps = { exec: typeof runCapture; hostname: () => string };

export const realStatusDeps: StatusDeps = { exec: runCapture, hostname: osHostname };

export function stateFor(verdict: CheckVerdict): StatusState {
  return verdict === "green" ? "success" : verdict === "red" ? "failure" : "error";
}

export async function postStatus(
  identity: string,
  sha: string,
  result: Extract<CheckResult, { configured: true }>,
  deps: StatusDeps,
): Promise<StatusOutcome> {
  if (result.dirty) return { posted: false, reason: "dirty-tree" };
  const host = repoHost(identity);
  if (host !== "github.com") {
    return { posted: false, reason: host && isGitLabRemote(`https://${host}/x/y`) ? "gitlab-not-supported" : "unknown-host" };
  }

  const state = stateFor(result.verdict);
  const machine = deps.hostname().split(".")[0] ?? "";
  const description = describe(result.verdict, result.summary, machine, result.reason);
  const run = await deps.exec(
    [
      "gh", "api", `repos/${repoLabelQualified(identity)}/statuses/${sha}`,
      "-f", `state=${state}`,
      "-f", `context=${STATUS_CONTEXT}`,
      "-f", `description=${description}`,
    ],
    { stderr: "pipe", timeoutMs: GH_TIMEOUT_MS },
  );
  if (run.exitCode !== 0) {
    const detail = run.stderr.trim() || `gh exited ${run.exitCode}`;
    warn("check", `could not post commit status: ${detail}`, {
      show: { title: `rt could not post the local check's status: ${detail}` },
    });
    return { posted: false, reason: "gh-failed", detail };
  }
  return { posted: true, context: STATUS_CONTEXT, state, description };
}
