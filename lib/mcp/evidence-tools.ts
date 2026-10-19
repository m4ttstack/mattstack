/**
 * evidence_record and evidence_attach: the run's evidence record written in
 * one merge, and its files uploaded and spliced into the MR description.
 * Run fields go through the run tools' handlers, never sqlite, so fieldSet's
 * validateEvidence and the runDb confinement apply. Every upload goes
 * through the daemon's mr:upload, so its path guard and record check run on
 * each file sent; the only skip is a reuse whose bytes match a prior upload
 * and that the redaction check would still pass.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join } from "path";
import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { readEvidence, uploadablePaths, type EvidenceRecord, type EvidenceShot } from "../../packages/rt-client/src/evidence.ts";
import { UPLOAD_MAX_BYTES } from "../daemon/upload-guard.ts";
import { waitForAnswers } from "../endpoint/readiness.ts";
import { ticketCopyRefusal } from "../daemon/evidence-record-check.ts";
import { redactionUploadRefusal } from "../daemon/redaction-record-check.ts";
import { allowedSourceRoots, boardCaptures, bundleStem, copyIntoRun, importedCaptures, mapKey, sameBytes, type CopyRequest, type CopyResult } from "../evidence/bundle.ts";
import { displacedImportBoard, imageAddresses, importedTicketEntries, markKnownTickets, mergeRecord, parseCurrent, serializeRecord, stampTicketBytes, ticketEntries, uncoveredImages, type ImageInput, type MergeInput, type RawRecord } from "../evidence/record-merge.ts";
import { BUCKETS, bucketFor, type Bucket } from "../evidence/refusal-buckets.ts";
import { appendixProblem, namesHome, renderSection, spliceSection, type FileLink } from "../evidence/section.ts";
import { addTickets, parseTickets, serializeTickets, ticketShots, TICKETS_FIELD, type TicketEntry } from "../evidence/tickets-field.ts";
import { parseUploads, serializeUploads, sha256Of, type UploadEntry } from "../evidence/uploads-field.ts";
import { loadRepoIndex } from "../repo-index.ts";
import { parseIdentity, repoIdentitySlug } from "../settings/identity.ts";
import { getSetting } from "../settings/resolve.ts";
import { loadRegistry } from "../worktree/registry.ts";
import { githubRefusal, refuseGithubTarget } from "./mr-composite-tools.ts";
import { resolveRepoTarget } from "./mr-target.ts";
import { isFieldChanged, valueSha256 } from "../runs/write.ts";
import { runToolDefs } from "./run-tools.ts";
import { checkOptional, checkRequired, err, isTimeoutError, MR_TARGET_PROPS, MR_WRITE_TIMEOUT_MS, ok, REPO_NAME_RULE, type McpToolDef, type ToolResult } from "./shared.ts";
import { checkRegisteredTree, realTreeGuardDeps, type TreeGuardDeps } from "./tree-guard.ts";

/** A 50 MB multipart POST over a slow link outlives the 30s write timeout. */
export const MR_UPLOAD_TIMEOUT_MS = 120_000;

const READ_TIMEOUT_MS = 30_000;

