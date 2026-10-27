import { useEffect, useMemo, useState } from 'react';
import { useColorScheme } from '@mattstack/app-kit/hooks';
import {
  getFiletypeFromFileName,
  getHighlighterIfLoaded,
  preloadHighlighter,
  registerCustomCSSVariableTheme,
  type SupportedLanguages,
} from '@pierre/diffs';
import { PatchDiff, type FileDiffOptions } from '@pierre/diffs/react';

/** The board's review diff palette, on the console's tokens: muted steps for
    comments and punctuation, and per token kind the step that clears 4.5 on
    the card and on the added and removed washes in both schemes. */
const THEME = 'console-code';
registerCustomCSSVariableTheme(THEME, {
  foreground: 'var(--tk-text-1)',
  background: 'var(--tk-card)',
  'token-comment': 'var(--tk-text-3)',
  'token-punctuation': 'var(--tk-text-2)',
  'token-keyword': 'var(--tk-text-bad)',
  'token-string': 'var(--tk-text-ok-small)',
  'token-string-expression': 'var(--tk-text-ok-small)',
  'token-constant': 'var(--tk-text-accent)',
  'token-function': 'var(--tk-text-purple)',
  'token-parameter': 'var(--tk-text-warn-small)',
  'token-link': 'var(--tk-text-accent)',
  'token-inserted': 'var(--tk-text-ok-small)',
  'token-deleted': 'var(--tk-text-bad)',
  'token-changed': 'var(--tk-text-warn-small)',
});

/** The diff renders in a shadow root, so console tokens reach it only as
    inherited custom properties. */
const CSS = `
:host {
  color-scheme: inherit;
  --diffs-bg: var(--tk-card);
  --diffs-fg: var(--tk-text-1);
  --diffs-font-size: 12px;
  --diffs-fg-number-override: var(--tk-text-3);
  --diffs-fg-number-addition-override: var(--tk-text-ok-small);
  --diffs-fg-number-deletion-override: var(--tk-text-bad-small);
  --diffs-bg-separator-override: var(--tk-panel);
  --diffs-addition-color-override: var(--tk-fill-ok);
  --diffs-deletion-color-override: var(--tk-fill-bad);
}
[data-separator] {
  font-family: var(--mantine-font-family-monospace);
  color: var(--tk-text-3);
}
`;

/** Whether the shared highlighter holds the theme and `lang` yet. Mounted
    earlier, under StrictMode, the renderer's first draw stays empty until
    some later option change redraws it. */
function useHighlighterReady(lang: SupportedLanguages): boolean {
  const [settled, setSettled] = useState<string | null>(null);
  const ready =
    settled === lang || getHighlighterIfLoaded({ theme: THEME, lang }) != null;
  useEffect(() => {
    if (ready) return;
    let live = true;
    const settle = () => {
      if (live) setSettled(lang);
    };
    preloadHighlighter({ themes: [THEME], langs: [lang] }).then(settle, settle);
    return () => {
      live = false;
    };
  }, [lang, ready]);
  return ready;
}

/** One file's patch, highlighted, with the changed words marked. */
export default function PatchView({
  patch,
  path,
}: {
  patch: string;
  path: string;
}) {
  const { computedColorScheme } = useColorScheme();
  const ready = useHighlighterReady(getFiletypeFromFileName(path));
  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      theme: THEME,
      themeType: computedColorScheme === 'dark' ? 'dark' : 'light',
      diffStyle: 'unified',
      diffIndicators: 'classic',

      hunkSeparators: 'line-info',
      lineDiffType: 'word',
      overflow: 'wrap',
      unsafeCSS: CSS,
    }),
    [computedColorScheme]
  );
  return ready ? <PatchDiff patch={patch} options={options} /> : null;
}
