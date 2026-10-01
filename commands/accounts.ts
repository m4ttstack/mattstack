/**
 * rt accounts -- credential health for rt's integrations (RT-132).
 *
 *   rt accounts [--json] [--recheck]
 *
 * Reads the credential_health table the daemon's periodic accounts-sweep
 * keeps current. `--recheck` runs that same sweep cycle on demand via the
 * daemon's accounts-recheck IPC verb before printing, so the table reflects
 * live status instead of the last scheduled pass.
 */

import type { Database } from "bun:sqlite";
import { readAllCredentialHealth, type CredentialHealthRow } from "../lib/credential-health/db.ts";
import { CREDENTIAL_STATUS_WORD } from "../lib/credential-health/status-word.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { daemonQuery } from "../lib/daemon-client.ts";
import { getStateDb } from "../lib/state/index.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";

export function formatAccountsJson(db: Database): {
  ok: boolean;
  accounts: Array<{
    integration: string;
    status: string;
    detail: string;
    expiresAt: string | null;
    checkedAt: number;
  }>;
} {
  const rows = readAllCredentialHealth(db);
  return {
    ok: true,
    accounts: rows.map((r) => ({
      integration: r.integration,
      status: r.status,
      detail: r.detail,
      expiresAt: r.expiresAt,
      checkedAt: r.checkedAt,
    })),
  };
}

const STATUS_ROLE: Record<CredentialHealthRow["status"], RenderStatus> = { ready: "done", invalid: "failed", error: "warn" };
const STATUS_WORD = Object.fromEntries(
  (Object.keys(STATUS_ROLE) as CredentialHealthRow["status"][]).map((s) => [s, { text: CREDENTIAL_STATUS_WORD[s], role: STATUS_ROLE[s] }]),
) as Record<CredentialHealthRow["status"], { text: string; role: RenderStatus }>;

function humanAgo(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function accountsBlocks(rows: CredentialHealthRow[], now: number): Block[] {
  if (rows.length === 0) return [out.line("pending", "No account checks have run yet"), out.callout("next", out.cmd("rt accounts --recheck"))];
  return [
    out.table(
      rows.map((r) => [r.integration, STATUS_WORD[r.status], r.expiresAt ?? "", `${humanAgo(now - r.checkedAt)} ago`, r.detail]),
      ["ACCOUNT", "STATUS", "EXPIRES", "CHECKED", "DETAIL"],
    ),
  ];
}

export interface AccountsDeps {
  db: () => Database;
  /** Runs the daemon's sweep now; false when the daemon did not answer. */
  recheck: () => Promise<boolean>;
  now: () => number;
  exit: (code: number) => never;
}

export function realAccountsDeps(): AccountsDeps {
  return {
    db: () => getStateDb("cli"),
    async recheck() {
      try {
        const res = await daemonQuery("accounts-recheck", undefined, 30_000);
        return !!res?.ok;
      } catch {
        return false;
      }
    },
    now: Date.now,
    exit: process.exit,
  };
}

export async function run(args: string[], _ctx: CommandContext = {}, deps: AccountsDeps = realAccountsDeps()): Promise<void> {
  const json = args.includes("--json");

  if (args.includes("--recheck")) {
    if (!(await deps.recheck())) {
      if (json) out.json({ ok: false, error: "Recheck failed. Is the daemon running?" });
      else out.fail({ title: "Could not recheck your accounts", why: "The rt daemon did not answer", next: out.cmd("rt daemon start") });
      return deps.exit(1);
    }
    if (!json) out.print(out.line("done", "Rechecked your accounts"));
  }

  const db = deps.db();
  if (json) out.json(formatAccountsJson(db));
  else out.print(...accountsBlocks(readAllCredentialHealth(db), deps.now()));
}
