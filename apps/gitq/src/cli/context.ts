import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface CliContext {
  /** Absolute repo worktree root (git rev-parse --show-toplevel). */
  repoRoot: string;
  /** Absolute git dir (worktree-safe; where pause files live). */
  gitDir: string;
  json: boolean;
  /** Positional args after the command name. */
  args: string[];
  flags: Record<string, string | boolean>;
}

/** Resolve repo paths from a starting directory (the -C value or cwd). */
export async function createContext(
  startDir: string,
  args: string[],
  flags: Record<string, string | boolean>,
): Promise<CliContext> {
  const [{ stdout: top }, { stdout: gitDir }] = await Promise.all([
    exec('git', ['rev-parse', '--show-toplevel'], { cwd: startDir }),
    exec('git', ['rev-parse', '--absolute-git-dir'], { cwd: startDir }),
  ]);
  return {
    repoRoot: top.trim(),
    gitDir: gitDir.trim(),
    json: flags.json === true,
    args,
    flags,
  };
}
