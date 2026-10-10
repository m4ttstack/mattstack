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

import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { bundleRootFromExec, HELPERS_DIR } from "../../bundle-layout.ts";
import { buildFlavor, type Flavor } from "../../flavor.ts";
import { DEV_TRAY_APP_BUNDLE } from "../../rt-paths.ts";
import { runCapture } from "../../subprocess.ts";

export const OWNER_AUTH_HELPER = "rt-owner-auth";

/** The helper refuses a longer reason (`OwnerAuthContract.maxReasonLength`). */
export const OWNER_AUTH_REASON_MAX = 300;

/** A person can take their time at the sheet; past this the helper is treated as failed. */
export const OWNER_AUTH_TIMEOUT_MS = 5 * 60_000;

export type OwnerAuthResult = { ok: true } | { ok: false; outcome: "cancelled" | "unavailable" | "failed"; message: string };

export type OwnerAuthRun = { exitCode: number; stdout: string; stderr: string };

export type OwnerAuthRunner = {
  /** The helper's path, or null when there is none to run. */
  locate: () => string | null;
  /** Null when the helper may run, else the plain refusal. */
  verify: (helper: string) => Promise<string | null>;
  run: (argv: [string, ...string[]], timeoutMs: number) => Promise<OwnerAuthRun>;
};

const MISSING =
  "rt cannot ask macOS to confirm it is you, because the mattstack app's Touch ID helper is not installed on this Mac. Nothing was trusted.";
const IN_TESTS = "rt never asks for Touch ID inside a test run. Nothing was trusted.";
const UNSIGNED_APP = "This copy of mattstack is not signed by its developer, so rt cannot check the Touch ID helper. Nothing was trusted.";
const FOREIGN_HELPER = "The Touch ID helper in this app is not the one mattstack signed, so rt did not run it. Nothing was trusted.";

export const OWNER_AUTH_HELPER_IDENTIFIER = `com.mattstack.helper.${OWNER_AUTH_HELPER}`;

export type CodesignRun = { exitCode: number; stdout: string; stderr: string };
export type CodesignRunner = (argv: [string, ...string[]]) => Promise<CodesignRun>;

export type OwnerAuthLookup = { flavor: Flavor; fromExec: string | null; home: string; exists: (path: string) => boolean };

/**
 * The flavor is the one rt was built as, never `MATTSTACK_FLAVOR`: a launcher
 * variable must not move a compiled build's lookup to a user-writable dev app.
 * Bundles only, and never one a setting names (`mattstack.appPath` is a file
 * any local process can write). Prod rt runs from its bundle, so it uses
 * that bundle alone; a dev or source run uses the dev app at its two fixed
 * install locations.
 */
export function locateOwnerAuthHelper(l: OwnerAuthLookup): string | null {
  const roots = l.flavor === "prod"
    ? l.fromExec === null ? [] : [l.fromExec]
    : [join("/Applications", DEV_TRAY_APP_BUNDLE), join(l.home, "Applications", DEV_TRAY_APP_BUNDLE)];
  for (const root of roots) {
    const path = join(root, HELPERS_DIR, OWNER_AUTH_HELPER);
    if (l.exists(path)) return path;
  }
  return null;
}

export function ownerAuthRequirement(team: string): string {
  return `anchor apple generic and certificate leaf[subject.OU] = "${team}" and identifier "${OWNER_AUTH_HELPER_IDENTIFIER}"`;
}

/**
 * The team comes from the running app's own signature, so a helper passes
 * only when the developer who signed this rt also signed it.
 */
export async function verifyOwnerAuthHelper(helper: string, bundle: string, codesign: CodesignRunner): Promise<string | null> {
  const shown = await codesign(["codesign", "-d", "--verbose=2", bundle]);
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(`${shown.stdout}\n${shown.stderr}`)?.[1];
  if (shown.exitCode !== 0 || team === undefined) return UNSIGNED_APP;
  const checked = await codesign(["codesign", "--verify", "--strict", "-R", `=${ownerAuthRequirement(team)}`, helper]);
  return checked.exitCode === 0 ? null : FOREIGN_HELPER;
}

const CODESIGN_TIMEOUT_MS = 30_000;

async function realCodesign(argv: [string, ...string[]]): Promise<CodesignRun> {
  const res = await runCapture(argv, { timeoutMs: CODESIGN_TIMEOUT_MS, stderr: "pipe", env: { PATH: "/usr/bin:/bin" } });
  return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
}

export type RealOwnerAuthOptions = { built?: Flavor; fromExec?: string | null; codesign?: CodesignRunner };

export function realOwnerAuthRunner(opts: RealOwnerAuthOptions = {}): OwnerAuthRunner {
  const built = opts.built ?? buildFlavor();
  const fromExec = opts.fromExec !== undefined ? opts.fromExec : bundleRootFromExec();
  const codesign = opts.codesign ?? realCodesign;
  return {
    locate: () => locateOwnerAuthHelper({ flavor: built, fromExec, home: process.env.HOME ?? homedir(), exists: existsSync }),
    verify: async (helper) => {
      if (built === "dev") return null;
      if (fromExec === null) return UNSIGNED_APP;
      return verifyOwnerAuthHelper(helper, fromExec, codesign);
    },
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
 * owner authentication. No helper, a helper that fails its signature check,
 * a test run, or any other answer refuses.
 */
export async function confirmOwner(reason: string, given?: OwnerAuthRunner, env: NodeJS.ProcessEnv = process.env): Promise<OwnerAuthResult> {
  if (given === undefined && env.NODE_ENV === "test") return { ok: false, outcome: "unavailable", message: IN_TESTS };
  const runner = given ?? realOwnerAuthRunner();
  const helper = runner.locate();
  if (helper === null) return { ok: false, outcome: "unavailable", message: MISSING };
  try {
    const refused = await runner.verify(helper);
    if (refused !== null) return { ok: false, outcome: "failed", message: refused };
  } catch (err) {
    return { ok: false, outcome: "failed", message: `rt could not check the Touch ID helper's signature (${err instanceof Error ? err.message : String(err)}), so rt trusted nothing.` };
  }
  try {
    return interpretOwnerAuth(await runner.run([helper, "--reason", reason], OWNER_AUTH_TIMEOUT_MS));
  } catch (err) {
    return { ok: false, outcome: "failed", message: `rt could not start the Touch ID check (${err instanceof Error ? err.message : String(err)}), so rt trusted nothing.` };
  }
}
