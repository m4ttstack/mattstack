import { getSetting } from "../settings/resolve.ts";
import { parseIdentity } from "../settings/identity.ts";
import { identityForRootReadOnly } from "../repo.ts";
import { childEnv, runCapture } from "../subprocess.ts";
import type { GitRunner } from "../mcp/git-tools.ts";
import { remoteDefault } from "../mcp/remote-default.ts";
import { parseSummary, type CheckSummary, type CheckVerdict } from "./summary.ts";

export type CheckConfig = { command: string; timeoutSeconds: number };

export type CheckResult = Configured | { configured: false };

export type Configured = {
  configured: true;
  verdict: CheckVerdict;
  summary: CheckSummary;
  sha: string;
  base: string;
  /** Tracked modifications or non-ignored untracked files. */
  dirty: boolean;
  command: string;
  /** Local only: it can hold the command's raw output, so it never goes to a forge. */
  reason?: string;
  timedOutAfter?: number;
  /** The command never started, so there is no verdict to post. */
  notRun?: boolean;
  /** HEAD changed during the run; `dirty` is set too, so nothing is cached. */
  headMoved?: boolean;
  outputTail: string;
  fromCache: boolean;
};

export type RunDeps = {
  git: GitRunner;
  exec: typeof runCapture;
  /** Takes the serialized (wire) identity; the settings sections key on the raw form. The tree fills ${repoRoot}. */
  setting: (repoIdentity: string, tree: string) => { command?: string; timeoutSeconds?: number };
  now: () => number;
};

