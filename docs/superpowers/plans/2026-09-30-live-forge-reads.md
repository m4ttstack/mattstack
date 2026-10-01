# Live Forge Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every agent-facing GitLab read on the mattstack MCP server asks GitLab directly, and the skills stop treating a daemon cache miss as a dead end.

**Architecture:** New daemon commands in `lib/daemon/handlers/mr.ts` call the glance provider directly (the pattern `mr:by-target` already uses) and never touch the project-MRs store. Their logic lives in pure functions in a new `lib/daemon/forge-reads.ts`. The MCP read tools in `lib/mcp/` are rewired onto those commands, three purpose-built reads and one GET-only passthrough are added, and then the engine skills and the acme pack are edited to match.

**Tech Stack:** Bun, TypeScript, `bun:test`, the glance GitLab provider (`packages/glance`), rt-client command catalog (`packages/rt-client`), graphviz digraph skills under `plugins/mattstack`.

**Spec:** `docs/superpowers/specs/2026-09-30-live-forge-reads-design.md`

## Global Constraints

- No agent-facing read calls `project-mrs:read`, `store().read`, `store().upsert` or `store().findBySourceBranch`.
- A GitLab refusal reaches the agent as GitLab's own text, in the form `GitLab returned <status> <statusText>: <first 200 chars of body>`.
- `maxAgeMs` (on `mr_view`, `mr_list`, `mr_pipeline`) and `refresh` (on `mr_threads`) stay accepted and are ignored.
- `mr_list` default `limit` is 50, maximum 200.
- `gitlab_get` is GET only, caps the body at 256 KiB counted in bytes, refuses the path segments `variables`, `triggers`, `deploy_tokens`, `access_tokens`, `runners`, `hooks`, `secure_files`, `integrations`, `services`, `pipeline_schedules`, `terraform`, `application` (each also with a format suffix such as `variables.json`), refuses a path percent-encoded more than once and the query keys `sudo`, `private_token`, `access_token`, `job_token`, `bearer_token`, and replaces the value of any JSON key named `token` or ending in `_token` with `[redacted]`.
- The watch budget in `ci_watch` (`budgetMinutes`, `extendMinutes`) is not changed. This branch is already rebased on the `main` that carries it.
- No new daemon handler writes an MR back to the project-MRs store: the test helper's `writeback` throws.
- Run `bun test` from the repo root only (`bunfig.toml` is read from the cwd).
- After any change under `packages/rt-client/src`, run `bun run build` in `packages/rt-client`.
- Comments state constraints the code cannot show. No ticket ids, no decision history, no narration.
- No em dashes or en dashes anywhere, including commit messages.
- Every edit under `plugins/mattstack` loads `superpowers:writing-skills`, `mattstack:editing-skills` and `mattstack:process-digraphs` first. A subagent given a skill task is told to load the same three before editing.
- The strict lint stays: no skill text names a GitLab CLI command.
- In `acme-tools`, no mattstack ticket id appears in any file, commit or MR.
- Commit after each task. End each commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **GitLab refuses access (403) to an MR.** glance's `fetchSingleMR` swallows every error and returns null, so a refusal looks like "not found" unless the handler asks again over REST. Expect GitLab's status and text. Pinned in Task 1.
2. **An MR on a repo the daemon does not track for `project-mrs`.** `mr:by-branch` refuses ungranted repos today. The new live commands must work with no grant. Pinned in Tasks 1 and 3.
3. **A `gitlab_get` path that hides a refused segment** behind URL encoding (`projects/1/%76ariables`), a query string, or `..`. Expect a refusal. Pinned in Task 5.
4. **An unfiltered `mr_list` on a project with more open MRs than the limit.** Expect exactly `limit` rows and `truncated: true`, never a silent short list. Pinned in Task 2.
5. **`mr_job_trace` with a range past the end of the log, or a `grep` with no match.** Expect an empty `trace`, the real `totalLines`, and no error. Pinned in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/daemon/forge-reads.ts` (new) | Pure functions over a provider's `restRequest`: list MRs with filters, explain a missing MR, list labels, list pipelines, checked GET passthrough. |
| `lib/daemon/handlers/mr.ts` | Wires six new commands onto those functions and `fetchSingle`. |
| `packages/rt-client/src/commands.ts` | Types and catalog entries for the six commands. |
| `lib/mcp/mr-read-tools.ts` | `mr_view`, `mr_list`, `mr_for_branch`, `mr_threads`, `mr_pipeline`, `mr_job_trace` over the live commands. |
| `lib/mcp/trace-slice.ts` (new) | Pure trace slicing: tail, head, range, grep. |
| `lib/mcp/forge-read-tools.ts` (new) | `project_labels`, `pipeline_list`, `gitlab_get`. |
| `lib/mcp/stack-tool.ts` (new) | `branch_stack`. |
| `lib/stack-guard.ts` | Exports `stackMembershipOf`. |
| `lib/mcp/ci-tools.ts` | `ci_watch` reads the MR live. |
| `plugins/mattstack/attachments/**/SKILL.md` | Graph and prose edits. |

---

# Phase A: rt tools

### Task 1: `mr:get`, one MR straight from GitLab

**Files:**
- Create: `lib/daemon/forge-reads.ts`
- Create: `lib/daemon/__tests__/forge-reads.test.ts`
- Modify: `lib/daemon/handlers/mr.ts` (handler map type near line 155, new handler after `"mr:by-target"`)
- Modify: `packages/rt-client/src/commands.ts` (types near line 87, `Commands` near line 874, `COMMAND_NAMES` near line 1118)
- Test: `lib/daemon/__tests__/mr-ci-verbs.test.ts`

**Interfaces:**
- Produces: `type RestProvider = { restRequest(method: string, path: string, body?: unknown, op?: string): Promise<Response> }`, `gitlabFailure(res: Response): Promise<string>`, `projectApi(projectPath: string): string`, `missingMrReason(provider: RestProvider, projectPath: string, iid: number): Promise<string>`, all exported from `lib/daemon/forge-reads.ts`.
- Produces: daemon command `"mr:get"` with payload `{ repoName: string; iid: number }` and data `MrGetData = { mr: PullRequest; fetchedAt: number }`.

- [ ] **Step 1: Write the failing tests**

Create `lib/daemon/__tests__/forge-reads.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { gitlabFailure, missingMrReason, projectApi, type RestProvider } from "../forge-reads.ts";

