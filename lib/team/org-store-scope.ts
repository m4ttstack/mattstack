import { readFileSync } from "fs";
import { join } from "path";
import { rolesFrom } from "../../packages/rt-client/src/settings/active-team.ts";
import { orgStoreChangeRefusal } from "../../packages/rt-client/src/settings/org-store-guard.ts";
import { roleOf, type OrgRole } from "../../packages/rt-client/src/settings/org-roles.ts";
import { parseStoreText } from "../../packages/rt-client/src/settings/stores.ts";
import { childEnv } from "../subprocess.ts";

export const ORG_STORE_REL = "mattstack/org/settings.org.jsonc";

type Run = (argv: string[]) => { code: number; stdout: string };

const realRun: Run = (argv) => {
  const r = Bun.spawnSync(argv, { env: childEnv(), stdout: "pipe", stderr: "ignore" });
  return { code: r.exitCode ?? 1, stdout: r.stdout.toString() };
};

function headStoreText(repoDir: string, run: Run): string | null {
  const head = run(["git", "-C", repoDir, "show", `HEAD:${ORG_STORE_REL}`]);
  return head.code === 0 ? head.stdout : null;
}

/** The role the committed org store gives this user, so an uncommitted edit cannot grant itself the role that approves it. */
export function roleAtHead(repoDir: string, username: string | null, fallback: OrgRole, run: Run = realRun): OrgRole {
  const text = headStoreText(repoDir, run);
  return text === null ? fallback : roleOf(username, rolesFrom(parseStoreText(ORG_STORE_REL, text)));
}

/** Read synchronously because `readAuthorization` is synchronous; the file is small. */
export function orgStoreInScope(repoDir: string, username: string | null, role: OrgRole, run: Run = realRun): boolean {
  let working: string;
  try {
    working = readFileSync(join(repoDir, ORG_STORE_REL), "utf8");
  } catch {
    return false;
  }
  const headText = headStoreText(repoDir, run);
  if (headText === working) return true;
  const judge = headText === null ? role : roleOf(username, rolesFrom(parseStoreText(ORG_STORE_REL, headText)));
  return orgStoreChangeRefusal(judge, parseStoreText(ORG_STORE_REL, headText ?? "{}"), parseStoreText(ORG_STORE_REL, working)) === null;
}
