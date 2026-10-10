#!/usr/bin/env bun
/**
 * Distributed-profile acceptance for the harness integrations.
 *
 *   bun scripts/acceptance/harnesses.ts --profile <claude-only|codex-only|mixed> --evidence <file>
 *   bun scripts/acceptance/harnesses.ts --verify --evidence <file> [--matrix <file>]
 *   bun scripts/acceptance/harnesses.ts --import <guest evidence file> --profile <p> --evidence <file>
 *
 * A profile run drives the environment RT_ACCEPTANCE_ENV names (see
 * environment.ts) and replaces that profile's results in the shared file.
 * With no acceptance-owned environment every scenario is recorded blocked,
 * never passed. Each scenario passes only on its own evidence: an automated
 * probe where rt can read the installed artifact, else the manifest the
 * capture steps leave in the environment's capture folder. Verify exits 0
 * only for a complete matrix that passed on one artifact with tested versions.
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import type { Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import {
  environmentExec, ENV_VAR, loadEnvironment, parseVersion, tripwireCount,
  type EnvironmentDescriptor, type Exec,
} from "./environment.ts";
import {
  DEFAULT_MATRIX_PATH, EVIDENCE_FILES_DIR, findSecret, readEvidence, recordProblems, verifyEvidenceFile, writeProfileRun,
  type Artifact, type EnvironmentRecord, type HookRecord, type NativeFate, type NativeFormRecord, type NativeVersions,
  type ProfileRun, type ScenarioOutcome, type ScenarioRecord,
} from "./evidence.ts";
import {
  NATIVE_FORM_FEATURES, PROFILE_HARNESSES, PROFILES, requiredSlots, slotKey,
  type AcceptanceHarness, type Profile, type ScenarioDef,
} from "./scenarios.ts";

export type DriverContext = {
  profile: Profile;
  scenario: ScenarioDef;
  harness?: AcceptanceHarness;
  env: EnvironmentDescriptor;
  exec: Exec;
  /** Writes a sanitized evidence file for this slot and returns its path relative to the evidence file. */
  writeEvidence(name: string, content: string): string;
  /** Copies a captured file into this slot's evidence, refusing one that carries a credential. */
  copyEvidence(source: string): Outcome<string>;
};

export type DriverResult = {
  outcome: ScenarioOutcome;
  reason?: string;
  evidence?: string[];
  native?: NativeFate;
  hook?: HookRecord | null;
  service?: { id: string; recordedAt: string };
};

export type Driver = (ctx: DriverContext) => Promise<DriverResult>;

export type RunOptions = {
  profile: Profile;
  evidence: string;
  /** The environment descriptor; RT_ACCEPTANCE_ENV when omitted. */
  environment?: string;
  /** Replaces the default driver for a scenario id. */
  drivers?: Record<string, Driver>;
  now?: () => Date;
  realHome?: string;
  execFor?: (env: EnvironmentDescriptor) => Exec;
};

const iso = (now: () => Date) => now().toISOString();

/** The harness binary named by argv[0], if it is one a profile may exclude. */
function harnessOf(argv0: string): AcceptanceHarness | null {
  const name = basename(argv0);
  return name === "claude" || name === "codex" ? name : null;
}

/** A probe never starts a harness the profile does not include, so a Codex-only run cannot be the thing that ran Claude. */
function guardedExec(exec: Exec, profile: Profile): Exec {
  return (argv, opts) => {
    const h = harnessOf(argv[0] ?? "");
    if (h && !PROFILE_HARNESSES[profile].includes(h)) {
      throw new Error(`the ${profile} run refused to start ${h}`);
    }
    return exec(argv, opts);
  };
}

/** Writes and copies stay inside this profile's evidence folder; nothing else is ever removed. */
function profileEvidenceDir(evidenceFile: string, profile: Profile): string {
  if (!PROFILES.includes(profile)) throw new Error(`unknown profile ${profile}`);
  return join(dirname(resolve(evidenceFile)), EVIDENCE_FILES_DIR, profile);
}

function relEvidence(profile: Profile, key: string, name: string): string {
  return `${EVIDENCE_FILES_DIR}/${profile}/${key}/${name}`;
}

