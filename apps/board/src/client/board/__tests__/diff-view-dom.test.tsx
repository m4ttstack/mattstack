/** The real renderer under the board's StrictMode: a code fence and a
    diff draw their lines on first mount, with no later redraw to rescue
    them. */

import React, { StrictMode } from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

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

async function drawnLines(): Promise<number> {
  for (let i = 0; i < 60; i++) {
    await React.act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
    const n =
      container
        .querySelector('diffs-container')
        ?.shadowRoot?.querySelectorAll('[data-line]').length ?? 0;
    if (n > 0) return n;
  }
  return 0;
}

test('a fence draws its lines on first mount', async () => {
  const { CodeBlock } = await import('../DiffView.tsx');
  await React.act(async () => {
    root.render(
      <StrictMode>
        <CodeBlock
          lang="ts"
          code={'const a = 1;\nexport const b = a + 1;'}
          fallback={<pre data-fallback="" />}
        />
      </StrictMode>
    );
  });
  expect(await drawnLines()).toBe(2);
});

test('a diff draws its lines on first mount', async () => {
  const { default: DiffView } = await import('../DiffView.tsx');
  await React.act(async () => {
    root.render(
      <StrictMode>
        <DiffView
          patch={
            '--- a/lib/b.ts\n+++ b/lib/b.ts\n@@ -1,2 +1,2 @@\n const a = 1;\n-export const b = a;\n+export const b = a + 1;\n'
          }
          separators="simple"
        />
      </StrictMode>
    );
  });
  expect(await drawnLines()).toBeGreaterThan(0);
});

test('a mounted view waits again when its language changes to one not loaded yet', async () => {
  const { useHighlighterReady } = await import('../DiffView.tsx');
  function Probe({ lang }: { lang: 'typescript' | 'rust' }) {
    return (
      <p>{useHighlighterReady('board-code', lang) ? 'ready' : 'waiting'}</p>
    );
  }
  const until = async (text: string) => {
    for (let i = 0; i < 60; i++) {
      if (container.textContent === text) return true;
      await React.act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });
    }
    return container.textContent === text;
  };
  await React.act(async () => root.render(<Probe lang="typescript" />));
  expect(await until('ready')).toBe(true);
  await React.act(async () => root.render(<Probe lang="rust" />));
  expect(container.textContent).toBe('waiting');
  expect(await until('ready')).toBe(true);
});

test('a fence language is only ever an own property of the format table', async () => {
  const { fenceLanguage } = await import('../DiffView.tsx');
  expect(fenceLanguage('constructor')).toBeUndefined();
  expect(fenceLanguage('__proto__')).toBeUndefined();
  expect(fenceLanguage('toString')).toBeUndefined();
  expect(fenceLanguage('ts')).toBe('typescript');
});

test('every code view on the page shares one scheme observer, released on unmount', async () => {
  const { CodeBlock } = await import('../DiffView.tsx');
  const proto = MutationObserver.prototype;
  const { observe, disconnect } = proto;
  const schemeWatchers = new Set<MutationObserver>();
  proto.observe = function (target, options) {
    if (
      target === document.documentElement &&
      options?.attributeFilter?.includes('class')
    )
      schemeWatchers.add(this);
    return observe.call(this, target, options);
  };
  proto.disconnect = function () {
    schemeWatchers.delete(this);
    return disconnect.call(this);
  };
  try {
    await React.act(async () => {
      root.render(
        <>
          {['a', 'b', 'c'].map(k => (
            <CodeBlock
              key={k}
              lang="ts"
              code={`const ${k} = 1;`}
              fallback={<pre data-fallback="" />}
            />
          ))}
        </>
      );
    });
    expect(schemeWatchers.size).toBe(1);
    await React.act(async () => root.render(<></>));
    expect(schemeWatchers.size).toBe(0);
  } finally {
    proto.observe = observe;
    proto.disconnect = disconnect;
  }
});
