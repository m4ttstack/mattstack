/**
 * Installs rt's Codex policy hooks (hook-manifest.ts) in the profile's user
 * layer, `$CODEX_HOME/hooks.json`, and trusts exactly what a person
 * reviewed in that profile's config. rt leaves no footprint in any
 * repository: user hooks load for every working folder and need no folder
 * trust (userhooks spike), so one install covers every repo.
 *
 * Two steps, one review. Codex can only name a hook's native hash once its
 * definition is in the hooks file, and an untrusted definition never runs,
 * so the definitions (and the hook program they name) are written first
 * without a review. The review then shows the exact file, program, commands
 * and the hashes Codex reported, and its approval writes only the matching
 * `[hooks.state."<key>"] trusted_hash` entries.
 *
 * Nothing here trusts a folder, turns a trust check off, replaces a hooks
 * file wholesale, or restarts a shared service. Every write compares the
 * file with what was planned first, and only entries rt wrote are recorded
 * as rt's own.
 */

import { createHash, randomBytes } from "crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { bundledToolPath } from "../../deps/resolve.ts";
import { readSetupState, updateSetupState, type CodexPolicyState, type SetupState } from "../../setup/state.ts";
import {
  CODEX_POLICY_EVENTS, CODEX_POLICY_SOURCE, codexPolicyManifest, codexUserHooksPath, parseCodexPolicyHookCommand, validInstallationId,
  type CodexHookHandler, type CodexPolicyEvent,
} from "./hook-manifest.ts";
import { confirmOwner, type OwnerAuthResult } from "./owner-auth.ts";
import { canonicalCodexProfile } from "./profile.ts";
import { isRecord } from "./protocol.ts";
import { homeInUse, runningCodexHomes } from "./running.ts";
import { codexConfigPath } from "./trust.ts";

/** One hooks/list entry with the native key, hash and trust Codex reports for it. */
export type ListedPolicyHook = {
  key?: string; eventName: string; handlerType?: string; command?: string; sourcePath?: string; source?: string;
  enabled?: boolean; currentHash?: string; trustStatus?: string;
};

export type PolicyInstallDeps = {
  env: NodeJS.ProcessEnv;
  home: string;
  /** The installed app's compiled rt, which the hook executable is copied from. */
  rtSource: () => string | null;
  listHooks: (cwd: string, profile: string) => Promise<Outcome<ListedPolicyHook[]>>;
  attachedSessions: (profile: string) => SessionBinding[] | Promise<SessionBinding[]>;
  /** Every attached Codex session on any profile. */
  codexBindings: () => SessionBinding[] | Promise<SessionBinding[]>;
  /** The Codex homes running `codex` processes use; null when that cannot be read. */
  runningCodexHomes: () => Promise<string[] | null>;
  now: () => Date;
  randomId: () => string;
  /** macOS's owner check (owner-auth.ts); the only thing that lets a review's approval write trust. */
  confirmOwner: (reason: string) => Promise<OwnerAuthResult>;
};

export type PolicyStage = "definitions" | "hooks" | "installed";
export type ReviewedCommand = { event: CodexPolicyEvent; command: string };
export type ReviewedHook = { event: CodexPolicyEvent; key: string; command: string; hash: string };

/** Everything the one approval covers, so its id changes whenever any of it does. */
export type PolicyReview = {
  id: string;
  codexHome: string;
  hooksPath: string;
  configPath: string;
  executable: string;
  digest: string;
  commands: ReviewedCommand[];
  hooks: ReviewedHook[];
};

export type PolicyInstallPlan = {
  /** The folder hooks/list is asked about; user hooks are the same for every folder. */
  cwd: string;
  profile: string;
  codexHome: string;
  configPath: string;
  hooksPath: string;
  installationId: string;
  /** `present`: the copy already holds exactly these bytes. */
  artifact: { source: string; path: string; digest: string; present: boolean };
  /** M6b's manifest revision for this executable and installation. */
  manifest: { revision: string; commands: ReviewedCommand[] };
  /** `definitions` writes rt's untrusted hooks and needs no review; `hooks` trusts them and needs one. */
  stage: PolicyStage;
  /** `before` is the file's fingerprint when planned; `text` is null when the file already holds rt's entries. */
  hooksFile: { before: string; text: string | null; adds: string[] };
  config: { before: string; hooks: ReviewedHook[]; replace: string[] };
  reviews: PolicyReview[];
};

const LISTED: Record<CodexPolicyEvent, string> = { PreToolUse: "preToolUse", Stop: "stop" };
const ABSENT = "absent";

