import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export function runsRoot(): string {
  return process.env.RT_RUNS_ROOT ?? join(homedir(), ".mattstack", "runs");
}

// repo/runId reach a path join straight from a network-reachable readonly
// seam (runs:get via REST decodes %2F): reject anything that could step
// outside <runsRoot>/<repo>/<runId> before it ever hits the filesystem.
export function isPathComponent(s: string): boolean {
  return s.length > 0 && s !== "." && s !== ".." && !s.includes("/") && !s.includes("\\");
}

export function runDirExists(runId: string): boolean {
  if (!isPathComponent(runId)) return false;
  const root = runsRoot();
  let repos: string[];
  try {
    repos = readdirSync(root);
  } catch (err) {
    // Only a missing runs root means no runs; any other failure must read as "keep", since false lets the gates sweep delete.
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
  return repos.some((repo) => existsSync(join(root, repo, runId)));
}
