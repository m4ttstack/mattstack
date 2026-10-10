/**
 * The shared acceptance evidence file: its shape, the per-profile atomic
 * update, and the check that only a complete, passing matrix passes.
 */

import { closeSync, existsSync, lstatSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, normalize, sep } from "path";
import type { Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import {
  ACCEPTANCE_HARNESSES, AUDIT_IDS, NATIVE_FORM_FEATURES, PROFILE_HARNESSES, PROFILES, requiredSlots, scenarioById, slotKey,
  type AcceptanceHarness, type NativeFormFeature, type Profile,
} from "./scenarios.ts";

export const EVIDENCE_SCHEMA = 1;
export const EVIDENCE_KIND = "harness-integrations-acceptance";
/** Captured files live under this folder beside the evidence file, one subfolder per profile. */
export const EVIDENCE_FILES_DIR = "harness-integrations";

export type ScenarioOutcome = "passed" | "failed" | "blocked";
export type Artifact = { commit: string | null; version: string | null };
export type NativeVersions = Partial<Record<AcceptanceHarness, string | null>>;
export type HookTrust = "trusted" | "untrusted" | "changed" | "tampered" | "unknown";
export type HookRecord = { revision: string | null; trust: HookTrust; proof: "installation" | "receipts" | null };
export type LaunchProvenance = "managed" | "manual";
/** One native operation as seen before and after a restart, sanitized: ids and counts, never message bodies. */
export type NativeSnapshot = { nativeId: string; generation: number; pending: string[] };
export type NativeFate = {
  before: NativeSnapshot;
  after: NativeSnapshot;
  /** What became of the operation that was pending before the restart. */
  fate: "completed" | "replayed" | "lost";
  /** Where the fate was read: a logical retry id never proves what the harness did. */
  fateSource: "native" | "logical-id";
};

export type ScenarioRecord = {
  scenario: string;
  harness?: AcceptanceHarness;
  profile: Profile;
  outcome: ScenarioOutcome;
  reason?: string;
  auditIds: string[];
  artifact: Artifact;
  natives: NativeVersions;
  permissionMode: string | null;
  hook: HookRecord | null;
  launch: LaunchProvenance | null;
  /** Relative to the evidence file's folder, under EVIDENCE_FILES_DIR/<profile>/. */
  evidence: string[];
  native?: NativeFate;
  /** The service a disruptive scenario stopped or restarted, recorded before it did. */
  service?: { id: string; recordedAt: string };
  /** The native event log among `evidence`, for a scenario whose identity and timing are checked against one. */
  events?: string;
  /**
   * Who stands behind a pass: `machine` when a driver observed it itself,
   * `operator` when it rests on a capture someone made (ruling P18). Null
   * for a slot that never ran.
   */
  attestedBy: "machine" | "operator" | null;
  observedAt: string;
};

export type NativeFormRecord = {
  harness: AcceptanceHarness;
  feature: NativeFormFeature;
  status: "supported" | "unsupported" | "untested";
  note?: string;
};

export type EnvironmentRecord = {
  id: string;
  kind: "vm" | "isolated-home" | "shared-home";
  disruptive: boolean;
  service?: { id: string };
} | null;

export type ProfileRun = {
  profile: Profile;
  runId: string;
  startedAt: string;
  finishedAt: string;
  environment: EnvironmentRecord;
  artifact: Artifact;
  natives: NativeVersions;
  permissionMode: string | null;
  /** Calls the Claude tripwire saw during a Codex-only run; null when no tripwire was installed. */
  claudeExecutions: number | null;
  scenarios: ScenarioRecord[];
  nativeForms: NativeFormRecord[];
};

export type EvidenceFile = {
  schema: number;
  kind: string;
  matrix: string;
  /** What a pass in this file stands on; see each record's `attestedBy`. */
  attestation: string;
  profiles: Partial<Record<Profile, ProfileRun>>;
};

export const ATTESTATION = "A pass with attestedBy \"operator\" rests on a capture the operator made: the runner checks its files, native events, identity and timing, but cannot prove the step ran as described (ruling P18). Only attestedBy \"machine\" passes were observed by the runner itself: the artifact and native version probes, release-artifact and codex-only-no-claude.";

export type TestedMatrix = { schema: number; harnesses: Record<string, { versions: string[] }> };

export const DEFAULT_MATRIX_PATH = "scripts/acceptance/tested-versions.json";

export function emptyEvidence(): EvidenceFile {
  return { schema: EVIDENCE_SCHEMA, kind: EVIDENCE_KIND, matrix: DEFAULT_MATRIX_PATH, attestation: ATTESTATION, profiles: {} };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the shared file; a missing file is an empty matrix, an unreadable one a fault. */
export function readEvidence(path: string): Outcome<EvidenceFile> {
  if (!existsSync(path)) return { ok: true, data: emptyEvidence() };
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { ok: false, error: { code: "invalid", message: `${path} is not JSON: ${(err as Error).message}` } };
  }
  if (!isObject(doc) || doc.schema !== EVIDENCE_SCHEMA || doc.kind !== EVIDENCE_KIND || !isObject(doc.profiles)) {
    return { ok: false, error: { code: "invalid", message: `${path} is not a schema ${EVIDENCE_SCHEMA} ${EVIDENCE_KIND} file` } };
  }
  return { ok: true, data: doc as unknown as EvidenceFile };
}

export function readMatrix(path: string): Outcome<TestedMatrix> {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { ok: false, error: { code: "invalid", message: `the tested-version matrix ${path} cannot be read: ${(err as Error).message}` } };
  }
  if (!isObject(doc) || doc.schema !== 1 || !isObject(doc.harnesses)) {
    return { ok: false, error: { code: "invalid", message: `${path} is not a schema 1 tested-version matrix` } };
  }
  for (const [harness, entry] of Object.entries(doc.harnesses)) {
    if (!isObject(entry) || !Array.isArray(entry.versions) || entry.versions.some((v) => typeof v !== "string" || !/^\d+\.\d+\.\d+$/.test(v))) {
      return { ok: false, error: { code: "invalid", message: `${path}: ${harness} must list exact x.y.z versions, never a range` } };
    }
  }
  return { ok: true, data: doc as unknown as TestedMatrix };
}