const DEFAULT_TIMEOUT_SECONDS = 600;
const TAIL_LINES = 20;
const EXCERPT_LINES = 60;
const MAX_LINES_BEFORE_FAIL = 30;
const LINES_BEFORE_FAIL = 10;
const SOURCE_LINES = 8;
const LINES_AFTER_CRASH = 15;
const ANSI = /\x1b\[[0-9;]*m/g;
const CRASH = "# Unhandled error between tests";
const FILE_HEADER = /^\S+\.(test|spec)\.tsx?:$/;

type Block = { start: number; end: number };

// bun prints a failure's source and `error:` line, then its diff or stack, then
// `(fail)`; a crash prints its marker first and the error after it. A full
// suite's last lines are whatever the slowest shard printed, so a red run's
// excerpt is each failure's own lines.
export function failureExcerpt(output: string): string {
  const lines = output.trim().split("\n");
  const plain = lines.map((line) => line.replace(ANSI, ""));
  const blocks: Block[] = [];
  let floor = 0;
  plain.forEach((line, i) => {
    if (FILE_HEADER.test(line)) floor = i + 1;
    if (line === CRASH) {
      let end = i;
      while (end + 1 < plain.length && end - i < LINES_AFTER_CRASH && !plain[end + 1]!.startsWith("(fail) ") && plain[end + 1] !== CRASH) end++;
      blocks.push({ start: i, end });
      floor = end + 1;
      return;
    }
    if (!line.startsWith("(fail) ")) return;
    const lowest = Math.max(floor, i - MAX_LINES_BEFORE_FAIL);
    let error = -1;
    for (let j = i - 1; j >= lowest; j--) {
      if (plain[j]!.startsWith("error:")) {
        error = j;
        break;
      }
    }
    const start = error === -1 ? Math.max(lowest, i - LINES_BEFORE_FAIL) : Math.max(lowest, error - SOURCE_LINES);
    blocks.push({ start, end: i });
    floor = i + 1;
  });
  if (blocks.length === 0) return lines.slice(-TAIL_LINES).join("\n");

  const picked: string[] = [];
  let shown = 0;
  for (const { start, end } of blocks) {
    const block = lines.slice(start, end + 1);
    if (shown > 0 && picked.length + block.length + 1 > EXCERPT_LINES) break;
    if (shown > 0) picked.push("...");
    picked.push(...block);
    shown++;
  }
  if (shown < blocks.length) picked.push(`... and ${blocks.length - shown} more`);
  return picked.join("\n");
}

export const realSetting: RunDeps["setting"] = (repoIdentity, tree) => {
  const parsed = parseIdentity(repoIdentity);
  // A path-kind repo has no host/path, so no repo-scoped settings section.
  if (parsed?.kind !== "remote") return {};
  const value = getSetting<unknown>("rt.check", { repoIdentity: parsed.id, expandCtx: { repoRoot: tree } }).value;
  return value && typeof value === "object" ? (value as { command?: string; timeoutSeconds?: number }) : {};
};

export function readConfig(tree: string, deps: Pick<RunDeps, "setting">): CheckConfig | null {
  const raw = deps.setting(identityForRootReadOnly(tree), tree);
  if (typeof raw.command !== "string" || raw.command === "") return null;
  return { command: raw.command, timeoutSeconds: raw.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS };
}

export function hasCheck(tree: string, deps: Pick<RunDeps, "setting">): boolean {
  try {
    return readConfig(tree, deps) !== null;
  } catch {
    return true;
  }
}

async function gitOut(git: GitRunner, args: string[], cwd: string): Promise<string | null> {
  const r = await git(args, cwd);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function treeState(tree: string, deps: Pick<RunDeps, "git">): Promise<{ sha: string; dirty: boolean }> {
  const sha = (await gitOut(deps.git, ["rev-parse", "--verify", "HEAD"], tree)) ?? "";
  const status = await gitOut(deps.git, ["status", "--porcelain"], tree);
  return { sha, dirty: status !== "" };
}

async function mergeBase(tree: string, git: GitRunner): Promise<{ base: string; branch: string }> {
  const branch = (await remoteDefault(tree, git))?.primary ?? "main";
  return { base: (await gitOut(git, ["merge-base", "HEAD", `origin/${branch}`], tree)) ?? "", branch };
}

export function stopped(reason: string, at: { sha: string; dirty: boolean }, command: string, base = ""): Configured {
  return {
    configured: true,
    verdict: "error",
    summary: parseSummary("", -1, 0),
    sha: at.sha,
    base,
    dirty: at.dirty,
    command,
    reason,
    ...(at.sha === "" ? { notRun: true } : {}),
    outputTail: "",
    fromCache: false,
  };
}

export async function runCheck(
  tree: string,
  opts: { full?: boolean; base?: string; signal?: AbortSignal },
  deps: RunDeps,
): Promise<CheckResult> {
  const config = readConfig(tree, deps);
  if (!config) return { configured: false };

  const state = await treeState(tree, deps);
  const { sha, dirty } = state;
  if (sha === "") return stopped("could not read HEAD", state, config.command);
  let base = opts.base ?? "";
  if (opts.base) {
    const commit = await gitOut(deps.git, ["rev-parse", "--verify", "--end-of-options", `${opts.base}^{commit}`], tree);
    if (commit === null) return { ...stopped(`${opts.base} is not a commit`, state, config.command, opts.base), notRun: true };
  } else {
    const found = await mergeBase(tree, deps.git);
    if (!found.base) return stopped(`could not find the merge base with origin/${found.branch}`, state, config.command);
    base = found.base;
  }

  const env: Record<string, string | undefined> = { ...childEnv(), RT_CHECK_BASE: base, RT_CHECK_HEAD: sha, RT_CHECK_TREE: tree };
  delete env.RT_CHECK_FULL;
  if (opts.full) env.RT_CHECK_FULL = "1";

  const started = deps.now();
  const run = await deps.exec(["/bin/sh", "-c", config.command], {
    cwd: tree,
    stderr: "pipe",
    timeoutMs: config.timeoutSeconds * 1000,
    ...(opts.signal && { signal: opts.signal }),
    env,
  });
  const wallMs = deps.now() - started;

  const summary = parseSummary(run.stdout, run.exitCode, wallMs);
  let verdict: CheckVerdict;
  let reason: string | undefined;
  if (run.timedOut) {
    verdict = "error";
    reason = `timed out after ${config.timeoutSeconds}s`;
  } else if (run.exitCode === -1 || run.exitCode === 127) {
    verdict = "error";
    reason = `command could not start: ${run.stderr.trim() || config.command}`;
  } else if (summary.mode === "error") {
    verdict = "error";
    reason = "its command reported an error";
  } else {
    verdict = run.exitCode === 0 ? "green" : "red";
  }

  const output = run.stdout + run.stderr;
  const tail = verdict === "red" ? failureExcerpt(output) : output.trim().split("\n").slice(-TAIL_LINES).join("\n");
  const after = await treeState(tree, deps);
  return {
    configured: true,
    verdict,
    summary,
    sha,
    base,
    dirty: dirty || after.dirty || after.sha !== sha,
    ...(after.sha !== sha ? { headMoved: true } : {}),
    command: config.command,
    ...(reason ? { reason } : {}),
    ...(run.timedOut ? { timedOutAfter: config.timeoutSeconds } : {}),
    outputTail: verdict === "green" ? "" : tail,
    fromCache: false,
  };
}