const fail = <T>(code: "refused" | "not-ready" | "invalid", message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const fingerprint = (text: string | null): string => (text === null ? ABSENT : sha256(text));
const tomlString = (value: string): string => JSON.stringify(value);

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function parseToml(text: string | null): Record<string, unknown> | null {
  if (text === null) return {};
  try {
    const parsed: unknown = Bun.TOML.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
}

/** The installed hook executable: named by its own bytes, so a new rt is a new path and the path never moves. */
export function codexPolicyArtifactPath(home: string, digest: string): string {
  return join(home, ".mattstack", "rt", "codex-policy", "bin", digest.slice(0, 16), "rt");
}

function defaultDeps(): PolicyInstallDeps {
  const home = process.env.HOME ?? "";
  return {
    env: process.env,
    home,
    rtSource: () => bundledToolPath({ exists: existsSync, home }, "rt"),
    listHooks: liveListHooks,
    attachedSessions: async (profile) => {
      const [{ listAttachedBindings }, { getStateDb }] = await Promise.all([import("../session-store.ts"), import("../../state/index.ts")]);
      return listAttachedBindings(getStateDb(), "codex").filter((b) => b.native.profile === profile);
    },
    codexBindings: async () => {
      const { stateDbPath } = await import("../../state/db.ts");
      if (!existsSync(stateDbPath())) return [];
      const [{ listAttachedBindings }, { getStateDb }] = await Promise.all([import("../session-store.ts"), import("../../state/index.ts")]);
      return listAttachedBindings(getStateDb(), "codex");
    },
    runningCodexHomes: () => runningCodexHomes({ home }),
    now: () => new Date(),
    randomId: () => `mac-${sha256(`${Date.now()}-${Math.random()}`).slice(0, 12)}`,
    confirmOwner: (reason) => confirmOwner(reason),
  };
}

const withDefaults = (deps: Partial<PolicyInstallDeps>): PolicyInstallDeps => ({ ...defaultDeps(), ...deps });

/** Asks the app server already running for this profile; it never starts one. */
async function liveListHooks(cwd: string, profile: string): Promise<Outcome<ListedPolicyHook[]>> {
  const { connectCodexControl, discoverCodexEndpoint } = await import("./control.ts");
  const endpoint = await discoverCodexEndpoint();
  if (!endpoint.ok) {
    return fail("not-ready", `Codex is not running, so rt cannot read the hashes Codex gives its hooks (${endpoint.error.message}). Open Codex, then run this again.`);
  }
  let control: Awaited<ReturnType<typeof connectCodexControl>>;
  try {
    control = await connectCodexControl({ socketPath: endpoint.data.socketPath, profile });
  } catch (err) {
    return fail("not-ready", `rt could not reach Codex to read its hooks: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    if (control.codexHome !== undefined && canonicalCodexProfile(control.codexHome, { HOME: process.env.HOME }) !== profile) {
      return fail("not-ready", "The Codex that is running uses another Codex home than this profile, so its hooks list would describe the wrong settings.");
    }
    const result = await control.request("hooks/list", { cwds: [cwd] });
    const entries = isRecord(result) && Array.isArray(result.data) ? result.data.filter(isRecord) : [];
    const wanted = new Set([cwd, realOr(cwd)]);
    const entry = entries.find((e) => typeof e.cwd === "string" && (wanted.has(e.cwd) || wanted.has(realOr(e.cwd))));
    if (!entry || !Array.isArray(entry.hooks)) return { ok: true, data: [] };
    const text = (v: unknown) => (typeof v === "string" ? v : undefined);
    return {
      ok: true,
      data: entry.hooks.filter(isRecord).map((h): ListedPolicyHook => ({
        eventName: text(h.eventName) ?? "", key: text(h.key), handlerType: text(h.handlerType), command: text(h.command),
        sourcePath: text(h.sourcePath), source: text(h.source), currentHash: text(h.currentHash), trustStatus: text(h.trustStatus),
        ...(typeof h.enabled === "boolean" && { enabled: h.enabled }),
      })),
    };
  } catch (err) {
    return fail("not-ready", `Codex did not list the hooks it loads for ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    control.close();
  }
}

// ─── The hooks file ──────────────────────────────────────────────────────────

type HooksMerge = { ok: true; text: string | null; adds: string[] } | { ok: false; message: string };

/** The one usable shape: a group holding only rt's handler, exactly as the manifest writes it (policy.ts inspects the same). */
const exactGroup = (group: unknown, handler: CodexHookHandler): boolean =>
  isRecord(group) && Bun.deepEquals(Object.keys(group), ["hooks"]) && Array.isArray(group.hooks) && group.hooks.length === 1
  && Bun.deepEquals(canonical(group.hooks[0]), canonical(handler));

/** Where each JSON value sits in the text, so rt can splice its group in and leave every other byte alone. */
type Span = { start: number; end: number; members?: { key: string; keyStart: number; value: Span }[]; items?: Span[] };

function spansOf(text: string): Span | null {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  const string = (): string => {
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): Span => {
    ws();
    const start = i;
    if (text[i] === "{") {
      i++;
      const members: NonNullable<Span["members"]> = [];
      ws();
      if (text[i] === "}") return { start, end: ++i, members };
      for (;;) {
        ws();
        const keyStart = i;
        if (text[i] !== '"') throw new Error("key");
        const key = string();
        ws();
        if (text[i++] !== ":") throw new Error("colon");
        members.push({ key, keyStart, value: value() });
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i++] === "}") return { start, end: i, members };
        throw new Error("object");
      }
    }
    if (text[i] === "[") {
      i++;
      const items: Span[] = [];
      ws();
      if (text[i] === "]") return { start, end: ++i, items };
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i++] === "]") return { start, end: i, items };
        throw new Error("array");
      }
    }
    if (text[i] === '"') {
      string();
      return { start, end: i };
    }
    while (i < text.length && /[-+.0-9a-zA-Z]/.test(text[i]!)) i++;
    if (i === start) throw new Error("value");
    return { start, end: i };
  };
  try {
    const root = value();
    ws();
    return i === text.length ? root : null;
  } catch {
    return null;
  }
}

type Splice = { start: number; end: number; text: string };

/** The whitespace leading the line `at` starts on, when nothing else precedes it there. */
function lineIndent(text: string, at: number): string | undefined {
  const lead = text.slice(text.lastIndexOf("\n", at - 1) + 1, at);
  return /^[ \t]*$/.test(lead) ? lead : undefined;
}

function indentUnit(text: string): string {
  return /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
}

const render = (value: unknown, unit: string, indent: string): string => JSON.stringify(value, null, unit).split("\n").join(`\n${indent}`);

/** Appends `rendered(indent)` after the last of `siblings`, or fills an empty container. */
function appendInto(text: string, container: Span, lastEnd: number | undefined, lastStart: number | undefined, unit: string, rendered: (indent: string) => string, close: string): Splice {
  const outer = lineIndent(text, container.start) ?? "";
  if (lastEnd === undefined) {
    return { start: container.start, end: container.end, text: `${close === "]" ? "[" : "{"}\n${outer}${unit}${rendered(outer + unit)}\n${outer}${close}` };
  }
  const sibling = lineIndent(text, lastStart!);
  if (sibling === undefined) return { start: lastEnd, end: lastEnd, text: `, ${rendered("").replace(/\n\s*/g, " ")}` };
  return { start: lastEnd, end: lastEnd, text: `,\n${sibling}${rendered(sibling)}` };
}

/**
 * Adds or updates only rt's own handler per event. A handler rt finds
 * already in place is used as it is; one this Mac recorded as its own may
 * be replaced where it stands, so its native key stays the same; any other
 * rt policy hook means someone else installed one, and is refused. An
 * existing file keeps every byte outside rt's own group.
 */
