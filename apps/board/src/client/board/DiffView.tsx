import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { registerCustomCSSVariableTheme } from '@pierre/diffs';
import {
  PatchDiff,
  type DiffLineAnnotation,
  type FileDiffOptions,
} from '@pierre/diffs/react';

/** A finding pinned under its line in the full diff. */
export interface DiffPin {
  id: string;
  line: number;
}

/** Syntax colours by board role, not a theme's own palette: comments and
    punctuation take the muted text steps, and each token kind its hue's
    small-text step (the code is 12px), so every pair clears its bar on the
    card and on the added, removed and anchored line washes in both
    schemes. */
const CODE_THEME = 'board-code';
registerCustomCSSVariableTheme(CODE_THEME, {
  foreground: 'var(--text-1)',
  background: 'var(--card)',
  'token-comment': 'var(--text-3)',
  'token-punctuation': 'var(--text-2)',
  'token-keyword': 'var(--text-purple-small)',
  'token-string': 'var(--text-ok-small)',
  'token-string-expression': 'var(--text-ok-small)',
  'token-constant': 'var(--text-cyan-small)',
  'token-function': 'var(--text-accent-small)',
  'token-parameter': 'var(--text-warn-small)',
  'token-link': 'var(--text-accent-small)',
  'token-inserted': 'var(--text-ok-small)',
  'token-deleted': 'var(--text-bad-small)',
  'token-changed': 'var(--text-warn-small)',
});

/** The diff renders in a shadow root, so board tokens reach it only as
    inherited custom properties, read here. The host takes the board's own
    colour scheme, which the tokens' light-dark() values resolve against.
    The anchored line is a light accent wash with accent-ink numbers. */
const BOARD_CSS = `
:host {
  color-scheme: inherit;
  --diffs-bg: var(--card);
  --diffs-fg: var(--text-1);
  --diffs-fg-number-override: var(--text-3);
  --diffs-fg-number-addition-override: var(--text-ok-small);
  --diffs-fg-number-deletion-override: var(--text-bad-small);
  --diffs-bg-separator-override: var(--surface-wash-fg-4-card);
  --diffs-addition-color-override: var(--fill-ok);
  --diffs-deletion-color-override: var(--fill-bad);
  --diffs-selection-number-fg: var(--text-accent-small);
}
[data-line][data-selected-line] {
  --diffs-computed-selected-line-bg: color-mix(in srgb, var(--fill-accent) 12%, var(--card));
}
[data-column-number][data-selected-line] {
  --diffs-computed-selected-line-bg: color-mix(in srgb, var(--fill-accent) 20%, var(--card));
  color: var(--text-accent-small);
}
[data-separator] {
  font-family: var(--font-mono);
  color: var(--text-3);
}
`;

/** The scheme the board is drawn in: `.dark` on any ancestor. */
function useBoardDark(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(ref.current?.closest('.dark') != null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);
  return [ref, dark];
}

/** A unified diff of one file's patch, highlighted, in board colours.
    `anchor` marks the line a finding sits on; `pins` hang
    `renderPin`'s output under their lines. */
export default function DiffView({
  patch,
  anchor,
  pins,
  renderPin,
  separators = 'metadata',
}: {
  patch: string;
  anchor?: number;
  pins?: DiffPin[];
  renderPin?: (pin: DiffPin) => ReactNode;
  separators?: 'metadata' | 'simple';
}) {
  const [ref, dark] = useBoardDark();
  const options = useMemo<FileDiffOptions<DiffPin, undefined>>(
    () => ({
      theme: CODE_THEME,
      themeType: dark ? 'dark' : 'light',
      diffStyle: 'unified',
      diffIndicators: 'classic',
      disableFileHeader: true,
      hunkSeparators: separators,
      lineDiffType: 'none',
      overflow: 'wrap',
      unsafeCSS: BOARD_CSS,
    }),
    [dark, separators]
  );
  const annotations = useMemo<DiffLineAnnotation<DiffPin>[]>(
    () =>
      (pins ?? []).map(pin => ({
        side: 'additions',
        lineNumber: pin.line,
        metadata: pin,
      })),
    [pins]
  );
  const selected = useMemo(
    () =>
      anchor !== undefined
        ? { start: anchor, end: anchor, side: 'additions' as const }
        : null,
    [anchor]
  );
  return (
    <div ref={ref} className="tui-diff">
      <PatchDiff<DiffPin>
        patch={patch}
        options={options}
        lineAnnotations={annotations}
        selectedLines={selected}
        renderAnnotation={a => renderPin?.(a.metadata)}
      />
    </div>
  );
}
