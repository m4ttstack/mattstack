/**
 * rt pr: pull request verbs for GitHub repos.
 *
 *   rt pr enqueue <number> [--head <sha>] [--json]
 *
 * Calls GitHub directly from the caller's checkout, because the daemon's
 * provider context is GitLab-only.
 */
import { GitHubProvider, type MergeQueueEntry } from "@mattstack/glance";
import { forgeTokenFor, parseRemoteUrl } from "../lib/enrich.ts";
import { exitUserError, UserActionableError } from "../lib/errors.ts";
import { loadSecrets } from "../lib/linear.ts";
import * as out from "../lib/ui/out.ts";
import { runGit } from "../lib/worktree/git-async.ts";

export interface PrEnqueueDeps {
  originUrl(): Promise<string | undefined>;
  forgeToken(url: string): Promise<{ forge: "github" | "gitlab"; token: string | null } | null>;
  enqueue(host: string, token: string, projectPath: string, pr: number, expectedHeadSha?: string): Promise<MergeQueueEntry>;
}

export type PrEnqueueResult =
  | { ok: true; pr: number; position: number; state: string }
  | { ok: false; error: string };

function realDeps(cwd: string): PrEnqueueDeps {
  return {
    async originUrl() {
      const r = await runGit(cwd, ["config", "--get", "remote.origin.url"]);
      return r.exitCode === 0 ? r.stdout.trim() || undefined : undefined;
    },
    forgeToken: async (url) => forgeTokenFor(url, await loadSecrets()),
    enqueue: (host, token, projectPath, pr, expectedHeadSha) =>
      new GitHubProvider(host, token).enqueuePullRequest(projectPath, pr, expectedHeadSha ? { expectedHeadSha } : {}),
  };
}

export async function runPrEnqueue(args: string[], deps: PrEnqueueDeps): Promise<PrEnqueueResult> {
  const headAt = args.indexOf("--head");
  const head = headAt >= 0 ? args[headAt + 1] : undefined;
  if (headAt >= 0 && (!head || head.startsWith("--"))) return { ok: false, error: "--head requires a sha" };
  const number = args.find((a, i) => !a.startsWith("--") && (headAt < 0 || i !== headAt + 1));
  const pr = Number(number);
  if (!Number.isInteger(pr) || pr <= 0) return { ok: false, error: "usage: rt pr enqueue <number> [--head <sha>] [--json]" };

  const url = await deps.originUrl();
  const remote = url ? parseRemoteUrl(url) : null;
  if (!url || !remote) return { ok: false, error: "could not read this checkout's origin remote" };
  const forge = await deps.forgeToken(url);
  if (forge?.forge !== "github") return { ok: false, error: "rt pr enqueue only works on GitHub repos" };
  if (!forge.token) return { ok: false, error: "no GitHub token (run: gh auth login)" };

  try {
    const entry = await deps.enqueue(remote.host, forge.token, remote.projectPath, pr, head);
    return { ok: true, pr, ...entry };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function prEnqueue(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const result = await runPrEnqueue(args.filter(a => a !== "--json"), realDeps(process.cwd()));
  if (!result.ok) exitUserError(new UserActionableError("pr-enqueue-failed", result.error), json);
  if (json) out.json(result);
  else out.print(out.line("done", `#${result.pr} queued at position ${result.position}`, result.state));
}
