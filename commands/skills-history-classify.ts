import { exitUserError, UserActionableError } from "../lib/errors.ts";
import { historyClassifyCachePath } from "../lib/rt-paths.ts";
import { deriveRepoIdentity, serializeIdentity } from "../lib/settings/identity.ts";
import { classifyCommits, isCommitSha } from "../lib/skills/history-classify.ts";
import { childEnv } from "../lib/subprocess.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

const USAGE = "rt skills history-classify --repo-dir <dir> --sha <sha>";

export type HistoryClassifyPayload = { versionOnly: string[] };

function valuesOf(args: string[], flag: string): string[] {
  return args.flatMap((a, i) => (a === flag ? [args[i + 1] ?? ""] : []));
}

function isGitRepo(dir: string): boolean {
  const r = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--git-dir"], { env: childEnv(), stdout: "ignore", stderr: "ignore" });
  return r.exitCode === 0;
}

export async function classifyHistory(repoDir: string, shas: string[]): Promise<HistoryClassifyPayload> {
  const bad = shas.find((s) => !isCommitSha(s));
  if (bad !== undefined) throw new UserActionableError("usage", `"${bad}" is not a commit sha.`, {}, { next: USAGE });
  if (!isGitRepo(repoDir)) throw new UserActionableError("not-a-repo", "This folder is not a git repo, so rt cannot read its history.", { repoDir });
  const identity = serializeIdentity(await deriveRepoIdentity(repoDir));
  return { versionOnly: classifyCommits(repoDir, shas, historyClassifyCachePath(identity)) };
}

export function historyClassifyBlocks(shas: string[], payload: HistoryClassifyPayload): Block[] {
  const folded = new Set(payload.versionOnly);
  return shas.map((sha) => (folded.has(sha) ? out.line("done", sha, "only version stamps changed") : out.line("off", sha, "carries a real change")));
}

export async function skillsHistoryClassify(args: string[]): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const [repoDir] = valuesOf(args, "--repo-dir");
  const shas = valuesOf(args, "--sha");
  const missing = !repoDir || repoDir.startsWith("--") ? "Which org clone should this read?" : shas.length === 0 ? "Which commits should this classify?" : null;
  if (missing) {
    if (json) exitUserError(new UserActionableError("usage", `usage: ${USAGE} [--json]`), true);
    out.fail(usageFailure(missing, USAGE));
    process.exit(2);
  }
  let payload: HistoryClassifyPayload;
  try {
    payload = await classifyHistory(repoDir!, shas);
  } catch (e) {
    if (e instanceof UserActionableError) exitUserError(e, json);
    throw e;
  }
  if (json) {
    out.json(payload);
    return;
  }
  out.print(...historyClassifyBlocks(shas, payload));
}
