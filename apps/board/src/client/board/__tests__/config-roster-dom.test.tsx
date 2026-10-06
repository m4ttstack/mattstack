/** The roster row edits the org roster. In the everyone view a remove takes
    someone out of the org, so only an org admin is offered it, and it says
    so; in a team view the row keeps its drop. */
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
let ConfigModal: typeof import('../ConfigModal.tsx').ConfigModal;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ ConfigModal } = await import('../ConfigModal.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const def = (key: string, type: string, value: unknown) => ({
  key,
  type,
  scopes: ['user'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description: key,
  hasDefault: false,
  effective: { scope: 'user', value },
});

const DEFS = [
  def('board.defaultMember', 'string', 'dev1'),
  def('board.hiddenMembers', 'array', []),
];

const MEMBERS = [
  { username: 'dev1', name: null, hidden: false, count: 0 },
  { username: 'dev2', name: null, hidden: false, count: 0 },
];

let posts: { url: string; body: unknown }[];
const realFetch = globalThis.fetch;
const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  posts = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/settings/defs')) return json({ defs: DEFS });
    if (url === '/roster') {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ ok: true }),
      } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
  localStorage.clear();
});

const flush = () =>
  React.act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });

async function render(
  rosterView: { everyone: boolean; orgAdmin: boolean } | null
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const noop = () => {};
  await React.act(async () => {
    createRoot(container).render(
      <ConfigModal
        tabs={[]}
        members={MEMBERS}
        rosterView={rosterView}
        knownSections={null}
        onClose={noop}
        onOpenRoster={noop}
        onTabsSaved={noop}
        onRosterSaved={noop}
      />
    );
  });
  await flush();
}

const button = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

test('the everyone view offers a member nobody to remove', async () => {
  await render({ everyone: true, orgAdmin: false });
  expect(document.querySelector('.tui-roster-item')).not.toBeNull();
  expect(button('remove dev2 from the org')).toBeNull();
  expect(button('drop dev2')).toBeNull();
});

test('the everyone view offers an org admin a remove from the org, and confirms it in those words', async () => {
  await render({ everyone: true, orgAdmin: true });
  const remove = button('remove dev2 from the org')!;
  expect(remove.title).toBe('remove from the org');
  await React.act(async () => remove.click());
  const confirm = [...document.querySelectorAll('button')].find(
    b => b.textContent === 'confirm remove from the org'
  )!;
  expect(confirm).toBeDefined();
  await React.act(async () => confirm.click());
  await flush();
  expect(posts).toEqual([
    { url: '/roster', body: { action: 'remove', username: 'dev2' } },
  ]);
});

test('a team view keeps its drop', async () => {
  await render({ everyone: false, orgAdmin: false });
  expect(button('drop dev2')).not.toBeNull();
  expect(button('remove dev2 from the org')).toBeNull();
});

test('the roster row sits under the org group, the scope of the roster it edits', async () => {
  await render({ everyone: false, orgAdmin: false });
  const groups = [...document.querySelectorAll('.tui-config-body section')];
  const org = groups.find(
    g => g.querySelector('.tui-config-group')?.textContent === 'org'
  );
  expect(org).toBeDefined();
  expect(org!.querySelector('[data-key="board.hiddenMembers"]')).not.toBeNull();
});
