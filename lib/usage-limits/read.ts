/**
 * Reads Claude usage limits for every account this machine knows about.
 *
 * With cswap installed, `cswap list --json` already holds every managed
 * account's usage, so rt reads that and never touches another account's
 * token. The account Claude Code is signed into is read directly from the
 * usage endpoint `/usage` reads, unless cswap already listed it.
 */

import { readFile } from "fs/promises";
import { homedir, userInfo } from "os";
import { join } from "path";
import { CSWAP_STILL_RUNNING, cswapBin, cswapExec } from "../cswap.ts";
import { runCapture } from "../subprocess.ts";

/** `kind` is `spend`, `five_hour`, `seven_day`, or `scoped:<model name>`. */
export interface UsageLimit {
  kind: string;
  pct: number;
  used?: number;
  limit?: number;
  currency?: string;
  resetsAt?: string;
}

export interface AccountUsage {
  account: string;
  orgUuid?: string;
  orgName?: string;
  limits: UsageLimit[];
}

export interface UsageRead {
  accounts: AccountUsage[];
  /** Why a source gave nothing this time, in plain words for the log. */
  problems: string[];
}

export interface ClaudeCredentials {
  accessToken: string;
  expiresAt?: number;
}

export type Got<T> = { ok: true; value: T } | { ok: false; problem: string };

