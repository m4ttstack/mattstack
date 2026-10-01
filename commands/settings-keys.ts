/**
 * rt settings get/set/list/explain — the resolver-backed settings verbs
 * (RT-47 Task 6). Kept separate from commands/settings.ts (token/notification/
 * dev-mode/runaway leaves) so this file owns only the four resolver verbs.
 *
 *   rt settings get <key> [--repo <name>] [--json]
 *   rt settings set <key> <json-value> --scope user|team|machine [--repo <name>] [--team <name>]
 *   rt settings list [--repo <name>] [--json]
 *   rt settings explain <key> [--repo <name>]
 *
 * `--repo <name>` resolves through lib/repo-arg.ts (name, path, or serialized
 * identity) to the identity the index keys on, then that key to a path,
 * derives its identity (async — never a sync spawn), and feeds the resolver
 * `expandCtx.repoRoot` (so a `${repoRoot}` value in a `get` never throws when
 * --repo was given). Without --repo, an unexpandable `${repoRoot}` is the
 * honest outcome of `get` — its thrown message is rendered cleanly and the
 * process exits 1, no stack trace.
 *
 * These verbs run entirely in-process against lib/settings/resolve.ts and
 * write.ts (both daemon-free, sync-spawn-free) — they do not go through the
 * daemon. The daemon's settings:get/settings:list handlers
 * (lib/daemon/handlers/settings.ts) exist for other in-process-unfriendly
 * consumers and are deliberately expand:false, repo-context-free.
 */

import { parse, type ParseError } from "jsonc-parser";
import * as out from "../lib/ui/out.ts";
import type { CellInput, FailureInput } from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { loadRepoIndex } from "../lib/repo-index.ts";
import { resolveRepoArg } from "../lib/repo-arg.ts";
import { repoDataDir } from "../lib/rt-paths.ts";
import { deriveRepoIdentity } from "../lib/settings/identity.ts";
import {
  explainSetting,
  getSetting,
  listSettings,
  type ExplainRow,
  type ListedSetting,
  type Provenance,
  type Resolved,
  type Scope,
} from "../lib/settings/resolve.ts";
import { pruneStoreName, setSetting, setSettingsNoticeSink, unsetSetting, type SettingsNotice } from "../lib/settings/write.ts";
import { noticeBlocks } from "../lib/settings/notice-blocks.ts";
import { currentStoreName } from "../lib/settings/migrate.ts";
import { getDef, isMigrated, type SettingDef, type SettingScope } from "../lib/settings/registry.ts";
import { firstIssueText, formatIssuePath } from "../lib/settings/schema.ts";
import { checkStores, type CheckFinding } from "../lib/settings/check.ts";
import { planStoreMigrations, type MigrationPlan, type OlderName } from "../lib/settings/migrate-stores.ts";
import { buildInterceptRules, writeInterceptRules } from "../lib/endpoint/shim.ts";

// ─── arg parsing (commands/events.ts conventions) ────────────────────────────

const FLAGS_WITH_VALUES = new Set(["--repo", "--scope", "--team"]);

function positionals(args: string[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.has(a)) i++; // skip the flag's value slot
      continue;
    }
    found.push(a);
  }
  return found;
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function fail(f: string | FailureInput): never {
  out.fail(typeof f === "string" ? { title: f } : f);
  process.exit(1);
}

/** The resolver and writer prefix their messages with "rt: "; the failure block already says who is talking. */
function failWithError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  out.fail({ title: message.replace(/^rt: /, "") });
  process.exit(1);
}

function uniqueNotices(notices: SettingsNotice[]): SettingsNotice[] {
  return [...new Map(notices.map((n) => [`${n.text}\u0000${n.next ?? ""}`, n])).values()];
}

/** Holds the share tips a write emits so the verb can print them under its own confirmation line. */
function collectSettingsNotices<T>(fn: () => T): { result: T; notices: SettingsNotice[] } {
  const notices: SettingsNotice[] = [];
  const previous = setSettingsNoticeSink((line, notice) => notices.push(notice ?? { text: line }));
  try {
    return { result: fn(), notices };
  } finally {
    setSettingsNoticeSink(previous);
  }
}

