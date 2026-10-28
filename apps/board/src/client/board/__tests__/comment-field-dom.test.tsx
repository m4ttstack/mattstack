/** Every comment field (a review comment, a respond reply, the summary)
    carries Write and Preview tabs: Preview renders the same text as
    Markdown, and in Write a Tab indents by two spaces while Shift-Tab and
    Escape still leave the field. */

import React, { useState } from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { CommentComposer } from '../CommentComposer.tsx';
import { DiffSourceContext, type DiffSource } from '../diff-source.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let latest: string | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  latest = undefined;
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

function Host({ draft }: { draft: string }) {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <div role="dialog" tabIndex={-1}>
      <CommentComposer
        label="Comment on finding 1"
        noun="comment"
        kicker="will post as comment"
        draft={draft}
        value={value}
        onChange={t => {
          latest = t;
          setValue(t);
        }}
        onReset={() => setValue(undefined)}
      />
    </div>
  );
}

const box = () =>
  container.querySelector<HTMLTextAreaElement>('textarea.tui-composer-input');
const tab = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('.tui-field-tab')].find(
    b => b.textContent === name
  )!;
const key = (el: Element, init: KeyboardEventInit) =>
  React.act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });

test('the tabs are Write and Preview, with Write selected', async () => {
  await React.act(async () => root.render(<Host draft="hello" />));
  const list = container.querySelector('.tui-field-tabs')!;
  expect(list.getAttribute('aria-label')).toBe('Comment on finding 1: view');
  expect(
    [...list.querySelectorAll('.tui-field-tab')].map(t => [
      t.textContent,
      t.getAttribute('aria-pressed'),
    ])
  ).toEqual([
    ['Write', 'true'],
    ['Preview', 'false'],
  ]);
  expect(box()).not.toBeNull();
});

test('Preview renders the text as Markdown, and Write brings the field back', async () => {
  await React.act(async () =>
    root.render(<Host draft={'Use `requireActual` here:\n\n- one\n- two'} />)
  );
  await React.act(async () => tab('Preview').click());
  expect(box()).toBeNull();
  const preview = container.querySelector('.tui-field-preview')!;
  expect(preview.getAttribute('aria-label')).toBe(
    'Comment on finding 1: preview'
  );
  expect(preview.querySelector('code')!.textContent).toBe('requireActual');
  expect([...preview.querySelectorAll('li')].map(li => li.textContent)).toEqual(
    ['one', 'two']
  );
  expect(tab('Preview').getAttribute('aria-pressed')).toBe('true');
  await React.act(async () => tab('Write').click());
  expect(box()!.value).toBe('Use `requireActual` here:\n\n- one\n- two');
});

test('Tab in the field inserts two spaces at the caret and stays in the field', async () => {
  await React.act(async () => root.render(<Host draft="ab" />));
  const el = box()!;
  el.focus();
  el.setSelectionRange(1, 1);
  await key(el, { key: 'Tab' });
  expect(latest).toBe('a  b');
  expect(box()!.value).toBe('a  b');
  expect(document.activeElement).toBe(box());
  expect(box()!.selectionStart).toBe(3);
});

test('Tab replaces a selection with the two spaces', async () => {
  await React.act(async () => root.render(<Host draft="abcd" />));
  const el = box()!;
  el.focus();
  el.setSelectionRange(1, 3);
  await key(el, { key: 'Tab' });
  expect(latest).toBe('a  d');
});

test('Shift-Tab is left to the browser, so it leaves the field', async () => {
  await React.act(async () => root.render(<Host draft="ab" />));
  const el = box()!;
  const ev = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  await React.act(async () => {
    el.dispatchEvent(ev);
  });
  expect(ev.defaultPrevented).toBe(false);
  expect(latest).toBeUndefined();
});

test("Escape in the field moves focus to the field's own Write tab, inside the sheet", async () => {
  await React.act(async () => root.render(<Host draft="ab" />));
  const el = box()!;
  el.focus();
  await key(el, { key: 'Escape' });
  expect(document.activeElement).toBe(tab('Write'));
  expect(
    container.querySelector('[role="dialog"]')!.contains(document.activeElement)
  ).toBe(true);
});

test('reset while in Preview goes back to Write and focuses the field', async () => {
  await React.act(async () => root.render(<Host draft="ab" />));
  const el = box()!;
  el.focus();
  el.setSelectionRange(1, 1);
  await key(el, { key: 'Tab' });
  await React.act(async () => tab('Preview').click());
  expect(box()).toBeNull();
  await React.act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Comment on finding 1: reset to draft"]'
      )!
      .click()
  );
  expect(tab('Write').getAttribute('aria-pressed')).toBe('true');
  expect(box()!.value).toBe('ab');
  expect(document.activeElement).toBe(box());
});