const LOCK_WAIT_MS = 30_000;
const LOCK_STALE_MS = 10 * 60_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function holdLock(path: string): () => void {
  const lock = `${path}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return () => rmSync(lock, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true });
      } catch {
        // The holder released it between the open and the stat.
      }
      if (Date.now() > deadline) throw new Error(`another acceptance run holds ${lock}; wait for it, or remove the lock if no run is going`);
      sleepSync(25 + Math.floor(Math.random() * 50));
    }
  }
}

/**
 * Replaces one profile's run in the shared file and leaves the others as they
 * are: read, change and write happen under one lock, and the write is a
 * rename, so concurrent profile runs never lose each other's results.
 */
export function writeProfileRun(path: string, run: ProfileRun): void {
  const release = holdLock(path);
  try {
    const current = readEvidence(path);
    if (!current.ok) throw new Error(current.error.message);
    const doc = current.data;
    doc.profiles = { ...doc.profiles, [run.profile]: run };
    const ordered: EvidenceFile = { ...doc, attestation: ATTESTATION, profiles: {} };
    for (const p of PROFILES) if (doc.profiles[p]) ordered.profiles[p] = doc.profiles[p];
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(ordered, null, 2)}\n`);
    renameSync(tmp, path);
  } finally {
    release();
  }
}

