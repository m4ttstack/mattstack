import { join } from "path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { UserActionableError, logFailureDetail } from "../errors.ts";
import { orgDirUnder } from "../rt-paths.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";
import { commitFiles } from "./create.ts";
import { gitWithToken } from "./git-credential.ts";
import { inviteRecordsPath } from "./invite-records.ts";
import { teamRemote } from "./members.ts";
import { orgBranch, shellQuote } from "./org-branch.ts";
import { markerOrg } from "./org-marker.ts";
import { GIT_OBJECT_ID } from "./publish-history.ts";
import { publishTeam } from "./publish.ts";
import { withoutUrls } from "./redact.ts";
import { assertMayWrite, roleFor, rolesFor } from "./roles.ts";
import { teamLocalPath } from "./team-local.ts";

export type ConvergeOutcome = { state: "done" | "partial" | "needs-you" | "failed" | "skipped"; detail?: string; remedy?: string };

export interface RenameSeams {
  forgeToken: (p: Probes, remote: string) => Promise<string | null>;
  converge: (p: Probes) => Promise<ConvergeOutcome>;
}

export interface RenameResult {
  from: string;
  to: string;
  converged: boolean;
  convergeState?: ConvergeOutcome["state"];
  convergeDetail?: string;
  convergeRemedy?: string;
}

export const MARKER_RELATIVE = "mattstack/mattstack.jsonc";

interface Prepared {
  dir: string;
  branch: string;
  remote: string | null;
  token: string | null;
  markerText: string;
  remoteSha: string | null;
}

function readMarker(p: Probes, dir: string): { text: string; org: string } {
  const text = p.readFile(join(dir, MARKER_RELATIVE));
  const errors: ParseError[] = [];
  if (text !== null) parse(text, errors);
  const org = text === null || errors.length > 0 ? null : markerOrg(p, dir);
  if (text === null || org === null) {
    throw new UserActionableError("org-marker-unreadable", "rt could not read your org's name from its marker file");
  }
  return { text, org };
}

type RemoteLookup = { ok: true; sha: string | null } | { ok: false; log: string };

async function remoteSha(p: Probes, dir: string, branch: string, remote: string | null, token: string | null): Promise<RemoteLookup> {
  const lookup = gitWithToken(["ls-remote", "--refs", "origin", `refs/heads/${branch}`], token, { GIT_TERMINAL_PROMPT: "0" }, { remote });
  const res = await p.exec(lookup.argv, { cwd: dir, env: lookup.env });
  if (res.code !== 0) return { ok: false, log: withoutUrls(`${res.stdout}\n${res.stderr}`.trim()) };
  return { ok: true, sha: res.stdout.trim().split("\n").filter(Boolean)[0]?.split("\t")[0] ?? null };
}

/** The remote's sha for the branch, null when the remote has no such branch yet. */
async function assertNotBehind(p: Probes, dir: string, branch: string, from: string, to: string, remote: string | null, token: string | null): Promise<string | null> {
  const found = await remoteSha(p, dir, branch, remote, token);
  if (!found.ok) throw new UserActionableError("org-unreachable", "rt could not reach the org repo", {}, { log: found.log });
  const sha = found.sha;
  if (sha === null) return null;
  const known = GIT_OBJECT_ID.test(sha) && (await p.exec(["git", "cat-file", "-e", `${sha}^{commit}`], { cwd: dir })).code === 0;
  if (known && (await p.exec(["git", "merge-base", "--is-ancestor", sha, "HEAD"], { cwd: dir })).code === 0) return sha;
  throw behindError(from, to);
}

function behindError(from: string, to: string, log?: string): UserActionableError {
  return new UserActionableError("org-behind", "The org repo has changes this Mac does not have yet", {}, {
    why: "Pull them before you rename the org.",
    next: `rt team pull --team ${from}`,
    thenRun: `rt team rename ${to}`,
    ...(log ? { log } : {}),
  });
}

function pushRefusedError(log: string): UserActionableError {
  return new UserActionableError("rename-push-refused", "The org repo refused the rename", {}, {
    why: "Its rules turned the push away, so nothing changed. Check the branch's protection or hooks.",
    log,
  });
}

async function prepare(p: Probes, from: string, to: string, seams: RenameSeams): Promise<Prepared> {
  try {
    validateSlug(from);
  } catch (err) {
    throw new UserActionableError("invalid-team-slug", "That is not a team name rt can use", {}, { log: err instanceof Error ? err.message : String(err) });
  }
  if (roleFor(p, from).kind !== "admin") {
    const admins = rolesFor(p, from).admins;
    throw new UserActionableError("rename-not-admin", "Only an org admin can rename the org", {}, {
      why: admins.length > 0 ? `Ask ${admins.join(" or ")} to rename it.` : "This org names no admins yet.",
    });
  }
  try {
    validateSlug(to);
  } catch {
    throw new UserActionableError("bad-org-name", `${JSON.stringify(to)} cannot be an org name`, {}, {
      why: "Use lowercase letters, digits and dashes, up to 40 characters, starting with a letter or digit.",
    });
  }
  if (to === from) throw new UserActionableError("rename-same-name", `Your org is already called ${to}`);
  if (p.exists(orgDirUnder(p.home, to))) {
    throw new UserActionableError("rename-name-taken", `This Mac already has an org folder called ${to}`, {}, { why: "Pick another name, or move that folder aside first." });
  }
  if (p.exists(teamLocalPath(p.home, to)) || p.exists(inviteRecordsPath(p.home, to))) {
    throw new UserActionableError("rename-name-taken", `This Mac still has a record of an org called ${to}`, {}, { why: "Pick another name." });
  }
  const dir = orgDirUnder(p.home, from);
  const marker = readMarker(p, dir);
  if (marker.org !== from) {
    throw new UserActionableError("org-not-converged", "Your org folder does not match the org's name yet", {}, {
      why: "Bring this Mac up to date before you rename the org.",
      next: "rt setup update --force",
    });
  }
  const branch = await orgBranch(p, dir);
  const status = await p.exec(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: dir });
  if (status.code !== 0 || status.stdout.trim() !== "") {
    throw new UserActionableError("org-uncommitted", "Your copy of the org has changes that are not committed", {}, {
      why: "Commit and publish them, or discard them, before you rename the org.",
      next: `git -C ${shellQuote(dir)} status`,
    });
  }
  const remote = teamRemote(p, from);
  const token = remote ? await seams.forgeToken(p, remote) : null;
  const sha = await assertNotBehind(p, dir, branch, from, to, remote, token);
  return { dir, branch, remote, token, markerText: marker.text, remoteSha: sha };
}

