/**
 * `rt team publish` — the push half of team creation, split out from
 * `createTeam` so Install can retry a push independently of re-scaffolding
 * (a scaffold commit that landed but never reached the remote, a token that
 * expired between create and Install).
 */

import { gitWithToken } from "./git-credential.ts";
import { join } from "path";
import { validateSlug } from "../secrets/store.ts";
import { UserActionableError } from "../errors.ts";
import type { ExecResult, Probes } from "../setup/probes.ts";
import { parseOriginUrl, stripUserinfo } from "../setup/team-settings.ts";
import { withoutUrls } from "./redact.ts";
import { assertMayWrite, roleFor } from "./roles.ts";
import { mayWritePath, ownedRoots } from "../../packages/rt-client/src/settings/org-roles.ts";
import { GIT_OBJECT_ID, unpublishedPaths } from "./publish-history.ts";
import { orgBranch } from "./org-branch.ts";

export interface PublishTeamResult {
  remote: string;
  pushed: boolean;
  detail: string;
}

/** git's own auth-failure phrasing on a denied push — distinguishes a credentials problem (user-actionable) from every other push failure. Exported for join.ts, which classifies `git ls-remote`/`git clone` failures the same way. */
export const AUTH_FAILURE_PATTERN = /authentication failed|permission denied|could not read username|denied to|403|access denied/i;

/** git's non-fast-forward rejection — the contract requires an existing EMPTY repo, so this specific shape means the pasted/created remote already has commits, not a generic push failure. */
const REJECTED_PATTERN = /\[rejected\]|fetch first|non-fast-forward|failed to push some refs/i;

/** Classifies a failed `git push` into a typed, redacted error — never a plain `Error` that would crash the caller instead of rendering. */
function classifyPushFailure(result: ExecResult, branch: string): UserActionableError {
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.code === 128 && AUTH_FAILURE_PATTERN.test(text)) {
    return new UserActionableError("push-denied", "The forge would not let rt push to the team repo", {}, { why: "Check that you can push to it.", log: withoutUrls(text.trim()) });
  }
  if (REJECTED_PATTERN.test(text)) {
    return new UserActionableError("remote-not-empty", "The team repo already has commits", {}, {
      why: "rt starts a team in an empty repo.",
      log: `the remote already has commits rt can't fast-forward past; rt team create expects an existing EMPTY repository: ${withoutUrls(text.trim())}`,
    });
  }
  return new UserActionableError("push-failed", "rt could not push the team repo", {}, { log: `git push -u origin ${branch} failed (exit ${result.code}): ${withoutUrls(text.trim())}` });
}

async function currentOrigin(p: Probes, dir: string): Promise<string | null> {
  const raw = p.readFile(join(dir, ".git", "config"));
  return raw !== null ? parseOriginUrl(raw) : null;
}

/** `opts.tokenRemote` is the remote `opts.token` was looked up for; the token is offered to its https host only. */
export async function publishTeam(p: Probes, slug: string, remote: string | null, opts: { token?: string | null; tokenRemote?: string | null } = {}): Promise<PublishTeamResult> {
  try {
    validateSlug(slug);
  } catch (err) {
    // validateSlug's own error isn't a UserActionableError — this is the one
    // place that would let an unvalidated `--team ../../some-repo` resolve
    // to a directory outside orgsDir() and run git there.
    throw new UserActionableError("invalid-team-slug", "That is not a team name rt can use", {}, { log: err instanceof Error ? err.message : String(err) });
  }
  if (ownedRoots(roleFor(p, slug)).length === 0) assertMayWrite(p, slug, "mattstack/org/settings.org.jsonc");

  const dir = join(p.home, ".mattstack", "teams", slug);
  if (!p.exists(dir)) {
    throw new UserActionableError("no-team-zone", `The ${slug} team is not on this Mac`, {}, { next: "rt team create" });
  }

  const branch = await orgBranch(p, dir);
  const ref = `refs/heads/${branch}`;

  if (remote) {
    const setUrl = await p.exec(["git", "remote", "set-url", "origin", remote], { cwd: dir });
    if (setUrl.code !== 0) {
      const add = await p.exec(["git", "remote", "add", "origin", remote], { cwd: dir });
      if (add.code !== 0) {
        throw new UserActionableError("git-remote-failed", "rt could not point the team repo at its remote", {}, {
          log: `git remote add origin failed (exit ${add.code}): ${withoutUrls(`${add.stdout}\n${add.stderr}`.trim())}`,
        });
      }
    }
  }

  const activeRemote =remote ?? (await currentOrigin(p, dir)) ?? "";
  const inspectionFailure = () => new UserActionableError("team-pull-only", "rt could not check your pending changes", {}, { next: "rt team pull" });
  const destination = await p.exec(["git", "remote", "get-url", "--push", "--all", "origin"], { cwd: dir });
  const urls = destination.stdout.trim().split("\n").filter(Boolean);
  if (destination.code !== 0 || urls.length !== 1) throw inspectionFailure();
  const lookup = gitWithToken(["ls-remote", "--refs", "--", urls[0]!, ref], opts.token ?? null, { GIT_TERMINAL_PROMPT: "0" }, { remote: opts.tokenRemote ?? activeRemote });
  const published = await p.exec(lookup.argv, { cwd: dir, env: lookup.env });
  const rows = published.stdout.trim().split("\n").filter(Boolean);
  if (published.code !== 0 || rows.length > 1) throw inspectionFailure();
  const base = rows[0]?.split("\t");
  if (base && (base.length !== 2 || !GIT_OBJECT_ID.test(base[0]!) || base[1] !== ref)) throw inspectionFailure();
  const pending = await unpublishedPaths((argv) => p.exec(argv, { cwd: dir }), base ? `${base[0]}..${ref}` : ref);
  if (pending === null) throw inspectionFailure();
  const cmd = gitWithToken(["push", "-u", "origin", `${ref}:${ref}`], opts.token ?? null, { GIT_TERMINAL_PROMPT: "0" }, { remote: opts.tokenRemote ?? activeRemote });
  const current = roleFor(p, slug);
  if (ownedRoots(current).length === 0) assertMayWrite(p, slug, "mattstack/org/settings.org.jsonc");
  for (const path of pending) {
    if (current.kind === "admin" && path === ".gitignore") continue;
    if (!mayWritePath(current, path)) assertMayWrite(p, slug, path);
  }
  const push = await p.exec(cmd.argv, { cwd: dir, env: cmd.env });

  if (push.code !== 0) {
    const text = `${push.stdout}\n${push.stderr}`;
    if (REJECTED_PATTERN.test(text) && (await p.exec(["git", "rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`], { cwd: dir })).code === 0) {
      throw new UserActionableError("org-moved", "The org repo has changes this Mac does not have yet", {}, {
        why: "Someone else pushed first, so pull their changes before you publish again.",
        next: `rt team pull --team ${slug}`,
        thenRun: `rt team publish --team ${slug}`,
        log: withoutUrls(text.trim()),
      });
    }
    throw classifyPushFailure(push, branch);
  }

  const publicRemote = stripUserinfo(activeRemote);
  const stdout = push.stdout.trim();
  return { remote: publicRemote, pushed: true, detail: stdout ? withoutUrls(stdout) : `pushed to ${publicRemote}` };
}