function safeName(name: string): string {
  return basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
}

const TEXT = /\.(json|jsonl|txt|log|md|toml|yaml|yml|csv|html)$/i;

function slotContext(base: { profile: Profile; env: EnvironmentDescriptor; exec: Exec; evidenceFile: string }, scenario: ScenarioDef, harness?: AcceptanceHarness): DriverContext {
  const key = slotKey(scenario.id, harness);
  const dir = join(profileEvidenceDir(base.evidenceFile, base.profile), key);
  return {
    profile: base.profile, scenario, harness, env: base.env, exec: base.exec,
    writeEvidence(name, content) {
      const secret = findSecret(content);
      if (secret) throw new Error(`refused to write ${name}: it carries a credential (${secret})`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, safeName(name)), content);
      return relEvidence(base.profile, key, safeName(name));
    },
    copyEvidence(source) {
      let st;
      try {
        st = lstatSync(source);
      } catch {
        return { ok: false, error: { code: "invalid", message: `${basename(source)} was not captured` } };
      }
      if (!st.isFile()) return { ok: false, error: { code: "invalid", message: `${basename(source)} is not a plain file` } };
      if (TEXT.test(source)) {
        const secret = findSecret(readFileSync(source, "utf8"));
        if (secret) return { ok: false, error: { code: "refused", message: `${basename(source)} carries a credential (${secret}); sanitize it and capture again` } };
      }
      mkdirSync(dir, { recursive: true });
      copyFileSync(source, join(dir, safeName(source)));
      return { ok: true, data: relEvidence(base.profile, key, safeName(source)) };
    },
  };
}

// ── native event evidence ────────────────────────────────────────────────

export type NativeEvent = { harness: AcceptanceHarness; sessionId: string; generation: number; type: string; at: string };

/** Native events a capture recorded, one JSON object per line; a malformed line is never counted as evidence. */
export function parseNativeEvents(text: string, harnesses: readonly AcceptanceHarness[]): Outcome<NativeEvent[]> {
  const events: NativeEvent[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      return { ok: false, error: { code: "invalid", message: `native event line ${i + 1} is not JSON` } };
    }
    const ev = e as Partial<NativeEvent>;
    if (typeof e !== "object" || e === null || Array.isArray(e)) return { ok: false, error: { code: "invalid", message: `native event line ${i + 1} is not an object` } };
    if (!harnesses.includes(ev.harness as AcceptanceHarness)) return { ok: false, error: { code: "invalid", message: `native event line ${i + 1} names harness ${String(ev.harness)}, which this run does not include` } };
    if (typeof ev.sessionId !== "string" || !ev.sessionId) return { ok: false, error: { code: "invalid", message: `native event line ${i + 1} has no session id` } };
    if (!Number.isInteger(ev.generation) || (ev.generation as number) < 0) return { ok: false, error: { code: "invalid", message: `native event line ${i + 1} has no attachment generation` } };
    if (typeof ev.type !== "string" || !ev.type) return { ok: false, error: { code: "invalid", message: `native event line ${i + 1} has no type` } };
    if (typeof ev.at !== "string" || Number.isNaN(Date.parse(ev.at))) return { ok: false, error: { code: "invalid", message: `native event line ${i + 1} has no time` } };
    events.push(ev as NativeEvent);
  }
  return { ok: true, data: events };
}

// ── drivers ──────────────────────────────────────────────────────────────

/**
 * What a capture step leaves for one slot, at
 * `<captureDir>/<profile>/<scenario>[@<harness>].json`. Files are relative to
 * that profile's capture folder; events is a JSONL file of native events.
 */
export type CaptureManifest = {
  outcome: ScenarioOutcome;
  reason?: string;
  files?: string[];
  events?: string;
  native?: NativeFate;
  hook?: HookRecord;
  service?: { id: string; recordedAt: string };
};

