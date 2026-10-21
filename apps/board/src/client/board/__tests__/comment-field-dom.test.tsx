/** Every comment field (a review comment, a respond reply, the summary)
    carries Write and Preview tabs: Preview renders the same text as
    Markdown, and in Write a Tab indents by two spaces while Shift-Tab and
    Escape still leave the field. */

import React, { useState } from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { CommentComposer } from '../CommentComposer.tsx';

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
  [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    b => b.textContent === name
  )!;
const key = (el: Element, init: KeyboardEventInit) =>
  React.act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });

test('the tabs are Write and Preview, with Write selected', async () => {
  await React.act(async () => root.render(<Host draft="hello" />));
  const list = container.querySelector('[role="tablist"]')!;
  expect(list.getAttribute('aria-label')).toBe('Comment on finding 1: view');
  expect(
    [...list.querySelectorAll('[role="tab"]')].map(t => [
      t.textContent,
      t.getAttribute('aria-selected'),
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
  const preview = container.querySelector('[role="tabpanel"]')!;
  expect(preview.getAttribute('aria-label')).toBe(
    'Comment on finding 1: preview'
  );
  expect(preview.querySelector('code')!.textContent).toBe('requireActual');
  expect(
    [...preview.querySelectorAll('li')].map(li => li.textContent)
  ).toEqual(['one', 'two']);
  expect(tab('Preview').getAttribute('aria-selected')).toBe('true');
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

test('Escape in the field hands focus to the sheet', async () => {
  await React.act(async () => root.render(<Host draft="ab" />));
  const el = box()!;
  el.focus();
  await key(el, { key: 'Escape' });
  expect(document.activeElement).toBe(container.querySelector('[role="dialog"]'));
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