/** Token shapes that must never reach committed evidence. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{16,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/,
  /AGE-SECRET-KEY-1[A-Z0-9]+/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:authorization|x-api-key)\s*[:=]\s*\S{8,}/i,
  /\b(?:access_token|refresh_token|id_token|api_key|token)["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i,
  /https?:\/\/[^\s/:@]+:[^\s/@]+@/,
];

export function findSecret(text: string): string | null {
  for (const pattern of SECRET_PATTERNS) {
    const m = pattern.exec(text);
    if (m) return pattern.source;
  }
  return null;
}

/** A path rt may commit: relative, inside the profile's evidence folder, and naming no person's home. */
export function evidencePathProblem(path: string, profile: Profile): string | null {
  if (typeof path !== "string" || path.length === 0) return "an evidence path is empty";
  if (isAbsolute(path) || path.startsWith("~")) return `${path} is not relative to the evidence file`;
  const norm = normalize(path);
  if (norm.split(sep).includes("..")) return `${path} leaves the evidence folder`;
  const prefix = `${EVIDENCE_FILES_DIR}/${profile}/`;
  if (!norm.startsWith(prefix)) return `${path} is not under ${prefix}`;
  if (/\/(Users|home)\//.test(`/${norm}`)) return `${path} names a home folder`;
  return null;
}

const TEXT_EXTENSIONS = /\.(json|jsonl|txt|log|md|toml|yaml|yml|csv|html)$/i;

export type VerifyOptions = {
  root?: string; matrix?: TestedMatrix; checkFiles?: boolean;
  /** Report failed and blocked slots as they are, without counting them as problems (an import of a partial run). */
  allowUnpassed?: boolean;
};

const PROOF_KIND: Record<AcceptanceHarness, HookRecord["proof"]> = { claude: "installation", codex: "receipts" };

/** Every reason the matrix is not a complete pass; empty only for one. */
export function matrixProblems(doc: EvidenceFile, opts: VerifyOptions = {}): string[] {
  const problems: string[] = [];
  const matrix = opts.matrix;
  let artifact: Artifact | null = null;
  for (const profile of PROFILES) {
    const run = doc.profiles[profile];
    if (!run) {
      problems.push(`${profile}: has not run`);
      continue;
    }
    problems.push(...profileProblems(run, profile, matrix, opts));
    if (artifact === null) artifact = run.artifact;
    else if (run.artifact.commit !== artifact.commit || run.artifact.version !== artifact.version) {
      problems.push(`${profile}: ran artifact ${run.artifact.version ?? "?"} (${run.artifact.commit ?? "?"}), not the ${artifact.version ?? "?"} (${artifact.commit ?? "?"}) the other profiles ran`);
    }
  }
  return problems;
}

export function profileProblems(run: ProfileRun, profile: Profile, matrix: TestedMatrix | undefined, opts: VerifyOptions): string[] {
  const problems: string[] = [];
  const harnesses = PROFILE_HARNESSES[profile];
  if (run.profile !== profile) problems.push(`${profile}: its run says it is ${run.profile}`);
  if (!run.artifact?.commit || !run.artifact?.version) problems.push(`${profile}: the installed artifact's commit and version were not recorded`);
  else if (run.artifact.commit.endsWith("-dirty")) problems.push(`${profile}: the installed artifact was built from a tree with uncommitted changes (${run.artifact.commit})`);
  for (const h of ACCEPTANCE_HARNESSES) {
    const version = run.natives?.[h] ?? null;
    if (harnesses.includes(h)) {
      if (!version) problems.push(`${profile}: ${h}'s version was not recorded`);
      else if (matrix && !(matrix.harnesses[h]?.versions ?? []).includes(version)) {
        problems.push(`${profile}: ${h} ${version} is not in the tested-version matrix`);
      }
    } else if (version) {
      problems.push(`${profile}: ${h} ${version} was found, but this profile does not include ${h}`);
    }
  }
  if (profile === "codex-only") {
    if (run.claudeExecutions === null || run.claudeExecutions === undefined) problems.push(`${profile}: no Claude tripwire was installed, so nothing shows Claude never ran`);
    else if (run.claudeExecutions > 0) problems.push(`${profile}: Claude ran ${run.claudeExecutions} time(s) during a Codex-only run`);
  }

  const seen = new Map<string, number>();
  for (const record of run.scenarios ?? []) {
    const key = slotKey(record.scenario, record.harness);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) if (n > 1) problems.push(`${profile}: ${key} is recorded ${n} times`);

  const required = new Set(requiredSlots(profile).map((slot) => slotKey(slot.scenario.id, slot.harness)));
  for (const key of required) if (!seen.has(key)) problems.push(`${profile}: required scenario ${key} is missing`);

  for (const record of run.scenarios ?? []) {
    const key = slotKey(record.scenario, record.harness);
    const def = scenarioById(record.scenario);
    if (!def) {
      problems.push(`${profile}: ${key} is not a scenario in the matrix`);
      continue;
    }
    if (!required.has(key)) {
      problems.push(`${profile}: ${key} does not belong to this profile`);
      continue;
    }
    problems.push(...recordProblems(record, run, profile, key, opts));
  }

  for (const form of run.nativeForms ?? []) {
    if (!harnesses.includes(form.harness)) problems.push(`${profile}: native form ${form.feature} names ${form.harness}, which this profile does not run`);
    if (!NATIVE_FORM_FEATURES.includes(form.feature)) problems.push(`${profile}: ${form.feature} is not a native form feature`);
    if (scenarioById(form.feature as string)) problems.push(`${profile}: ${form.feature} is a required scenario, not an optional native form`);
  }
  return problems;
}

/** Why a record does not stand as a pass; a record that is not passed reports its own outcome. */
export function recordProblems(record: ScenarioRecord, run: ProfileRun, profile: Profile, key: string, opts: VerifyOptions = {}): string[] {
  const problems: string[] = [];
  const at = `${profile}: ${key}`;
  if (record.profile !== profile) problems.push(`${at} was recorded under ${record.profile}`);
  if (record.outcome !== "passed") {
    if (record.outcome === "blocked" || record.outcome === "failed") {
      if (!opts.allowUnpassed) problems.push(`${at} ${record.outcome}${record.reason ? `: ${record.reason}` : ""}`);
    }
    else problems.push(`${at} has outcome ${String(record.outcome)}, which is not passed, failed or blocked`);
    return problems;
  }
  const def = scenarioById(record.scenario)!;
  for (const id of def.auditIds) if (!record.auditIds?.includes(id)) problems.push(`${at} does not name audit row ${id}`);
  for (const id of record.auditIds ?? []) if (!AUDIT_IDS.includes(id)) problems.push(`${at} names ${id}, which is not an audit row`);
  if (record.artifact?.commit !== run.artifact?.commit || record.artifact?.version !== run.artifact?.version) {
    problems.push(`${at} ran a different artifact than its profile`);
  }
  for (const h of ACCEPTANCE_HARNESSES) {
    if ((record.natives?.[h] ?? null) !== (run.natives?.[h] ?? null)) problems.push(`${at} ran ${h} ${record.natives?.[h] ?? "absent"}, not the profile's ${run.natives?.[h] ?? "absent"}`);
  }
  if (!record.permissionMode) problems.push(`${at} records no permission mode`);
  if (record.attestedBy !== "machine" && record.attestedBy !== "operator") problems.push(`${at} does not say whether the runner or an operator stands behind it`);
  const observed = Date.parse(record.observedAt);
  const started = Date.parse(run.startedAt);
  const finished = Date.parse(run.finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished)) {
    problems.push(`${at}: its run has no valid start or finish time, so when it was observed cannot be checked`);
  } else if (Number.isNaN(observed) || observed < started || observed > finished) {
    problems.push(`${at} was observed outside its run (${record.observedAt})`);
  }
  if (record.harness) {
    if (record.launch !== "managed" && record.launch !== "manual") problems.push(`${at} records no managed or manual launch`);
    const hook = record.hook;
    if (!hook || !hook.revision) problems.push(`${at} records no hook revision`);
    else if (hook.proof !== PROOF_KIND[record.harness]) problems.push(`${at} claims ${hook.proof ?? "no"} policy proof; ${record.harness} proves policy by ${PROOF_KIND[record.harness]}`);
  }
  if (def.needs.includes("disruptive")) {
    if (!run.environment || run.environment.kind === "shared-home" || !run.environment.disruptive) problems.push(`${at} is disruptive but ran outside an isolated acceptance environment`);
    if (!record.service?.id || !record.service.recordedAt) problems.push(`${at} did not record the service it stopped before stopping it`);
  }
  if (def.restart) problems.push(...restartProblems(record.native, at));
  if (def.events) {
    if (!record.events) problems.push(`${at} carries no native event log`);
    else if (!record.evidence?.includes(record.events)) problems.push(`${at}: its event log ${record.events} is not among its evidence`);
    else if (opts.checkFiles && opts.root) problems.push(...eventProblems(join(opts.root, record.events), record, run, def, at));
  }
  if (!record.evidence?.length) problems.push(`${at} passed with no evidence`);
  for (const path of record.evidence ?? []) {
    const problem = evidencePathProblem(path, profile);
    if (problem) {
      problems.push(`${at}: ${problem}`);
      continue;
    }
    if (opts.checkFiles && opts.root) problems.push(...fileProblems(join(opts.root, path), path, at));
  }
  return problems;
}

