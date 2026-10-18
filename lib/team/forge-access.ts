/**
 * Forge access for an org repo, the same on GitLab and GitHub: who may push
 * the org's data branch, and each person's repo membership level. rt reads
 * and writes it through `gh api` and `glab api` (forge.ts's CLI path), never
 * through glance, which stays read-only.
 */

import type { ExecResult, Probes } from "../setup/probes.ts";
import { classifyExecFailure, FORGE_API_TIMEOUT_MS, forgeArgv, type FailureReason } from "./forge.ts";

export type AccessLevel = "none" | "guest" | "read" | "write" | "admin";

export const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, guest: 1, read: 2, write: 3, admin: 4 };

export interface ForgeMember {
  username: string;
  level: AccessLevel;
  /** The level comes from a group, a team or the org's base permission rather than the repo's own member list. */
  inherited: boolean;
  /** Invited and not yet accepted (or awaiting approval): no access until then. */
  pending: boolean;
}

export type PushList =
  | { kind: "unprotected" }
  | { kind: "named"; users: string[] }
  /** Protected, but pushes are not limited to named people. */
  | { kind: "open"; why: string }
  /** This forge plan cannot protect the branch at all. */
  | { kind: "unavailable"; why: string };

export type ForgeResult<T> = { ok: true; value: T } | { ok: false; reason: FailureReason; manualSteps: string[] };

export interface OrgForgeAccess {
  readonly provider: "github" | "gitlab";
  defaultBranch(): Promise<ForgeResult<string>>;
  readPushList(branch: string): Promise<ForgeResult<PushList>>;
  /** Replaces the people named on the branch's push list. "cannot-name-users": this forge plan cannot name people, and the branch is left open to anyone with write. */
  setPushList(branch: string, usernames: string[]): Promise<ForgeResult<"set" | "cannot-name-users">>;
  readMembers(): Promise<ForgeResult<ForgeMember[]>>;
  /** Gives a person the repo level named. rt calls it only to raise someone (`accessDiff` never asks for less than they hold). "invited": the forge sent an invitation, and access starts when they accept. */
  grant(username: string, level: "read" | "write"): Promise<ForgeResult<"granted" | "invited">>;
  revoke(username: string): Promise<ForgeResult<"revoked">>;
  /** First-time protection of a branch that has none. */
  protect(branch: string): Promise<ForgeResult<"protected" | "unavailable">>;
}

export { FORGE_API_TIMEOUT_MS };

export interface ApiCall {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  fields?: string[];
  body?: unknown;
  paginate?: boolean;
}

/** A JSON body rides stdin (`--input -`), so arrays and objects reach the forge whole; `-f` fields stay scalars. */
export async function forgeApi(p: Probes, cli: "gh" | "glab", env: Record<string, string> | undefined, call: ApiCall): Promise<ExecResult> {
  const argv = [...forgeArgv(p, cli), "api", "-X", call.method, call.path];
  if (call.paginate) argv.push(...(cli === "gh" ? ["--paginate", "--slurp"] : ["--paginate"]));
  for (const field of call.fields ?? []) argv.push("-f", field);
  if (call.body !== undefined) argv.push("-H", "Content-Type: application/json", "--input", "-");
  return p.exec(argv, {
    ...(env ? { env } : {}),
    ...(call.body !== undefined ? { input: JSON.stringify(call.body) } : {}),
    timeoutMs: FORGE_API_TIMEOUT_MS,
  });
}

export function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/** Splits stdout into its top-level JSON values; null when any part is not JSON. */
function jsonValues(stdout: string): unknown[] | null {
  const values: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = 0; i < stdout.length; i++) {
    const ch = stdout.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      if (depth === 0) return null;
      inString = true;
    } else if (ch === "[" || ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) {
        const value = parseJson(stdout.slice(start, i + 1));
        if (value === null) return null;
        values.push(value);
      }
    } else if (depth === 0 && !/\s/.test(ch)) return null;
  }
  return depth === 0 && !inString ? values : null;
}

/** gh's `--paginate --slurp` wraps each page in an outer array; glab's `--paginate` prints one array per page, back to back. */
export function pagedList(stdout: string, cli: "gh" | "glab"): Record<string, unknown>[] | null {
  let items: unknown[];
  if (cli === "gh") {
    const parsed = parseJson(stdout);
    if (!Array.isArray(parsed)) return null;
    items = parsed.flat(1);
  } else {
    const pages = jsonValues(stdout);
    if (pages === null || pages.length === 0 || !pages.every(Array.isArray)) return null;
    items = (pages as unknown[][]).flat(1);
  }
  return items.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item));
}

export function apiText(r: Pick<ExecResult, "stdout" | "stderr">): string {
  return `${r.stdout}\n${r.stderr}`;
}

export function httpStatus(r: Pick<ExecResult, "stdout" | "stderr">): number | null {
  const match = /HTTP (\d{3})/.exec(apiText(r));
  return match ? Number(match[1]) : null;
}

export function done<T>(value: T): ForgeResult<T> {
  return { ok: true, value };
}

export function leadStep(reason: FailureReason, cli: "gh" | "glab"): string | null {
  const forge = cli === "gh" ? "GitHub" : "GitLab";
  switch (reason) {
    case "not-installed":
      return `Install the ${forge} command line tool, then sign in: ${cli} auth login`;
    case "not-authenticated":
      return `Sign in, then run this again: ${cli} auth login`;
    case "org-policy":
      return "Let the command line tool's token through your organization's single sign-on, then try again";
    case "insufficient-permission":
      return `Your ${forge} account can't change access on this repo. Someone who administers it does this by hand:`;
    case "unknown-handle":
    case "other":
      return null;
  }
}

/** A refused forge call as the steps a person does by hand: why it failed first, when the CLI's words say, then the forge page. */
export function refusal<T>(r: Pick<ExecResult, "code" | "stdout" | "stderr">, cli: "gh" | "glab", steps: string[]): ForgeResult<T> {
  const reason = classifyExecFailure(r);
  const lead = leadStep(reason, cli);
  return { ok: false, reason, manualSteps: lead ? [lead, ...steps] : steps };
}
