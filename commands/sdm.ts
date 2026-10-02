/**
 * rt sdm: StrongDM connections. `sdm` is a branch node (cli.ts); subcommands:
 *
 *   rt sdm connect [<key>] [--duration 8h] [--reason "..."]  SDM-first picker,
 *                                    or connect a key directly
 *   rt sdm status                   CLI health + connected tunnels
 *   rt sdm login [--manual] [--visible]   log in (default: browser popup flow)
 *   rt sdm refresh                  re-scan StrongDM, bust the cache
 *   rt sdm enrichment [init]        show, or scaffold, the declarative label/tier map
 *
 * The daemon serves the resource scan when running (10-minute cache);
 * everything falls back to in-process execution when it is not.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logCliEvent } from "../lib/cli-logger.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import {
  connectResource,
  fetchAccessCatalog,
  getSdmSnapshot,
  loginSdm,
  requestAccess,
  resourceNeedsAccessRequest,
  SDM_DURATIONS,
  SDM_INSTALL_URL,
  type SdmHealth,
  type SdmResourceState,
  type SdmSnapshot,
} from "../lib/sdm/core.ts";
import { scanSdmResources, type SdmResource } from "../lib/sdm/scan.ts";
import { buildSdmConnections, type SdmConnection } from "../lib/sdm/browse.ts";
import { loadEnrichment, probeEnrichmentStore } from "../lib/sdm/enrichment.ts";
import { buildConnectionsJson, buildConnectionsRefusal, buildConnectJson, buildProductionRefusal, buildStatusJson, shouldRefuseProduction } from "../lib/sdm/agent-json.ts";
import { loadSdmState, recordRecent, type RecentEntry } from "../lib/sdm/state.ts";
import { runGuidedConnect, type GuidedResult, type GuidedTarget } from "../lib/sdm/flow.ts";
import { probeQuery, probeTunnel, verifyWithRetries, VERIFY_ATTEMPT_TIMEOUT_MS } from "../lib/sdm/verify.ts";
import { buildPickerOptions } from "../lib/sdm/picker.ts";
import { ensureSdmApp, isSdmAppRunning } from "../lib/sdm/app.ts";
import { interactive as atTerminal } from "../lib/ui/gate.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { openStep, type StepHandle } from "../lib/ui/spawn.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";

// `sdm` is a branch node in the command tree (cli.ts); each subcommand below
// is a leaf pointing at one of these exported functions.

// ── Scan access (daemon-first, in-process fallback) ──────────────────────

async function getScan(refresh = false): Promise<{ resources: SdmResource[]; error?: string }> {
  const { daemonQuery } = await import("../lib/daemon-client.ts");
  const result = await daemonQuery("sdm:catalog", refresh ? { refresh: true } : undefined, 45_000);
  const r = result as any;
  if (r?.ok && Array.isArray(r.resources) && !r.error) {
    return { resources: r.resources as SdmResource[] };
  }
  // Daemon unreachable, still serving the pre-scan connector shape (no
  // `resources` array), or reporting a scan error -- a daemon with a broken
  // PATH can come back ok with an empty/failed scan while the in-process rt,
  // running with the user's own PATH, succeeds.
  const scanned = await scanSdmResources({ refresh });
  return { resources: scanned.resources, error: scanned.error };
}

// ── Progress: child output under a step, kept in the log ─────────────────────

const TAIL_KEPT = 5;

// `sdm login` prints a one-time auth url; the log, a failure's excerpt and its why outlive the login.
const AUTH_TOKEN = /(auth-confirm-native(?:\/|%2F))[^\s"'<>]+/gi;

function redact(line: string): string {
  return line.replace(AUTH_TOKEN, "$1<redacted>");
}

function logLine(line: string): void {
  logCliEvent("debug", "sdm", redact(line));
}

// The step only narrates; a helper that cannot start leaves the task to run unwatched.
function tryOpenStep(label: string): StepHandle | null {
  try {
    return openStep(label);
  } catch {
    return null;
  }
}

/**
 * Runs a task that streams child output. At a terminal the lines sit under a
 * step that is erased when the task settles; every line reaches the rt log,
 * and the last few come back so a failure can show them. No prompt and no
 * child that owns the terminal may run inside the task: the step is drawing.
 */
