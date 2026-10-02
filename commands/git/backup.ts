/**
 * rt git backup: Manual branch backup.
 * rt git restore: Interactive restore from backup.
 *
 * Thin wrappers over lib/git-backup.ts.
 */

import * as out from "../../lib/ui/out.ts";
import { getCurrentBranch } from "../../lib/git-ops.ts";
import { createBackup, listBackups, restoreFromBackup, type BackupBranch } from "../../lib/git-backup.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import { NOT_ON_A_BRANCH } from "./shared.ts";

// ─── rt git backup ──────────────────────────────────────────────────────────

export async function backupCommand(
  _args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;
  const branch = getCurrentBranch(cwd);

  if (!branch) {
    out.fail(NOT_ON_A_BRANCH);
    process.exit(1);
  }

  const backupRef = createBackup("manual", cwd);
  out.print(out.line("done", `Backed up ${branch}`, backupRef));
}

// ─── rt git restore ─────────────────────────────────────────────────────────

function formatAge(ts: string): string {
  // Timestamp is like "2026-04-09T00-27-40"; convert it back to a Date
  const normalized = ts.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})$/,
    "$1:$2:$3",
  );
  const date = new Date(normalized + "Z");
  if (isNaN(date.getTime())) return ts;

  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** A restore hard-resets the branch you are on, which need not be the branch the backup was taken from. */
export function restoreBlocks(current: string | null, backup: BackupBranch, age: string): { pending: Block[]; done: Block } {
  const here = current ?? "detached HEAD";
  const from = `${backup.operation} backup from ${age}`;
  if (current === backup.originalBranch) {
    return {
      pending: [out.line("pending", `Restore ${here} to ${backup.sha}`, from), out.callout("note", "This throws away every change made since that backup.")],
      done: out.line("done", `Restored ${here}`, backup.ref),
    };
  }
  const title = `Reset ${here} to ${backup.originalBranch}'s backup`;
  return {
    pending: [
      out.line("pending", `${title} ${backup.sha}`, from),
      out.callout("note", `This replaces ${here} with that backup, and throws away every commit and change on ${here} that is not in it.`),
    ],
    done: out.line("done", title, backup.ref),
  };
}

export async function restoreCommand(
  _args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;
  const backups = listBackups(cwd);

  if (backups.length === 0) {
    out.print(out.line("skipped", "There are no backups to restore"));
    return;
  }

  const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
  const { confirm: inkConfirm } = await import("../../lib/rt-render.ts");

  const selected = await filterableSelect({
    message: "Select a backup to restore",
    options: backups.map((b) => ({
      value: b.ref,
      label: `${b.originalBranch}`,
      hint: `${b.operation} · ${b.sha} · ${formatAge(b.timestamp)}`,
    })),
  });

  if (!selected) {
    out.print(out.line("skipped", "Nothing was restored"));
    return;
  }

  const backup = backups.find((b) => b.ref === selected)!;
  const { pending, done } = restoreBlocks(getCurrentBranch(cwd), backup, formatAge(backup.timestamp));
  out.print(...pending);

  const ok = await inkConfirm({
    message: "Restore? (this does a hard reset)",
    initialValue: true,
  });

  if (!ok) {
    out.print(out.line("skipped", "Nothing was restored"));
    return;
  }

  restoreFromBackup(selected, cwd);
  out.print(done);
}