export interface EvidenceToolDeps {
  command: typeof rtCommand;
  runTool: (name: "run_snapshot" | "run_field_get" | "run_field_set", input: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<ToolResult>;
  guard: TreeGuardDeps;
  resolveRepo: typeof resolveRepoTarget;
  home: () => string;
  uid: () => number | null;
  uploadRoots: () => string[];
  repoRoots: (identity: string) => string[];
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

let runTools: McpToolDef[] | undefined;

function readUploadRoots(): string[] {
  let entries: unknown;
  try {
    entries = getSetting<string[]>("rt.mcp.uploadRoots").value;
  } catch {
    return [];
  }
  return Array.isArray(entries) ? entries.filter((e): e is string => typeof e === "string" && isAbsolute(e)) : [];
}

export const realEvidenceToolDeps: EvidenceToolDeps = {
  command: rtCommand,
  async runTool(name, input, env) {
    runTools ??= runToolDefs();
    const def = runTools.find((t) => t.name === name);
    if (!def) return err(`${name} is not a run tool`);
    return def.handler(input, env);
  },
  guard: realTreeGuardDeps,
  resolveRepo: resolveRepoTarget,
  home: () => process.env.HOME ?? homedir(),
  uid: () => (typeof process.getuid === "function" ? process.getuid() : null),
  uploadRoots: readUploadRoots,
  repoRoots: (identity) => {
    const checkout = loadRepoIndex()[identity];
    return [...(checkout ? [checkout] : []), ...loadRegistry(identity).map((t) => t.path)];
  },
  fetch,
  sleep: (ms) => Bun.sleep(ms),
  now: () => Date.now(),
};

export type UploadOne = { path: string; ok: true; url: string; markdown: string } | { path: string; ok: false; error: string; timedOut: boolean };

export const UPLOAD_CANCELLED = "cancelled before this upload started";

const LANDING_HINT = "the upload may have landed anyway, and an unused upload is harmless, so retrying is safe";

async function uploadOnce(deps: EvidenceToolDeps, identity: string, path: string, runId: string | undefined): Promise<{ ok: true; url: string; markdown: string } | { ok: false; error: string }> {
  const payload: Commands["mr:upload"]["payload"] = { repoName: identity, path };
  if (runId !== undefined) payload.runId = runId;
  const res = await deps.command<Commands["mr:upload"]["data"]>("mr:upload", payload, { timeoutMs: MR_UPLOAD_TIMEOUT_MS });
  if (res.ok && res.data) return { ok: true, url: res.data.url, markdown: res.data.markdown };
  return { ok: false, error: res.error ?? "upload failed" };
}

/** A guard refusal can name a case like session-timeout, so only an unbucketed error reads as a timeout. */
const timedOut = (error: string) => bucketFor(error) === "other" && isTimeoutError(error);

/** Sequential, one mr:upload per path; a failure never stops the rest. */
export async function uploadEach(
  deps: EvidenceToolDeps,
  o: { identity: string; paths: string[]; runId?: string; retryTimeoutOnce: boolean; signal?: AbortSignal; progress?: () => void },
): Promise<UploadOne[]> {
  const out: UploadOne[] = [];
  for (const path of o.paths) {
    if (o.signal?.aborted) {
      out.push({ path, ok: false, error: UPLOAD_CANCELLED, timedOut: false });
      continue;
    }
    o.progress?.();
    let res = await uploadOnce(deps, o.identity, path, o.runId);
    if (!res.ok && o.retryTimeoutOnce && timedOut(res.error) && !o.signal?.aborted) {
      o.progress?.();
      res = await uploadOnce(deps, o.identity, path, o.runId);
    }
    if (res.ok) out.push({ path, ok: true, url: res.url, markdown: res.markdown });
    else {
      const late = timedOut(res.error);
      out.push({ path, ok: false, error: late ? `${res.error}; ${LANDING_HINT}` : res.error, timedOut: late });
    }
  }
  return out;
}

const CASE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLOTS = new Set(["before", "after"]);
const THEMES = new Set(["light", "dark"]);
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+\S[^\r\n]*$/;
const NOT_SET = /is not set on this run$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function optionalStrings(o: Obj, where: string, names: string[]): string | null {
  for (const n of names) if (o[n] !== undefined && typeof o[n] !== "string") return `${where}: "${n}" must be a string`;
  return null;
}

function checkPaths(o: Obj, where: string, names: string[]): string | null {
  for (const n of names) if (typeof o[n] === "string" && !isAbsolute(o[n] as string)) return `${where}: "${n}" must be an absolute path`;
  return null;
}

function caseIdProblem(id: unknown, where: string): string | null {
  return typeof id === "string" && CASE_ID.test(id) ? null : `${where}: case id must be lowercase letters, digits and dashes (at most 64), starting with a letter or digit`;
}

function arrayOf(input: Obj, name: string): { ok: true; items: Obj[] } | { ok: false; error: string } {
  const v = input[name];
  if (v === undefined) return { ok: true, items: [] };
  if (!Array.isArray(v) || !v.every(isObj)) return { ok: false, error: `"${name}" must be an array of objects` };
  return { ok: true, items: v as Obj[] };
}

function parseRecordInput(input: Obj): { ok: true; merge: MergeInput; plan: boolean } | { ok: false; error: string } {
  const bad = checkOptional(input, [{ name: "transcript", type: "string" }, { name: "url", type: "string" }, { name: "tree", type: "string" }]);
  if (bad) return { ok: false, error: bad };
  if (input.plan !== undefined && input.plan !== "none") return { ok: false, error: '"plan" must be "none"' };
  if (typeof input.transcript === "string" && !isAbsolute(input.transcript)) return { ok: false, error: '"transcript" must be an absolute path' };
  const images = arrayOf(input, "images");
  if (!images.ok) return images;
  const cases = arrayOf(input, "cases");
  if (!cases.ok) return cases;
  const remove = arrayOf(input, "remove");
  if (!remove.ok) return remove;
  const plan = input.plan === "none";
  if (plan && (images.items.length || cases.items.length || remove.items.length || input.transcript !== undefined || input.url !== undefined)) {
    return { ok: false, error: 'plan "none" clears the record; pass nothing else' };
  }
  for (const [i, e] of images.items.entries()) {
    const where = `images[${i}]`;
    const problem = caseIdProblem(e.case, where)
      ?? (SLOTS.has(e.slot as string) ? null : `${where}: "slot" must be "before" or "after"`)
      ?? (e.theme === undefined || THEMES.has(e.theme as string) ? null : `${where}: "theme" must be "light" or "dark"`)
      ?? (e.source === undefined || e.source === "ticket" ? null : `${where}: "source" must be "ticket"`)
      ?? (e.size === undefined && e.sha256 === undefined ? null : `${where}: "size" and "sha256" are recorded from the copied file; leave them out`)
      ?? optionalStrings(e, where, ["label", "path", "annotated", "caption", "waiver"])
      ?? checkPaths(e, where, ["path", "annotated"]);
    if (problem) return { ok: false, error: problem };
  }
  for (const [i, c] of cases.items.entries()) {
    const problem = caseIdProblem(c.id, `cases[${i}]`) ?? optionalStrings(c, `cases[${i}]`, ["label", "waiver"]);
    if (problem) return { ok: false, error: problem };
  }
  for (const [i, r] of remove.items.entries()) {
    const where = `remove[${i}]`;
    const problem = caseIdProblem(r.case, where)
      ?? (r.slot === undefined || SLOTS.has(r.slot as string) ? null : `${where}: "slot" must be "before" or "after"`)
      ?? (r.theme === undefined || THEMES.has(r.theme as string) ? null : `${where}: "theme" must be "light" or "dark"`)
      ?? (r.theme !== undefined && r.slot === undefined ? `${where}: a theme needs a slot` : null);
    if (problem) return { ok: false, error: problem };
  }
  const merge: MergeInput = {
    images: images.items as unknown as ImageInput[],
    cases: cases.items as unknown as MergeInput["cases"],
    remove: remove.items as unknown as MergeInput["remove"],
  };
  if (typeof input.transcript === "string") merge.transcript = input.transcript;
  if (typeof input.url === "string") merge.url = input.url;
  return { ok: true, merge, plan };
}

/**
 * Decided once, on the sources, before anything is copied: an entry is
 * unchanged only when it is the recorded file, or carries its name and bytes.
 * A changed bundle lands in a content folder, so its path never matches.
 */
function markRecaptures(current: RawRecord, merge: MergeInput): MergeInput {
  const recorded = imageAddresses(current);
  const images = (merge.images ?? []).map((e): ImageInput => {
    if (e.path === undefined) return e;
    const at = recorded.find((a) => a.case === e.case && a.slot === e.slot && a.theme === e.theme)?.image.path;
    if (at === undefined) return { ...e, recapture: true };
    const real = realOr(e.path);
    const unchanged = (real === realOr(at) || basename(real) === basename(at)) && sameBytes(real, at);
    return { ...e, recapture: !unchanged };
  });
  return { ...merge, images };
}

function copyRequests(merge: MergeInput, evidenceRoot: string): CopyRequest[] {
  const seen = new Set<string>();
  const out: CopyRequest[] = [];
  const add = (req: CopyRequest) => {
    const key = `${req.src}\0${req.destDir}`;
    if (!seen.has(key)) { seen.add(key); out.push(req); }
  };
  for (const e of merge.images ?? []) {
    for (const p of [e.path, e.annotated]) if (p !== undefined) add({ src: p, destDir: join(evidenceRoot, e.case) });
  }
  if (merge.transcript !== undefined) add({ src: merge.transcript, destDir: evidenceRoot, single: true });
  return out;
}

function remap(merge: MergeInput, mapped: Map<string, string>, evidenceRoot: string): MergeInput {
  const to = (p: string, destDir: string) => mapped.get(mapKey(p, destDir)) ?? p;
  const images = (merge.images ?? []).map((e) => {
    const next: ImageInput = { ...e };
    const destDir = join(evidenceRoot, e.case);
    if (e.path !== undefined) next.path = to(e.path, destDir);
    if (e.annotated !== undefined) next.annotated = to(e.annotated, destDir);
    return next;
  });
  return { ...merge, images, ...(merge.transcript !== undefined && { transcript: to(merge.transcript, evidenceRoot) }) };
}

async function readField(deps: EvidenceToolDeps, runDb: string, key: string, env: NodeJS.ProcessEnv): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  const res = await deps.runTool("run_field_get", { runDb, key }, env);
  if (res.ok) return { ok: true, value: (res.body as { value?: unknown } | null)?.value as string ?? null };
  if (NOT_SET.test(res.error ?? "")) return { ok: true, value: null };
  return { ok: false, error: res.error ?? "run_field_get failed" };
}

function runIdOf(runDb: string): string | null {
  try {
    return basename(dirname(realpathSync(runDb)));
  } catch {
    return null;
  }
}

/** The run's repo is its runs-root folder: run-start's --repo, the pack's repos/<slug> name, so an identity matches through its slug. */
function isRunRepo(identity: string, runDb: string): { ok: true } | { ok: false; runRepo: string } {
  let runRepo: string;
  try {
    runRepo = basename(dirname(dirname(realpathSync(runDb))));
  } catch {
    return { ok: false, runRepo: "(unresolved)" };
  }
  const parsed = parseIdentity(identity);
  const names = [identity, ...(parsed ? [repoIdentitySlug(parsed.id)] : [])].map((n) => n.toLowerCase());
  return names.includes(runRepo.toLowerCase()) ? { ok: true } : { ok: false, runRepo };
}

const EVIDENCE_CHANGED = "the evidence field changed during this call; call again";

const runQueues = new Map<string, Promise<void>>();

/** The MCP server runs tool calls concurrently, so calls on one run take turns rather than refusing each other through run_field_set's ifSha256. */
function onRun<T>(runDb: unknown, task: () => Promise<T>): Promise<T> {
  if (typeof runDb !== "string") return task();
  let key = runDb;
  try { key = realpathSync(runDb); } catch { /* an unresolvable runDb is refused inside the task */ }
  const next = (runQueues.get(key) ?? Promise.resolve()).then(task, task);
  const tail = next.then(() => {}, () => {});
  runQueues.set(key, tail);
  void tail.then(() => { if (runQueues.get(key) === tail) runQueues.delete(key); });
  return next;
}

/** stat before the read: a record path can name a FIFO, a device, or a video too big to ever upload. */
function measureFile(path: string): { size: number; sha256: string } {
  const st = statSync(path);
  if (!st.isFile()) throw new Error("not a regular file");
  if (st.size > UPLOAD_MAX_BYTES) throw new Error("over the upload cap, so it never uploads; save a smaller image");
  const bytes = readFileSync(path);
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** A capture over the upload cap can never upload, so there is nothing to refuse and no reason to fail the call reading it. */
function measureCapture(path: string): { size: number; sha256: string } | null {
  const size = sizeOf(path);
  return size !== null && size > UPLOAD_MAX_BYTES ? null : measureFile(path);
}

function sizeOf(path: string): number | null {
  try {
    const st = statSync(path);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

function sha256Or(path: string): string | null {
  try {
    return measureFile(path).sha256;
  } catch {
    return null;
  }
}

/** Merged onto the latest value, never over it, once more if another call lands between the read and the write. */
async function rememberTickets(deps: EvidenceToolDeps, runDb: string, stage: string, seen: TicketEntry[], env: NodeJS.ProcessEnv): Promise<string | null> {
  let res: ToolResult = err("run_field_set failed");
  for (let attempt = 0; attempt < 2; attempt++) {
    const latest = await readField(deps, runDb, TICKETS_FIELD, env);
    if (!latest.ok) return latest.error;
    const next = addTickets(parseTickets(latest.value), seen);
    if (!next.changed) return null;
    res = await deps.runTool("run_field_set", { runDb, key: TICKETS_FIELD, value: serializeTickets(next.tickets), stage, ifSha256: valueSha256(latest.value ?? "") }, env);
    if (res.ok) return null;
    if (!isFieldChanged(res.error ?? "")) break;
  }
  return `remembering the ticket images in ${TICKETS_FIELD} failed: ${res.error ?? "run_field_set failed"}`;
}

async function evidenceRecord(deps: EvidenceToolDeps, input: Obj, env: NodeJS.ProcessEnv): Promise<ToolResult> {
  const bad = checkRequired(input, [{ name: "runDb", type: "string" }, { name: "stage", type: "string" }]);
  if (bad) return err(bad);
  const parsed = parseRecordInput(input);
  if (!parsed.ok) return err(parsed.error);
  const runDb = input.runDb as string;
  const stage = input.stage as string;

  const read = await readField(deps, runDb, "evidence", env);
  if (!read.ok) return err(read.error);
  const runId = runIdOf(runDb);
  if (runId === null) return err(`runDb ${runDb} does not resolve`);

  let repoRoots: string[] = [];
  if (input.tree !== undefined) {
    const tree = checkRegisteredTree(input.tree, deps.guard);
    if (!tree.ok) return err(tree.error);
    const same = isRunRepo(tree.repoName, runDb);
    if (!same.ok) return err(`tree ${tree.path} is in repo ${tree.repoName}, but the run is in ${same.runRepo}; pass the run's own worktree root`);
    repoRoots = deps.repoRoots(tree.repoName);
  }

  const write = async (value: string): Promise<ToolResult | null> => {
    const now = await readField(deps, runDb, "evidence", env);
    if (!now.ok) return err(now.error);
    if (now.value !== read.value) return err(EVIDENCE_CHANGED);
    const res = await deps.runTool("run_field_set", { runDb, key: "evidence", value, stage, ifSha256: valueSha256(read.value ?? "") }, env);
    if (res.ok) return null;
    return err(isFieldChanged(res.error ?? "") ? EVIDENCE_CHANGED : res.error ?? "run_field_set failed");
  };

  if (parsed.plan) {
    const value = JSON.stringify({ plan: "none" });
    const failed = await write(value);
    return failed ?? ok({ written: true, encoding: "plan:none", value, uncovered: [], copied: [] });
  }

  const current = parseCurrent(read.value);
  const workDir = join(deps.home(), ".mattstack", "work");
  const evidenceRoot = join(workDir, runId, "evidence");
  const merge = markRecaptures(current, parsed.merge);
  const dry = mergeRecord(current, merge);
  if (!dry.ok) return err(dry.error);
  const displaced = displacedImportBoard(current, merge.images ?? [], (board) => boardCaptures(board), sameBytes);
  if (displaced) return err(displaced.error);

  const roots = allowedSourceRoots({ home: deps.home(), uid: deps.uid(), repoRoots, uploadRoots: deps.uploadRoots() });
  const copy = copyIntoRun(copyRequests(merge, evidenceRoot), { allowedRoots: roots, destRoot: workDir });
  if (!copy.ok) return err(copy.error);
  const copied: CopyResult[] = [...new Map(copy.copied.map((c) => [c.to, c])).values()];

  const withCopied = (error: string) => err(`${error} (the files were copied: ${copied.map((c) => c.to).join(", ") || "none"})`);
  const merged = mergeRecord(current, remap(merge, copy.mapped, evidenceRoot));
  if (!merged.ok) return withCopied(merged.error);
  const ledger = await readField(deps, runDb, TICKETS_FIELD, env);
  if (!ledger.ok) return withCopied(ledger.error);
  const known = addTickets(parseTickets(ledger.value), ticketEntries(current)).tickets;
  markKnownTickets(merged.record, known, { real: realOr, size: sizeOf, sha256: sha256Or });
  const stamped = stampTicketBytes(merged.record, merge.images ?? [], measureFile);
  if (!stamped.ok) return withCopied(stamped.error);
  // A byte copy of an import capture becomes a ticket image here, and its own board's captures join on the next pass.
  let imported: TicketEntry[] = [];
  for (;;) {
    const scan = importedTicketEntries(merged.record, importedCaptures, measureCapture);
    if (!scan.ok) return withCopied(scan.error);
    const next = addTickets(imported, scan.entries);
    if (!next.changed) break;
    imported = next.tickets;
    markKnownTickets(merged.record, imported, { real: realOr, size: sizeOf, sha256: sha256Or });
  }
  const remembered = await rememberTickets(deps, runDb, stage, [...known, ...ticketEntries(merged.record), ...imported], env);
  if (remembered) return withCopied(remembered);
  const serialized = serializeRecord(merged.record);
  if (!serialized.ok) return withCopied(serialized.error);
  const uncovered = uncoveredImages(merged.record);
  const result = { encoding: serialized.encoding, value: serialized.value, uncovered, copied };
  if (uncovered.length) return ok({ written: false, ...result });
  const failed = await write(serialized.value);
  return failed ? withCopied(failed.error ?? "run_field_set failed") : ok({ written: true, ...result });
}

type Refused = Record<Bucket, Array<{ path: string; error: string }>>;
type Uploaded = { path: string; url: string; markdown: string; reused: boolean };
type Target =
  | { forge: "github"; mr: string | null; number: number | null }
  | { forge: "gitlab"; identity: string; iid: number | undefined; mr: string | null };

const ghMove = (n: number | null) => {
  const pr = n === null ? "<number>" : String(n);
  return `GitHub has no upload API, so the section names each file as attached separately; read the body with gh pr view ${pr} --json body, then write it with gh pr edit ${pr} --body-file <file>`;
};

function prNumber(url: unknown, iid: unknown): number | null {
  const m = typeof url === "string" ? /\/pull\/(\d+)/.exec(url) : null;
  if (m) return Number(m[1]);
  return typeof iid === "number" && Number.isInteger(iid) && iid > 0 ? iid : null;
}

function githubUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const host = new URL(v.trim()).hostname.toLowerCase();
    return host === "github.com" || host === "www.github.com" ? v.trim() : null;
  } catch {
    return null;
  }
}

/** The MR is mrUrl, or repoName plus iid, else the run's mr field; repoName alone takes the field's MR only when both name one repo. */
async function resolveAttachTarget(deps: EvidenceToolDeps, input: Obj, mrField: string | undefined): Promise<Target | { error: string }> {
  const explicit = input.mrUrl !== undefined || input.repoName !== undefined;
  if (!explicit && mrField === undefined) {
    return { error: "no MR target: pass mrUrl, or repoName (with iid once an MR exists); the run has no mr field" };
  }
  const mrUrl = explicit ? input.mrUrl : mrField;
  const fieldFallback = input.mrUrl === undefined && input.iid === undefined ? mrField : undefined;
  const loneIid = explicit ? undefined : input.iid;
  const iidMismatch = (named: number | null | undefined) =>
    loneIid !== undefined && named !== loneIid
      ? { error: `iid ${String(loneIid)} does not match the run's mr field ${String(mrUrl).trim()}; pass mrUrl, or repoName with iid` }
      : null;
  const github = (): Target | { error: string } => {
    const url = githubUrl(mrUrl) ?? githubUrl(fieldFallback);
    const number = prNumber(url, input.iid);
    return iidMismatch(number) ?? { forge: "github", mr: url, number };
  };
  if (refuseGithubTarget({ repoName: input.repoName, mrUrl }, "evidence_attach", "") !== null) return github();
  const target = await deps.resolveRepo(explicit ? { repoName: input.repoName, iid: input.iid, mrUrl: input.mrUrl } : { mrUrl });
  if (!target.ok) return { error: target.error };
  if (githubRefusal(target.identity, "evidence_attach", "") !== null) return github();
  const mismatch = iidMismatch(target.iid);
  if (mismatch) return mismatch;
  if (target.iid === undefined && fieldFallback !== undefined) {
    const mismatch = (named: string) => ({ error: `repoName resolves to ${target.identity}, but the run's mr field names ${named}; pass mrUrl, or repoName with iid` });
    if (githubUrl(fieldFallback)) return mismatch(fieldFallback.trim());
    const fromField = await deps.resolveRepo({ mrUrl: fieldFallback });
    if (!fromField.ok) return { error: `the run's mr field does not resolve: ${fromField.error}` };
    if (fromField.identity !== target.identity) return mismatch(fromField.identity);
    return { forge: "gitlab", identity: target.identity, iid: fromField.iid, mr: fieldFallback.trim() };
  }
  const mr = target.iid === undefined ? null : typeof mrUrl === "string" ? mrUrl.trim() : null;
  return { forge: "gitlab", identity: target.identity, iid: target.iid, mr };
}

/** Refused files leave the section unless the Take names them as attached separately. */
function withoutFiles(record: EvidenceRecord, drop: Set<string>): EvidenceRecord {
  if (record.version !== 2 || drop.size === 0) return record;
  const keep = (s: { path: string; annotated?: string; waiver?: string }) => {
    const key = s.annotated ?? (s.waiver ? s.path : undefined);
    return key === undefined || !drop.has(key);
  };
  return {
    ...record,
    cases: record.cases.map((c) => ({
      ...c,
      ...(c.before && { before: c.before.filter(keep) }),
      ...(c.after && { after: c.after.filter(keep) }),
    })),
  };
}

/** plan:text and plan:ticket carry no cases; readEvidence would read their paths as legacy links. */
function attachRecord(value: string | undefined): EvidenceRecord {
  let json: unknown;
  try { json = JSON.parse(value ?? ""); } catch { json = undefined; }
  if (isObj(json) && (json.plan === "text" || json.plan === "ticket")) {
    const record: EvidenceRecord = { version: 2, source: 2, cases: [] };
    if (typeof json.transcript === "string" && json.transcript.trim()) record.transcript = json.transcript;
    if (typeof json.url === "string" && json.url.trim()) record.url = json.url;
    return record;
  }
  return readEvidence(value ?? null);
}

const HOME_IN_SECTION = "the section names a path in your home directory (a caption, label, waiver, ticket or appendix carries it), so the description was not written; take the path out of the evidence record and call again";

function homesOf(deps: EvidenceToolDeps): string[] {
  const home = deps.home().replace(/(.)\/+$/, "$1");
  return [...new Set([home, realOr(home)])];
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function reusable(entry: UploadEntry | undefined, real: string, project: string, record: EvidenceRecord, tickets: EvidenceShot[]): Extract<UploadEntry, { url: string }> | null {
  if (!entry || !("url" in entry) || entry.project !== project) return null;
  const stem = bundleStem(basename(real));
  if (stem !== null && existsSync(join(dirname(real), `${stem}.redactions.json`))) return null;
  try {
    if (sha256Of(real) !== entry.sha256) return null;
    const bytes = readFileSync(real);
    if (ticketCopyRefusal({ record, tickets, realpath: real, filename: basename(real), bytes }) !== null) return null;
    return redactionUploadRefusal({ realpath: real, filename: basename(real), bytes }) === null ? entry : null;
  } catch {
    return null;
  }
}

function recordFiles(record: EvidenceRecord): string[] {
  if (record.version !== 2) return [];
  return record.cases.flatMap((c) => [...(c.before ?? []), ...(c.after ?? [])].flatMap((s) => [s.path, ...(s.annotated ? [s.annotated] : [])]));
}

function coveredUrls(record: EvidenceRecord, uploads: Record<string, UploadEntry>): Set<string> {
  const files = new Set(recordFiles(record).map(realOr));
  const out = new Set<string>();
  for (const [real, entry] of Object.entries(uploads)) {
    if (!files.has(real) || !("url" in entry)) continue;
    out.add(entry.url);
    const target = /\]\(([^)]*)\)/.exec(entry.markdown)?.[1];
    if (target) out.add(target);
  }
  return out;
}

const emptyRefused = (): Refused => Object.fromEntries(BUCKETS.map((b) => [b, []])) as unknown as Refused;

function isEmptyRecord(record: EvidenceRecord): boolean {
  if (record.version === null) return true;
  if (record.version === 0) return record.links.length === 0;
  return record.cases.length === 0 && !record.transcript && !record.url && !record.attach;
}

async function evidenceAttach(deps: EvidenceToolDeps, input: Obj, env: NodeJS.ProcessEnv, signal?: AbortSignal, progress?: () => void): Promise<ToolResult> {
  const bad = checkRequired(input, [{ name: "runDb", type: "string" }, { name: "stage", type: "string" }, { name: "heading", type: "string" }])
    ?? checkOptional(input, [{ name: "before", type: "string" }, { name: "appendix", type: "string" }, { name: "description", type: "string" }, { name: "linkRefused", type: "boolean" }]);
  if (bad) return err(bad);
  const heading = input.heading as string;
  if (!ATX_HEADING.test(heading)) return err('"heading" must be one markdown heading line, such as "## Verification Evidence"');
  if (typeof input.before === "string" && !ATX_HEADING.test(input.before)) return err('"before" must be one markdown heading line');
  const appendixBad = typeof input.appendix === "string" ? appendixProblem(input.appendix, heading) : null;
  if (appendixBad) return err(appendixBad);
  const runDb = input.runDb as string;
  const stage = input.stage as string;
  const linkRefused = input.linkRefused === true;

  const snap = await deps.runTool("run_snapshot", { runDb }, env);
  if (!snap.ok) return err(snap.error ?? "run_snapshot failed");
  const fields = (snap.body as { fields?: Array<{ key?: unknown; value?: unknown }> } | null)?.fields ?? [];
  const field = (key: string) => {
    const v = fields.find((f) => f.key === key)?.value;
    return typeof v === "string" && v.trim() ? v : undefined;
  };

  const target = await resolveAttachTarget(deps, input, field("mr"));
  if ("error" in target) return err(target.error);
  const runId = runIdOf(runDb);
  if (runId === null) return err(`runDb ${runDb} does not resolve`);

  const record = attachRecord(field("evidence"));
  const uploadsMap = parseUploads(field("evidence-uploads") ?? null);
  const tickets = ticketShots(parseTickets(field(TICKETS_FIELD) ?? null));
  const refused = emptyRefused();
  const uploaded: Uploaded[] = [];
  const timedOutTwice: string[] = [];
  const linked: Array<{ path: string; error: string }> = [];
  const writeErrors: string[] = [];
  const description = typeof input.description === "string" ? input.description : undefined;
  const splice = (text: string, section: string) => spliceSection(text, heading, section, input.before as string | undefined);
  const appendix = typeof input.appendix === "string" ? input.appendix : undefined;

  if (target.forge === "github") {
    const section = isEmptyRecord(record) ? "" : renderSection(record, (path) => ({ local: path }), { appendix });
    if (namesHome(section, homesOf(deps))) {
      return ok({ forge: "github", mr: target.mr, uploaded, refused, timedOutTwice, linked, section, descriptionWritten: false, notWritten: "github", writeErrors: [HOME_IN_SECTION] });
    }
    return ok({
      forge: "github", mr: target.mr, uploaded, refused, timedOutTwice, linked, section,
      ...(description !== undefined && { description: section ? splice(description, section) : description }),
      descriptionWritten: false, notWritten: "github", next: ghMove(target.number),
    });
  }

  const paths = [...new Set(uploadablePaths(record))];
  const toSend: string[] = [];
  const shas = new Map<string, string>();
  const wasLinked = new Set<string>();
  for (const path of paths) {
    const real = realOr(path);
    const entry = uploadsMap[real];
    if (!linkRefused && entry && "linked" in entry && entry.linked === true) wasLinked.add(path);
    const reuse = reusable(entry, real, target.identity, record, tickets);
    if (reuse) {
      uploaded.push({ path, url: reuse.url, markdown: reuse.markdown, reused: true });
      continue;
    }
    try { shas.set(path, sha256Of(real)); } catch { /* unreadable: the daemon's refusal names it */ }
    toSend.push(path);
  }

  const results = await uploadEach(deps, { identity: target.identity, paths: toSend, runId, retryTimeoutOnce: true, signal, progress });
  const fresh: Record<string, UploadEntry> = {};
  const at = deps.now();
  const notStarted: string[] = [];
  for (const r of results) {
    if (!r.ok && r.error === UPLOAD_CANCELLED) {
      notStarted.push(r.path);
      continue;
    }
    if (r.ok) {
      uploaded.push({ path: r.path, url: r.url, markdown: r.markdown, reused: false });
      const sha = shas.get(r.path);
      if (sha) fresh[realOr(r.path)] = { sha256: sha, project: target.identity, url: r.url, markdown: r.markdown, at };
      continue;
    }
    // an earlier Take already linked it: refused again, it stays linked rather than reopening the gate
    if (r.timedOut) timedOutTwice.push(r.path);
    else if (wasLinked.has(r.path)) linked.push({ path: r.path, error: r.error });
    else refused[bucketFor(r.error)].push({ path: r.path, error: r.error });
    if (linkRefused) fresh[realOr(r.path)] = { linked: true, at };
  }
  const order = new Map(paths.map((p, i) => [p, i]));
  uploaded.sort((a, b) => order.get(a.path)! - order.get(b.path)!);

  let merged = { ...uploadsMap, ...fresh };
  if (Object.keys(fresh).length) {
    // another process may have remembered uploads meanwhile: merge onto its value rather than over it, once more if it lands between the read and the write
    let res: ToolResult = err("run_field_set failed");
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await readField(deps, runDb, "evidence-uploads", env);
      merged = latest.ok ? { ...uploadsMap, ...parseUploads(latest.value), ...fresh } : { ...uploadsMap, ...fresh };
      const cas = latest.ok ? { ifSha256: valueSha256(latest.value ?? "") } : {};
      res = await deps.runTool("run_field_set", { runDb, key: "evidence-uploads", value: serializeUploads(merged), stage, ...cas }, env);
      if (res.ok || !isFieldChanged(res.error ?? "")) break;
    }
    if (!res.ok) writeErrors.push(`remembering the uploads in evidence-uploads failed: ${res.error ?? "run_field_set failed"}`);
  }