function mergeHooks(path: string, text: string | null, desired: Record<CodexPolicyEvent, CodexHookHandler>, owned: readonly string[]): HooksMerge {
  let file: Record<string, unknown> = {};
  if (text !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: `${path} is not valid JSON. Fix that file, then run this again.` };
    }
    if (!isRecord(parsed)) return { ok: false, message: `${path} does not hold a JSON object. Fix that file, then run this again.` };
    file = structuredClone(parsed);
  }
  if (file.hooks !== undefined && !isRecord(file.hooks)) return { ok: false, message: `${path} lists its hooks in a shape rt does not recognise.` };
  const hooks: Record<string, unknown> = (file.hooks as Record<string, unknown> | undefined) ?? {};
  const adds: string[] = [];
  const edits: ({ kind: "append"; event: CodexPolicyEvent } | { kind: "replace"; event: CodexPolicyEvent; group: number })[] = [];
  for (const event of CODEX_POLICY_EVENTS) {
    const handler = desired[event];
    if (hooks[event] !== undefined && !Array.isArray(hooks[event])) return { ok: false, message: `${path} lists its ${event} hooks in a shape rt does not recognise.` };
    const groups = (hooks[event] as unknown[] | undefined) ?? [];
    const ours: { g: number; command: string }[] = [];
    groups.forEach((group, g) => {
      const handlers = isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [];
      handlers.forEach((entry: unknown) => {
        const command = isRecord(entry) && typeof entry.command === "string" ? entry.command : undefined;
        if (command !== undefined && parseCodexPolicyHookCommand(command)?.event === event) ours.push({ g, command });
      });
    });
    if (ours.length === 1 && exactGroup(groups[ours[0]!.g], handler)) continue;
    if (ours.length === 0) {
      hooks[event] = [...groups, { hooks: [handler] }];
      adds.push(handler.command);
      edits.push({ kind: "append", event });
      continue;
    }
    const [only] = ours;
    const group = groups[only!.g];
    if (ours.length === 1 && owned.includes(only!.command) && isRecord(group) && Bun.deepEquals(Object.keys(group), ["hooks"]) && (group.hooks as unknown[]).length === 1) {
      groups[only!.g] = { hooks: [handler] };
      hooks[event] = groups;
      adds.push(handler.command);
      edits.push({ kind: "replace", event, group: only!.g });
      continue;
    }
    return {
      ok: false,
      message: `${path} already runs ${ours.length === 1 ? "an rt policy hook" : "several rt policy hooks"} for ${event} that this Mac did not add, so rt left that file alone. Remove the other copy, then run this again.`,
    };
  }
  if (adds.length === 0) return { ok: true, text: null, adds };
  const merged = { ...file, hooks };
  if (text === null) return { ok: true, text: `${JSON.stringify(merged, null, 2)}\n`, adds };

  const unreadable = { ok: false as const, message: `rt could not add its hooks to ${path} without rewriting the rest of it, so it left that file alone.` };
  const root = spansOf(text);
  if (root?.members === undefined) return unreadable;
  const unit = indentUnit(text);
  const last = <T>(list: T[]): T | undefined => list[list.length - 1];
  const memberOf = (span: Span, key: string) => span.members?.filter((m) => m.key === key).pop();
  const hooksMember = memberOf(root, "hooks");
  const splices: Splice[] = [];
  if (hooksMember === undefined) {
    const tail = last(root.members);
    splices.push(appendInto(text, root, tail?.value.end, tail?.keyStart, unit, (indent) => `"hooks": ${render(hooks, unit, indent)}`, "}"));
  } else {
    const hooksSpan = hooksMember.value;
    if (hooksSpan.members === undefined) return unreadable;
    const missing: CodexPolicyEvent[] = [];
    for (const edit of edits) {
      const eventSpan = memberOf(hooksSpan, edit.event)?.value;
      if (eventSpan === undefined) {
        missing.push(edit.event);
        continue;
      }
      if (eventSpan.items === undefined) return unreadable;
      const group = { hooks: [desired[edit.event]] };
      if (edit.kind === "replace") {
        const at = eventSpan.items[edit.group];
        if (at === undefined) return unreadable;
        splices.push({ start: at.start, end: at.end, text: render(group, unit, lineIndent(text, at.start) ?? "") });
      } else {
        const tail = last(eventSpan.items);
        splices.push(appendInto(text, eventSpan, tail?.end, tail?.start, unit, (indent) => render(group, unit, indent), "]"));
      }
    }
    if (missing.length > 0) {
      const tail = last(hooksSpan.members);
      const entries = (indent: string) => missing.map((event) => `"${event}": ${render([{ hooks: [desired[event]] }], unit, indent)}`).join(`,\n${indent}`);
      splices.push(appendInto(text, hooksSpan, tail?.value.end, tail?.keyStart, unit, entries, "}"));
    }
  }
  let next = text;
  for (const s of splices.sort((a, b) => b.start - a.start)) next = next.slice(0, s.start) + s.text + next.slice(s.end);
  let reparsed: unknown;
  try {
    reparsed = JSON.parse(next);
  } catch {
    return unreadable;
  }
  return Bun.deepEquals(canonical(reparsed), canonical(merged)) ? { ok: true, text: next, adds } : unreadable;
}

// ─── Codex's config ──────────────────────────────────────────────────────────

/** rt's hooks listed inline (`[[hooks.<Event>]]`) as well as in hooks.json would load twice (userhooks Q1b). */
function inlinePolicyHooks(config: Record<string, unknown>): boolean {
  const hooks = isRecord(config.hooks) ? config.hooks : {};
  return Object.entries(hooks).some(([event, groups]) => event !== "state" && Array.isArray(groups) && groups.some((group: unknown) =>
    isRecord(group) && Array.isArray(group.hooks) && group.hooks.some((h: unknown) => isRecord(h) && typeof h.command === "string" && parseCodexPolicyHookCommand(h.command) !== null)));
}

function stateEntry(config: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const state = isRecord(config.hooks) && isRecord(config.hooks.state) ? config.hooks.state : {};
  return isRecord(state[key]) ? state[key] as Record<string, unknown> : undefined;
}

function appendBlocks(text: string, blocks: string[]): string {
  if (blocks.length === 0) return text;
  const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  const gap = body === "" || body.endsWith("\n\n") ? "" : "\n";
  return `${body}${gap}${blocks.join("\n")}`;
}

