export const DOT_COLOR: Record<'live' | 'idle', string> = {
  live: 'var(--tk-fill-ok)',
  idle: 'var(--tk-fill-warn)',
};

/** `.doing` and every other extra-small meta line. Used to have a dimmer
    `MUTED_XS_DIM` sibling for a `kind: 'path'` task line, back when
    `--tk-muted`/`--tk-muted-text` were two different shades; the mapping
    table bands both aliases onto the same role token in `color`, so that
    distinction is gone by design -- one constant now covers every small
    meta line regardless of task kind. */
export const MUTED_XS = {
  fontSize: 'var(--mantine-font-size-xs)',
  color: 'var(--tk-text-4)',
} as const;

export function headTruncatePath(cwd: string): string {
  const segments = cwd.split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? cwd;
  return `…/${leaf}`;
}
