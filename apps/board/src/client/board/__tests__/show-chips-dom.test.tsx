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
let ShowChips: typeof import('../ShowChips.tsx').ShowChips;
let DEFAULT_VIEW: typeof import('../../../view.ts').DEFAULT_VIEW;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Controls } = await import('../Controls.tsx'));
  ({ ShowChips } = await import('../ShowChips.tsx'));
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

const COUNTS = { posted: 4, notPosted: 3, authorTurn: 2, myDrafts: 0 };

test('a chip per offered item, checked when its rows are on the board', async () => {
  await React.act(async () => {
    root.render(
      <ShowChips
        show={{
          offered: ['posted', 'notPosted', 'authorTurn'],
          off: ['notPosted'],
          counts: COUNTS,
          channel: 'example-reviews',
          toggle: () => {},
        }}
      />
    );
  });
  const chips = [...container.querySelectorAll('.tui-show-chip')];
  expect(chips.map(c => c.textContent)).toEqual([
    'Posted to #example-reviews4',
    'Not Posted3',
    'Waiting on author2',
  ]);
  expect(
    chips.map(c => c.querySelector<HTMLInputElement>('input')!.checked)
  ).toEqual([true, false, true]);
});

test('clicking a chip toggles its item', async () => {
  const toggled: string[] = [];
  await React.act(async () => {
    root.render(
      <ShowChips
        show={{
          offered: ['authorTurn'],
          off: [],
          counts: COUNTS,
          channel: null,
          toggle: item => toggled.push(item),
        }}
      />
    );
  });
  await React.act(async () =>
    container.querySelector<HTMLInputElement>('.tui-show-chip input')!.click()
  );
  expect(toggled).toEqual(['authorTurn']);
});

test('the settings link opens the turn settings', async () => {
  let opened = 0;
  await React.act(async () => {
    root.render(
      <ShowChips
        show={{
          offered: ['authorTurn'],
          off: [],
          counts: COUNTS,
          channel: null,
          toggle: () => {},
        }}
        onOpenTurnSettings={() => {
          opened += 1;
        }}
      />
    );
  });
  await React.act(async () =>
    container
      .querySelector<HTMLButtonElement>('.tui-show-chips-settings')!
      .click()
  );
  expect(opened).toBe(1);
});

test('the drawer offers the display settings link under its show row', async () => {
  let opened = 0;
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
          toggle: () => {},
        }}
        onOpenTurnSettings={() => {
          opened += 1;
        }}
        stacked
      />
    );
  });
  const link = [
    ...container.querySelectorAll<HTMLButtonElement>('.tui-ctl-show button'),
  ].find(b => b.textContent === 'Display Settings')!;
  await React.act(async () => link.click());
  expect(opened).toBe(1);
});
