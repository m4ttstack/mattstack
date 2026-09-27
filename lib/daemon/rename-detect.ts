/**
 * Detects a GitHub repo rename for indexed repos and re-keys their state.
 * The remote is read fresh from git config every time: deriveRepoIdentity
 * memoizes a remote-kind identity for the process lifetime, so a cached
 * derivation would never see a `set-url`. GitHub answering the old name with
 * a 301 to a repo whose full_name is the new one is the confirmation that the
 * two names are one repo; a mismatch anywhere is a no-op.
 */

import type { Logger } from "pino";
import { loadRepoIndexEntries } from "../repo-index.ts";
import { reidentify } from "../repo-reidentify.ts";
import { clearIdentityMemo, identityFromRemote, parseIdentity, serializeIdentity } from "../settings/identity.ts";
import { runCapture } from "../subprocess.ts";

export interface RenameDetectDeps {
  entries: () => { repoName: string; path: string }[];
  /** Fresh `git config --get remote.origin.url`; null when the path has no remote or is gone. */
  readRemote: (path: string) => Promise<string | null>;
  /** The repo's current `owner/repo` when GitHub answers 301 for the old name; null for any other answer. */
  renamedTo: (owner: string, repo: string) => Promise<string | null>;
  reidentify: (from: string, to: string) => Promise<{ ok: boolean } | { error: string }>;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}

export interface DetectedRename {
  from: string;
  to: string;
  applied: boolean;
}

function githubParts(serialized: string): { owner: string; repo: string } | null {
  const parsed = parseIdentity(serialized);
  if (!parsed || parsed.kind !== "remote") return null;
  const m = /^github\.com\/([^/]+)\/([^/]+)$/i.exec(parsed.id);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

async function detectOne(deps: RenameDetectDeps, entry: { repoName: string; path: string }): Promise<DetectedRename | null> {
  const old = githubParts(entry.repoName);
  if (!old) return null;
  const remote = await deps.readRemote(entry.path);
  if (!remote) return null;
  const derived = identityFromRemote(remote);
  if (!derived) return null;
  const to = serializeIdentity(derived);
  if (to === entry.repoName) return null;
  const next = githubParts(to);
  if (!next) return null;
  const current = await deps.renamedTo(old.owner, old.repo);
  if (!current || current.toLowerCase() !== `${next.owner}/${next.repo}`.toLowerCase()) return null;
  const result = await deps.reidentify(entry.repoName, to);
  // Stores may have moved even on a refusal; a memoized derivation for an
  // unmoved checkout would keep answering the identity they left.
  clearIdentityMemo();
  const applied = "ok" in result && result.ok === true;
  if (applied) deps.log.info({ from: entry.repoName, to }, "rename-detect: re-keyed repo state after GitHub rename");
  else deps.log.warn({ from: entry.repoName, to, result }, "rename-detect: reidentify did not complete");
  return { from: entry.repoName, to, applied };
}

export async function detectRenamedRepos(deps: RenameDetectDeps): Promise<DetectedRename[]> {
  const out: DetectedRename[] = [];
  for (const entry of deps.entries()) {
    try {
      const found = await detectOne(deps, entry);
      if (found) out.push(found);
    } catch (err) {
      deps.log.warn({ err, repo: entry.repoName }, "rename-detect: skipped a repo");
    }
  }
  return out;
}

/**
 * Starts the periodic pass once `after` settles either way, so the first
 * pass never runs against rows the boot identity migration has yet to re-key.
 * Returns a stop function.
 */
export function startRenameDetector(after: Promise<unknown>, run: () => Promise<unknown>, intervalMs: number): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  void after
    .catch(() => {})
    .then(() => {
      if (stopped) return;
      void run();
      timer = setInterval(() => void run(), intervalMs);
      timer.unref?.();
    });
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

export function realRenameDetectDeps(
  log: Logger,
  fetchImpl: typeof fetch = fetch,
  reidentifyImpl?: RenameDetectDeps["reidentify"],
): RenameDetectDeps {
  const headers = { "User-Agent": "rt", Accept: "application/vnd.github+json" };
  return {
    entries: () => loadRepoIndexEntries().map((e) => ({ repoName: e.repoName, path: e.path })),
    readRemote: async (path) => {
      const r = await runCapture(["git", "-C", path, "config", "--get", "remote.origin.url"], { timeoutMs: 5_000 });
      return r.exitCode === 0 && r.stdout.trim() !== "" ? r.stdout.trim() : null;
    },
    renamedTo: async (owner, repo) => {
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, { redirect: "manual", headers });
        const location = res.status === 301 ? res.headers.get("location") : null;
        if (!location) return null;
        const moved = await fetchImpl(location, { headers });
        if (!moved.ok) return null;
        const body = (await moved.json()) as { full_name?: unknown };
        return typeof body.full_name === "string" ? body.full_name : null;
      } catch {
        return null;
      }
    },
    reidentify:
      reidentifyImpl ??
      (async (from, to) => {
        const r = await reidentify(from, to);
        return "error" in r ? r : { ok: r.ok };
      }),
    log,
  };
}