  const unsent = new Set([...timedOutTwice, ...BUCKETS.flatMap((b) => refused[b].map((r) => r.path)), ...notStarted]);
  const byPath = new Map(uploaded.map((u) => [u.path, u.markdown]));
  const link = (path: string): FileLink => {
    const markdown = byPath.get(path);
    return markdown === undefined ? { local: path } : { markdown };
  };
  const empty = isEmptyRecord(record);
  const blocked = !linkRefused && (timedOutTwice.length > 0 || BUCKETS.some((b) => refused[b].length > 0));
  const shown = blocked || notStarted.length ? withoutFiles(record, linkRefused ? new Set(notStarted) : unsent) : record;
  const section = empty ? "" : renderSection(shown, link, { coveredUrls: coveredUrls(record, merged), appendix });

  let notWritten: "no-mr" | "refused" | "unchanged" | undefined;
  let descriptionOut: string | undefined;
  let descriptionWritten = false;
  let mr = target.mr;
  if (notStarted.length) {
    writeErrors.push(`cancelled: ${notStarted.length} file(s) never uploaded (${notStarted.join(", ")}), so the description was not written; the uploads that finished are remembered, so calling again resumes`);
  } else if (empty) {
    notWritten = "unchanged";
    descriptionOut = description;
  } else if (blocked) {
    notWritten = "refused";
  } else if (namesHome(section, homesOf(deps))) {
    notWritten = "refused";
    writeErrors.push(HOME_IN_SECTION);
  } else if (target.iid === undefined) {
    notWritten = "no-mr";
    if (description !== undefined) descriptionOut = splice(description, section);
  } else {
    const got = await deps.command<Commands["mr:get"]["data"]>("mr:get", { repoName: target.identity, iid: target.iid, refresh: true }, { timeoutMs: READ_TIMEOUT_MS });
    if (!got.ok || !got.data) {
      writeErrors.push(`reading the MR description failed: ${got.error ?? "mr:get failed"}`);
    } else {
      mr ??= got.data.mr.webUrl;
      const live = got.data.mr.description ?? "";
      const next = splice(live, section);
      if (next === live) notWritten = "unchanged";
      else {
        const put = await deps.command<Commands["mr:update"]["data"]>("mr:update", { repoName: target.identity, iid: target.iid, description: next }, { timeoutMs: MR_WRITE_TIMEOUT_MS });
        if (put.ok) descriptionWritten = true;
        else {
          const e = put.error ?? "mr:update failed";
          writeErrors.push(isTimeoutError(e) ? `${e}; the write may still land, so read the MR description before retrying` : e);
        }
      }
    }
  }

