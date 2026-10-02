import { createGitClient, type BranchInfo, type FileDiff, type LogEntry, type RepoSnapshot } from "../../packages/git-core/src/index.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { errText, failPlain, failUsage, readFlag } from "./shared.ts";

export function repoClient() {
  return createGitClient(process.cwd());
}

function position(ahead: number | null, behind: number | null): string[] {
  return [ahead ? `${ahead} ahead` : "", behind ? `${behind} behind` : ""].filter(Boolean);
}

export function statusBlocks(snap: RepoSnapshot): Block[] {
  const head = snap.detached || !snap.branch ? "detached HEAD" : snap.branch;
  const notes = [snap.upstream ? `tracking ${snap.upstream}` : "", ...position(snap.ahead, snap.behind)].filter(Boolean).join(", ");
  const headRow: out.CellInput[] = notes ? [out.key(head), out.dim(notes)] : [out.key(head)];
  if (snap.clean) return [out.table([headRow]), out.line("done", "Nothing to commit")];
  const rows: out.CellInput[][] = snap.files.map((f) => [
    f.originalPath ? [f.path, out.dim(` (was ${f.originalPath})`)] : f.path,
    out.dim(f.kind),
    out.dim(f.staged && f.unstaged ? "partly" : f.staged ? "yes" : "no"),
  ]);
  return [out.table([headRow]), out.table(rows, ["FILE", "CHANGE", "STAGED"])];
}

export function logBlocks(entries: LogEntry[]): Block[] {
  if (entries.length === 0) return [out.line("skipped", "No commits to show")];
  return [out.table(entries.map((e) => [out.dim(e.sha.slice(0, 8)), out.dim(e.authorDate.slice(0, 10)), e.subject]))];
}

export function branchesBlocks(branches: BranchInfo[]): Block[] {
  if (branches.length === 0) return [out.line("skipped", "No branches yet")];
  return [
    out.table(
      branches.map((b) => {
        const notes = [b.current ? "current" : "", b.upstream ? `tracking ${b.upstream}` : "", ...position(b.ahead, b.behind), b.upstreamGone ? "its upstream is gone" : ""].filter(Boolean).join(", ");
        return notes ? [out.key(b.name), out.dim(notes)] : [out.key(b.name)];
      }),
    ),
  ];
}

export function diffBlocks(diff: FileDiff): Block[] {
  if (diff.kind !== "text") return [out.line("skipped", `${diff.path} is ${diff.kind === "binary" ? "a binary file" : "a submodule"}`, "no line diff to show")];
  if (diff.hunks.length === 0) return [out.line("skipped", `No changes in ${diff.path}`)];
  return [out.diff(diff.hunks.map((h) => ({ header: h.header, lines: h.lines.map((l) => ({ kind: l.type, text: l.content })) })))];
}

const STATUS_FAILED = "Could not read what has changed here";

export async function statusCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let snap: RepoSnapshot;
  try {
    snap = await repoClient().snapshot();
  } catch (err) {
    failPlain(json, STATUS_FAILED, errText(err));
  }
  if (json) out.json({ ok: true, ...snap });
  else out.print(...statusBlocks(snap));
}

const LOG_USAGE = "usage: rt git log [--max <n>] [--file <path>] [--json]";

export async function logCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const max = Number(readFlag(json, args, "--max", LOG_USAGE) ?? 20);
  const file = readFlag(json, args, "--file", LOG_USAGE);
  let entries: LogEntry[];
  try {
    entries = await repoClient().log({
      maxCount: Number.isFinite(max) && max > 0 ? max : 20,
      ...(file ? { file } : {}),
    });
  } catch (err) {
    failPlain(json, "Could not read this branch's commits", errText(err));
  }
  if (json) out.json({ ok: true, entries });
  else out.print(...logBlocks(entries));
}

export async function branchesCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let branches: BranchInfo[];
  try {
    branches = await repoClient().branches();
  } catch (err) {
    failPlain(json, "Could not list the branches", errText(err));
  }
  if (json) out.json({ ok: true, branches });
  else out.print(...branchesBlocks(branches));
}

const DIFF_USAGE = "usage: rt git diff <path> [--staged] [--json]";

function positional(args: string[]): string | undefined {
  const flagsWithValue = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flagsWithValue.has(a)) { i++; continue; }
    if (!a.startsWith("-")) return a;
  }
  return undefined;
}

export async function diffCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const staged = args.includes("--staged");
  const client = repoClient();
  let path = positional(args);
  let untracked = false;
  if (!path && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    let files: RepoSnapshot["files"];
    try {
      files = (await client.snapshot()).files;
    } catch (err) {
      failPlain(json, STATUS_FAILED, errText(err));
    }
    if (files.length === 0) failUsage(json, "Which file?", DIFF_USAGE, "Nothing has changed here, so there is no file to pick from.");
    const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
    const picked = await filterableSelect({
      message: "Diff which file?",
      options: files.map((f) => ({ label: f.path, value: f.path, hint: f.kind })),
    });
    if (picked === null) process.exit(0);
    path = picked;
    untracked = files.find((f) => f.path === picked)?.kind === "untracked";
  }
  if (!path) failUsage(json, "Which file?", DIFF_USAGE);
  let diff: FileDiff;
  try {
    diff = await client.diffFile(path, { staged, ...(untracked ? { untracked: true } : {}) });
  } catch (err) {
    failPlain(json, "Could not read that file's changes", errText(err));
  }
  if (json) out.json({ ok: true, diff });
  else out.print(...diffBlocks(diff));
}