/** Replaces the trusted_hash line inside rt's own `[hooks.state."<key>"]` table, leaving the rest of that table as it is. */
function replaceHashLine(text: string, key: string, hash: string): string | null {
  const lines = text.split("\n");
  const header = `[hooks.state.${tomlString(key)}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i]!); i++) {
    if (/^\s*trusted_hash\s*=/.test(lines[i]!)) {
      lines[i] = `trusted_hash = ${tomlString(hash)}`;
      return lines.join("\n");
    }
  }
  return null;
}

/** The edited text, or null when the result would change anything beyond the reviewed trust entries. */
function editConfig(text: string | null, hooks: ReviewedHook[], replace: readonly string[]): string | null {
  const before = parseToml(text);
  if (before === null) return null;
  let next = text ?? "";
  const blocks: string[] = [];
  for (const hook of hooks) {
    if (replace.includes(hook.key)) {
      const replaced = replaceHashLine(next, hook.key, hook.hash);
      if (replaced === null) return null;
      next = replaced;
    } else {
      blocks.push(`[hooks.state.${tomlString(hook.key)}]\ntrusted_hash = ${tomlString(hook.hash)}\n`);
    }
  }
  next = appendBlocks(next, blocks);
  const after = parseToml(next);
  if (after === null) return null;
  const expected = structuredClone(before) as Record<string, any>;
  expected.hooks = isRecord(expected.hooks) ? expected.hooks : {};
  expected.hooks.state = isRecord(expected.hooks.state) ? expected.hooks.state : {};
  for (const hook of hooks) expected.hooks.state[hook.key] = { ...(expected.hooks.state[hook.key] ?? {}), trusted_hash: hook.hash };
  return Bun.deepEquals(canonical(after), canonical(expected)) ? next : null;
}

// ─── Plan ────────────────────────────────────────────────────────────────────

function reviewOf(plan: Omit<PolicyInstallPlan, "reviews">): PolicyReview {
  const body = {
    codexHome: plan.codexHome, hooksPath: plan.hooksPath, configPath: plan.configPath, executable: plan.artifact.path, digest: plan.artifact.digest,
    commands: plan.manifest.commands, hooks: plan.config.hooks,
  };
  return { id: `cp-${sha256(JSON.stringify(body)).slice(0, 32)}`, ...body };
}

type Artifact = { ok: true; source: string; bytes: Uint8Array; digest: string } | { ok: false; message: string };

function readArtifact(deps: PolicyInstallDeps): Artifact {
  const source = deps.rtSource();
  if (source === null) {
    return { ok: false, message: "This Mac has no installed mattstack app rt to run Codex's policy hooks, so rt cannot install them. Install the app, then run this again." };
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(source);
  } catch (err) {
    return { ok: false, message: `rt could not read ${source}: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (bytes[0] === 0x23 && bytes[1] === 0x21) {
    return { ok: false, message: `${source} is a script wrapper, not a compiled rt, so it cannot be a reviewed hook executable. Run this from the installed app's rt.` };
  }
  return { ok: true, source, bytes, digest: sha256(bytes) };
}

function presentDigest(path: string): string | undefined {
  try {
    return sha256(readFileSync(path));
  } catch {
    return undefined;
  }
}

function policyState(state: SetupState): CodexPolicyState {
  return state.codexPolicy ?? { installationId: "", artifacts: {}, hooks: {}, trust: {}, reviewed: {} };
}

function stateProbes(home: string, now: () => Date) {
  return {
    home,
    now,
    readFile: (path: string) => readText(path),
    exists: existsSync,
    writeFile: (path: string, content: string) => writeFileSync(path, content),
    mkdirp: (path: string) => mkdirSync(path, { recursive: true }),
    rename: renameSync,
  };
}

/**
 * Works out what installing rt's policy for `profile` would change. It
 * writes nothing. A `definitions` plan needs no review (it writes hooks
 * Codex will not run until trusted); a `hooks` plan carries exactly one
 * review; an `installed` plan needs nothing. `cwd` is only the folder
 * hooks/list is asked about, the profile's Codex home by default.
 */
export async function planCodexPolicyInstall(input: { cwd?: string; profile: string }, overrides: Partial<PolicyInstallDeps> = {}): Promise<Outcome<PolicyInstallPlan>> {
  const deps = withDefaults(overrides);
  const { profile } = input;
  const configPath = codexConfigPath(profile, deps.env);
  if (configPath === undefined) return fail("refused", `rt cannot find the settings for the Codex profile ${profile}.`);
  const codexHome = dirname(configPath);
  const hooksPath = codexUserHooksPath(configPath);
  const cwd = input.cwd ?? codexHome;

  let configText: string | null;
  let hooksText: string | null;
  try {
    configText = readText(configPath);
    hooksText = readText(hooksPath);
  } catch (err) {
    return fail("not-ready", `rt could not read Codex's settings: ${err instanceof Error ? err.message : String(err)}`);
  }
  const config = parseToml(configText);
  if (config === null) return fail("refused", `${configPath} is not valid TOML. Fix that file, then run this again.`);
  if (isRecord(config.features) && config.features.hooks === false) {
    return fail("refused", `${configPath} turns Codex hooks off, so rt's policy could never run. Turn hooks back on there, then run this again.`);
  }
  if (inlinePolicyHooks(config)) {
    return fail("refused", `${configPath} lists rt's policy hooks inline, and rt keeps them only in ${hooksPath}; both would run. Remove the inline copy, then run this again.`);
  }

  const artifact = readArtifact(deps);
  if (!artifact.ok) return fail("not-ready", artifact.message);
  const artifactPath = codexPolicyArtifactPath(deps.home, artifact.digest);
  const present = presentDigest(artifactPath) === artifact.digest;

  const owned = policyState(readSetupState(stateProbes(deps.home, deps.now)));
  const installationId = validInstallationId(owned.installationId) ? owned.installationId : deps.randomId();
  const manifest = codexPolicyManifest({ executable: artifactPath, installationId });
  const desired = Object.fromEntries(CODEX_POLICY_EVENTS.map((e) => [e, manifest.hooks[e][0]!.hooks[0]!])) as Record<CodexPolicyEvent, CodexHookHandler>;
  const commands = CODEX_POLICY_EVENTS.map((event) => ({ event, command: desired[event].command }));

  const merge = mergeHooks(hooksPath, hooksText, desired, owned.hooks[hooksPath] ?? []);
  if (!merge.ok) return fail("refused", merge.message);

  const base = {
    cwd, profile, codexHome, configPath, hooksPath, installationId,
    artifact: { source: artifact.source, path: artifactPath, digest: artifact.digest, present },
    manifest: { revision: manifest.revision, commands },
    hooksFile: { before: fingerprint(hooksText), text: merge.text, adds: merge.adds },
  };
  if (merge.text !== null || !present) {
    return { ok: true, data: { ...base, stage: "definitions", config: { before: fingerprint(configText), hooks: [], replace: [] }, reviews: [] } };
  }

  let listed: Outcome<ListedPolicyHook[]>;
  try {
    listed = await deps.listHooks(cwd, profile);
  } catch (err) {
    listed = fail("not-ready", err instanceof Error ? err.message : String(err));
  }
  if (!listed.ok) return fail("not-ready", listed.error.message);
  const wantSource = realOr(hooksPath);
  const toWrite: ReviewedHook[] = [];
  const replace: string[] = [];
  const ownedTrust = owned.trust[configPath]?.hooks ?? {};
  for (const { event, command } of commands) {
    const anyRt = listed.data.filter((h) => h.eventName === LISTED[event] && h.command !== undefined && parseCodexPolicyHookCommand(h.command)?.event === event);
    const hook = anyRt.length === 1 && anyRt[0]!.command === command ? anyRt[0]! : undefined;
    if (anyRt.length > 1) {
      const elsewhere = anyRt.map((h) => h.sourcePath).filter((p) => p === undefined || realOr(p) !== wantSource);
      return fail("not-ready", `Codex loads more than one rt ${event} policy hook (also from ${elsewhere.join(", ") || "another layer"}), so it would run twice. Remove the other copy, then run this again.`);
    }
    if (hook === undefined || hook.source !== CODEX_POLICY_SOURCE || hook.sourcePath === undefined || realOr(hook.sourcePath) !== wantSource) {
      return fail(
        "not-ready",
        `Codex does not load rt's ${event} policy hook from ${hooksPath}, so rt cannot install its policy. If Codex has hooks turned off, turn them back on, then run this again.`,
      );
    }
    if (hook.enabled === false) return fail("not-ready", `Codex lists rt's ${event} policy hook in ${hooksPath} as turned off. Turn it back on in Codex, then run this again.`);
    if (typeof hook.key !== "string" || typeof hook.currentHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(hook.currentHash)) {
      return fail("not-ready", `Codex did not report a key and hash for rt's ${event} policy hook, so there is nothing exact to trust.`);
    }
    const existing = stateEntry(config, hook.key);
    if (existing !== undefined && existing.trusted_hash === hook.currentHash && existing.enabled !== false) continue;
    if (existing !== undefined && existing.enabled === false) {
      return fail("refused", `Codex has rt's ${event} policy hook turned off in ${configPath}, and rt never turns it back on for you.`);
    }
    if (existing !== undefined && (typeof existing.trusted_hash !== "string" || ownedTrust[hook.key] !== existing.trusted_hash)) {
      return fail("refused", `Codex holds your own trust for another version of rt's ${event} policy hook (${hook.key}), so rt left it alone. Remove that entry in ${configPath}, then run this again.`);
    }
    if (existing !== undefined) replace.push(hook.key);
    toWrite.push({ event, key: hook.key, command, hash: hook.currentHash });
  }
  const configPlan = { before: fingerprint(configText), hooks: toWrite, replace };
  if (toWrite.length === 0) return { ok: true, data: { ...base, stage: "installed", config: configPlan, reviews: [] } };
  const plan = { ...base, stage: "hooks" as const, config: configPlan };
  return { ok: true, data: { ...plan, reviews: [reviewOf(plan)] } };
}

