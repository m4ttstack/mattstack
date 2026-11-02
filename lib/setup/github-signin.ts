/**
 * GitHub OAuth device flow and the sign-in record the this-mac row reads.
 * Pure over Probes: no browser, no process spawn.
 */

import { join } from "path";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "./probes.ts";
import { pidAlive } from "./update-lock.ts";

export const GITHUB_OAUTH_CLIENT_ID: string = "";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const TIMEOUT_MS = 15000;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSec: number;
  expiresAt: string;
}

export type PollResult =
  | { kind: "token"; token: string }
  | { kind: "pending" }
  | { kind: "slow-down"; intervalSec: number }
  | { kind: "expired" }
  | { kind: "declined" };

function parseJson(body: string): Record<string, unknown> {
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

const FORM_HEADERS = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" };

export async function requestDeviceCode(p: Pick<Probes, "fetch" | "now">, clientId: string = GITHUB_OAUTH_CLIENT_ID): Promise<DeviceCode> {
  if (!clientId) throw new UserActionableError("github-signin-unavailable", "GitHub sign-in isn't set up in this build");
  const res = await p.fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: form({ client_id: clientId, scope: "repo" }),
    timeoutMs: TIMEOUT_MS,
  });
  const j = parseJson(res.body);
  if (res.status !== 200 || typeof j.device_code !== "string" || typeof j.user_code !== "string") {
    const cause = typeof j.error === "string" ? j.error : `HTTP ${res.status}`;
    throw new UserActionableError("github-signin-failed", "GitHub didn't start a sign-in", {}, { why: `GitHub answered: ${cause}` });
  }
  const expiresIn = typeof j.expires_in === "number" ? j.expires_in : 900;
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: typeof j.verification_uri === "string" ? j.verification_uri : "https://github.com/login/device",
    intervalSec: typeof j.interval === "number" ? j.interval : 5,
    expiresAt: new Date(p.now().getTime() + expiresIn * 1000).toISOString(),
  };
}

export async function pollDeviceToken(p: Pick<Probes, "fetch">, deviceCode: string, clientId: string = GITHUB_OAUTH_CLIENT_ID): Promise<PollResult> {
  const res = await p.fetch(TOKEN_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: form({ client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    timeoutMs: TIMEOUT_MS,
  });
  const j = parseJson(res.body);
  if (typeof j.access_token === "string" && j.access_token) return { kind: "token", token: j.access_token };
  switch (j.error) {
    case "slow_down":
      return { kind: "slow-down", intervalSec: typeof j.interval === "number" ? j.interval : 10 };
    case "expired_token":
      return { kind: "expired" };
    case "access_denied":
      return { kind: "declined" };
    default:
      return { kind: "pending" };
  }
}

export async function githubLoginIfCanCreateRepos(p: Pick<Probes, "fetch">, token: string): Promise<string | null> {
  const res = await p.fetch(USER_URL, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    timeoutMs: TIMEOUT_MS,
  });
  if (res.status !== 200) return null;
  const scopes = (res.headers["x-oauth-scopes"] ?? "").split(",").map((s) => s.trim());
  if (!scopes.includes("repo")) return null;
  const login = parseJson(res.body).login;
  return typeof login === "string" && login ? login : null;
}

export interface GitHubSignIn {
  userCode: string;
  url: string;
  expiresAt: string;
  pid: number | null;
  outcome?: "expired" | "declined";
}

type RecordProbes = Pick<Probes, "home" | "readFile" | "writeFile" | "rename" | "removeFile" | "mkdirp" | "now">;

function recordPath(p: Pick<Probes, "home">): string {
  return join(p.home, ".mattstack", "rt", "logins", "github.json");
}

export function writeGitHubSignIn(p: RecordProbes, record: GitHubSignIn): void {
  const path = recordPath(p);
  p.mkdirp(join(p.home, ".mattstack", "rt", "logins"), 0o700);
  const tmp = `${path}.tmp`;
  p.writeFile(tmp, JSON.stringify(record), 0o600);
  p.rename(tmp, path);
}

function parseRecord(raw: string | null): GitHubSignIn | null {
  if (raw === null) return null;
  const j = parseJson(raw);
  if (typeof j.userCode !== "string" || typeof j.url !== "string" || typeof j.expiresAt !== "string") return null;
  const record: GitHubSignIn = {
    userCode: j.userCode,
    url: j.url,
    expiresAt: j.expiresAt,
    pid: typeof j.pid === "number" ? j.pid : null,
  };
  if (j.outcome === "expired" || j.outcome === "declined") record.outcome = j.outcome;
  return record;
}

/** The record as it sits on disk, with no expiry or pid check: a waiter uses it to see whether the record is still its own. */
export function readGitHubSignInRaw(p: Pick<Probes, "home" | "readFile">): GitHubSignIn | null {
  return parseRecord(p.readFile(recordPath(p)));
}

/** A null pid is a waiter still being started, so it counts as live until expiresAt. */
export function readGitHubSignIn(p: RecordProbes, alive: (pid: number) => boolean = pidAlive): GitHubSignIn | null {
  const record = parseRecord(p.readFile(recordPath(p)));
  if (record === null) return null;
  if (record.outcome !== undefined) return record;
  const expires = Date.parse(record.expiresAt);
  if (Number.isNaN(expires) || p.now().getTime() >= expires) return null;
  if (record.pid !== null && !alive(record.pid)) return null;
  return record;
}

export function clearGitHubSignIn(p: Pick<Probes, "home" | "removeFile">): void {
  p.removeFile(recordPath(p));
}
