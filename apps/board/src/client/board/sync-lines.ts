/** A local sync's output as it streams in, per MR, and rt's plain line
    format read back into the glyphs rt-ui draws in a terminal. */

export type SyncLineStatus =
  | 'done'
  | 'failed'
  | 'needs-you'
  | 'pending'
  | 'stale'
  | 'refused'
  | 'off'
  | 'skipped'
  | 'running'
  | 'warn';

export interface SyncLine {
  status: SyncLineStatus | null;
  /** rt-ui's glyph for the status; null on a continuation line. */
  glyph: string | null;
  title: string;
  hint?: string;
}

// lib/ui/out-plain.ts's TAG table, and ui/internal/render/style.go's glyphs.
const TAGS: Record<string, { status: SyncLineStatus; glyph: string }> = {
  ok: { status: 'done', glyph: '✓' },
  failed: { status: 'failed', glyph: '✗' },
  'needs you': { status: 'needs-you', glyph: '◆' },
  'not yet': { status: 'pending', glyph: '◌' },
  'out of date': { status: 'stale', glyph: '↻' },
  refused: { status: 'refused', glyph: '⊘' },
  off: { status: 'off', glyph: '○' },
  skipped: { status: 'skipped', glyph: '-' },
  running: { status: 'running', glyph: '●' },
  warning: { status: 'warn', glyph: '!' },
};

const TAGGED = /^\[([a-z ]+)\]\s?(.*)$/;

export function parseSyncLine(raw: string): SyncLine {
  const m = TAGGED.exec(raw);
  const tag = m ? TAGS[m[1]!] : undefined;
  if (!m || !tag) return { status: null, glyph: null, title: raw.trimEnd() };
  // Plain output sets a line's hint two spaces after its title.
  const [title, ...rest] = m[2]!.split('  ');
  const hint = rest.join('  ').trim();
  return {
    status: tag.status,
    glyph: tag.glyph,
    title: title!.trim(),
    ...(hint ? { hint } : {}),
  };
}

type Listener = () => void;
const live = new Map<string, readonly string[]>();
const autoOpen = new Set<string>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeSyncLines(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveSyncLines(mrUrl: string): readonly string[] | undefined {
  return live.get(mrUrl);
}

/** A click on "rebase locally": a fresh log, opened for whoever clicked. */
export function startSyncLines(mrUrl: string): void {
  live.set(mrUrl, []);
  autoOpen.add(mrUrl);
  emit();
}

export function pushSyncLine(mrUrl: string, line: string): void {
  live.set(mrUrl, [...(live.get(mrUrl) ?? []), line]);
  emit();
}

export function takeAutoOpen(mrUrl: string): boolean {
  return autoOpen.delete(mrUrl);
}

/** What the popover shows: the saved log once the server has the whole of
    it, the streamed lines while they are ahead of it. */
export function shownSyncLog(
  saved: readonly string[] | undefined,
  streamed: readonly string[] | undefined
): readonly string[] {
  const a = saved ?? [];
  const b = streamed ?? [];
  return b.length > a.length ? b : a;
}