async function withProgress<T>(label: string, draw: boolean, task: (onLine: (line: string) => void) => Promise<T>): Promise<{ value: T; tail: string[] }> {
  const tail: string[] = [];
  const step = draw && atTerminal() ? tryOpenStep(label) : null;
  const onLine = (raw: string): void => {
    const line = redact(raw);
    logLine(line);
    tail.push(line);
    if (tail.length > TAIL_KEPT) tail.shift();
    step?.sub(line);
  };
  try {
    return { value: await task(onLine), tail };
  } finally {
    await step?.clear();
  }
}

/** The child's last lines under a failure, leaving out the one its why already shows. */
function excerpt(tail: string[], shown?: string): Block[] {
  const rest = tail.map(redact).filter((line) => line !== shown);
  return rest.length > 0 ? [out.verbatim(rest, "what StrongDM printed")] : [];
}

// The access reason is free text a person typed; like `--reason` in the CLI log's args, it never reaches the log.
function hideReason(line: string, reason: string | undefined): string {
  const needle = reason?.trim();
  return needle ? line.split(needle).join("[redacted]") : line;
}

function lastLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? text.trim();
}

// ── What each outcome reads as ───────────────────────────────────────────────

const MANUAL_NOTE = "Logging in here instead. Answer its questions; your browser opens to finish.";
const INSTALL_LINK = out.link("strongdm.com/docs/cli", SDM_INSTALL_URL);

function appFailure(error: string | undefined): out.FailureInput {
  return { title: "The StrongDM app did not start", why: error };
}

// The sdm skill hands the manual login to the person when a `next:` line
// names it, and never runs --visible; a silent failure keeps it in a tip.
function loginFailure(error: string | undefined, visible: boolean): out.FailureInput {
  return { title: "Could not log in to StrongDM", why: error, next: out.cmd(visible ? "rt sdm login --manual" : "rt sdm login --visible") };
}

function loginTip(visible: boolean): Block[] {
  return visible ? [] : [out.callout("tip", ["If the browser login keeps failing, log in by hand: ", out.cmd("rt sdm login --manual")])];
}

function manualLoginFailure(reason: string): out.FailureInput {
  return { title: "StrongDM needs you to log in by hand", why: reason, next: out.cmd("rt sdm login --manual") };
}

function productionRefusal(target: GuidedTarget): Block[] {
  return [
    out.line("refused", `${target.label} is a production connection`),
    out.callout("why", "A person has to say yes to a production connection."),
    out.callout("next", out.cmd(`rt sdm connect ${target.key} --confirm-production`)),
  ];
}

function healthFailure(health: SdmHealth): out.FailureInput {
  if (health.status === "not-authenticated") return { title: "You are not logged in to StrongDM", next: out.cmd("rt sdm login") };
  if (health.status === "not-installed") return { title: "The StrongDM CLI is not installed", next: ["Install it from ", INSTALL_LINK] };
  return { title: "StrongDM is not answering", why: health.message ?? undefined };
}

type FailedConnect = Extract<GuidedResult, { outcome: "failed" }>;

const STAGE_TITLE: Record<FailedConnect["stage"], (label: string) => string> = {
  health: () => "StrongDM is not available on this Mac",
  login: () => "You are not logged in to StrongDM",
  access: (label) => `Could not get access to ${label}`,
  connect: (label) => `Could not connect to ${label}`,
  verify: (label) => `${label} did not come up`,
};

// These stages stream sdm's output into the excerpt, so their why is only its last line.
const STREAMED_STAGES = new Set<FailedConnect["stage"]>(["access", "connect"]);

function connectFailure(target: GuidedTarget, result: FailedConnect): out.FailureInput {
  const next = result.next ?? (result.stage === "login" ? "rt sdm login" : undefined);
  return {
    title: STAGE_TITLE[result.stage](target.label),
    why: redact(STREAMED_STAGES.has(result.stage) ? lastLine(result.error) : result.error),
    next: next ? out.cmd(next) : result.hint,
  };
}

const ABORTED: Record<string, string> = {
  "login declined": "you chose not to log in",
  "production connect declined": "the name you typed did not match",
};