/** The default: the slot's capture manifest, or blocked until the capture step has run. */
export const captureDriver: Driver = async (ctx) => {
  const key = slotKey(ctx.scenario.id, ctx.harness);
  const folder = join(ctx.env.captureDir, ctx.profile);
  const manifestPath = join(folder, `${key}.json`);
  if (!existsSync(manifestPath)) return { outcome: "blocked", reason: `not captured yet: run the ${key} capture step (${manifestPath})` };
  let m: CaptureManifest;
  try {
    m = JSON.parse(readFileSync(manifestPath, "utf8")) as CaptureManifest;
  } catch (err) {
    return { outcome: "failed", reason: `the ${key} capture manifest is not JSON: ${(err as Error).message}` };
  }
  if (!["passed", "failed", "blocked"].includes(m.outcome)) return { outcome: "failed", reason: `the ${key} capture manifest has outcome ${String(m.outcome)}` };
  const evidence: string[] = [];
  for (const file of m.files ?? []) {
    const abs = resolve(folder, file);
    if (!abs.startsWith(`${resolve(folder)}/`)) return { outcome: "failed", reason: `${file} is outside the capture folder` };
    const copied = ctx.copyEvidence(abs);
    if (!copied.ok) return { outcome: "failed", reason: copied.error.message };
    evidence.push(copied.data);
  }
  if (m.events) {
    const abs = resolve(folder, m.events);
    if (!abs.startsWith(`${resolve(folder)}/`) || !existsSync(abs)) return { outcome: "failed", reason: `the native events file ${m.events} is missing` };
    const parsed = parseNativeEvents(readFileSync(abs, "utf8"), PROFILE_HARNESSES[ctx.profile]);
    if (!parsed.ok) return { outcome: "failed", reason: parsed.error.message };
    const copied = ctx.copyEvidence(abs);
    if (!copied.ok) return { outcome: "failed", reason: copied.error.message };
    evidence.push(copied.data);
  }
  return { outcome: m.outcome, reason: m.reason, evidence, native: m.native, hook: m.hook ?? null, service: m.service };
};

const BOARD_CODEX_MARKER = "skills-target.json";

/** The installed bundle carries each selected harness's own build of the app skills. */
export const releaseArtifactDriver: Driver = async (ctx) => {
  const helpers = join(ctx.env.app, "Contents", "Helpers");
  const checks: Array<{ check: string; ok: boolean; detail?: string }> = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ check: name, ok, ...(detail && { detail }) });
  const harnesses = PROFILE_HARNESSES[ctx.profile];
  const skillDirs = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
  if (harnesses.includes("claude")) {
    for (const app of ["board", "gitq"]) {
      const dir = join(helpers, "skills", app);
      check(`Helpers/skills/${app} holds skills`, skillDirs(dir).some((s) => existsSync(join(dir, s, "SKILL.md"))));
    }
  }
  if (harnesses.includes("codex")) {
    const root = join(helpers, "skills-targets", "codex");
    const board = join(root, "board");
    let marker: unknown = null;
    try {
      marker = JSON.parse(readFileSync(join(board, BOARD_CODEX_MARKER), "utf8"));
    } catch {
      marker = null;
    }
    check("Helpers/skills-targets/codex/board is the Codex build", (marker as { harness?: string } | null)?.harness === "codex");
    for (const app of ["board", "gitq"]) {
      const dir = join(root, app);
      check(`Helpers/skills-targets/codex/${app} holds skills`, skillDirs(dir).some((s) => existsSync(join(dir, s, "SKILL.md"))));
    }
    const leaks: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
        if (e.isDirectory()) walk(join(dir, e.name), `${rel}/${e.name}`);
        else if (e.name.endsWith(".md") && /\$\{CLAUDE_[A-Z_]+\}/.test(readFileSync(join(dir, e.name), "utf8"))) leaks.push(`${rel}/${e.name}`);
      }
    };
    walk(board, "board");
    check("the Codex board build names no Claude skill variable", leaks.length === 0, leaks.join(", ") || undefined);
  }
  const evidence = [ctx.writeEvidence("bundle-checks.json", `${JSON.stringify(checks, null, 2)}\n`)];
  const failed = checks.filter((c) => !c.ok);
  return failed.length === 0
    ? { outcome: "passed", evidence }
    : { outcome: "failed", reason: failed.map((c) => c.check + (c.detail ? ` (${c.detail})` : "")).join("; "), evidence };
};

