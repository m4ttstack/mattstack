/**
 * Ready-step engine: which steps a worktree freshen needs to run, and
 * running them.
 *
 * "changed" steps only fire when their glob matches a path that actually
 * changed since the worktree's last ready stamp; a null changed set (stamp
 * unknown to git, e.g. cold create) means run everything.
 */

import { runGit } from "./git-async.ts";
import { runCapture } from "../subprocess.ts";
import { warn } from "../ui/warn.ts";
import type { ReadyStep } from "./config.ts";

/**
 * Paths changed between readyStamp and HEAD, or null when readyStamp is
 * unknown to git (treat as "everything changed").
 */
export async function changedSince(worktreePath: string, readyStamp: string): Promise<string[] | null> {
  const r = await runGit(worktreePath, ["diff", "--name-only", `${readyStamp}..HEAD`]);
  if (r.exitCode !== 0) return null;
  return r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const CHANGED_WHEN_RE = /^changed:(.+)$/;

/**
 * changed === null → every step (cold create / unknown stamp). Otherwise:
 * steps whose `when` is "changed:<glob>" and the glob matches some changed
 * path; steps with no `when` are skipped.
 */
export function stepsToRun(steps: ReadyStep[], changed: string[] | null): ReadyStep[] {
  if (changed === null) return steps;

  return steps.filter((step) => {
    if (!step.when) return false;
    const match = CHANGED_WHEN_RE.exec(step.when);
    if (!match) return false;
    const glob = new Bun.Glob(match[1]!);
    return changed.some((path) => glob.match(path));
  });
}

/**
 * A minimal seed so the (absolute-path) login shell can start; its own
 * startup then rebuilds the full PATH for `worktreePath`. Inheriting the
 * daemon's boot-time PATH instead would replay a snapshot resolved in the
 * daemon's directory, whose entries shadow any directory-scoped toolchain
 * (version managers, direnv, project-local bins) that a step needs in-tree.
 */
const SEED_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const NVM_MISSING_MARKER = "__rt_nvm_missing__";

/**
 * nvm's installer writes its lines to ~/.zshrc, which a login shell never
 * reads, so each step loads nvm itself and switches to the tree's .nvmrc.
 * A pinned version nvm has not installed leaves nvm's default on PATH and
 * prints the marker line for the caller to log.
 */
const NVM_PRELUDE = [
  'if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then',
  '  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1',
  "  if [ -f .nvmrc ] && command -v nvm >/dev/null 2>&1 && ! nvm use --silent >/dev/null 2>&1; then",
  `    printf '%s %s\\n' ${NVM_MISSING_MARKER} "$(head -n 1 .nvmrc)" >&2`,
  "  fi",
  "fi",
].join("\n");

const NVM_MISSING_LINE = new RegExp(`^${NVM_MISSING_MARKER} (.*)\\n?`, "m");

/** Run ready steps in order via zsh, stopping at the first failure. */
export async function runReadySteps(
  worktreePath: string,
  steps: ReadyStep[],
): Promise<{ ok: true } | { ok: false; failedStep: string; output: string }> {
  let reportedMissingNvmVersion = false;
  for (const step of steps) {
    const r = await runCapture(["/bin/zsh", "-lc", `${NVM_PRELUDE}\n${step.run}`], {
      cwd: worktreePath,
      env: { ...process.env, PATH: SEED_PATH },
      timeoutMs: 15 * 60_000,
      stderr: "pipe",
    });
    const missing = NVM_MISSING_LINE.exec(r.stderr);
    const stderr = missing ? r.stderr.replace(NVM_MISSING_LINE, "") : r.stderr;
    if (missing && !reportedMissingNvmVersion) {
      reportedMissingNvmVersion = true;
      warn(
        "worktree",
        `${worktreePath}: .nvmrc asks for node ${missing[1]!.trim()}, which nvm has not installed; ready steps used nvm's default node`,
        { context: { worktreePath, nvmrc: missing[1]!.trim() } },
      );
    }
    if (r.exitCode !== 0) {
      let output = r.stdout + stderr;
      // 127 under a daemon is nearly always a PATH mystery: name the shell
      // contract so the failure is actionable instead of a silent backoff loop.
      if (r.exitCode === 127 || /command not found/.test(output)) {
        output += "\n(ready steps run under `zsh -lc`: ~/.zshenv and ~/.zprofile are sourced, ~/.zshrc is NOT. nvm is loaded from $NVM_DIR or ~/.nvm and .nvmrc picks its version; put PATH setup for any other tool in ~/.zshenv or ~/.zprofile)";
      }
      return { ok: false, failedStep: step.run, output };
    }
  }
  return { ok: true };
}
