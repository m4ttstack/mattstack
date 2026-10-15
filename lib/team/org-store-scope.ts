import { readFileSync } from "fs";
import { join } from "path";
import { rolesFrom, type OrgRoles } from "../../packages/rt-client/src/settings/active-team.ts";
import { orgStoreChangeRefusal } from "../../packages/rt-client/src/settings/org-store-guard.ts";
import { roleOf, type OrgRole } from "../../packages/rt-client/src/settings/org-roles.ts";
import { parseStoreText } from "../../packages/rt-client/src/settings/stores.ts";
import { childEnv } from "../subprocess.ts";

export const ORG_STORE_REL = "mattstack/org/settings.org.jsonc";

type Run = (argv: string[]) => { code: number; stdout: string };

/** Same budget as the snapshot engine's other git calls; kept here because home-snapshot.ts imports this file. */
const GIT_TIMEOUT_MS = 15_000;

// Bun.spawnSync because `readAuthorization` is synchronous and the probes exec seam is async.
const realRun: Run = (argv) => {
  const r = Bun.spawnSync(argv, { env: childEnv(), stdout: "pipe", stderr: "ignore", timeout: GIT_TIMEOUT_MS });
  return { code: r.exitCode ?? -1, stdout: r.stdout.toString() };
};

/** The org store at a ref: its text, absent (the ref exists but has no org store), or unreadable (any other git failure). */
export type BaseStore = { state: "text"; text: string } | { state: "absent" } | { state: "unreadable" };

export function readStoreAt(repoDir: string, ref: string, run: Run = realRun): BaseStore {
  const listed = run(["git", "-C", repoDir, "ls-tree", "--name-only", ref, "--", ORG_STORE_REL]);
  if (listed.code !== 0) return { state: "unreadable" };
  if (listed.stdout.trim() === "") return { state: "absent" };
  const shown = run(["git", "-C", repoDir, "show", `${ref}:${ORG_STORE_REL}`]);
  return shown.code === 0 ? { state: "text", text: shown.stdout } : { state: "unreadable" };
}

/** An org whose store names no admins and no owners is not claimed yet: the creator's first write has no committed role to be judged by. */
export function isUnclaimed(roles: OrgRoles): boolean {
  return roles.admins.length === 0 && roles.owners.length === 0;
}

/** The role the base org store gives this user, so an uncommitted or unpushed edit cannot grant itself the role that approves it. Absent or unclaimed base: the fallback; unreadable base: unknown. */
export function roleFromBase(base: BaseStore, username: string | null, fallback: OrgRole): OrgRole {
  if (base.state === "absent") return fallback;
  if (base.state === "unreadable") return { kind: "unknown" };
  const roles = rolesFrom(parseStoreText(ORG_STORE_REL, base.text));
  return isUnclaimed(roles) ? fallback : roleOf(username, roles);
}

/**
 * Whether the org store change from `base` to the file at `afterRef` (or the
 * working file when null) passes the guard for `judge`. Read synchronously
 * because `readAuthorization` is synchronous; the file is small.
 */
export function orgStoreInScope(repoDir: string, base: BaseStore, judge: OrgRole, afterRef: string | null = null, run: Run = realRun): boolean {
  if (base.state === "unreadable") return false;
  let after: string;
  if (afterRef === null) {
    try {
      after = readFileSync(join(repoDir, ORG_STORE_REL), "utf8");
    } catch {
      return false;
    }
  } else {
    const at = readStoreAt(repoDir, afterRef, run);
    if (at.state === "unreadable") return false;
    after = at.state === "text" ? at.text : "{}";
  }
  const before = base.state === "text" ? base.text : "{}";
  if (before === after) return true;
  return orgStoreChangeRefusal(judge, parseStoreText(ORG_STORE_REL, before), parseStoreText(ORG_STORE_REL, after)) === null;
}
