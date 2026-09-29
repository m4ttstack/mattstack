import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let ThemeControl: typeof import('../Controls.tsx').ThemeControl;
type ThemeMode = import('../../types.ts').ThemeMode;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ ThemeControl } = await import('../Controls.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let container: HTMLElement;
let root: import('react-dom/client').Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(theme: ThemeMode, picked: ThemeMode[]) {
  await React.act(async () => {
    root.render(<ThemeControl theme={theme} pickTheme={m => picked.push(m)} />);
  });
}

const trigger = () =>
  document.querySelector<HTMLButtonElement>('[aria-label="Color scheme"]')!;
const items = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
];

test('one icon trigger opens System, Light and Dark with the stored choice checked', async () => {
  await render('system', []);
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(items()).toHaveLength(0);

  await React.act(async () => trigger().click());

  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(items().map(i => i.textContent)).toEqual(['System', 'Light', 'Dark']);
  expect(items().map(i => i.getAttribute('aria-checked'))).toEqual([
    'true',
    'false',
    'false',
  ]);
});

test('picking an option reports it and closes the menu', async () => {
  const picked: ThemeMode[] = [];
  await render('light', picked);
  await React.act(async () => trigger().click());
  await React.act(async () => items()[2]!.click());

  expect(picked).toEqual(['dark']);
  expect(items()).toHaveLength(0);
});

test('focus lands on the checked choice and returns to the trigger on close', async () => {
  await render('light', []);
  await React.act(async () => trigger().click());
  expect(document.activeElement).toBe(items()[1]!);

  await React.act(async () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  expect(items()).toHaveLength(0);
  expect(document.activeElement).toBe(trigger());

  await React.act(async () => trigger().click());
  await React.act(async () => items()[2]!.click());
  expect(document.activeElement).toBe(trigger());
});
