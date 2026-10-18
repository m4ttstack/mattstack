/**
 * mr:upload: one multipart POST to GitLab's project uploads endpoint, behind
 * the path guard in ../upload-guard.ts. glance has no multipart support, so
 * the request is built here with the same token and base URL getRepoContext
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
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, realpathSync } from "fs";
import { isAbsolute, join, relative, sep } from "path";
import { decodeRepo } from "../identity-decoder.ts";
import { getRepoContext, providerRequestHook } from "../freshness.ts";
import { loadSecrets } from "../../linear.ts";
import { getSetting } from "../../settings/resolve.ts";
import { findRun, listRunRepoDirs } from "../../runs/store.ts";
import { runsRoot } from "../../runs/paths.ts";
import { loadRegistry } from "../../worktree/registry.ts";
import { readEvidence } from "../../../packages/rt-client/src/evidence.ts";
import { evidenceUploadRefusal, RECORD_REMEDY, ticketCopyRefusal, type RunEvidenceLookup } from "../evidence-record-check.ts";
import { redactionUploadRefusal } from "../redaction-record-check.ts";
import { checkUploadPath, claudeTempRoots, workRoot } from "../upload-guard.ts";
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
  workRoot?: () => string;
}

export type RunRecordScan = { runId: string; evidence: string | null } | { runId: string; unreadable: string };

/**
 * Every run's evidence field, read straight from each state.db under the runs
 * root: the scan below opens every run, so it skips findRun's full read.
 */
function scanRunRecords(): RunRecordScan[] {
  const out: RunRecordScan[] = [];
  for (const repo of listRunRepoDirs()) {
    let ids: string[];
    try {
      ids = readdirSync(join(runsRoot(), repo));
    } catch {
      continue;
    }
    for (const runId of ids) {
      const path = join(runsRoot(), repo, runId, "state.db");
      if (!existsSync(path)) continue;
      let db: Database | null = null;
      try {
        db = new Database(path, { readonly: true });
        const row = db.query("SELECT value FROM fields WHERE key = 'evidence'").get() as { value: string } | null;
        out.push({ runId, evidence: row?.value ?? null });
      } catch {
        out.push({ runId, unreadable: path });
      } finally {
        db?.close();
      }
    }
  }
  return out;
}

/**
 * With no run in scope a file can still be a run's saved ticket image (its
 * original in the session temp root, say): every run's record is checked,
 * whether or not its work folder survives. A record without a ticket image
 * is skipped unparsed, and a recorded size gates any hashing.
 */
function ticketCopyAnyRun(
  real: string,
  filename: string,
  bytes: Uint8Array,
  records: RunRecordScan[],
  warn: (message: string, context: { err: unknown; path: string }) => void,
): string | null {
  for (const run of records) {
    // Skipping a run whose db cannot be read keeps one bad db from blocking every upload; the warn records the skip.
    if ("unreadable" in run) {
      warn(`ticket copy check: run ${run.runId}'s db could not be read; skipped`, { err: null, path: run.unreadable });
      continue;
    }
    if (!run.evidence?.includes('"ticket"')) continue;
    const record = readEvidence(run.evidence);
    if (record.version !== 2) continue;
    const refusal = ticketCopyRefusal({ record, realpath: real, filename, bytes, warn });
    if (refusal) return refusal;
  }
  return null;
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

export function createMrUploadHandlers(
  ctx: Pick<HandlerContext, "repoIndex" | "log">,
  seams: MrUploadSeams = {},
): { "mr:upload": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:upload">> } & HandlerMap {
  const repoContextFn = seams.repoContext ?? getRepoContext;
  const gitlabTokenFn = seams.gitlabToken ?? (async () => (await loadSecrets()).gitlabToken);
  const worktreePathsFn = seams.worktreePaths ?? ((repoName: string) => loadRegistry(repoName).map((t) => t.path));
  const tempRootsFn = seams.tempRoots ?? (() => claudeTempRoots(typeof process.getuid === "function" ? process.getuid() : null));
  const fetchFn = seams.fetchFn ?? fetch;
  const workRootFn = seams.workRoot ?? workRoot;
  const hookFn = seams.requestHook ?? providerRequestHook;
  const runEvidenceFn = seams.runEvidence ?? ((runId: string): RunEvidenceLookup => {
    const detail = findRun(runId);
    return detail ? { found: true, evidence: detail.fields.find((f) => f.key === "evidence")?.value ?? null } : { found: false };
  });
  const runRecordsFn = seams.runRecords ?? scanRunRecords;
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

      const roots = [repoPath, ...worktreePathsFn(repoName), ...tempRootsFn(), ...uploadRootsFn()];
      const checked = checkUploadPath(path.trim(), roots);
      if (!checked.ok) return { ok: false, error: checked.error };
      const unconfirmed = redactionUploadRefusal({ realpath: checked.realpath, filename: checked.filename, bytes: checked.bytes, warn: (message, context) => ctx.log.warn(context, message) });
      if (unconfirmed) return { ok: false, error: unconfirmed };
      if (p?.runId !== undefined && (typeof p.runId !== "string" || !p.runId.trim())) return { ok: false, error: "runId must be a non-empty string" };
      const asked = typeof p?.runId === "string" ? p.runId.trim() : undefined;
      const runIds = new Set<string>();
      if (asked) runIds.add(asked);
      const owner = runIdOfPath(checked.realpath, workRootFn());
      if (owner) runIds.add(owner);
      const warn = (message: string, context: { err: unknown; path: string }) => ctx.log.warn(context, message);
      for (const runId of runIds) {
        const refusal = evidenceUploadRefusal({ runId, realpath: checked.realpath, filename: checked.filename, run: runEvidenceFn(runId), bytes: checked.bytes, warn });
        if (!refusal) continue;
        const byLocation = runId === owner && runId !== asked && !refusal.includes("ticket image");
        return { ok: false, error: byLocation ? `${checked.filename} is in run ${runId}'s evidence folder and not in run ${runId}'s evidence record; ${RECORD_REMEDY}` : refusal };
      }
      if (runIds.size === 0) {
        const ticket = ticketCopyAnyRun(checked.realpath, checked.filename, checked.bytes, runRecordsFn(), warn);
        if (ticket) return { ok: false, error: ticket };
      }

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
  };
}
