import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let AsksDropdown: typeof import('../AsksDropdown.tsx').AsksDropdown;
let fx: typeof import('../asks.fixtures.ts');

beforeAll(async () => {
  React = await import('react');
  ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  ({ AsksDropdown } = await import('../AsksDropdown.tsx'));
  fx = await import('../asks.fixtures.ts');
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const reviewButton = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find(b => b.textContent === 'Review')!;

async function setup(onAccept: () => Promise<void>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const notices: string[] = [];
  const render = async (pending: (typeof fx.THREE_WAITING)['pending']) =>
    act(async () =>
      root.render(
        <AsksDropdown
          asks={{ ...fx.THREE_WAITING, pending }}
          flashId={null}
          onAccept={onAccept}
          onDecline={async () => {}}
          onAllow={async () => {}}
          onFocus={() => {}}
          onNotice={m => notices.push(m)}
        />
      )
    );
  await render([fx.RAE_ASK]);
  return { host, root, render, notices };
}

test('a failed go-ahead whose card leaves shows its words as a notice', async () => {
  const { host, root, render, notices } = await setup(async () => {
    throw new Error('A review is already running');
  });
  await act(async () => reviewButton(host).click());
  await render([]);
  expect(notices).toEqual(['A review is already running']);
  await act(async () => root.unmount());
});

test('a retry that succeeds drops the earlier failure', async () => {
  let fail = true;
  const { host, root, render, notices } = await setup(async () => {
    if (fail) throw new Error('the relay did not answer');
  });
  await act(async () => reviewButton(host).click());
  fail = false;
  await act(async () => reviewButton(host).click());
  await render([]);
  expect(notices).toEqual([]);
  await act(async () => root.unmount());
});

test('an ask with no title shows no title text, never its URL', async () => {
  const untitled = { ...fx.RAE_ASK, title: undefined };
  const handled = {
    ...untitled,
    id: 'h1',
    handled: { at: fx.ASKS_NOW, result: 'launched' as const },
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  for (const initialView of ['list', 'history'] as const) {
    await act(async () =>
      root.render(
        <AsksDropdown
          key={initialView}
          asks={{ pending: [untitled], history: [handled], alwaysAllow: [] }}
          initialView={initialView}
          flashId={null}
          onAccept={async () => {}}
          onDecline={async () => {}}
          onAllow={async () => {}}
          onFocus={() => {}}
          onNotice={() => {}}
        />
      )
    );
    expect(host.textContent).toContain('!1388');
    expect(host.textContent).not.toContain(untitled.mrUrl);
    expect(host.querySelector('.tui-ask-title')).toBeNull();
  }
  await act(async () => root.unmount());
});
