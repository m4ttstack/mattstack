/**
 * In-memory GitHub and GitLab, driven through the same `gh api` / `glab api`
 * argv the real CLIs take, so OrgForgeAccess's contract suite runs one set of
 * tests against both. Error output copies each CLI's shape: the body as JSON
 * on stdout, "<cli>: <message> (HTTP <status>)" on stderr.
 */

import type { ExecResult, Probes } from "../../setup/probes.ts";
import { LEVEL_RANK, type AccessLevel } from "../forge-access.ts";

export interface FakeMember {
  level: AccessLevel;
  inherited?: boolean;
  pending?: boolean;
}

export interface FakeForgeOpts {
  /** Accounts that exist on the forge. */
  users: string[];
  members?: Record<string, FakeMember>;
  /** Defaults to ["main", "mattstack"]. */
  branches?: string[];
  /** Defaults to "main". */
  defaultBranch?: string;
  /** GitHub: a repo a personal account owns. GitLab: the Free plan. Either way the forge cannot name who may push. */
  cannotNameUsers?: boolean;
  /** GitHub only: a private repo on a free plan, which cannot protect any branch. */
  cannotProtect?: boolean;
  /** The token reads but cannot change access: every write is HTTP 403. */
  readOnly?: boolean;
  /** GitHub: accounts added at once rather than invited (members of the owning organization). */
  addedDirectly?: string[];
}

type Exec = (argv: string[], opts?: Parameters<Probes["exec"]>[1]) => ExecResult;

export interface FakeForge {
  exec: Exec;
  /** "METHOD path" for every call that is not a GET. */
  writes: string[];
  members: () => Record<string, { level: AccessLevel; inherited: boolean; pending: boolean }>;
}

export function parseApi(argv: string[], input?: string): { method: string; path: string; fields: Record<string, string>; paginate: boolean; body: unknown } {
  const rest = argv.slice(argv.indexOf("api") + 1);
  let method = "GET";
  let path = "";
  let paginate = false;
  const fields: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "-X") method = rest[++i]!;
    else if (arg === "-f" || arg === "-F") {
      const [key, ...value] = rest[++i]!.split("=");
      fields[key!] = value.join("=");
    } else if (arg === "--input") i++;
    else if (arg === "--paginate" || arg === "--slurp") paginate = true;
    else if (!arg.startsWith("-") && path === "") path = arg;
  }
  return { method, path, fields, paginate, body: input ? JSON.parse(input) : undefined };
}

function memberTable(opts: FakeForgeOpts) {
  return new Map(
    Object.entries(opts.members ?? {}).map(([username, m]) => [username.toLowerCase(), { username, level: m.level, inherited: m.inherited ?? false, pending: m.pending ?? false }]),
  );
}

function snapshot(table: ReturnType<typeof memberTable>) {
  return () => Object.fromEntries([...table.values()].map((m) => [m.username, { level: m.level, inherited: m.inherited, pending: m.pending }]));
}

const okJson = (body?: unknown): ExecResult => ({ code: 0, stdout: body === undefined ? "" : JSON.stringify(body), stderr: "" });

export function fakeGitHub(opts: FakeForgeOpts): FakeForge {
  const members = memberTable(opts);
  const branches = new Set(opts.branches ?? ["main", "mattstack"]);
  const rules = new Map<string, { restricted: boolean; users: string[] }>();
  const writes: string[] = [];
  const base = "/repos/acme/widgets";
  const fail = (status: number, message: string): ExecResult => ({ code: 1, stdout: JSON.stringify({ message }), stderr: `gh: ${message} (HTTP ${status})` });
  const exists = (user: string) => opts.users.some((u) => u.toLowerCase() === user.toLowerCase());

  const exec: Exec = (argv, o) => {
    const { method, path, fields, paginate, body } = parseApi(argv, o?.input);
    if (method !== "GET") writes.push(`${method} ${path}`);
    if (method !== "GET" && opts.readOnly) return fail(403, "Must have admin rights to Repository.");
    const [route = "", query = ""] = path.split("?");
    const page = (items: unknown[]) => okJson(paginate ? [items] : items);

    if (method === "GET" && route === base) return okJson({ default_branch: opts.defaultBranch ?? "main", owner: { type: opts.cannotNameUsers ? "User" : "Organization" } });
    if (method === "GET" && route === `${base}/collaborators`) {
      const directOnly = query.includes("affiliation=direct");
      const roleName = (level: AccessLevel) => (level === "admin" ? "admin" : level === "write" ? "write" : level === "read" ? "read" : "none");
      return page([...members.values()].filter((m) => !m.pending && (!directOnly || !m.inherited)).map((m) => ({ login: m.username, role_name: roleName(m.level) })));
    }
    if (method === "GET" && route === `${base}/invitations`) {
      return page([...members.values()].filter((m) => m.pending).map((m) => ({ invitee: { login: m.username }, permissions: m.level === "write" ? "write" : "read" })));
    }

    const collaborator = /^\/repos\/acme\/widgets\/collaborators\/([^/]+)$/.exec(route);
    if (collaborator) {
      const user = decodeURIComponent(collaborator[1]!);
      if (method === "DELETE") {
        members.delete(user.toLowerCase());
        return okJson();
      }
      if (!exists(user)) return fail(404, "Not Found");
      const level: AccessLevel = opts.cannotNameUsers || fields.permission === "push" ? "write" : "read";
      const current = members.get(user.toLowerCase());
      if (current && !current.pending) {
        Object.assign(current, { level, inherited: false });
        return okJson();
      }
      const direct = (opts.addedDirectly ?? []).some((u) => u.toLowerCase() === user.toLowerCase());
      members.set(user.toLowerCase(), { username: user, level, inherited: false, pending: !direct });
      return direct ? okJson() : okJson({ id: 1, invitee: { login: user } });
    }

    const protection = /^\/repos\/acme\/widgets\/branches\/([^/]+)\/protection(\/restrictions\/users)?$/.exec(route);
    if (protection) {
      const branch = decodeURIComponent(protection[1]!);
      if (!branches.has(branch)) return fail(404, "Branch not found");
      if (opts.cannotProtect) return fail(403, "Upgrade to GitHub Pro or make this repository public to enable this feature.");
      const rule = rules.get(branch);
      if (!protection[2]) {
        if (method === "GET") return rule ? okJson(rule.restricted ? { restrictions: { users: rule.users.map((login) => ({ login })), teams: [], apps: [] } } : {}) : fail(404, "Branch not protected");
        if (method === "DELETE") {
          rules.delete(branch);
          return okJson();
        }
        const restrictions = (body as { restrictions?: { users?: string[] } | null }).restrictions;
        if (restrictions && opts.cannotNameUsers) return fail(422, "Only organization repositories can have users and team restrictions");
        rules.set(branch, { restricted: Boolean(restrictions), users: restrictions?.users ?? [] });
        return okJson({});
      }
      if (!rule || !rule.restricted) return fail(404, "Push restrictions not enabled");
      const users = (body as { users: string[] }).users;
      const lacking = users.filter((u) => {
        const m = members.get(u.toLowerCase());
        return !m || m.pending || LEVEL_RANK[m.level] < LEVEL_RANK.write;
      });
      if (lacking.length > 0) return fail(422, `Validation Failed: ${lacking.join(", ")} must have push access`);
      rule.users = [...users];
      return okJson(users.map((login) => ({ login })));
    }
    return fail(404, `fake gh has no route for ${method} ${path}`);
  };

  return { exec, writes, members: snapshot(members) };
}