function whereText(scope: SettingScope, team: string | undefined, repoName: string | undefined): string {
  const store = scope === "user" ? "your user settings" : scope === "machine" ? "this Mac's settings" : team ? `the ${team} team's settings` : "the team's settings";
  return repoName ? `${store} for ${repoName}` : store;
}

// ─── --repo resolution ────────────────────────────────────────────────────────

interface RepoContext {
  repoIdentity: string | null;
  /** Always set when --repo was given, regardless of whether identity derivation succeeded — this is what lets `${repoRoot}` expand even for a repo whose remote doesn't normalize to an identity. */
  expandCtx?: { repoRoot: string };
}

function repoIndex(): Record<string, string> {
  return loadRepoIndex();
}

/**
 * Resolves `--repo <name>` for the READ verbs (get/list/explain).
 *
 * When the name resolves to a path but no identity derives (a local-path
 * remote, no remote at all, an unrecognized host), the repo rungs of every
 * store are simply unreachable — `${repoRoot}` still answers, so the command
 * succeeds with a strictly smaller ladder. That is an honest degrade, but a
 * SILENT one is a trap: the user asked about a repo and got an answer that
 * quietly ignored every repo-scoped value. So say it once as a warn line. The
 * callers that print a payload or --json call out.payloadOnStdout() first, so
 * the line lands on stderr and stdout stays the value or the one envelope.
 * `set` does not come through here; it refuses outright rather than writing
 * into a section nothing will read back.
 */
async function resolveRepoContext(repoName: string | undefined): Promise<RepoContext> {
  if (!repoName) return { repoIdentity: null };
  // The index keys on serialized identities, so a typed name has to resolve to
  // one before it can be looked up. Every registered repo reads as
  // unregistered otherwise.
  const repoPath = repoIndex()[await resolveRepoArg(repoName, fail)];
  if (!repoPath) fail({ title: `${repoName} is not a repo rt knows`, next: out.cmd("rt repos status") });
  const derived = await deriveRepoIdentity(repoPath);
  const identity = derived.kind === "remote" ? derived.id : null;
  if (!identity) {
    out.print(out.line("warn", `Repo settings for ${repoName} are out of reach`, "its remote is not one rt can key on"));
  }
  return {
    repoIdentity: identity,
    expandCtx: { repoRoot: repoPath },
  };
}

// ─── formatting helpers ────────────────────────────────────────────────────────

