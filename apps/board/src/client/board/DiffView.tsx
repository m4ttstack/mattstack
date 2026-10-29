import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  EXTENSION_TO_FILE_FORMAT,
  getFiletypeFromFileName,
  getHighlighterIfLoaded,
  preloadHighlighter,
  registerCustomCSSVariableTheme,
  type SupportedLanguages,
} from '@pierre/diffs';
import {
  File,
  PatchDiff,
  type DiffLineAnnotation,
  type FileDiffOptions,
  type FileOptions,
} from '@pierre/diffs/react';

/** A finding pinned under its line in the full diff. */
export interface DiffPin {
  id: string;
  line: number;
}

/** Syntax colours by board role, not a theme's own palette: comments and
    punctuation take the muted text steps, and each token kind the most
    saturated step that clears 4.5 on the card and on the added, removed
    and anchored line washes in both schemes. Only bad, purple and accent
    clear at their body step on the light washes (ok, cyan, warn and gold
    measure 3.8 to 4.2), so those three carry keywords, names and
    constants, and strings and parameters take a small step. */
const CODE_THEME = 'board-code';
registerCustomCSSVariableTheme(CODE_THEME, {
  foreground: 'var(--text-1)',
  background: 'var(--card)',
  'token-comment': 'var(--text-3)',
  'token-punctuation': 'var(--text-2)',
  'token-keyword': 'var(--text-bad)',
  'token-string': 'var(--text-ok-small)',
  'token-string-expression': 'var(--text-ok-small)',
  'token-constant': 'var(--text-accent)',
  'token-function': 'var(--text-purple)',
  'token-parameter': 'var(--text-warn-small)',
  'token-link': 'var(--text-accent)',
  'token-inserted': 'var(--text-ok-small)',
  'token-deleted': 'var(--text-bad)',
  'token-changed': 'var(--text-warn-small)',
});

/** A comment's fenced code is 13px on the card alone, so every token kind
    takes its hue's body text step, which clears 4.5 there in both
    schemes. The hues per kind match the diff's. */
const FENCE_THEME = 'board-code-fence';
registerCustomCSSVariableTheme(FENCE_THEME, {
  foreground: 'var(--text-1)',
  background: 'var(--card)',
  'token-comment': 'var(--text-3)',
  'token-punctuation': 'var(--text-2)',
  'token-keyword': 'var(--text-bad)',
  'token-string': 'var(--text-ok)',
  'token-string-expression': 'var(--text-ok)',
  'token-constant': 'var(--text-accent)',
  'token-function': 'var(--text-purple)',
  'token-parameter': 'var(--text-warn)',
  'token-link': 'var(--text-accent)',
  'token-inserted': 'var(--text-ok)',
  'token-deleted': 'var(--text-bad)',
  'token-changed': 'var(--text-warn)',
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

const classListeners = new Set<() => void>();
let classObserver: MutationObserver | null = null;

/** One observer for every diff on the page, however many findings render. */
function onClassChange(listener: () => void): () => void {
  classListeners.add(listener);
  if (!classObserver) {
    classObserver = new MutationObserver(() =>
      classListeners.forEach(l => l())
    );
    classObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
  }
  return () => {
    classListeners.delete(listener);
    if (classListeners.size === 0) {
      classObserver?.disconnect();
      classObserver = null;
    }
  };
}

/** The scheme the board is drawn in: `.dark` on any ancestor. */
function useBoardDark(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(ref.current?.closest('.dark') != null);
    read();
    return onClassChange(read);
  }, []);
  return [ref, dark];
}

/** Whether the shared highlighter holds `theme` and `lang` yet. The
    renderer mounts only once it does: mounted earlier, under the board's
    StrictMode, its first draw stays an empty block until some later
    option change redraws it. */
