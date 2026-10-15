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

const GITLAB_LEVEL: Record<AccessLevel, number> = { none: 0, guest: 10, read: 20, write: 30, admin: 40 };
const fromGitlab = (n: number): AccessLevel => (n >= 40 ? "admin" : n >= 30 ? "write" : n >= 20 ? "read" : n > 0 ? "guest" : "none");

export function fakeGitLab(opts: FakeForgeOpts): FakeForge {
  const members = memberTable(opts);
  const branches = new Set(opts.branches ?? ["main", "mattstack"]);
  const ids = new Map(opts.users.map((u, i) => [u.toLowerCase(), 101 + i]));
  const nameOf = (id: number) => opts.users.find((u) => ids.get(u.toLowerCase()) === id);
  const rules = new Map<string, { id: number; access_level: number; user_id: number | null; group_id: null }[]>();
  let nextEntry = 1;
  const writes: string[] = [];
  const project = "projects/acme%2Fwidgets";
  const fail = (status: number, message: string): ExecResult => ({ code: 1, stdout: JSON.stringify({ message }), stderr: `glab: ${status} ${message} (HTTP ${status})` });
  const row = (m: { username: string; level: AccessLevel; pending: boolean }) => ({ id: ids.get(m.username.toLowerCase()), username: m.username, access_level: GITLAB_LEVEL[m.level], membership_state: m.pending ? "awaiting" : "active" });

  const exec: Exec = (argv, o) => {
    const { method, path, fields, body } = parseApi(argv, o?.input);
    if (method !== "GET") writes.push(`${method} ${path}`);
    if (method !== "GET" && opts.readOnly) return fail(403, "Forbidden");
    const [route = "", query = ""] = path.split("?");

    if (route === "users") {
      const wanted = new URLSearchParams(query).get("username") ?? "";
      const id = ids.get(wanted.toLowerCase());
      return okJson(id === undefined ? [] : [{ id, username: nameOf(id) }]);
    }
    const user = /^users\/(\d+)$/.exec(route);
    if (user) {
      const name = nameOf(Number(user[1]));
      return name ? okJson({ id: Number(user[1]), username: name }) : fail(404, "404 User Not Found");
    }
    if (route === project) return okJson({ default_branch: opts.defaultBranch ?? "main" });
    if (method === "GET" && route === `${project}/members/all`) return okJson([...members.values()].map(row));
    if (method === "GET" && route === `${project}/members`) return okJson([...members.values()].filter((m) => !m.inherited).map(row));
    if (method === "POST" && route === `${project}/members`) {
      const name = nameOf(Number(fields.user_id));
      if (!name) return fail(404, "404 User Not Found");
      const current = members.get(name.toLowerCase());
      if (current && !current.inherited) return fail(409, "Member already exists");
      members.set(name.toLowerCase(), { username: name, level: fromGitlab(Number(fields.access_level)), inherited: false, pending: false });
      return okJson({});
    }
    const member = /^projects\/acme%2Fwidgets\/members\/(\d+)$/.exec(route);
    if (member) {
      const name = nameOf(Number(member[1]));
      const current = name ? members.get(name.toLowerCase()) : undefined;
      if (!name || !current || current.inherited) return fail(404, "404 Not found");
      if (method === "DELETE") members.delete(name.toLowerCase());
      else current.level = fromGitlab(Number(fields.access_level));
      return okJson({});
    }
    const branchRoute = /^projects\/acme%2Fwidgets\/repository\/branches\/(.+)$/.exec(route);
    if (branchRoute) return branches.has(decodeURIComponent(branchRoute[1]!)) ? okJson({}) : fail(404, "404 Branch Not Found");
    if (method === "POST" && route === `${project}/protected_branches`) {
      const b = body as { name?: string } | undefined;
      const name = b?.name ?? fields.name ?? "";
      if (rules.has(name)) return fail(409, "Protected branch already exists");
      const level = Number((body as { push_access_level?: number } | undefined)?.push_access_level ?? fields.push_access_level ?? 40);
      rules.set(name, [{ id: nextEntry++, access_level: level, user_id: null, group_id: null }]);
      return okJson({});
    }
    const rule = /^projects\/acme%2Fwidgets\/protected_branches\/(.+)$/.exec(route);
    if (rule) {
      const name = decodeURIComponent(rule[1]!);
      const entries = rules.get(name);
      if (!entries) return fail(404, "404 Not found");
      if (method === "GET") return okJson({ name, push_access_levels: entries });
      if (method === "DELETE") {
        rules.delete(name);
        return okJson();
      }
      for (const change of (body as { allowed_to_push: Record<string, unknown>[] }).allowed_to_push) {
        if (change._destroy === true) rules.set(name, (rules.get(name) ?? []).filter((e) => e.id !== change.id));
        else if (typeof change.user_id === "number" && !opts.cannotNameUsers) rules.get(name)!.push({ id: nextEntry++, access_level: 40, user_id: change.user_id, group_id: null });
        else if (typeof change.access_level === "number") rules.get(name)!.push({ id: nextEntry++, access_level: change.access_level, user_id: null, group_id: null });
      }
      return okJson({});
    }
    return fail(404, `fake glab has no route for ${method} ${path}`);
  };

  return { exec, writes, members: snapshot(members) };
}
