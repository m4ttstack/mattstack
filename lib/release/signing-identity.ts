import type { RunResult } from "../subprocess.ts";

export const REBUILD_NEEDS_CERT =
  "Rebuilding the dev app needs the maintainers' signing certificate. You only need it for tray changes: your rt, app and skill changes already run from your clone.";

/** The same check rt-tray/build.sh makes before it signs; without one, a build is signed ad hoc and resets macOS permissions. */
export async function hasDeveloperIdIdentity(
  exec: (argv: [string, ...string[]]) => Promise<RunResult>,
): Promise<boolean> {
  const r = await exec(["security", "find-identity", "-v", "-p", "codesigning"]);
  return r.exitCode === 0 && r.stdout.includes("Developer ID Application");
}

export interface RebuildGuardDeps {
  exec(argv: [string, ...string[]]): Promise<RunResult>;
  notify(title: string, message: string): void;
  print(line: string): void;
}

/** The tray only shows "last try failed" for a failed rebuild, so the reason travels as a notification and a log line. */
export async function rebuildGuard(deps: RebuildGuardDeps): Promise<boolean> {
  if (await hasDeveloperIdIdentity(deps.exec)) return true;
  deps.print(`✗ ${REBUILD_NEEDS_CERT}`);
  deps.notify("Dev app not rebuilt", REBUILD_NEEDS_CERT);
  return false;
}
