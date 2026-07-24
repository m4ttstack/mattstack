import { randomUUID } from 'node:crypto';
import type { Stack } from './types.ts';
import { getOperationLogFilePath } from './config-paths.ts';
import { readJson, writeJsonAtomic } from './json-store.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export type OperationType =
  | 'cascade-rebase'
  | 'reparent'
  | 'fold'
  | 'absorb'
  | 'split'
  | 'sync'
  | 'rename'
  | 'toggle-unmanaged'
  | 'retarget';

export interface CommandRecord {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  duration: number;
}

export interface OperationEntry {
  id: string;
  timestamp: number;
  operation: OperationType;
  commands: CommandRecord[];
  branchSnapshots: Record<string, string>;
  stackSnapshot: Stack;
  /**
   * Absolute repo worktree root this operation ran in. Optional so entries
   * written before repo scoping (no field) still parse. `gitq log`/`gitq undo`
   * scope to the current repo via {@link entryBelongsToRepo}.
   */
  repoPath?: string;
}

/** Callback signature for the GitShell command hook. */
export type OnCommandCallback = (
  command: string,
  args: string[],
  cwd: string,
  exitCode: number,
  duration: number,
) => void;

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 50;

// ── Path ─────────────────────────────────────────────────────────────────────

export function getOperationLogPath(): string {
  return getOperationLogFilePath();
}

// ── OperationLog ─────────────────────────────────────────────────────────────

export const OperationLog = {
  /** Start a new operation entry with branch snapshots captured from the current stack. */
  create(
    operation: OperationType,
    stack: Stack,
    branchSnapshots: Record<string, string>,
    repoPath?: string,
  ): OperationEntry {
    return {
      id: randomUUID(),
      timestamp: Date.now(),
      operation,
      commands: [],
      branchSnapshots,
      stackSnapshot: structuredClone(stack),
      ...(repoPath ? { repoPath } : {}),
    };
  },

  /** Append a command record to an in-progress entry. Returns a new entry (immutable). */
  addCommand(
    entry: OperationEntry,
    command: string,
    args: string[],
    cwd: string,
    exitCode: number,
    duration: number,
  ): OperationEntry {
    return {
      ...entry,
      commands: [...entry.commands, { command, args, cwd, exitCode, duration }],
    };
  },

  /** Build an onCommand callback that mutates the entry in-place (for use during orchestration). */
  commandHook(entry: OperationEntry): OnCommandCallback {
    return (command, args, cwd, exitCode, duration) => {
      entry.commands.push({ command, args, cwd, exitCode, duration });
    };
  },

  /** Persist an entry to the log (FIFO capped at MAX_ENTRIES). */
  async save(entry: OperationEntry): Promise<void> {
    let entries: OperationEntry[];
    try {
      entries = await readJson<OperationEntry[]>(getOperationLogFilePath(), []);
    } catch {
      entries = [];
    }
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(entries.length - MAX_ENTRIES);
    }
    await writeJsonAtomic(getOperationLogFilePath(), entries);
  },

  /** Read all operation entries from the log. */
  async load(): Promise<OperationEntry[]> {
    try {
      return await readJson<OperationEntry[]>(getOperationLogFilePath(), []);
    } catch {
      return [];
    }
  },

  /** Get the most recent operation entry, or null if the log is empty. */
  async getLastEntry(): Promise<OperationEntry | null> {
    const entries = await OperationLog.load();
    return entries.length > 0 ? (entries[entries.length - 1] ?? null) : null;
  },
};

/**
 * Whether an entry belongs to (is visible/undoable in) the given repo.
 *
 * The operation log is a single global file. An entry belongs to a repo when
 * its `repoPath` matches, so `gitq log`/`gitq undo` in one repo don't surface
 * or restore another repo's operations. Legacy entries written before repo
 * scoping (no `repoPath`) are treated as belonging to whichever repo asks,
 * since there's no scope recorded to exclude them.
 */
export function entryBelongsToRepo(entry: OperationEntry, repoPath: string): boolean {
  return entry.repoPath === undefined || entry.repoPath === repoPath;
}