/** Compact one-line rendering for list/explain rows. */
export function formatValueInline(value: unknown): string {
  if (value === undefined) return "<unset>";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Multi-line rendering for a single `get`. */
export function formatValuePretty(value: unknown): string {
  if (value === undefined) return "<unset>";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

const SCOPE_WORDS: Record<Scope, string> = {
  default: "the built-in default",
  team: "the team's settings",
  user: "your user settings",
  "team.repo": "the team's settings for this repo",
  "user.repo": "your user settings for this repo",
  machine: "this Mac's settings",
  "machine.repo": "this Mac's settings for this repo",
};

/** Weakest first, the order the resolver merges them in. */
export function describeProvenance(provenance: Provenance[]): string {
  if (provenance.length === 0) return "not set anywhere";
  return `from ${provenance.map((p) => SCOPE_WORDS[p.scope]).join(", then ")}`;
}

/** The `migrated:false` note; null for a migrated key. */
export function migratedNote(def: SettingDef): string | null {
  if (isMigrated(def)) return null;
  return def.legacyFile ? "still reads its legacy file" : "not writable through settings yet";
}

// ─── get ────────────────────────────────────────────────────────────────────

export async function settingsGet(args: string[]): Promise<void> {
  const [key] = positionals(args);
  if (!key) fail({ title: "Name the setting to read", next: out.cmd("rt settings get <key>") });
  const json = args.includes("--json");
  // The value is the payload: a script reads it from stdout, so every human line goes to stderr.
  out.payloadOnStdout();
  const repoCtx = await resolveRepoContext(flagValue(args, "--repo"));

  const def = getDef(key);
  if (!def) fail({ title: `No setting is called ${key}`, next: out.cmd("rt settings list") });

  let resolved: Resolved<unknown>;
  try {
    resolved = getSetting(key, {
      repoIdentity: repoCtx.repoIdentity,
      expandCtx: repoCtx.expandCtx,
    });
  } catch (err) {
    failWithError(err);
  }

  if (json) {
    out.json({
      ok: true,
      key,
      value: resolved.value,
      provenance: resolved.provenance,
      migrated: isMigrated(def),
      ...(isMigrated(def) ? {} : { legacyFile: def.legacyFile ?? null }),
    });
    return;
  }

  const note = migratedNote(def);
  out.print(out.kv(key, undefined, describeProvenance(resolved.provenance)), ...(note ? [out.callout("note", note)] : []));
  out.payload(`${formatValuePretty(resolved.value)}\n`);
}

// ─── set / unset ────────────────────────────────────────────────────────────

const VALID_SCOPES: SettingScope[] = ["user", "team", "machine"];

function requireScope(scope: string | undefined, title: string, usage: string): SettingScope {
  if (!scope) fail({ title, why: "A value lives in exactly one of your user, team or machine settings.", next: out.cmd(usage) });
  if (!VALID_SCOPES.includes(scope as SettingScope)) fail({ title: `${scope} is not a scope`, why: "The scopes are user, team and machine.", next: out.cmd(usage) });
  return scope as SettingScope;
}

/**
 * The three repo forms a write needs, resolved from `--repo`. Never
 * interchangeable: `repoKey` is the SERIALIZED identity the index and data
 * dirs key on, `repoIdentity` is the RAW host/path form settings sections key
 * on, and `repoName` is the label the user typed and the only one safe to
 * print back. Shared by set and unset so the two cannot drift apart on which
 * form reaches the store.
 */
async function resolveRepoTarget(args: string[]): Promise<{
  repoName?: string;
  repoPath?: string;
  repoIdentity?: string;
  repoKey?: string;
}> {
  const repoName = flagValue(args, "--repo");
  if (!repoName) return {};

  const repoKey = await resolveRepoArg(repoName, fail);
  const repoPath = repoIndex()[repoKey];
  if (!repoPath) fail({ title: `${repoName} is not a repo rt knows`, next: out.cmd("rt repos status") });
  const derived = await deriveRepoIdentity(repoPath);
  if (derived.kind !== "remote") {
    fail({ title: `Repo settings for ${repoName} have nowhere to live`, why: "Its remote is not one rt can key settings on, so nothing would read a value written for it." });
  }
  return { repoName, repoPath, repoIdentity: derived.id, repoKey };
}

/** Shared by set and unset: `--team` only means anything at team scope. */
function teamFlag(args: string[], scope: SettingScope, usage: string): string | undefined {
  const team = flagValue(args, "--team");
  if (args.includes("--team")) {
    if (scope !== "team") fail({ title: "A team name only goes with the team scope", why: `You asked for the ${scope} scope.`, next: out.cmd(usage) });
    if (team === undefined || team.startsWith("--") || team.trim() === "") fail({ title: "Name the team", next: out.cmd(usage) });
  }
  return team;
}

const SET_USAGE = "rt settings set <key> <value> --scope user|team|machine";

export async function settingsSet(args: string[]): Promise<void> {
  const [key, rawValue] = positionals(args);
  if (!key || rawValue === undefined) fail({ title: "Give the setting a key and a value", next: out.cmd(SET_USAGE) });
  const scope = requireScope(flagValue(args, "--scope"), "Say which settings to write", SET_USAGE);

  // `--team` is the CLI surface for `setSetting`'s team selection (see
  // write.ts's "Team selection"). Taking it silently at user/machine scope
  // would let a `--scope user --team acme` write look like it targeted a team
  // store while writing the user one.
  const team = teamFlag(args, scope, "rt settings set <key> <value> --scope team --team <name>");

  const trimmed = rawValue.trim();
  const errors: ParseError[] = [];
  const value = trimmed === "" ? undefined : parse(trimmed, errors, { allowTrailingComma: true });
  if (trimmed === "" || errors.length > 0) {
    fail({ title: "The value is not valid JSON", hint: rawValue, why: "A string needs its own quotes, so the shell does not eat them: '\"debug\"'." });
  }

  const target = await resolveRepoTarget(args);

  const { notices } = collectSettingsNotices(() => {
    try {
      setSetting(key, value, scope, { repoIdentity: target.repoIdentity, team });
    } catch (err) {
      failWithError(err);
    }
  });

  out.print(
    out.line("done", `Saved ${key}`, whereText(scope, team, target.repoName)),
    ...notices.flatMap(noticeBlocks),
    ...(await regenBlocks(key, target)),
  );
}

const UNSET_USAGE = "rt settings unset <key> --scope user|team|machine";

/**
 * Removes a key from one authored store. The counterpart to `set`, and the
 * only supported way to take a key back out: hand-editing a store `.jsonc` is
 * banned (it silently corrupts a store into reading as empty).
 *
 * Runs the same derived-cache regeneration as `set`, because removing a value
 * changes what the resolver returns exactly as writing one does... a stale
 * intercepts.json after an unset would keep matching the removed rules.
 */
export async function settingsUnset(args: string[]): Promise<void> {
  const [key] = positionals(args);
  if (!key) fail({ title: "Name the setting to remove", next: out.cmd(UNSET_USAGE) });
  const scope = requireScope(flagValue(args, "--scope"), "Say which settings to remove it from", UNSET_USAGE);
  const team = teamFlag(args, scope, "rt settings unset <key> --scope team --team <name>");
  const target = await resolveRepoTarget(args);

  const removed = collectSettingsNotices(() => {
    try {
      return unsetSetting(key, scope, { repoIdentity: target.repoIdentity, team });
    } catch (err) {
      failWithError(err);
    }
  });

  const where = whereText(scope, team, target.repoName);
  // A key that was not there is success, not a failure: `unset` is how a
  // script makes sure a key is absent, so it has to be safe to run twice.
  if (!removed.result) {
    out.print(out.line("skipped", `${key} was not set`, `nothing to remove from ${where}`));
    return;
  }

  out.print(
    out.line("done", `Removed ${key}`, `from ${where}`),
    ...removed.notices.flatMap(noticeBlocks),
    ...(await regenBlocks(key, target)),
  );
}

/**
 * The derived caches a write may have invalidated, as lines under the
 * confirmation. hooks.json is rebuilt only for a `--repo` write: a global
 * write can change the resolved value for every other repo too, and
 * deriving every repo's identity (a git spawn each) on one `set` is out of
 * scope; `rt hooks status` in an affected repo refreshes its cache.
 */
async function regenBlocks(key: string, target: { repoName?: string; repoPath?: string; repoIdentity?: string; repoKey?: string }): Promise<Block[]> {
  const blocks: Block[] = [];
  const regen = await regenerateInterceptsCache(key);
  if (regen.regenerated) {
    blocks.push(out.line("done", "Intercepts updated", `${regen.rules} rule${regen.rules === 1 ? "" : "s"}`));
  } else if (regen.error) {
    blocks.push(out.line("warn", "Intercepts not updated", regen.error), out.callout("next", out.cmd("rt intercept install")));
  }
  if (key === "rt.hooks" && target.repoPath && target.repoIdentity && target.repoKey) {
    const { regenerateHooksCache } = await import("./hooks.ts");
    if (regenerateHooksCache(target.repoPath, repoDataDir(target.repoKey), target.repoIdentity)) {
      blocks.push(out.line("done", "Hooks updated", target.repoName));
    } else {
      blocks.push(out.line("warn", `Hooks not updated for ${target.repoName}`), out.callout("next", [out.cmd("rt hooks status"), " in that repo"]));
    }
  }
  return blocks;
}

// ─── the intercepts.json regeneration seam ──────────────────────────────────
//
// ~/.mattstack/rt/intercepts.json is a CACHE of what `loadEndpointConfig`
// would return for every registered repo; the intercept shim's match path
// reads only that file, never the resolver (it must stay spawn-free and
// instant). So a `set` of a key the cache is built from has to regenerate it,
// or the next intercepted command matches against the pre-write rules.
//
// The dependency direction is deliberate and one-way: this command module
// imports lib/endpoint/shim.ts, and nothing under lib/endpoint imports a
// command module — so the writer (which is the only place that KNOWS a write
// just happened) drives the regen, and no import cycle exists. Putting the
// hook inside setSetting would have inverted that, dragging the endpoint
// module (and its git spawns) into every settings write.
//
// Deliberately NOT `installShims()`: writing executables onto the user's PATH
// is not a side effect `rt settings set` should have silently. A newly
// intercepted command therefore lands in the cache but has no shim yet, which
// `rt intercept status` and `rt verify` both already report as "declared but
// not installed → run rt intercept install".

/** The keys `buildInterceptRules` resolves; a write to either invalidates the cache. */
const INTERCEPT_CACHE_KEYS = new Set(["rt.intercepts", "rt.roles"]);

export interface RegenResult {
  regenerated: boolean;
  /** Rules written, when regenerated. */
  rules?: number;
  /** Why it failed, when it failed. Never thrown — the `set` itself already succeeded. */
  error?: string;
}

/**
 * Rebuilds intercepts.json when `key` is one the cache is derived from.
 *
 * Never throws: by the time this runs the store write has already landed, so
 * a regen failure must be reported (the caller prints it) rather than turned
 * into a failed `set` the user would retry pointlessly. `rt intercept install`
 * is always the manual recovery.
 */
export async function regenerateInterceptsCache(key: string): Promise<RegenResult> {
  if (!INTERCEPT_CACHE_KEYS.has(key)) return { regenerated: false };
  try {
    const rules = await buildInterceptRules();
    writeInterceptRules(rules);
    return { regenerated: true, rules: rules.length };
  } catch (err) {
    return { regenerated: false, error: (err as Error).message };
  }
}

// ─── list ───────────────────────────────────────────────────────────────────

export async function settingsList(args: string[]): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const repoCtx = await resolveRepoContext(flagValue(args, "--repo"));

  const settings = listSettings({
    repoIdentity: repoCtx.repoIdentity,
    expandCtx: repoCtx.expandCtx,
  });

  if (json) {
    out.json({ ok: true, settings });
    return;
  }

  out.print(out.table(settings.map(renderListRow)));
}

/** One table row: the key, then the value with any caveats beside it. */
export function renderListRow(s: ListedSetting): CellInput[] {
  const labels: string[] = [];
  if (s.unregistered) labels.push("unregistered");
  // `migrated` is a registry fact, so an UNREGISTERED row has none: it comes
  // back false by default, and labelling it "legacy" would name a migration
  // window that does not exist for a key rt has never heard of.
  if (!s.migrated && !s.unregistered) {
    const def = getDef(s.key);
    labels.push(def ? (migratedNote(def) as string) : "reads legacy");
  }
  if (s.expandError) labels.push(`expandError: ${s.expandError}`);
  for (const inv of s.invalid ?? []) labels.push(`invalid[${inv.scope}]: ${inv.reason}`);
  for (const nc of s.nonconforming ?? []) labels.push(`nonconforming[${nc.scope}]: ${firstIssueText(nc.issues)}`);
  if (s.mergedIssues && s.mergedIssues.length > 0) labels.push(`merged: ${firstIssueText(s.mergedIssues)}`);
  for (const d of s.diverged ?? []) labels.push(`diverged[${d.scope}]: ${d.storeNames.join(", ")}`);
  if (s.newer) labels.push("from a newer rt");

  const value: Array<string | Segment> = [formatValueInline(s.value)];
  if (labels.length > 0) value.push({ text: `  ${labels.join("; ")}`, role: "warn" });
  return [out.key(s.key), value];
}

// ─── explain ────────────────────────────────────────────────────────────────

export async function settingsExplain(args: string[]): Promise<void> {
  const [key] = positionals(args);
  if (!key) fail({ title: "Name the setting to explain", next: out.cmd("rt settings explain <key>") });
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const repoCtx = await resolveRepoContext(flagValue(args, "--repo"));

  const def = getDef(key);
  if (!def) fail({ title: `No setting is called ${key}`, next: out.cmd("rt settings list") });

  let rows: ExplainRow[];
  try {
    rows = explainSetting(key, { repoIdentity: repoCtx.repoIdentity });
  } catch (err) {
    failWithError(err);
  }

  const currentName = currentStoreName(def);

  if (json) {
    out.json({ ok: true, key, rows, currentStore: currentName ?? null });
    return;
  }

  out.print(out.tree(out.key(key), rows.flatMap((row) => renderExplainRow(row, currentName))));
}

/**
 * One child row per reachable rung, weakest first (the order explainSetting
 * returns them in), plus a row per older store name beside it. A shadowed or
 * invalid value is marked, not applied.
 */
export function renderExplainRow(row: ExplainRow, currentName?: string): CellInput[][] {
  const where = row.file ?? (row.scope === "default" ? "built-in default" : "no file");
  if (!row.present) return [[out.faint(row.scope), out.faint(where), out.faint("not set")]];

  const marks: string[] = [];
  let role: Segment["role"] = "done";
  if (row.shadowed) {
    marks.push(`[shadowed: ${row.shadowed}]`);
    role = "warn";
  }
  if (row.nonconforming) {
    marks.push(`[nonconforming: ${firstIssueText(row.nonconforming)}]`);
    role = "warn";
  }
  if (row.invalid) {
    marks.push(`[invalid: ${row.invalid}]`);
    role = "failed";
  }
  if (currentName !== undefined && row.storeName !== undefined && row.storeName !== currentName) {
    marks.push(`[read from ${row.storeName}, version ${row.storedVersion}]`);
  }

  const main: CellInput[] = [{ text: row.scope, role }, out.faint(where), formatValueInline(row.value)];
  if (marks.length > 0) main.push({ text: marks.join("  "), role: role === "done" ? "dim" : role });

  const older = (row.olderNames ?? []).map((o): CellInput[] => [
    "",
    [
      { text: `older ${o.storeName}: ${o.label}`, role: o.label === "diverged" ? "needs-you" : "dim" },
      ...(o.label === "diverged" ? [`  ${formatValueInline(o.value)}`] : []),
    ],
  ]);
  return [main, ...older];
}

// ─── check ──────────────────────────────────────────────────────────────────

/** Drops empty trailing cells so a row without a store name or file does not end in padding. */
function trimRow(cells: CellInput[]): CellInput[] {
  const text = (c: CellInput): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((s) => (typeof s === "string" ? s : s.text)).join("") : c.text);
  while (cells.length > 1 && text(cells[cells.length - 1]!) === "") cells.pop();
  return cells;
}