/** Nothing ran Claude and nothing wrote its configuration. */
export const codexOnlyNoClaudeDriver: Driver = async (ctx) => {
  const count = tripwireCount(ctx.env.claudeTripwireLog);
  if (count === null) return { outcome: "blocked", reason: "no Claude tripwire is installed on the environment's PATH (claudeTripwireLog)" };
  const findings = {
    tripwireCalls: count,
    claudeConfigDir: existsSync(join(ctx.env.home, ".claude")),
    claudeJson: existsSync(join(ctx.env.home, ".claude.json")),
  };
  const evidence = [ctx.writeEvidence("no-claude.json", `${JSON.stringify(findings, null, 2)}\n`)];
  const problems = [
    ...(count > 0 ? [`the Claude tripwire was called ${count} time(s)`] : []),
    ...(findings.claudeConfigDir ? ["~/.claude exists"] : []),
    ...(findings.claudeJson ? ["~/.claude.json exists"] : []),
  ];
  return problems.length === 0 ? { outcome: "passed", evidence } : { outcome: "failed", reason: problems.join("; "), evidence };
};

export const DEFAULT_DRIVERS: Record<string, Driver> = {
  "release-artifact": releaseArtifactDriver,
  "codex-only-no-claude": codexOnlyNoClaudeDriver,
};

// ── probes ───────────────────────────────────────────────────────────────

function plistValue(exec: Exec, plist: string, key: string): string | null {
  const res = exec(["/usr/libexec/PlistBuddy", "-c", `Print :${key}`, plist]);
  return res.status === 0 ? res.stdout.trim() || null : null;
}

/** The installed artifact as the bundle itself reports it; the commit is the build's own stamp. */
export function probeArtifact(env: EnvironmentDescriptor, exec: Exec): Artifact {
  const plist = join(env.app, "Contents", "Info.plist");
  const version = plistValue(exec, plist, "CFBundleShortVersionString");
  const commit = plistValue(exec, plist, "MSSourceCommit");
  const rt = exec([env.rt, "--version"]);
  const rtVersion = rt.status === 0 ? parseVersion(rt.stdout) : null;
  return { commit: commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null, version: version && rtVersion === parseVersion(version) ? version : null };
}

export function probeNatives(profile: Profile, exec: Exec): NativeVersions {
  const natives: NativeVersions = {};
  for (const h of PROFILE_HARNESSES[profile]) {
    const res = exec([h, "--version"]);
    natives[h] = res.status === 0 ? parseVersion(`${res.stdout} ${res.stderr}`) : null;
  }
  return natives;
}

function nativeForms(env: EnvironmentDescriptor | null, profile: Profile): NativeFormRecord[] {
  const untested = PROFILE_HARNESSES[profile].flatMap((harness) => NATIVE_FORM_FEATURES.map((feature) => ({ harness, feature, status: "untested" as const })));
  if (!env) return untested;
  const path = join(env.captureDir, profile, "native-forms.json");
  if (!existsSync(path)) return untested;
  try {
    const recorded = JSON.parse(readFileSync(path, "utf8")) as NativeFormRecord[];
    return Array.isArray(recorded) ? recorded : untested;
  } catch {
    return untested;
  }
}

// ── the run ──────────────────────────────────────────────────────────────

function emptyRecord(profile: Profile, scenario: ScenarioDef, harness: AcceptanceHarness | undefined, outcome: ScenarioOutcome, reason: string, at: string): ScenarioRecord {
  return {
    scenario: scenario.id, ...(harness && { harness }), profile, outcome, reason, auditIds: [...scenario.auditIds],
    artifact: { commit: null, version: null }, natives: {}, permissionMode: null, hook: null, launch: null, evidence: [], observedAt: at,
  };
}

