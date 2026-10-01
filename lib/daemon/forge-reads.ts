/**
 * Agent-facing GitLab reads. Every function here asks GitLab through the
 * provider's restRequest and returns GitLab's own refusal text; none reads
 * or writes the daemon's project-MRs store.
 */

import type { ForgeGetData, MrListLiveFilters, MrTargetSummary, PipelineListRow, ProjectLabel } from "../../packages/rt-client/src/commands.ts";

export type RestProvider = {
  restRequest: (method: string, path: string, body?: unknown, op?: string, io?: { redirect?: "manual" }) => Promise<Response>;
};

export function projectApi(projectPath: string): string {
  return `/projects/${encodeURIComponent(projectPath)}`;
}

const ERROR_BODY_MAX_BYTES = 1024;

export async function gitlabFailure(res: Response): Promise<string> {
  const { bytes } = await readCapped(res, ERROR_BODY_MAX_BYTES).catch(() => ({ bytes: new Uint8Array(0) }));
  const detail = new TextDecoder().decode(bytes).slice(0, 200);
  return `GitLab returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`;
}

/** glance's fetchSingleMR answers null for a refusal, a missing MR and a failed
    query alike, so the reason has to be asked for separately. */
export async function missingMrReason(provider: RestProvider, projectPath: string, iid: number): Promise<string> {
  try {
    const res = await provider.restRequest("GET", `${projectApi(projectPath)}/merge_requests/${iid}`, undefined, "mr:get");
    if (!res.ok) return await gitlabFailure(res);
    return `GitLab has MR !${iid} in ${projectPath} but its detail query failed; try again`;
  } catch (err) {
    return String(err);
  }
}

export interface RestMrRow {
  iid: number;
  title: string;
  state: string;
  draft?: boolean;
  source_branch: string;
  target_branch: string;
  author?: { username?: string } | null;
  web_url?: string | null;
  detailed_merge_status?: string | null;
}

export function targetSummary(row: RestMrRow): MrTargetSummary {
  return {
    iid: row.iid,
    title: row.title,
    state: row.state,
    draft: row.draft === true,
    sourceBranch: row.source_branch,
    targetBranch: row.target_branch,
    author: row.author?.username ?? null,
    webUrl: row.web_url ?? null,
    detailedMergeStatus: row.detailed_merge_status ?? null,
  };
}

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;
const LIST_PER_PAGE = 100;

