/**
 * GitHub's half of OrgForgeAccess. The data branch's push list is branch
 * protection's push restriction (`restrictions.users`), which GitHub offers
 * only on repos an organization owns, and protects a private repo's branches
 * only on a paid plan. Collaborator levels: `pull` is read, `push` is write.
 */

import { sameUser } from "../../packages/rt-client/src/settings/active-team.ts";
import type { Probes } from "../setup/probes.ts";
import { forgeAuthEnv, revokeRead } from "./forge.ts";
import { apiText, done, forgeApi, httpStatus, pagedList, parseJson, refusal, type AccessLevel, type ApiCall, type ForgeMember, type OrgForgeAccess } from "./forge-access.ts";

const NOT_PROTECTED = /Branch not protected/i;
const BRANCH_MISSING = /Branch not found/i;
const PLAN_LIMIT = /Upgrade to GitHub Pro|make this repository public to enable this feature/i;
const ORG_ONLY = /Only organization repositories can have users and team restrictions/i;

function levelOf(entry: Record<string, unknown>): AccessLevel {
  const role = typeof entry.role_name === "string" ? entry.role_name : "";
  const perms = (entry.permissions ?? {}) as Record<string, unknown>;
  if (role === "admin" || role === "maintain" || perms.admin === true || perms.maintain === true) return "admin";
  if (role === "write" || perms.push === true) return "write";
  if (role === "read" || role === "triage" || perms.pull === true || perms.triage === true) return "read";
  return "none";
}

function inviteLevel(permission: unknown): AccessLevel {
  if (permission === "admin" || permission === "maintain") return "admin";
  if (permission === "write") return "write";
  return permission === "read" || permission === "triage" ? "read" : "none";
}

function login(entry: unknown): string | null {
  const value = (entry as { login?: unknown } | null)?.login;
  return typeof value === "string" ? value : null;
}