function connectedBlocks(target: GuidedTarget, result: Extract<GuidedResult, { outcome: "connected" }>): Block[] {
  const db = target.db ? ` (${target.db.database ?? "postgres"}/${target.db.schema ?? "public"})` : "";
  const blocks: Block[] = [out.line("done", `${target.label} is ready`, `${result.address}${db}`)];
  if (result.unverified) {
    blocks.push(out.line("warn", "The tunnel is up, but a test query did not confirm it", result.verify.lastError?.message ?? "unknown"));
    blocks.push(out.callout("note", "It is likely usable. Try your query again, and reconnect if it keeps failing."));
  } else {
    blocks.push(out.line("done", "A test query worked", `${result.verify.latencyMs}ms, ${result.verify.attempts} attempt${result.verify.attempts === 1 ? "" : "s"}`));
  }
  return blocks;
}

function healthBlocks(health: SdmHealth): Block[] {
  if (health.status === "not-authenticated") return [out.line("needs-you", "You are not logged in to StrongDM"), out.callout("next", out.cmd("rt sdm login"))];
  if (health.status === "not-installed") return [out.line("pending", "The StrongDM CLI is not installed"), out.callout("note", ["Install it from ", INSTALL_LINK])];
  return [out.line("failed", "StrongDM is not answering", health.message ?? undefined)];
}

function statusBlocks(snapshot: SdmSnapshot, appRunning: boolean): Block[] {
  const blocks: Block[] = [];
  if (!appRunning) blocks.push(out.line("off", "The StrongDM app is not running", "rt starts it when you connect"));
  if (snapshot.health.status !== "ok") return [...blocks, ...healthBlocks(snapshot.health)];
  blocks.push(out.line("done", "Logged in to StrongDM"));
  const connected = [...snapshot.resources.entries()].filter(([, s]) => s.connected);
  if (connected.length === 0) return [...blocks, out.line("off", "No tunnels open")];
  for (const [name, s] of connected) {
    const where = [s.address, s.expiry ? `until ${s.expiry}` : null].filter((part): part is string => Boolean(part)).join(", ");
    blocks.push(out.line("running", name, where || undefined));
  }
  return blocks;
}

function connectionsBlocks(connections: SdmConnection[], resources: Map<string, SdmResourceState>): Block[] {
  if (connections.length === 0) return [out.line("skipped", "No StrongDM connections to show"), out.callout("next", out.cmd("rt sdm refresh"))];
  return [
    out.table(
      connections.map((c) => {
        const state: Segment = resources.get(c.sdmResource)?.connected
          ? { text: "connected", role: "running" }
          : c.standingAccess
            ? { text: "standing access", role: "done" }
            : out.dim("on request");
        return [state, out.strong(c.label), out.dim(c.tier ?? ""), out.key(c.key)];
      }),
    ),
  ];
}

function refreshBlocks(count: number, error?: string): Block[] {
  const blocks: Block[] = [];
  if (error) blocks.push(out.line("warn", "The scan had a problem", error));
  blocks.push(out.line(count > 0 ? "done" : "skipped", `Found ${count} StrongDM connection${count === 1 ? "" : "s"}`, count === 0 && !error ? "check your StrongDM access" : undefined));
  return blocks;
}

function enrichmentBlocks(path: string, enriched: number, total: number): Block[] {
  if (total === 0) return [out.kv("labels file", path), out.line("skipped", "StrongDM shows no connections to label")];
  const all = enriched === total;
  const counted = `${total === 1 ? "connection" : "connections"} ${enriched === 1 ? "has" : "have"}`;
  return [out.kv("labels file", path), out.line(all ? "done" : "pending", `${enriched} of ${total} ${counted} a label`, all ? undefined : "the rest show their StrongDM names")];
}

// ── Guided flow wiring (real prompts, real sdm) ──────────────────────────────

interface LoginResult {
  ok: boolean;
  error?: string;
  tail: string[];
}

/**
 * Log in to StrongDM: the browser popup first, then the terminal login when
 * the popup cannot run. The terminal login owns the terminal, so the step is
 * closed before it starts.
 */
