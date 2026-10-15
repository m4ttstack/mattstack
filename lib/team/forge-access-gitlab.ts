/**
 * GitLab's half of OrgForgeAccess. The data branch's push list is the
 * protected branch's "Allowed to push and merge" user entries, which GitLab
 * offers on Premium and Ultimate. A new protection starts open to Developers,
 * so on a plan that cannot name people team owners can still push; once the
 * named users land, setPushList drops that Developer entry.
 * Levels: Reporter (20) is read, Developer (30) is write.
 */

import type { Probes } from "../setup/probes.ts";
import { forgeAuthEnv, lookupGitlabUserId, revokeRead } from "./forge.ts";
import { apiText, done, forgeApi, httpStatus, pagedList, parseJson, refusal, type AccessLevel, type ApiCall, type ForgeMember, type OrgForgeAccess } from "./forge-access.ts";

const DEVELOPER = 30;
const MAINTAINER = 40;
const LEVEL_NUMBER = { read: 20, write: DEVELOPER } as const;
const ROLE_NAME = { read: "Reporter", write: "Developer" } as const;

function levelOf(n: number): AccessLevel {
  if (n >= MAINTAINER) return "admin";
  if (n >= DEVELOPER) return "write";
  if (n >= 20) return "read";
  return n > 0 ? "guest" : "none";
}

interface PushEntry {
  id: number;
  access_level: number;
  user_id: number | null;
  group_id: number | null;
}

function pushEntries(stdout: string): PushEntry[] {
  const levels = (parseJson(stdout) as { push_access_levels?: unknown } | null)?.push_access_levels;
  if (!Array.isArray(levels)) return [];
  return levels.flatMap((e: Record<string, unknown>) =>
    typeof e?.id === "number" && typeof e.access_level === "number"
      ? [{ id: e.id, access_level: e.access_level, user_id: typeof e.user_id === "number" ? e.user_id : null, group_id: typeof e.group_id === "number" ? e.group_id : null }]
      : [],
  );
}

const isDeveloperRole = (e: PushEntry) => e.user_id === null && e.group_id === null && e.access_level === DEVELOPER;

