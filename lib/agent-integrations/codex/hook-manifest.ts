/**
 * The Codex hook definitions that enforce mattstack policy: one PreToolUse
 * and one Stop entry, each running a fixed absolute rt executable as
 * `rt agent policy-hook`. Codex trusts a hook by the exact hash of its
 * definition, so the command is spelled one way only and a manifest that
 * differs by a byte is another manifest. The executable carries its version
 * in its path, which is how a script-content change shows up here.
 *
 * This module only describes the manifest; installing and reviewing it
 * belongs to setup, and the policy adapter only reads what is installed.
 */

import { createHash } from "crypto";
import { isAbsolute } from "path";

export const CODEX_POLICY_EVENTS = ["PreToolUse", "Stop"] as const;

/**
 * The policy capabilities Codex's hooks are proven to enforce, per mode.
 * Headless: live-12/13/14 proved question refusal, Stop continuation with its
 * cap, cancellation and session readiness on headless threads. Herdr: no live
 * run has exercised a terminal-attached thread, so nothing is claimed there.
 */
export const CODEX_PROVEN_POLICY: Readonly<Record<"herdr" | "headless", readonly ("gate-policy" | "continuation-policy")[]>> = {
  headless: ["gate-policy", "continuation-policy"],
  herdr: [],
};
export type CodexPolicyEvent = (typeof CODEX_POLICY_EVENTS)[number];

/** Bumped whenever the command's shape changes, so an installed older shape reads as another revision. */
export const CODEX_POLICY_MANIFEST_VERSION = 2;

/**
 * Codex's own budget for each hook run. The policy's daemon round trip is
 * bounded at half of it, as the Claude question hook's is.
 */
export const CODEX_POLICY_HOOK_TIMEOUT_SECONDS = 10;

const INSTALLATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Hook payloads and receipts reject control characters in every field, so no value can forge a log line or feedback row. */
export const CONTROL = /[\u0000-\u001f\u007f]/;
export const MAX_ID_LENGTH = 200;
export const MAX_PATH_LENGTH = 4096;

export const plainText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && !CONTROL.test(v);

export type CodexHookHandler = { type: "command"; command: string; timeout: number };
export type CodexHookGroup = { hooks: CodexHookHandler[] };
export type CodexPolicyHooks = Record<CodexPolicyEvent, CodexHookGroup[]>;
export type CodexPolicyManifest = { revision: string; hooks: CodexPolicyHooks };

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The executable is named twice: once to run, and once as `--executable`,
 * so the hook names the manifest it belongs to by the path the manifest
 * wrote. A wrapper script, a symlink or rt run from source runs as another
 * process (process.execPath names bun or the wrapped binary), which would
 * otherwise name a revision the installed manifest never had.
 */
export function codexPolicyHookCommand(executable: string, installationId: string, event: CodexPolicyEvent): string {
  return `${quote(executable)} agent policy-hook --installation ${quote(installationId)} --event ${quote(event)} --executable ${quote(executable)}`;
}

/** The parts of a command this manifest wrote, or null for any other command. */
export function parseCodexPolicyHookCommand(command: string): { executable: string; installationId: string; event: CodexPolicyEvent } | null {
  const match = /^'((?:[^']|'\\'')+)' agent policy-hook --installation '([^']+)' --event '([A-Za-z]+)' --executable '(?:[^']|'\\'')+'$/.exec(command);
  if (!match) return null;
  const executable = match[1]!.replaceAll(`'\\''`, "'");
  const [installationId, event] = [match[2]!, match[3]!];
  if (!(CODEX_POLICY_EVENTS as readonly string[]).includes(event)) return null;
  if (codexPolicyHookCommand(executable, installationId, event as CodexPolicyEvent) !== command) return null;
  return { executable, installationId, event: event as CodexPolicyEvent };
}

export function validInstallationId(value: unknown): value is string {
  return typeof value === "string" && INSTALLATION_ID.test(value);
}

export function codexPolicyManifest(input: { executable: string; installationId: string }): CodexPolicyManifest {
  const { executable, installationId } = input;
  if (typeof executable !== "string" || !isAbsolute(executable) || CONTROL.test(executable)) {
    throw new Error("the policy hook's executable must be an absolute path with no control characters");
  }
  if (!validInstallationId(installationId)) {
    throw new Error("the policy hook's installation id must be 1 to 64 letters, digits, dots, dashes or underscores");
  }
  const hooks = Object.fromEntries(CODEX_POLICY_EVENTS.map((event) => [event, [{
    hooks: [{ type: "command", command: codexPolicyHookCommand(executable, installationId, event), timeout: CODEX_POLICY_HOOK_TIMEOUT_SECONDS }],
  }]])) as CodexPolicyHooks;
  const revision = createHash("sha256").update(JSON.stringify({ version: CODEX_POLICY_MANIFEST_VERSION, hooks })).digest("hex");
  return { revision, hooks };
}