export function githubForgeAccess(p: Probes, remote: string, owner: string, repo: string, token: string | null): OrgForgeAccess {
  const env = forgeAuthEnv("github", "github.com", token);
  const base = `/repos/${owner}/${repo}`;
  const accessPage = `https://github.com/${owner}/${repo}/settings/access`;
  const branchesPage = `https://github.com/${owner}/${repo}/settings/branches`;
  const call = (c: ApiCall) => forgeApi(p, "gh", env, c);
  const protection = (branch: string) => `${base}/branches/${encodeURIComponent(branch)}/protection`;
  let ownerType: Promise<unknown> | null = null;
  const personal = async () => {
    ownerType ??= call({ method: "GET", path: base }).then((r) => (r.code === 0 ? (parseJson(r.stdout) as { owner?: { type?: unknown } } | null)?.owner?.type : null));
    return (await ownerType) === "User";
  };

  return {
    provider: "github",

    async defaultBranch() {
      const r = await call({ method: "GET", path: base });
      const branch = r.code === 0 ? (parseJson(r.stdout) as { default_branch?: unknown } | null)?.default_branch : null;
      return typeof branch === "string" ? done(branch) : refusal(r, "gh", [`Open https://github.com/${owner}/${repo}`, "Check that your GitHub account can see this repo"]);
    },

    async readPushList(branch) {
      const r = await call({ method: "GET", path: protection(branch) });
      if (r.code === 0) {
        const users = (parseJson(r.stdout) as { restrictions?: { users?: unknown } } | null)?.restrictions?.users;
        if (!Array.isArray(users)) return done({ kind: "open", why: `The ${branch} branch is protected, but its rule does not limit who can push` });
        return done({ kind: "named", users: users.map(login).filter((u): u is string => u !== null) });
      }
      const text = apiText(r);
      if (NOT_PROTECTED.test(text)) return done({ kind: "unprotected" });
      if (PLAN_LIMIT.test(text)) return done({ kind: "unavailable", why: "GitHub protects a private repo's branches only on a paid plan" });
      if (BRANCH_MISSING.test(text)) return refusal(r, "gh", [`Push the ${branch} branch, then run this again: rt team forge-access`]);
      return refusal(r, "gh", [`Open ${branchesPage}`, `Check the rule for the ${branch} branch`]);
    },

    async setPushList(branch, usernames) {
      if (await personal()) return done("cannot-name-users");
      const r = await call({ method: "PUT", path: `${protection(branch)}/restrictions/users`, body: { users: usernames } });
      if (r.code === 0) return done("set");
      if (ORG_ONLY.test(apiText(r))) return done("cannot-name-users");
      if (httpStatus(r) === 404) {
        return refusal(r, "gh", [`Open ${branchesPage}`, `Edit the rule for ${branch} and turn on "Restrict who can push to matching branches"`, "Then run: rt team forge-access --apply"]);
      }
      return refusal(r, "gh", [`Open ${branchesPage}`, `In the rule for ${branch}, let only ${usernames.join(", ")} push`]);
    },

    async readMembers() {
      const all = await call({ method: "GET", path: `${base}/collaborators?affiliation=all&per_page=100`, paginate: true });
      const allList = all.code === 0 ? pagedList(all.stdout, "gh") : null;
      if (allList === null) return refusal(all, "gh", [`Open ${accessPage}`]);
      const direct = await call({ method: "GET", path: `${base}/collaborators?affiliation=direct&per_page=100`, paginate: true });
      if (direct.code !== 0) return refusal(direct, "gh", [`Open ${accessPage}`]);
      const invites = await call({ method: "GET", path: `${base}/invitations?per_page=100`, paginate: true });
      if (invites.code !== 0) return refusal(invites, "gh", [`Open ${accessPage}`]);
      const directNames = (pagedList(direct.stdout, "gh") ?? []).map(login).filter((u): u is string => u !== null);
      const members: ForgeMember[] = allList.flatMap((entry) => {
        const username = login(entry);
        return username ? [{ username, level: levelOf(entry), inherited: !directNames.some((d) => sameUser(d, username)), pending: false }] : [];
      });
      for (const invite of pagedList(invites.stdout, "gh") ?? []) {
        const username = login(invite.invitee);
        if (username && !members.some((m) => sameUser(m.username, username))) members.push({ username, level: inviteLevel(invite.permissions), inherited: false, pending: true });
      }
      return done(members);
    },

    async grant(username, level) {
      const isPersonal = await personal();
      if (isPersonal && level === "read") {
        return { ok: false, reason: "other", manualSteps: [`${username} can't have read access only: a repo a personal GitHub account owns gives every collaborator write. Move the repo into a GitHub organization to change that.`] };
      }
      const r = await call({ method: "PUT", path: `${base}/collaborators/${encodeURIComponent(username)}`, fields: isPersonal ? [] : [`permission=${level === "write" ? "push" : "pull"}`] });
      // An invitation body (201) means access starts once they accept; an empty 204 means it is in effect now.
      if (r.code === 0) return done(r.stdout.trim().length > 0 ? "invited" : "granted");
      return refusal(r, "gh", [`Open ${accessPage}`, `Give ${username} ${level === "write" ? "Write" : "Read"} access`]);
    },

    async revoke(username) {
      const r = await revokeRead(p, remote, username, token);
      return r.access === "revoked" ? done("revoked") : { ok: false, reason: "other", manualSteps: r.manualSteps };
    },

    async protect(branch) {
      const rule = (restrictions: unknown) => ({ required_status_checks: null, enforce_admins: false, required_pull_request_reviews: null, restrictions, allow_force_pushes: false, allow_deletions: false });
      let r = await call({ method: "PUT", path: protection(branch), body: rule((await personal()) ? null : { users: [], teams: [], apps: [] }) });
      if (r.code !== 0 && ORG_ONLY.test(apiText(r))) r = await call({ method: "PUT", path: protection(branch), body: rule(null) });
      if (r.code === 0) return done("protected");
      if (PLAN_LIMIT.test(apiText(r))) return done("unavailable");
      return refusal(r, "gh", [`Open ${branchesPage}`, `Add a rule for the ${branch} branch that restricts who can push`]);
    },
  };
}
