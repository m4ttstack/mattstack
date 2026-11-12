/**
 * mr:upload: one multipart POST to GitLab's project uploads endpoint, behind
 * the path guard in ../upload-guard.ts. glance has no multipart support, so
 * the request is built here with the same token and base URL getGitLabContext
 * gives every other GitLab verb, and it reports through providerRequestHook
 * like a provider call. The allowed roots are assembled per call: the target
 * repo's index path and worktree registry, the Claude Code temp root for this
 * uid, and rt.mcp.uploadRoots read through the resolver at call time. The
 * guard adds its own built-in roots (rt's evidence folder, a run's evidence
 * folder) on top of these. With a runId, the file must also be in that run's
 * evidence record (../evidence-record-check.ts); a file under a run's own
 * evidence folder is held to that run's record even without one. A composed board whose
 * ticket-image redactions are unconfirmed is refused too
 * (../redaction-record-check.ts).
 *
 * mr:describe-with-attachments is GitHub's counterpart: GitHub uploads a file
 * only as part of a PR write, so each file passes the same checks and then
 * goes up with the PR's description through `gh pr edit --attach`. The daemon is the only process
 * that holds the GitHub token, and gh gets it only as GH_TOKEN in its
 * environment, never in argv.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, type BigIntStats } from "fs";
import { homedir, tmpdir } from "os";
import { basename, extname, isAbsolute, join, relative, sep } from "path";
import { decodeRepo } from "../identity-decoder.ts";
import { getGitLabContext, getRepoContext, isGitHubRepo, providerRequestHook } from "../freshness.ts";
import { findBundledTool, whichWithWellKnownDirs } from "../../bundled-tool.ts";
import { resolveGithubToken } from "../../github-token.ts";
import { loadSecrets } from "../../linear.ts";
import { runCapture } from "../../subprocess.ts";
import type { DescribeAttachment, DescribeWithAttachmentsResult } from "../../../packages/rt-client/src/commands.ts";
import { getSetting } from "../../settings/resolve.ts";
import { findRun, listRunRepoDirs } from "../../runs/store.ts";
import { runsRoot } from "../../runs/paths.ts";
import { loadRegistry } from "../../worktree/registry.ts";
import { evidenceShots, readEvidence } from "../../../packages/rt-client/src/evidence.ts";
import { parseTickets, ticketsCorrupt, ticketShots, TICKETS_FIELD } from "../../evidence/tickets-field.ts";
import { evidenceUploadRefusal, RECORD_REMEDY, ticketCopyRefusal, type RunEvidenceLookup, type TicketFileAccess } from "../evidence-record-check.ts";
import { redactionUploadRefusal } from "../redaction-record-check.ts";
import { checkUploadPath, claudeTempRoots, UPLOAD_EXTENSIONS, workRoot } from "../upload-guard.ts";
import type { CommandResult, HandlerContext, HandlerMap } from "./types.ts";

/** Inside the client's 120s so the daemon, not the socket, reports a stalled GitLab. */
const UPLOAD_FETCH_TIMEOUT_MS = 100_000;

export interface MrUploadSeams {
  repoContext?: (repoName: string, repoPath?: string) => Promise<{ provider: { baseURL: string }; projectPath: string; projectId: number }>;
  gitlabToken?: () => Promise<string | undefined>;
  worktreePaths?: (repoName: string) => string[];
  uploadRoots?: () => string[];
  tempRoots?: () => string[];
  fetchFn?: typeof fetch;
  requestHook?: () => ReturnType<typeof providerRequestHook>;
  runEvidence?: (runId: string) => RunEvidenceLookup;
  runRecords?: () => RunRecordScan[];
  runFields?: (dbPath: string, keys: readonly string[]) => Record<string, string | null>;
  ticketFiles?: Partial<TicketFileAccess>;
  workRoot?: () => string;
  isGitHub?: (repoPath: string) => Promise<boolean>;
  ghBinary?: () => string | null;
  githubToken?: () => Promise<string | null>;
  githubContext?: (repoName: string, repoPath: string) => Promise<{ projectPath: string; readBody: (iid: number) => Promise<string> }>;
  ghTimeoutMs?: number;
  readBackTimeoutMs?: number;
  stagingRoot?: () => string;
}

