import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
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

/** The diff renders in a shadow root, so board tokens reach it only as
    inherited custom properties, read here. */
const BOARD_CSS = `
:host {
  --diffs-bg: var(--card);
  --diffs-fg: var(--text-1);
  --diffs-fg-number-override: var(--text-4);
  --diffs-bg-separator-override: var(--surface-wash-fg-4-card);
  --diffs-addition-color-override: var(--fill-ok);
  --diffs-deletion-color-override: var(--fill-bad);
  --diffs-selection-color-override: var(--fill-accent);
  --diffs-bg-selection-override: var(--fill-accent);
  --diffs-bg-selection-number-override: var(--fill-accent);
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
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
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
