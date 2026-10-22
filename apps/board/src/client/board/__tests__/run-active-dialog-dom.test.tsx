import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ActiveRun = import('../../types.ts').ActiveRun;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let RunActiveConfirmDialog: typeof import('../RunActiveConfirmDialog.tsx').RunActiveConfirmDialog;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ RunActiveConfirmDialog } = await import('../RunActiveConfirmDialog.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function open(run: ActiveRun) {
  const calls: string[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () =>
    root.render(
      <RunActiveConfirmDialog
        pending={{
          run,
          iid: 1418,
          ring: () => calls.push('ring'),
          launch: () => calls.push('launch'),
        }}
        onDone={() => calls.push('done')}
      />
    )
  );
  const dialog = document.querySelector('[role="dialog"]');
  const button = (label: string) =>
    [...(dialog?.querySelectorAll('button') ?? [])].find(
      b => b.textContent?.trim() === label
    );
  const close = async () => {
    await React.act(async () => root.unmount());
    container.remove();
  };
  return { dialog, button, calls, close };
}

const title = (dialog: Element | null) =>
  dialog?.getAttribute('aria-label') ?? '';

test("a named worker on this MR's own branch", async () => {
  const d = await open({ runId: 'r', stage: 'implement', name: 'Pip' });
  expect(title(d.dialog)).toBe("Pip's run is active on this branch");
  expect(d.dialog?.textContent).toContain('The run is at its implement stage.');
  await d.close();
});

test('an unnamed worker names the MR', async () => {
  const d = await open({ runId: 'r', stage: 'self-review' });
  expect(title(d.dialog)).toBe('A work run is active on !1418');
  await d.close();
});

test("a parent's worker names the parent branch, or the parent itself", async () => {
  const named = await open({
    runId: 'r',
    stage: 'implement',
    name: 'Wren',
    viaIid: 1400,
  });
  expect(title(named.dialog)).toBe("Wren's run is active on the parent branch");
  expect(named.dialog?.textContent).toContain(
    'The run is on parent !1400, at its implement stage.'
  );
  await named.close();
  const unnamed = await open({ runId: 'r', stage: null, viaIid: 1400 });
  expect(title(unnamed.dialog)).toBe('A work run is active on !1400');
  await unnamed.close();
  const byBranch = await open({
    runId: 'r',
    stage: null,
    viaBranch: 'feature/acme-2200',
  });
  expect(title(byBranch.dialog)).toBe(
    'A work run is active on feature/acme-2200'
  );
  await byBranch.close();
});

test('Ring worker rings, Launch doctor anyway launches, Cancel holds focus', async () => {
  const d = await open({ runId: 'r', stage: 'implement', name: 'Pip' });
  expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
  await React.act(async () => d.button('Ring worker')?.click());
  expect(d.calls).toEqual(['ring', 'done']);
  await d.close();
  const e = await open({ runId: 'r', stage: 'implement', name: 'Pip' });
  await React.act(async () => e.button('Launch doctor anyway')?.click());
  expect(e.calls).toEqual(['launch', 'done']);
  await e.close();
});
