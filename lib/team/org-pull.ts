/**
 * One pull of an org clone that works whether or not the rt daemon runs. A
 * Mac that is still waiting for its join to be approved has no daemon yet,
 * so the direct path fetches and fast-forwards the clone itself, behind the
 * same layout gate the daemon's pull uses.
 */

import { join } from "path";
import { layoutGate } from "../daemon/home-snapshot.ts";
import type { PullResult } from "../daemon/home-snapshot.ts";
import { orgDirUnder } from "../rt-paths.ts";
import type { Probes } from "../setup/probes.ts";
import { parseOriginUrl } from "../setup/team-settings.ts";
import { gitWithToken } from "./git-credential.ts";
import { ORG_LAYOUT } from "./org-marker.ts";
import { checkedOutBranch } from "./org-branch.ts";
import { holdSentence } from "./org-layout.ts";
import { withoutUrls } from "./redact.ts";
import { storedForgeToken } from "./stored-forge-token.ts";

export const PULL_TIMEOUT_MS = 180_000;

export type OrgPull = { outcome: "pulled" | "up-to-date" | "held" | "skipped" | "failed"; detail: string };

interface PullReply {
  ok: boolean;
  data?: PullResult;
  error?: string;
  failure?: { code: string; message: string };
}

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0" };

function firstLine(text: string, fallback: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "");
  return withoutUrls(line?.trim() ?? fallback);
}

function fromDaemon(slug: string, res: PullReply): OrgPull {
  if (!res.ok || !res.data) return { outcome: "failed", detail: withoutUrls(res.failure?.message ?? res.error ?? `${slug} was not pulled`) };
  const { outcome, detail, hold } = res.data;
  if (hold) return { outcome: "held", detail: withoutUrls(detail ?? holdSentence(hold)) };
  if (outcome === "up-to-date") return { outcome: "up-to-date", detail: `${slug} is already up to date` };
  if (outcome === "conflict" || outcome === "skipped") return { outcome: "skipped", detail: withoutUrls(detail ?? `${slug} was not pulled`) };
  return { outcome: "pulled", detail: withoutUrls(detail ?? `Pulled ${slug}`) };
}

async function pullDirect(p: Probes, slug: string, token: (p: Probes, remote: string) => Promise<string | null>): Promise<OrgPull> {
  const dir = orgDirUnder(p.home, slug);
  const branch = await checkedOutBranch(p, dir);
  if (branch === null) return { outcome: "skipped", detail: `Your copy of ${slug} has no branch checked out, so it was not pulled` };

  const config = p.readFile(join(dir, ".git", "config"));
  const remote = config !== null ? parseOriginUrl(config) : null;
  let secret: string | null = null;
  if (remote !== null) {
    try {
      secret = await token(p, remote);
    } catch {
      secret = null;
    }
  }
  const fetch = gitWithToken(["-C", dir, "fetch", "-q", "origin", branch], secret, GIT_ENV, { remote });
  const fetched = await p.exec(fetch.argv, { env: fetch.env, timeoutMs: PULL_TIMEOUT_MS });
  if (fetched.code !== 0) return { outcome: "failed", detail: firstLine(fetched.stderr, `git fetch exited ${fetched.code}`) };

  try {
    const verdict = await layoutGate(p.exec, dir, "FETCH_HEAD", branch);
    if (verdict) return { outcome: "held", detail: holdSentence(verdict.kind === "above" ? { layout: verdict.layout, reads: ORG_LAYOUT } : { moved: verdict.dataBranch }) };
  } catch (err) {
    return { outcome: "failed", detail: firstLine(err instanceof Error ? err.message : String(err), "git show failed") };
  }

  const heads = await p.exec(["git", "-C", dir, "rev-parse", "HEAD", "FETCH_HEAD"]);
  const [head, tip] = heads.stdout.split("\n").map((l) => l.trim());
  if (heads.code === 0 && head && head === tip) return { outcome: "up-to-date", detail: `${slug} is already up to date` };

  const status = await p.exec(["git", "-C", dir, "status", "--porcelain"]);
  if (status.code !== 0) return { outcome: "failed", detail: firstLine(status.stderr, `git status exited ${status.code}`) };
  if (status.stdout.trim() !== "") return { outcome: "skipped", detail: `Your copy of ${slug} has unsaved changes, so it was not moved` };

  const merged = await p.exec(["git", "-C", dir, "merge", "--ff-only", "FETCH_HEAD"], { env: GIT_ENV });
  if (merged.code !== 0) return { outcome: "failed", detail: firstLine(merged.stderr || merged.stdout, `git merge exited ${merged.code}`) };
  return { outcome: "pulled", detail: `Pulled ${slug}` };
}

/** Never throws: a failure is reported as the `failed` outcome with git's first line. */
export async function pullOrgClone(p: Probes, slug: string, seams: { token?: (p: Probes, remote: string) => Promise<string | null> } = {}): Promise<OrgPull> {
  try {
    if ((await p.daemon("ping")) !== null) {
      const res = (await p.daemon("team:pull", { slug }, PULL_TIMEOUT_MS)) as PullReply | null;
      return res === null ? { outcome: "skipped", detail: "The pull is still running in the daemon" } : fromDaemon(slug, res);
    }
    return await pullDirect(p, slug, seams.token ?? storedForgeToken);
  } catch (err) {
    return { outcome: "failed", detail: firstLine(err instanceof Error ? err.message : String(err), `${slug} was not pulled`) };
  }
}
