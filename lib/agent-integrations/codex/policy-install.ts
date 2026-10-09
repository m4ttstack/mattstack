/**
 * Installs rt's Codex policy hooks (hook-manifest.ts) where Codex itself
 * loads project hooks for a working folder, and trusts exactly what a person
 * reviewed. Codex finds project hooks only inside a trusted project
 * boundary: a checkout's top folder, or for a linked worktree its main
 * checkout (live-16). The install is two reviews, because Codex can only
 * name a hook's native hash once the folder is trusted:
 *
 * - folder: rt's executable copy, the owned entries in the boundary's
 *   `.codex/hooks.json`, and folder trust for the boundary itself;
 * - hooks: Codex's own keys and hashes for those entries (hooks/list),
 *   trusted one by one in the profile's config.
 *
 * Nothing here creates a repository, trusts a parent folder, turns a trust
 * check off, replaces a hooks file wholesale, or restarts a shared service.
 * Every write compares the file with what the review was planned against
 * first, and only entries rt wrote are recorded as rt's own.
 */

import { createHash } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { bundledToolPath } from "../../deps/resolve.ts";
import { readSetupState, updateSetupState, type CodexPolicyState, type SetupState } from "../../setup/state.ts";
import {
  CODEX_POLICY_EVENTS, codexPolicyManifest, parseCodexPolicyHookCommand, validInstallationId, type CodexHookHandler, type CodexPolicyEvent,
} from "./hook-manifest.ts";
import { canonicalCodexProfile } from "./profile.ts";
import { isRecord } from "./protocol.ts";
import { codexConfigPath, gitTrustRoot } from "./trust.ts";

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
  now: () => Date;
  randomId: () => string;
};

export type PolicyStage = "folder" | "hooks";
export type ReviewedCommand = { event: CodexPolicyEvent; command: string };
export type ReviewedHook = { event: CodexPolicyEvent; key: string; command: string; hash: string };

/** Everything one approval covers, so its id changes whenever any of it does. */
export type PolicyReview = {
  id: string;
  stage: PolicyStage;
  boundary: string;
  hooksPath: string;
  configPath: string;
  executable: string;
  digest: string;
  commands: ReviewedCommand[];
  trustFolder: boolean;
  hooks: ReviewedHook[];
};