/** A restart passes only on the original operation's own fate, read from the harness. */
export function restartProblems(native: NativeFate | undefined, at: string): string[] {
  if (!native?.before || !native.after) return [`${at} does not record the native state before and after the restart`];
  const problems: string[] = [];
  if (!native.before.nativeId || native.after.nativeId !== native.before.nativeId) {
    problems.push(`${at} shows a different native session after the restart, which proves only a replacement`);
  }
  if (!Number.isInteger(native.after.generation) || native.after.generation < native.before.generation) {
    problems.push(`${at} reads a stale attachment generation after the restart`);
  }
  if (!["completed", "replayed", "lost"].includes(native.fate)) problems.push(`${at} does not say what became of the original operation`);
  if (native.fateSource !== "native") problems.push(`${at} reads its fate from a logical retry id, which does not prove native deduplication`);
  return problems;
}

function fileProblems(abs: string, rel: string, at: string): string[] {
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return [`${at}: ${rel} is missing`];
  }
  if (st.isSymbolicLink()) return [`${at}: ${rel} is a link`];
  if (!st.isFile()) return [`${at}: ${rel} is not a file`];
  if (st.size === 0) return [`${at}: ${rel} is empty`];
  if (!TEXT_EXTENSIONS.test(rel)) return [];
  const secret = findSecret(readFileSync(abs, "utf8"));
  return secret ? [`${at}: ${rel} carries a credential (${secret})`] : [];
}