async function sdmBrowserLogin(label: string): Promise<LoginResult> {
  const { runBrowserLogin } = await import("../lib/sdm/browser-login.ts");
  const { value: r, tail } = await withProgress(label, true, (onLine) => runBrowserLogin({ onLine }));
  if (r.outcome === "authenticated") return { ok: true, tail };
  if (r.outcome === "needs-manual") {
    if (!process.stdin.isTTY) return { ok: false, error: redact(r.reason), tail };
    out.print(out.line("warn", "The browser login could not run", redact(r.reason)), out.callout("note", MANUAL_NOTE));
    return { ...(await loginSdm(logLine)), tail };
  }
  return { ok: false, error: r.error && redact(r.error), tail };
}

/**
 * Auth-first guard for the picker. An expired StrongDM session means the
 * scan cannot list resources (you would see only recents), so log in
 * before scanning, with no confirm. Returns true when a login happened, so
 * the caller can bust the stale cache.
 */
async function ensureSdmAuth(): Promise<boolean> {
  const snapshot = await getSdmSnapshot();
  if (snapshot.health.status !== "not-authenticated") return false;
  const r = await sdmBrowserLogin("Your StrongDM session expired, logging in");
  if (r.ok) {
    out.print(out.line("done", "Logged in to StrongDM"));
    return true;
  }
  out.print(
    out.line("warn", "Could not log in to StrongDM", "showing your recent connections only"),
    out.callout("why", redact(r.error ?? "unknown")),
    out.callout("next", out.cmd("rt sdm login --manual")),
  );
  return false;
}

async function guidedConnect(
  target: GuidedTarget,
  opts: { duration?: string; reason?: string; interactive: boolean; json?: boolean; confirmProduction?: boolean },
): Promise<void> {
  // The guard lives here, not in runGuidedConnect: the daemon's tray-driven
  // reconnect is also non-interactive but a tray click is a human action.
  if (shouldRefuseProduction(target, opts)) {
    if (opts.json) out.json(buildProductionRefusal(target), 2);
    else out.note(...productionRefusal(target));
    process.exitCode = 1;
    return;
  }
  const { select, textInput, confirm } = await import("../lib/rt-render.ts");
  let tail: string[] = [];
  let accessReason: string | undefined;
  const streamed = async <T extends { ok: boolean }>(label: string, task: (onLine: (line: string) => void) => Promise<T>): Promise<T> => {
    const r = await withProgress(label, !opts.json, task);
    tail = r.value.ok ? [] : r.tail;
    return r.value;
  };
  const result = await runGuidedConnect(target, opts, {
    getSnapshot: f => getSdmSnapshot(f),
    needsAccessRequest: async resource => {
      const catalog = await fetchAccessCatalog();
      return catalog.ok ? resourceNeedsAccessRequest(catalog.output, resource) : false;
    },
    requestAccess: (resource, duration, reason) => {
      accessReason = reason;
      return streamed(`Asking for access to ${target.label}`, onLine => requestAccess(resource, duration, reason, line => onLine(hideReason(line, reason))));
    },
    connect: resource => streamed(`Connecting to ${target.label}`, onLine => connectResource(resource, onLine)),
    verify: url => verifyWithRetries(() => probeQuery(url, VERIFY_ATTEMPT_TIMEOUT_MS)),
    probeTunnel: address => {
      const i = address.lastIndexOf(":");
      return probeTunnel(address.slice(0, i), Number(address.slice(i + 1)));
    },
    login: async () => {
      const r = await sdmBrowserLogin("Logging in to StrongDM");
      tail = r.ok ? [] : r.tail;
      return { ok: r.ok, error: r.error };
    },
    promptDuration: async def => {
      const all = SDM_DURATIONS.map(value => {
        const hours = Number.parseInt(value, 10);
        return { value, label: `${hours} hour${hours === 1 ? "" : "s"}` };
      });
      // select() has no initialValue option; ordering puts the default first.
      const options = [...all.filter(o => o.value === def), ...all.filter(o => o.value !== def)];
      return select({ message: "Access duration", options });
    },
    promptReason: async def => textInput({ message: "Reason (org-visible)", defaultValue: def }),
    confirmProduction: async t => {
      out.print(out.banner("PRODUCTION", t.label, "type its name to connect"));
      const input = await textInput({ message: `Type "${t.label}" to confirm` });
      return input.trim() === t.label;
    },
    confirmLogin: async () => confirm({ message: "StrongDM is not authenticated. Run sdm login now?", initialValue: true }),
    onLine: logLine,
    recordRecent: t =>
      void recordRecent({
        key: t.key, label: t.label, sdmResource: t.sdmResource,
        tier: t.tier, production: t.production, reasonSuggestion: t.reasonSuggestion, db: t.db,
      }),
  });

  if (opts.json) {
    const { json, exitCode } = buildConnectJson(target, result);
    out.json(json, 2);
    process.exitCode = exitCode;
    return;
  }
  if (result.outcome === "connected") {
    out.print(...connectedBlocks(target, result));
    return;
  }
  if (result.outcome === "aborted") {
    out.print(out.line("skipped", "Not connected", ABORTED[result.reason] ?? result.reason));
    process.exitCode = 1;
    return;
  }
  const connectFailed = connectFailure(target, result);
  const failure = { ...connectFailed, why: connectFailed.why && hideReason(connectFailed.why, accessReason) };
  out.fail(failure, ...excerpt(tail, failure.why));
  process.exitCode = 1;
}