test('a read-only held field takes no Tab', async () => {
  await React.act(async () =>
    root.render(
      <CommentComposer
        label="Reply on a.ts:1"
        noun="reply"
        kicker="will post as reply"
        draft="held"
        value={undefined}
        canEdit={false}
        onChange={t => (latest = t)}
        onReset={() => {}}
      />
    )
  );
  const el = box()!;
  await key(el, { key: 'Tab' });
  expect(latest).toBeUndefined();
});

test('a strip needs a kicker or a where: the types refuse neither', () => {
  const bare = (
    // @ts-expect-error neither kicker nor where names the strip
    <CommentComposer
      label="Comment on finding 1"
      noun="comment"
      draft="d"
      value={undefined}
      onChange={() => {}}
      onReset={() => {}}
    />
  );
  expect(bare).toBeDefined();
});

const RICH = [
  'Small one: `requireActual` drops `__esModule`.',
  '',
  '- [x] spread it',
  '- set it back',
  '',
  '> the old mock read it directly',
  '',
  '| file | change |',
  '| --- | --- |',
  '| a.ts | +2 |',
  '',
  '```ts',
  'const mod = jest.requireActual("./config");',
  '```',
  '',
  '```suggestion:-0+0',
  'export default { ...mod, __esModule: true };',
  '```',
].join('\n');

async function preview(draft: string, diffs?: DiffSource) {
  const host = <Host draft={draft} />;
  await React.act(async () =>
    root.render(
      diffs ? (
        <DiffSourceContext.Provider value={diffs}>
          {host}
        </DiffSourceContext.Provider>
      ) : (
        host
      )
    )
  );
  await React.act(async () => tab('Preview').click());
  return container.querySelector<HTMLElement>('.tui-field-preview')!;
}

test('Preview reads like the comment will: inline code, task list, quote, table', async () => {
  const panel = await preview(RICH);
  expect(panel.querySelector('p code')!.textContent).toBe('requireActual');
  expect(
    panel.querySelector<HTMLInputElement>('.task-list-item input')!.checked
  ).toBe(true);
  expect(panel.querySelector('blockquote')!.textContent).toContain(
    'the old mock read it directly'
  );
  expect(panel.querySelector('td')!.textContent).toBe('a.ts');
});

test('a fenced block shows its language over the code, and plain without a highlighter', async () => {
  const panel = await preview(RICH);
  const block = panel.querySelector<HTMLElement>(
    '.tui-md-code[data-lang="ts"]'
  )!;
  expect(block.querySelector('.tui-md-code-head')!.textContent).toBe(
    'TypeScript'
  );
  expect(block.querySelector('pre code')!.textContent).toBe(
    'const mod = jest.requireActual("./config");'
  );
  expect(block.querySelector('.tui-md-code-hl')).toBeNull();
});

test('a suggestion fence reads as a suggested change', async () => {
  const panel = await preview(RICH);
  const block = panel.querySelector<HTMLElement>(
    '.tui-md-code[data-suggestion]'
  )!;
  expect(block.querySelector('.tui-md-code-head')!.textContent).toBe(
    'Suggested change'
  );
  expect(block.textContent).toContain('__esModule: true');
});

test('with a source that brings the renderer, a fence is highlighted in its language', async () => {
  const seen: string[] = [];
  const diffs: DiffSource = {
    fetchFileDiff: async () => null,
    loadView: async () =>
      ({
        default: () => null,
        CodeBlock: ({ lang, code }: { lang: string; code: string }) => {
          seen.push(lang);
          return <pre data-highlighted={lang}>{code}</pre>;
        },
      }) as unknown as typeof import('../DiffView.tsx'),
  };
  const panel = await preview(RICH, diffs);
  await React.act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });
  expect(panel.querySelector('[data-highlighted="ts"]')!.textContent).toBe(
    'const mod = jest.requireActual("./config");'
  );
  expect(seen).toEqual(['ts']);
  expect(
    panel.querySelector('.tui-md-code[data-suggestion] [data-highlighted]')
  ).toBeNull();
});

test('empty text previews as a muted note', async () => {
  const panel = await preview('   ');
  expect(panel.querySelector('.tui-field-preview-empty')!.textContent).toBe(
    'Nothing to preview'
  );
});

test('Preview keeps at least the Write field height', async () => {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 120,
  });
  try {
    const panel = await preview('one line');
    expect(panel.style.getPropertyValue('--field-h')).toBe('120px');
  } finally {
    delete (HTMLTextAreaElement.prototype as { offsetHeight?: number })
      .offsetHeight;
  }
});
