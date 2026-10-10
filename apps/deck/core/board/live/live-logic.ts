import { isPlatform, type Row, type StatusData } from '../logic.ts';

export const LIVE_STARTING_MS = 30_000;

export type LiveCellState =
  | { kind: 'none' }
  | { kind: 'go' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'setup'; branch: string | null }
  | { kind: 'failed' }
  | { kind: 'starting' }
  | { kind: 'live'; label: string; worktree: boolean; movedFrom: string | null };

function starting(row: Row, now: number): boolean {
  const live = row.live;
  if (!live || live.processes.every(p => p.running)) return false;
  return now - Date.parse(live.startedAt) < LIVE_STARTING_MS;
}

export function liveCell(row: Row, data: StatusData, now: number): LiveCellState {
  if (!data.devMode || !data.canManage) return { kind: 'none' };
  if (!row.managedBy || row.managedBy === 'user' || isPlatform(row.managedBy)) return { kind: 'none' };
  if (row.liveSetup?.state === 'running') return { kind: 'setup', branch: row.liveSetup.branch };
  if (row.liveSetup?.state === 'failed') return { kind: 'failed' };
  if (row.live) {
    if (starting(row, now)) return { kind: 'starting' };
    return {
      kind: 'live',
      label: row.live.main ? 'main' : (row.live.branch ?? 'worktree'),
      worktree: !row.live.main,
      movedFrom: row.live.movedFrom,
    };
  }
  if (typeof row.liveBlocked === 'string') return { kind: 'blocked', reason: row.liveBlocked };
  if (row.liveBlocked === null) return { kind: 'go' };
  return { kind: 'none' };
}

export function liveHealth(row: Row, now: number): { tone: 'warn' | 'bad'; text: string } | null {
  const down = row.live?.processes.find(p => !p.running);
  if (!down) return null;
  if (starting(row, now)) return { tone: 'warn', text: 'starting' };
  return { tone: 'bad', text: `${down.kind} down` };
}

export function liveCount(data: StatusData): number {
  return data.apps.filter(r => r.live).length;
}