export type NativeEvent = { harness: AcceptanceHarness; sessionId: string; generation: number; type: string; at: string };

/** The service stop a disruptive capture marks in its event log. */
export const SERVICE_STOP_EVENT = "service-stop";

/** Native events a capture recorded, one JSON object per line; a malformed line is never counted as evidence. */
export function parseNativeEvents(text: string, harnesses: readonly AcceptanceHarness[]): Outcome<NativeEvent[]> {
  const events: NativeEvent[] = [];
  const lines = text.split("\n");
  const bad = (i: number, why: string): Outcome<NativeEvent[]> => ({ ok: false, error: { code: "invalid", message: `native event line ${i + 1} ${why}` } });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      return bad(i, "is not JSON");
    }
    if (typeof e !== "object" || e === null || Array.isArray(e)) return bad(i, "is not an object");
    const ev = e as Partial<NativeEvent>;
    if (!harnesses.includes(ev.harness as AcceptanceHarness)) return bad(i, `names harness ${String(ev.harness)}, which this run does not include`);
    if (typeof ev.sessionId !== "string" || !ev.sessionId) return bad(i, "has no session id");
    if (!Number.isInteger(ev.generation) || (ev.generation as number) < 0) return bad(i, "has no attachment generation");
    if (typeof ev.type !== "string" || !ev.type) return bad(i, "has no type");
    if (typeof ev.at !== "string" || Number.isNaN(Date.parse(ev.at))) return bad(i, "has no time");
    events.push(ev as NativeEvent);
  }
  if (events.length === 0) return { ok: false, error: { code: "invalid", message: "the native event log holds no events" } };
  return { ok: true, data: events };
}