export const MR_UPLOAD_GITHUB_REFUSAL = "unsupported: GitHub uploads a file only as part of a PR write; use evidence_attach, which uploads images into the PR description";

type CheckedAttachment = { realpath: string; filename: string; mime: string; bytes: Uint8Array };

/** The version check (10 s), the read before the write (20 s), gh (180 s) and the read-back (20 s) total 230 s, inside the MCP side's 240 s call timeout and the socket's 255 s idle limit. */
export const GH_ATTACH_TIMEOUT_MS = 180_000;
export const READ_BACK_TIMEOUT_MS = 20_000;
export const GH_MIN_VERSION = "2.99.0";

const GH_VERSION_TIMEOUT_MS = 10_000;
const GITHUB_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 50;
const ATTACHMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MARKDOWN_DESTINATION = /\]\(([^)\s]+)/g;
const GH_ERROR_MAX_CHARS = 500;
const STAGING_PREFIX = "rt-gh-attach-";
const DESCRIBE_GITHUB_ONLY = "unsupported: describe-with-attachments needs a GitHub repo";
const BODY_CHANGED = "the PR body changed after the write, so the image URLs were not recorded";
const UPLOAD_REJECTED = /attaching files requires write access|gh auth login|HTTP 401/;

type DescribePayload = { iid: number; description: string; attachments: DescribeAttachment[]; runId?: string };

function parseDescribePayload(payload: unknown): { ok: true; p: DescribePayload } | { ok: false; error: string } {
  const p = payload as { iid?: unknown; description?: unknown; attachments?: unknown; runId?: unknown } | undefined;
  if (typeof p?.iid !== "number" || !Number.isInteger(p.iid) || p.iid <= 0) return { ok: false, error: "iid must be a positive integer" };
  if (typeof p.description !== "string") return { ok: false, error: "description must be a string" };
  const description = p.description;
  const list = p.attachments;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `attachments must be an array of 1 to ${MAX_ATTACHMENTS} {path, name}` };
  }
  const seen = new Set<string>();
  const attachments: DescribeAttachment[] = [];
  for (const entry of list as Array<{ path?: unknown; name?: unknown } | null>) {
    const path = entry?.path;
    const name = entry?.name;
    if (typeof path !== "string" || !isAbsolute(path)) return { ok: false, error: `attachment path must be an absolute path: ${JSON.stringify(path)}` };
    if (typeof name !== "string" || !ATTACHMENT_NAME.test(name)) {
      return { ok: false, error: `attachment name ${JSON.stringify(name)} must be a plain file name: a letter or digit, then letters, digits, dots, underscores or dashes, at most 128 characters` };
    }
    const folded = name.toLowerCase();
    if (seen.has(folded)) return { ok: false, error: `attachment names must be unique ignoring case: ${name}` };
    seen.add(folded);
    const ext = extname(name).toLowerCase();
    if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext.slice(1))) {
      return { ok: false, error: `attachment ${name} must end in one of: ${UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(", ")}` };
    }
    if (ext !== extname(path).toLowerCase()) return { ok: false, error: `attachment ${name} must keep the extension of ${path}` };
    if (!description.includes(`](./${name})`)) return { ok: false, error: `the description must reference ${name} as ](./${name}); gh appends a file the description does not reference` };
    attachments.push({ path, name });
  }
  if (p.runId !== undefined && (typeof p.runId !== "string" || !p.runId.trim())) return { ok: false, error: "runId must be a non-empty string" };
  return { ok: true, p: { iid: p.iid, description, attachments, runId: p.runId as string | undefined } };
}

function parseGhVersion(firstLine: string): [number, number, number] | null {
  const m = /^gh version (\d+)\.(\d+)\.(\d+)/.exec(firstLine);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versionAtLeast(have: [number, number, number], need: string): boolean {
  const want = need.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i]! !== want[i]!) return have[i]! > want[i]!;
  }
  return true;
}

