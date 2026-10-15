import { readFile } from "fs/promises";
import { join } from "path";
import { rolesFrom, type OrgRoles } from "../../packages/rt-client/src/settings/active-team.ts";
import { hasMalformedOrgBlock, orgStoreChangeRefusal } from "../../packages/rt-client/src/settings/org-store-guard.ts";
import { roleOf, type OrgRole } from "../../packages/rt-client/src/settings/org-roles.ts";
import { ORG_STORE_REL } from "../../packages/rt-client/src/settings/paths.ts";
import { parseStoreTextStrict, type StoreFile } from "../../packages/rt-client/src/settings/stores.ts";
import { runCapture } from "../subprocess.ts";

export { ORG_STORE_REL };

type Run = (argv: [string, ...string[]]) => Promise<{ code: number; stdout: string }>;

/** Short: the daemon's commit and push gates wait on these reads. */
const GIT_TIMEOUT_MS = 5_000;

const realRun: Run = async (argv) => {
  const r = await runCapture(argv, { timeoutMs: GIT_TIMEOUT_MS });
  return { code: r.exitCode, stdout: r.stdout };
};

/** The org store at a ref: its text, absent (the ref exists but has no org store), or unreadable (any other git failure). */
export type BaseStore = { state: "text"; text: string } | { state: "absent" } | { state: "unreadable" };

export async function readStoreAt(repoDir: string, ref: string, run: Run = realRun): Promise<BaseStore> {
  const listed = await run(["git", "-C", repoDir, "ls-tree", "--name-only", ref, "--", ORG_STORE_REL]);
  if (listed.code !== 0) return { state: "unreadable" };
  if (listed.stdout.trim() === "") return { state: "absent" };
  const shown = await run(["git", "-C", repoDir, "show", `${ref}:${ORG_STORE_REL}`]);
  return shown.code === 0 ? { state: "text", text: shown.stdout } : { state: "unreadable" };
}

/** `readStoreAt` remembered per commit, so the daemon's commit gate spends one git call while the ref stays put. A failed read is not remembered. */
export function storeReader(repoDir: string, run: Run = realRun): (ref: string) => Promise<BaseStore> {
  let memo: { sha: string; store: BaseStore } | null = null;
  return async (ref) => {
    const resolved = await run(["git", "-C", repoDir, "rev-parse", "--verify", "-q", `${ref}^{commit}`]);
    if (resolved.code !== 0) return { state: "unreadable" };
    const sha = resolved.stdout.trim();
    if (memo?.sha === sha) return memo.store;
    const store = await readStoreAt(repoDir, sha, run);
    if (store.state !== "unreadable") memo = { sha, store };
    return store;
  };
}

/** An org whose store names no admins and no owners is not claimed yet: the creator's first write has no committed role to be judged by. */
export function isUnclaimed(roles: OrgRoles): boolean {
  return roles.admins.length === 0 && roles.owners.length === 0;
}

/** The roles a store names, or null when its `mattstack.org` block (flat, versioned or nested spelling) is present but malformed, so a broken block never reads as an unclaimed org. */
export function orgRolesOf(store: StoreFile): OrgRoles | null {
  if (hasMalformedOrgBlock(store)) return null;
  return rolesFrom(store);
}

/** The role the base org store gives this user, so an uncommitted or unpushed edit cannot grant itself the role that approves it. Absent or unclaimed base: the fallback; unreadable or malformed base: unknown. */
export function roleFromBase(base: BaseStore, username: string | null, fallback: OrgRole): OrgRole {
  if (base.state === "absent") return fallback;
  if (base.state === "unreadable") return { kind: "unknown" };
  const store = parseStoreTextStrict(ORG_STORE_REL, base.text);
  if (store === null) return { kind: "unknown" };
  const roles = orgRolesOf(store);
  if (roles === null) return { kind: "unknown" };
  return isUnclaimed(roles) ? fallback : roleOf(username, roles);
}

/** `unreadable` is a git failure reading the base or the committed store, kept apart from `refused` (read, change not allowed) so the push gate can say which one happened. */
export type OrgStoreScope = "in-scope" | "refused" | "unreadable";

/** Whether the org store change from `base` to the file at `afterRef` (or the working file when null) passes the guard for `judge`. */
export async function orgStoreInScope(repoDir: string, base: BaseStore, judge: OrgRole, afterRef: string | null = null, run: Run = realRun): Promise<OrgStoreScope> {
  if (base.state === "unreadable") return "unreadable";
  let after: string;
  if (afterRef === null) {
    try {
      after = await readFile(join(repoDir, ORG_STORE_REL), "utf8");
    } catch {
      return "refused";
    }
  } else {
    const at = await readStoreAt(repoDir, afterRef, run);
    if (at.state === "unreadable") return "unreadable";
    after = at.state === "text" ? at.text : "{}";
  }
  const before = base.state === "text" ? base.text : "{}";
  const [was, now] = [parseStoreTextStrict(ORG_STORE_REL, before), parseStoreTextStrict(ORG_STORE_REL, after)];
  if (was === null || now === null) return "refused";
  if (before === after) return "in-scope";
  return orgStoreChangeRefusal(judge, was, now) === null ? "in-scope" : "refused";
}
