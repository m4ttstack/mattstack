import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { rtDir } from "../rt-paths";

export interface AccountRecord {
  account: string;
  label: string | null;
  orgType: string | null;
  seatTier: string | null;
  billingType: string | null;
}

const API_KEY: AccountRecord = {
  account: "api-key",
  label: "API key",
  orgType: null,
  seatTier: null,
  billingType: null,
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function readAccount(opts: {
  configDir: string | null;
  home: string;
  env: Record<string, string | undefined>;
}): AccountRecord | null {
  if (opts.env.ANTHROPIC_API_KEY) return { ...API_KEY };
  const file = join(opts.configDir ?? opts.home, ".claude.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const oauth = (parsed as { oauthAccount?: unknown }).oauthAccount;
  if (typeof oauth !== "object" || oauth === null) return { ...API_KEY };
  const o = oauth as Record<string, unknown>;
  const account = str(o.accountUuid);
  if (!account) return { ...API_KEY };
  return {
    account,
    label: str(o.emailAddress) ?? str(o.organizationName),
    orgType: str(o.organizationType),
    seatTier: str(o.seatTier),
    billingType: str(o.billingType),
  };
}

export function accountsPath(): string {
  return join(rtDir(), "usage", "accounts.jsonl");
}

export function recordAccount(opts: {
  path: string;
  session: string;
  ts: number;
  record: AccountRecord;
}): boolean {
  const { path, session, ts, record } = opts;
  if (!session || session.includes("/") || session.includes("..")) return false;
  const stateDir = join(dirname(path), "account-state");
  const stateFile = join(stateDir, session);
  try {
    if (existsSync(stateFile) && readFileSync(stateFile, "utf8") === record.account) {
      return false;
    }
  } catch {}
  mkdirSync(stateDir, { recursive: true });
  const line = JSON.stringify({
    session,
    ts,
    account: record.account,
    label: record.label,
    org_type: record.orgType,
    seat_tier: record.seatTier,
    billing_type: record.billingType,
  });
  appendFileSync(path, `${line}\n`);
  writeFileSync(stateFile, record.account);
  return true;
}

export const BILLING_CLASS_SQL = `CASE
  WHEN a.seat_tier = 'enterprise_usage_based' OR a.account = 'api-key' THEN 'metered'
  WHEN a.org_type IN ('claude_max', 'claude_pro') THEN 'plan'
  ELSE 'unknown'
END`;
