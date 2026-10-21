import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TuiKitProvider } from '@mattstack/tui-kit/provider';
// The board's design tokens and page canvas now come from the kit, not from
// src/style.css: theme.css carries the `:root` token block (light values via
// `light-dark()`, dark flipped by `.dark { color-scheme: dark }` -- the same
// `dark` class the shell's inline script toggles on <html>), and canvas.css
// carries `* { box-sizing }`, the body ground, and `.tui`/`.tui-wide`.
// Bun.build emits both into the CSS chunk the shell links as /app.css, ahead
// of /style.css so the board's own unlayered rules still win.
import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';

import { boardDiffSource } from './board/board-diff-source.ts';
import { Board } from './board/Board.tsx';
import { DiffSourceContext } from './board/diff-source.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TuiKitProvider>
      <DiffSourceContext.Provider value={boardDiffSource}>
        <Board />
      </DiffSourceContext.Provider>
    </TuiKitProvider>
  </StrictMode>
);
