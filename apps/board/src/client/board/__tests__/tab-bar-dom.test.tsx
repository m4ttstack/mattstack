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
let TabBar: typeof import('../TabBar.tsx').TabBar;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ TabBar } = await import('../TabBar.tsx'));
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

const TABS = [
  { id: 'a', label: 'A', source: { kind: 'authors' as const } },
  {
    id: 'w',
    label: 'Web',
    source: { kind: 'codeowners' as const, section: '@acme/web' },
  },
];

async function renderBar(forge?: 'github' | 'gitlab') {
  await React.act(async () => {
    root.render(
      <TabBar
        tabs={TABS}
        active="a"
        onPick={() => {}}
        syncing={false}
        unknown={['w']}
        forge={forge}
      />
    );
  });
  return container.querySelector('[data-flag]')!;
}

test('GitHub names the missing owner and the CODEOWNERS file', async () => {
  const chip = await renderBar('github');
  expect(chip.textContent).toBe('no such owner');
  expect(chip.getAttribute('title')).toBe(
    "this tab's owner is not in the repo's CODEOWNERS file"
  );
});

test('GitLab keeps the no such section chip and tooltip', async () => {
  for (const forge of ['gitlab', undefined] as const) {
    const chip = await renderBar(forge);
    expect(chip.textContent).toBe('no such section');
    expect(chip.getAttribute('title')).toBe(
      "this tab's section is not in the project's CODEOWNERS"
    );
  }
});
