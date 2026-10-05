/**
 * rt state -- backup/restore rt's own state.db (R055).
 *
 *   rt state backup [--json]
 *   rt state restore <copy> [--json]
 *   rt state restore --from-backup [--only <app>] [--at <ts>] [--identity <path>] [--dry-run] [--json]
 *
 * `backup` writes a stamped VACUUM INTO copy under stateBackupsDir() and
 * prunes copies past the retention window. `restore` overwrites the live
 * state.db from a stamped copy (by filename or absolute path) after an
 * integrity check on the source; run it with the daemon stopped.
 *
 * `restore --from-backup` is the reverse of the encrypted pipeline in
 * backup-orchestrator.ts: pull the home repo (git + LFS), decrypt and
 * decompress the latest backup per source in BACKUP_SOURCES, integrity
 * check, and place. `--identity` supplies the team key on a machine whose
 * keychain has no age key yet (machine-loss recovery); without it, the
 * keychain key is used.
 */

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { basename, dirname, join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { isDaemonRunning } from "../lib/daemon-client.ts";
import { flagValue } from "../lib/cli-args.ts";
import { mattstackHome } from "../lib/rt-paths.ts";
import {
  backupTo,
  closeStateDb,
  getStateDb,
  listStateBackups,
  pruneStateBackups,
  quickCheck,
  stampedBackupPath,
  stateBackupsDir,
  stateDbPath,
} from "../lib/state/index.ts";
import { isBackupConfigured, pruneOldBackups, runFullBackup } from "../lib/state/backup-orchestrator.ts";
import { pullHomeRepo, restoreFromBackup } from "../lib/state/backup-restore.ts";
import { createRealAgeKeySeam, readAgeKey } from "../lib/home/age-key.ts";

import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";

function fail(failure: Parameters<typeof out.fail>[0]): never {
  out.fail(failure);
  process.exit(1);
}

function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function refuseWhileDaemonRuns(forceCommand: string): never {
  out.note(
    out.line("refused", "rt will not restore while the daemon is running", "it shares this data with rt"),
    out.callout("next", out.cmd("rt daemon stop")),
    out.callout("note", ["To restore anyway: ", out.cmd(forceCommand)]),
  );
  process.exit(1);
}

function localCopyBlocks(path: string, removed: string[]): Block[] {
  return [out.line("done", "Saved a local copy of rt's state", basename(path)), ...(removed.length > 0 ? [out.line("done", `Removed ${plural(removed.length, "older copy", "older copies")}`)] : [])];
}

function copyArg(args: string[]): string | undefined {
  return args.find((a) => !a.startsWith("--"));
}

async function pickBackup(names: readonly string[]): Promise<string | null> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  return filterableSelect({
    message: "Restore which backup?",
    options: names.map((name) => ({ value: name, label: name })),
    stderr: true,
  });
}

async function requireCopy(args: string[]): Promise<string> {
  const c = copyArg(args);
  if (c) return c;
  const names = listStateBackups();
  if (names.length > 0 && process.stdin.isTTY && !args.includes("--json") && !process.env.RT_BATCH) {
    const picked = await pickBackup(names);
    if (!picked) process.exit(0);
    return picked;
  }
  fail(usageFailure("Which backup?", "rt state restore <copy>"));
}

export async function stateBackup(args: string[], _ctx: CommandContext = {}): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const local = args.includes("--local");

  if (local) {
    const path = stampedBackupPath();
    backupTo(getStateDb(), path);
    const { removed } = pruneStateBackups();

    if (json) {
      out.json({ ok: true, path, pruned: removed });
      return;
    }
    out.print(...localCopyBlocks(path, removed));
    return;
  }

  if (!isBackupConfigured()) {
    out.fail({ title: "Encrypted backup is not set up on this Mac", next: out.cmd("rt state backup init") });
    out.note(out.callout("tip", ["For a copy on this Mac only: ", out.cmd("rt state backup --local")]));
    process.exit(1);
  }

  try {
    const result = await runFullBackup();

    if (result.backed.length === 0 && result.skipped.length === 0 && result.errors.length > 0) {
      const path = stampedBackupPath();
      backupTo(getStateDb(), path);
      const { removed } = pruneStateBackups();
      if (!json) {
        out.note(out.line("warn", "The encrypted backup failed, so rt saved a local copy instead"), out.verbatim(result.errors, "what failed"));
      }
      if (json) {
        out.json({ ok: true, fallback: "local", path, pruned: removed, errors: result.errors });
      } else {
        out.print(...localCopyBlocks(path, removed));
      }
      return;
    }

    const { removed } = await pruneOldBackups();

    if (json) {
      out.json({ ...result, pruned: removed.length });
    } else {
      out.print(
        out.line("done", "Backed up rt's state", plural(result.backed.length, "source", "sources")),
        out.table(result.backed.map((b) => [out.strong(b.app), formatBytes(b.sizeBytes)])),
        ...(removed.length > 0 ? [out.line("done", `Removed ${plural(removed.length, "older backup", "older backups")}`)] : []),
      );
      if (result.errors.length > 0) out.note(out.line("warn", "Some sources were not backed up"), out.verbatim(result.errors));
    }
  } catch (err) {
    const path = stampedBackupPath();
    backupTo(getStateDb(), path);
    const { removed } = pruneStateBackups();
    if (!json) {
      out.note(out.line("warn", "The encrypted backup failed, so rt saved a local copy instead", String(err instanceof Error ? err.message : err).split("\n")[0]));
    }
    if (json) {
      out.json({ ok: true, fallback: "local", path, pruned: removed, error: String(err) });
    } else {
      out.print(...localCopyBlocks(path, removed));
    }
  }
}