function toTarget(c: SdmConnection | RecentEntry): GuidedTarget {
  return {
    key: c.key, label: c.label, sdmResource: c.sdmResource,
    tier: c.tier, production: c.production,
    reasonSuggestion: c.reasonSuggestion, db: c.db,
  };
}

// ── Subcommands ──────────────────────────────────────────────────────────────

async function pickAndConnect(): Promise<void> {
  if (!process.stdin.isTTY) {
    out.fail({ title: "Picking a connection needs a terminal", why: "A script names the connection it wants.", next: out.cmd("rt sdm connect <key>") });
    process.exitCode = 1;
    return;
  }
  const app = await withProgress("Checking the StrongDM app", true, onLine => ensureSdmApp(onLine));
  if (!app.value.ok) {
    out.fail(appFailure(app.value.error), ...excerpt(app.tail));
    process.exitCode = 1;
    return;
  }
  // Auth-first: an expired session lists nothing (only recents), so log in
  // before scanning. Refresh the scan when we just logged in, since a stale
  // cache from the logged-out run would still be empty.
  const loggedIn = await ensureSdmAuth();
  const { resources, error } = await withTransientStep("Scanning StrongDM", () => getScan(loggedIn));
  const recents = loadSdmState().recents;

  if (error) out.print(out.line("warn", "The StrongDM scan had a problem", error));
  if (resources.length === 0 && recents.length === 0) {
    out.print(
      out.line("skipped", "No StrongDM connections found"),
      out.paragraph("rt reads your StrongDM catalog directly, so there is nothing to set up. Check that you are logged in and can reach at least one database."),
      out.callout("tip", ["Nicer names for your connections: ", out.cmd("rt sdm enrichment init")]),
      out.callout("note", ["The StrongDM CLI comes from ", INSTALL_LINK]),
    );
    return;
  }

  const connections = buildSdmConnections(resources, loadEnrichment());
  // Live connection state for the "● connected" badge: a fresh sdm status
  // snapshot (not the cached scan), so the picker reflects active tunnels now.
  const snapshot = await getSdmSnapshot();
  const connected = new Set(
    [...snapshot.resources].filter(([, s]) => s.connected).map(([name]) => name),
  );
  const { runNavPicker } = await import("../lib/navigate.ts");
  const options = buildPickerOptions(connections, recents, connected);
  const picked = await runNavPicker({
    options,
    message: "sdm connections",
    breadcrumb: ["rt", "sdm", "connections"],
    crumbSuffix: "  ● connected   ✓ standing access",
  });
  if (!picked || !picked.value) return;

  const target =
    connections.find(c => c.key === picked.value) ??
    recents.find(r => r.key === picked.value);
  if (!target) {
    out.fail({ title: "That connection is no longer in the list", next: out.cmd("rt sdm refresh") });
    process.exitCode = 1;
    return;
  }
  await guidedConnect(toTarget(target), { interactive: true });
}

/**
 * `rt sdm connect` with no key opens the connection picker; `rt sdm connect
 * <key> [--duration 8h] [--reason "..."]` connects directly (scriptable).
 */
