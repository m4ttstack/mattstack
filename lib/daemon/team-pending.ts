import { readFileSync } from "fs";
import { join } from "path";
import { ORG_STORE_REL } from "../../packages/rt-client/src/settings/paths.ts";
import { diffStoreKeys } from "../../packages/rt-client/src/settings/store-diff.ts";
import type { RunResult } from "../subprocess.ts";
import { isUnderZone, parsePorcelainZ } from "./home-snapshot-plan.ts";
import { teamScope } from "./home-snapshot.ts";

export type PendingEntry =
  | { store: "org" | `team:${string}`; repo?: string; key: string; change: "added" | "changed" | "removed" }
  | { path: string; heldBack?: true };

export type PendingExec = (argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number; stderr?: "ignore" | "pipe" }) => Promise<RunResult>;

const GIT_TIMEOUT_MS = 15_000;
const TEAM_STORE_RE = /^mattstack\/teams\/([^/]+)\/settings\.team\.jsonc$/;

function storeOf(path: string): "org" | `team:${string}` | null {
  if (path === ORG_STORE_REL) return "org";
  const team = TEAM_STORE_RE.exec(path)?.[1];
  return team === undefined ? null : `team:${team}`;
}

/**
 * What this clone holds that origin does not: changed keys for the org and
 * team store files, and every other managed path by name. Compares against
 * `refs/remotes/origin/<branch>`, never `@{u}`, which an rt clone may not
 * have configured. Throws on a git failure.
 */
export async function readPending(repoDir: string, exec: PendingExec, opts: { unowned: string[]; heldBack: string[]; packZones: string[] }): Promise<PendingEntry[]> {
  const git = async (args: string[], allowFail = false): Promise<RunResult> => {
    const result = await exec(["git", ...args], { cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS, stderr: "pipe" });
    if (result.exitCode !== 0 && !allowFail) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    return result;
  };

  const branch = (await git(["symbolic-ref", "--quiet", "--short", "HEAD"])).stdout.trim();
  const originRef = `refs/remotes/origin/${branch}`;
  const hasOrigin = (await git(["rev-parse", "--verify", "-q", originRef], true)).exitCode === 0;

  const paths = new Set<string>();
  for (const entry of parsePorcelainZ((await git(["status", "--porcelain=v1", "-uall", "-z"])).stdout)) {
    paths.add(entry.path);
    if (entry.origPath) paths.add(entry.origPath);
  }
  const range = hasOrigin ? [`${originRef}...HEAD`] : [EMPTY_TREE, "HEAD"];
  for (const path of (await git(["diff", "--name-only", "-z", ...range])).stdout.split("\0")) {
    if (path !== "") paths.add(path);
  }

  const unowned = new Set(opts.unowned);
  const heldBack = new Set(opts.heldBack);
  const out: PendingEntry[] = [];
  for (const path of [...paths].sort()) {
    // Packs reach origin only through `rt skills sync`, never a snapshot round.
    if (!teamScope(path) || unowned.has(path) || opts.packZones.some((zone) => isUnderZone(path, zone))) continue;
    const store = storeOf(path);
    if (store === null) {
      out.push(heldBack.has(path) ? { path, heldBack: true } : { path });
      continue;
    }
    const before = hasOrigin ? await originText(git, originRef, path) : null;
    for (const key of diffStoreKeys(path, before, workingText(repoDir, path))) out.push({ store, ...key });
  }
  return out;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function originText(git: (args: string[], allowFail?: boolean) => Promise<RunResult>, ref: string, path: string): Promise<string | null> {
  const shown = await git(["show", `${ref}:${path}`], true);
  if (shown.exitCode === 0) return shown.stdout;
  if (/does not exist|exists on disk, but not in/.test(shown.stderr)) return null;
  throw new Error(`git show failed: ${shown.stderr.trim()}`);
}

function workingText(repoDir: string, path: string): string | null {
  try {
    return readFileSync(join(repoDir, path), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
