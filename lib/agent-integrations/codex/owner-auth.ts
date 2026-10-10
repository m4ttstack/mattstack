/**
 * The person-only proof behind every Codex hook approval: macOS's own
 * Touch ID or login-password sheet, shown by the app bundle's
 * `rt-owner-auth` helper (rt-tray/Sources-owner-auth). rt runs the helper
 * itself and reads its answer; nothing a caller passes can stand in for it.
 *
 * The helper's contract, shared with `OwnerAuthContract` in the tray's core:
 * argv `--reason <text>`; one word on stdout (`authenticated`, `cancelled`,
 * `unavailable`, `failed`) and exit 0, 1, 3 or 4 to match; 64 for bad usage.
 * Only exit 0 together with `authenticated` counts.
 */

import { join } from "path";
import { existsSync } from "fs";
import { appBundleRoot, HELPERS_DIR } from "../../bundle-layout.ts";
import { runCapture } from "../../subprocess.ts";

export const OWNER_AUTH_HELPER = "rt-owner-auth";

/** A person can take their time at the sheet; past this the helper is treated as failed. */
export const OWNER_AUTH_TIMEOUT_MS = 5 * 60_000;

export type OwnerAuthResult = { ok: true } | { ok: false; outcome: "cancelled" | "unavailable" | "failed"; message: string };

export type OwnerAuthRun = { exitCode: number; stdout: string; stderr: string };

export type OwnerAuthRunner = {
  /** The helper's path, or null when there is none to run. */
  locate: () => string | null;
  run: (argv: [string, ...string[]], timeoutMs: number) => Promise<OwnerAuthRun>;
};

const MISSING =
  "rt cannot ask macOS to confirm it is you, because the mattstack app's Touch ID helper is not installed on this Mac. Nothing was trusted.";
const IN_TESTS = "rt never asks for Touch ID inside a test run. Nothing was trusted.";

/** Only the bundle's own copy: a source checkout is not where a person's approval should come from. */
export function ownerAuthHelperPath(bundleRoot: string | null, exists: (path: string) => boolean): string | null {
  if (bundleRoot === null) return null;
  const path = join(bundleRoot, HELPERS_DIR, OWNER_AUTH_HELPER);
  return exists(path) ? path : null;
}

export function realOwnerAuthRunner(): OwnerAuthRunner {
  return {
    locate: () => ownerAuthHelperPath(appBundleRoot(), existsSync),
    run: async (argv, timeoutMs) => {
      const res = await runCapture(argv, { timeoutMs, stderr: "pipe", env: { PATH: process.env.PATH } });
      return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
    },
  };
}

export function interpretOwnerAuth(res: OwnerAuthRun): OwnerAuthResult {
  const word = res.stdout.trim();
  const said = res.stderr.trim();
  if (res.exitCode === 0 && word === "authenticated") return { ok: true };
  if (res.exitCode === 1 && word === "cancelled") return { ok: false, outcome: "cancelled", message: "You cancelled the Touch ID check, so rt trusted nothing." };
  if (res.exitCode === 3 && word === "unavailable") {
    return { ok: false, outcome: "unavailable", message: `macOS cannot confirm it is you here${said ? ` (${said})` : ""}, so rt trusted nothing.` };
  }
  return { ok: false, outcome: "failed", message: `macOS did not confirm it was you${said ? ` (${said})` : ""}, so rt trusted nothing.` };
}

/**
 * Shows macOS's owner check with `reason` and resolves ok only on a real
 * owner authentication. No helper, a test run, or any other answer refuses.
 */
export async function confirmOwner(reason: string, given?: OwnerAuthRunner, env: NodeJS.ProcessEnv = process.env): Promise<OwnerAuthResult> {
  if (given === undefined && env.NODE_ENV === "test") return { ok: false, outcome: "unavailable", message: IN_TESTS };
  const runner = given ?? realOwnerAuthRunner();
  const helper = runner.locate();
  if (helper === null) return { ok: false, outcome: "unavailable", message: MISSING };
  try {
    return interpretOwnerAuth(await runner.run([helper, "--reason", reason], OWNER_AUTH_TIMEOUT_MS));
  } catch (err) {
    return { ok: false, outcome: "failed", message: `rt could not start the Touch ID check (${err instanceof Error ? err.message : String(err)}), so rt trusted nothing.` };
  }
}