export type PolicyInstallPlan = {
  cwd: string;
  profile: string;
  boundary: string;
  configPath: string;
  hooksPath: string;
  installationId: string;
  /** `present`: the copy already holds exactly these bytes. */
  artifact: { source: string; path: string; digest: string; present: boolean };
  /** M6b's manifest revision for this executable and installation. */
  manifest: { revision: string; commands: ReviewedCommand[] };
  stage: PolicyStage | "installed";
  /** `before` is the file's fingerprint when planned; `text` is null when the file already holds rt's entries. */
  hooksFile: { before: string; text: string | null; adds: string[] };
  config: { before: string; addFolder: boolean; hooks: ReviewedHook[]; replace: string[] };
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
    now: () => new Date(),
    randomId: () => `mac-${sha256(`${Date.now()}-${Math.random()}`).slice(0, 12)}`,
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

/**
 * Adds or updates only rt's own handler per event. A handler rt finds
 * already in place is used as it is; one this Mac recorded as its own may
 * be replaced where it stands, so its native key stays the same; any other
 * rt policy hook means someone else installed one, and is refused.
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
  for (const event of CODEX_POLICY_EVENTS) {
    const handler = desired[event];
    if (hooks[event] !== undefined && !Array.isArray(hooks[event])) return { ok: false, message: `${path} lists its ${event} hooks in a shape rt does not recognise.` };
    const groups = (hooks[event] as unknown[] | undefined) ?? [];
    const ours: { g: number; h: number; command: string }[] = [];
    groups.forEach((group, g) => {
      const handlers = isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [];
      handlers.forEach((entry: unknown, h: number) => {
        const command = isRecord(entry) && typeof entry.command === "string" ? entry.command : undefined;
        if (command !== undefined && parseCodexPolicyHookCommand(command)?.event === event) ours.push({ g, h, command });
      });
    });
    if (ours.length === 1 && exactGroup(groups[ours[0]!.g], handler)) continue;
    if (ours.length === 0) {
      hooks[event] = [...groups, { hooks: [handler] }];
      adds.push(handler.command);
      continue;
    }
    const [only] = ours;
    const group = groups[only!.g];
    if (ours.length === 1 && owned.includes(only!.command) && isRecord(group) && Bun.deepEquals(Object.keys(group), ["hooks"]) && (group.hooks as unknown[]).length === 1) {
      groups[only!.g] = { hooks: [handler] };
      hooks[event] = groups;
      adds.push(handler.command);
      continue;
    }
    return {
      ok: false,
      message: `${path} already runs ${ours.length === 1 ? "an rt policy hook" : "several rt policy hooks"} for ${event} that this Mac did not add, so rt left that file alone. Remove the other copy, then run this again.`,
    };
  }
  if (adds.length === 0) return { ok: true, text: null, adds };
  return { ok: true, text: `${JSON.stringify({ ...file, hooks }, null, 2)}\n`, adds };
}

// ─── Codex's config ──────────────────────────────────────────────────────────

/** A config that turns hooks off, or that lists hooks inline, can never load rt's hooks file as reviewed. */
function hooksBlocked(config: Record<string, unknown>, path: string, project: boolean): string | undefined {
  if (isRecord(config.features) && config.features.hooks === false) {
    return `${path} turns Codex hooks off, so rt's policy could never run. Turn hooks back on there, then run this again.`;
  }
  if (project && isRecord(config.hooks) && Object.keys(config.hooks).some((k) => k !== "state")) {
    return `${path} lists hooks inside the config, and rt only adds its hooks to .codex/hooks.json; installing both would run them twice. Move those hooks to .codex/hooks.json, then run this again.`;
  }
  return undefined;
}

function trustLevels(config: Record<string, unknown>, folder: string): unknown[] {
  const projects = isRecord(config.projects) ? config.projects : {};
  return [...new Set([folder, realOr(folder)])]
    .filter((spelling) => Object.hasOwn(projects, spelling))
    .map((spelling) => (isRecord(projects[spelling]) ? (projects[spelling] as Record<string, unknown>).trust_level : undefined));
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

type ConfigEdit = { addFolder?: string; hooks: ReviewedHook[]; replace: readonly string[] };

/** The edited text, or null when the result would change anything beyond the reviewed entries. */
function editConfig(text: string | null, edit: ConfigEdit): string | null {
  const before = parseToml(text);
  if (before === null) return null;
  let next = text ?? "";
  const blocks: string[] = [];
  if (edit.addFolder !== undefined) blocks.push(`[projects.${tomlString(edit.addFolder)}]\ntrust_level = "trusted"\n`);
  for (const hook of edit.hooks) {
    if (edit.replace.includes(hook.key)) {
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
  if (edit.addFolder !== undefined) {
    expected.projects = isRecord(expected.projects) ? expected.projects : {};
    expected.projects[edit.addFolder] = { trust_level: "trusted" };
  }
  if (edit.hooks.length > 0) {
    expected.hooks = isRecord(expected.hooks) ? expected.hooks : {};
    expected.hooks.state = isRecord(expected.hooks.state) ? expected.hooks.state : {};
    for (const hook of edit.hooks) expected.hooks.state[hook.key] = { ...(expected.hooks.state[hook.key] ?? {}), trusted_hash: hook.hash };
  }
  return Bun.deepEquals(canonical(after), canonical(expected)) ? next : null;
}

// ─── Plan ────────────────────────────────────────────────────────────────────

function reviewOf(plan: Omit<PolicyInstallPlan, "reviews">, stage: PolicyStage): PolicyReview {
  const body = {
    stage, boundary: plan.boundary, hooksPath: plan.hooksPath, configPath: plan.configPath, executable: plan.artifact.path, digest: plan.artifact.digest,
    commands: plan.manifest.commands, trustFolder: stage === "folder" && plan.config.addFolder, hooks: stage === "hooks" ? plan.config.hooks : [],
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
 * Works out what installing rt's policy for `cwd` would change, and which
 * review that needs. It writes nothing. A plan at stage `installed` needs no
 * review; any other carries exactly one.
 */
export async function planCodexPolicyInstall(input: { cwd: string; profile: string }, overrides: Partial<PolicyInstallDeps> = {}): Promise<Outcome<PolicyInstallPlan>> {
  const deps = withDefaults(overrides);
  const { cwd, profile } = input;
  const boundary = gitTrustRoot(cwd);
  if (boundary === undefined) {
    return fail("refused", `${cwd} is not inside a git checkout rt can follow. rt installs Codex's policy at a checkout's top folder and never creates a repository for it.`);
  }
  const configPath = codexConfigPath(profile, deps.env);
  if (configPath === undefined) return fail("refused", `rt cannot find the settings for the Codex profile ${profile}.`);

  let configText: string | null;
  let hooksText: string | null;
  let projectText: string | null;
  const hooksPath = join(boundary, ".codex", "hooks.json");
  const projectPath = join(boundary, ".codex", "config.toml");
  try {
    configText = readText(configPath);
    hooksText = readText(hooksPath);
    projectText = readText(projectPath);
  } catch (err) {
    return fail("not-ready", `rt could not read Codex's settings: ${err instanceof Error ? err.message : String(err)}`);
  }
  const config = parseToml(configText);
  if (config === null) return fail("refused", `${configPath} is not valid TOML. Fix that file, then run this again.`);
  const project = parseToml(projectText);
  if (project === null) return fail("refused", `${projectPath} is not valid TOML. Fix that file, then run this again.`);
  const blocked = hooksBlocked(config, configPath, false) ?? hooksBlocked(project, projectPath, true);
  if (blocked !== undefined) return fail("refused", blocked);

  const levels = trustLevels(config, boundary);
  if (levels.some((level) => level !== "trusted")) {
    return fail("refused", `Codex is set not to trust ${boundary}, and rt never overrides that. Trust that folder in Codex yourself if you want rt's policy there.`);
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
  const addFolder = levels.length === 0;

  const base = {
    cwd, profile, boundary, configPath, hooksPath, installationId,
    artifact: { source: artifact.source, path: artifactPath, digest: artifact.digest, present },
    manifest: { revision: manifest.revision, commands },
    hooksFile: { before: fingerprint(hooksText), text: merge.text, adds: merge.adds },
  };

  if (merge.text !== null || addFolder || !present) {
    const plan = { ...base, stage: "folder" as const, config: { before: fingerprint(configText), addFolder, hooks: [], replace: [] } };
    return { ok: true, data: { ...plan, reviews: [reviewOf(plan, "folder")] } };
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
    const ours = listed.data.filter((h) => h.eventName === LISTED[event] && h.command === command);
    const hook = ours.length === 1 ? ours[0]! : undefined;
    if (hook === undefined || hook.source !== "project" || hook.sourcePath === undefined || realOr(hook.sourcePath) !== wantSource) {
      return fail(
        "not-ready",
        `Codex does not load rt's ${event} policy hook for ${cwd} from ${hooksPath}, so rt cannot treat that folder as ready. Check that Codex trusts ${boundary} and that nothing else in .codex overrides it.`,
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
  const configPlan = { before: fingerprint(configText), addFolder: false, hooks: toWrite, replace };
  if (toWrite.length === 0) return { ok: true, data: { ...base, stage: "installed", config: configPlan, reviews: [] } };
  const plan = { ...base, stage: "hooks" as const, config: configPlan };
  return { ok: true, data: { ...plan, reviews: [reviewOf(plan, "hooks")] } };
}

// ─── Apply ───────────────────────────────────────────────────────────────────

const changed = (path: string): Outcome<void> =>
  fail("refused", `${path} changed after you reviewed this, so rt wrote nothing more. Review it again.`);

/** Atomic and mode-preserving, through a symlink to the file it names, and only while the file still matches `before`. */
function replaceFile(path: string, before: string, text: string): Outcome<void> {
  if (fingerprint(readText(path)) !== before) return changed(path);
  const target = existsSync(path) ? realOr(path) : path;
  mkdirSync(join(target, ".."), { recursive: true });
  let mode = 0o644;
  try {
    mode = statSync(target).mode & 0o777;
  } catch { /* a new file */ }
  const tmp = `${target}.rt-${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode });
  chmodSync(tmp, mode);
  if (fingerprint(readText(path)) !== before) {
    rmSync(tmp, { force: true });
    return changed(path);
  }
  renameSync(tmp, target);
  return { ok: true, data: undefined };
}

function installArtifact(plan: PolicyInstallPlan, bytes: Uint8Array): Outcome<void> {
  const dir = join(plan.artifact.path, "..");
  mkdirSync(dir, { recursive: true });
  const tmp = `${plan.artifact.path}.rt-${process.pid}.tmp`;
  writeFileSync(tmp, bytes, { mode: 0o755 });
  chmodSync(tmp, 0o755);
  if (presentDigest(tmp) !== plan.artifact.digest) {
    rmSync(tmp, { force: true });
    return fail("refused", `The copy of rt at ${plan.artifact.path} did not match what you reviewed, so rt did not install it.`);
  }
  renameSync(tmp, plan.artifact.path);
  return { ok: true, data: undefined };
}

/**
 * Writes what `plan` describes, and only with its review approved: every id
 * in `reviewed` must be this plan's, and the plan's review must be among
 * them. `reviewed` comes from a person approving that review in setup; a
 * plan whose files changed since it was made is refused, not merged.
 */
export async function applyCodexPolicyInstall(plan: PolicyInstallPlan, reviewed: readonly string[], overrides: Partial<PolicyInstallDeps> = {}): Promise<Outcome<void>> {
  const deps = withDefaults(overrides);
  const known = new Set(plan.reviews.map((r) => r.id));
  const stale = reviewed.find((id) => !known.has(id));
  if (stale !== undefined) return fail("refused", `The review ${stale} is not the one rt planned now. Review the current changes again.`);
  const missing = plan.reviews.find((r) => !reviewed.includes(r.id));
  if (missing !== undefined) return fail("refused", `Nothing was approved for ${missing.boundary}, so rt changed nothing there.`);
  if (plan.stage === "installed") return { ok: true, data: undefined };

  const review = plan.reviews[0]!;
  if (review.digest !== plan.artifact.digest || review.boundary !== plan.boundary) return fail("invalid", "The review does not describe this plan.");
  if (fingerprint(readText(plan.configPath)) !== plan.config.before) return changed(plan.configPath);
  if (fingerprint(readText(plan.hooksPath)) !== plan.hooksFile.before) return changed(plan.hooksPath);
  const artifact = readArtifact(deps);
  if (!artifact.ok || artifact.digest !== plan.artifact.digest) {
    return fail("refused", "rt itself changed after you reviewed this, so the reviewed hook executable no longer exists. Review it again.");
  }

  const at = deps.now().toISOString();
  const probes = stateProbes(deps.home, deps.now);
  if (plan.stage === "folder") {
    if (presentDigest(plan.artifact.path) !== plan.artifact.digest) {
      const installed = installArtifact(plan, artifact.bytes);
      if (!installed.ok) return installed;
    }
    if (plan.hooksFile.text !== null) {
      const wrote = replaceFile(plan.hooksPath, plan.hooksFile.before, plan.hooksFile.text);
      if (!wrote.ok) return wrote;
    }
    if (plan.config.addFolder) {
      const before = readText(plan.configPath);
      const text = editConfig(before, { addFolder: plan.boundary, hooks: [], replace: [] });
      if (text === null) return fail("refused", `rt could not add folder trust to ${plan.configPath} without changing your other Codex settings.`);
      const wrote = replaceFile(plan.configPath, plan.config.before, text);
      if (!wrote.ok) return wrote;
    }
    updateSetupState(probes, (s) => {
      const cp = policyState(s);
      const rewritten = new Set(plan.hooksFile.adds.map((c) => parseCodexPolicyHookCommand(c)?.event));
      const stillOurs = (cp.hooks[plan.hooksPath] ?? []).filter((c) => !rewritten.has(parseCodexPolicyHookCommand(c)?.event));
      const trust = cp.trust[plan.configPath] ?? { folders: [], hooks: {} };
      return {
        ...s,
        codexPolicy: {
          ...cp,
          installationId: plan.installationId,
          artifacts: { ...cp.artifacts, [plan.artifact.path]: plan.artifact.digest },
          hooks: { ...cp.hooks, ...(plan.hooksFile.adds.length > 0 && { [plan.hooksPath]: [...stillOurs, ...plan.hooksFile.adds] }) },
          trust: { ...cp.trust, ...(plan.config.addFolder && { [plan.configPath]: { ...trust, folders: [...new Set([...trust.folders, plan.boundary])] } }) },
          reviewed: { ...cp.reviewed, [plan.boundary]: { ...cp.reviewed[plan.boundary], folder: review.id, at } },
        },
      };
    });
    return { ok: true, data: undefined };
  }

  const before = readText(plan.configPath);
  const text = editConfig(before, { hooks: plan.config.hooks, replace: plan.config.replace });
  if (text === null) return fail("refused", `rt could not trust its hooks in ${plan.configPath} without changing your other Codex settings.`);
  const wrote = replaceFile(plan.configPath, plan.config.before, text);
  if (!wrote.ok) return wrote;
  updateSetupState(probes, (s) => {
    const cp = policyState(s);
    const trust = cp.trust[plan.configPath] ?? { folders: [], hooks: {} };
    return {
      ...s,
      codexPolicy: {
        ...cp,
        installationId: plan.installationId,
        trust: { ...cp.trust, [plan.configPath]: { ...trust, hooks: { ...trust.hooks, ...Object.fromEntries(plan.config.hooks.map((h) => [h.key, h.hash])) } } },
        reviewed: { ...cp.reviewed, [plan.boundary]: { ...cp.reviewed[plan.boundary], hooks: review.id, at } },
      },
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
