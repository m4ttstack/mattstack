import { createGitClient, type StashEntry, type TagInfo, type UndoRefusal, type UndoResult } from "../../packages/git-core/src/index.ts";
import { amendStaged } from "../../lib/commit-ops.ts";
import { checkBranchGuard } from "../../lib/branch-guard.ts";
import { createStackGuardRunners } from "../../lib/stack-guard.ts";
import { getRemoteDefaultBranch } from "../../lib/git-ops.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { execFileSync } from "node:child_process";
import { errText, failPlain, failUsage, readFlag, refuseWith } from "./shared.ts";

// Zero-commit repos have no HEAD for rev-parse to resolve; that's the
// mutation's own error to raise (git's real message), not the guard's.
function currentBranch(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// The two warnings go through out.note: they fire under --json too, where
// stdout is the envelope.
async function guardHistoryRewrite(cwd: string, json: boolean): Promise<void> {
  const branch = currentBranch(cwd);
  if (branch === null) {
    out.note(out.line("warn", "rt could not tell which branch this is", "going ahead without the ownership check"));
    return;
  }
  const remoteDefault = getRemoteDefaultBranch(cwd, "origin", { preferRemote: true });
  const defaultBranch = remoteDefault ? remoteDefault.replace("origin/", "") : null;
  const runners = createStackGuardRunners(
    (await import("../../lib/setup/probes.ts")).createRealProbes(),
  );
  const verdict = await checkBranchGuard({ cwd, branch, defaultBranch, runners });
  if (verdict.verdict === "refuse") {
    refuseWith(json, `refused: ${verdict.detail}`, out.line("refused", "rt will not rewrite this branch's history"), out.callout("why", verdict.detail));
  }
  if (verdict.verdict === "unverified") {
    out.note(out.line("warn", "rt could not check who owns this branch", "going ahead"), out.callout("why", verdict.detail));
  }
}

export const UNDO_REFUSED: Record<UndoRefusal, Block[]> = {
  pushed: [out.line("refused", "The last commit is already pushed"), out.callout("why", "Undoing it here would leave this branch behind origin.")],
  initial: [out.line("refused", "This is the first commit, so there is nothing to go back to")],
  merge: [out.line("refused", "The last commit is a merge, and rt does not undo merges")],
};

export function stashBlocks(stashes: StashEntry[]): Block[] {
  if (stashes.length === 0) return [out.line("skipped", "No stashes")];
  return [out.table(stashes.map((s) => [out.dim(`stash ${s.index}`), out.key(s.branch ?? "detached HEAD"), s.message]))];
}

export function tagBlocks(tags: TagInfo[]): Block[] {
  if (tags.length === 0) return [out.line("skipped", "No tags")];
  return [out.table(tags.map((t) => (t.annotated ? [out.strong(t.name), out.dim(t.targetSha.slice(0, 8)), out.dim("annotated")] : [out.strong(t.name), out.dim(t.targetSha.slice(0, 8))])))];
}

export async function amendCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const noVerify = args.includes("--no-verify");
  const message = args.filter((a) => !a.startsWith("-")).join(" ") || undefined;
  const cwd = process.cwd();
  await guardHistoryRewrite(cwd, json);
  let summary: string;
  try {
    summary = amendStaged(cwd, { ...(message ? { message } : {}), noVerify });
  } catch (err) {
    failPlain(json, "Could not amend the last commit", errText(err));
  }
  if (json) out.json({ ok: true, summary });
  else out.print(out.line("done", "Amended the last commit", summary || undefined));
}

export async function undoCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const cwd = process.cwd();
  await guardHistoryRewrite(cwd, json);
  let result: UndoResult;
  try {
    result = await createGitClient(cwd).undoLastCommit();
  } catch (err) {
    failPlain(json, "Could not undo the last commit", errText(err));
  }
  if (!result.ok) refuseWith(json, `refused: ${result.reason}`, ...UNDO_REFUSED[result.reason]);
  if (json) out.json({ ok: true, undoneSha: result.undoneSha });
  else out.print(out.line("done", `Undid commit ${result.undoneSha.slice(0, 8)}`, "its changes are back in your working tree"));
}

const STASH_PUSH_USAGE = "usage: rt git stash push [--message <m>] [--include-untracked] [--json]";

export async function stashPushCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const includeUntracked = args.includes("--include-untracked");
  const message = readFlag(json, args, "--message", STASH_PUSH_USAGE);
  let created: boolean;
  try {
    ({ created } = await createGitClient(process.cwd()).stashPush({
      ...(message ? { message } : {}),
      ...(includeUntracked ? { includeUntracked: true } : {}),
    }));
  } catch (err) {
    failPlain(json, "Could not stash your changes", errText(err));
  }
  if (json) out.json({ ok: true, created });
  else out.print(created ? out.line("done", "Stashed your changes") : out.line("skipped", "Nothing to stash"));
}

export async function stashListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let stashes: StashEntry[];
  try {
    stashes = await createGitClient(process.cwd()).stashes();
  } catch (err) {
    failPlain(json, "Could not list the stashes", errText(err));
  }
  if (json) out.json({ ok: true, stashes });
  else out.print(...stashBlocks(stashes));
}

const NOT_A_STASH_NUMBER = "That is not a stash number";
const STASH_NUMBER_WHY = "A stash is named by its number in the list, starting at 0.";

function stashIndexArg(args: string[], json: boolean, usage: string): number {
  const raw = args.find((a) => !a.startsWith("-"));
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) failUsage(json, NOT_A_STASH_NUMBER, usage, STASH_NUMBER_WHY);
  return n;
}