/**
 * A row per finding, then a row per value or issue under it. A `merged`
 * finding carries no scope or file, so its row names only the repo, if any.
 */
export function renderCheckFinding(f: CheckFinding): CellInput[][] {
  const where = [f.scope, f.repo].filter(Boolean).join("/");
  const kindText = f.newer ? "unregistered (from a newer rt)" : f.kind;
  const role: Segment["role"] = f.kind === "stale" || f.kind === "leftover" ? "dim" : f.kind === "unregistered" ? "warn" : "failed";
  const rows: CellInput[][] = [trimRow([out.key(f.key), where, { text: kindText, role }, f.storeName ?? "", out.faint(f.file ?? "")])];
  // Detail text sits in the last column, where the file path already is: in any
  // earlier column it would pad every finding's row to the detail's width.
  const detail = (text: string): CellInput[] => ["", "", "", "", text];
  if (f.kind === "diverged" && "olderValue" in f) {
    rows.push(detail(`${f.storeName}: ${formatValueInline(f.olderValue)}`), detail(`current: ${formatValueInline(f.currentValue)}`));
  }
  for (const i of f.issues) rows.push(detail(`${formatIssuePath(i.path)}: ${i.message}`));
  return rows;
}

export async function settingsCheck(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const report = checkStores();

  if (json) {
    out.json({ ok: report.failing === 0, findings: report.findings });
  } else {
    const unregistered = report.findings.filter((f) => f.kind === "unregistered").length;
    const older = report.findings.filter((f) => f.kind === "stale" || f.kind === "leftover").length;
    out.print(
      out.table(report.findings.flatMap(renderCheckFinding)),
      out.summary(
        report.failing > 0 ? "failed" : "done",
        report.failing > 0 ? "Some stored settings need fixing" : "Your stored settings check out",
        [`${report.failing} failing`, `${unregistered} unregistered`, `${older} stale or leftover`],
      ),
    );
  }

  if (report.failing > 0) process.exitCode = 1;
}

