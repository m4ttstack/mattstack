/**
 * Agent-facing forge reads, returning the forge's own refusal text; none
 * reads or writes the daemon's project-MRs store. The list, label and
 * pipeline reads go through glance; forgeGet and missingMrReason ask GitLab
 * through the provider's restRequest.
 */

import { ForgeHttpError, RateLimitedError, type GitProvider } from "@mattstack/glance";
import type { ForgeGetData, MrListLiveFilters, MrTargetSummary, PipelineListRow, ProjectLabel } from "../../packages/rt-client/src/commands.ts";

export type RestProvider = {
  restRequest: (method: string, path: string, body?: unknown, op?: string, io?: { redirect?: "manual" }) => Promise<Response>;
};

export type Forge = "gitlab" | "github";

const forgeName = (forge: Forge): string => (forge === "github" ? "GitHub" : "GitLab");

export function projectApi(projectPath: string): string {
  return `/projects/${encodeURIComponent(projectPath)}`;
}

const ERROR_BODY_MAX_BYTES = 1024;
const ERROR_DETAIL_MAX_CHARS = 200;

export async function gitlabFailure(res: Response, forge: Forge = "gitlab"): Promise<string> {
  const { bytes } = await readCapped(res, ERROR_BODY_MAX_BYTES).catch(() => ({ bytes: new Uint8Array(0) }));
  const detail = new TextDecoder().decode(bytes).slice(0, ERROR_DETAIL_MAX_CHARS);
  return `${forgeName(forge)} returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`;
}

/** glance throws these as plain Errors, and the daemon has always replied with the bare sentence. */
const NOT_AN_ARRAY = /^GitLab's [a-z ]+ listing was not a JSON array$/;

/** The reply text for an error a glance read threw. */
export function forgeFailure(err: unknown, forge: Forge): string {
  if (err instanceof ForgeHttpError) {
    const detail = err.bodyText.slice(0, ERROR_DETAIL_MAX_CHARS);
    return `${forgeName(forge)} returned ${err.status} ${err.statusText}${detail ? `: ${detail}` : ""}`;
  }
  if (err instanceof RateLimitedError) {
    return err.retryAfterMs === null ? err.message : `${err.message} (retry in ${Math.ceil(err.retryAfterMs / 1000)}s)`;
  }
  if (err instanceof Error && NOT_AN_ARRAY.test(err.message)) return err.message;
  return String(err);
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

type ReadsOf<K extends keyof GitProvider> = { [P in K]-?: NonNullable<GitProvider[P]> };
export type SummariesProvider = ReadsOf<"fetchPullRequestSummaries">;

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;

export async function listMrsLive(
  provider: SummariesProvider,
  projectPath: string,
  filters: MrListLiveFilters,
  forge: Forge = "gitlab",
): Promise<{ ok: true; mrs: MrTargetSummary[]; truncated: boolean } | { ok: false; error: string }> {
  try {
    const { rows, truncated } = await provider.fetchPullRequestSummaries(projectPath, {
      state: filters.state ?? "opened",
      sort: "updated_desc",
      author: filters.author,
      sourceBranch: filters.sourceBranch,
      targetBranch: filters.targetBranch,
      search: filters.search,
      limit: filters.limit ?? LIST_DEFAULT_LIMIT,
    });
    return { ok: true, mrs: rows, truncated };
  } catch (err) {
    return { ok: false, error: forgeFailure(err, forge) };
  }
}

const LABEL_MAX_ROWS = 1000;
export const PIPELINE_DEFAULT_LIMIT = 20;
export const PIPELINE_MAX_LIMIT = 100;
export const PIPELINE_IID_CONFLICT = '"iid" lists one MR\'s own pipelines and cannot be combined with "ref" or "sha"';

export async function listLabels(
  provider: ReadsOf<"fetchProjectLabels">,
  projectPath: string,
  search?: string,
  forge: Forge = "gitlab",
): Promise<{ ok: true; labels: ProjectLabel[] } | { ok: false; error: string }> {
  try {
    const { labels, truncated } = await provider.fetchProjectLabels(projectPath, { search, maxRows: LABEL_MAX_ROWS });
    if (truncated) return { ok: false, error: `more than ${LABEL_MAX_ROWS} labels matched; narrow the search` };
    return { ok: true, labels };
  } catch (err) {
    return { ok: false, error: forgeFailure(err, forge) };
  }
}

/** glance lets `iid` win over `ref` and `sha`; the daemon refuses the mix instead. */
export async function listPipelines(
  provider: ReadsOf<"fetchPipelineList">,
  projectPath: string,
  f: { ref?: string; sha?: string; iid?: number; limit?: number },
  forge: Forge = "gitlab",
): Promise<{ ok: true; pipelines: PipelineListRow[] } | { ok: false; error: string }> {
  if (f.iid !== undefined && (f.ref || f.sha)) return { ok: false, error: PIPELINE_IID_CONFLICT };
  try {
    const pipelines = await provider.fetchPipelineList(projectPath, { ref: f.ref, sha: f.sha, iid: f.iid, limit: f.limit ?? PIPELINE_DEFAULT_LIMIT });
    return { ok: true, pipelines };
  } catch (err) {
    return { ok: false, error: forgeFailure(err, forge) };
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
export async function readCapped(res: Response, max = FORGE_GET_MAX_BYTES): Promise<{ bytes: Uint8Array; truncated: boolean }> {
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
function redirectRefusal(res: Response, forge: Forge = "gitlab"): string {
  const prefix = `gitlab_get does not follow redirects: ${forgeName(forge)} answered ${res.status}`;
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