export async function connectCmd(rest: string[], _ctx?: CommandContext): Promise<void> {
  const flags: { duration?: string; reason?: string; json?: boolean; confirmProduction?: boolean } = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--duration") flags.duration = rest[++i];
    else if (arg === "--reason") flags.reason = rest[++i];
    else if (arg.startsWith("--duration=")) flags.duration = arg.slice("--duration=".length);
    else if (arg.startsWith("--reason=")) flags.reason = arg.slice("--reason=".length);
    else if (arg === "--json") flags.json = true;
    else if (arg === "--confirm-production") flags.confirmProduction = true;
    else positional.push(arg);
  }
  const key = positional[0];
  if (!key) {
    if (flags.json) {
      out.json({ ok: false, stage: "health", error: "a connection key is required with --json", hint: "rt sdm connections --json lists valid keys" }, 2);
      process.exitCode = 1;
      return;
    }
    return pickAndConnect();
  }
  const app = await withProgress("Checking the StrongDM app", !flags.json, onLine => ensureSdmApp(onLine));
  if (!app.value.ok) {
    if (flags.json) out.json({ ok: false, stage: "health", error: app.value.error, hint: null }, 2);
    else out.fail(appFailure(app.value.error), ...excerpt(app.tail));
    process.exitCode = 1;
    return;
  }
  const { resources } = await getScan();
  const connections = buildSdmConnections(resources, loadEnrichment());
  const target =
    connections.find(c => c.key === key) ??
    loadSdmState().recents.find(r => r.key === key);
  if (!target) {
    if (flags.json) out.json({ ok: false, stage: "health", error: `unknown connection key: ${key}`, hint: "rt sdm connections --json lists valid keys; rt sdm refresh re-discovers" }, 2);
    else out.fail({ title: `rt does not know a connection called ${key}`, why: "The list may be out of date.", next: out.cmd("rt sdm refresh") });
    process.exitCode = 1;
    return;
  }
  // --json is an agent calling: never prompt. Otherwise a TTY with both
  // flags provided still short-circuits the prompts, as before.
  const interactive = !flags.json && process.stdin.isTTY && !(flags.duration && flags.reason);
  await guidedConnect(toTarget(target), { ...flags, interactive });
}

/**
 * `rt sdm connections [--json]`: the discovery half of the agent contract.
 * Refuses (ok:false, exit 1) when the scan cannot run; an empty list must
 * mean "you truly have no resources", never "we could not look".
 */
export async function connectionsCmd(rest: string[]): Promise<void> {
  const json = rest.includes("--json");
  const snapshot = await getSdmSnapshot();
  if (snapshot.health.status !== "ok") {
    if (json) out.json(buildConnectionsRefusal(snapshot.health), 2);
    else out.fail(healthFailure(snapshot.health));
    process.exitCode = 1;
    return;
  }
  const { resources, error } = await getScan();
  if (error) {
    if (json) out.json(buildConnectionsRefusal(snapshot.health, error), 2);
    else out.fail({ title: "Could not read your StrongDM connections", why: error });
    process.exitCode = 1;
    return;
  }
  const connections = buildSdmConnections(resources, loadEnrichment());
  if (json) {
    out.json(buildConnectionsJson(connections, snapshot.resources), 2);
    return;
  }
  out.print(...connectionsBlocks(connections, snapshot.resources));
}

export async function statusCmd(rest: string[] = []): Promise<void> {
  const json = rest.includes("--json");
  const [snapshot, appRunning] = await Promise.all([getSdmSnapshot(true), isSdmAppRunning()]);
  if (json) {
    const { json: body, exitCode } = buildStatusJson(snapshot, appRunning);
    out.json(body, 2);
    process.exitCode = exitCode;
    return;
  }
  out.print(...statusBlocks(snapshot, appRunning));
  if (snapshot.health.status !== "ok") process.exitCode = 1;
}

async function runManualLogin(): Promise<void> {
  const r = await loginSdm(logLine);
  if (r.ok) {
    out.print(out.line("done", "Logged in to StrongDM"));
    return;
  }
  out.fail({ title: "Could not log in to StrongDM", why: r.error });
  process.exitCode = 1;
}