// ─── migrate ────────────────────────────────────────────────────────────────

export interface MigrateDeps {
  confirm?: (message: string) => Promise<boolean>;
  interactive?: boolean;
}

const whereCells = (x: { scope: string; repo?: string; file: string }): CellInput[] => [[x.scope, x.repo].filter(Boolean).join("/"), out.faint(x.file)];
const isSecret = (key: string) => getDef(key)?.secret === true;
const shown = (key: string, value: unknown) => (isSecret(key) ? "(secret)" : formatValueInline(value));
/** `undefined` rather than a placeholder string: JSON.stringify drops the property entirely, matching check.ts's own secret handling. */
const redacted = (key: string, value: unknown): unknown => (isSecret(key) ? undefined : value);
const redactOlder = <T extends OlderName>(o: T): T => ({
  ...o,
  olderValue: redacted(o.key, o.olderValue),
  currentValue: redacted(o.key, o.currentValue),
  authored: redacted(o.key, o.authored),
});

function olderRows(o: OlderName): CellInput[][] {
  const row: CellInput[] = [out.key(o.key), ...whereCells(o), { text: `${o.storeName}: ${o.label}`, role: o.label === "diverged" ? "needs-you" : "dim" }];
  if (o.label !== "diverged") return [row];
  return [row, ["", "", "", `${o.storeName}: ${shown(o.key, o.olderValue)}`], ["", "", "", `current: ${shown(o.key, o.currentValue)}`]];
}