/** A run with every required scenario blocked for one reason. */
export function blockedRun(profile: Profile, reason: string, now: () => Date = () => new Date()): ProfileRun {
  const at = iso(now);
  return {
    profile, runId: `${profile}-${at}`, startedAt: at, finishedAt: at, environment: null,
    artifact: { commit: null, version: null }, natives: {}, permissionMode: null, claudeExecutions: null,
    scenarios: requiredSlots(profile).map(({ scenario, harness }) => emptyRecord(profile, scenario, harness, "blocked", reason, at)),
    nativeForms: nativeForms(null, profile),
  };
}

function needsBlock(scenario: ScenarioDef, env: EnvironmentDescriptor): string | null {
  if (scenario.needs.includes("disruptive") && (!env.disruptive || env.kind === "shared-home")) {
    return `${scenario.id} stops or replaces a service, and environment ${env.id} is not one an acceptance run may disrupt`;
  }
  return null;
}

/** Runs one profile against its environment and returns the run, without writing it. */
export async function runProfile(opts: RunOptions): Promise<ProfileRun> {
  const now = opts.now ?? (() => new Date());
  const { profile } = opts;
  if (!PROFILES.includes(profile)) throw new Error(`unknown profile ${profile}; choose ${PROFILES.join(", ")}`);
  const loaded = loadEnvironment(opts.environment ?? process.env[ENV_VAR], opts.realHome);
  if (!loaded.ok) return blockedRun(profile, loaded.error.message, now);
  const env = loaded.data;
  const exec = guardedExec((opts.execFor ?? environmentExec)(env), profile);
  const startedAt = iso(now);
  const dir = profileEvidenceDir(opts.evidence, profile);
  if (basename(dirname(dir)) !== EVIDENCE_FILES_DIR || basename(dir) !== profile) throw new Error(`refusing to clear ${dir}`);
  rmSync(dir, { recursive: true, force: true });

  const artifact = probeArtifact(env, exec);
  const natives = probeNatives(profile, exec);
  const environment: EnvironmentRecord = { id: env.id, kind: env.kind, disruptive: env.disruptive, ...(env.service && { service: { id: env.service.id } }) };
  const drivers = { ...DEFAULT_DRIVERS, ...opts.drivers };
  const base = { profile, env, exec, evidenceFile: opts.evidence };

  const run: ProfileRun = {
    profile, runId: `${profile}-${startedAt}`, startedAt, finishedAt: startedAt, environment, artifact, natives,
    permissionMode: env.permissionMode, claudeExecutions: null, scenarios: [], nativeForms: nativeForms(env, profile),
  };

  for (const { scenario, harness } of requiredSlots(profile)) {
    const at = iso(now);
    const blocked = needsBlock(scenario, env);
    if (blocked) {
      run.scenarios.push(emptyRecord(profile, scenario, harness, "blocked", blocked, at));
      continue;
    }
    const driver = drivers[scenario.id] ?? captureDriver;
    let result: DriverResult;
    try {
      result = await driver(slotContext(base, scenario, harness));
    } catch (err) {
      result = { outcome: "failed", reason: (err as Error).message };
    }
    const record: ScenarioRecord = {
      scenario: scenario.id, ...(harness && { harness }), profile, outcome: result.outcome,
      ...(result.reason && { reason: result.reason }),
      auditIds: [...scenario.auditIds], artifact, natives, permissionMode: env.permissionMode,
      hook: harness ? result.hook ?? null : null, launch: harness ? env.launch : null,
      evidence: result.evidence ?? [], ...(result.native && { native: result.native }), ...(result.service && { service: result.service }),
      observedAt: at,
    };
    run.scenarios.push(record);
  }

  run.claudeExecutions = profile === "codex-only" ? tripwireCount(env.claudeTripwireLog) : null;
  run.finishedAt = iso(now);
  // A driver's pass stands only if it would pass verify: the same checks, applied at once.
  for (const record of run.scenarios) {
    if (record.outcome !== "passed") continue;
    const problems = recordProblems(record, run, profile, slotKey(record.scenario, record.harness), { root: dirname(resolve(opts.evidence)), checkFiles: true });
    if (problems.length > 0) {
      record.outcome = "failed";
      record.reason = problems.map((p) => p.replace(/^[^:]+: /, "")).join("; ");
    }
  }
  return run;
}