function destinations(body: string): string[] {
  return [...body.matchAll(MARKDOWN_DESTINATION)].map((m) => m[1]!);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type RunRecordScan = { runId: string; evidence: string | null; tickets?: string | null } | { runId: string; unreadable: string };

/** The only run fields the all-runs scan reads: the record and its ticket ledger. */
const SCAN_FIELDS = ["evidence", TICKETS_FIELD] as const;

/** The named fields of one run's state.db; throws when the file is not a readable database. */
export function readRunFields(dbPath: string, keys: readonly string[]): Record<string, string | null> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query(`SELECT key, value FROM fields WHERE key IN (${keys.map(() => "?").join(", ")})`).all(...keys) as Array<{ key: string; value: string }>;
    return Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.key === k)?.value ?? null]));
  } finally {
    db.close();
  }
}

type ScanCache = Map<string, { signature: string; record: RunRecordScan }>;

/**
 * A run db's identity, size and nanosecond mtime, with its WAL's: every
 * committed write changes one of them, so an unchanged signature means
 * unchanged fields. An empty WAL holds no commit, and a read-only open can
 * leave one behind, so it signs as no WAL. null when the db is gone;
 * undefined when it cannot be stat'd.
 */
function dbSignature(path: string): string | null | undefined {
  const stat = (p: string): BigIntStats | null | undefined => {
    try {
      return statSync(p, { bigint: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return code === "ENOENT" || code === "ENOTDIR" ? null : undefined;
    }
  };
  const sign = (st: BigIntStats) => `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}`;
  const db = stat(path);
  if (db === null || db === undefined) return db;
  const wal = stat(`${path}-wal`);
  if (wal === undefined) return undefined;
  return `${sign(db)}|${wal && wal.size > 0n ? sign(wal) : "-"}`;
}

/**
 * Every run's evidence fields, read straight from each state.db under the
 * runs root, never a full run read. A run whose db and WAL are unchanged
 * since the last scan reuses its cached fields without opening the db; an
 * unreadable run is never cached, so it warns on every scan.
 */
function scanRunRecords(readFields: (dbPath: string, keys: readonly string[]) => Record<string, string | null>, cache: ScanCache): RunRecordScan[] {
  const out: RunRecordScan[] = [];
  const seen = new Set<string>();
  for (const repo of listRunRepoDirs()) {
    let ids: string[];
    try {
      ids = readdirSync(join(runsRoot(), repo));
    } catch {
      continue;
    }
    for (const runId of ids) {
      const path = join(runsRoot(), repo, runId, "state.db");
      const signature = dbSignature(path);
      if (signature === null) continue;
      seen.add(path);
      const hit = signature === undefined ? undefined : cache.get(path);
      if (hit && hit.signature === signature) {
        out.push(hit.record);
        continue;
      }
      let record: RunRecordScan;
      try {
        const fields = readFields(path, SCAN_FIELDS);
        record = { runId, evidence: fields.evidence ?? null, tickets: fields[TICKETS_FIELD] ?? null };
      } catch {
        record = { runId, unreadable: path };
      }
      out.push(record);
      if (signature !== undefined && !("unreadable" in record)) cache.set(path, { signature, record });
      else cache.delete(path);
    }
  }
  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path);
  return out;
}

/**
 * A file can be another run's saved ticket image (its original in the
 * session temp root, or a copy recorded into a second run): every run's record is checked,
 * whether or not its work folder survives, and its remembered ticket images
 * whether or not its record still names them. Eligibility comes from the
 * parsed record, never a raw-text marker a JSON escape could hide, and a
 * recorded size gates any hashing. A shot with a recorded
 * sha256 never touches the filesystem; only a legacy shot without one is
 * resolved and probed.
 */
function ticketCopyAnyRun(
  real: string,
  filename: string,
  bytes: Uint8Array,
  records: RunRecordScan[],
  files: Partial<TicketFileAccess>,
  warn: (message: string, context: { err: unknown; path: string }) => void,
): string | null {
  for (const run of records) {
    // Skipping a run whose db or fields cannot be read keeps one bad run from blocking every upload; the warn records the skip.
    if ("unreadable" in run) {
      warn(`ticket copy check: run ${run.runId}'s db could not be read; skipped`, { err: null, path: run.unreadable });
      continue;
    }
    if (ticketsCorrupt(run.tickets ?? null)) {
      warn(`ticket copy check: run ${run.runId}'s ${TICKETS_FIELD} field is not valid; its remembered ticket images are unchecked`, { err: null, path: run.runId });
    }
    const tickets = ticketShots(parseTickets(run.tickets ?? null));
    if (run.evidence?.includes('"ticket"') && !isJson(run.evidence)) {
      warn(`ticket copy check: run ${run.runId}'s evidence field is not valid JSON; its ticket images are unchecked`, { err: null, path: run.runId });
    }
    const record = readEvidence(run.evidence);
    const recordTickets = evidenceShots(record).some(({ shot }) => shot.source === "ticket");
    if (!recordTickets && tickets.length === 0) continue;
    const refusal = ticketCopyRefusal({ record, tickets, realpath: real, filename, bytes, resolve: files.resolve, probe: files.probe, resolveHashed: false, warn });
    if (refusal) return refusal;
  }
  return null;
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** A file under a run's evidence folder belongs to that run, so its record governs it with or without a runId. */
function runIdOfPath(real: string, root: string): string | null {
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return null;
  }
  const rel = relative(rootReal, real);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  const [id, folder, ...rest] = rel.split(sep);
  return id && folder === "evidence" && rest.length > 0 ? id : null;
}

type PrBodyReader = {
  fetchSingleMR(projectPath: string, iid: number, currentUserNumericId: null, onWarning: (w: { message: string }) => void): Promise<{ description?: string | null } | null>;
};

/** A rate-limited or rejected page comes back as null with a warning, so the warning is what tells it apart from a missing PR. */
export async function readPrBody(provider: PrBodyReader, projectPath: string, iid: number): Promise<string> {
  let warning: string | undefined;
  const pr = await provider.fetchSingleMR(projectPath, iid, null, (w) => {
    warning = w.message;
  });
  if (!pr) throw new Error(warning === undefined ? `PR #${iid} could not be read` : `PR #${iid} could not be read: ${warning}`);
  return pr.description ?? "";
}

export function createMrUploadHandlers(
  ctx: Pick<HandlerContext, "repoIndex" | "log">,
  seams: MrUploadSeams = {},
): {
  "mr:upload": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:upload">>;
  "mr:describe-with-attachments": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:describe-with-attachments">>;
} & HandlerMap {
  const repoContextFn = seams.repoContext ?? ((repoName: string, repoPath?: string) => getGitLabContext("upload", repoName, repoPath));
  const gitlabTokenFn = seams.gitlabToken ?? (async () => (await loadSecrets()).gitlabToken);
  const worktreePathsFn = seams.worktreePaths ?? ((repoName: string) => loadRegistry(repoName).map((t) => t.path));
  const tempRootsFn = seams.tempRoots ?? (() => claudeTempRoots(typeof process.getuid === "function" ? process.getuid() : null));
  const fetchFn = seams.fetchFn ?? fetch;
  const workRootFn = seams.workRoot ?? workRoot;
  const isGitHubFn = seams.isGitHub ?? isGitHubRepo;
  const ghBinaryFn = seams.ghBinary ?? (() => findBundledTool("gh", whichWithWellKnownDirs()));
  const githubTokenFn = seams.githubToken ?? (async () => (await resolveGithubToken((await loadSecrets()).githubToken))?.token ?? null);
  const githubContextFn = seams.githubContext ?? (async (repoName: string, repoPath: string) => {
    const repoCtx = await getRepoContext(repoName, repoPath);
    if (repoCtx.forge !== "github") throw new Error(DESCRIBE_GITHUB_ONLY);
    const { provider, projectPath } = repoCtx;
    return {
      projectPath,
      readBody: (iid: number) => readPrBody(provider, projectPath, iid),
    };
  });
  const ghTimeoutMsOpt = seams.ghTimeoutMs;
  const readBackTimeoutMsOpt = seams.readBackTimeoutMs;
  const stagingRootFn = seams.stagingRoot ?? tmpdir;
  const hookFn = seams.requestHook ?? providerRequestHook;
  const runEvidenceFn = seams.runEvidence ?? ((runId: string): RunEvidenceLookup => {
    const detail = findRun(runId);
    const field = (key: string) => detail?.fields.find((f) => f.key === key)?.value ?? null;
    return detail ? { found: true, evidence: field("evidence"), tickets: field(TICKETS_FIELD) } : { found: false };
  });
  const runFieldsFn = seams.runFields ?? readRunFields;
  const scanCache: ScanCache = new Map();
  const runRecordsFn = seams.runRecords ?? (() => scanRunRecords(runFieldsFn, scanCache));
  const uploadRootsFn = seams.uploadRoots ?? (() => {
    let entries: unknown;
    try {
      entries = getSetting<string[]>("rt.mcp.uploadRoots").value;
    } catch (err) {
      ctx.log.warn({ err }, "rt.mcp.uploadRoots: unreadable, treating as empty");
      return [];
    }
    if (!Array.isArray(entries)) return [];
    const roots: string[] = [];
    for (const entry of entries) {
      if (typeof entry === "string" && isAbsolute(entry)) roots.push(entry);
      else ctx.log.warn({ entry }, "rt.mcp.uploadRoots: ignoring non-absolute entry");
    }
    return roots;
  });

  function checkAttachment(repoName: string, repoPath: string, path: string, runId: unknown): { ok: true; checked: CheckedAttachment } | { ok: false; error: string } {
    const roots = [repoPath, ...worktreePathsFn(repoName), ...tempRootsFn(), ...uploadRootsFn()];
    const checked = checkUploadPath(path.trim(), roots);
    if (!checked.ok) return { ok: false, error: checked.error };
    const unconfirmed = redactionUploadRefusal({ realpath: checked.realpath, filename: checked.filename, bytes: checked.bytes, warn: (message, context) => ctx.log.warn(context, message) });
    if (unconfirmed) return { ok: false, error: unconfirmed };
    if (runId !== undefined && (typeof runId !== "string" || !runId.trim())) return { ok: false, error: "runId must be a non-empty string" };
    const asked = typeof runId === "string" ? runId.trim() : undefined;
    const runIds = new Set<string>();
    if (asked) runIds.add(asked);
    const owner = runIdOfPath(checked.realpath, workRootFn());
    if (owner) runIds.add(owner);
    const warn = (message: string, context: { err: unknown; path: string }) => ctx.log.warn(context, message);
    for (const id of runIds) {
      const refusal = evidenceUploadRefusal({ runId: id, realpath: checked.realpath, filename: checked.filename, run: runEvidenceFn(id), bytes: checked.bytes, warn });
      if (!refusal) continue;
      const byLocation = id === owner && id !== asked && !refusal.includes("ticket image");
      return { ok: false, error: byLocation ? `${checked.filename} is in run ${id}'s evidence folder and not in run ${id}'s evidence record; ${RECORD_REMEDY}` : refusal };
    }
    const ticket = ticketCopyAnyRun(checked.realpath, checked.filename, checked.bytes, runRecordsFn(), seams.ticketFiles ?? {}, warn);
    if (ticket) return { ok: false, error: ticket };
    return { ok: true, checked };
  }

  return {
    "mr:upload": async (payload, signal) => {
      const p = payload as { repoName?: unknown; path?: unknown; runId?: unknown } | undefined;
      const path = p?.path;
      if (typeof path !== "string" || !path.trim()) return { ok: false, error: "missing repoName/path" };
      const decoded = decodeRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const repoName = decoded.repo;
      const repoPath = ctx.repoIndex()[repoName];
      if (!repoPath) return { ok: false, error: "repo-unknown" };

      if (await isGitHubFn(repoPath)) return { ok: false, error: MR_UPLOAD_GITHUB_REFUSAL };
      const attachment = checkAttachment(repoName, repoPath, path, p?.runId);
      if (!attachment.ok) return { ok: false, error: attachment.error };
      const checked = attachment.checked;

      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const token = await gitlabTokenFn();
        if (!token) return { ok: false, error: "no gitlabToken in secrets" };

        const apiPath = `/projects/${repoCtx.projectId}/uploads`;
        const form = new FormData();
        form.append("file", new Blob([checked.bytes], { type: checked.mime }), checked.filename);
        const timeout = AbortSignal.timeout(UPLOAD_FETCH_TIMEOUT_MS);
        const started = performance.now();
        const res = await fetchFn(`${repoCtx.provider.baseURL}/api/v4${apiPath}`, {
          method: "POST",
          headers: { "PRIVATE-TOKEN": token },
          body: form,
          signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        });
        hookFn().onRequest({ op: "mr:upload", transport: "rest", method: "POST", path: apiPath, durationMs: performance.now() - started, status: res.status });
        if (!res.ok) {
          const detail = (await res.text().catch(() => "")).slice(0, 200);
          return { ok: false, error: `GitLab upload returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}` };
        }
        const body = (await res.json()) as { url?: unknown; full_path?: unknown; markdown?: unknown };
        if (typeof body.markdown !== "string" || typeof body.url !== "string") {
          return { ok: false, error: "GitLab upload reply carried no url/markdown" };
        }
        const url = typeof body.full_path === "string"
          ? `${repoCtx.provider.baseURL}${body.full_path}`
          : `${repoCtx.provider.baseURL}/${repoCtx.projectPath}${body.url}`;
        return { ok: true, data: { url, markdown: body.markdown } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "mr:describe-with-attachments": async (payload, signal) => {
      const decoded = decodeRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const parsed = parseDescribePayload(payload);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const { iid, description, attachments, runId } = parsed.p;
      const repoName = decoded.repo;
      const repoPath = ctx.repoIndex()[repoName];
      if (!repoPath) return { ok: false, error: "repo-unknown" };
      if (!(await isGitHubFn(repoPath))) return { ok: false, error: DESCRIBE_GITHUB_ONLY };

      const gh = ghBinaryFn();
      if (!gh) return { ok: false, error: "gh is not installed; attaching images on GitHub needs gh 2.99 or newer (run: brew install gh)" };
      const PATH = process.env.PATH ?? "";
      const HOME = process.env.HOME ?? homedir();
      const versionRun = await runCapture([gh, "--version"], { env: { PATH, HOME }, timeoutMs: GH_VERSION_TIMEOUT_MS, signal });
      if (versionRun.timedOut) return { ok: false, error: `gh --version did not finish in ${GH_VERSION_TIMEOUT_MS / 1000}s and was stopped` };
      const versionLine = versionRun.stdout.split("\n")[0]!.trim();
      const version = parseGhVersion(versionLine);
      if (!version || !versionAtLeast(version, GH_MIN_VERSION)) {
        const named = version ? version.join(".") : versionLine.slice(0, 80) || "unknown";
        return { ok: false, error: `gh ${named} cannot attach images; it needs gh 2.99 or newer (run: brew upgrade gh)` };
      }

      const token = await githubTokenFn();
      if (!token) return { ok: false, error: "missing GitHub token (run: rt setup github connect)" };

      const refused: Array<{ path: string; error: string }> = [];
      const checked: Array<DescribeAttachment & { bytes: Uint8Array }> = [];
      for (const a of attachments) {
        const result = checkAttachment(repoName, repoPath, a.path, runId);
        if (!result.ok) {
          refused.push({ path: a.path, error: result.error });
          continue;
        }
        const { bytes, mime, realpath } = result.checked;
        // The guard types a file by its resolved name, so a .png link to an .mp4 would be staged as a .png holding video bytes.
        if (extname(a.name).toLowerCase() !== extname(realpath).toLowerCase()) {
          refused.push({ path: a.path, error: `attachment ${a.name} must keep the extension of ${realpath}` });
          continue;
        }
        if (mime.startsWith("image/") && bytes.length > GITHUB_IMAGE_MAX_BYTES) {
          refused.push({ path: a.path, error: `file is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB; the upload cap is 10 MB for an image on GitHub` });
          continue;
        }
        checked.push({ ...a, bytes });
      }
      if (refused.length > 0) return { ok: true, data: { outcome: "refused", refused } };

      let github: Awaited<ReturnType<typeof githubContextFn>>;
      try {
        github = await githubContextFn(repoName, repoPath);
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }

      const readBackMs = readBackTimeoutMsOpt ?? READ_BACK_TIMEOUT_MS;
      const readBody = () => withDeadline(Promise.resolve().then(() => github.readBody(iid)), readBackMs, `reading PR #${iid} did not finish in ${readBackMs / 1000}s`);
      let before: string;
      try {
        before = await readBody();
      } catch (err) {
        return { ok: false, error: `could not read PR #${iid} before the write: ${errorMessage(err)}` };
      }
      // gh's upload URLs are new on every upload, so a URL already in the body is an earlier upload, never this file's.
      const earlier = new Set(destinations(before));

      const root = stagingRootFn();
      let made: string;
      try {
        made = mkdtempSync(join(root, STAGING_PREFIX));
      } catch (err) {
        return { ok: false, error: `could not make a staging folder: ${(err as NodeJS.ErrnoException).code ?? "unknown error"}` };
      }
      try {
        // gh matches a body reference to an --attach file by absolute path, so every path below uses this one resolved spelling (/private/var, never /var).
        const dir = realpathSync(made);
        const scrub = (text: string): string => {
          for (const spelling of new Set([dir, made])) {
            for (const c of checked) text = text.split(`${spelling}/${c.name}`).join(basename(c.path));
            text = text.split(`${spelling}/`).join("").split(spelling).join("");
          }
          return text;
        };
        const staged = checked.map((c) => join(dir, c.name));
        const bodyFile = join(dir, "body.md");
        try {
          // wx: gh uploads exactly the bytes that passed the checks, never a file something else put at that name.
          checked.forEach((c, i) => writeFileSync(staged[i]!, c.bytes, { flag: "wx", mode: 0o600 }));
          writeFileSync(bodyFile, description, { flag: "wx", mode: 0o600 });
        } catch (err) {
          return { ok: false, error: `could not stage the attachments: ${scrub(errorMessage(err))}` };
        }

        const timeoutMs = ghTimeoutMsOpt ?? GH_ATTACH_TIMEOUT_MS;
        const run = await runCapture(
          [gh, "pr", "edit", String(iid), "--repo", `github.com/${github.projectPath}`, "--body-file", bodyFile, ...staged.flatMap((f) => ["--attach", f])],
          { cwd: dir, env: { PATH, HOME, GH_TOKEN: token, GH_PROMPT_DISABLED: "1" }, stderr: "pipe", timeoutMs, signal },
        );

        const urls: Record<string, string> = {};
        const hostedNames = new Set<string>();
        let readBackError: string | undefined;
        try {
          const body = await readBody();
          const sent = destinations(description);
          const back = destinations(body);
          // A body still equal to the one read before the write means gh never wrote: no URL, and nothing changed underneath.
          if (body !== before && sent.length !== back.length) {
            readBackError = BODY_CHANGED;
          } else if (body !== before) {
            const byRef = new Map(checked.map((c) => [`./${c.name}`, c]));
            sent.forEach((dest, i) => {
              const c = byRef.get(dest);
              const hosted = back[i]!;
              if (c !== undefined && hosted !== dest && hosted.startsWith("https://") && !earlier.has(hosted)) {
                urls[c.path] = hosted;
                hostedNames.add(c.name);
              }
            });
          }
        } catch (err) {
          readBackError = errorMessage(err);
        }

        const found = hostedNames.size > 0;
        const exitedClean = run.exitCode === 0 && !run.timedOut;
        if (exitedClean && readBackError === undefined && hostedNames.size < checked.length) {
          readBackError = `the PR body came back without a hosted URL for ${checked.length - hostedNames.size} of ${checked.length} images, so those were not recorded`;
        }
        const data: Extract<DescribeWithAttachmentsResult, { outcome: "ran" }> = { outcome: "ran", written: exitedClean || found, urls };
        if (!exitedClean) {
          const detail = scrub(run.stderr).trim().slice(0, GH_ERROR_MAX_CHARS);
          data.ghError = run.timedOut
            ? `gh pr edit did not finish in ${timeoutMs / 1000}s and was stopped`
            : detail || `gh pr edit exited with code ${run.exitCode}`;
          data.uploadRejected = !found && UPLOAD_REJECTED.test(run.stderr);
        }
        if (readBackError !== undefined) data.readBackError = readBackError;
        return { ok: true, data };
      } finally {
        removeStaging(made, root);
      }
    },
  };
}

/** Races a read against a deadline; the timer is cleared either way so it never holds the process open. */
async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  work.catch(() => {});
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function removeStaging(made: string, root: string): void {
  let real: string;
  let rootReal: string;
  try {
    real = realpathSync(made);
    rootReal = realpathSync(root);
  } catch {
    return;
  }
  if (!real.startsWith(rootReal + sep) || !basename(real).startsWith(STAGING_PREFIX)) return;
  rmSync(real, { recursive: true, force: true });
}