const failureRow = (f: MigrationPlan["failures"][number]): CellInput[] => [out.key(f.key), ...whereCells(f), { text: `cannot migrate ${f.fromName}: ${f.message}`, role: "failed" }];

/**
 * rt settings migrate [--write | --prune [--team] [--force <key>]... [--yes]] [--json]
 * Dry run by default. --write is additive (current names from migrated
 * values, baselines recorded by the ordinary write path); --prune deletes
 * leftover and stale older names through pruneStoreName after confirmation.
 */
export async function settingsMigrate(args: string[], deps: MigrateDeps = {}): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const write = args.includes("--write");
  const prune = args.includes("--prune");
  if (write && prune) {
    out.fail({ title: "Write and prune are separate runs", why: "Prune only once every reader of the store knows the new names.", next: out.cmd("rt settings migrate --write") });
    process.exitCode = 1;
    return;
  }
  const plan = planStoreMigrations();
  if (write) return migrateWrite(plan, json);
  if (prune) {
    const forced = new Set<string>();
    let forceUsageError = false;
    args.forEach((a, i) => {
      if (a !== "--force") return;
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) forceUsageError = true;
      else forced.add(value);
    });
    if (forceUsageError) {
      out.fail({ title: "--force needs a key", hint: "for example --force rt.notify.eventBridges" });
      process.exitCode = 1;
      return;
    }
    const unmatched = [...forced].filter((key) => !plan.older.some((o) => o.key === key));
    if (unmatched.length > 0) out.print(...unmatched.map((key) => out.line("warn", `--force ${key} matches no older store name in this plan`)));
    const interactive = deps.interactive ?? (process.stdin.isTTY === true && !json && !process.env.RT_BATCH);
    const ask = deps.confirm ?? (async (message: string) => (await import("../lib/ui/prompts.ts")).confirm({ message, destructive: true }));
    return migratePrune(plan, { json, team: args.includes("--team"), yes: args.includes("--yes"), forced, interactive, ask });
  }
  if (json) {
    out.json({
      ok: plan.failures.length === 0,
      writes: plan.writes.map((w) => ({ ...w, value: redacted(w.key, w.value) })),
      failures: plan.failures,
      older: plan.older.map((o) => redactOlder(o)),
    });
  } else {
    const rows: CellInput[][] = [
      ...plan.writes.map((w): CellInput[] => [out.key(w.key), ...whereCells(w), `would write ${w.storeName} from ${w.fromName}: ${shown(w.key, w.value)}`]),
      ...plan.failures.map(failureRow),
      ...plan.older.flatMap(olderRows),
    ];
    out.print(rows.length > 0 ? out.table(rows) : out.line("done", "Every stored setting is under its current name"));
  }
  if (plan.failures.length > 0) process.exitCode = 1;
}

