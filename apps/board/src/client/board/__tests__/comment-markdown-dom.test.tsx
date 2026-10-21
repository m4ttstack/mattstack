/** A fenced code block whose highlighter chunk fails to load falls back to
    the plain styled block instead of taking the sheet down. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { CommentMarkdown } from '../CommentMarkdown.tsx';
import { DiffSourceContext, type DiffSource } from '../diff-source.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

test('a highlighter that fails to load leaves the plain code block', async () => {
  const quiet = spyOn(console, 'error').mockImplementation(() => {});
  const broken: DiffSource = {
    fetchFileDiff: async () => null,
    loadView: () => Promise.reject(new Error('chunk failed')),
  };
  await React.act(async () => {
    root.render(
      <DiffSourceContext.Provider value={broken}>
        <CommentMarkdown>
          {'before\n\n```ts\nconst a = 1;\n```\n'}
        </CommentMarkdown>
      </DiffSourceContext.Provider>
    );
    await new Promise(r => setTimeout(r, 20));
  });
  quiet.mockRestore();
  expect(container.querySelector('.tui-md-code-body code')!.textContent).toBe(
    'const a = 1;'
  );
  expect(container.textContent).toContain('before');
});