/**
 * `--from-backup` is a distinct pipeline from the plain positional-copy
 * restore above (pull, decrypt, decompress, integrity check, place per
 * source in BACKUP_SOURCES) rather than a variant of it, so it returns
 * before any of the stamped-local-copy logic below runs.
 */
async function stateRestoreFromBackup(args: string[]): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const only = flagValue(args, "--only");
  const at = flagValue(args, "--at");
  const identityFlag = flagValue(args, "--identity");

  if (!force) {
    const daemonUp = await isDaemonRunning();
    const sockExists = existsSync(join(mattstackHome(), "rt", "rt.sock"));
    if (daemonUp || sockExists) {
      refuseWhileDaemonRuns("rt state restore --from-backup --force");
    }
  }

  let identityPath: string | undefined;
  let identityKey: string | undefined;

  if (identityFlag) {
    identityPath = identityFlag;
  } else {
    const keyResult = await readAgeKey(createRealAgeKeySeam());
    if (!("key" in keyResult)) {
      fail({ title: "This Mac has no key to decrypt your backups", why: "On a new Mac, use the team key file.", next: out.cmd("rt state restore --from-backup --identity <key file>") });
    }
    identityKey = keyResult.key;
  }

  if (!dryRun) {
    await withTransientStep("Pulling your latest backups", () => pullHomeRepo());
    closeStateDb();
  }

  const result = await restoreFromBackup({
    identityPath,
    identityKey,
    only,
    at,
    dryRun,
    force,
  });

  if (json) {
    out.json({ ok: result.errors.length === 0, dryRun, ...result });
    if (result.errors.length > 0) process.exitCode = 1;
    return;
  }

  const rows = result.restored.map((r) => [out.strong(r.app), out.dim(r.targetPath)]);
  const blocks: Block[] = [];
  if (rows.length > 0) blocks.push(out.section(dryRun ? "Would restore" : "Restored", undefined, out.table(rows)));
  for (const skipped of result.skipped) blocks.push(out.line("skipped", skipped));
  if (blocks.length > 0) out.print(...blocks);
  if (result.errors.length > 0) {
    out.fail({ title: "Some backups were not restored", details: result.errors.join("\n") });
    process.exitCode = 1;
  }
}

export async function stateRestore(args: string[], _ctx: CommandContext = {}): Promise<void> {
  if (args.includes("--json")) out.payloadOnStdout();
  if (args.includes("--from-backup")) {
    return stateRestoreFromBackup(args);
  }

  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const force = args.includes("--force");

  // state.db is WAL-mode and shared live with the daemon: copyFileSync over
  // it plus deleting its -wal/-shm sidecars while the daemon holds it open
  // can corrupt the live db, not just this CLI's view of it. A deterministic
  // refusal, never an interactive prompt, so non-TTY/agent callers get a
  // clean nonzero exit instead of a hang.
  if (!force && (await isDaemonRunning())) {
    refuseWhileDaemonRuns(`rt state restore ${copyArg(args) ?? "<copy>"} --force`);
  }

  const copy = await requireCopy(args);

  const source = existsSync(copy) ? copy : join(stateBackupsDir(), copy);
  if (!existsSync(source)) fail({ title: `There is no backup called ${copy}`, next: out.cmd("rt state restore") });

  const probe = new Database(source, { readonly: true });
  let problems: string[];
  try {
    problems = quickCheck(probe);
  } finally {
    probe.close();
  }
  if (problems.length > 0) fail({ title: "That backup is damaged", why: problems.join("; "), details: source });

  closeStateDb();
  const dest = stateDbPath();
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  for (const sidecar of [`${dest}-wal`, `${dest}-shm`]) {
    try {
      unlinkSync(sidecar);
    } catch {
      // sidecar absent: a plain copy (no WAL) leaves nothing to clean up
    }
  }

  if (json) {
    out.json({ ok: true, restored: dest, from: source });
    return;
  }
  out.print(out.line("done", "Restored rt's state", basename(source)));
}