function migrateWrite(plan: MigrationPlan, json: boolean): void {
  const written: MigrationPlan["writes"] = [];
  const errors: { key: string; file: string; repo?: string; error: string }[] = [];
  const { notices } = collectSettingsNotices(() => {
    for (const w of plan.writes) {
      try {
        setSetting(w.key, w.value, w.scope, { ...(w.repo ? { repoIdentity: w.repo } : {}), ...(w.team ? { team: w.team } : {}) });
        written.push(w);
      } catch (err) {
        errors.push({ key: w.key, file: w.file, ...(w.repo ? { repo: w.repo } : {}), error: (err as Error).message });
      }
    }
  });
  const tips = uniqueNotices(notices).flatMap(noticeBlocks);
  const ok = errors.length === 0 && plan.failures.length === 0;
  if (json) {
    out.json({ ok, written: written.map((w) => ({ ...w, value: redacted(w.key, w.value) })), errors, failures: plan.failures });
    if (tips.length > 0) out.print(...tips);
  } else {
    const rows: CellInput[][] = [
      ...written.map((w): CellInput[] => [out.key(w.key), ...whereCells(w), `wrote ${w.storeName} from ${w.fromName}`]),
      ...errors.map((e): CellInput[] => [out.key(e.key), { text: e.error, role: "failed" }]),
      ...plan.failures.map(failureRow),
    ];
    out.print(rows.length > 0 ? out.table(rows) : out.line("skipped", "Nothing to write"), ...tips);
  }
  if (!ok) process.exitCode = 1;
}

