/**
 * Agent-facing forge reads, returning the forge's own refusal text; none
 * reads or writes the daemon's project-MRs store. The list, label and
 * pipeline reads go through glance; forgeGet asks the repo's own forge and
 * missingMrReason asks GitLab, both through the provider's restRequest.
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
const CONTROL = /\p{Cc}/u;

type PlainPath = { ok: true; rest: string; decoded: string; segments: string[] } | { ok: false; error: string };

/** The checks both forges share; `expand` rewrites the raw path's prefix before it is decoded. */
function plainApiPath(path: unknown, expand: (rest: string) => string): PlainPath {
  if (typeof path !== "string" || !path.trim()) return { ok: false, error: '"path" is required' };
  let rest = path.trim();
  if (CONTROL.test(rest) || rest.includes("?") || rest.includes("#") || rest.includes("://") || rest.includes("\\")) {
    return { ok: false, error: '"path" must be a plain API path; pass query values in "query"' };
  }
  rest = expand(rest.replace(/^\/+/, ""));
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
  return { ok: true, rest, decoded, segments };
}

/** GitLab routes an optional format suffix (variables.json) to the same endpoint, so a suffixed word counts as the word. */
const namesWord = (segment: string | undefined, word: string): boolean => segment === word || (segment?.startsWith(`${word}.`) ?? false);

const SKELETON_STRIP = /[\p{White_Space}\p{Cf}\p{M}\p{Default_Ignorable_Code_Point}]/gu;

/** GitHub names an endpoint by its letters, so compatibility forms, marks, blanks and invisibles must not hide a word. */
export function wordSkeleton(segment: string): string {
  return dotSkeleton(segment).toUpperCase().toLowerCase();
}

export function dotSkeleton(segment: string): string {
  return segment.normalize("NFKD").replace(SKELETON_STRIP, "");
}