export async function loginCmd(args: string[]): Promise<void> {
  const manual = args.includes("--manual");
  const visible = args.includes("--visible");

  if (manual) {
    if (!process.stdin.isTTY) {
      out.fail({ title: "This login needs a terminal", why: "It asks questions and opens your browser, so a script cannot run it." });
      process.exitCode = 1;
      return;
    }
    out.print(out.line("running", "Starting the StrongDM login", "answer its questions here; your browser opens to finish"));
    await runManualLogin();
    return;
  }

  const app = await withProgress("Checking the StrongDM app", true, onLine => ensureSdmApp(onLine));
  if (!app.value.ok) {
    out.fail(appFailure(app.value.error), ...excerpt(app.tail));
    process.exitCode = 1;
    return;
  }

  const { runBrowserLogin } = await import("../lib/sdm/browser-login.ts");
  const label = visible ? "Logging in to StrongDM, a browser window will show" : "Logging in to StrongDM";
  const login = await withProgress(label, true, onLine => runBrowserLogin({ visible, onLine }));
  const outcome = login.value;
  if (outcome.outcome === "authenticated") {
    out.print(out.line("done", "Logged in to StrongDM"));
    return;
  }
  if (outcome.outcome === "needs-manual") {
    if (!process.stdin.isTTY) {
      out.fail(manualLoginFailure(redact(outcome.reason)));
      process.exitCode = 1;
      return;
    }
    out.print(out.line("warn", "The browser login could not run", redact(outcome.reason)), out.callout("note", MANUAL_NOTE));
    await runManualLogin();
    return;
  }
  const failure = loginFailure(redact(outcome.error), visible);
  out.fail(failure, ...excerpt(login.tail, failure.why), ...loginTip(visible));
  process.exitCode = 1;
}

export async function refreshCmd(): Promise<void> {
  const { resources, error } = await getScan(true);
  out.print(...refreshBlocks(resources.length, error));
}

/**
 * Pure formatter for `rt sdm enrichment init`: a JSONC skeleton with one
 * entry per scanned resource name, ready to fill in labels/tiers. No console
 * writes, so this is unit-testable without a terminal.
 */
export function enrichmentSkeleton(names: string[]): string {
  const lines = [
    "{",
    "  // rt sdm enrichment: map a StrongDM resource name to a nicer label/tier/db.",
    "  // Fill in labels; delete resources you do not care about. Unmapped -> raw name.",
  ];
  names.forEach((name, i) => lines.push(`  ${JSON.stringify(name)}: { "label": "", "tier": "" }${i === names.length - 1 ? "" : ","}`));
  lines.push("}", "");
  return lines.join("\n");
}

/**
 * `rt sdm enrichment`: show how much of the scanned catalog is enriched.
 * `rt sdm enrichment init`: scaffold ~/.mattstack/rt/sdm/enrichment.jsonc with one
 * entry per scanned resource, refusing to clobber an existing file, or once
 * the team store owns `rt.sdmEnrichment` (the ownership latch), refusing to
 * scaffold the file at all, since the store is authoritative from here on.
 */
export async function enrichmentCmd(rest: string[]): Promise<void> {
  const { enrichmentPath, loadEnrichment } = await import("../lib/sdm/enrichment.ts");
  const path = enrichmentPath();
  if (rest[0] === "init") {
    if (probeEnrichmentStore() !== undefined) {
      out.print(out.line("skipped", "Your team's settings already label these connections", "rt did not create a labels file"), out.kv("file", path));
      return;
    }
    if (existsSync(path)) {
      out.note(out.line("refused", "Your labels file already exists"), out.kv("file", path));
      process.exitCode = 1;
      return;
    }
    const { resources } = await getScan(true);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, enrichmentSkeleton(resources.map(r => r.name)));
    out.print(
      out.line("done", "Created your labels file", `${resources.length} connection${resources.length === 1 ? "" : "s"}`),
      out.kv("file", path),
      out.callout("next", "Give a label to each connection you use"),
    );
    return;
  }
  const enr = loadEnrichment(path);
  const { resources } = await getScan();
  const enriched = resources.filter(r => enr[r.name]).length;
  out.print(...enrichmentBlocks(path, enriched, resources.length));
}

export const __test__ = {
  withProgress,
  excerpt,
  redact,
  logLine,
  loginTip,
  guidedConnect,
  connectedBlocks,
  connectFailure,
  healthFailure,
  loginFailure,
  manualLoginFailure,
  productionRefusal,
  appFailure,
  statusBlocks,
  connectionsBlocks,
  refreshBlocks,
  enrichmentBlocks,
};