export interface ReadDeps {
  /** Parsed `cswap list --json`; null when cswap is not installed. */
  runCswapList: () => Promise<Got<unknown> | null>;
  readClaudeAccount: () => Promise<{ email: string; orgUuid?: string; orgName?: string } | null>;
  readClaudeCredentials: () => Promise<Got<ClaudeCredentials>>;
  /** Raw usage endpoint body. */
  fetchUsage: (accessToken: string) => Promise<Got<unknown>>;
  now: () => number;
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
// Nothing kills cswap, and the sweep runs every 5 minutes, so wait out a slow
// one rather than drop its answer.
const CSWAP_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 10_000;

export async function readAccountUsage(deps: ReadDeps): Promise<UsageRead> {
  const accounts: AccountUsage[] = [];
  const problems: string[] = [];

  const listed = await deps.runCswapList();
  let cswapIdentities: Array<{ account: string; orgUuid?: string }> = [];
  if (listed?.ok) {
    accounts.push(...parseCswapUsage(listed.value));
    cswapIdentities = listedIdentities(listed.value);
  } else if (listed) problems.push(`cswap: ${listed.problem}`);

  // An account cswap lists without usage is one cswap is backing off on, so
  // rt must not poll the endpoint behind its back.
  const signedIn = await deps.readClaudeAccount();
  if (!signedIn || cswapIdentities.some((a) => sameAccount(a, signedIn))) return { accounts, problems };

  const creds = await deps.readClaudeCredentials();
  if (!creds.ok) {
    problems.push(`Claude Code credentials: ${creds.problem}`);
    return { accounts, problems };
  }
  // Refreshing would rotate the token out from under Claude Code, so an
  // expired one waits for Claude Code's own next refresh.
  if (creds.value.expiresAt !== undefined && creds.value.expiresAt <= deps.now()) {
    problems.push("Claude Code token expired; waiting for Claude Code to refresh it");
    return { accounts, problems };
  }
  const body = await deps.fetchUsage(creds.value.accessToken);
  if (!body.ok) {
    problems.push(`usage endpoint: ${body.problem}`);
    return { accounts, problems };
  }
  accounts.push({
    account: signedIn.email,
    ...(signedIn.orgUuid ? { orgUuid: signedIn.orgUuid } : {}),
    ...(signedIn.orgName ? { orgName: signedIn.orgName } : {}),
    limits: parseUsageResponse(body.value),
  });
  return { accounts, problems };
}

function listedIdentities(data: unknown): Array<{ account: string; orgUuid?: string }> {
  if (!isRecord(data) || !Array.isArray(data.accounts)) return [];
  return data.accounts.flatMap((e: unknown) =>
    isRecord(e) && typeof e.email === "string"
      ? [{ account: e.email, ...(typeof e.organizationUuid === "string" ? { orgUuid: e.organizationUuid } : {}) }]
      : []);
}

function sameAccount(a: { account: string; orgUuid?: string }, b: { email: string; orgUuid?: string }): boolean {
  return a.account === b.email && (!a.orgUuid || !b.orgUuid || a.orgUuid === b.orgUuid);
}

export function parseCswapUsage(data: unknown): AccountUsage[] {
  if (!isRecord(data) || !Array.isArray(data.accounts)) return [];
  const out: AccountUsage[] = [];
  for (const entry of data.accounts) {
    if (!isRecord(entry) || typeof entry.email !== "string" || !isRecord(entry.usage)) continue;
    const usage = entry.usage;
    const limits: UsageLimit[] = [];
    if (isRecord(usage.spend) && isNum(usage.spend.pct)) {
      const s = usage.spend;
      limits.push(withOptional({ kind: "spend", pct: s.pct }, {
        used: num(s.used), limit: num(s.limit), currency: str(s.currency), resetsAt: str(s.resetsAt),
      }));
    }
    pushWindow(limits, "five_hour", usage.fiveHour);
    pushWindow(limits, "seven_day", usage.sevenDay);
    for (const s of Array.isArray(usage.scoped) ? usage.scoped : []) {
      if (isRecord(s) && typeof s.name === "string") pushWindow(limits, `scoped:${s.name}`, s);
    }
    out.push({
      account: entry.email,
      ...(typeof entry.organizationUuid === "string" ? { orgUuid: entry.organizationUuid } : {}),
      ...(typeof entry.organizationName === "string" ? { orgName: entry.organizationName } : {}),
      limits,
    });
  }
  return out;
}

export function parseUsageResponse(data: unknown): UsageLimit[] {
  if (!isRecord(data)) return [];
  const limits: UsageLimit[] = [];
  const eu = data.extra_usage;
  if (isRecord(eu) && eu.is_enabled === true && isNum(eu.used_credits) && isNum(eu.monthly_limit) && isNum(eu.utilization)) {
    limits.push(withOptional(
      { kind: "spend", pct: eu.utilization, used: eu.used_credits / 100, limit: eu.monthly_limit / 100, currency: str(eu.currency) ?? "USD" },
      { resetsAt: str(eu.resets_at) },
    ));
  }
  pushWindow(limits, "five_hour", rawWindow(data.five_hour));
  pushWindow(limits, "seven_day", rawWindow(data.seven_day));
  for (const lim of Array.isArray(data.limits) ? data.limits : []) {
    if (!isRecord(lim) || !isNum(lim.percent)) continue;
    const scope = isRecord(lim.scope) ? lim.scope : {};
    const model = isRecord(scope.model) ? scope.model : {};
    if (typeof model.display_name !== "string") continue;
    limits.push(withOptional({ kind: `scoped:${model.display_name}`, pct: lim.percent }, { resetsAt: str(lim.resets_at) }));
  }
  return limits;
}

function rawWindow(w: unknown): Record<string, unknown> | undefined {
  if (!isRecord(w) || !isNum(w.utilization)) return undefined;
  return { pct: w.utilization, resetsAt: w.resets_at };
}

function pushWindow(limits: UsageLimit[], kind: string, w: unknown): void {
  if (!isRecord(w) || !isNum(w.pct)) return;
  limits.push(withOptional({ kind, pct: w.pct }, { resetsAt: str(w.resetsAt) }));
}

function withOptional(base: UsageLimit, extra: Partial<UsageLimit>): UsageLimit {
  const out: UsageLimit = { ...base };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function num(v: unknown): number | undefined {
  return isNum(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

// ─── Real deps ───────────────────────────────────────────────────────────────

function home(): string {
  return process.env.HOME || homedir();
}

async function runCswapList(): Promise<Got<unknown> | null> {
  const res = await cswapExec([cswapBin(), "list", "--json"], { timeoutMs: CSWAP_TIMEOUT_MS });
  if (res.exitCode === -1 && !res.stdout) return null;
  if (res.exitCode === CSWAP_STILL_RUNNING) return { ok: false, problem: `list still running after ${CSWAP_TIMEOUT_MS / 1000}s` };
  if (res.exitCode !== 0) return { ok: false, problem: `list exited ${res.exitCode}` };
  try {
    return { ok: true, value: JSON.parse(res.stdout) };
  } catch {
    return { ok: false, problem: "list printed something other than JSON" };
  }
}

export function parseCredentials(text: string): ClaudeCredentials | null {
  try {
    const oauth = JSON.parse(text)?.claudeAiOauth;
    if (!isRecord(oauth) || typeof oauth.accessToken !== "string") return null;
    return { accessToken: oauth.accessToken, ...(isNum(oauth.expiresAt) ? { expiresAt: oauth.expiresAt } : {}) };
  } catch {
    return null;
  }
}

export interface CredentialSources {
  platform: string;
  readKeychain: () => Promise<string | null>;
  readFile: () => Promise<string | null>;
}

/** On macOS Claude Code rotates the keychain item and the plain file can lag
 *  behind it, so the keychain wins there; elsewhere the file is the store. */
export async function readCredentialsFrom(src: CredentialSources): Promise<Got<ClaudeCredentials>> {
  const order = src.platform === "darwin" ? [src.readKeychain, src.readFile] : [src.readFile];
  for (const read of order) {
    const text = await read();
    const creds = text ? parseCredentials(text) : null;
    if (creds) return { ok: true, value: creds };
  }
  return { ok: false, problem: "no OAuth token found" };
}

async function readClaudeCredentials(): Promise<Got<ClaudeCredentials>> {
  return readCredentialsFrom({
    platform: process.platform,
    readKeychain: async () => {
      const user = process.env.USER || userInfo().username;
      const res = await runCapture(
        ["/usr/bin/security", "find-generic-password", "-a", user, "-w", "-s", "Claude Code-credentials"],
        { timeoutMs: 5_000 },
      );
      return res.exitCode === 0 ? res.stdout.trim() : null;
    },
    readFile: async () => {
      try {
        return await readFile(join(home(), ".claude", ".credentials.json"), "utf8");
      } catch {
        return null;
      }
    },
  });
}

async function readClaudeAccount(): Promise<{ email: string; orgUuid?: string; orgName?: string } | null> {
  try {
    const acct = JSON.parse(await readFile(join(home(), ".claude.json"), "utf8"))?.oauthAccount;
    if (!isRecord(acct) || typeof acct.emailAddress !== "string") return null;
    return {
      email: acct.emailAddress,
      ...(typeof acct.organizationUuid === "string" ? { orgUuid: acct.organizationUuid } : {}),
      ...(typeof acct.organizationName === "string" ? { orgName: acct.organizationName } : {}),
    };
  } catch {
    return null;
  }
}

async function fetchUsage(accessToken: string): Promise<Got<unknown>> {
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, "anthropic-beta": OAUTH_BETA, "User-Agent": "rt-usage-limits" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, problem: `HTTP ${res.status}` };
    return { ok: true, value: await res.json() };
  } catch (err) {
    return { ok: false, problem: err instanceof Error ? err.message : String(err) };
  }
}

export const realReadDeps: ReadDeps = {
  runCswapList,
  readClaudeAccount,
  readClaudeCredentials,
  fetchUsage,
  now: () => Date.now(),
};
