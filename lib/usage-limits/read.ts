/**
 * Reads Claude usage limits for every account this machine knows about.
 *
 * With cswap installed, `cswap list --json` already holds every managed
 * account's usage, so rt reads that and never touches another account's
 * token. Without it, rt reads the account Claude Code is signed into and asks
 * the usage endpoint `/usage` reads.
 */

import { readFile } from "fs/promises";
import { homedir, userInfo } from "os";
import { join } from "path";
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
  limits: UsageLimit[];
}

export interface UsageRead {
  source: "cswap" | "claude-code" | "none";
  accounts: AccountUsage[];
}

export interface ClaudeCredentials {
  accessToken: string;
  expiresAt?: number;
}

export interface ReadDeps {
  /** Parsed `cswap list --json`, or null when cswap is not installed or fails. */
  runCswapList: () => Promise<unknown>;
  readClaudeCredentials: () => Promise<ClaudeCredentials | null>;
  readClaudeAccount: () => Promise<{ email: string; orgUuid?: string } | null>;
  /** Raw usage endpoint body, or null on any failure. */
  fetchUsage: (accessToken: string) => Promise<unknown>;
  now: () => number;
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const CSWAP_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 10_000;

export async function readAccountUsage(deps: ReadDeps): Promise<UsageRead> {
  const listed = await deps.runCswapList();
  if (listed !== null && listed !== undefined) {
    return { source: "cswap", accounts: parseCswapList(listed) };
  }

  const account = await deps.readClaudeAccount();
  const creds = account ? await deps.readClaudeCredentials() : null;
  if (!account || !creds) return { source: "none", accounts: [] };
  // Refreshing would rotate the token out from under Claude Code, so an
  // expired one waits for Claude Code's own next refresh.
  if (creds.expiresAt !== undefined && creds.expiresAt <= deps.now()) {
    return { source: "claude-code", accounts: [] };
  }
  const body = await deps.fetchUsage(creds.accessToken);
  if (!isRecord(body)) return { source: "claude-code", accounts: [] };
  return {
    source: "claude-code",
    accounts: [{ account: account.email, ...(account.orgUuid ? { orgUuid: account.orgUuid } : {}), limits: parseUsageResponse(body) }],
  };
}

export function parseCswapList(data: unknown): AccountUsage[] {
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
    pushWindow(limits, "five_hour", usage.fiveHour, "resetsAt");
    pushWindow(limits, "seven_day", usage.sevenDay, "resetsAt");
    for (const s of Array.isArray(usage.scoped) ? usage.scoped : []) {
      if (isRecord(s) && typeof s.name === "string") pushWindow(limits, `scoped:${s.name}`, s, "resetsAt");
    }
    out.push({ account: entry.email, ...(typeof entry.organizationUuid === "string" ? { orgUuid: entry.organizationUuid } : {}), limits });
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
  pushWindow(limits, "five_hour", rawWindow(data.five_hour), "resetsAt");
  pushWindow(limits, "seven_day", rawWindow(data.seven_day), "resetsAt");
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

function pushWindow(limits: UsageLimit[], kind: string, w: unknown, resetKey: string): void {
  if (!isRecord(w) || !isNum(w.pct)) return;
  limits.push(withOptional({ kind, pct: w.pct }, { resetsAt: str(w[resetKey]) }));
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

async function runCswapList(): Promise<unknown> {
  try {
    const res = await runCapture(["cswap", "list", "--json"], { timeoutMs: CSWAP_TIMEOUT_MS });
    if (res.exitCode !== 0) return null;
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

function parseCredentials(text: string): ClaudeCredentials | null {
  try {
    const oauth = JSON.parse(text)?.claudeAiOauth;
    if (!isRecord(oauth) || typeof oauth.accessToken !== "string") return null;
    return { accessToken: oauth.accessToken, ...(isNum(oauth.expiresAt) ? { expiresAt: oauth.expiresAt } : {}) };
  } catch {
    return null;
  }
}

/** The default config dir's store: the plain file first, then the macOS
 *  keychain item Claude Code writes when it has no file. */
async function readClaudeCredentials(): Promise<ClaudeCredentials | null> {
  try {
    const fromFile = parseCredentials(await readFile(join(home(), ".claude", ".credentials.json"), "utf8"));
    if (fromFile) return fromFile;
  } catch { /* no file: fall through to the keychain */ }
  if (process.platform !== "darwin") return null;
  const user = process.env.USER || userInfo().username;
  const res = await runCapture(
    ["/usr/bin/security", "find-generic-password", "-a", user, "-w", "-s", "Claude Code-credentials"],
    { timeoutMs: 5_000 },
  );
  return res.exitCode === 0 ? parseCredentials(res.stdout.trim()) : null;
}

async function readClaudeAccount(): Promise<{ email: string; orgUuid?: string } | null> {
  try {
    const acct = JSON.parse(await readFile(join(home(), ".claude.json"), "utf8"))?.oauthAccount;
    if (!isRecord(acct) || typeof acct.emailAddress !== "string") return null;
    return { email: acct.emailAddress, ...(typeof acct.organizationUuid === "string" ? { orgUuid: acct.organizationUuid } : {}) };
  } catch {
    return null;
  }
}

async function fetchUsage(accessToken: string): Promise<unknown> {
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, "anthropic-beta": OAUTH_BETA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export const realReadDeps: ReadDeps = {
  runCswapList,
  readClaudeCredentials,
  readClaudeAccount,
  fetchUsage,
  now: () => Date.now(),
};