/** Resets only when HEAD is still the rename commit on top of `before`; otherwise points at a revert, which never drops a commit made meanwhile. */
async function undoRenameCommit(p: Probes, dir: string, before: string, renameSha: string, cause: unknown): Promise<void> {
  const head = await p.exec(["git", "rev-parse", "--verify", "-q", "HEAD"], { cwd: dir });
  const parent = await p.exec(["git", "rev-parse", "--verify", "-q", "HEAD~1"], { cwd: dir });
  const safe = head.code === 0 && head.stdout.trim() === renameSha && parent.code === 0 && parent.stdout.trim() === before;
  if (safe && (await p.exec(["git", "reset", "-q", "--keep", before], { cwd: dir })).code === 0) return;
  throw new UserActionableError("rename-undo-failed", "rt could not undo the rename after the push failed", {}, {
    why: "Your copy of the org has a rename commit the org repo does not have.",
    next: safe ? `git -C ${shellQuote(dir)} reset --keep ${before}` : `git -C ${shellQuote(dir)} revert --no-edit ${renameSha}`,
    log: cause instanceof Error ? cause.message : String(cause),
  });
}

/** A rejected push is "behind" only when the remote branch really moved; otherwise its rules refused it. */
async function whyRefused(p: Probes, prepared: Prepared, from: string, to: string, err: UserActionableError): Promise<UserActionableError> {
  const log = err.log ?? err.message;
  const now = await remoteSha(p, prepared.dir, prepared.branch, prepared.remote, prepared.token);
  if (now.ok && now.sha !== prepared.remoteSha) return behindError(from, to, log);
  return pushRefusedError(log);
}

async function convergeSafely(p: Probes, seams: RenameSeams): Promise<ConvergeOutcome> {
  try {
    return await seams.converge(p);
  } catch (err) {
    if (err instanceof UserActionableError) logFailureDetail(err);
    return { state: "failed", detail: err instanceof Error ? err.message : String(err), remedy: "Run rt setup update --force" };
  }
}

export async function renameOrg(p: Probes, from: string, to: string, seams: RenameSeams): Promise<RenameResult> {
  const prepared = await prepare(p, from, to, seams);
  const { dir, markerText } = prepared;
  const markerPath = join(dir, MARKER_RELATIVE);
  assertMayWrite(p, from, MARKER_RELATIVE);
  const head = await p.exec(["git", "rev-parse", "--verify", "HEAD"], { cwd: dir });
  const before = head.stdout.trim();
  if (head.code !== 0 || !GIT_OBJECT_ID.test(before)) {
    throw new UserActionableError("rename-commit-failed", "rt could not commit the new name", {}, { log: `${head.stdout}\n${head.stderr}`.trim() });
  }
  p.writeFile(markerPath, applyEdits(markerText, modify(markerText, ["org"], to, { formattingOptions: { insertSpaces: true, tabSize: 2 } })));
  let committed: boolean;
  try {
    committed = await commitFiles(p, from, [MARKER_RELATIVE], `org: rename to ${to}`);
  } catch (err) {
    p.writeFile(markerPath, markerText);
    throw err;
  }
  if (!committed) {
    p.writeFile(markerPath, markerText);
    throw new UserActionableError("rename-commit-failed", "rt could not commit the new name");
  }
  const renamed = await p.exec(["git", "rev-parse", "--verify", "HEAD"], { cwd: dir });
  const renameSha = renamed.stdout.trim();
  if (renamed.code !== 0 || !GIT_OBJECT_ID.test(renameSha)) {
    throw new UserActionableError("rename-commit-failed", "rt could not commit the new name", {}, { log: `${renamed.stdout}\n${renamed.stderr}`.trim() });
  }
  try {
    await publishTeam(p, from, null, { token: prepared.token, tokenRemote: prepared.remote });
  } catch (err) {
    await undoRenameCommit(p, dir, before, renameSha, err);
    if (err instanceof UserActionableError && err.code === "org-moved") throw await whyRefused(p, prepared, from, to, err);
    throw err;
  }
  const outcome = await convergeSafely(p, seams);
  const done = outcome.state === "done";
  return {
    from,
    to,
    converged: done,
    ...(!done ? { convergeState: outcome.state } : {}),
    ...(!done && outcome.detail ? { convergeDetail: outcome.detail } : {}),
    ...(!done && outcome.remedy ? { convergeRemedy: outcome.remedy } : {}),
  };
}
