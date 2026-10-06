import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let SettingsModal: typeof import('../SettingsModal.tsx').SettingsModal;

const realFetch = globalThis.fetch;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ SettingsModal } = await import('../SettingsModal.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = '';
  globalThis.fetch = realFetch;
});

async function render(local: boolean, canInvite = false): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const noop = () => {};
  await React.act(async () => {
    createRoot(container).render(
      <SettingsModal
        members={[
          { username: 'alice', name: 'Alice', hidden: false, count: 0 },
          { username: 'bob', name: 'Bob', hidden: true, count: null },
          { username: 'carol', name: 'Carol', hidden: false, count: 2 },
        ]}
        canInvite={canInvite}
        local={local}
        defaultMember="alice"
        onToggle={noop}
        onClose={noop}
      />
    );
  });
  return container;
}

function rowText(el: HTMLElement, name: string): string {
  const row = [...el.querySelectorAll('li.tui-modal-row')].find(li =>
    li.textContent?.includes(name)
  );
  return row?.textContent ?? '';
}

test('a local viewer can check members in and out, each box named, with no hover tooltip on the row', async () => {
  const el = await render(true);
  const boxes = el.querySelectorAll('input.tui-check-box');
  expect(boxes).toHaveLength(3);
  expect(boxes[0]?.getAttribute('aria-label')).toBe('Alice checked in');
  expect(el.querySelectorAll('label.tui-modal-name[title]')).toHaveLength(0);
});

test('a public viewer sees the roster with no check-in/out toggle', async () => {
  const el = await render(false);
  expect(el.querySelectorAll('input.tui-check-box')).toHaveLength(0);
  expect(el.textContent).toContain('Alice');
  expect(el.textContent).toContain('Bob');
});

test('a peered teammate gets a read-only badge, and the modal offers no invite, remove or join controls', async () => {
  globalThis.fetch = (async () =>
    Response.json({
      boards: [{ username: 'Bob' }, { username: 'alice' }],
    })) as unknown as typeof fetch;
  const el = await render(true, true);
  await React.act(async () => {});

  const badge = el.querySelector('.tui-phrase[data-peered]');
  expect(badge?.getAttribute('data-hue')).toBe('accent');
  expect(badge?.closest('label.tui-modal-name')?.textContent).toContain('Bob');
  expect(rowText(el, 'Bob')).toContain('peered');
  expect(rowText(el, 'Carol')).not.toContain('peered');
  expect(rowText(el, 'Alice')).not.toContain('peered');
  expect(el.querySelectorAll('button:not([aria-label])')).toHaveLength(0);
  expect(el.querySelectorAll('input:not(.tui-check-box)')).toHaveLength(0);
  expect(el.textContent).not.toMatch(/invite|remove|join/);
});