/**
 * A disruptive capture's events must show its service recorded before the
 * stop, and a restart's must show the original native session, under the
 * record's own harness, at its first generation before the stop and at the
 * later one after it.
 */
export function eventTimelineProblems(events: NativeEvent[], record: Pick<ScenarioRecord, "harness" | "native" | "service">, disruptive: boolean, restart: boolean, at: string): string[] {
  const problems: string[] = [];
  const time = (e: NativeEvent) => Date.parse(e.at);
  const stop = events.filter((e) => e.type === SERVICE_STOP_EVENT).sort((a, b) => time(a) - time(b))[0];
  if (disruptive) {
    if (!stop) problems.push(`${at}: its event log does not mark the ${SERVICE_STOP_EVENT}`);
    else if (!record.service?.recordedAt || !(Date.parse(record.service.recordedAt) < time(stop))) {
      problems.push(`${at}: the service was not recorded before the stop`);
    } else {
      const firstAfter = events.filter((e) => time(e) > time(stop)).sort((a, b) => time(a) - time(b))[0];
      if (firstAfter && !(Date.parse(record.service.recordedAt) < time(firstAfter))) problems.push(`${at}: the service was recorded after events that followed the stop`);
    }
  }
  if (restart && record.native) {
    const { before, after } = record.native;
    const of = (generation: number) => events.filter((e) => e.harness === record.harness && e.sessionId === before.nativeId && e.generation === generation);
    const earlier = of(before.generation);
    if (earlier.length === 0) problems.push(`${at}: no native event shows ${before.nativeId} at generation ${before.generation} before the restart`);
    else if (stop && !earlier.some((e) => time(e) < time(stop))) problems.push(`${at}: ${before.nativeId} is never seen at generation ${before.generation} before the stop`);
    const later = of(after.generation);
    if (later.length === 0) problems.push(`${at}: no native event shows ${before.nativeId} at generation ${after.generation} after the restart`);
    else if (stop && !later.some((e) => time(e) > time(stop))) problems.push(`${at}: ${before.nativeId} is never seen at generation ${after.generation} after the stop`);
  }
  return problems;
}

function eventProblems(abs: string, record: ScenarioRecord, run: ProfileRun, def: { needs: readonly string[]; restart?: true }, at: string): string[] {
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return [`${at}: its event log is missing`];
  }
  const parsed = parseNativeEvents(text, PROFILE_HARNESSES[run.profile]);
  if (!parsed.ok) return [`${at}: ${parsed.error.message}`];
  return eventTimelineProblems(parsed.data, record, def.needs.includes("disruptive"), def.restart === true, at);
}

export function verifyEvidenceFile(path: string, matrixPath: string): Outcome<void> {
  const doc = readEvidence(path);
  if (!doc.ok) return doc;
  if (!existsSync(path)) return { ok: false, error: { code: "invalid", message: `${path} does not exist; no profile has run` } };
  const matrix = readMatrix(matrixPath);
  if (!matrix.ok) return matrix;
  const problems = matrixProblems(doc.data, { matrix: matrix.data, root: dirname(path), checkFiles: true });
  if (problems.length === 0) return { ok: true, data: undefined };
  return { ok: false, error: { code: "invalid", message: problems.join("\n") } };
}
