import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { DecisionBanner } = await import('../DecisionBanner.tsx');

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let opened: number;
let unmount: () => Promise<void>;

beforeEach(async () => {
  opened = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(
      <DecisionBanner
        copy={{ title: '1 decision is waiting on you', detail: 'detail' }}
        onStart={() => {
          opened += 1;
        }}
      />
    );
  });
  unmount = () => React.act(async () => root.unmount());
});

afterEach(async () => {
  await unmount();
  document.body.innerHTML = '';
});

function press(
  init: KeyboardEventInit = {},
  target: EventTarget = document.body
) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'g',
      bubbles: true,
      cancelable: true,
      ...init,
    })
  );
}

function add(html: string): Element {
  document.body.insertAdjacentHTML('beforeend', html);
  return document.body.lastElementChild!;
}

test('the banner shows the key beside the button', () => {
  const button = document.querySelector('.tui-dq-open')!;
  expect(button.getAttribute('aria-keyshortcuts')).toBe('g');
  const cap = document.querySelector('.tui-dq-key kbd')!;
  expect(cap.getAttribute('data-keys')).toBe('g');
  expect(button.textContent).toBe('Open queue');
});

test('g opens the queue, from the page or a focused control', () => {
  press();
  press({}, add('<button type="button">x</button>'));
  expect(opened).toBe(2);
});

test('another key, a modifier or a held key does nothing', () => {
  press({ key: 'h' });
  press({ metaKey: true });
  press({ ctrlKey: true });
  press({ altKey: true });
  press({ repeat: true });
  expect(opened).toBe(0);
});

test('g typed into a field stays in the field', () => {
  press({}, add('<input type="text" />'));
  press({}, add('<textarea></textarea>'));
  expect(opened).toBe(0);
});

test.each(['dialog', 'alertdialog', 'menu', 'listbox'])(
  'an open %s keeps its keys',
  role => {
    const layer = add(`<div role="${role}"></div>`);
    press();
    expect(opened).toBe(0);
    layer.remove();
    press();
    expect(opened).toBe(1);
  }
);

test('the key goes with the banner', async () => {
  await unmount();
  press();
  expect(opened).toBe(0);
});
