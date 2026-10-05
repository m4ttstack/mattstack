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
let Controls: typeof import('../Controls.tsx').Controls;
let DEFAULT_VIEW: typeof import('../../../view.ts').DEFAULT_VIEW;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Controls } = await import('../Controls.tsx'));
  ({ DEFAULT_VIEW } = await import('../../../view.ts'));
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

test('the Show menu footer closes the menu, then opens the turn settings', async () => {
  const opened: boolean[] = [];
  await React.act(async () => {
    root.render(
      <Controls
        state={DEFAULT_VIEW}
        update={() => {}}
        theme="system"
        pickTheme={() => {}}
        onRefresh={() => {}}
        refreshing={false}
        show={{
          offered: ['authorTurn'],
          off: [],
          counts: { posted: 0, notPosted: 0, authorTurn: 2, myDrafts: 0 },
          channel: null,
          shown: 2,
          total: 2,
          toggle: () => {},
          showAll: () => {},
        }}
        onOpenTurnSettings={() =>
          opened.push(document.querySelector('[role="menu"]') !== null)
        }
      />
    );
  });
  const showing = [
    ...container.querySelectorAll<HTMLButtonElement>('.tui-menu-button'),
  ].find(b => b.textContent?.includes('Showing'))!;
  await React.act(async () => showing.click());
  const footer = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find(i => i.textContent?.includes('What counts as'))!;
  await React.act(async () => footer.click());
  expect(opened).toHaveLength(1);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

test('checking a Show item leaves the menu open', async () => {
  await React.act(async () => {
    root.render(
      <Controls
        state={DEFAULT_VIEW}
        update={() => {}}
        theme="system"
        pickTheme={() => {}}
        onRefresh={() => {}}
        refreshing={false}
        show={{
          offered: ['authorTurn'],
          off: [],
          counts: { posted: 0, notPosted: 0, authorTurn: 2, myDrafts: 0 },
          channel: null,
          shown: 2,
          total: 2,
          toggle: () => {},
          showAll: () => {},
        }}
      />
    );
  });
  const showing = [
    ...container.querySelectorAll<HTMLButtonElement>('.tui-menu-button'),
  ].find(b => b.textContent?.includes('Showing'))!;
  await React.act(async () => showing.click());
  await React.act(async () =>
    document
      .querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!
      .click()
  );
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
});