export function gitlabForgeAccess(p: Probes, remote: string, host: string, path: string, token: string | null): OrgForgeAccess {
  const env = forgeAuthEnv("gitlab", host, token);
  const project = `projects/${encodeURIComponent(path)}`;
  const membersPage = `https://${host}/${path}/-/project_members`;
  const branchesPage = `https://${host}/${path}/-/settings/repository`;
  const call = (c: ApiCall) => forgeApi(p, "glab", env, c);
  const rulePath = (branch: string) => `${project}/protected_branches/${encodeURIComponent(branch)}`;
  const ids = new Map<string, number>();
  const names = new Map<number, string>();
  const remember = (username: string, id: number) => {
    ids.set(username.toLowerCase(), id);
    names.set(id, username);
  };

  async function idOf(username: string): Promise<number | null> {
    const known = ids.get(username.toLowerCase());
    if (known !== undefined) return known;
    const lookup = await lookupGitlabUserId(p, host, username, token);
    if (lookup.id === null) return null;
    remember(username, lookup.id);
    return lookup.id;
  }

  async function nameOf(id: number): Promise<string | null> {
    const known = names.get(id);
    if (known) return known;
    const r = await call({ method: "GET", path: `users/${id}` });
    const username = r.code === 0 ? (parseJson(r.stdout) as { username?: unknown } | null)?.username : null;
    if (typeof username !== "string") return null;
    remember(username, id);
    return username;
  }

  const unknownUser = (username: string) => ({ ok: false as const, reason: "unknown-handle" as const, manualSteps: [`Check that "${username}" is a real GitLab username: it was not found`] });

  return {
    provider: "gitlab",

    async defaultBranch() {
      const r = await call({ method: "GET", path: project });
      const branch = r.code === 0 ? (parseJson(r.stdout) as { default_branch?: unknown } | null)?.default_branch : null;
      return typeof branch === "string" ? done(branch) : refusal(r, "glab", [`Open https://${host}/${path}`, "Check that your GitLab account can see this project"]);
    },

    async readPushList(branch) {
      const r = await call({ method: "GET", path: rulePath(branch) });
      if (r.code !== 0) {
        if (httpStatus(r) !== 404) return refusal(r, "glab", [`Open ${branchesPage}`, `Check the protected branch rule for ${branch}`]);
        const exists = await call({ method: "GET", path: `${project}/repository/branches/${encodeURIComponent(branch)}` });
        return exists.code === 0 ? done({ kind: "unprotected" }) : refusal(exists, "glab", [`Push the ${branch} branch, then run this again: rt team forge-access`]);
      }
      const entries = pushEntries(r.stdout);
      if (entries.some(isDeveloperRole)) return done({ kind: "open", why: `The ${branch} branch lets every Developer push` });
      const users: string[] = [];
      for (const entry of entries) {
        if (entry.user_id === null) continue;
        const username = await nameOf(entry.user_id);
        if (username) users.push(username);
      }
      return done({ kind: "named", users });
    },

    async setPushList(branch, usernames) {
      const current = await call({ method: "GET", path: rulePath(branch) });
      if (current.code !== 0) return refusal(current, "glab", [`Open ${branchesPage}`, `Protect the ${branch} branch first`]);
      const entries = pushEntries(current.stdout);
      const wanted = new Map<number, string>();
      for (const username of usernames) {
        const id = await idOf(username);
        if (id === null) return unknownUser(username);
        wanted.set(id, username);
      }
      const changes = [
        ...[...wanted.keys()].filter((id) => !entries.some((e) => e.user_id === id)).map((user_id) => ({ user_id })),
        ...entries.filter((e) => e.user_id !== null && !wanted.has(e.user_id)).map((e) => ({ id: e.id, _destroy: true })),
      ];
      if (changes.length > 0) {
        const r = await call({ method: "PATCH", path: rulePath(branch), body: { allowed_to_push: changes } });
        if (r.code !== 0 && [401, 403, 404].includes(httpStatus(r) ?? 0)) {
          return refusal(r, "glab", [`Open ${branchesPage}`, `In the protected branch rule for ${branch}, let only ${usernames.join(", ")} push`]);
        }
      }
      // Read back rather than trust the PATCH: a plan that cannot name people may drop the user entries without an error.
      const after = await call({ method: "GET", path: rulePath(branch) });
      const now = after.code === 0 ? pushEntries(after.stdout) : entries;
      if ([...wanted.keys()].every((id) => now.some((e) => e.user_id === id))) {
        const developers = now.filter(isDeveloperRole).map((e) => ({ id: e.id, _destroy: true }));
        if (developers.length > 0) {
          const closed = await call({ method: "PATCH", path: rulePath(branch), body: { allowed_to_push: developers } });
          if (closed.code !== 0) return refusal(closed, "glab", [`Open ${branchesPage}`, `Stop letting every Developer push ${branch}`]);
        }
        return done("set");
      }
      if (now.some(isDeveloperRole)) return done("cannot-name-users");
      return {
        ok: false,
        reason: "other",
        manualSteps: [`Open ${branchesPage}`, `This GitLab plan can't name who may push, so let Developers push the ${branch} branch, or team owners can't publish`],
      };
    },

    async readMembers() {
      const all = await call({ method: "GET", path: `${project}/members/all?per_page=100`, paginate: true });
      const allList = all.code === 0 ? pagedList(all.stdout, "glab") : null;
      if (allList === null) return refusal(all, "glab", [`Open ${membersPage}`]);
      const direct = await call({ method: "GET", path: `${project}/members?per_page=100`, paginate: true });
      if (direct.code !== 0) return refusal(direct, "glab", [`Open ${membersPage}`]);
      const directIds = new Set((pagedList(direct.stdout, "glab") ?? []).map((m) => m.id).filter((id): id is number => typeof id === "number"));
      const members: ForgeMember[] = [];
      for (const m of allList) {
        if (typeof m.username !== "string" || typeof m.id !== "number" || typeof m.access_level !== "number") continue;
        remember(m.username, m.id);
        members.push({ username: m.username, level: levelOf(m.access_level), inherited: !directIds.has(m.id), pending: m.membership_state === "awaiting" });
      }
      return done(members);
    },

    async grant(username, level) {
      const id = await idOf(username);
      if (id === null) return unknownUser(username);
      const accessLevel = `access_level=${LEVEL_NUMBER[level]}`;
      const added = await call({ method: "POST", path: `${project}/members`, fields: [`user_id=${id}`, accessLevel] });
      if (added.code === 0) return done("granted");
      if (httpStatus(added) === 409 || /already exists/i.test(apiText(added))) {
        const changed = await call({ method: "PUT", path: `${project}/members/${id}`, fields: [accessLevel] });
        if (changed.code === 0) return done("granted");
        return refusal(changed, "glab", [`Open ${membersPage}`, `Change ${username}'s role to ${ROLE_NAME[level]}`]);
      }
      return refusal(added, "glab", [`Open ${membersPage}`, `Invite ${username} with the ${ROLE_NAME[level]} role`]);
    },

    async revoke(username) {
      const r = await revokeRead(p, remote, username, token);
      return r.access === "revoked" ? done("revoked") : { ok: false, reason: "other", manualSteps: r.manualSteps };
    },

    async protect(branch) {
      const r = await call({ method: "POST", path: `${project}/protected_branches`, body: { name: branch, push_access_level: DEVELOPER, merge_access_level: MAINTAINER, allow_force_push: false } });
      if (r.code === 0 || httpStatus(r) === 409) return done("protected");
      return refusal(r, "glab", [`Open ${branchesPage}`, `Protect the ${branch} branch, with Developers allowed to push`]);
    },
  };
}
