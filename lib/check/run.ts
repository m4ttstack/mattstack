import { getSetting } from "../settings/resolve.ts";
import { parseIdentity } from "../settings/identity.ts";
import { identityForRootReadOnly } from "../repo.ts";
import { childEnv, runCapture } from "../subprocess.ts";
import type { GitRunner } from "../mcp/git-tools.ts";
import { parseSummary, type CheckSummary, type CheckVerdict } from "./summary.ts";

export type CheckConfig = { command: string; timeoutSeconds: number };

export type CheckResult =
  | {
      configured: true;
      verdict: CheckVerdict;
      summary: CheckSummary;
      sha: string;
      base: string;
      /** Tracked modifications or non-ignored untracked files. */
      dirty: boolean;
      command: string;
      reason?: string;
      outputTail: string;
      fromCache: boolean;
    }
  | { configured: false };

export type RunDeps = {
  git: GitRunner;
  exec: typeof runCapture;
  /** Takes the serialized (wire) identity; the settings sections key on the raw form. */
  setting: (repoIdentity: string) => { command?: string; timeoutSeconds?: number };
  now: () => number;
};

const DEFAULT_TIMEOUT_SECONDS = 600;
const TAIL_LINES = 20;

export const realSetting: RunDeps["setting"] = (repoIdentity) => {
  const parsed = parseIdentity(repoIdentity);
  // A path-kind repo has no host/path, so no repo-scoped settings section.
  if (parsed?.kind !== "remote") return {};
  const value = getSetting<unknown>("rt.check", { repoIdentity: parsed.id }).value;
  return value && typeof value === "object" ? (value as { command?: string; timeoutSeconds?: number }) : {};
};

export function readConfig(tree: string, deps: Pick<RunDeps, "setting">): CheckConfig | null {
  const raw = deps.setting(identityForRootReadOnly(tree));
  if (typeof raw.command !== "string" || raw.command === "") return null;
  return { command: raw.command, timeoutSeconds: raw.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS };
}

async function gitOut(git: GitRunner, args: string[], cwd: string): Promise<string | null> {
  const r = await git(args, cwd);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function treeState(tree: string, deps: Pick<RunDeps, "git">): Promise<{ sha: string; dirty: boolean }> {
  const sha = (await gitOut(deps.git, ["rev-parse", "--verify", "HEAD"], tree)) ?? "";
  const status = (await gitOut(deps.git, ["status", "--porcelain"], tree)) ?? "";
  return { sha, dirty: status !== "" };
}

async function mergeBase(tree: string, git: GitRunner): Promise<{ base: string; branch: string }> {
  const head = await gitOut(git, ["symbolic-ref", "refs/remotes/origin/HEAD"], tree);
  const branch = head?.replace(/^refs\/remotes\/origin\//, "") || "main";
  return { base: (await gitOut(git, ["merge-base", "HEAD", `origin/${branch}`], tree)) ?? "", branch };
}

export async function runCheck(
  tree: string,
  opts: { full?: boolean; base?: string; signal?: AbortSignal },
  deps: RunDeps,
): Promise<CheckResult> {
  const config = readConfig(tree, deps);
  if (!config) return { configured: false };

  const { sha, dirty } = await treeState(tree, deps);
  let base = opts.base ?? "";
  if (!opts.base) {
    const found = await mergeBase(tree, deps.git);
    if (!found.base) {
      return {
        configured: true,
        verdict: "error",
        summary: parseSummary("", -1, 0),
        sha,
        base: "",
        dirty,
        command: config.command,
        reason: `could not find the merge base with origin/${found.branch}`,
        outputTail: "",
        fromCache: false,
      };
    }
    base = found.base;
  }

  const started = deps.now();
  const run = await deps.exec(["/bin/sh", "-c", config.command], {
    cwd: tree,
    stderr: "pipe",
    timeoutMs: config.timeoutSeconds * 1000,
    ...(opts.signal && { signal: opts.signal }),
    env: {
      ...childEnv(),
      RT_CHECK_BASE: base,
      RT_CHECK_HEAD: sha,
      RT_CHECK_TREE: tree,
      ...(opts.full ? { RT_CHECK_FULL: "1" } : {}),
    },
  });
  const wallMs = deps.now() - started;

  let verdict: CheckVerdict;
  let reason: string | undefined;
  if (run.timedOut) {
    verdict = "error";
    reason = `timed out after ${config.timeoutSeconds}s`;
  } else if (run.exitCode === -1 || run.exitCode === 127) {
    verdict = "error";
    reason = `command could not start: ${run.stderr.trim() || config.command}`;
  } else {
    verdict = run.exitCode === 0 ? "green" : "red";
  }

  const outputTail = (run.stdout + run.stderr).trim().split("\n").slice(-TAIL_LINES).join("\n");
  return {
    configured: true,
    verdict,
    summary: parseSummary(run.stdout, run.exitCode, wallMs),
    sha,
    base,
    dirty,
    command: config.command,
    ...(reason ? { reason } : {}),
    outputTail,
    fromCache: false,
  };
}
