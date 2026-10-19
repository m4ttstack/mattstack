import { realpathSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { GateRow } from '@mattstack/rt-client';

import { isBoardImagePath, parseBoards } from '../shared/gate-boards';
import { runIdOfGate } from '../shared/gate-run';
import { LEGACY_IMAGE_MIME } from './legacyEvidence';

export type BoardGate = Pick<
  GateRow,
  'status' | 'subject' | 'origin' | 'context'
>;

const WAITING: GateRow['status'][] = ['open', 'parked'];
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function real(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function rootsFor(gate: BoardGate, home: string): string[] {
  const roots = [
    join(home, '.fast-browser', 'screenshots'),
    join(home, '.mattstack', 'evidence'),
  ];
  const runId = runIdOfGate(gate as GateRow);
  if (runId && SAFE_RUN_ID.test(runId))
    roots.push(join(home, '.mattstack', 'work', runId, 'evidence'));
  return roots.flatMap(r => real(r) ?? []);
}

export const boardMime = (path: string): string | undefined =>
  LEGACY_IMAGE_MIME[extname(path).toLowerCase()];

/** A caller-supplied path is served only while the gate still waits on the
    human, when that gate's boards@1 context names it, and when it resolves
    to a file this user owns inside the screenshots folder or an evidence
    folder. The resolved path is what a caller must read: resolving again
    would reopen the window for a link swapped after the check. */
export function gateBoardPath({
  gate,
  path,
  home,
  uid,
}: {
  gate: BoardGate;
  path: string;
  home: string;
  uid: number;
}): string | null {
  if (!WAITING.includes(gate.status)) return null;
  if (!isBoardImagePath(path) || !boardMime(path)) return null;
  const named = parseBoards(gate.context)?.boards.some(b => b.path === path);
  if (!named) return null;
  const resolved = real(path);
  if (resolved === null || !boardMime(resolved)) return null;
  if (!rootsFor(gate, home).some(r => resolved.startsWith(`${r}/`)))
    return null;
  try {
    const st = statSync(resolved);
    return st.isFile() && st.uid === uid ? resolved : null;
  } catch {
    return null;
  }
}