export function restFake(responses: Array<Response | Error>): { provider: RestProvider; paths: string[] } {
  const paths: string[] = [];
  let i = 0;
  const provider: RestProvider = {
    restRequest: async (_method, path) => {
      paths.push(path);
      const next = responses[i++];
      if (next === undefined) throw new Error(`no fake response for ${path}`);
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { provider, paths };
}

describe("forge-reads basics", () => {
  test("projectApi encodes the project path", () => {
    expect(projectApi("grp/sub/proj")).toBe("/projects/grp%2Fsub%2Fproj");
  });

  test("gitlabFailure carries status, status text and a body excerpt", async () => {
    const res = new Response('{"message":"403 Forbidden"}', { status: 403, statusText: "Forbidden" });
    expect(await gitlabFailure(res)).toBe('GitLab returned 403 Forbidden: {"message":"403 Forbidden"}');
  });

  test("missingMrReason reports GitLab's refusal", async () => {
    const { provider, paths } = restFake([new Response("nope", { status: 403, statusText: "Forbidden" })]);
    expect(await missingMrReason(provider, "grp/proj", 7)).toBe("GitLab returned 403 Forbidden: nope");
    expect(paths).toEqual(["/projects/grp%2Fproj/merge_requests/7"]);
  });

  test("missingMrReason reports a 404 as GitLab's own answer", async () => {
    const { provider } = restFake([new Response("", { status: 404, statusText: "Not Found" })]);
    expect(await missingMrReason(provider, "grp/proj", 7)).toBe("GitLab returned 404 Not Found");
  });

  test("missingMrReason says so when REST finds the MR the detail query lost", async () => {
    const { provider } = restFake([new Response("{}", { status: 200 })]);
    expect(await missingMrReason(provider, "grp/proj", 7)).toContain("detail query failed");
  });
});
```

In `lib/daemon/__tests__/mr-ci-verbs.test.ts`, make the shared `handlers` helper fail any store write-back, so every live-read test in this plan proves the handler leaves the project-MRs store alone:

```ts
function handlers(provider: Record<string, unknown>) {
  return createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({ provider, projectPath: "grp/proj" }),
    writeback: () => { throw new Error("a live read must not write the project-MRs store"); },
  });
}
```

Then append:

```ts
describe("mr:get", () => {
  const mr = { iid: 7, state: "merged", author: { username: "someone-else" } };

  test("returns the provider's MR for any author and state, with no cache grant", async () => {
    const h = handlers({ fetchSingleMR: async (_p: string, iid: number) => (iid === 7 ? mr : null) });
    const r = await h["mr:get"]!({ repoName: REPO, iid: 7 });
    expect(r).toMatchObject({ ok: true, data: { mr } });
    expect(typeof (r as { data: { fetchedAt: number } }).data.fetchedAt).toBe("number");
    const closed = { ...mr, iid: 8, state: "closed" };
    expect(await handlers({ fetchSingleMR: async () => closed })["mr:get"]!({ repoName: REPO, iid: 8 })).toMatchObject({ ok: true, data: { mr: closed } });
  });

  test("a null fetch asks GitLab why and returns its text", async () => {
    const h = handlers({
      fetchSingleMR: async () => null,
      restRequest: async () => new Response("no access", { status: 403, statusText: "Forbidden" }),
    });
    expect(await h["mr:get"]!({ repoName: REPO, iid: 7 })).toEqual({ ok: false, error: "GitLab returned 403 Forbidden: no access" });
  });

  test("validates iid and the repo identity", async () => {
    const h = handlers({ fetchSingleMR: async () => mr });
    expect(await h["mr:get"]!({ repoName: REPO })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h["mr:get"]!({ repoName: REPO, iid: 0 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await h["mr:get"]!({ repoName: "proj", iid: 7 })).toEqual({ ok: false, error: "repo-unknown" });
  });

  test("refuses a provider without fetchSingleMR", async () => {
    const r = await handlers({})["mr:get"]!({ repoName: REPO, iid: 7 });
    expect(String((r as { error: string }).error)).toContain("unsupported");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: FAIL, `Cannot find module "../forge-reads.ts"` and `h["mr:get"] is not a function`.

- [ ] **Step 3: Implement**

Create `lib/daemon/forge-reads.ts`:

```ts
/**
 * Agent-facing GitLab reads. Every function here asks GitLab through the
 * provider's restRequest and returns GitLab's own refusal text; none reads
 * or writes the daemon's project-MRs store.
 */

export type RestProvider = {
  restRequest: (method: string, path: string, body?: unknown, op?: string) => Promise<Response>;
};

export function projectApi(projectPath: string): string {
  return `/projects/${encodeURIComponent(projectPath)}`;
}

export async function gitlabFailure(res: Response): Promise<string> {
  const detail = (await res.text().catch(() => "")).slice(0, 200);
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
```

In `packages/rt-client/src/commands.ts`, after `MrByTargetData`:

```ts
/** One MR fetched from GitLab on demand: any author, any state. Never from the open-MR cache. */
export interface MrGetData {
  mr: PullRequest;
  fetchedAt: number;
}
```

In the `Commands` interface after `"mr:by-target"`:

```ts
  "mr:get": { payload: { repoName: string; iid: number }; data: MrGetData };
```

In `COMMAND_NAMES` after `"mr:by-target",`:

```ts
  "mr:get",
```

In `lib/daemon/handlers/mr.ts`, add the import:

```ts
import { missingMrReason } from "../forge-reads.ts";
```

add to the handler map type after the `"mr:by-target"` line:

```ts
  & { "mr:get": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:get">> }
```

and add the handler after `"mr:by-target"`:

```ts
    "mr:get": async (payload) => {
      const p = payload as { iid?: unknown } | undefined;
      if (typeof p?.iid !== "number") return { ok: false, error: "missing repoName/iid" };
      if (!(Number.isInteger(p.iid) && p.iid > 0)) return { ok: false, error: '"iid" must be a positive integer' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const { provider, projectPath } = await contextFor(decoded.repo);
        if (typeof provider.fetchSingleMR !== "function") return { ok: false, error: "unsupported: mr:get needs a GitLab repo" };
        const mr = await fetchSingle(provider, projectPath, p.iid);
        if (mr) return { ok: true, data: { mr, fetchedAt: Date.now() } };
        if (typeof provider.restRequest !== "function") return { ok: false, error: `GitLab returned no MR !${p.iid} in ${projectPath}` };
        return { ok: false, error: await missingMrReason(provider, projectPath, p.iid) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `(cd packages/rt-client && bun run build) && bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/forge-reads.ts lib/daemon/__tests__/forge-reads.test.ts lib/daemon/handlers/mr.ts lib/daemon/__tests__/mr-ci-verbs.test.ts packages/rt-client/src/commands.ts
git commit -m "daemon: mr:get fetches one MR from GitLab, any author or state"
```

---

### Task 2: `mr:list-live`, the project's MRs with filters

**Files:**
- Modify: `lib/daemon/forge-reads.ts`
- Modify: `lib/daemon/handlers/mr.ts` (move `RestMrRow` and `targetSummary` out, add handler)
- Modify: `packages/rt-client/src/commands.ts`
- Test: `lib/daemon/__tests__/forge-reads.test.ts`, `lib/daemon/__tests__/mr-ci-verbs.test.ts`

**Interfaces:**
- Consumes: `RestProvider`, `projectApi`, `gitlabFailure` from Task 1.
- Produces: `MrListLiveFilters = { author?: string; sourceBranch?: string; targetBranch?: string; state?: MrListState; search?: string; limit?: number }`, `MrListLiveData = { mrs: MrTargetSummary[]; truncated: boolean }` in rt-client.
- Produces: `listMrsLive(provider: RestProvider, projectPath: string, filters: MrListLiveFilters): Promise<{ ok: true; mrs: MrTargetSummary[]; truncated: boolean } | { ok: false; error: string }>`, `LIST_DEFAULT_LIMIT = 50`, `LIST_MAX_LIMIT = 200`, and the moved `targetSummary(row: RestMrRow): MrTargetSummary`, from `lib/daemon/forge-reads.ts`.
- Produces: daemon command `"mr:list-live"` with payload `{ repoName: string } & MrListLiveFilters`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/daemon/__tests__/forge-reads.test.ts` (add `listMrsLive` to the import):

```ts
const row = (iid: number) => ({
  iid, title: `t${iid}`, state: "opened", draft: false, source_branch: `b${iid}`, target_branch: "main",
  author: { username: "alice" }, web_url: `https://gitlab.com/grp/proj/-/merge_requests/${iid}`, detailed_merge_status: "mergeable",
});
const page = (rows: unknown[], next: string) => new Response(JSON.stringify(rows), { status: 200, headers: { "x-next-page": next } });

describe("listMrsLive", () => {
  test("sends every filter and orders by last update", async () => {
    const { provider, paths } = restFake([page([row(1)], "")]);
    const r = await listMrsLive(provider, "grp/proj", { author: "bob", sourceBranch: "feat", targetBranch: "main", state: "merged", search: "refund" });
    expect(r).toMatchObject({ ok: true, truncated: false });
    const query = new URLSearchParams(paths[0]!.split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({
      state: "merged", order_by: "updated_at", sort: "desc", scope: "all", author_username: "bob",
      source_branch: "feat", target_branch: "main", search: "refund", per_page: "100", page: "1",
    });
  });

  test("author me asks GitLab for the token user's own MRs", async () => {
    const { provider, paths } = restFake([page([], "")]);
    await listMrsLive(provider, "grp/proj", { author: "me" });
    const query = new URLSearchParams(paths[0]!.split("?")[1]);
    expect(query.get("scope")).toBe("created_by_me");
    expect(query.has("author_username")).toBe(false);
  });

  test("an unfiltered call past the limit returns exactly limit rows and truncated", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => row(i + 1));
    const { provider } = restFake([page(hundred, "2")]);
    const r = await listMrsLive(provider, "grp/proj", { limit: 50 });
    expect(r.ok && r.mrs.length).toBe(50);
    expect(r.ok && r.truncated).toBe(true);
  });

  test("walks pages until the limit is covered", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => row(i + 1));
    const { provider, paths } = restFake([page(hundred, "2"), page([row(101)], "")]);
    const r = await listMrsLive(provider, "grp/proj", { limit: 150 });
    expect(r.ok && r.mrs.length).toBe(101);
    expect(r.ok && r.truncated).toBe(false);
    expect(paths.length).toBe(2);
  });

  test("a GitLab refusal is the error", async () => {
    const { provider } = restFake([new Response("nope", { status: 401, statusText: "Unauthorized" })]);
    expect(await listMrsLive(provider, "grp/proj", {})).toEqual({ ok: false, error: "GitLab returned 401 Unauthorized: nope" });
  });
});
```

Append to `lib/daemon/__tests__/mr-ci-verbs.test.ts`:

```ts
describe("mr:list-live", () => {
  test("passes filters through and validates them", async () => {
    const seen: string[] = [];
    const provider = { restRequest: async (_m: string, path: string) => { seen.push(path); return new Response("[]", { status: 200, headers: { "x-next-page": "" } }); } };
    const h = handlers(provider);
    expect(await h["mr:list-live"]!({ repoName: REPO, search: "refund" })).toEqual({ ok: true, data: { mrs: [], truncated: false } });
    expect(seen[0]).toContain("search=refund");
    expect(await h["mr:list-live"]!({ repoName: REPO, state: "weird" })).toMatchObject({ ok: false });
    expect(await h["mr:list-live"]!({ repoName: REPO, limit: 201 })).toEqual({ ok: false, error: '"limit" must be an integer from 1 to 200' });
    expect(await h["mr:list-live"]!({ repoName: REPO, author: 5 })).toEqual({ ok: false, error: '"author" must be a string' });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: FAIL, `listMrsLive` is not exported and `h["mr:list-live"]` is not a function.

- [ ] **Step 3: Implement**

In `packages/rt-client/src/commands.ts` after `MrGetData`:

```ts
export interface MrListLiveFilters {
  /** A username, or "me" for the token's own user. */
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  state?: MrListState;
  /** Matched by GitLab against title and description. */
  search?: string;
  limit?: number;
}

/** `truncated` is true when GitLab held more rows than the limit returned. */
export interface MrListLiveData {
  mrs: MrTargetSummary[];
  truncated: boolean;
}
```

`Commands` entry and `COMMAND_NAMES` entry:

```ts
  "mr:list-live": { payload: { repoName: string } & MrListLiveFilters; data: MrListLiveData };
```
```ts
  "mr:list-live",
```

Move the `RestMrRow` interface and the `targetSummary` function from `lib/daemon/handlers/mr.ts` into `lib/daemon/forge-reads.ts` unchanged, export both, and import them back into `mr.ts` (`listMrsByTarget` still uses them). Then add to `lib/daemon/forge-reads.ts`:

```ts
import type { MrListLiveFilters, MrTargetSummary } from "../../packages/rt-client/src/index.ts";

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
      if (next === null ? rows.length < LIST_PER_PAGE : next === "") return { ok: true, mrs: mrs.slice(0, limit), truncated: mrs.length > limit };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  return { ok: true, mrs: mrs.slice(0, limit), truncated: true };
}
```

In `lib/daemon/handlers/mr.ts` extend the import to `import { LIST_MAX_LIMIT, listMrsLive, missingMrReason, targetSummary, type RestMrRow } from "../forge-reads.ts";`, add the handler map type line for `"mr:list-live"`, and add the handler:

```ts
    "mr:list-live": async (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      for (const name of ["author", "sourceBranch", "targetBranch", "search"] as const) {
        if (p[name] !== undefined && typeof p[name] !== "string") return { ok: false, error: `"${name}" must be a string` };
      }
      const state = p.state ?? "opened";
      if (!MR_LIST_STATES.includes(state as MrListState)) return { ok: false, error: `"state" must be one of ${MR_LIST_STATES.join(", ")}` };
      if (p.limit !== undefined && !(typeof p.limit === "number" && Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= LIST_MAX_LIMIT)) {
        return { ok: false, error: `"limit" must be an integer from 1 to ${LIST_MAX_LIMIT}` };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const { provider, projectPath } = await contextFor(decoded.repo);
        if (typeof provider.restRequest !== "function") return { ok: false, error: "unsupported: mr:list-live needs a GitLab repo" };
        const text = (name: string) => (typeof p[name] === "string" && (p[name] as string).trim() ? (p[name] as string).trim() : undefined);
        const listed = await listMrsLive(provider, projectPath, {
          author: text("author"), sourceBranch: text("sourceBranch"), targetBranch: text("targetBranch"), search: text("search"),
          state: state as MrListState, limit: p.limit as number | undefined,
        });
        return listed.ok ? { ok: true, data: { mrs: listed.mrs, truncated: listed.truncated } } : { ok: false, error: listed.error };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 4: Run and confirm pass**

Run: `(cd packages/rt-client && bun run build) && bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: PASS, including the existing `mr:by-target` tests.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/forge-reads.ts lib/daemon/__tests__/forge-reads.test.ts lib/daemon/handlers/mr.ts lib/daemon/__tests__/mr-ci-verbs.test.ts packages/rt-client/src/commands.ts
git commit -m "daemon: mr:list-live lists a project's MRs from GitLab with filters and a limit"
```

---

### Task 3: `mr:live-by-branch`, the open MR for each branch

**Files:**
- Modify: `lib/daemon/handlers/mr.ts`
- Modify: `packages/rt-client/src/commands.ts`
- Test: `lib/daemon/__tests__/mr-ci-verbs.test.ts`

**Interfaces:**
- Consumes: `listMrsLive`, `fetchSingle`, `missingMrReason`.
- Produces: daemon command `"mr:live-by-branch"` with payload `{ repoName: string; branches: string[] }` and data `MrLiveByBranchData = { byBranch: Record<string, PullRequest | null> }`. A null means GitLab has no open MR with that source branch.

- [ ] **Step 1: Write the failing test**

Append to `lib/daemon/__tests__/mr-ci-verbs.test.ts`:

```ts
describe("mr:live-by-branch", () => {
  const listing = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200, headers: { "x-next-page": "" } });

  test("finds the open MR for a branch by any author and fetches it in full", async () => {
    const provider = {
      restRequest: async (_m: string, path: string) =>
        listing(path.includes("source_branch=feat") ? [{ iid: 9, title: "t", state: "opened", source_branch: "feat", target_branch: "main" }] : []),
      fetchSingleMR: async (_p: string, iid: number) => ({ iid, sourceBranch: "feat" }),
    };
    const r = await handlers(provider)["mr:live-by-branch"]!({ repoName: REPO, branches: ["feat", "none"] });
    expect(r).toEqual({ ok: true, data: { byBranch: { feat: { iid: 9, sourceBranch: "feat" }, none: null } } });
  });

  test("a GitLab refusal fails the whole call, never a null", async () => {
    const provider = { restRequest: async () => new Response("no", { status: 403, statusText: "Forbidden" }), fetchSingleMR: async () => null };
    expect(await handlers(provider)["mr:live-by-branch"]!({ repoName: REPO, branches: ["feat"] })).toEqual({ ok: false, error: "GitLab returned 403 Forbidden: no" });
  });

  test("validates branches", async () => {
    const h = handlers({ restRequest: async () => listing([]), fetchSingleMR: async () => null });
    expect(await h["mr:live-by-branch"]!({ repoName: REPO, branches: [] })).toEqual({ ok: false, error: '"branches" must name at least one branch' });
    expect(await h["mr:live-by-branch"]!({ repoName: REPO, branches: ["a", 3] })).toEqual({ ok: false, error: '"branches" must name at least one branch' });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: FAIL, `h["mr:live-by-branch"] is not a function`.

- [ ] **Step 3: Implement**

`packages/rt-client/src/commands.ts`:

```ts
/** A null entry means GitLab has no open MR with that source branch. */
export interface MrLiveByBranchData {
  byBranch: Record<string, PullRequest | null>;
}
```
```ts
  "mr:live-by-branch": { payload: { repoName: string; branches: string[] }; data: MrLiveByBranchData };
```
and `"mr:live-by-branch",` in `COMMAND_NAMES`.

`lib/daemon/handlers/mr.ts`, handler map type line plus:

```ts
    "mr:live-by-branch": async (payload) => {
      const p = payload as { branches?: unknown } | undefined;
      const branches = p?.branches;
      if (!Array.isArray(branches) || branches.length === 0 || branches.some((b) => typeof b !== "string" || !b.trim())) {
        return { ok: false, error: '"branches" must name at least one branch' };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const { provider, projectPath } = await contextFor(decoded.repo);
        if (typeof provider.restRequest !== "function" || typeof provider.fetchSingleMR !== "function") {
          return { ok: false, error: "unsupported: mr:live-by-branch needs a GitLab repo" };
        }
        const byBranch: Record<string, PullRequest | null> = {};
        for (const branch of branches as string[]) {
          const listed = await listMrsLive(provider, projectPath, { sourceBranch: branch.trim(), state: "opened", limit: 1 });
          if (!listed.ok) return { ok: false, error: listed.error };
          const hit = listed.mrs[0];
          if (!hit) { byBranch[branch] = null; continue; }
          const mr = await fetchSingle(provider, projectPath, hit.iid);
          if (!mr) return { ok: false, error: await missingMrReason(provider, projectPath, hit.iid) };
          byBranch[branch] = mr;
        }
        return { ok: true, data: { byBranch } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 4: Run and confirm pass**

Run: `(cd packages/rt-client && bun run build) && bun test lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/mr.ts lib/daemon/__tests__/mr-ci-verbs.test.ts packages/rt-client/src/commands.ts
git commit -m "daemon: mr:live-by-branch reads each branch's open MR from GitLab"
```

---

### Task 4: `project:labels` and `pipeline:list`

**Files:**
- Modify: `lib/daemon/forge-reads.ts`, `lib/daemon/handlers/mr.ts`, `packages/rt-client/src/commands.ts`
- Test: `lib/daemon/__tests__/forge-reads.test.ts`

**Interfaces:**
- Produces: `ProjectLabel = { name: string; description: string | null; color: string | null }`, `PipelineListRow = { id: number; status: string; ref: string | null; sha: string | null; source: string | null; webUrl: string | null; createdAt: string | null }` in rt-client.
- Produces: `listLabels(provider, projectPath, search?): Promise<{ ok: true; labels: ProjectLabel[] } | { ok: false; error: string }>` and `listPipelines(provider, projectPath, f: { ref?: string; sha?: string; iid?: number; limit?: number }): Promise<{ ok: true; pipelines: PipelineListRow[] } | { ok: false; error: string }>`.
- Produces: daemon commands `"project:labels"` (payload `{ repoName: string; search?: string }`, data `{ labels: ProjectLabel[] }`) and `"pipeline:list"` (payload `{ repoName: string; ref?: string; sha?: string; iid?: number; limit?: number }`, data `{ pipelines: PipelineListRow[] }`).

- [ ] **Step 1: Write the failing tests**

Append to `lib/daemon/__tests__/forge-reads.test.ts` (add `listLabels`, `listPipelines` to the import):

```ts
describe("listLabels", () => {
  test("returns name, description and color, passing search", async () => {
    const { provider, paths } = restFake([page([{ name: "preview-acme", description: null, color: "#fff", id: 3 }], "")]);
    expect(await listLabels(provider, "grp/proj", "preview")).toEqual({ ok: true, labels: [{ name: "preview-acme", description: null, color: "#fff" }] });
    expect(paths[0]).toBe("/projects/grp%2Fproj/labels?per_page=100&page=1&search=preview");
  });
  test("a refusal is the error", async () => {
    const { provider } = restFake([new Response("", { status: 404, statusText: "Not Found" })]);
    expect(await listLabels(provider, "grp/proj")).toEqual({ ok: false, error: "GitLab returned 404 Not Found" });
  });
});

describe("listPipelines", () => {
  const p = { id: 5, status: "failed", ref: "feat", sha: "abc", source: "push", web_url: "https://x/5", created_at: "2026-09-30T00:00:00Z" };
  test("lists a branch's pipelines newest first, with no MR needed", async () => {
    const { provider, paths } = restFake([page([p], "")]);
    expect(await listPipelines(provider, "grp/proj", { ref: "feat" })).toEqual({
      ok: true, pipelines: [{ id: 5, status: "failed", ref: "feat", sha: "abc", source: "push", webUrl: "https://x/5", createdAt: "2026-09-30T00:00:00Z" }],
    });
    expect(paths[0]).toBe("/projects/grp%2Fproj/pipelines?per_page=20&order_by=id&sort=desc&ref=feat");
  });
  test("an MR iid reads that MR's pipelines", async () => {
    const { provider, paths } = restFake([page([p], "")]);
    await listPipelines(provider, "grp/proj", { iid: 12, limit: 5 });
    expect(paths[0]).toBe("/projects/grp%2Fproj/merge_requests/12/pipelines?per_page=5");
  });
});
```

Append to `lib/daemon/__tests__/mr-ci-verbs.test.ts`:

```ts
describe("project:labels and pipeline:list", () => {
  const empty = () => new Response("[]", { status: 200, headers: { "x-next-page": "" } });
  test("project:labels returns the listing and validates search", async () => {
    const h = handlers({ restRequest: async () => empty() });
    expect(await h["project:labels"]!({ repoName: REPO, search: "preview" })).toEqual({ ok: true, data: { labels: [] } });
    expect(await h["project:labels"]!({ repoName: REPO, search: 3 })).toEqual({ ok: false, error: '"search" must be a string' });
    expect(await h["project:labels"]!({ repoName: "proj" })).toEqual({ ok: false, error: "repo-unknown" });
  });
  test("pipeline:list returns the listing and validates iid and limit", async () => {
    const h = handlers({ restRequest: async () => empty() });
    expect(await h["pipeline:list"]!({ repoName: REPO, ref: "feat" })).toEqual({ ok: true, data: { pipelines: [] } });
    expect(await h["pipeline:list"]!({ repoName: REPO, iid: 0 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await h["pipeline:list"]!({ repoName: REPO, limit: 101 })).toEqual({ ok: false, error: '"limit" must be an integer from 1 to 100' });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: FAIL, `listLabels` is not exported and `h["project:labels"]` is not a function.

- [ ] **Step 3: Implement**

`packages/rt-client/src/commands.ts`:

```ts
export interface ProjectLabel { name: string; description: string | null; color: string | null }
export interface PipelineListRow { id: number; status: string; ref: string | null; sha: string | null; source: string | null; webUrl: string | null; createdAt: string | null }
```
```ts
  "project:labels": { payload: { repoName: string; search?: string }; data: { labels: ProjectLabel[] } };
  "pipeline:list": { payload: { repoName: string; ref?: string; sha?: string; iid?: number; limit?: number }; data: { pipelines: PipelineListRow[] } };
```
and both names in `COMMAND_NAMES`.

`lib/daemon/forge-reads.ts`:

```ts
import type { PipelineListRow, ProjectLabel } from "../../packages/rt-client/src/index.ts";

const LABEL_MAX_PAGES = 10;
export const PIPELINE_DEFAULT_LIMIT = 20;
export const PIPELINE_MAX_LIMIT = 100;

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
```

`lib/daemon/handlers/mr.ts`: add `listLabels`, `listPipelines` and `PIPELINE_MAX_LIMIT` to the `../forge-reads.ts` import, add the two handler map type lines, and add:

```ts
    "project:labels": async (payload) => {
      const p = payload as { search?: unknown } | undefined;
      if (p?.search !== undefined && typeof p.search !== "string") return { ok: false, error: '"search" must be a string' };
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const { provider, projectPath } = await contextFor(decoded.repo);
        if (typeof provider.restRequest !== "function") return { ok: false, error: "unsupported: project:labels needs a GitLab repo" };
        const listed = await listLabels(provider, projectPath, p?.search?.trim() || undefined);
        return listed.ok ? { ok: true, data: { labels: listed.labels } } : { ok: false, error: listed.error };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "pipeline:list": async (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      for (const name of ["ref", "sha"] as const) {
        if (p[name] !== undefined && typeof p[name] !== "string") return { ok: false, error: `"${name}" must be a string` };
      }
      if (p.iid !== undefined && !(typeof p.iid === "number" && Number.isInteger(p.iid) && p.iid > 0)) return { ok: false, error: '"iid" must be a positive integer' };
      if (p.limit !== undefined && !(typeof p.limit === "number" && Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= PIPELINE_MAX_LIMIT)) {
        return { ok: false, error: `"limit" must be an integer from 1 to ${PIPELINE_MAX_LIMIT}` };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const { provider, projectPath } = await contextFor(decoded.repo);
        if (typeof provider.restRequest !== "function") return { ok: false, error: "unsupported: pipeline:list needs a GitLab repo" };
        const listed = await listPipelines(provider, projectPath, {
          ref: p.ref as string | undefined, sha: p.sha as string | undefined, iid: p.iid as number | undefined, limit: p.limit as number | undefined,
        });
        return listed.ok ? { ok: true, data: { pipelines: listed.pipelines } } : { ok: false, error: listed.error };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 4: Run and confirm pass**

Run: `(cd packages/rt-client && bun run build) && bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/forge-reads.ts lib/daemon/__tests__/forge-reads.test.ts lib/daemon/handlers/mr.ts lib/daemon/__tests__/mr-ci-verbs.test.ts packages/rt-client/src/commands.ts
git commit -m "daemon: project:labels and pipeline:list read GitLab directly"
```

---

### Task 5: `forge:get`, the checked GET passthrough

**Files:**
- Modify: `lib/daemon/forge-reads.ts`, `lib/daemon/handlers/mr.ts`, `packages/rt-client/src/commands.ts`
- Test: `lib/daemon/__tests__/forge-reads.test.ts`

**Interfaces:**
- Produces: `REFUSED_SEGMENTS: readonly string[]`, `FORGE_GET_MAX_BYTES = 262144`, `checkForgePath(path: unknown, projectPath: string): { ok: true; path: string } | { ok: false; error: string }`, `forgeGet(provider, projectPath, input: { path: unknown; query?: Record<string, string | number | boolean>; page?: number; perPage?: number }): Promise<{ ok: true; data: ForgeGetData } | { ok: false; error: string }>`.
- Produces: `ForgeGetData = { status: number; body: unknown; truncated: boolean; nextPage: number | null; totalPages: number | null }` in rt-client, and daemon command `"forge:get"` with payload `{ repoName: string; path: string; query?: Record<string, string | number | boolean>; page?: number; perPage?: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/daemon/__tests__/forge-reads.test.ts` (add `checkForgePath`, `forgeGet`, `REFUSED_SEGMENTS`, `FORGE_GET_MAX_BYTES` to the import):

```ts
describe("checkForgePath", () => {
  test("replaces :id with the encoded project and drops a leading slash or api prefix", () => {
    expect(checkForgePath("projects/:id/merge_requests/12/commits", "grp/proj")).toEqual({ ok: true, path: "/projects/grp%2Fproj/merge_requests/12/commits" });
    expect(checkForgePath("/api/v4/projects/:id/labels", "grp/proj")).toEqual({ ok: true, path: "/projects/grp%2Fproj/labels" });
  });

  test("refuses every credential segment at any depth and in any case", () => {
    for (const seg of REFUSED_SEGMENTS) {
      for (const path of [`projects/:id/${seg}`, `groups/9/${seg}/3`, `projects/:id/${seg.toUpperCase()}`]) {
        const r = checkForgePath(path, "grp/proj");
        expect(r, path).toEqual({ ok: false, error: `"path" names ${seg}, which can return credentials; gitlab_get refuses it` });
      }
    }
  });

  test("refuses a segment hidden by URL encoding", () => {
    expect(checkForgePath("projects/1/%76ariables", "grp/proj")).toMatchObject({ ok: false });
    expect(checkForgePath("projects/1%2Fvariables", "grp/proj")).toMatchObject({ ok: false });
  });

  test("refuses a query string, a fragment, dot segments, a scheme and control characters", () => {
    for (const path of ["projects/:id/labels?x=1", "projects/:id#a", "projects/:id/../variables", "https://evil.example/x", "projects/:id/\nlabels", "", 5]) {
      expect(checkForgePath(path, "grp/proj"), String(path)).toMatchObject({ ok: false });
    }
  });
});

describe("forgeGet", () => {
  test("sends one GET and returns parsed JSON with paging", async () => {
    const methods: string[] = [];
    const provider: RestProvider = {
      restRequest: async (method, path) => {
        methods.push(`${method} ${path}`);
        return new Response('[{"id":1}]', { status: 200, headers: { "x-next-page": "2", "x-total-pages": "4" } });
      },
    };
    const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/merge_requests/12/commits", query: { order: "asc" }, page: 1, perPage: 20 });
    expect(r).toEqual({ ok: true, data: { status: 200, body: [{ id: 1 }], truncated: false, nextPage: 2, totalPages: 4 } });
    expect(methods).toEqual(["GET /projects/grp%2Fproj/merge_requests/12/commits?order=asc&page=1&per_page=20"]);
  });

  test("an oversized body comes back as truncated text", async () => {
    const { provider } = restFake([new Response("x".repeat(FORGE_GET_MAX_BYTES + 10), { status: 200 })]);
    const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/repository/tree" });
    expect(r.ok && r.data.truncated).toBe(true);
    expect(r.ok && (r.data.body as string).length).toBe(FORGE_GET_MAX_BYTES);
  });

  test("token values are redacted in parsed and in cut bodies", async () => {
    const project = { id: 1, runners_token: "glrt-abc", nested: [{ token: "t0p", name: "keep" }], token_count: 3 };
    const parsed = restFake([new Response(JSON.stringify(project), { status: 200 })]);
    const r = await forgeGet(parsed.provider, "grp/proj", { path: "projects/:id" });
    expect(r.ok && r.data.body).toEqual({ id: 1, runners_token: "[redacted]", nested: [{ token: "[redacted]", name: "keep" }], token_count: 3 });
    const big = `{"runners_token":"glrt-abc","pad":"${"x".repeat(FORGE_GET_MAX_BYTES)}"}`;
    const cut = restFake([new Response(big, { status: 200 })]);
    const c = await forgeGet(cut.provider, "grp/proj", { path: "projects/:id" });
    expect(c.ok && (c.data.body as string).startsWith('{"runners_token":"[redacted]"')).toBe(true);
    const straddle = `{"pad":"${"x".repeat(FORGE_GET_MAX_BYTES - 30)}","runners_token":"glrt-secret-value-past-the-cut"}`;
    const s = await forgeGet(restFake([new Response(straddle, { status: 200 })]).provider, "grp/proj", { path: "projects/:id" });
    expect(s.ok && (s.data.body as string).includes("glrt-")).toBe(false);
  });

  test("a refused path never reaches GitLab", async () => {
    const { provider, paths } = restFake([]);
    expect(await forgeGet(provider, "grp/proj", { path: "projects/:id/variables" })).toMatchObject({ ok: false });
    expect(paths).toEqual([]);
  });

  test("GitLab's refusal is the error", async () => {
    const { provider } = restFake([new Response("no", { status: 403, statusText: "Forbidden" })]);
    expect(await forgeGet(provider, "grp/proj", { path: "projects/9/issues" })).toEqual({ ok: false, error: "GitLab returned 403 Forbidden: no" });
  });
});
```

Append to `lib/daemon/__tests__/mr-ci-verbs.test.ts`:

```ts
describe("forge:get", () => {
  test("returns the read and validates query, page and perPage", async () => {
    const h = handlers({ restRequest: async () => new Response("[]", { status: 200 }) });
    expect(await h["forge:get"]!({ repoName: REPO, path: "projects/:id/issues" })).toEqual({ ok: true, data: { status: 200, body: [], truncated: false, nextPage: null, totalPages: null } });
    expect(await h["forge:get"]!({ repoName: REPO, path: "projects/:id/variables" })).toMatchObject({ ok: false });
    expect(await h["forge:get"]!({ repoName: REPO, path: "x", query: [] })).toEqual({ ok: false, error: '"query" must be an object' });
    expect(await h["forge:get"]!({ repoName: REPO, path: "x", query: { a: {} } })).toEqual({ ok: false, error: '"query.a" must be a string, number or boolean' });
    expect(await h["forge:get"]!({ repoName: REPO, path: "x", perPage: 101 })).toEqual({ ok: false, error: '"perPage" must be an integer from 1 to 100' });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: FAIL, `checkForgePath` is not exported and `h["forge:get"]` is not a function.

- [ ] **Step 3: Implement**

`packages/rt-client/src/commands.ts`:

```ts
/** `body` is parsed JSON, or raw text when GitLab did not answer JSON or the body was cut at the size cap. */
export interface ForgeGetData { status: number; body: unknown; truncated: boolean; nextPage: number | null; totalPages: number | null }
```
```ts
  "forge:get": { payload: { repoName: string; path: string; query?: Record<string, string | number | boolean>; page?: number; perPage?: number }; data: ForgeGetData };
```
and `"forge:get",` in `COMMAND_NAMES`.

`lib/daemon/forge-reads.ts`:

```ts
import type { ForgeGetData } from "../../packages/rt-client/src/index.ts";

/** A GET of any of these returns secret values redaction cannot recognise. */
export const REFUSED_SEGMENTS: readonly string[] = [
  "variables", "triggers", "deploy_tokens", "access_tokens", "runners", "hooks", "secure_files", "integrations", "services",
  "pipeline_schedules", "terraform",
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
  const segments = decoded.split("/").map((s) => s.toLowerCase());
  if (segments.some((s) => s === "." || s === "..")) return { ok: false, error: '"path" must not contain dot segments' };
  const refused = REFUSED_SEGMENTS.find((seg) => segments.includes(seg));
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
    .replace(/("(?:[A-Za-z0-9]+_)*token"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    // The size cap can land inside a token value, leaving it with no closing quote.
    .replace(/("(?:[A-Za-z0-9]+_)*token"\s*:\s*)"[^"]*$/i, '$1"[redacted]');
}

const headerNumber = (res: Response, name: string): number | null => {
  const n = Number(res.headers.get(name));
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function forgeGet(
  provider: RestProvider,
  projectPath: string,
  input: { path: unknown; query?: Record<string, string | number | boolean>; page?: number; perPage?: number },
): Promise<{ ok: true; data: ForgeGetData } | { ok: false; error: string }> {
  const checked = checkForgePath(input.path, projectPath);
  if (!checked.ok) return checked;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(input.query ?? {})) query.set(k, String(v));
  if (input.page !== undefined) query.set("page", String(input.page));
  if (input.perPage !== undefined) query.set("per_page", String(input.perPage));
  const qs = query.toString();
  try {
    const res = await provider.restRequest("GET", `${checked.path}${qs ? `?${qs}` : ""}`, undefined, "forge:get");
    if (!res.ok) return { ok: false, error: await gitlabFailure(res) };
    const text = await res.text();
    const truncated = text.length > FORGE_GET_MAX_BYTES;
    let body: unknown = truncated ? scrubTokenText(text.slice(0, FORGE_GET_MAX_BYTES)) : text;
    if (!truncated) {
      try { body = scrubTokens(JSON.parse(text)); } catch { /* not JSON: the text is the body */ }
    }
    return { ok: true, data: { status: res.status, body, truncated, nextPage: headerNumber(res, "x-next-page"), totalPages: headerNumber(res, "x-total-pages") } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
```

`lib/daemon/handlers/mr.ts`: add `forgeGet` to the `../forge-reads.ts` import, add the handler map type line, and add:

```ts
    "forge:get": async (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      if (p.query !== undefined && (typeof p.query !== "object" || p.query === null || Array.isArray(p.query))) return { ok: false, error: '"query" must be an object' };
      for (const [k, v] of Object.entries((p.query ?? {}) as Record<string, unknown>)) {
        if (!["string", "number", "boolean"].includes(typeof v)) return { ok: false, error: `"query.${k}" must be a string, number or boolean` };
      }
      for (const name of ["page", "perPage"] as const) {
        const v = p[name];
        if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v >= 1 && (name === "page" || v <= 100))) {
          return { ok: false, error: name === "page" ? '"page" must be a positive integer' : '"perPage" must be an integer from 1 to 100' };
        }
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const { provider, projectPath } = await contextFor(decoded.repo);
        if (typeof provider.restRequest !== "function") return { ok: false, error: "unsupported: forge:get needs a GitLab repo" };
        return await forgeGet(provider, projectPath, {
          path: p.path, query: p.query as Record<string, string | number | boolean> | undefined, page: p.page as number | undefined, perPage: p.perPage as number | undefined,
        });
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

- [ ] **Step 4: Run and confirm pass**

Run: `(cd packages/rt-client && bun run build) && bun test lib/daemon/__tests__/forge-reads.test.ts lib/daemon/__tests__/mr-ci-verbs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/forge-reads.ts lib/daemon/__tests__/forge-reads.test.ts lib/daemon/handlers/mr.ts lib/daemon/__tests__/mr-ci-verbs.test.ts packages/rt-client/src/commands.ts
git commit -m "daemon: forge:get, a GET-only GitLab passthrough that refuses credential paths"
```

---

### Task 6: rewire `mr_view`, `mr_list`, `mr_for_branch`, `mr_threads`, `mr_pipeline`

**Files:**
- Modify: `lib/mcp/mr-read-tools.ts`
- Test: `lib/mcp/__tests__/mr-read-tools.test.ts`

**Interfaces:**
- Consumes: daemon commands `mr:get`, `mr:list-live`, `mr:live-by-branch`, `discussions:refresh`, `mr:fetch-job-detail`.
- Produces: `MrReadDeps = { command: typeof rtCommand }`. `mr_view` body `{ mr, fetchedAt }`. `mr_list` body `{ mrs, truncated }`, plus `{ targetBranch, full }` when `targetBranch` was given, where `full` is `!truncated`. `mr_for_branch` body `{ byBranch: Record<string, { pr: PullRequest; source: "forge" } | null> }`. `mr_threads` body `{ discussions, fetchedAt, stale: false }`. `mr_pipeline` body `{ pipeline, job? }`.

- [ ] **Step 1: Replace the test file's fake and cache tests**

In `lib/mcp/__tests__/mr-read-tools.test.ts`, replace the `fake` helper and every test of `mr_view`, `mr_list`, `mr_for_branch` and `mr_threads` with the following. Keep the existing `tailTrace` and `mr_job_trace` tests, and keep the `mr_pipeline` tests of `jobId` behaviour (the trace pointer, the bridge passthrough, the sha/ref passthrough, `pipelineId` sent, `pipelineId` omitted, and the description test): that behaviour is unchanged, so port each to the new fake instead of deleting it. The ported forms follow the new tests below. The two kept `mr_job_trace` handler tests get their trace from the new fake as `fake({ "mr:fetch-job-trace": <the text> })`: one relied on the old default of `"log text"` and the other passed a `command` override. Delete the test "mr_pipeline on an unknown iid ..." that asserts the open-MR cache wording; the `mr_view` refusal test below replaces it.

```ts
type Call = { name: string; payload: Record<string, unknown> };

function fake(answers: Record<string, unknown> = {}): { deps: MrReadDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: MrReadDeps = {
    command: (async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      const a = answers[name];
      if (a instanceof Error) return { ok: false, error: a.message };
      return { ok: true, data: a };
    }) as any,
  };
  return { deps, calls };
}

describe("mr read tools ask GitLab, never the cache", () => {
  test("no tool sends project-mrs:read, mr:by-branch or discussions:read", async () => {
    const { deps, calls } = fake({
      "mr:get": { mr: pr(2, "merged"), fetchedAt: 5 },
      "mr:list-live": { mrs: [], truncated: false },
      "mr:live-by-branch": { byBranch: {} },
      "discussions:refresh": { discussions: [], fetchedAt: 5 },
    });
    await tool(deps, "mr_view").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_for_branch").handler({ repoName: ID, branches: ["b"] }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_threads").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    expect(calls.map((c) => c.name)).toEqual(["mr:get", "mr:list-live", "mr:live-by-branch", "discussions:refresh", "mr:get"]);
  });

  test("mr_view returns a merged MR by another author", async () => {
    const { deps, calls } = fake({ "mr:get": { mr: pr(2, "merged"), fetchedAt: 5 } });
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    expect(res).toMatchObject({ ok: true, body: { mr: { iid: 2, state: "merged" }, fetchedAt: 5 } });
    expect(calls[0]!.payload).toEqual({ repoName: ID, iid: 2 });
  });

  test("mr_view passes GitLab's refusal through", async () => {
    const { deps } = fake({ "mr:get": new Error("GitLab returned 403 Forbidden: no access") });
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 9 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("GitLab returned 403 Forbidden");
    expect(res.error).not.toContain("cache");
  });

  test("the old maxAgeMs and refresh arguments are accepted and not sent", async () => {
    const { deps, calls } = fake({ "mr:get": { mr: pr(1, "opened"), fetchedAt: 1 }, "mr:list-live": { mrs: [], truncated: false }, "discussions:refresh": { discussions: [], fetchedAt: 1 } });
    expect((await tool(deps, "mr_view").handler({ repoName: ID, iid: 1, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    expect((await tool(deps, "mr_list").handler({ repoName: ID, maxAgeMs: 5000, state: "opened" }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    expect((await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    expect((await tool(deps, "mr_threads").handler({ repoName: ID, iid: 1, refresh: true }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    for (const c of calls) expect(c.payload).not.toHaveProperty("maxAgeMs");
  });

  test("mr_list sends its filters and reports truncation", async () => {
    const { deps, calls } = fake({ "mr:list-live": { mrs: [{ iid: 1 }], truncated: true } });
    const res = await tool(deps, "mr_list").handler({ repoName: ID, author: "me", sourceBranch: "feat", state: "all", search: "refund", limit: 10 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ mrs: [{ iid: 1 }], truncated: true });
    expect(calls[0]!.payload).toEqual({ repoName: ID, author: "me", sourceBranch: "feat", state: "all", search: "refund", limit: 10 });
  });

  test("mr_list by targetBranch keeps full, true only when nothing was cut", async () => {
    const whole = fake({ "mr:list-live": { mrs: [], truncated: false } });
    expect((await tool(whole.deps, "mr_list").handler({ repoName: ID, targetBranch: "feat" }, {} as NodeJS.ProcessEnv)).body).toEqual({ mrs: [], truncated: false, targetBranch: "feat", full: true });
    const cut = fake({ "mr:list-live": { mrs: [], truncated: true } });
    expect((await tool(cut.deps, "mr_list").handler({ repoName: ID, targetBranch: "feat" }, {} as NodeJS.ProcessEnv)).body).toMatchObject({ full: false });
  });

  test("mr_list rejects a bad state and a non-string filter", async () => {
    const { deps } = fake();
    expect((await tool(deps, "mr_list").handler({ repoName: ID, state: "weird" }, {} as NodeJS.ProcessEnv)).error).toContain('"state" must be one of');
    expect((await tool(deps, "mr_list").handler({ repoName: ID, author: 3 }, {} as NodeJS.ProcessEnv)).error).toBe('"author" must be a string');
  });

  test("mr_for_branch keeps its entry shape and marks the source forge", async () => {
    const { deps } = fake({ "mr:live-by-branch": { byBranch: { feat: pr(9, "opened"), none: null } } });
    const res = await tool(deps, "mr_for_branch").handler({ repoName: ID, branches: ["feat", "none"] }, {} as NodeJS.ProcessEnv);
    expect(res.body).toMatchObject({ byBranch: { feat: { pr: { iid: 9 }, source: "forge" }, none: null } });
  });

  test("mr_threads always refreshes", async () => {
    const { deps, calls } = fake({ "discussions:refresh": { discussions: [{ id: "d1" }], fetchedAt: 7 } });
    const res = await tool(deps, "mr_threads").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ discussions: [{ id: "d1" }], fetchedAt: 7, stale: false });
    expect(calls.map((c) => c.name)).toEqual(["discussions:refresh"]);
  });

  test("mr_pipeline returns the live MR's head pipeline", async () => {
    const { deps } = fake({ "mr:get": { mr: pr(2, "opened"), fetchedAt: 5 } });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 2 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ pipeline: { status: "success", id: "gitlab:pipeline:9", jobs: [] } });
  });

  test("an unfiltered mr_list carrying maxAgeMs is the legacy stack-check call: 200 rows, syncedAt, never a partial list", async () => {
    const whole = fake({ "mr:list-live": { mrs: [{ iid: 1 }], truncated: false } });
    const res = await tool(whole.deps, "mr_list").handler({ repoName: ID, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv);
    expect(whole.calls[0]!.payload).toEqual({ repoName: ID, limit: 200 });
    expect(res.body).toMatchObject({ mrs: [{ iid: 1 }], truncated: false });
    expect(typeof (res.body as any).syncedAt).toBe("number");
    const cut = fake({ "mr:list-live": { mrs: [], truncated: true } });
    const refused = await tool(cut.deps, "mr_list").handler({ repoName: ID, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv);
    expect(refused.error).toBe("more than 200 open MRs; pass sourceBranch or targetBranch to read the ones that matter");
  });

  test("maxAgeMs with a filter is an ordinary call", async () => {
    const { deps, calls } = fake({ "mr:list-live": { mrs: [], truncated: false } });
    const res = await tool(deps, "mr_list").handler({ repoName: ID, maxAgeMs: 5000, sourceBranch: "feat" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]!.payload).toEqual({ repoName: ID, sourceBranch: "feat" });
    expect(res.body).toEqual({ mrs: [], truncated: false });
  });
});
```

The ported `mr_pipeline` job tests. `withPipeline` builds the `mr:get` answer, and `calls[1]` is the job-detail call:

```ts
const withPipeline = (pipeline: unknown) => ({ mr: { ...pr(1, "opened"), pipeline }, fetchedAt: 1 });

describe("mr_pipeline job detail", () => {
  test("replaces a trace job's log with a pointer to mr_job_trace", async () => {
    const { deps, calls } = fake({ "mr:get": withPipeline(pr(1, "opened").pipeline), "mr:fetch-job-detail": { type: "trace", content: "full log" } });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).pipeline.status).toBe("success");
    expect((res.body as any).job).toEqual({ type: "trace", traceVia: "mr_job_trace" });
    expect(JSON.stringify(res.body)).not.toContain("full log");
    expect(calls.map((c) => c.name)).toEqual(["mr:get", "mr:fetch-job-detail"]);
  });
  test("passes a bridge job's detail through unchanged", async () => {
    const bridge = { type: "bridge", downstreamPipeline: { id: "gitlab:pipeline:10", status: "failed", createdAt: null, webUrl: null, jobs: [] } };
    const { deps } = fake({ "mr:get": withPipeline(pr(1, "opened").pipeline), "mr:fetch-job-detail": bridge });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).job).toEqual(bridge);
  });
  test("passes sha, ref and mergeRequestEventType through unchanged", async () => {
    const { deps } = fake({ "mr:get": withPipeline({ ...pr(1, "opened").pipeline, sha: "abc", ref: "feat", mergeRequestEventType: null }) });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).pipeline).toMatchObject({ sha: "abc", ref: "feat", mergeRequestEventType: null });
  });
  test("sends the head pipeline's numeric id as pipelineId", async () => {
    const { deps, calls } = fake({ "mr:get": withPipeline(pr(1, "opened").pipeline), "mr:fetch-job-detail": { type: "trace", content: "" } });
    await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect(calls[1]!.payload).toEqual({ repoName: ID, iid: 1, jobId: 7, pipelineId: 9 });
  });
  test("omits pipelineId when the MR has no pipeline or a non-numeric id", async () => {
    for (const pipeline of [null, { status: "success", id: "gitlab:pipeline:abc", jobs: [] }]) {
      const { deps, calls } = fake({ "mr:get": withPipeline(pipeline), "mr:fetch-job-detail": { type: "trace", content: "" } });
      await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
      expect(calls[1]!.payload).toEqual({ repoName: ID, iid: 1, jobId: 7 });
    }
  });
});
```

Leave the existing "descriptions say jobId is not checked against the MR" test as it is, with `fake()` in the new signature.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/mcp/__tests__/mr-read-tools.test.ts`
Expected: FAIL, the fake no longer satisfies `MrReadDeps` and the tools still call `projectMrs`.

- [ ] **Step 3: Implement**

In `lib/mcp/mr-read-tools.ts`:

Replace the file header comment, imports, deps and the cache helpers (`CACHE_NOTE`, `LIVE_MAX_AGE_MS`, `type Pr`, `summarize`, `notFound`, `checkMaxAge`, `cacheMeta`, the inner `mrs` function) with:

```ts
/**
 * GitLab read tools. Each asks the daemon for a live read from GitLab; none
 * reads the daemon's open-MR cache, so any MR the token can see is readable.
 */
import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { resolveMrTarget, resolveRepoTarget } from "./mr-target.ts";
import { checkOptional, checkPositiveInts, checkStringArray, err, MR_TARGET_PROPS, ok, REPO_NAME_RULE, REPO_TARGET_PROPS, type McpToolDef } from "./shared.ts";

export interface MrReadDeps {
  command: typeof rtCommand;
}

export const realMrReadDeps: MrReadDeps = { command: rtCommand };

const STATES = ["opened", "merged", "closed", "all"] as const;
const LIVE_NOTE = "Read from GitLab on every call: any MR the token can see, whoever wrote it. A GitLab refusal comes back as GitLab's own text";
const LEGACY_LIST_LIMIT = 200;
const IGNORED_MAX_AGE = { type: "number", description: "Accepted and ignored; every read is live." };
const READ_TIMEOUT_MS = 30_000;
```

Keep `JOB_ID_NOTE`, the trace constants, `tailTrace` and `pipelineNumber` as they are. Change `pipelineNumber`'s parameter type to `{ pipeline?: { id?: string } | null }`.

Add a shared fetch inside `mrReadToolDefs`:

```ts
  async function getMr(identity: string, iid: number): Promise<{ ok: true; data: Commands["mr:get"]["data"] } | { ok: false; error: string }> {
    const r = await deps.command<Commands["mr:get"]["data"]>("mr:get", { repoName: identity, iid }, { timeoutMs: READ_TIMEOUT_MS });
    if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "MR read failed") };
    return { ok: true, data: r.data };
  }
```

Replace the five tool definitions:

```ts
    {
      name: "mr_view",
      description: `GitLab only. One MR by iid, in full: opened, merged or closed. ${LIVE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: IGNORED_MAX_AGE }, additionalProperties: false },
      shellForms: ["glab mr view", { id: "glab", pattern: /(?<![\w-])glab\b/, example: "glab api projects/1", note: "mr_view, mr_list, mr_for_branch, mr_threads, mr_pipeline, mr_job_trace, pipeline_list, project_labels, mr_merge, an mr_* write, or gitlab_get for any other read" }],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await getMr(target.identity, target.iid);
        return read.ok ? ok({ mr: read.data.mr, fetchedAt: read.data.fetchedAt }) : err(read.error);
      },
    },
    {
      name: "mr_list",
      description: `GitLab only. A summary of each matching MR of the target project (iid, title, state, draft, sourceBranch, targetBranch, author username, webUrl, detailedMergeStatus), most recently updated first. Filters: author (a username, or "me"), sourceBranch, targetBranch, state (default opened, which includes drafts), search (title and description, so a ticket id finds its MR). Returns {mrs, truncated}: at most limit rows (default 50, maximum 200), truncated true when GitLab had more. With targetBranch the body also carries targetBranch and full (true when nothing was cut); use that to prove a branch has no stacked children. Use mr_view for one MR in full. ${LIVE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...REPO_TARGET_PROPS,
          author: { type: "string", description: 'A GitLab username, or "me" for the signed-in user.' },
          sourceBranch: { type: "string" },
          targetBranch: { type: "string" },
          state: { type: "string", enum: [...STATES] },
          search: { type: "string", description: "Text matched against title and description." },
          limit: { type: "number" },
          maxAgeMs: IGNORED_MAX_AGE,
        },
        additionalProperties: false,
      },
      shellForms: ["glab mr list"],
      async handler(input) {
        const bad = checkOptional(input, [
          { name: "author", type: "string" }, { name: "sourceBranch", type: "string" }, { name: "targetBranch", type: "string" },
          { name: "state", type: "string" }, { name: "search", type: "string" }, { name: "limit", type: "number" }, { name: "maxAgeMs", type: "number" },
        ]);
        if (bad) return err(bad);
        const state = (input.state as string | undefined) ?? "opened";
        if (!STATES.includes(state as typeof STATES[number])) return err(`"state" must be one of ${STATES.join(", ")}`);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:list-live"]["payload"] = { repoName: target.identity };
        for (const name of ["author", "sourceBranch", "targetBranch", "search"] as const) {
          const v = (input[name] as string | undefined)?.trim();
          if (v) payload[name] = v;
        }
        if (input.state !== undefined) payload.state = state as typeof STATES[number];
        if (typeof input.limit === "number") payload.limit = input.limit;
        // Skills compiled before the read went live call this with only maxAgeMs to
        // rule out a stack, and a partial list there would pass a stacked branch.
        const legacy = input.maxAgeMs !== undefined && Object.keys(payload).length === 1;
        if (legacy) payload.limit = LEGACY_LIST_LIMIT;
        const r = await deps.command<Commands["mr:list-live"]["data"]>("mr:list-live", payload, { timeoutMs: READ_TIMEOUT_MS });
        if (!r.ok || !r.data) return err(explainError(r.error ?? "MR listing failed"));
        if (legacy) {
          if (r.data.truncated) return err(`more than ${LEGACY_LIST_LIMIT} open MRs; pass sourceBranch or targetBranch to read the ones that matter`);
          return ok({ mrs: r.data.mrs, truncated: false, syncedAt: Date.now() });
        }
        return ok({ mrs: r.data.mrs, truncated: r.data.truncated, ...(payload.targetBranch ? { targetBranch: payload.targetBranch, full: !r.data.truncated } : {}) });
      },
    },
    {
      name: "mr_for_branch",
      description: `GitLab only. The open MR (or null) for each named source branch, by any author. A null means GitLab has no open MR with that source branch. ${LIVE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, branches: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["branches"], additionalProperties: false },
      shellForms: [{ id: "subst", pattern: /\b[A-Za-z_][A-Za-z0-9_]*=\$\(\s*(rt|glab)\b/, example: "IID=$(glab mr list --json)", note: "a tool returns the value; nothing needs a shell variable (the inner call names the tool: glab mr list is mr_for_branch or mr_list, rt runs is run_*)" }],
      async handler(input) {
        const bad = checkStringArray(input, "branches");
        if (bad) return err(bad);
        if (!Array.isArray(input.branches) || input.branches.length === 0) return err('"branches" must name at least one branch');
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const r = await deps.command<Commands["mr:live-by-branch"]["data"]>("mr:live-by-branch", { repoName: target.identity, branches: input.branches as string[] }, { timeoutMs: 60_000 });
        if (!r.ok || !r.data) return err(explainError(r.error ?? "branch lookup failed"));
        const byBranch = Object.fromEntries(Object.entries(r.data.byBranch).map(([branch, mr]) => [branch, mr ? { pr: mr, source: "forge" as const } : null]));
        return ok({ byBranch });
      },
    },
    {
      name: "mr_threads",
      description: `GitLab only. The MR's discussion threads, fetched from GitLab on every call. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, refresh: { type: "boolean", description: "Accepted and ignored; every read is live." } }, additionalProperties: false },
      shellForms: { none: "discussions have no glab verb; a glab api call hits the glab catch-all on mr_view" },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "refresh", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const r = await deps.command<Commands["discussions:refresh"]["data"]>("discussions:refresh", { repoName: target.identity, iid: target.iid }, { timeoutMs: READ_TIMEOUT_MS });
        if (!r.ok || !r.data) return err(explainError(r.error ?? "thread read failed"));
        return ok({ discussions: r.data.discussions, fetchedAt: r.data.fetchedAt, stale: false });
      },
    },
    {
      name: "mr_pipeline",
      description: `GitLab only. The MR's head pipeline, carrying sha, ref and mergeRequestEventType ("merged_result", "detached", "merge_train" or null; for merged-results pipelines sha is the merge commit, not the source branch head), and, with jobId, that job's detail: a bridge job's downstream pipeline, or for any other job {type: "trace", traceVia: "mr_job_trace"}, since its log is read with mr_job_trace. For pipelines on a branch with no MR, or an MR's earlier pipelines, use pipeline_list. ${JOB_ID_NOTE}. ${LIVE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: IGNORED_MAX_AGE, jobId: { type: "number" } }, additionalProperties: false },
      shellForms: ["glab ci view", "glab ci status"],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]) ?? checkPositiveInts(input, ["jobId"]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await getMr(target.identity, target.iid);
        if (!read.ok) return err(read.error);
        const body: Record<string, unknown> = { pipeline: read.data.mr.pipeline ?? null };
        if (typeof input.jobId === "number") {
          const payload: Commands["mr:fetch-job-detail"]["payload"] = { repoName: target.identity, iid: target.iid, jobId: input.jobId };
          const pipelineId = pipelineNumber(read.data.mr);
          if (pipelineId !== undefined) payload.pipelineId = pipelineId;
          const job = await deps.command<Commands["mr:fetch-job-detail"]["data"]>("mr:fetch-job-detail", payload, { timeoutMs: READ_TIMEOUT_MS });
          if (!job.ok) return err(explainError(job.error ?? "job detail failed"));
          body.job = job.data?.type === "trace" ? { type: "trace", traceVia: "mr_job_trace" } : job.data;
        }
        return ok(body);
      },
    },
```

Remove `fromResponse` from the imports if it is now unused in this file.

- [ ] **Step 4: Run and confirm pass**

Run: `bun test lib/mcp/__tests__/mr-read-tools.test.ts lib/mcp/__tests__/shell-forms.test.ts lib/mcp/__tests__/tools.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors. If `shell-forms.test.ts` or `tools.test.ts` asserts the old `mr_view` note text or old descriptions, update those assertions to the new strings above.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/mr-read-tools.ts lib/mcp/__tests__
git commit -m "mcp: the mr read tools ask GitLab on every call and skip the open-MR cache"
```

---

### Task 7: `mr_job_trace` reads any part of a log

**Files:**
- Create: `lib/mcp/trace-slice.ts`, `lib/mcp/__tests__/trace-slice.test.ts`
- Modify: `lib/mcp/mr-read-tools.ts` (the `mr_job_trace` definition)
- Test: `lib/mcp/__tests__/mr-read-tools.test.ts`

**Interfaces:**
- Produces: `type TraceMode = { kind: "tail"; lines: number } | { kind: "head"; lines: number } | { kind: "range"; from: number; count: number } | { kind: "grep"; pattern: string; context: number }` and `sliceTrace(raw: string, mode: TraceMode): { trace: string; truncated: boolean; totalLines: number }`.
- `mr_job_trace` inputs: `tailLines`, or `headLines`, or `fromLine` with `lineCount`, or `grep` with `contextLines`. Exactly one mode per call; none given means the 200-line tail.

- [ ] **Step 1: Write the failing tests**

Create `lib/mcp/__tests__/trace-slice.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { sliceTrace, TRACE_MAX_BYTES } from "../trace-slice.ts";

const log = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

describe("sliceTrace", () => {
  test("tail keeps the last lines", () => {
    expect(sliceTrace(log, { kind: "tail", lines: 2 })).toEqual({ trace: "line 9\nline 10", truncated: true, totalLines: 10 });
  });
  test("head keeps the first lines", () => {
    expect(sliceTrace(log, { kind: "head", lines: 2 })).toEqual({ trace: "line 1\nline 2", truncated: true, totalLines: 10 });
  });
  test("range is 1-based and inclusive of fromLine", () => {
    expect(sliceTrace(log, { kind: "range", from: 4, count: 2 })).toEqual({ trace: "line 4\nline 5", truncated: true, totalLines: 10 });
  });
  test("a range past the end is empty, with the real line count and no error", () => {
    expect(sliceTrace(log, { kind: "range", from: 50, count: 5 })).toEqual({ trace: "", truncated: true, totalLines: 10 });
  });
  test("grep numbers each line and separates groups", () => {
    const r = sliceTrace("a\nERROR one\nb\nc\nd\nerror two\n", { kind: "grep", pattern: "error", context: 1 });
    expect(r.trace).toBe("1: a\n2: ERROR one\n3: b\n--\n5: d\n6: error two");
    expect(r.totalLines).toBe(6);
  });
  test("grep with no match is empty and not an error", () => {
    expect(sliceTrace(log, { kind: "grep", pattern: "nope", context: 2 })).toEqual({ trace: "", truncated: true, totalLines: 10 });
  });
  test("grep treats the pattern as plain text", () => {
    expect(sliceTrace("a.b\naxb\n", { kind: "grep", pattern: "a.b", context: 0 }).trace).toBe("1: a.b");
  });
  test("strips ANSI escapes before counting", () => {
    expect(sliceTrace("\x1b[31mred\x1b[0m\n", { kind: "head", lines: 5 })).toEqual({ trace: "red", truncated: false, totalLines: 1 });
  });
  test("a head over the byte cap is cut from the end, a tail from the start", () => {
    const big = `${"x".repeat(TRACE_MAX_BYTES)}\nEND\n`;
    expect(sliceTrace(big, { kind: "head", lines: 5 }).trace.startsWith("xxx")).toBe(true);
    expect(sliceTrace(big, { kind: "head", lines: 5 }).trace.length).toBe(TRACE_MAX_BYTES);
    expect(sliceTrace(big, { kind: "tail", lines: 5 }).trace.endsWith("END")).toBe(true);
  });
});
```

Append to `lib/mcp/__tests__/mr-read-tools.test.ts`:

```ts
describe("mr_job_trace modes", () => {
  const text = Array.from({ length: 300 }, (_, i) => `l${i + 1}`).join("\n");
  const run = async (input: Record<string, unknown>) => {
    const { deps } = fake({ "mr:fetch-job-trace": text });
    return tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 5, ...input }, {} as NodeJS.ProcessEnv);
  };
  test("no mode is the 200-line tail", async () => {
    expect(((await run({})).body as any).trace.split("\n").length).toBe(200);
  });
  test("headLines reads the start", async () => {
    expect(((await run({ headLines: 2 })).body as any).trace).toBe("l1\nl2");
  });
  test("fromLine with lineCount reads a range", async () => {
    expect(((await run({ fromLine: 10, lineCount: 2 })).body as any).trace).toBe("l10\nl11");
  });
  test("grep returns numbered matches", async () => {
    expect(((await run({ grep: "l299", contextLines: 0 })).body as any).trace).toBe("299: l299");
  });
  test("two modes at once are refused", async () => {
    expect((await run({ headLines: 2, grep: "x" })).error).toBe("pass one of tailLines, headLines, fromLine or grep");
  });
  test("lineCount without fromLine is refused", async () => {
    expect((await run({ lineCount: 5 })).error).toBe('"lineCount" needs "fromLine"');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/mcp/__tests__/trace-slice.test.ts lib/mcp/__tests__/mr-read-tools.test.ts`
Expected: FAIL, `Cannot find module "../trace-slice.ts"`.

- [ ] **Step 3: Implement**

Create `lib/mcp/trace-slice.ts`:

```ts
export const TRACE_MAX_BYTES = 64 * 1024;
const ANSI_ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export type TraceMode =
  | { kind: "tail"; lines: number }
  | { kind: "head"; lines: number }
  | { kind: "range"; from: number; count: number }
  | { kind: "grep"; pattern: string; context: number };

function capBytes(text: string, keep: "start" | "end"): { text: string; cut: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= TRACE_MAX_BYTES) return { text, cut: false };
  if (keep === "start") {
    let end = TRACE_MAX_BYTES;
    // A cut inside a multi-byte character would decode as a replacement character.
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
    return { text: bytes.subarray(0, end).toString("utf8"), cut: true };
  }
  let start = bytes.length - TRACE_MAX_BYTES;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return { text: bytes.subarray(start).toString("utf8"), cut: true };
}

export function sliceTrace(raw: string, mode: TraceMode): { trace: string; truncated: boolean; totalLines: number } {
  const lines = raw.replace(ANSI_ESCAPES, "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const totalLines = lines.length;
  let kept: string[];
  if (mode.kind === "tail") kept = lines.slice(-mode.lines);
  else if (mode.kind === "head") kept = lines.slice(0, mode.lines);
  else if (mode.kind === "range") kept = lines.slice(mode.from - 1, mode.from - 1 + mode.count);
  else {
    const needle = mode.pattern.toLowerCase();
    const wanted = new Set<number>();
    lines.forEach((line, i) => {
      if (!line.toLowerCase().includes(needle)) return;
      for (let j = Math.max(0, i - mode.context); j <= Math.min(totalLines - 1, i + mode.context); j++) wanted.add(j);
    });
    kept = [];
    let prev = -2;
    for (const i of [...wanted].sort((a, b) => a - b)) {
      if (prev >= 0 && i !== prev + 1) kept.push("--");
      kept.push(`${i + 1}: ${lines[i]}`);
      prev = i;
    }
  }
  const whole = mode.kind !== "grep" && kept.length === totalLines;
  const capped = capBytes(kept.join("\n"), mode.kind === "tail" ? "end" : "start");
  return { trace: capped.text, truncated: capped.cut || !whole, totalLines };
}
```

In `lib/mcp/mr-read-tools.ts`: delete the local `TRACE_MAX_BYTES`, `ANSI_ESCAPES` and the body of `tailTrace`, and re-express `tailTrace` on the new module so `ci-tools.ts` keeps its import:

```ts
import { sliceTrace, type TraceMode } from "./trace-slice.ts";

export function tailTrace(raw: string, tailLines: number): { trace: string; truncated: boolean; totalLines: number } {
  return sliceTrace(raw, { kind: "tail", lines: tailLines });
}
```

Replace the `mr_job_trace` definition:

```ts
    {
      name: "mr_job_trace",
      description: `GitLab only. Part of one CI job's plain-text trace, ANSI escapes stripped, capped at 64 KiB. One mode per call: tailLines (the last N lines; the default, N=${TRACE_TAIL_LINES}), headLines (the first N), fromLine with lineCount (a range, 1-based, lineCount default ${TRACE_TAIL_LINES}), or grep with contextLines (lines containing the text, case-insensitive plain text, each prefixed with its line number, groups separated by --; contextLines default 2). Returns trace, truncated (true when the trace holds more than was returned) and totalLines, so a range can be chosen from a tail. ${JOB_ID_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS, jobId: { type: "number" }, tailLines: { type: "number" }, headLines: { type: "number" },
          fromLine: { type: "number" }, lineCount: { type: "number" }, grep: { type: "string" }, contextLines: { type: "number" },
        },
        required: ["jobId"],
        additionalProperties: false,
      },
      shellForms: ["glab ci trace"],
      async handler(input) {
        if (input.jobId === undefined) return err('"jobId" is required');
        const bad = checkPositiveInts(input, ["jobId", "tailLines", "headLines", "fromLine", "lineCount"]) ?? checkOptional(input, [{ name: "grep", type: "string" }, { name: "contextLines", type: "number" }]);
        if (bad) return err(bad);
        const chosen = ["tailLines", "headLines", "fromLine", "grep"].filter((k) => input[k] !== undefined);
        if (chosen.length > 1) return err("pass one of tailLines, headLines, fromLine or grep");
        if (input.lineCount !== undefined && input.fromLine === undefined) return err('"lineCount" needs "fromLine"');
        if (input.contextLines !== undefined && input.grep === undefined) return err('"contextLines" needs "grep"');
        const context = (input.contextLines as number | undefined) ?? 2;
        if (!(Number.isInteger(context) && context >= 0 && context <= 50)) return err('"contextLines" must be an integer from 0 to 50');
        if (typeof input.grep === "string" && !input.grep.trim()) return err('"grep" must not be empty');
        const mode: TraceMode =
          input.headLines !== undefined ? { kind: "head", lines: input.headLines as number }
          : input.fromLine !== undefined ? { kind: "range", from: input.fromLine as number, count: (input.lineCount as number | undefined) ?? TRACE_TAIL_LINES }
          : typeof input.grep === "string" ? { kind: "grep", pattern: input.grep, context }
          : { kind: "tail", lines: (input.tailLines as number | undefined) ?? TRACE_TAIL_LINES };
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const r = await deps.command<Commands["mr:fetch-job-trace"]["data"]>("mr:fetch-job-trace", { repoName: target.identity, iid: target.iid, jobId: input.jobId as number }, { timeoutMs: 60_000 });
        if (!r.ok) return err(explainError(r.error ?? "trace failed"));
        return ok(sliceTrace(r.data ?? "", mode));
      },
    },
```

- [ ] **Step 4: Run and confirm pass**

Run: `bun test lib/mcp/__tests__/trace-slice.test.ts lib/mcp/__tests__/mr-read-tools.test.ts lib/mcp/__tests__/ci-tools.test.ts`
Expected: PASS. The existing `tailTrace` tests pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/trace-slice.ts lib/mcp/__tests__/trace-slice.test.ts lib/mcp/mr-read-tools.ts lib/mcp/__tests__/mr-read-tools.test.ts
git commit -m "mcp: mr_job_trace reads the head, a range or matching lines as well as the tail"
```

---

### Task 8: `project_labels`, `pipeline_list`, `gitlab_get`, `branch_stack`

**Files:**
- Create: `lib/mcp/forge-read-tools.ts`, `lib/mcp/stack-tool.ts`
- Create: `lib/mcp/__tests__/forge-read-tools.test.ts`, `lib/mcp/__tests__/stack-tool.test.ts`
- Modify: `lib/stack-guard.ts` (export `stackMembershipOf`)
- Modify: `lib/mcp/git-tools.ts` (export `currentBranch`)
- Modify: `lib/mcp/tools.ts` (roster, near line 791)
- Modify: `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES`, near line 184)

**Interfaces:**
- Consumes: daemon commands `project:labels`, `pipeline:list`, `forge:get`; `checkRegisteredTree` from `lib/mcp/tree-guard.ts`; `createStackGuardRunners`, `createRealProbes`.
- Produces: `forgeReadToolDefs(deps?: { command: typeof rtCommand }): McpToolDef[]` with tools `project_labels {repoName, search?}`, `pipeline_list {repoName, ref?, sha?, iid?, limit?}`, `gitlab_get {repoName, path, query?, page?, perPage?}`.
- Produces: `stackToolDefs(deps?: StackToolDeps): McpToolDef[]` with tool `branch_stack {tree}` returning `{ branch: string; member: boolean; stack?: string; parent?: string; root?: string; children?: string[]; stackStore: "read" | "unavailable" }`.
- Produces: `stackMembershipOf(cwd: string, branch: string, runners: Pick<StackGuardRunners, "gitqStacks">): Promise<{ known: boolean; membership: StackMembership | null }>` from `lib/stack-guard.ts`.

- [ ] **Step 1: Write the failing tests**

Create `lib/mcp/__tests__/forge-read-tools.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { forgeReadToolDefs } from "../forge-read-tools.ts";

const ID = "remote:gitlab.com%2Facme%2Facme-dev";
type Call = { name: string; payload: Record<string, unknown> };
function fake(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const command = (async (name: string, payload: Record<string, unknown>) => {
    calls.push({ name, payload });
    const a = answers[name];
    return a instanceof Error ? { ok: false, error: a.message } : { ok: true, data: a };
  }) as any;
  const tool = (name: string) => forgeReadToolDefs({ command }).find((t) => t.name === name)!;
  return { calls, tool };
}

describe("forge read tools", () => {
  test("project_labels passes search and returns labels", async () => {
    const { calls, tool } = fake({ "project:labels": { labels: [{ name: "preview-acme", description: null, color: null }] } });
    const res = await tool("project_labels").handler({ repoName: ID, search: "preview" }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ labels: [{ name: "preview-acme", description: null, color: null }] });
    expect(calls[0]).toEqual({ name: "project:labels", payload: { repoName: ID, search: "preview" } });
  });

  test("pipeline_list needs no MR and passes ref, sha, iid and limit", async () => {
    const { calls, tool } = fake({ "pipeline:list": { pipelines: [] } });
    await tool("pipeline_list").handler({ repoName: ID, ref: "feat", limit: 5 }, {} as NodeJS.ProcessEnv);
    expect(calls[0]!.payload).toEqual({ repoName: ID, ref: "feat", limit: 5 });
    expect((await tool("pipeline_list").handler({ repoName: ID, iid: 0 }, {} as NodeJS.ProcessEnv)).error).toBe('"iid" must be a positive integer');
  });

  test("gitlab_get has no method input and passes path, query and paging", async () => {
    const { calls, tool } = fake({ "forge:get": { status: 200, body: [], truncated: false, nextPage: null, totalPages: 1 } });
    const def = tool("gitlab_get");
    expect(Object.keys((def.inputSchema as any).properties).sort()).toEqual(["mrUrl", "page", "path", "perPage", "query", "repoName"]);
    const res = await def.handler({ repoName: ID, path: "projects/:id/merge_requests/12/commits", query: { order: "asc" }, page: 2 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(calls[0]!.payload).toEqual({ repoName: ID, path: "projects/:id/merge_requests/12/commits", query: { order: "asc" }, page: 2 });
    expect((await def.handler({ repoName: ID }, {} as NodeJS.ProcessEnv)).error).toBe('"path" is required');
  });

  test("a daemon refusal is the tool's error", async () => {
    const { tool } = fake({ "forge:get": new Error('"path" names variables, which can return credentials; gitlab_get refuses it') });
    const res = await tool("gitlab_get").handler({ repoName: ID, path: "projects/:id/variables" }, {} as NodeJS.ProcessEnv);
    expect(res.error).toContain("gitlab_get refuses it");
  });
});
```

Create `lib/mcp/__tests__/stack-tool.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { stackToolDefs } from "../stack-tool.ts";

const stacks = JSON.stringify({ stacks: [{ stackName: "cart", root: "main", nodes: [{ branch: "a", parent: "main" }, { branch: "b", parent: "a" }, { branch: "c", parent: "b" }] }] });
const tool = (branch: string | null, gitq: string | null, guard: { ok: true; path: string; repoName: string } | { ok: false; error: string } = { ok: true, path: "/t", repoName: "r" }) =>
  stackToolDefs({ checkTree: () => guard, currentBranch: async () => branch, gitqStacks: async () => gitq })[0]!;

describe("branch_stack", () => {
  test("a stack member reports its parent, root and children", async () => {
    const res = await tool("b", stacks).handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ branch: "b", member: true, stack: "cart", parent: "a", root: "main", children: ["c"], stackStore: "read" });
  });
  test("a branch in no stack is not a member", async () => {
    expect((await tool("solo", stacks).handler({ tree: "/t" }, {} as NodeJS.ProcessEnv)).body).toEqual({ branch: "solo", member: false, stackStore: "read" });
  });
  test("an unanswerable stack store says so instead of guessing", async () => {
    expect((await tool("b", null).handler({ tree: "/t" }, {} as NodeJS.ProcessEnv)).body).toEqual({ branch: "b", member: false, stackStore: "unavailable" });
  });
  test("refuses an unregistered tree and a detached HEAD", async () => {
    expect((await tool("b", stacks, { ok: false, error: "nope" }).handler({ tree: "/x" }, {} as NodeJS.ProcessEnv)).error).toBe("nope");
    expect((await tool(null, stacks).handler({ tree: "/t" }, {} as NodeJS.ProcessEnv)).error).toBe("the tree is on a detached HEAD");
  });
});
```

In `e2e/tests/mcp-serve.test.ts`, add `"project_labels", "pipeline_list", "gitlab_get", "branch_stack",` to `EXPECTED_TOOL_NAMES`. After the existing `gate_list` call in the same test, add one call per new tool over the real transport, against a target the test daemon does not know. Each must come back as a tool error, never a failed request:

```ts
      for (const [name, args] of [
        ["project_labels", { repoName: "/nonexistent/checkout" }],
        ["pipeline_list", { repoName: "/nonexistent/checkout", ref: "main" }],
        ["gitlab_get", { repoName: "/nonexistent/checkout", path: "projects/:id/labels" }],
        ["branch_stack", { tree: "/nonexistent/checkout" }],
      ] as const) {
        const res = await client.request("tools/call", { name, arguments: args });
        expect(res.error, name).toBeUndefined();
        const out = res.result as { isError?: boolean; content: Array<{ type: string; text: string }> };
        expect(out.isError, name).toBe(true);
        expect(out.content[0]!.text.length, name).toBeGreaterThan(0);
      }
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/mcp/__tests__/forge-read-tools.test.ts lib/mcp/__tests__/stack-tool.test.ts`
Expected: FAIL, both modules are missing.

- [ ] **Step 3: Implement**

In `lib/stack-guard.ts`, after `gitqMembership`:

```ts
/** `known: false` means gitq could not answer here, which is not the same as "not in a stack". */
export async function stackMembershipOf(
  cwd: string,
  branch: string,
  runners: Pick<StackGuardRunners, "gitqStacks">,
): Promise<{ known: boolean; membership: StackMembership | null }> {
  const out = await runners.gitqStacks(cwd);
  if (out === null) return { known: false, membership: null };
  return { known: true, membership: gitqMembership(parseGitqStacks(out), branch) };
}
```

In `lib/mcp/git-tools.ts`, change `async function currentBranch` to `export async function currentBranch`.

Create `lib/mcp/stack-tool.ts`:

```ts
import { createRealProbes } from "../setup/probes.ts";
import { createStackGuardRunners, stackMembershipOf } from "../stack-guard.ts";
import { currentBranch, realGitRunner } from "./git-tools.ts";
import { err, ok, type McpToolDef } from "./shared.ts";
import { checkRegisteredTree } from "./tree-guard.ts";

export interface StackToolDeps {
  checkTree: (tree: unknown) => { ok: true; path: string; repoName: string } | { ok: false; error: string };
  currentBranch: (cwd: string) => Promise<string | null>;
  gitqStacks: (cwd: string) => Promise<string | null>;
}

function realStackToolDeps(): StackToolDeps {
  const runners = createStackGuardRunners(createRealProbes());
  return {
    checkTree: (tree) => checkRegisteredTree(tree),
    currentBranch: (cwd) => currentBranch(cwd, realGitRunner),
    gitqStacks: (cwd) => runners.gitqStacks(cwd),
  };
}

export function stackToolDefs(deps: StackToolDeps = realStackToolDeps()): McpToolDef[] {
  return [
    {
      name: "branch_stack",
      description: "Whether the tree's checked-out branch is a member of a tracked stack. Returns {branch, member, stackStore}; a member also carries stack (its name), parent, root and children. stackStore is \"unavailable\" when the stack store could not be read, in which case member: false is not proof. Reads no forge. tree is the absolute path of a registered checkout or worktree root.",
      inputSchema: { type: "object", properties: { tree: { type: "string", description: "Absolute path of a registered checkout or worktree root." } }, required: ["tree"], additionalProperties: false },
      shellForms: ["gitq stacks"],
      async handler(input) {
        const guard = deps.checkTree(input.tree);
        if (!guard.ok) return err(guard.error);
        const branch = await deps.currentBranch(guard.path);
        if (branch === null) return err("the tree is on a detached HEAD");
        const { known, membership } = await stackMembershipOf(guard.path, branch, { gitqStacks: deps.gitqStacks });
        if (!known) return ok({ branch, member: false, stackStore: "unavailable" });
        if (!membership) return ok({ branch, member: false, stackStore: "read" });
        return ok({ branch, member: true, stack: membership.name, parent: membership.parent, root: membership.root, children: membership.children, stackStore: "read" });
      },
    },
  ];
}
```

Create `lib/mcp/forge-read-tools.ts`:

```ts
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
        const r = await deps.command<Commands["project:labels"]["data"]>("project:labels", payload, { timeoutMs: TIMEOUT_MS });
        return r.ok && r.data ? ok(r.data) : err(explainError(r.error ?? "label read failed"));
      },
    },
    {
      name: "pipeline_list",
      description: `GitLab only. Pipelines newest first, each with id, status, ref, sha, source, webUrl and createdAt: for a branch (ref), a commit (sha), or an MR (iid, which lists that MR's own pipelines). Works for a branch with no MR. limit defaults to 20, maximum 100. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, ref: { type: "string" }, sha: { type: "string" }, iid: { type: "number" }, limit: { type: "number" } }, additionalProperties: false },
      shellForms: ["glab ci list"],
      async handler(input) {
        const bad = checkOptional(input, [{ name: "ref", type: "string" }, { name: "sha", type: "string" }]) ?? checkPositiveInts(input, ["iid", "limit"]);
        if (bad) return err(bad);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["pipeline:list"]["payload"] = { repoName: target.identity };
        for (const name of ["ref", "sha"] as const) {
          const v = (input[name] as string | undefined)?.trim();
          if (v) payload[name] = v;
        }
        if (typeof input.iid === "number") payload.iid = input.iid;
        if (typeof input.limit === "number") payload.limit = input.limit;
        const r = await deps.command<Commands["pipeline:list"]["data"]>("pipeline:list", payload, { timeoutMs: TIMEOUT_MS });
        return r.ok && r.data ? ok(r.data) : err(explainError(r.error ?? "pipeline listing failed"));
      },
    },
    {
      name: "gitlab_get",
      description: `GitLab only. One read-only GET against GitLab's REST API, for a fact no other tool returns (an MR's commits or changes, a job's artifacts listing, an issue, a merged MR search). path is relative to the API root and :id stands for the target project, e.g. projects/:id/merge_requests/12/commits; pass query values in query, never in path. Returns {status, body, truncated, nextPage, totalPages}: body is parsed JSON, cut to text at 256 KiB (truncated: true), so page with page and perPage (maximum 100). GitLab decides access and its refusal comes back as its own text. Paths that can return credentials (variables, triggers, deploy_tokens, access_tokens, runners, hooks, secure_files, integrations, services, pipeline_schedules, terraform) are refused, and any token value in a returned body is redacted. Prefer the purpose-built tool when one covers the read. ${REPO_NAME_RULE}`,
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
        const r = await deps.command<Commands["forge:get"]["data"]>("forge:get", payload, { timeoutMs: TIMEOUT_MS });
        return r.ok && r.data ? ok(r.data) : err(explainError(r.error ?? "GitLab read failed"));
      },
    },
  ];
}
```

In `lib/mcp/tools.ts`, import both and add them to the roster after `...mrReadToolDefs(),`:

```ts
    ...forgeReadToolDefs(),
    ...stackToolDefs(),
```

- [ ] **Step 4: Run and confirm pass**

Run: `bun test lib/mcp lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-ui-in-cli.test.ts && bun test --preload ./e2e/setup.ts e2e/tests/mcp-serve.test.ts && bunx tsc --noEmit`
Expected: PASS. If `shell-forms.test.ts` reports that `glab api` or `glab ci list` is claimed by two tools, keep the literal form on the new tool and leave the `mr_view` catch-all pattern as the fallback; if it reports `gitq stacks` is not a known command prefix, replace `branch_stack`'s `shellForms` with `{ none: "the stack store has no shell form a skill names" }`.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/forge-read-tools.ts lib/mcp/stack-tool.ts lib/mcp/__tests__ lib/stack-guard.ts lib/mcp/git-tools.ts lib/mcp/tools.ts e2e/tests/mcp-serve.test.ts
git commit -m "mcp: project_labels, pipeline_list, gitlab_get and branch_stack"
```

---

### Task 9: `ci_watch` reads the MR live

The watch budget inputs (`budgetMinutes`, `extendMinutes`) are on this branch already; this task does not touch them.

**Files:**
- Modify: `lib/mcp/ci-tools.ts` (`CiWatchToolDeps`, `realWatchDeps`, `readMr`, the first-read error text, the description)
- Test: `lib/mcp/__tests__/ci-tools.test.ts`, `lib/ci/__tests__/watch.test.ts` (or wherever `watchPipeline` is tested; find it with `rg -l watchPipeline lib -g '*.test.ts'`)

**Interfaces:**
- Consumes: daemon command `mr:get`.
- Produces: `CiWatchToolDeps` without `projectMrs`. `ci_watch`'s result shape is unchanged.

- [ ] **Step 1: Write the failing tests**

In `lib/mcp/__tests__/ci-tools.test.ts`, the `watchTool` helper inside `describe("ci_watch")` feeds the MR through `projectMrs`. Change its two lines so the MR comes from `mr:get` and any cache read fails the test:

```ts
        projectMrs: (async () => { throw new Error("ci_watch must not read the open-MR cache"); }) as any,
        command: (async (name: string) => (name === "mr:get"
          ? { ok: true, data: { mr: { iid: 42, sha: SHA, webUrl: MR, pipeline }, fetchedAt: 0 } }
          : { ok: true, data: [] })) as any,
```

Any existing test that overrides `projectMrs` to supply a different MR moves that MR into a `command` override answering `mr:get` the same way. Then add, inside the same `describe`:

```ts
  test("reads the MR with mr:get", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const names: string[] = [];
    const pipeline = { id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] };
    const r = await watchTool({
      command: (async (name: string) => {
        names.push(name);
        return name === "mr:get" ? { ok: true, data: { mr: { iid: 42, sha: SHA, webUrl: MR, pipeline }, fetchedAt: 0 } } : { ok: true, data: [] };
      }) as any,
    }).handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success" } });
    expect(names).toContain("mr:get");
  });

  test("an MR GitLab refuses returns GitLab's text", async () => {
    const r = await watchTool({ command: (async () => ({ ok: false, error: "GitLab returned 403 Forbidden: no access" })) as any })
      .handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r.error).toContain("GitLab returned 403 Forbidden");
    expect(r.error).not.toContain("cache");
  });
```

The helper passes `leaseOpts: () => ({ dir })`, so neither test touches the real lease directory, and the throwing `projectMrs` keeps the failing run off the live daemon.

In the `watchPipeline` test file, add a test that pins the failed-job list (the loop already returns every failed job and traces only the first five blocking ones; this keeps it that way):

```ts
test("every failed job is listed; only the first five blocking ones carry a trace tail", async () => {
  const jobs = Array.from({ length: 8 }, (_, i) => ({ id: `gitlab:job:${i + 1}`, name: `j${i + 1}`, stage: "test", status: "failed", allowFailure: false, webUrl: null }));
  const pipeline = { id: "gitlab:pipeline:9", status: "failed", sha: "abc1234", ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] };
  const r = await watchPipeline({ sha: "abc1234", maxWaitSeconds: 0, intervalSeconds: 30, budgetMinutes: 75 }, {
    now: () => 0, sleep: async () => {},
    leaseCheck: () => ({ ok: true, lease: null }),
    readMr: async () => ({ ok: true, mr: { iid: 4, sha: "abc1234", webUrl: "https://x", pipeline } }),
    commitParents: async () => null,
    failedJobs: async () => jobs,
    traceTail: async (id) => `tail ${id}`,
  });
  if ("error" in r) throw new Error(r.error);
  expect(r.failedJobs.map((j) => j.jobId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(r.failedJobs.filter((j) => j.traceTail !== undefined).length).toBe(5);
  expect(r.blockingFailures).toBe(8);
});
```

Match the `WatchDeps` fields to the interface at the top of `lib/ci/watch.ts`; where it requires a field this fake lacks, supply it the way that file's other tests do.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test lib/mcp/__tests__/ci-tools.test.ts lib/ci`
Expected: every `ci_watch` test FAILS with "ci_watch must not read the open-MR cache". The `watchPipeline` pin test passes already; that is expected.

- [ ] **Step 3: Implement**

In `lib/mcp/ci-tools.ts`:

- Remove `readProjectMRs` from the rt-client import and from `CiWatchToolDeps` and `realWatchDeps`. Remove `WATCH_LIVE_MAX_AGE_MS`. Delete the throwing `projectMrs` line from the test helper, since the dep no longer exists.
- Replace `readMr` inside the handler:

```ts
          readMr: async () => {
            const res = await w.command<Commands["mr:get"]["data"]>("mr:get", { repoName: target.identity, iid: target.iid }, { timeoutMs: 30_000 });
            if (!res.ok || !res.data) return { ok: false, error: explainError(res.error ?? "failed to read the MR") };
            const pr = res.data.mr;
            return { ok: true, mr: { iid: pr.iid, sha: pr.sha ?? null, webUrl: pr.webUrl ?? null, pipeline: toWatchPipeline(pr.pipeline) } };
          },
```

- Replace the missing-URL error text `MR !${target.iid} has no web URL in the cache; retry once the daemon has synced it` with `GitLab returned MR !${target.iid} with no web URL`.
- Update the comment above `toWatchPipeline`: drop the words "a cache entry or".
- In the `ci_watch` description, change "failedJobs with a trace tail for up to five blocking failures (jobs in same-project downstream pipelines included)" to "failedJobs listing every failed job, with a trace tail on the first five blocking ones (jobs in same-project downstream pipelines included; read any other job's log with mr_job_trace)".

- [ ] **Step 4: Run and confirm pass**

Run: `bun test lib/mcp/__tests__/ci-tools.test.ts lib/ci && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/ci-tools.ts lib/mcp/__tests__/ci-tools.test.ts lib/ci
git commit -m "ci_watch: read the MR from GitLab on each poll, not the open-MR cache"
```

---

### Task 10: reference, docs and the full gate

**Files:**
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (generated)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (the next minor above the version on this branch, `0.29.1` at the time of writing, so `0.30.0`)
- Modify: `AGENTS.md` (the "Gates and the `rt_verb` MCP tool" section)
- Modify: `website/docs/guides/mcp.mdx` (hand-written; `docs:gen` does not touch it)

- [ ] **Step 1: Regenerate the tool reference**

Run: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`
Expected: `git diff --stat` shows `reference.md` changed, with `gitlab_get`, `project_labels`, `pipeline_list` and `branch_stack` present.

- [ ] **Step 2: Update `AGENTS.md`**

Replace this text:

```
GitLab reads
(`mr-read-tools.ts`; `mr_view`, `mr_list` and `mr_pipeline` read the
daemon's open-MR cache, the others ask the daemon directly), git writes
```

with:

```
GitLab reads
(`mr-read-tools.ts`, `forge-read-tools.ts`: every one asks GitLab through
the daemon on each call and none reads the open-MR cache, so an agent can
read any MR its token can; `gitlab_get` is a GET-only passthrough whose
daemon guard in `lib/daemon/forge-reads.ts` refuses the paths that return
credentials, and that list is widened, never narrowed, without a design
review), the stack store read (`stack-tool.ts`), git writes
```

- [ ] **Step 3: Update the website guide, bump the plugin version, regenerate docs**

In `website/docs/guides/mcp.mdx`, under `### MR reads`, replace the six table rows with:

```
| `mr_view` | One MR by iid, read from GitLab: any author, opened, merged or closed (GitLab only). |
| `mr_list` | A summary of each matching MR of a project, read from GitLab, filtered by author, source branch, target branch, state or text search; at most `limit` rows, with `truncated` when there were more (GitLab only). |
| `mr_for_branch` | The open MR, or null, for each named source branch, by any author (GitLab only). |
| `mr_threads` | The MR's discussion threads, fetched from GitLab on every call (GitLab only). |
| `mr_pipeline` | The MR's head pipeline, and with `jobId` that job's detail (GitLab only). |
| `mr_job_trace` | Part of one CI job's trace: the tail, the head, a line range, or lines matching text; ANSI escapes stripped, capped at 64 KiB (GitLab only). |
| `pipeline_list` | Pipelines for a branch, a commit or an MR, newest first; works with no MR (GitLab only). |
| `project_labels` | The project's labels, optionally searched by name (GitLab only). |
| `gitlab_get` | One read-only GET against GitLab's REST API for a fact no other tool returns; paths that return credentials are refused (GitLab only). |
| `branch_stack` | Whether a tree's branch is in a tracked stack, and its parent. |
```

Replace the paragraph that begins "`mr_view`, `mr_list` and `mr_pipeline` read the daemon's open-MR cache" (the whole paragraph, through its last sentence about `full: true`) with:

```
Every read asks GitLab on each call and none uses the daemon's open-MR cache, so an agent can read any MR its token can see. A refusal comes back as GitLab's own status and text. `mr_list` with `targetBranch` also returns `full`, true when nothing was cut, so an empty full list proves the branch has no open MRs targeting it.
```

Edit `plugins/mattstack/.claude-plugin/plugin.json`'s `"version"`. Run: `bun run docs:gen`

- [ ] **Step 4: Run the full gate**

Run: `(cd packages/rt-client && bun run build) && bun run test && bun run check && bun test --preload ./e2e/setup.ts e2e/tests/mcp-serve.test.ts && bun cli.ts skills check --strict --pack mattstack`
Expected: all PASS. `skills check` passes because no skill text changed yet; the regenerated reference is not linted for shell forms.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack/attachments/mcp-tools/reference.md plugins/mattstack/.claude-plugin/plugin.json AGENTS.md website
git commit -m "mcp tools reference and docs: GitLab reads are live"
```

Phase A is releasable here. Skills compiled earlier keep working: their `maxAgeMs` and `refresh` arguments are ignored, and their cache-miss holds now fire only when GitLab itself has no such MR.

---

# Phase B: engine skills

Every task in this phase starts by loading `superpowers:writing-skills`, `mattstack:editing-skills` and `mattstack:process-digraphs`. Where those skills and this plan disagree on procedure (how to run a scenario, how to compile, what certify needs), the skills win and the plan's intent stands.

All paths below are under `plugins/mattstack/attachments/`. Edge and node text is quoted exactly; replace it exactly.

Scenario records go in `plugins/mattstack/docs/superpowers/tests/2026-09-30-live-forge-reads/` as `red.md` (before any edit) and `green.md` (after), one section per scenario, in the form the neighbouring directories use: the scenario prompt, the tester model, and the tool calls the tester listed or made.

### Task 11: record the RED scenarios

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-09-30-live-forge-reads/red.md`

- [ ] **Step 1: Run each scenario against the unedited skills**

Use the listing-scenario method the earlier tool rewrite used (see `plugins/mattstack/docs/superpowers/tests/2026-09-25-mcp-mr-tools/` for the exact prompt shape): a sonnet tester is given the compiled skill text and a situation, and lists the tool calls it would make and where it stops. The seven scenarios:

1. **review, other author.** "Review !412. `mr_view` returned: GitLab returned 404 Not Found." What does the tester do, and what reason does it give?
2. **review, by branch.** "Review the branch `feat/cart`. `mr_for_branch` returned a null entry."
3. **checkout by ticket.** "Check out ABC-2299. It is a teammate's MR."
4. **receive-review.** "Respond to the review on this branch. `mr_for_branch` returned a null entry."
5. **CI triage.** "`ci_watch` returned failed with eight blocking jobs in `failedJobs`, five with a `traceTail`. The tail of job 3 shows only teardown lines."
6. **ship from a stack.** "Ship this branch. It is `b`, stacked on `a`."
7. **a fact no tool returns.** "During review you need the list of commits on !412."

- [ ] **Step 2: Write `red.md`**

Record for each scenario what the tester did. The expected RED results, which the record should confirm or correct: (1) holds citing rt's MR cache; (2) holds citing rt's MR cache; (3) calls `mr_list` with no filter and asks which branch; (4) reports no open MR "in rt's cache"; (5) calls the other three failures unclassified and goes to the gate without reading their logs; (6) creates the MR against the default branch; (7) stops, or reaches for the GitLab CLI and hits the STOP.

- [ ] **Step 3: Commit**

```bash
git add plugins/mattstack/docs/superpowers/tests/2026-09-30-live-forge-reads/red.md
git commit -m "live forge reads: RED scenario record"
```

---

### Task 12: review

**Files:**
- Modify: `review/review/SKILL.md`

- [ ] **Step 1: Edit the graph**

Replace the node declarations:

```
    "mr_view {mrUrl, or repoName + iid, maxAgeMs: 5000}" [shape=plaintext];
    "mr_view found the MR?" [shape=diamond];
```
with
```
    "mr_view {mrUrl, or repoName + iid}" [shape=plaintext];
    "mr_view returned the MR?" [shape=diamond];
```

Replace
```
    "STOP: never read the MR with the GitLab CLI; hold the review instead" [shape=octagon style=filled fillcolor=red fontcolor=white];
```
with
```
    "STOP: GitLab reads go through the mr_* tools or gitlab_get" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "gitlab_get {repoName, path}: a GitLab fact no mr_* tool returns" [shape=plaintext];
```

Replace these eleven edges (lines 186, 187 and 190 to 198: the two `"Review target form?"` edges to `mr_view` and `mr_for_branch`, then everything from `"mr_for_branch {...}" -> "mr_for_branch entry for the branch?"` through `"STOP: never read the MR with the GitLab CLI; hold the review instead" -> "run_decision ..."`) with:

```
    "Review target form?" -> "mr_view {mrUrl, or repoName + iid}" [label="GitLab URL or iid"];
    "Review target form?" -> "mr_for_branch {repoName: <checkout>, branches: [<branch>]}" [label="GitLab branch name"];
    "mr_for_branch {repoName: <checkout>, branches: [<branch>]}" -> "mr_for_branch entry for the branch?";
    "mr_for_branch entry for the branch?" -> "mr_view {mrUrl, or repoName + iid}" [label="an iid"];
    "mr_for_branch entry for the branch?" -> "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy} for review" [label="null: hold, GitLab has no open MR for the branch"];
    "mr_for_branch entry for the branch?" -> "STOP: GitLab reads go through the mr_* tools or gitlab_get" [label="tempted to look it up with the GitLab CLI"];
    "mr_view {mrUrl, or repoName + iid}" -> "mr_view returned the MR?";
    "mr_view returned the MR?" -> "Own review run: record the target?" [label="yes"];
    "mr_view returned the MR?" -> "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy} for review" [label="an error: hold, GitLab's error text is the reason"];
    "mr_view returned the MR?" -> "STOP: GitLab reads go through the mr_* tools or gitlab_get" [label="tempted to read it with the GitLab CLI"];
    "STOP: GitLab reads go through the mr_* tools or gitlab_get" -> "mr_view {mrUrl, or repoName + iid}";
```

Leave lines 188 (the GitHub edge) and 189 (the clarify edge) as they are. Then add the missing-fact route. Find the node the graph reaches once the diff is in hand and the review checks run (the node named `"MR-head checkout in hand for the review checks?"`), and add:

```
    "MR-head checkout in hand for the review checks?" -> "gitlab_get {repoName, path}: a GitLab fact no mr_* tool returns" [label="the review needs a GitLab fact no mr_* tool returns"];
    "gitlab_get {repoName, path}: a GitLab fact no mr_* tool returns" -> "MR-head checkout in hand for the review checks?";
```

- [ ] **Step 2: Edit the prose**

In `### Resolve the review target`, replace

```
given a URL, else `repoName` = the checkout path plus `iid`; its
`maxAgeMs: 5000` makes the read live. A ticket id with no URL, iid or
branch, or more than one candidate, is the clarify gate. A lookup that
comes back empty means rt's open-MR cache does not hold the MR (outside its
author or time window): say so, and hold with that message as the reason
(`decidedBy: "pane"`). Never a guess.
```
with
```
given a URL, else `repoName` = the checkout path plus `iid`. The read
asks GitLab, so any MR your token can see resolves, whoever wrote it and
whether it is open, merged or closed. A ticket id with no URL, iid or
branch, or more than one candidate, is the clarify gate. An `mr_view`
error is GitLab's own answer (no such MR, or no access): hold with that
text as the reason (`decidedBy: "pane"`). A null `mr_for_branch` entry
means GitLab has no open MR for the branch: hold saying so. Never a
guess.
```

Add a section after it:

```
### gitlab_get {repoName, path}: a GitLab fact no mr_* tool returns

When the review needs something from GitLab that `mr_view`, `mr_threads`,
`mr_pipeline`, `mr_job_trace` and `pipeline_list` do not return (the MR's
commit list, an issue it references, another MR's state), read it with
`gitlab_get`: `repoName` = the checkout path, `path` relative to the API
root with `:id` for this project, for example
`projects/:id/merge_requests/<iid>/commits`. One read per fact, then back
to the review. Its refusal of a credential path is final.
```

Search the file for the remaining phrases `maxAgeMs`, `open-MR cache`, `MR cache` and `live \`mr_view\`` and reword each to match: `mr_view` takes no `maxAgeMs`, and "the live `mr_view`" becomes "`mr_view`".

- [ ] **Step 3: Check and certify**

Run: `bun cli.ts skills check --strict --pack mattstack && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/review/review`
Expected: PASS. Certify renders the graph, so a node referenced by an edge and not declared, or declared and unreachable, fails here.

- [ ] **Step 4: Commit**

```bash
git add plugins/mattstack/attachments/review/review/SKILL.md
git commit -m "review: an MR lookup asks GitLab; its error is the hold reason"
```

---

### Task 13: checkout and receive-review

**Files:**
- Modify: `forge/checkout/SKILL.md`, `review/receive-review/SKILL.md`

- [ ] **Step 1: Edit checkout's graph**

Replace the node `"mr_list {repoName}" [shape=plaintext];` with `"mr_list {repoName, search: <ticket id>, state: all}" [shape=plaintext];`.

Replace the two STOP declarations with one:
```
    "STOP: GitLab reads go through the mr_* tools or gitlab_get" [shape=octagon style=filled fillcolor=red fontcolor=white];
```

Replace the edges on lines 63 to 73 that name `mr_list {repoName}` or either old STOP:

```
    "MR forge host?" -> "mr_view {repoName, mrUrl or iid}" [label="GitLab"];
    "MR forge host?" -> "STOP: GitLab reads go through the mr_* tools or gitlab_get" [label="tempted to use the GitLab CLI"];
    "STOP: GitLab reads go through the mr_* tools or gitlab_get" -> "mr_view {repoName, mrUrl or iid}";
    "Ticket forge host?" -> "mr_list {repoName, search: <ticket id>, state: all}" [label="GitLab"];
    "mr_list {repoName, search: <ticket id>, state: all}" -> "Pick the branch from the result";
```

A STOP has one way out, so the ticket branch's temptation edge goes; the shared STOP redirects to `mr_view`. Keep every GitHub edge as it is.

- [ ] **Step 2: Edit checkout's prose**

In `### Pick the branch from the result`, replace

```
number. For a ticket id, keep the rows whose `sourceBranch`
(GitHub: head branch) or `title` carries the id. The GitLab tools read the
daemon's open-MR cache, which may not hold every MR: an empty GitLab
result means ask, not "none exists".
```
with
```
number. For a ticket id, `mr_list` takes `search` = the id and `state`
`all`, which asks GitLab for every MR whose title or description carries
it, by any author; keep the rows whose `sourceBranch` (GitHub: head
branch) or `title` carries the id. An `mr_view` or `mr_list` error is
GitLab's own answer: report it. No row means no MR mentions the ticket.
```

- [ ] **Step 3: Edit receive-review**

Replace the node label and its edges that carry `refresh: true`: change every `mr_threads {mrUrl, refresh: true}` to `mr_threads {mrUrl}`, including the "for the posted-already read" variant.

In the prose, replace

```
On GitLab the threads come from `mr_threads` with the MR (`mrUrl`, or
`repoName` plus `iid`) and `refresh: true`; with neither in hand,
```
with
```
On GitLab the threads come from `mr_threads` with the MR (`mrUrl`, or
`repoName` plus `iid`), read from GitLab on every call; with neither in hand,
```

and replace

```
A null entry from `mr_for_branch` means no open MR in rt's cache has that
branch as its source: report that and stop.
```
with
```
A null entry from `mr_for_branch` means GitLab has no open MR with that
branch as its source: report that and stop.
```

- [ ] **Step 4: Check and certify**

Run: `bun cli.ts skills check --strict --pack mattstack && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/forge/checkout && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/review/receive-review`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack/attachments/forge/checkout/SKILL.md plugins/mattstack/attachments/review/receive-review/SKILL.md
git commit -m "checkout, receive-review: lookups ask GitLab; no cache caveats"
```

---

### Task 14: rebase-worktree and map-open-mrs

**Files:**
- Modify: `forge/rebase-worktree/SKILL.md`, `forge/map-open-mrs/SKILL.md`

- [ ] **Step 1: Edit rebase-worktree's graph**

Replace the node declarations

```
    "mr_list {repoName: <tree>, maxAgeMs: 5000}" [shape=plaintext];
    "Read synced?" [shape=diamond];
```
with
```
    "mr_list {repoName: <tree>, sourceBranch: <branch>}" [shape=plaintext];
    "mr_list {repoName: <tree>, targetBranch: <branch>}" [shape=plaintext];
    "Both reads succeeded?" [shape=diamond];
```

Replace the edges

```
    "Forge host?" -> "mr_list {repoName: <tree>, maxAgeMs: 5000}" [label="GitLab"];
    "mr_list {repoName: <tree>, maxAgeMs: 5000}" -> "Read synced?";
    "Read synced?" -> "Apply the child and parent checks" [label="yes"];
    "Read synced?" -> "Stack check could not run: reported" [label="no: error, syncError, or syncedAt 0"];
```
with
```
    "Forge host?" -> "mr_list {repoName: <tree>, sourceBranch: <branch>}" [label="GitLab"];
    "mr_list {repoName: <tree>, sourceBranch: <branch>}" -> "mr_list {repoName: <tree>, targetBranch: <branch>}";
    "mr_list {repoName: <tree>, targetBranch: <branch>}" -> "Both reads succeeded?";
    "Both reads succeeded?" -> "Apply the child and parent checks" [label="yes, and the targetBranch read is full: true"];
    "Both reads succeeded?" -> "Stack check could not run: reported" [label="no: an error, or full: false"];
```

- [ ] **Step 2: Edit rebase-worktree's prose**

In `### Apply the child and parent checks`, replace

```
directions. On GitLab both checks read the one `mr_list` result
(`mr_for_branch` takes no `maxAgeMs`, so it is not used here); on GitHub
they read the two `gh` results.

- **Child check:** the branch's open MR or PR (GitLab: the row whose
  `sourceBranch` is this branch, then its `targetBranch`; GitHub: `gh pr
  view <branch>`).
```
with
```
directions. On GitLab the child check reads the `sourceBranch` result and
the parent check the `targetBranch` result, both asked of GitLab across
every author; on GitHub they read the two `gh` results.

- **Child check:** the branch's open MR or PR (GitLab: the
  `sourceBranch` result's row, then its `targetBranch`; GitHub: `gh pr
  view <branch>`).
```

Replace `(GitLab: the\n  rows whose \`targetBranch\` is this branch; GitHub:` with `(GitLab: every\n  row of the \`targetBranch\` result; GitHub:`.

Delete this paragraph:

```
When the result's `scope` limits the cache to certain authors or a time
window, the verdict covers only that scope: say so, and carry "stack check
covered <scope> only" on the old head -> new head line (**Report the
move**) so it reaches whoever gates the push.
```

In the table below it, replace the third row's Reality with: `On two successful reads, the second \`full: true\`, the branch is stack-free: proceed.`

In `### Report the move`, delete the sentence `Carry any "stack check covered\n<scope> only" caveat on the line.`

- [ ] **Step 3: Edit map-open-mrs**

Replace the whole `GitLab:` paragraph of `## 1. List the open items` with:

```
GitLab: the `mr_list` tool with `repoName` = the current checkout's
absolute path, `author` `me` and `state` `opened`. It asks GitLab for the
signed-in user's open MRs. When the result says `truncated: true`, call
again with a larger `limit` (up to 200) and say so if it is still cut.
```

- [ ] **Step 4: Check and certify**

Run: `bun cli.ts skills check --strict --pack mattstack && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/forge/rebase-worktree && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/forge/map-open-mrs && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/forge/sync-open-mrs`
Expected: PASS. sync-open-mrs inlines map-open-mrs, so it is certified too.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack/attachments/forge
git commit -m "rebase-worktree, map-open-mrs: stack and open-MR reads ask GitLab across every author"
```

---

### Task 15: ship and stage-ship target the stack parent

**Files:**
- Modify: `pipeline/ship/SKILL.md`, `pipeline/stage-ship/SKILL.md`

- [ ] **Step 1: Edit ship's graph**

Rename the node everywhere it appears (declaration and three edges): `"mr_create {repoName: <root>, sourceBranch, targetBranch: <default>, title, description, draft, squash?, labels?}"` becomes `"mr_create {repoName: <root>, sourceBranch, targetBranch, title, description, draft, squash?, labels?}"`.

Add the node declarations:

```
    "branch_stack {tree: <root>} (ship)" [shape=plaintext];
    "Stack member (ship)?" [shape=diamond];
```

Replace the edge

```
    "Created once already (ship)?" -> "mr_create {...}" [label="no"];
```
(with the renamed node in place of `{...}`) with:

```
    "Created once already (ship)?" -> "branch_stack {tree: <root>} (ship)" [label="no"];
    "branch_stack {tree: <root>} (ship)" -> "Stack member (ship)?";
    "Stack member (ship)?" -> "mr_create {repoName: <root>, sourceBranch, targetBranch, title, description, draft, squash?, labels?}" [label="yes: targetBranch is the stack parent"];
    "Stack member (ship)?" -> "mr_create {repoName: <root>, sourceBranch, targetBranch, title, description, draft, squash?, labels?}" [label="no, or a tool error: targetBranch is the default branch"];
```

Rename the STOP `"STOP: GitLab reads and writes go through mr_* tools (ship)"` to `"STOP: GitLab reads and writes go through the mr_* tools or gitlab_get (ship)"` in its declaration and both edges.

- [ ] **Step 2: Edit stage-ship's graph and prose**

Add the same two nodes without the `(ship)` suffix (`"branch_stack {tree: <root>}"`, `"Stack member?"`) and route `"Created once already?" -> ... [label="no"]` through them with the same two labelled edges onto the existing `mr_create` node.

Rename `"STOP: GitLab reads and writes go through mr_* tools, never the GitLab CLI"` to `"STOP: GitLab reads and writes go through the mr_* tools or gitlab_get"` in its declaration and both edges.

Replace the prose

```
- `targetBranch` is the default branch read from git, never guessed. Keep
```
with
```
- `targetBranch` is the stack parent when `branch_stack` says the branch
  is a stack member, else the default branch read from git; never guessed.
  When `branch_stack` reports `stackStore: "unavailable"`, say the stack
  could not be read and name the default branch as the target at the ship
  gate. Keep
```

In `pipeline/ship/SKILL.md`, the line that says the `ship` verb's version reads `targetBranch: <default>` (in the acme domain fill it appears as "(The `ship` verb's version reads `targetBranch: <default>`.)"; in the engine search for `targetBranch: <default>`) is deleted or reworded so no text says the standalone verb always targets the default branch. Add the same `targetBranch` bullet to ship's "What the graph cannot show" list.

- [ ] **Step 3: Check and certify**

Run: `bun cli.ts skills check --strict --pack mattstack && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/pipeline/ship && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/pipeline/stage-ship`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/mattstack/attachments/pipeline/ship/SKILL.md plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md
git commit -m "ship: a stack member's MR targets its stack parent"
```

---

### Task 16: watch-ci and stage-watch-ci triage every failure

**Files:**
- Modify: `pipeline/watch-ci/SKILL.md`, `pipeline/stage-watch-ci/SKILL.md`

- [ ] **Step 1: Edit the classify prose in both files**

In `pipeline/watch-ci/SKILL.md` replace

```
Read each failed job's `traceTail` in `ci_watch`'s `failedJobs`; a tail too
short to classify is what `mr_job_trace` is for.
```
with
```
Read each failed job's `traceTail` in `ci_watch`'s `failedJobs`. A job
with no `traceTail` (past the first five), or a tail too short to
classify, is read with `mr_job_trace`: the tail first, then `grep` for the
failure text or `headLines` when the failure sits far above the end.
```

and delete the paragraph that begins "`ci_watch` details at most five blocking failures. When `blockingFailures`" through "gate name the count."

Make the same two changes in `pipeline/stage-watch-ci/SKILL.md` (its first sentence reads "Read each failed job's `traceTail` in `ci_watch`'s `failedJobs` first;" keep its trailing clause's meaning).

- [ ] **Step 2: Edit the graphs**

In both files change the edge label `"no: a REAL or unclassified failure, or retried already"` to `"no: a REAL failure, or retried already"`.

In `pipeline/watch-ci/SKILL.md`, rename `"STOP: GitLab CI watches go through ci_watch, reads through mr_job_trace, retries through mr_retry"` to `"STOP: GitLab CI watches go through ci_watch, reads through the mr_* tools or gitlab_get, retries through mr_retry"` in its declaration and both edges, and update the two prose mentions of the old name.

In `pipeline/stage-watch-ci/SKILL.md`, rename `"STOP: GitLab CI watches go through ci_watch, reads and retries through mr_job_trace and mr_retry, never the GitLab CLI"` to `"STOP: GitLab CI watches go through ci_watch, reads through the mr_* tools or gitlab_get, retries through mr_retry"` the same way.

In both, change every `mr_view {repoName, iid, maxAgeMs: 5000}` node (declaration and edges, including the "(draft check)" variant) to drop `, maxAgeMs: 5000`.

Add to each triage section one sentence: "A pipeline fact `ci_watch` and `mr_pipeline` do not return (an earlier pipeline on the branch, a pipeline with no MR) is read with `pipeline_list`; anything else with `gitlab_get`."

- [ ] **Step 3: Check and certify**

Run: `bun cli.ts skills check --strict --pack mattstack && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/pipeline/watch-ci && sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/pipeline/stage-watch-ci`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md plugins/mattstack/attachments/pipeline/stage-watch-ci/SKILL.md
git commit -m "watch-ci: triage reads every failed job's log"
```

---

### Task 17: the missing-fact route in the other eight graphs

Task 12 gave review its `gitlab_get` route. The spec requires the same route in checkout, receive-review, ship, stage-ship, watch-ci, stage-watch-ci, rebase-worktree and stage-evidence.

**Files:**
- Modify: `forge/checkout/SKILL.md`, `review/receive-review/SKILL.md`, `forge/rebase-worktree/SKILL.md`, `pipeline/ship/SKILL.md`, `pipeline/stage-ship/SKILL.md`, `pipeline/watch-ci/SKILL.md`, `pipeline/stage-watch-ci/SKILL.md`, `pipeline/stage-evidence/SKILL.md`

- [ ] **Step 1: Add the node and its two edges to each graph**

Each graph gets one node declaration and two edges, anchored at the node where that verb reads GitLab. Node names must be unique within a compiled verb, so each carries its verb in parentheses.

| File | Anchor node (exact name) | New node |
|---|---|---|
| `forge/checkout/SKILL.md` | `"Pick the branch from the result"` | `"gitlab_get {repoName, path} (checkout)"` |
| `review/receive-review/SKILL.md` | `"Keep only unresolved human threads"` | `"gitlab_get {repoName, path} (receive-review)"` |
| `forge/rebase-worktree/SKILL.md` | `"Apply the child and parent checks"` | `"gitlab_get {repoName, path} (rebase-worktree)"` |
| `pipeline/ship/SKILL.md` | `"Run the domain steps before the gate (none when unbound)"` | `"gitlab_get {repoName, path} (ship)"` |
| `pipeline/stage-ship/SKILL.md` | `"Run the domain steps before the gate (none when unbound)"` | `"gitlab_get {repoName, path} (stage-ship)"` |
| `pipeline/watch-ci/SKILL.md` | `"Classify each failure REAL or INFRA (GitLab)"` | `"gitlab_get {repoName, path} (watch-ci)"` |
| `pipeline/stage-watch-ci/SKILL.md` | `"Classify each failure REAL or INFRA"` | `"gitlab_get {repoName, path} (stage-watch-ci)"` |
| `pipeline/stage-evidence/SKILL.md` | `"Run the domain steps before the gate (none when unbound)"` | `"gitlab_get {repoName, path} (stage-evidence)"` |

For each row, with `<anchor>` and `<new>` from the table:

```
    <new> [shape=plaintext];
    <anchor> -> <new> [label="needs a GitLab fact no listed tool returns"];
    <new> -> <anchor>;
```

Every anchor is a box. `mattstack:process-digraphs` decides whether a box may carry this labelled side edge. If that skill or certify rejects it, put a diamond after the box instead: declare `"<anchor text>: needs a GitLab fact no listed tool returns?" [shape=diamond];`, point the box's existing outgoing edges' source at the diamond with the label `"no"` added (keeping any label the edge already had, joined with a colon), add `<anchor> -> <diamond>`, `<diamond> -> <new> [label="yes"]` and `<new> -> <diamond>`. Use the same form in all eight files, whichever one certify accepts.

- [ ] **Step 2: Add the prose section to each file**

Under each graph's "how" sections, add a section named exactly as the new node, with this body (the example path changes per file as listed):

```
A GitLab fact the tools named in this graph do not return is read with
`gitlab_get`: `repoName` = the checkout or tree this verb already
targets, `path` relative to the API root with `:id` for this project,
for example `<example>`. One read per fact, then back. Its refusal of a
credential path is final; a GitLab error is reported as GitLab wrote it.
```

Examples: checkout `projects/:id/merge_requests?search=<ticket id>&state=merged` written as path `projects/:id/merge_requests` with `query` `{search, state}`; receive-review `projects/:id/merge_requests/<iid>/versions`; rebase-worktree `projects/:id/repository/branches/<branch>`; ship and stage-ship `projects/:id/merge_requests/<iid>/approvals`; watch-ci and stage-watch-ci `projects/:id/jobs/<jobId>/artifacts` listing via `projects/:id/jobs/<jobId>`; stage-evidence `projects/:id/merge_requests/<iid>/notes`.

For checkout, write the example in prose as: "`path` `projects/:id/merge_requests` with `query` `{search: <ticket id>, state: merged}`", since a query string in `path` is refused.

- [ ] **Step 3: Check and certify all eight**

Run: `bun cli.ts skills check --strict --pack mattstack` and then `sh plugins/mattstack/tests/certify.sh <dir>` for each of the eight skill directories.
Expected: PASS for all.

- [ ] **Step 4: Commit**

```bash
git add plugins/mattstack/attachments
git commit -m "skills: a gitlab_get route for a GitLab fact no listed tool returns"
```

---

### Task 18: the remaining `maxAgeMs`, GREEN, and the release bump

**Files:**
- Modify: `pipeline/stage-evidence/SKILL.md`, `pipeline/stage-ship/SKILL.md` and any other file the search below finds (each still names `mr_view {mrUrl, maxAgeMs: 5000}`)
- Create: `plugins/mattstack/docs/superpowers/tests/2026-09-30-live-forge-reads/green.md`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json`
- Modify: `apps/board/skills` (regenerated)

- [ ] **Step 1: Sweep the leftovers**

Run: `rg -n 'maxAgeMs|refresh: true|open-MR cache|MR cache|rt.s cache|syncedAt|syncError' plugins/mattstack/attachments plugins/mattstack/skills -g '*.md' -g '!**/mcp-tools/reference.md'`

For each hit: drop `, maxAgeMs: 5000` and `, refresh: true` from node names (declaration and every edge together), and reword any sentence that explains a read by the cache so it says the read asks GitLab. `plugins/mattstack/skills/shepherdr/SKILL.md` is compiled output: do not edit it by hand; it is regenerated in Step 3.

Expected after the edits: the same command prints nothing outside compiled output.

- [ ] **Step 2: Run the seven scenarios again and write `green.md`**

Same prompts as Task 11, against the edited skills (Tasks 12 to 17). Expected: (1) holds with GitLab's 404 text as the reason and no mention of a cache; (2) holds saying GitLab has no open MR for the branch; (3) calls `mr_list {search: "ABC-2299", state: "all"}` and picks the branch; (4) reports GitLab has no open MR for the branch; (5) calls `mr_job_trace` for the three untailed jobs and for job 3 with `grep` or `headLines`; (6) calls `branch_stack`, then `mr_create` with `targetBranch: "a"`; (7) calls `gitlab_get {path: "projects/:id/merge_requests/412/commits"}`. Add an eighth GREEN-only check: give the tester the compiled watch-ci text and "you need this job's artifact file list", and expect a `gitlab_get` call, proving the Task 17 route reads as intended outside review.

A scenario that does not reach its expected result is a failed task: fix the skill text, not the record.

- [ ] **Step 3: Recompile, expand and gate**

Follow `mattstack:editing-skills` for the compile and sync commands that regenerate `plugins/mattstack/skills/` from the edited attachments. Then run:

`bun run skills:expand:board && bun cli.ts skills check --strict --pack mattstack && bun run check`

Expected: PASS, and `git status` shows `apps/board/skills` changed only where an edited engine is inlined.

- [ ] **Step 4: Bump the plugin version and commit**

Raise `plugins/mattstack/.claude-plugin/plugin.json`'s version by one minor from its Phase A value.

```bash
git add plugins/mattstack apps/board/skills
git commit -m "live forge reads: remaining skill text, GREEN record, plugin bump"
```

---

# Phase C: acme pack

Work happens in `acme-tools`, in its own worktree and MR, after the Phase B engine is published. Use `mattstack:editing-skills` for where the pack source lives and how it compiles. No mattstack ticket id appears anywhere in this repo.

### Task 19: reword the pack rule, use `project_labels`, recompile

**Files (under `mattstack/packs/acme/`):**
- Modify: `skills/context/SKILL.md`, `attachments/ship-domain/SKILL.md`, `attachments/watch-ci-domain/SKILL.md` if the sweep finds a cache mention
- Modify: the pack's version field and compiled output

- [ ] **Step 1: Edit `skills/context/SKILL.md`**

Replace

```
- Read and write GitLab only through rt's `mr_*` MCP tools (`mr_view`,
  `mr_list`, `mr_for_branch`, `mr_threads`, `mr_pipeline`, `mr_job_trace`,
  `mr_create`, `mr_update`, `mr_upload`, `mr_retry`, `mr_merge`,
  `mr_comment`, and more).
```
with
```
- Write to GitLab only through rt's `mr_*` MCP tools (`mr_create`,
  `mr_update`, `mr_upload`, `mr_retry`, `mr_merge`, `mr_comment`, and
  more). Read GitLab through the same server's read tools (`mr_view`,
  `mr_list`, `mr_for_branch`, `mr_threads`, `mr_pipeline`,
  `mr_job_trace`, `pipeline_list`, `project_labels`), which ask GitLab
  directly, so any MR you can see on GitLab is readable. For a fact none
  of them returns, use `gitlab_get`.
```

- [ ] **Step 2: Edit `attachments/ship-domain/SKILL.md`**

Replace the bullet that begins `- **Read and write GitLab only through rt's MR tools**` with the same split (writes through the `mr_*` tools; reads through the server's read tools; `gitlab_get` for anything else), keeping the bullet's existing sentence about naming the target.

Where the fill tells the agent to apply the preview labels the developer named, add: "Check each name with `project_labels {repoName, search: "preview"}` and apply it exactly as GitLab spells it; a name GitLab does not have is a question for the ship gate, never a guess."

- [ ] **Step 3: Sweep, compile, verify**

Run: `rg -n 'maxAgeMs|refresh: true|cache' mattstack/packs/acme/skills mattstack/packs/acme/attachments -g 'SKILL.md'` and reword any sentence that explains a GitLab read by the cache.

Recompile the pack against the published engine and bump its version, per `mattstack:editing-skills`. Then confirm the compiled verbs carry the new engine: `rg -c 'gitlab_get' <compiled skills dir>/review/SKILL.md <compiled skills dir>/ship/SKILL.md` prints a count above 0 for each, and `rg -n "rt's MR cache" <compiled skills dir>` prints nothing.

- [ ] **Step 4: Commit and open the MR**

Commit on a branch in `acme-tools`. Before opening the MR, confirm with Matt. The description follows the repo's MR template and names no mattstack ticket.

---

# Phase D: Matt's instructions

### Task 20: `~/work/acme/CLAUDE.md`

This file is outside any repo, so there is no commit.

- [ ] **Step 1: Edit the "GitLab operations" section**

Replace the opening paragraph's sentence `Reading MRs and CI uses the \`glab\` CLI (\`/opt/homebrew/bin/glab\`). Never use raw API calls or curl.` with:

```
Reading MRs and CI uses the same server's read tools: `mr_view`,
`mr_list`, `mr_for_branch`, `mr_threads`, `mr_pipeline`, `mr_job_trace`,
`pipeline_list`, `project_labels`, and `gitlab_get` for anything else.
They ask GitLab directly. Never use raw API calls or curl.
```

Delete the `## Common glab commands` heading and its code block.

- [ ] **Step 2: Verify**

Run: `rg -n 'glab' ~/work/acme/CLAUDE.md`
Expected: no output.

---

## Self-review notes

- Spec coverage: changed reads (Tasks 1 to 3, 6, 9), `mr_job_trace` modes (7), new reads and passthrough (4, 5, 8), compatibility including the legacy unfiltered `mr_list` (6), what goes with the tools (10), every Part 2 skill bullet (12 to 16), the missing-fact route in all nine graphs (12 and 17), Part 3 (19), Part 4 (20), sequencing (phase order), testing (each task, plus 11 and 18; the write-back guard from Task 1; the e2e calls in Task 8).
- One spec line turned out to be already true in the code: `ci_watch` lists every failed job today and caps only the trace tails. Task 9 pins that with a test and corrects the description; Task 16 corrects the skill text that said otherwise.
- `mr_list` rows no longer carry `pipelineStatus` (GitLab's REST listing has none). No engine skill reads it from `mr_list`; `mr_view` and `mr_pipeline` carry the pipeline.
- The write tools' read-back in `lib/mcp/tools.ts` (`readProjectMRs` at the verify step and in `mr_map`) is untouched: the spec leaves write tools out of scope.
