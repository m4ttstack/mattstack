import { isPlatform, liveCount, type Row, type StatusData } from '../logic.ts';

export { liveCount };

export const LIVE_STARTING_MS = 30_000;

export type LiveCellState =
  | { kind: 'none' }
  | { kind: 'go' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'setup'; branch: string | null }
  | { kind: 'failed' }
  | { kind: 'starting' }
  | {
      kind: 'live';
      label: string;
      worktree: boolean;
      movedFrom: string | null;
    };

function starting(row: Row, now: number): boolean {
  const live = row.live;
  if (!live || live.processes.every(p => p.running)) return false;
  return now - Date.parse(live.startedAt) < LIVE_STARTING_MS;
}

export function liveCell(
  row: Row,
  data: StatusData,
  now: number
): LiveCellState {
  if (!data.devMode || !data.canManage) return { kind: 'none' };
  if (!row.managedBy || row.managedBy === 'user' || isPlatform(row.managedBy))
    return { kind: 'none' };
  if (row.liveSetup?.state === 'running')
    return { kind: 'setup', branch: row.liveSetup.branch };
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
  if (typeof row.liveBlocked === 'string')
    return { kind: 'blocked', reason: row.liveBlocked };
  if (row.liveBlocked === null) return { kind: 'go' };
  return { kind: 'none' };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function lastUsed(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const age = now - Date.parse(iso);
  if (Number.isNaN(age)) return null;
  if (age < HOUR) return 'just now';
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < 2 * DAY) return 'yesterday';
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} days ago`;
  if (age < 14 * DAY) return 'last week';
  if (age < 30 * DAY) return `${Math.floor(age / (7 * DAY))} weeks ago`;
  if (age < 60 * DAY) return 'last month';
  return `${Math.floor(age / (30 * DAY))} months ago`;
}

export function liveHealth(
  row: Row,
  now: number
): { tone: 'warn' | 'bad'; text: string } | null {
  const down = row.live?.processes.find(p => !p.running);
  if (!down) return null;
  if (starting(row, now)) return { tone: 'warn', text: 'starting' };
  return { tone: 'bad', text: `${down.kind} down` };
}