/** Runs one profile and replaces its results in the shared evidence file. */
export async function runHarnessAcceptance(options: { profile: Profile; evidence: string } & Partial<RunOptions>): Promise<void> {
  const run = await runProfile(options);
  writeProfileRun(options.evidence, run);
}

/** Checks the completed matrix: ok only when every profile passed every required scenario on one tested artifact. */
export function verifyHarnessAcceptance(evidence: string, matrix: string = join(resolve(import.meta.dir, "..", ".."), DEFAULT_MATRIX_PATH)): Outcome<void> {
  return verifyEvidenceFile(evidence, matrix);
}

/** Takes one profile's run from an evidence file written elsewhere (a guest), with its captured files, into the shared file. */
export function importProfileRun(from: string, profile: Profile, evidence: string): Outcome<void> {
  const doc = readEvidence(from);
  if (!doc.ok) return doc;
  const run = doc.data.profiles[profile];
  if (!run) return { ok: false, error: { code: "invalid", message: `${from} has no ${profile} run` } };
  const src = profileEvidenceDir(from, profile);
  const dest = profileEvidenceDir(evidence, profile);
  if (resolve(src) !== resolve(dest)) {
    rmSync(dest, { recursive: true, force: true });
    if (existsSync(src)) {
      mkdirSync(dirname(dest), { recursive: true });
      copyTree(src, dest);
    }
  }
  writeProfileRun(evidence, run);
  return { ok: true, data: undefined };
}

function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) copyTree(join(src, e.name), join(dest, e.name));
    else if (e.isFile()) copyFileSync(join(src, e.name), join(dest, e.name));
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────

const USAGE = [
  "usage: bun scripts/acceptance/harnesses.ts --profile <claude-only|codex-only|mixed> --evidence <file>",
  "       bun scripts/acceptance/harnesses.ts --verify --evidence <file> [--matrix <file>]",
  "       bun scripts/acceptance/harnesses.ts --import <guest evidence file> --profile <profile> --evidence <file>",
].join("\n");

export async function main(argv: string[]): Promise<number> {
  let profile: string | undefined;
  let evidence: string | undefined;
  let matrix: string | undefined;
  let from: string | undefined;
  let verify = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile") profile = argv[++i];
    else if (a === "--evidence") evidence = argv[++i];
    else if (a === "--matrix") matrix = argv[++i];
    else if (a === "--import") from = argv[++i];
    else if (a === "--verify") verify = true;
    else {
      console.error(`unknown argument ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (!evidence) {
    console.error(USAGE);
    return 2;
  }
  if (verify) {
    if (profile || from) {
      console.error(USAGE);
      return 2;
    }
    const result = verifyHarnessAcceptance(evidence, matrix);
    if (result.ok) {
      console.log("The harness acceptance matrix is complete and every required scenario passed.");
      return 0;
    }
    console.error(`The harness acceptance matrix does not pass:\n${result.error.message.split("\n").map((l) => `  - ${l}`).join("\n")}`);
    return 1;
  }
  if (!profile || !PROFILES.includes(profile as Profile)) {
    console.error(USAGE);
    return 2;
  }
  if (from) {
    const imported = importProfileRun(from, profile as Profile, evidence);
    if (!imported.ok) {
      console.error(imported.error.message);
      return 1;
    }
    console.log(`Imported the ${profile} run into ${evidence}.`);
    return 0;
  }
  const run = await runProfile({ profile: profile as Profile, evidence });
  writeProfileRun(evidence, run);
  const counts = { passed: 0, failed: 0, blocked: 0 };
  for (const s of run.scenarios) counts[s.outcome]++;
  console.log(`${profile}: ${counts.passed} passed, ${counts.failed} failed, ${counts.blocked} blocked (written to ${evidence})`);
  for (const s of run.scenarios.filter((x) => x.outcome !== "passed")) {
    console.log(`  ${s.outcome.padEnd(7)} ${slotKey(s.scenario, s.harness)}${s.reason ? `: ${s.reason}` : ""}`);
  }
  return counts.passed === run.scenarios.length ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
