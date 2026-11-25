/**
 * rt telemetry open: open the switchboard's version-telemetry page in the
 * default browser, with the view key from rt's personal secrets filled in.
 * The key rides in the URL only; it is never printed.
 */

import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { createFileActions } from "../lib/file-actions.ts";
import { createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { createRealSecretsExecSeam, readSecret } from "../lib/secrets/store.ts";
import * as out from "../lib/ui/out.ts";
import { switchboardUrl } from "../packages/rt-client/src/switchboard.ts";

export interface TelemetryOpenDeps {
  readKey: () => Promise<string | null>;
  baseUrl: () => string;
  /** Whether the browser launcher exited 0. */
  open: (url: string) => boolean;
}

export function telemetryPageUrl(base: string, key: string): string {
  return `${base}/telemetry?key=${encodeURIComponent(key)}`;
}

function realDeps(): TelemetryOpenDeps {
  return {
    readKey: () => readSecret("rt", "switchboardTelemetryToken", { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    baseUrl: () => switchboardUrl(),
    open: (url) => createFileActions().open(url),
  };
}

export async function telemetryOpen(_args: string[], _ctx: CommandContext = {}, deps: TelemetryOpenDeps = realDeps()): Promise<void> {
  const key = await deps.readKey();
  if (!key) {
    throw new UserActionableError("telemetry-key-missing", "No telemetry key is stored on this Mac", {}, { next: "rt secrets set rt switchboardTelemetryToken" });
  }
  if (!deps.open(telemetryPageUrl(deps.baseUrl(), key))) {
    throw new UserActionableError("telemetry-open-failed", "rt could not open your browser", {}, { why: "The telemetry page needs the default browser to open it." });
  }
  out.print(out.line("done", "Opened the telemetry page"));
}

// ─── rt telemetry clones ───────────────────────────────────────────────────

/** The relay's `/telemetry/clones.json`, typed only as far as the human view reads it; `--json` passes it through whole. */
interface CloneReport {
  macs: { label: string; orgs: { org: string; clone: unknown; flags: string[] }[] }[];
  events: unknown[];
}

export interface TelemetryClonesDeps {
  readKey: () => Promise<string | null>;
  baseUrl: () => string;
  /** The key rides in an Authorization header, so it never lands in a URL or a log. */
  fetchReport: (url: string, key: string) => Promise<{ status: number; body: string }>;
}

function clonesDeps(): TelemetryClonesDeps {
  const open = realDeps();
  return {
    readKey: open.readKey,
    baseUrl: open.baseUrl,
    fetchReport: async (url, key) => {
      const res = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      return { status: res.status, body: await res.text() };
    },
  };
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function telemetryClones(args: string[], _ctx: CommandContext = {}, deps: TelemetryClonesDeps = clonesDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const key = await deps.readKey();
  if (!key) {
    throw new UserActionableError("telemetry-key-missing", "No telemetry key is stored on this Mac", {}, { next: "rt secrets set rt switchboardTelemetryToken" });
  }
  const user = flagValue(args, "--user");
  const url = `${deps.baseUrl()}/telemetry/clones.json${user ? `?user=${encodeURIComponent(user)}` : ""}`;
  const res = await deps.fetchReport(url, key);
  if (res.status !== 200) {
    throw new UserActionableError("telemetry-clones-failed", "The relay did not send the clone report", {}, {
      why: res.status === 401 ? "It refused this Mac's telemetry key." : `It answered HTTP ${res.status}.`,
    });
  }
  const report = JSON.parse(res.body) as CloneReport;
  if (json) {
    out.json(report);
    return;
  }
  // A Mac older than clone reports, or one whose copy could not be read, sends no clone.
  const cloneCell = (o: { clone: unknown; flags: string[] }) => (o.clone === null ? "not reported" : o.flags.length > 0 ? o.flags.join("; ") : "no problems");
  const rows = report.macs.flatMap((m) => m.orgs.map((o) => [m.label, o.org, cloneCell(o)]));
  const changes = report.events.length;
  out.print(
    rows.length > 0 ? out.table(rows, ["Mac", "Org", "Clone"]) : out.line("pending", "No Mac has reported its clones yet"),
    out.line("done", `${changes} state ${changes === 1 ? "change" : "changes"} recorded`, "Run with --json for each clone's counts and timeline"),
  );
}
