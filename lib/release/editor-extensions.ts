import { UserActionableError } from "../errors.ts";
import type { RunResult } from "../subprocess.ts";

type Exec = (argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }) => Promise<RunResult>;

/** Each editor extension under extensions/vscode and the build.sh variable that bundles its .vsix (release.yml sets the same two). */
const EDITOR_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
  ["rt-context", "RT_VSIX"],
  ["skill-blocks", "RT_SKILL_BLOCKS_VSIX"],
];

const PACKAGE_TIMEOUT_MS = 600_000;

function failure(ext: string, r: RunResult): UserActionableError {
  const detail = `${r.stderr}\n${r.stdout}`.trim().split("\n").slice(-5).join("\n");
  return new UserActionableError("dev-app-extension-failed", `packaging the ${ext} editor extension failed${detail ? `: ${detail}` : ""}`);
}

/** Builds and packages both editor extensions in a checkout at `root`, each to a fixed path, and returns the variables build.sh bundles them from. */
export async function packageEditorExtensions(exec: Exec, root: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [ext, envName] of EDITOR_EXTENSIONS) {
    const dir = `${root}/extensions/vscode/${ext}`;
    const out = `${dir}/${ext}.vsix`;
    const built = await exec(["bun", "run", "build"], { cwd: dir, timeoutMs: PACKAGE_TIMEOUT_MS });
    if (built.exitCode !== 0) throw failure(ext, built);
    const packaged = await exec(["bunx", "vsce", "package", "--no-dependencies", "--out", out], { cwd: dir, timeoutMs: PACKAGE_TIMEOUT_MS });
    if (packaged.exitCode !== 0) throw failure(ext, packaged);
    env[envName] = out;
  }
  return env;
}
