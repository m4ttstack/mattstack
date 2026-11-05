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
  | { ok: false; error: string; next?: string };

const USAGE = "rt pr enqueue <number> [--head <sha>] [--json]";

/** GitHub's GitObjectID refuses a short sha. */
const FULL_SHA = /^[0-9a-f]{40}$/i;

type Parsed = { pr: number; head?: string } | { error: string };

function parseArgs(args: string[]): Parsed {
  const positional: string[] = [];
  let head: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--head") {
      head = args[++i];
      if (!head || !FULL_SHA.test(head)) return { error: "--head needs a full 40-character sha" };
    } else if (arg.startsWith("-")) {
      return { error: `Unknown option ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1 || !/^[1-9]\d*$/.test(positional[0]!)) return { error: "Which one PR number should go in the queue?" };
  return { pr: Number(positional[0]), ...(head && { head }) };
}

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
  const parsed = parseArgs(args);
  if ("error" in parsed) return { ok: false, error: parsed.error, next: USAGE };
  const { pr, head } = parsed;

  const url = await deps.originUrl();
  const remote = url ? parseRemoteUrl(url) : null;
  if (!url || !remote) return { ok: false, error: "could not read this checkout's origin remote" };
  const forge = await deps.forgeToken(url);
  if (forge?.forge !== "github") return { ok: false, error: "rt pr enqueue only works on GitHub repos" };
  if (!forge.token) return { ok: false, error: "No GitHub token found", next: "gh auth login" };

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
  if (!result.ok) exitUserError(new UserActionableError("pr-enqueue-failed", result.error, {}, { next: result.next }), json);
  if (json) out.json(result);
  else out.print(out.line("done", `#${result.pr} queued at position ${result.position}`, result.state));
}