  return ok({
    forge: "gitlab", mr, uploaded, refused, timedOutTwice, linked, section,
    ...(descriptionOut !== undefined && { description: descriptionOut }),
    descriptionWritten,
    ...(notWritten && { notWritten }),
    ...(writeErrors.length > 0 && { writeErrors }),
  });
}

const DEV_WAIT_DEFAULT_S = 90;
const DEV_WAIT_MAX_S = 300;
const DEV_ROLES_MAX = 8;

type RoleReport = { claimed: boolean; port: number | null; url: string | null; running: boolean; listener: unknown; answered: boolean; status: number | null; answeredAfterMs: number | null; error?: string };

async function devEndpoints(deps: EvidenceToolDeps, input: Obj, signal?: AbortSignal, progress?: () => void): Promise<ToolResult> {
  const bad = checkRequired(input, [{ name: "tree", type: "string" }, { name: "roles", type: "array" }])
    ?? checkOptional(input, [{ name: "waitSeconds", type: "number" }, { name: "probePath", type: "string" }]);
  if (bad) return err(bad);
  const roles = input.roles as unknown[];
  if (roles.length < 1 || roles.length > DEV_ROLES_MAX || !roles.every((r) => typeof r === "string" && r !== "")) {
    return err(`"roles" must hold 1 to ${DEV_ROLES_MAX} role names`);
  }
  const waitSeconds = input.waitSeconds ?? DEV_WAIT_DEFAULT_S;
  if (!Number.isInteger(waitSeconds) || (waitSeconds as number) < 0 || (waitSeconds as number) > DEV_WAIT_MAX_S) {
    return err(`"waitSeconds" must be an integer from 0 to ${DEV_WAIT_MAX_S}`);
  }
  const probePath = (input.probePath as string | undefined) ?? "/";
  if (!probePath.startsWith("/")) return err('"probePath" must start with "/"');
  const tree = checkRegisteredTree(input.tree, deps.guard);
  if (!tree.ok) return err(tree.error);

  const names = [...new Set(roles as string[])];
  const reports: Record<string, RoleReport> = {};
  const targets: Array<{ role: string; url: string }> = [];
  await Promise.all(names.map(async (role) => {
    const res = await deps.command<Commands["endpoint:lookup"]["data"] & { listener?: unknown }>("endpoint:lookup", { repo: tree.repoName, worktree: tree.path, role }, { timeoutMs: READ_TIMEOUT_MS });
    const base = { answered: false, status: null, answeredAfterMs: null };
    if (!res.ok || !res.data) {
      reports[role] = { claimed: false, port: null, url: null, running: false, listener: null, ...base, error: res.error ?? "endpoint:lookup failed" };
      return;
    }
    const d = res.data;
    reports[role] = { claimed: d.claimed, port: d.port, url: d.url, running: d.running, listener: d.listener ?? null, ...base };
    if (d.claimed && d.url) targets.push({ role, url: d.url + probePath });
  }));

  const probed = await waitForAnswers(targets, { waitMs: (waitSeconds as number) * 1000, signal, progress }, { fetch: deps.fetch, sleep: deps.sleep, now: deps.now });
  for (const [role, o] of Object.entries(probed.outcomes)) Object.assign(reports[role]!, o);
  const ordered = Object.fromEntries(names.map((r) => [r, reports[r]!]));
  const waiting = names.filter((r) => reports[r]!.claimed && !reports[r]!.answered);
  return ok({ tree: tree.path, waitedMs: probed.waitedMs, roles: ordered, waiting });
}