export async function listMrsLive(
  provider: RestProvider,
  projectPath: string,
  filters: MrListLiveFilters,
): Promise<{ ok: true; mrs: MrTargetSummary[]; truncated: boolean } | { ok: false; error: string }> {
  const limit = filters.limit ?? LIST_DEFAULT_LIMIT;
  const query = new URLSearchParams({ state: filters.state ?? "opened", order_by: "updated_at", sort: "desc" });
  if (filters.author === "me") query.set("scope", "created_by_me");
  else {
    query.set("scope", "all");
    if (filters.author) query.set("author_username", filters.author);
  }
  if (filters.sourceBranch) query.set("source_branch", filters.sourceBranch);
  if (filters.targetBranch) query.set("target_branch", filters.targetBranch);
  if (filters.search) query.set("search", filters.search);
  query.set("per_page", String(LIST_PER_PAGE));
  const mrs: MrTargetSummary[] = [];
  try {
    for (let page = 1; mrs.length <= limit; page++) {
      query.set("page", String(page));
      const res = await provider.restRequest("GET", `${projectApi(projectPath)}/merge_requests?${query}`, undefined, "mr:list-live");
      if (!res.ok) return { ok: false, error: await gitlabFailure(res) };
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) return { ok: false, error: "GitLab's merge request listing was not a JSON array" };
      mrs.push(...(rows as RestMrRow[]).map(targetSummary));
      // GitLab can omit pagination headers, so an absent header ends the walk only on a short page.
      const next = res.headers.get("x-next-page");
      if (rows.length === 0 || (next === null ? rows.length < LIST_PER_PAGE : next === "")) return { ok: true, mrs: mrs.slice(0, limit), truncated: mrs.length > limit };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  return { ok: true, mrs: mrs.slice(0, limit), truncated: true };
}

const LABEL_MAX_PAGES = 10;
export const PIPELINE_DEFAULT_LIMIT = 20;
export const PIPELINE_MAX_LIMIT = 100;
export const PIPELINE_IID_CONFLICT = '"iid" lists one MR\'s own pipelines and cannot be combined with "ref" or "sha"';

export async function listLabels(
  provider: RestProvider,
  projectPath: string,
  search?: string,
): Promise<{ ok: true; labels: ProjectLabel[] } | { ok: false; error: string }> {
  const labels: ProjectLabel[] = [];
  try {
    for (let page = 1; page <= LABEL_MAX_PAGES; page++) {
      const query = new URLSearchParams({ per_page: "100", page: String(page) });
      if (search) query.set("search", search);
      const res = await provider.restRequest("GET", `${projectApi(projectPath)}/labels?${query}`, undefined, "project:labels");
      if (!res.ok) return { ok: false, error: await gitlabFailure(res) };
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) return { ok: false, error: "GitLab's label listing was not a JSON array" };
      for (const r of rows as Array<{ name: string; description?: string | null; color?: string | null }>) {
        labels.push({ name: r.name, description: r.description ?? null, color: r.color ?? null });
      }
      const next = res.headers.get("x-next-page");
      if (next === null ? rows.length < 100 : next === "") return { ok: true, labels };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  return { ok: false, error: `more than ${LABEL_MAX_PAGES * 100} labels matched; narrow the search` };
}

export async function listPipelines(
  provider: RestProvider,
  projectPath: string,
  f: { ref?: string; sha?: string; iid?: number; limit?: number },
): Promise<{ ok: true; pipelines: PipelineListRow[] } | { ok: false; error: string }> {
  if (f.iid !== undefined && (f.ref || f.sha)) return { ok: false, error: PIPELINE_IID_CONFLICT };
  const query = new URLSearchParams({ per_page: String(f.limit ?? PIPELINE_DEFAULT_LIMIT) });
  let path: string;
  if (f.iid !== undefined) path = `${projectApi(projectPath)}/merge_requests/${f.iid}/pipelines`;
  else {
    path = `${projectApi(projectPath)}/pipelines`;
    query.set("order_by", "id");
    query.set("sort", "desc");
    if (f.ref) query.set("ref", f.ref);
    if (f.sha) query.set("sha", f.sha);
  }
  try {
    const res = await provider.restRequest("GET", `${path}?${query}`, undefined, "pipeline:list");
    if (!res.ok) return { ok: false, error: await gitlabFailure(res) };
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return { ok: false, error: "GitLab's pipeline listing was not a JSON array" };
    return {
      ok: true,
      pipelines: (rows as Array<{ id: number; status: string; ref?: string; sha?: string; source?: string; web_url?: string; created_at?: string }>).map((r) => ({
        id: r.id, status: r.status, ref: r.ref ?? null, sha: r.sha ?? null, source: r.source ?? null, webUrl: r.web_url ?? null, createdAt: r.created_at ?? null,
      })),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** A GET of any of these returns secret values redaction cannot recognise. */
export const REFUSED_SEGMENTS: readonly string[] = [
  "variables", "triggers", "deploy_tokens", "access_tokens", "runners", "hooks", "secure_files", "integrations", "services",
  "pipeline_schedules", "terraform", "application",
];
export const FORGE_GET_MAX_BYTES = 256 * 1024;
const CONTROL = /[\u0000-\u001f\u007f]/;

export function checkForgePath(path: unknown, projectPath: string): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof path !== "string" || !path.trim()) return { ok: false, error: '"path" is required' };
  let rest = path.trim();
  if (CONTROL.test(rest) || rest.includes("?") || rest.includes("#") || rest.includes("://") || rest.includes("\\")) {
    return { ok: false, error: '"path" must be a plain API path; pass query values in "query"' };
  }
  rest = rest.replace(/^\/+/, "").replace(/^api\/v4\//, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return { ok: false, error: '"path" has a malformed percent escape' };
  }
  if (CONTROL.test(decoded)) return { ok: false, error: '"path" must be a plain API path; pass query values in "query"' };
  if (decoded.includes("%")) return { ok: false, error: '"path" must not be percent-encoded more than once' };
  const segments = decoded.split("/").map((s) => s.toLowerCase());
  if (segments.some((s) => s === "." || s === "..")) return { ok: false, error: '"path" must not contain dot segments' };
  // GitLab routes an optional format suffix (variables.json) to the same endpoint.
  const refused = REFUSED_SEGMENTS.find((seg) => segments.some((s) => s === seg || s.startsWith(`${seg}.`)));
  if (refused) return { ok: false, error: `"path" names ${refused}, which can return credentials; gitlab_get refuses it` };
  return { ok: true, path: `/${rest.replace(/(^|\/):id(?=\/|$)/g, `$1${encodeURIComponent(projectPath)}`)}` };
}

const TOKEN_KEY = /(^|_)token$/i;

/** A project's own JSON carries runners_token for a maintainer; no path check can see that. */
export function scrubTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubTokens);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, TOKEN_KEY.test(k) && v !== null ? "[redacted]" : scrubTokens(v)]));
  }
  return value;
}