// ─── Apply ───────────────────────────────────────────────────────────────────

/** What macOS's owner sheet says is being approved; it reads after "<helper> is trying to". */
export function ownerAuthReason(review: PolicyReview): string {
  const count = review.hooks.length === 1 ? "1 rt hook" : `${review.hooks.length} rt hooks`;
  return `trust ${count} in Codex (${review.codexHome})`;
}

const changed = (path: string): Outcome<void> =>
  fail("refused", `${path} changed after rt planned this, so rt wrote nothing more. Run it again.`);

/** Atomic and mode-preserving, through a symlink to the file it names, and only while the file still matches `before`. */
function replaceFile(path: string, before: string, text: string): Outcome<void> {
  if (fingerprint(readText(path)) !== before) return changed(path);
  const target = existsSync(path) ? realOr(path) : path;
  mkdirSync(dirname(target), { recursive: true });
  let mode = 0o600;
  try {
    mode = statSync(target).mode & 0o777;
  } catch { /* a new file */ }
  const tmp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { mode, flag: "wx" });
  chmodSync(tmp, mode);
  if (fingerprint(readText(path)) !== before) {
    rmSync(tmp, { force: true });
    return changed(path);
  }
  renameSync(tmp, target);
  return { ok: true, data: undefined };
}

function installArtifact(plan: PolicyInstallPlan, bytes: Uint8Array): Outcome<void> {
  const dir = dirname(plan.artifact.path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const held = lstatSync(dir);
  if (!held.isDirectory() || held.isSymbolicLink() || (process.getuid !== undefined && held.uid !== process.getuid())) {
    return fail("refused", `${dir} is not a folder this account owns, so rt did not put its hook program there.`);
  }
  const tmp = `${plan.artifact.path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, bytes, { mode: 0o755, flag: "wx" });
  chmodSync(tmp, 0o755);
  if (presentDigest(tmp) !== plan.artifact.digest) {
    rmSync(tmp, { force: true });
    return fail("refused", `The copy of rt at ${plan.artifact.path} did not match the planned bytes, so rt did not install it.`);
  }
  renameSync(tmp, plan.artifact.path);
  return { ok: true, data: undefined };
}

/**
 * Writes what `plan` describes. A `definitions` plan writes the hook
 * program and rt's untrusted hook entries; a `hooks` plan writes trust, and
 * only with its review approved: every id in `reviewed` must be this
 * plan's, and the plan's review must be among them. `reviewed` comes from a
 * person approving that review in setup; a plan whose files changed since
 * it was made is refused, not merged.
 */
export async function applyCodexPolicyInstall(plan: PolicyInstallPlan, reviewed: readonly string[], overrides: Partial<PolicyInstallDeps> = {}): Promise<Outcome<void>> {
  const deps = withDefaults(overrides);
  const known = new Set(plan.reviews.map((r) => r.id));
  const stale = reviewed.find((id) => !known.has(id));
  if (stale !== undefined) return fail("refused", `The review ${stale} is not the one rt planned now. Review the current hooks again.`);
  const missing = plan.reviews.find((r) => !reviewed.includes(r.id));
  if (missing !== undefined) return fail("refused", `Nothing was approved for ${missing.hooksPath}, so rt trusted nothing.`);
  if (plan.stage === "installed") return { ok: true, data: undefined };
  if (plan.stage === "hooks" && plan.reviews.length !== 1) return fail("invalid", "A hooks plan carries exactly one review.");

  if (fingerprint(readText(plan.configPath)) !== plan.config.before) return changed(plan.configPath);
  if (fingerprint(readText(plan.hooksPath)) !== plan.hooksFile.before) return changed(plan.hooksPath);
  const artifact = readArtifact(deps);
  if (!artifact.ok || artifact.digest !== plan.artifact.digest) {
    return fail("refused", "rt itself changed after this was planned, so the planned hook program no longer exists. Run it again.");
  }
  if (plan.stage === "hooks" && presentDigest(plan.artifact.path) !== plan.artifact.digest) {
    return fail("refused", `The hook program at ${plan.artifact.path} changed after you reviewed it, so rt trusted nothing. Run it again.`);
  }

  const probes = stateProbes(deps.home, deps.now);
  const record = (patch: (cp: CodexPolicyState) => Partial<CodexPolicyState>) =>
    updateSetupState(probes, (s) => {
      const cp = policyState(s);
      return { ...s, codexPolicy: { ...cp, installationId: plan.installationId, ...patch(cp) } };
    });

  if (plan.stage === "definitions") {
    if (presentDigest(plan.artifact.path) !== plan.artifact.digest) {
      const installed = installArtifact(plan, artifact.bytes);
      if (!installed.ok) return installed;
    }
    record((cp) => ({ artifacts: { ...cp.artifacts, [plan.artifact.path]: plan.artifact.digest } }));
    if (plan.hooksFile.text !== null) {
      const wrote = replaceFile(plan.hooksPath, plan.hooksFile.before, plan.hooksFile.text);
      if (!wrote.ok) return wrote;
      record((cp) => {
        const rewritten = new Set(plan.hooksFile.adds.map((c) => parseCodexPolicyHookCommand(c)?.event));
        const stillOurs = (cp.hooks[plan.hooksPath] ?? []).filter((c) => !rewritten.has(parseCodexPolicyHookCommand(c)?.event));
        return { hooks: { ...cp.hooks, [plan.hooksPath]: [...stillOurs, ...plan.hooksFile.adds] } };
      });
    }
    return { ok: true, data: undefined };
  }

  const review = plan.reviews[0]!;
  const owner = await deps.confirmOwner(ownerAuthReason(review));
  if (!owner.ok) return fail("refused", owner.message);
  const text = editConfig(readText(plan.configPath), plan.config.hooks, plan.config.replace);
  if (text === null) return fail("refused", `rt could not trust its hooks in ${plan.configPath} without changing your other Codex settings.`);
  const wrote = replaceFile(plan.configPath, plan.config.before, text);
  if (!wrote.ok) return wrote;
  record((cp) => {
    const trust = cp.trust[plan.configPath] ?? { hooks: {} };
    return {
      trust: { ...cp.trust, [plan.configPath]: { ...trust, hooks: { ...trust.hooks, ...Object.fromEntries(plan.config.hooks.map((h) => [h.key, h.hash])) } } },
      reviewed: { ...cp.reviewed, [plan.hooksPath]: { hooks: review.id, at: deps.now().toISOString() } },
    };
  });
  return { ok: true, data: undefined };
}

/**
 * Codex sessions already attached on this profile. A thread keeps the hooks
 * it loaded when it started, so none of them gains a newly trusted policy;
 * each stays out of managed work until its own check proves it (M6c), and
 * rt never ends or replaces one to get there.
 */
export async function codexPolicyRecovery(profile: string, overrides: Partial<PolicyInstallDeps> = {}): Promise<SessionBinding[]> {
  return [...(await withDefaults(overrides).attachedSessions(profile))];
}

// ─── Removal ─────────────────────────────────────────────────────────────────

/** rt's policy hook commands a hooks file holds now, by event; null when it is not a JSON object. */
export function policyHookCommandsIn(text: string | null): Record<CodexPolicyEvent, string[]> | null {
  const found: Record<CodexPolicyEvent, string[]> = { PreToolUse: [], Stop: [] };
  if (text === null) return found;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const hooks = isRecord(parsed.hooks) ? parsed.hooks : {};
  for (const event of CODEX_POLICY_EVENTS) {
    for (const group of Array.isArray(hooks[event]) ? hooks[event] : []) {
      for (const h of isRecord(group) && Array.isArray(group.hooks) ? group.hooks : []) {
        if (isRecord(h) && typeof h.command === "string" && parseCodexPolicyHookCommand(h.command)?.event === event) found[event].push(h.command);
      }
    }
  }
  return found;
}

/** The handler rt wrote for one of its own commands, or null for a command it never writes. */
function handlerFor(command: string): CodexHookHandler | null {
  const parsed = parseCodexPolicyHookCommand(command);
  if (parsed === null) return null;
  try {
    return codexPolicyManifest({ executable: parsed.executable, installationId: parsed.installationId }).hooks[parsed.event][0]!.hooks[0]!;
  } catch {
    return null;
  }
}

/**
 * Whether every event still holds a hook rt recorded adding, exactly as rt
 * wrote it: `removed` when the member took one out, `changed` when they
 * edited one.
 */
export function ownedPolicyHooksIn(text: string | null, owned: readonly string[]): "intact" | "removed" | "changed" | "unreadable" {
  const present = policyHookCommandsIn(text);
  if (present === null) return "unreadable";
  const parsed: unknown = text === null ? {} : JSON.parse(text);
  const hooks = isRecord(parsed) && isRecord(parsed.hooks) ? parsed.hooks : {};
  let verdict: "intact" | "removed" | "changed" = "intact";
  for (const event of CODEX_POLICY_EVENTS) {
    const mine = owned.filter((c) => parseCodexPolicyHookCommand(c)?.event === event);
    const groups: unknown[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    if (mine.some((c) => { const h = handlerFor(c); return h !== null && groups.some((g) => exactGroup(g, h)); })) continue;
    if (mine.some((c) => present[event].includes(c))) return "changed";
    verdict = "removed";
  }
  return verdict;
}

/** Splices that drop the entries at `drop` from `list` with the separators joining them; null when every entry goes. */
function dropEntries(list: { start: number; end: number }[], drop: ReadonlySet<number>): Splice[] | null {
  if (drop.size === list.length) return null;
  const splices: Splice[] = [];
  for (let a = 0; a < list.length; a++) {
    if (!drop.has(a)) continue;
    let b = a;
    while (drop.has(b + 1)) b++;
    splices.push(b < list.length - 1 ? { start: list[a]!.start, end: list[b + 1]!.start, text: "" } : { start: list[a - 1]!.end, end: list[b]!.end, text: "" });
    a = b;
  }
  return splices;
}

type FileRemoval = { text: string | null; removed: string[]; kept: string[] };

/**
 * Drops only the groups that are exactly what rt wrote for a command it
 * recorded as its own. A group the member edited, and every other byte of
 * the file, stays. Null when the result would differ by anything more.
 */
function removeOwnedHooks(text: string, owned: readonly string[]): FileRemoval | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const hooks = isRecord(parsed.hooks) ? parsed.hooks : {};
  const removed: string[] = [];
  const kept: string[] = [];
  const dropped = new Map<CodexPolicyEvent, Set<number>>();
  for (const command of owned) {
    const event = parseCodexPolicyHookCommand(command)?.event;
    const handler = handlerFor(command);
    if (event === undefined || handler === null) continue;
    const groups: unknown[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    const exact = groups.findIndex((group, g) => exactGroup(group, handler) && !dropped.get(event)?.has(g));
    if (exact >= 0) {
      dropped.set(event, (dropped.get(event) ?? new Set()).add(exact));
      removed.push(command);
    } else if (policyHookCommandsIn(text)?.[event].includes(command)) {
      kept.push(command);
    }
  }
  if (removed.length === 0) return { text: null, removed, kept };

  const expected = structuredClone(parsed) as Record<string, any>;
  for (const [event, drop] of dropped) {
    const left = (expected.hooks[event] as unknown[]).filter((_, g) => !drop.has(g));
    if (left.length > 0) expected.hooks[event] = left;
    else delete expected.hooks[event];
  }

  const root = spansOf(text);
  const hooksSpan = root?.members?.filter((m) => m.key === "hooks").pop()?.value;
  if (hooksSpan?.members === undefined) return null;
  const members = hooksSpan.members;
  const emptied = new Set<number>();
  const splices: Splice[] = [];
  for (const [event, drop] of dropped) {
    const at = members.map((m) => m.key).lastIndexOf(event);
    const items = members[at]?.value.items;
    if (items === undefined) return null;
    const cut = dropEntries(items, drop);
    if (cut === null) emptied.add(at);
    else splices.push(...cut);
  }
  if (emptied.size > 0) {
    const cut = dropEntries(members.map((m) => ({ start: m.keyStart, end: m.value.end })), emptied);
    splices.push(...(cut ?? [{ start: hooksSpan.start, end: hooksSpan.end, text: "{}" }]));
  }
  let next = text;
  for (const s of splices.sort((a, b) => b.start - a.start)) next = next.slice(0, s.start) + s.text + next.slice(s.end);
  try {
    if (!Bun.deepEquals(canonical(JSON.parse(next)), canonical(expected))) return null;
  } catch {
    return null;
  }
  return { text: next, removed, kept };
}

/** Empty `hooks.state` and `hooks` tables read the same as absent ones, so a removal that leaves them is no other change. */
function withoutEmptyHooks(config: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(config) as Record<string, any>;
  if (isRecord(out.hooks) && isRecord(out.hooks.state) && Object.keys(out.hooks.state).length === 0) delete out.hooks.state;
  if (isRecord(out.hooks) && Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

/** Drops the `[hooks.state."<key>"]` tables rt wrote whose trust is still exactly the hash it recorded. */
function removeOwnedTrust(text: string, owned: Record<string, string>): FileRemoval | null {
  const config = parseToml(text);
  if (config === null) return null;
  const removed: string[] = [];
  const kept: string[] = [];
  let next = text;
  for (const [key, hash] of Object.entries(owned)) {
    const entry = stateEntry(config, key);
    if (entry === undefined) continue;
    if (!Bun.deepEquals(canonical(entry), { trusted_hash: hash })) {
      kept.push(key);
      continue;
    }
    const lines = next.split("\n");
    const start = lines.findIndex((line) => line.trim() === `[hooks.state.${tomlString(key)}]`);
    if (start < 0) {
      kept.push(key);
      continue;
    }
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
    while (end > start + 1 && /^\s*(#.*)?$/.test(lines[end - 1]!)) end--;
    while (end < lines.length && lines[end]!.trim() === "" && (start === 0 || lines[start - 1]!.trim() === "")) end++;
    next = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
    removed.push(key);
  }
  if (removed.length === 0) return { text: null, removed, kept };
  const after = parseToml(next);
  if (after === null) return null;
  const expected = structuredClone(config) as Record<string, any>;
  for (const key of removed) delete expected.hooks.state[key];
  return Bun.deepEquals(canonical(withoutEmptyHooks(after)), canonical(withoutEmptyHooks(expected))) ? { text: next, removed, kept } : null;
}

type ArtifactFate = "removed" | "gone" | "changed";

/** Only a copy at the path its own recorded digest names, still holding those bytes, is rt's to delete. */
function dropArtifact(home: string, path: string, digest: string): ArtifactFate {
  if (path !== codexPolicyArtifactPath(home, digest)) return "changed";
  const present = presentDigest(path);
  if (present === undefined) return existsSync(path) ? "changed" : "gone";
  if (present !== digest) return "changed";
  rmSync(path, { force: true });
  try {
    rmdirSync(dirname(path));
  } catch { /* another file is in the folder */ }
  return "removed";
}


/** The Codex homes rt put hooks into, now or before a removal, whose running Codex may hold its hook programs. */
function hookHomes(cp: CodexPolicyState): string[] {
  return [...new Set([...Object.keys(cp.hooks), ...Object.keys(cp.trust)].map((p) => dirname(p)).concat(cp.retainedFor ?? []))];
}

type ProgramUse = { inUse: false } | { inUse: true; homes: string[] } | { inUse: "unknown" };

/**
 * Whether a running Codex may still run rt's hook programs: a `codex`
 * process on a home rt put hooks into, managed by rt or not. A recorded
 * session with no such process has ended. An unreadable process table
 * counts as in use.
 */
async function programUse(deps: PolicyInstallDeps, homes: string[]): Promise<ProgramUse> {
  if (homes.length === 0) return { inUse: false };
  const running = await deps.runningCodexHomes();
  if (running === null) return { inUse: "unknown" };
  const using = homes.filter((h) => homeInUse(running, h));
  return using.length > 0 ? { inUse: true, homes: using } : { inUse: false };
}

/**
 * Old hook programs no recorded hook names any more. None goes while a
 * Codex session is attached or a `codex` process runs on a home rt put
 * hooks into: a session keeps the hooks it loaded when it started, and rt
 * cannot tell which program those name.
 */
export async function collectCodexPolicyArtifacts(overrides: Partial<PolicyInstallDeps> = {}): Promise<string[]> {
  const deps = withDefaults(overrides);
  const probes = stateProbes(deps.home, deps.now);
  const owned = policyState(readSetupState(probes));
  const named = new Set(Object.values(owned.hooks).flat().map((c) => parseCodexPolicyHookCommand(c)?.executable));
  const unnamed = Object.entries(owned.artifacts).filter(([path]) => !named.has(path));
  const done: string[] = [];
  const busy = unnamed.length > 0 && ((await deps.codexBindings()).length > 0 || (await programUse(deps, hookHomes(owned))).inUse !== false);
  if (!busy) {
    for (const [path, digest] of unnamed) {
      if (dropArtifact(deps.home, path, digest) !== "changed") done.push(path);
    }
  }
  // The retained homes only serve programs no recorded hook names; once none is left they go.
  const stillUnnamed = unnamed.some(([path]) => !done.includes(path));
  if (done.length > 0 || (!stillUnnamed && owned.retainedFor !== undefined)) {
    updateSetupState(probes, (s) => {
      const { retainedFor, ...cp } = policyState(s);
      if (s.codexPolicy === undefined) return s;
      const artifacts = Object.fromEntries(Object.entries(cp.artifacts).filter(([p]) => !done.includes(p)));
      return { ...s, codexPolicy: { ...cp, artifacts, ...(stillUnnamed && retainedFor ? { retainedFor } : {}) } };
    });
  }
  return done;
}

export type PolicyRemoval = { removed: string[]; kept: string[] };

/** Whether `path` is the hook program its recorded digest names and still holds those bytes. */
export function isRecordedCodexProgram(home: string, path: string, digest: string): boolean {
  return path === codexPolicyArtifactPath(home, digest) && presentDigest(path) === digest;
}

/**
 * Takes back what rt recorded writing for Codex's policy: its hook groups
 * in each user hooks file, its trust entries in each config, and its hook
 * programs. Each is removed only while it is still exactly what rt wrote;
 * anything the member changed stays, and so does every other entry. The
 * hook programs stay while Codex runs on a home rt put hooks into, since a
 * session runs the hooks it loaded when it started. The record is saved
 * after each file, so an interrupted run never forgets what it still owns.
 */
export async function removeCodexPolicyInstall(overrides: Partial<PolicyInstallDeps> = {}): Promise<PolicyRemoval> {
  const deps = withDefaults(overrides);
  const probes = stateProbes(deps.home, deps.now);
  const owned = policyState(readSetupState(probes));
  const removed: string[] = [];
  const kept: string[] = [];
  const save = (patch: (cp: CodexPolicyState) => CodexPolicyState) =>
    updateSetupState(probes, (s) => {
      const cp = patch(policyState(s));
      const next = { ...s };
      if (Object.keys(cp.hooks).length === 0 && Object.keys(cp.trust).length === 0 && Object.keys(cp.artifacts).length === 0) {
        delete next.codexPolicy;
        return next;
      }
      const { retainedFor, ...rest } = cp;
      const reviewed = Object.fromEntries(Object.entries(cp.reviewed).filter(([p]) => p in cp.hooks));
      next.codexPolicy = { ...rest, reviewed, ...(Object.keys(cp.artifacts).length > 0 && retainedFor?.length ? { retainedFor } : {}) };
      return next;
    });
  const homes = hookHomes(owned);
  if (Object.keys(owned.artifacts).length > 0) save((cp) => ({ ...cp, retainedFor: homes }));

  for (const [path, commands] of Object.entries(owned.hooks)) {
    const text = readText(path);
    const present = policyHookCommandsIn(text);
    const edit = text === null ? { text: null, removed: [], kept: [] } : removeOwnedHooks(text, commands);
    let left: string[] = [];
    if (edit === null || present === null) {
      kept.push(`rt's policy hooks in ${path}, which rt could not take out without changing the rest of that file`);
      left = commands;
    } else if (!(edit.text === null ? { ok: true as const } : replaceFile(path, fingerprint(text), edit.text)).ok) {
      kept.push(`rt's policy hooks in ${path}, which changed while rt was removing them`);
      left = commands;
    } else {
      if (edit.removed.length > 0) removed.push(`rt's policy hooks from ${path}`);
      if (edit.kept.length > 0) kept.push(`rt's policy hooks in ${path}, which were changed after rt added them`);
      left = edit.kept;
    }
    save((cp) => {
      const hooks = { ...cp.hooks };
      if (left.length > 0) hooks[path] = left;
      else delete hooks[path];
      return { ...cp, hooks };
    });
  }

  for (const [path, { hooks }] of Object.entries(owned.trust)) {
    const text = readText(path);
    const edit = text === null ? { text: null, removed: [], kept: [] } : removeOwnedTrust(text, hooks);
    let left: Record<string, string> = {};
    if (edit === null) {
      kept.push(`rt's hook trust in ${path}, which rt could not take out without changing your other Codex settings`);
      left = hooks;
    } else if (!(edit.text === null ? { ok: true as const } : replaceFile(path, fingerprint(text), edit.text)).ok) {
      kept.push(`rt's hook trust in ${path}, which changed while rt was removing it`);
      left = hooks;
    } else {
      if (edit.removed.length > 0) removed.push(`rt's hook trust from ${path}`);
      if (edit.kept.length > 0) kept.push(`rt's hook trust in ${path}, which was changed after rt wrote it`);
      left = Object.fromEntries(edit.kept.map((k) => [k, hooks[k]!]));
    }
    save((cp) => {
      const trust = { ...cp.trust };
      if (Object.keys(left).length > 0) trust[path] = { hooks: left };
      else delete trust[path];
      return { ...cp, trust };
    });
  }

  const artifacts = Object.entries(owned.artifacts);
  const use = artifacts.length > 0 ? await programUse(deps, homes) : ({ inUse: false } as const);
  const folders = artifacts.map(([path]) => dirname(path));
  const those = folders.length === 1 ? "that folder" : "those folders";
  if (use.inUse === true) {
    kept.push(`rt's Codex hook program in ${folders.join(", ")}, because Codex is still running on ${use.homes.join(", ")}. Quit Codex there, then delete ${those}`);
  } else if (use.inUse === "unknown") {
    kept.push(`rt's Codex hook program in ${folders.join(", ")}, because rt could not tell whether Codex is still running. Once Codex is closed, delete ${those}`);
  } else {
    for (const [path, digest] of artifacts) {
      const fate = dropArtifact(deps.home, path, digest);
      if (fate === "removed") removed.push(`the hook program ${path}`);
      if (fate === "changed") kept.push(`${path}, which no longer holds the hook program rt put there`);
      if (fate !== "changed") {
        save((cp) => {
          const { [path]: _gone, ...rest } = cp.artifacts;
          return { ...cp, artifacts: rest };
        });
      }
    }
  }
  return { removed, kept };
}
