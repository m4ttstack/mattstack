/**
 * Creates the team's settings repo on the member's forge with a token rt
 * holds: a private GitLab project under a group, or a private GitHub repo
 * under the member's own account or an org. Every forge answer that reaches
 * an error's log passes through `withoutUrls` first.
 */

import { sameUser } from "../../packages/rt-client/src/settings/active-team.ts";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { TITLES } from "../setup/token-create.ts";
import { FORGE_API_TIMEOUT_MS } from "./forge.ts";
import { withoutUrls } from "./redact.ts";

export interface ForgeRepoRequest {
  provider: "github" | "gitlab";
  host: string;
  namespace: string;
  name: string;
  token: string;
  /** The token's own account, which GitHub creates under instead of an org. */
  login: string | null;
}

type Reply = Awaited<ReturnType<Probes["fetch"]>>;

function parsed(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function answerLog(i: ForgeRepoRequest, step: string, res: Reply): string {
  return withoutUrls(`${step} for ${i.namespace}/${i.name} answered ${res.status}: ${res.body}`.trim());
}

function failed(i: ForgeRepoRequest, step: string, res: Reply): UserActionableError {
  const forge = TITLES[i.provider];
  if (res.status === 0) return new UserActionableError("create-repo-failed", `rt could not reach ${forge} to create the team repo`, {}, { log: `${step} for ${i.namespace}/${i.name} got no answer` });
  return new UserActionableError("create-repo-failed", `${forge} did not create the team repo`, {}, { log: answerLog(i, step, res) });
}

function unseen(i: ForgeRepoRequest, step: string, res: Reply): UserActionableError {
  const what = i.provider === "gitlab" ? "projects" : "repos";
  return new UserActionableError("create-repo-failed", `This token cannot see ${i.namespace} on ${TITLES[i.provider]}`, {}, {
    why: `Check the name, and that the token's account can create ${what} there.`,
    log: answerLog(i, step, res),
  });
}

function exists(i: ForgeRepoRequest, url: string): UserActionableError {
  return new UserActionableError("create-repo-exists", `${TITLES[i.provider]} already has a repo with this team's name`, {}, {
    why: `It is ${url}. Point rt at it instead of creating a new one.`,
    next: "rt team create <name> --remote <its url>",
  });
}

function remoteFrom(i: ForgeRepoRequest, step: string, res: Reply, field: string): { remote: string } {
  const remote = parsed(res.body)?.[field];
  if (typeof remote !== "string" || remote === "") {
    throw new UserActionableError("create-repo-failed", `${TITLES[i.provider]} created the team repo but did not say where it is`, {}, { log: `${step} for ${i.namespace}/${i.name} returned no ${field}` });
  }
  return { remote };
}

/** GitLab answers a taken name or path with a 400 whose message lists the field. */
function gitlabTaken(body: string): boolean {
  return /has already been taken/i.test(body);
}

/** GitHub answers a taken name with a 422 whose errors say it already exists. */
function githubTaken(body: string): boolean {
  return /already exists/i.test(body);
}

async function createOnGitlab(p: Probes, i: ForgeRepoRequest): Promise<{ remote: string }> {
  const headers = { "PRIVATE-TOKEN": i.token };
  const lookup = "GitLab namespace lookup";
  const ns = await p.fetch(`https://${i.host}/api/v4/namespaces/${encodeURIComponent(i.namespace)}`, { headers, timeoutMs: FORGE_API_TIMEOUT_MS });
  if (ns.status === 404 || ns.status === 403) throw unseen(i, lookup, ns);
  const id = ns.status === 200 ? parsed(ns.body)?.["id"] : undefined;
  if (typeof id !== "number") throw failed(i, lookup, ns);

  const step = "GitLab project create";
  const res = await p.fetch(`https://${i.host}/api/v4/projects`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: i.name, path: i.name, namespace_id: id, visibility: "private" }),
    timeoutMs: FORGE_API_TIMEOUT_MS,
  });
  if (res.status === 400 && gitlabTaken(res.body)) throw exists(i, `https://${i.host}/${i.namespace}/${i.name}.git`);
  if (res.status !== 201) throw failed(i, step, res);
  return remoteFrom(i, step, res, "http_url_to_repo");
}

async function createOnGithub(p: Probes, i: ForgeRepoRequest): Promise<{ remote: string }> {
  const own = i.login !== null && sameUser(i.namespace, i.login);
  const step = own ? "GitHub repo create" : "GitHub org repo create";
  const url = own ? "https://api.github.com/user/repos" : `https://api.github.com/orgs/${encodeURIComponent(i.namespace)}/repos`;
  const res = await p.fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${i.token}`, Accept: "application/vnd.github+json", "User-Agent": "rt-setup", "Content-Type": "application/json" },
    body: JSON.stringify({ name: i.name, private: true }),
    timeoutMs: FORGE_API_TIMEOUT_MS,
  });
  if (res.status === 422 && githubTaken(res.body)) throw exists(i, `https://github.com/${i.namespace}/${i.name}.git`);
  if (!own && res.status === 404) throw unseen(i, step, res);
  if (res.status !== 201) throw failed(i, step, res);
  return remoteFrom(i, step, res, "clone_url");
}

export async function createForgeRepo(p: Probes, i: ForgeRepoRequest): Promise<{ remote: string }> {
  return i.provider === "gitlab" ? createOnGitlab(p, i) : createOnGithub(p, i);
}
