import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import type { GateRow } from '@mattstack/rt-client';

import {
  boardsWaiting,
  isBoardImagePath,
  parseBoards,
} from '../shared/gate-boards';
import { runIdOfGate } from '../shared/gate-run';
import { LEGACY_IMAGE_MIME } from './legacyEvidence';

export type BoardGate = Pick<
  GateRow,
  'status' | 'subject' | 'origin' | 'context'
>;

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

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean =>
  sig.every((x, i) => b[at + i] === x);

/** The image type the bytes themselves show, as upload-guard reads it. */
function sniff(b: Uint8Array): string | undefined {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return 'image/webp';
  return undefined;
}

function readFd(fd: number, size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  let off = 0;
  while (off < size) {
    const n = readSync(fd, bytes, off, size - off, off);
    if (n === 0) break;
    off += n;
  }
  return bytes.subarray(0, off);
}

export interface GateBoardFile {
  path: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** A caller-supplied path is served only while the gate still waits on the
    human, when that gate's boards@1 context names it, and when it resolves
    inside the screenshots folder or an evidence folder. The checks on the
    file itself (a regular file this user owns, one link, bytes that are the
    image its name says) run on the descriptor the bytes are read from, and
    the open refuses a symlink, and the descriptor must still be the file at
    the resolved path, so a path or a parent directory swapped after realpath
    is never served. */
export function readGateBoard({
  gate,
  path,
  home,
  uid,
  afterOpen,
}: {
  gate: BoardGate;
  path: string;
  home: string;
  uid: number;
  /** Runs between the open and the checks: the window a swapped path or a
      swapped parent directory would use. */
  afterOpen?: () => void;
}): GateBoardFile | null {
  if (!boardsWaiting(gate.status)) return null;
  const mime = LEGACY_IMAGE_MIME[extname(path).toLowerCase()];
  if (!isBoardImagePath(path) || !mime) return null;
  const named = parseBoards(gate.context)?.boards.some(b => b.path === path);
  if (!named) return null;
  const resolved = real(path);
  if (
    resolved === null ||
    LEGACY_IMAGE_MIME[extname(resolved).toLowerCase()] !== mime
  )
    return null;
  if (!rootsFor(gate, home).some(r => resolved.startsWith(`${r}/`)))
    return null;
  let fd: number;
  try {
    fd = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    afterOpen?.();
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== uid || st.nlink !== 1) return null;
    const now = lstatSync(resolved);
    if (now.dev !== st.dev || now.ino !== st.ino) return null;
    const bytes = readFd(fd, st.size);
    return sniff(bytes) === mime ? { path: resolved, mime, bytes } : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