async function migratePrune(
  plan: MigrationPlan,
  o: { json: boolean; team: boolean; yes: boolean; forced: Set<string>; interactive: boolean; ask: (message: string) => Promise<boolean> },
): Promise<void> {
  const refused: (OlderName & { reason: string })[] = [];
  const pruned: OlderName[] = [];
  const notices: SettingsNotice[] = [];
  const byFile = new Map<string, OlderName[]>();
  for (const n of plan.older) {
    if (n.scope === "team" && !o.team) refused.push({ ...n, reason: "team store: pass --team to prune it" });
    else if (n.label === "diverged" && !o.forced.has(n.key)) refused.push({ ...n, reason: `diverged: pass --force ${n.key} to delete it` });
    else byFile.set(n.file, [...(byFile.get(n.file) ?? []), n]);
  }
  for (const [file, names] of byFile) {
    const scope = names[0]!.scope;
    if (!o.json) {
      const versions = [...new Map(names.map((n) => [n.key, n.storeVersion])).entries()].map(([k, v]) => `${k} (storeVersion ${v})`);
      out.print(
        out.section(
          `${scope} store`,
          file,
          out.table(names.map((n): CellInput[] => [n.storeName, n.repo ?? "", n.label])),
          out.paragraph(`Every reader of this store must know: ${versions.join(", ")}`),
        ),
      );
    }
    const noun = names.length === 1 ? "name" : "names";
    const approved = o.yes || (o.interactive && (await o.ask(`Delete ${names.length} older store ${noun} from the ${scope} store (${file})?`)));
    if (!approved) {
      const reason = o.interactive ? "not confirmed" : "confirmation needed: run on a terminal, or pass --yes";
      for (const n of names) refused.push({ ...n, reason });
      continue;
    }
    for (const n of names) {
      if (n.label === "diverged" && !o.json) out.print(out.line("warn", `Deleting diverged ${n.storeName}`, `its value was: ${shown(n.key, n.authored)}`));
      const run = collectSettingsNotices(() => {
        try {
          pruneStoreName(n.key, n.storeName, n.scope, { ...(n.repo ? { repoIdentity: n.repo } : {}), ...(n.team ? { team: n.team } : {}), force: n.label === "diverged" });
          pruned.push(n);
        } catch (err) {
          refused.push({ ...n, reason: (err as Error).message });
        }
      });
      notices.push(...run.notices);
    }
  }
  const tips = uniqueNotices(notices).flatMap(noticeBlocks);
  if (o.json) {
    out.json({ ok: refused.length === 0, pruned: pruned.map((n) => redactOlder(n)), refused: refused.map((r) => redactOlder(r)) });
    if (tips.length > 0) out.print(...tips);
  } else {
    out.print(
      out.table(refused.map((r): CellInput[] => [out.key(r.key), ...whereCells(r), { text: `${r.storeName}: ${r.reason}`, role: "refused" }])),
      out.summary(refused.length > 0 ? "warn" : "done", `Pruned ${pruned.length} older ${pruned.length === 1 ? "name" : "names"}`, [`${pruned.length} pruned`, `${refused.length} refused`]),
      ...tips,
    );
  }
  if (refused.length > 0) process.exitCode = 1;
}