export function useHighlighterReady(
  theme: string,
  lang: SupportedLanguages
): boolean {
  const key = `${theme}\n${lang}`;
  const [settled, setSettled] = useState<string | null>(null);
  const ready =
    settled === key || getHighlighterIfLoaded({ theme, lang }) != null;
  useEffect(() => {
    if (ready) return;
    let live = true;
    const settle = () => {
      if (live) setSettled(key);
    };
    preloadHighlighter({ themes: [theme], langs: [lang] }).then(settle, settle);
    return () => {
      live = false;
    };
  }, [theme, lang, key, ready]);
  return ready;
}

/** The file a patch's `+++ b/<path>` header names. */
function patchPath(patch: string): string {
  return /^\+\+\+ (?:b\/)?(.+)$/m.exec(patch)?.[1] ?? '';
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
  pending = null,
}: {
  patch: string;
  anchor?: number;
  pins?: DiffPin[];
  renderPin?: (pin: DiffPin) => ReactNode;
  separators?: 'metadata' | 'simple';
  /** Shown while the highlighter warms up, so the slot keeps its size. */
  pending?: ReactNode;
}) {
  const theme = CODE_THEME;
  const [ref, dark] = useBoardDark();
  const ready = useHighlighterReady(
    theme,
    getFiletypeFromFileName(patchPath(patch))
  );
  const options = useMemo<FileDiffOptions<DiffPin, undefined>>(
    () => ({
      theme,
      themeType: dark ? 'dark' : 'light',
      diffStyle: 'unified',
      diffIndicators: 'classic',
      disableFileHeader: true,
      hunkSeparators: separators,
      lineDiffType: 'none',
      overflow: 'wrap',
      unsafeCSS: BOARD_CSS,
    }),
    [theme, dark, separators]
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
      {!ready && pending}
      {ready && (
        <PatchDiff<DiffPin>
          patch={patch}
          options={options}
          lineAnnotations={annotations}
          selectedLines={selected}
          renderAnnotation={a => renderPin?.(a.metadata)}
        />
      )}
    </div>
  );
}

const KNOWN_LANGS = new Set<string>(
  Object.values(EXTENSION_TO_FILE_FORMAT).filter(
    (l): l is string => typeof l === 'string'
  )
);

/** A fence's language as the highlighter names it (`ts` is `typescript`),
    or undefined for one it does not know. */
export function fenceLanguage(lang: string): string | undefined {
  const key = lang.toLowerCase();
  const mapped = Object.hasOwn(EXTENSION_TO_FILE_FORMAT, key)
    ? EXTENSION_TO_FILE_FORMAT[key]
    : undefined;
  if (typeof mapped === 'string') return mapped;
  return KNOWN_LANGS.has(key) ? key : undefined;
}

const CODE_CSS = `${BOARD_CSS}
:host {
  --diffs-font-size: 13px;
  --diffs-light-bg: transparent;
  --diffs-dark-bg: transparent;
  --diffs-bg: transparent;
  background-color: transparent;
}
[data-code] {
  padding: 0;
  scrollbar-gutter: auto;
  overflow: visible;
}
[data-line] {
  padding-inline: 0;
}
`;

/** A comment's fenced code, highlighted with the diff view's board theme.
    A language the highlighter does not know shows `fallback`. */
export function CodeBlock({
  lang,
  code,
  fallback,
}: {
  lang: string;
  code: string;
  fallback: ReactNode;
}) {
  const [ref, dark] = useBoardDark();
  const language = fenceLanguage(lang);
  const ready = useHighlighterReady(
    FENCE_THEME,
    (language ?? 'text') as SupportedLanguages
  );
  const file = useMemo(
    () => ({ name: `fence.${lang}`, contents: code, lang: language }),
    [lang, code, language]
  );
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      theme: FENCE_THEME,
      themeType: dark ? 'dark' : 'light',
      disableFileHeader: true,
      disableLineNumbers: true,
      overflow: 'wrap',
      unsafeCSS: CODE_CSS,
    }),
    [dark]
  );
  if (!language || !ready) return fallback;
  return (
    <div ref={ref} className="tui-diff tui-md-code-hl" data-language={language}>
      <File file={file} options={options} />
    </div>
  );
}
