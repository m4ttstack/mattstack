/**
 * GitLab reads with no MR at their centre: labels, pipelines, and a GET-only
 * passthrough for facts no purpose-built tool returns. The daemon refuses the
 * credential-bearing paths; this layer only shapes input.
 */
import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { resolveRepoTarget } from "./mr-target.ts";
import { checkOptional, checkPositiveInts, err, ok, REPO_NAME_RULE, REPO_TARGET_PROPS, type McpToolDef } from "./shared.ts";

export interface ForgeReadDeps { command: typeof rtCommand }
const TIMEOUT_MS = 30_000;

export function forgeReadToolDefs(deps: ForgeReadDeps = { command: rtCommand }): McpToolDef[] {
  return [
    {
      name: "project_labels",
      description: `GitLab only. The project's labels (name, description, color); search narrows by name. Use it to check a label's exact spelling before applying it. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, search: { type: "string" } }, additionalProperties: false },
      shellForms: ["glab label list"],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "search", type: "string" }]);
        if (bad) return err(bad);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["project:labels"]["payload"] = { repoName: target.identity };
        const search = (input.search as string | undefined)?.trim();
        if (search) payload.search = search;
        const r = await deps.command<Commands["project:labels"]["data"]>("project:labels", { ...payload }, { timeoutMs: TIMEOUT_MS });
        return r.ok && r.data ? ok(r.data) : err(explainError(r.error ?? "label read failed"));
      },
    },
    {
      name: "pipeline_list",
      description: `GitLab only. Pipelines newest first, each with id, status, ref, sha, source, webUrl and createdAt: for a branch (ref), a commit (sha), or an MR (iid, which lists that MR's own pipelines; iid cannot be combined with ref or sha). Works for a branch with no MR. limit defaults to 20, maximum 100. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, ref: { type: "string" }, sha: { type: "string" }, iid: { type: "number" }, limit: { type: "number" } }, additionalProperties: false },
      shellForms: ["glab ci list"],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "ref", type: "string" }, { name: "sha", type: "string" }]) ?? checkPositiveInts(input, ["iid", "limit"]);
        if (bad) return err(bad);
        if (input.iid !== undefined && (typeof input.ref === "string" && input.ref.trim() || typeof input.sha === "string" && input.sha.trim())) return err('"iid" lists one MR\'s own pipelines and cannot be combined with "ref" or "sha"');
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["pipeline:list"]["payload"] = { repoName: target.identity };
        for (const name of ["ref", "sha"] as const) {
          const v = (input[name] as string | undefined)?.trim();
          if (v) payload[name] = v;
        }
        if (typeof input.iid === "number") payload.iid = input.iid;
        if (typeof input.limit === "number") payload.limit = input.limit;
        const r = await deps.command<Commands["pipeline:list"]["data"]>("pipeline:list", { ...payload }, { timeoutMs: TIMEOUT_MS });
        return r.ok && r.data ? ok(r.data) : err(explainError(r.error ?? "pipeline listing failed"));
      },
    },
    {
      name: "gitlab_get",
      description: `GitLab only. One read-only GET against GitLab's REST API, for a fact no other tool returns (an MR's commits or changes, a job's artifacts listing, an issue, a merged MR search). path is relative to the API root and :id stands for the target project, e.g. projects/:id/merge_requests/12/commits; pass query values in query, never in path. Returns {status, body, truncated, nextPage, totalPages}: body is parsed JSON, cut to text at 256 KiB (truncated: true), so page with page and perPage (maximum 100). GitLab decides access and its refusal comes back as its own text. Paths that can return credentials (variables, triggers, deploy_tokens, access_tokens, runners, hooks, secure_files, integrations, services, pipeline_schedules, terraform, application) and the query keys sudo, private_token, access_token, job_token and bearer_token are refused, any token value in a returned body is redacted, and a redirect is never followed (a 3xx answer is refused, naming only the host it points to). Prefer the purpose-built tool when one covers the read. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...REPO_TARGET_PROPS,
          path: { type: "string", description: "API path relative to the API root; :id is the target project." },
          query: { type: "object", description: "Query parameters as string, number or boolean values." },
          page: { type: "number" },
          perPage: { type: "number" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      shellForms: ["glab api"],
      async handler(input) {
        if (typeof input.path !== "string" || !input.path.trim()) return err('"path" is required');
        if (input.query !== undefined && (typeof input.query !== "object" || input.query === null || Array.isArray(input.query))) return err('"query" must be an object');
        const bad = checkPositiveInts(input, ["page", "perPage"]);
        if (bad) return err(bad);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["forge:get"]["payload"] = { repoName: target.identity, path: input.path };
        if (input.query !== undefined) payload.query = input.query as Record<string, string | number | boolean>;
        if (typeof input.page === "number") payload.page = input.page;
        if (typeof input.perPage === "number") payload.perPage = input.perPage;
        const r = await deps.command<Commands["forge:get"]["data"]>("forge:get", { ...payload }, { timeoutMs: TIMEOUT_MS });
        return r.ok && r.data ? ok(r.data) : err(explainError(r.error ?? "GitLab read failed"));
      },
    },
  ];
}