/** Per code point: NFKD of the whole string would also fold a legitimate trailing mark into a neighbour. */
export function foldsToSeparator(decoded: string): boolean {
  return [...decoded].some((ch) => {
    const folded = ch.normalize("NFKD");
    return folded !== ch && /[;%?#\\]/.test(folded);
  });
}

export function checkForgePath(path: unknown, projectPath: string): { ok: true; path: string } | { ok: false; error: string } {
  const plain = plainApiPath(path, (rest) => rest.replace(/^api\/v4\//, ""));
  if (!plain.ok) return plain;
  const { rest, segments } = plain;
  const refused = REFUSED_SEGMENTS.find((seg) => segments.some((s) => namesWord(s, seg)));
  if (refused) return { ok: false, error: `"path" names ${refused}, which can return credentials; gitlab_get refuses it` };
  return { ok: true, path: `/${rest.replace(/(^|\/):id(?=\/|$)/g, `$1${encodeURIComponent(projectPath)}`)}` };
}

/** A GET of any of these under a repo returns secret values redaction cannot recognise. */
export const GITHUB_REFUSED_SEGMENTS: readonly string[] = [
  "secrets", "variables", "hooks", "keys", "deploy_keys", "installations", "tokens", "runners", "registration-token",
  "remove-token", "environments", "codespaces", "dependabot", "actions/oidc", "autolinks", "invitations",
  "private-vulnerability-reporting", "secret-scanning", "organization-secrets", "organization-variables", "security-advisories",
];
/** Refused only as the first part of the skeleton window after the repo: the same word is a branch prefix and a repo name. */
export const GITHUB_REFUSED_ROUTES: readonly string[] = ["copilot"];
export const GITHUB_REFUSED_QUERY_KEYS: readonly string[] = ["access_token", "client_secret", "token"];
/** glance buffers a whole response before the cap runs, and a blob can be 100 MB. */
export const GITHUB_REFUSED_BLOBS = "git/blobs";
const BLOBS_REFUSAL = `"path" names ${GITHUB_REFUSED_BLOBS}, and a blob can be too large to read through gitlab_get; read the file with :repo/contents/<path> instead`;

export const githubWordRefusal = (word: string): string =>
  `gitlab_get refuses "path" because the path after the repo reads as "${word}", ignoring case, spaces and invisible characters. On GitHub that word names an endpoint that can return credentials, so it is refused in any segment after the repo, including branch and tag names. To read a file, use :repo/contents/<file path>, where file names are not checked.`;
export const githubRouteRefusal = (word: string): string =>
  `gitlab_get refuses "path" because the route right after the repo reads as "${word}", ignoring case, spaces and invisible characters. That GitHub endpoint can return credentials. A branch, file or repo named ${word} is fine.`;

/** NFKD can fold a slash or backslash into a segment, and a part that folds to a dot could split an entry. */
export function matchingWindow(segments: string[], from: number, to: number): { ok: true; parts: string[] } | { ok: false; error: string } {
  const parts = segments.slice(from, to).flatMap((s) => wordSkeleton(s).split(/[\/\\]/)).filter((p) => p !== "");
  if (parts.some((p) => p === "." || p === "..")) return { ok: false, error: '"path" must not contain dot segments' };
  return { ok: true, parts };
}

const windowEntryAt = (parts: string[], entry: string): number => {
  const words = entry.split("/");
  const last = words.length - 1;
  return parts.findIndex((_, i) => words.every((w, j) => (j === last ? namesWord(parts[i + j], w) : parts[i + j] === w)));
};

/** By position, never by value: on a repo named acme/contents, repos/acme/contents/hooks has no file path. */
const fileStartOf = (rest: string): number | null => {
  const raw = rest.split("/");
  return raw[3] === "contents" && raw.length > 4 ? 4 : null;
};

const PLAIN_REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function checkGithubForgePath(path: unknown, projectPath: string): { ok: true; path: string } | { ok: false; error: string } {
  // projectPath comes from the origin URL, and every rule below counts segments from it.
  if (!/^[^/]+\/[^/]+$/.test(projectPath)) return { ok: false, error: "gitlab_get cannot read this GitHub repo, because its path is not owner/name. Check the repo's origin remote." };
  const repoRoot = `repos/${projectPath}`;
  const plain = plainApiPath(path, (rest) => rest.replace(/^:repo(?=\/|$)/, () => repoRoot));
  if (!plain.ok) return plain;
  const { rest, decoded, segments } = plain;
  // glance sends the route as "GET <path>" and Octokit drops everything after the first space.
  if (/\s/.test(String(path))) return { ok: false, error: '"path" must not contain whitespace; send a space in a file name as %20' };
  // Octokit expands {name} in a route, to nothing when unset, after these checks ran.
  if (/[{}]/.test(decoded)) return { ok: false, error: '"path" must not contain { or }' };
  if (decoded.includes("\\")) return { ok: false, error: '"path" must be a plain API path; pass query values in "query"' };
  if (decoded.includes(";")) return { ok: false, error: '"path" must not contain ;' };
  if (foldsToSeparator(decoded)) return { ok: false, error: '"path" must be a plain API path; pass query values in "query"' };
  const lower = decoded.toLowerCase();
  const root = repoRoot.toLowerCase();
  if (lower !== root && !lower.startsWith(`${root}/`)) {
    return { ok: false, error: `"path" must sit under this repo on GitHub; start it with :repo/ (${repoRoot}/)` };
  }
  // GitHub may collapse "//", which would join a slash entry such as actions/oidc the checks below saw apart.
  if (segments.slice(0, -1).includes("")) return { ok: false, error: '"path" must not contain an empty segment (//)' };
  // The prefix check ignores case and decodes; the route GitHub picks is fixed by these raw bytes, which must equal the checked ones.
  const raw = rest.split("/");
  if (raw[0] !== "repos" || !PLAIN_REPO_SEGMENT.test(raw[1] ?? "") || !PLAIN_REPO_SEGMENT.test(raw[2] ?? "")) {
    return { ok: false, error: '"path" must name the repo as repos/<owner>/<name>, spelled plainly with no percent escapes. Start it with :repo/ instead.' };
  }
  const fileStart = fileStartOf(rest);
  // Words go unmatched in a file path, so a folded climb such as ..\uFF0Fhooks is the one thing that could leave the contents route.
  if (fileStart !== null && segments.slice(fileStart).some((seg) => dotSkeleton(seg).split(/[\/\\]/).some((p) => p === "." || p === ".."))) {
    return { ok: false, error: '"path" must not contain dot segments' };
  }
  const window = matchingWindow(segments, 3, fileStart ?? segments.length);
  if (!window.ok) return window;
  const { parts } = window;
  const refusedRoute = GITHUB_REFUSED_ROUTES.find((word) => namesWord(parts[0], word));
  if (refusedRoute) return { ok: false, error: githubRouteRefusal(refusedRoute) };
  const refusedWord = GITHUB_REFUSED_SEGMENTS.find((entry) => windowEntryAt(parts, entry) >= 0);
  if (refusedWord) return { ok: false, error: githubWordRefusal(refusedWord) };
  if (windowEntryAt(parts, GITHUB_REFUSED_BLOBS) >= 0) return { ok: false, error: BLOBS_REFUSAL };
  return { ok: true, path: `/${rest}` };
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

/** GitHub pages through the Link header; its next URL carries the page number. */
function linkNextPage(res: Response): number | null {
  const next = res.headers.get("link")?.match(/<([^>]*)>\s*;\s*rel="next"/i)?.[1];
  if (!next) return null;
  try {
    const n = Number(new URL(next).searchParams.get("page"));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

const headerSeconds = (res: Response, name: string): number | null => {
  const v = res.headers.get(name);
  if (v === null || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** glance hands a rate-limited 403 or 429 back as a Response that keeps GitHub's rate limit headers. */
async function githubFailure(res: Response): Promise<string> {
  const limited = (res.status === 403 || res.status === 429)
    && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.get("retry-after") !== null);
  if (!limited) return gitlabFailure(res, "github");
  await res.body?.cancel().catch(() => {});
  const after = headerSeconds(res, "retry-after");
  const reset = headerSeconds(res, "x-ratelimit-reset");
  const wait = after ?? (reset === null ? null : reset - Date.now() / 1000);
  return wait === null ? "GitHub rate limit hit on gitlab_get" : `GitHub rate limit hit on gitlab_get (retry in ${Math.max(0, Math.ceil(wait))}s)`;
}

/** A by-branch read that came back short must not read as "no PR on this branch". */
export function incompleteBranchRead(branch: string, projectPath: string, warning: { status?: number; message: string }): string {
  const reason = `${warning.status ?? ""} ${warning.message}`.trim().slice(0, 200);
  return `GitHub could not finish reading the pull request on ${branch} in ${projectPath} (${reason}); try again`;
}

export type ForgeGetInput = { path: unknown; query?: Record<string, string | number | boolean>; page?: number; perPage?: number };

export async function forgeGet(
  provider: RestProvider,
  projectPath: string,
  input: ForgeGetInput,
  forge: Forge = "gitlab",
): Promise<{ ok: true; data: ForgeGetData } | { ok: false; error: string }> {
  const github = forge === "github";
  const checked = github ? checkGithubForgePath(input.path, projectPath) : checkForgePath(input.path, projectPath);
  if (!checked.ok) return checked;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(input.query ?? {})) {
    if (github && GITHUB_REFUSED_QUERY_KEYS.includes(rackKey(k))) return { ok: false, error: `"query.${k}" can carry credentials; gitlab_get refuses it` };
    if (!github && REFUSED_QUERY_KEYS.includes(rackKey(k))) return { ok: false, error: `"query.${k}" can carry credentials or impersonation; gitlab_get refuses it` };
    query.set(k, String(v));
  }
  if (input.page !== undefined) query.set("page", String(input.page));
  if (input.perPage !== undefined) query.set("per_page", String(input.perPage));
  const qs = query.toString();
  try {
    const res = await provider.restRequest("GET", `${checked.path}${qs ? `?${qs}` : ""}`, undefined, "forge:get", { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, error: redirectRefusal(res, forge) };
    }
    if (!res.ok) return { ok: false, error: github ? await githubFailure(res) : await gitlabFailure(res) };
    const length = github ? headerNumber(res, "content-length") : null;
    if (length !== null && length > FORGE_GET_MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, error: `GitHub's answer is ${length} bytes, over gitlab_get's 256 KiB cap; ask for less with perPage or a narrower path` };
    }
    const { bytes, truncated } = await readCapped(res);
    const text = new TextDecoder().decode(bytes);
    let body: unknown = truncated ? scrubTokenText(text) : text;
    if (!truncated) {
      try { body = scrubTokens(JSON.parse(text)); } catch { /* not JSON: the text is the body */ }
    }
    const paging = github
      ? { nextPage: linkNextPage(res), totalPages: null }
      : { nextPage: headerNumber(res, "x-next-page"), totalPages: headerNumber(res, "x-total-pages") };
    return { ok: true, data: { status: res.status, body, truncated, ...paging } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