/** The same scrub for a body cut before it could be parsed. */
export function scrubTokenText(text: string): string {
  return text
    .replace(/("(?:[A-Za-z0-9]+_)*token"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[redacted]"')
    // The size cap can land inside a token value, leaving it with no closing quote.
    .replace(/("(?:[A-Za-z0-9]+_)*token"\s*:\s*)"(?:[^"\\]|\\.)*\\?$/i, '$1"[redacted]');
}

const headerNumber = (res: Response, name: string): number | null => {
  const n = Number(res.headers.get(name));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Stops pulling once more than the cap has arrived, so a huge response never sits in memory. */
async function readCapped(res: Response, max = FORGE_GET_MAX_BYTES): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > max) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return { bytes: truncated ? all.subarray(0, max) : all, truncated };
}

/** Names the host only: the full Location can carry a signed token. */
function redirectRefusal(res: Response): string {
  const prefix = `gitlab_get does not follow redirects: GitLab answered ${res.status}`;
  const location = res.headers.get("location");
  if (!location) return `${prefix} with no Location header`;
  try {
    return `${prefix} redirecting to ${new URL(location).host}`;
  } catch {
    return `${prefix} redirecting to a relative location`;
  }
}

const REFUSED_QUERY_KEYS = ["sudo", "private_token", "access_token", "job_token", "bearer_token"];

/** Rack reads `[sudo]`, `sudo]` and `sudo[]` as the plain `sudo` parameter. */
const rackKey = (k: string): string => (k.match(/^[[\]]*([^[\]]*)/)?.[1] ?? k).toLowerCase();

export async function forgeGet(
  provider: RestProvider,
  projectPath: string,
  input: { path: unknown; query?: Record<string, string | number | boolean>; page?: number; perPage?: number },
): Promise<{ ok: true; data: ForgeGetData } | { ok: false; error: string }> {
  const checked = checkForgePath(input.path, projectPath);
  if (!checked.ok) return checked;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(input.query ?? {})) {
    if (REFUSED_QUERY_KEYS.includes(rackKey(k))) return { ok: false, error: `"query.${k}" can carry credentials or impersonation; gitlab_get refuses it` };
    query.set(k, String(v));
  }
  if (input.page !== undefined) query.set("page", String(input.page));
  if (input.perPage !== undefined) query.set("per_page", String(input.perPage));
  const qs = query.toString();
  try {
    const res = await provider.restRequest("GET", `${checked.path}${qs ? `?${qs}` : ""}`, undefined, "forge:get", { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) return { ok: false, error: redirectRefusal(res) };
    if (!res.ok) return { ok: false, error: await gitlabFailure(res) };
    const { bytes, truncated } = await readCapped(res);
    const text = new TextDecoder().decode(bytes);
    let body: unknown = truncated ? scrubTokenText(text) : text;
    if (!truncated) {
      try { body = scrubTokens(JSON.parse(text)); } catch { /* not JSON: the text is the body */ }
    }
    return { ok: true, data: { status: res.status, body, truncated, nextPage: headerNumber(res, "x-next-page"), totalPages: headerNumber(res, "x-total-pages") } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