const RUN_DB = { type: "string", description: "The runDb run_start returned." };
const STAGE = { type: "string", description: "The stage writing the field (run_field_set's stage)." };
const SLOT = { type: "string", enum: ["before", "after"] };
const THEME = { type: "string", enum: ["light", "dark"], description: "Only when the slot is a {light, dark} pair." };
const CASE = { type: "string", description: "Case id: lowercase letters, digits and dashes." };

export function evidenceToolDefs(deps: EvidenceToolDeps = realEvidenceToolDeps): McpToolDef[] {
  return [
    {
      name: "evidence_record",
      description: "Merge images, case labels or waivers, removals, a transcript or a ticket url into the run's evidence field, and write it in one call. Each image's path and annotated file is copied, with its bundle (board, spec, captures, redaction record and crops), into ~/.mattstack/work/<run id>/evidence/<case>/, and the record stores the copied paths; a transcript is copied to the evidence folder itself. A file already there is never rewritten: a bundle that would change one lands whole in a content folder beside it (<case>/<12 hex>/, names unchanged), so a capture the record names keeps its bytes until the record moves. A source must sit under the target repo's checkout or worktrees (pass tree, the run's own worktree root, to name the repo; a tree in another repo is refused), the Claude Code temp root, ~/.mattstack/evidence, rt.mcp.uploadRoots, a run's evidence folder or ~/.fast-browser/screenshots; anything else is refused before anything is copied. Writes the record only when every image is annotated with a caption or waived (its own waiver or its case's); otherwise returns uncovered and leaves the record unwritten, so call again with each listed image's cover. Every call, written or not, adds each ticket image it saw to the run's evidence-tickets field, which never shrinks, with each import capture (a capture whose sidecar is not live) in the bundle of a ticket image's annotated board, since it holds the ticket's pixels under other bytes. An image whose cover is a standalone import board keeps it: a board drawn from it with a live capture (a BEFORE → AFTER pair) is refused as that image's cover, so record the pair on the after alone. plan: \"none\" writes {\"plan\":\"none\"} and takes nothing else. Returns {written, encoding, value, uncovered, copied}.",
      inputSchema: {
        type: "object",
        properties: {
          runDb: RUN_DB,
          stage: STAGE,
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                case: CASE, label: { type: "string", description: "Names a new case." }, slot: SLOT, theme: THEME,
                path: { type: "string", description: "Absolute path of the capture; a new path recaptures the slot." },
                source: { type: "string", enum: ["ticket"], description: "ticket marks a saved ticket image: it is never waived and its own path never uploads, only its board. rt records the copied file's size and sha256 beside it (never pass them), so a copy is refused even after the file is deleted. Pass it once: on every later call an image at a ticket image's recorded path, or with its bytes, stays a ticket image with or without source, so only a different image clears it." },
                annotated: { type: "string", description: "Absolute path of the annotated board; needs caption." },
                caption: { type: "string" },
                waiver: { type: "string", description: "Why this image has no annotated board." },
              },
              required: ["case", "slot"],
              additionalProperties: false,
            },
          },
          cases: {
            type: "array",
            items: { type: "object", properties: { id: CASE, label: { type: "string" }, waiver: { type: "string" } }, required: ["id"], additionalProperties: false },
          },
          remove: {
            type: "array",
            items: { type: "object", properties: { case: CASE, slot: SLOT, theme: THEME }, required: ["case"], additionalProperties: false },
          },
          transcript: { type: "string", description: "Absolute path of a text transcript (md, txt or log)." },
          url: { type: "string", description: "The ticket url." },
          plan: { type: "string", enum: ["none"] },
          tree: { type: "string", description: "The run's worktree root; its repo's checkout and worktrees count as copy sources." },
        },
        required: ["runDb", "stage"],
        additionalProperties: false,
      },
      shellForms: { none: "merges, copies and writes the evidence field in one step; no single shell command is equivalent" },
      handler: (input, env) => onRun(input.runDb, () => evidenceRecord(deps, input, env)),
    },
    {
      name: "evidence_attach",
      description: `Call only after the attach gate's proceed. Uploads each file the run's evidence record allows (each distinct annotated board and each waived capture, once) through mr_upload's guard with the run's id, reusing an earlier upload whose bytes and project match; renders the evidence section; and replaces the section under heading in the MR description (inserted above before, or appended). A refused or twice-timed-out file blocks the description write unless linkRefused is true, which names it as \"<file name> (attached separately)\" instead, never its path; a file an earlier call linked that way is sent again: refused again, it stays linked, is listed in linked and does not block; timed out twice, it lands in timedOutTwice like any other file. The target is mrUrl, or repoName with iid, else the run's mr field (an iid passed alone must match that field's, or the call is refused); with repoName and no iid there is no MR yet, so the section (and description, spliced, when passed) comes back unwritten. On GitHub nothing uploads and nothing is written: the section names each file as attached separately and next names the gh move. A section that names a path in your home directory (a caption, label, waiver, ticket or appendix carrying one) is never written, nor next given, and writeErrors says so. Returns {forge, mr, uploaded, refused (by bucket), timedOutTwice, linked, section, description?, descriptionWritten, notWritten?, writeErrors?}. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          runDb: RUN_DB,
          stage: STAGE,
          heading: { type: "string", description: "The section's full heading line, e.g. ## Verification Evidence." },
          before: { type: "string", description: "A heading line the section is inserted above when heading is absent." },
          appendix: { type: "string", description: "Markdown printed inside the section after the generated content. A heading at or above heading's level, or a code fence left open, is refused." },
          ...MR_TARGET_PROPS,
          description: { type: "string", description: "A description to splice the section into when there is no MR to write, or on GitHub." },
          linkRefused: { type: "boolean", description: "The off-script gate's Take: name refused files as attached separately (no path) and write anyway." },
        },
        required: ["runDb", "stage", "heading"],
        additionalProperties: false,
      },
      shellForms: { none: "uploads, renders and writes the evidence section in one step; no single shell command is equivalent" },
      handler: (input, env, signal, progress) => onRun(input.runDb, () => evidenceAttach(deps, input, env, signal, progress)),
    },
    {
      name: "dev_endpoints",
      description: "Look up the dev-server endpoints rt claimed for a worktree and probe them until each answers. Pass tree (the worktree root) and roles (1 to 8 role names). For each role the daemon's claim is reported, and every claimed role gets an HTTP GET of its url plus probePath (default /) with no redirect follow; any HTTP response, a 404 or a 302 included, counts as answered, while a refused connection or a timeout does not. Probes repeat every 2 seconds until every claimed role answers or waitSeconds (default 90, at most 300, 0 probes once) passes. running is reported but is not a readiness signal; answered is. An undeclared role is reported on that role with error and does not fail the call; an unclaimed role is never waited on. Returns {tree, waitedMs, roles: {<role>: {claimed, port, url, running, listener, answered, status, answeredAfterMs, error?}}, waiting}, where waiting lists claimed roles that never answered.",
      inputSchema: {
        type: "object",
        properties: {
          tree: { type: "string", description: "Absolute path of the worktree root." },
          roles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: DEV_ROLES_MAX, description: "Endpoint role names, e.g. web, api." },
          waitSeconds: { type: "integer", minimum: 0, maximum: DEV_WAIT_MAX_S, description: "How long to keep probing; default 90, 0 probes once." },
          probePath: { type: "string", description: "Path appended to each url; default /." },
        },
        required: ["tree", "roles"],
        additionalProperties: false,
      },
      shellForms: { none: "looks up endpoints and probes them in one bounded call; no single shell command is equivalent" },
      handler: (input, _env, signal, progress) => devEndpoints(deps, input, signal, progress),
    },
  ];
}
