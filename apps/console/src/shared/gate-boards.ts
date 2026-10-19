/** Mirrors lib/gates/ctx.ts's boards@1 check: a context that fails it is
    prose, never a board list. */
export const BOARDS_QUESTION =
  'Look at each board: is there anything here that should not be public?';

/** A boards gate's images are served only while the gate still waits on the
    human: open, or parked. */
export const boardsWaiting = (status: string): boolean =>
  status === 'open' || status === 'parked';

export interface GateBoard {
  case: string;
  slot: 'before' | 'after' | 'crop';
  path: string;
  caption: string;
  theme?: 'light' | 'dark';
}

export interface BoardsContext {
  summary?: string;
  boards: GateBoard[];
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

const text = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

export function isBoardImagePath(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.startsWith('/') &&
    IMAGE.test(v) &&
    !v.split('/').includes('..')
  );
}

function boardOf(v: unknown): GateBoard | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  if (!text(b.case) || !text(b.caption) || !isBoardImagePath(b.path))
    return null;
  if (b.slot !== 'before' && b.slot !== 'after' && b.slot !== 'crop')
    return null;
  if (b.theme !== undefined && b.theme !== 'light' && b.theme !== 'dark')
    return null;
  return {
    case: b.case,
    slot: b.slot,
    path: b.path,
    caption: b.caption,
    ...(b.theme ? { theme: b.theme } : {}),
  };
}

export function parseBoards(
  context: string | null | undefined
): BoardsContext | null {
  if (!context) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(context);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c['gate-ctx'] !== 'boards@1' || !Array.isArray(c.boards)) return null;
  if (c.summary !== undefined && !text(c.summary)) return null;
  const boards = c.boards.map(boardOf);
  if (boards.length === 0 || boards.some(b => b === null)) return null;
  return {
    ...(c.summary !== undefined ? { summary: c.summary as string } : {}),
    boards: boards as GateBoard[],
  };
}

export const boardName = (b: GateBoard): string =>
  [b.case, b.slot, ...(b.theme ? [b.theme] : [])].join('/');

/** A closed gate's boards as words: the route serves no image once the gate
    stops waiting, so the record reads what the human was shown. */
export function boardsMarkdown(ctx: BoardsContext): string {
  return [
    ...(ctx.summary ? [ctx.summary, ''] : []),
    BOARDS_QUESTION,
    '',
    ...ctx.boards.flatMap(b => [
      `- **${boardName(b)}**: ${b.caption}`,
      `  \`${b.path}\``,
    ]),
  ].join('\n');
}