export async function stashPopCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash pop [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashPop(index);
  } catch (err) {
    failPlain(json, "Could not bring that stash back", errText(err));
  }
  if (json) out.json({ ok: true, index });
  else out.print(out.line("done", `Brought back stash ${index}`, "and removed it from the list"));
}

export async function stashApplyCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash apply [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashApply(index);
  } catch (err) {
    failPlain(json, "Could not bring that stash back", errText(err));
  }
  if (json) out.json({ ok: true, index });
  else out.print(out.line("done", `Brought back stash ${index}`, "it is still in the list"));
}

const STASH_DROP_USAGE = "usage: rt git stash drop <index> [--json]";

export async function stashDropCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const client = createGitClient(process.cwd());
  let raw = args.find((a) => !a.startsWith("-"));
  if (raw === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    let stashes: StashEntry[];
    try {
      stashes = await client.stashes();
    } catch (err) {
      failPlain(json, "Could not list the stashes", errText(err));
    }
    if (stashes.length === 0) failUsage(json, "Which stash?", STASH_DROP_USAGE, "There are no stashes to pick from.");
    const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
    const picked = await filterableSelect({
      message: "Drop which stash?",
      options: stashes.map((s) => ({ label: `stash@{${s.index}}: ${s.message}`, value: String(s.index) })),
    });
    if (picked === null) process.exit(0);
    raw = picked;
  }
  if (raw === undefined) failUsage(json, "Which stash?", STASH_DROP_USAGE);
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) failUsage(json, NOT_A_STASH_NUMBER, STASH_DROP_USAGE, STASH_NUMBER_WHY);
  try {
    await client.stashDrop(index);
  } catch (err) {
    failPlain(json, "Could not delete that stash", errText(err));
  }
  if (json) out.json({ ok: true, index });
  else out.print(out.line("done", `Deleted stash ${index}`));
}

function firstPositional(args: string[], valueFlags: Set<string>): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valueFlags.has(a)) { i++; continue; }
    if (a.startsWith("-")) continue;
    return a;
  }
  return undefined;
}

const TAGS_FAILED = "Could not list the tags";

export async function tagListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let tags: TagInfo[];
  try {
    tags = await createGitClient(process.cwd()).tags();
  } catch (err) {
    failPlain(json, TAGS_FAILED, errText(err));
  }
  if (json) out.json({ ok: true, tags });
  else out.print(...tagBlocks(tags));
}

const TAG_CREATE_USAGE = "usage: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]";

export async function tagCreateCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const push = args.includes("--push");
  const name = firstPositional(args, new Set(["--message", "--at"]));
  if (!name) failUsage(json, "What should the tag be called?", TAG_CREATE_USAGE);
  const message = readFlag(json, args, "--message", TAG_CREATE_USAGE);
  const at = readFlag(json, args, "--at", TAG_CREATE_USAGE);
  let pushed: boolean;
  try {
    const client = createGitClient(process.cwd());
    await client.createTag(name, { ...(message ? { message } : {}), ...(at ? { sha: at } : {}) });
    if (push) await client.pushTag(name);
    pushed = push;
  } catch (err) {
    failPlain(json, "Could not create that tag", errText(err));
  }
  if (json) out.json({ ok: true, name, pushed });
  else out.print(out.line("done", `Created tag ${name}`, pushed ? "and pushed it to origin" : undefined));
}

async function pickTagName(json: boolean, usage: string, action: "Delete" | "Push"): Promise<string> {
  const client = createGitClient(process.cwd());
  let tags: TagInfo[];
  try {
    tags = await client.tags();
  } catch (err) {
    failPlain(json, TAGS_FAILED, errText(err));
  }
  if (tags.length === 0) failUsage(json, "Which tag?", usage, "There are no tags to pick from.");
  const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
  const picked = await filterableSelect({
    message: `${action} which tag?`,
    options: tags.map((t) => ({ label: t.name, value: t.name, hint: t.targetSha.slice(0, 8) })),
  });
  if (picked === null) process.exit(0);
  return picked;
}

const TAG_DELETE_USAGE = "usage: rt git tag delete <name> [--json]";

export async function tagDeleteCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let name = firstPositional(args, new Set<string>());
  if (name === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    name = await pickTagName(json, TAG_DELETE_USAGE, "Delete");
  }
  if (!name) failUsage(json, "Which tag?", TAG_DELETE_USAGE);
  try {
    await createGitClient(process.cwd()).deleteTag(name);
  } catch (err) {
    failPlain(json, "Could not delete that tag", errText(err));
  }
  if (json) out.json({ ok: true, name });
  else out.print(out.line("done", `Deleted tag ${name}`, "on this Mac only"));
}

const TAG_PUSH_USAGE = "usage: rt git tag push <name> [--remote <remote>] [--json]";

export async function tagPushCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let name = firstPositional(args, new Set(["--remote"]));
  if (name === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    name = await pickTagName(json, TAG_PUSH_USAGE, "Push");
  }
  if (!name) failUsage(json, "Which tag?", TAG_PUSH_USAGE);
  const remote = readFlag(json, args, "--remote", TAG_PUSH_USAGE) ?? "origin";
  try {
    await createGitClient(process.cwd()).pushTag(name, remote);
  } catch (err) {
    failPlain(json, "Could not push that tag", errText(err));
  }
  if (json) out.json({ ok: true, name, remote });
  else out.print(out.line("done", `Pushed tag ${name}`, `to ${remote}`));
}
