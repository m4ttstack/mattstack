import '../../../icons';

import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { designFixture, designSource } from './designFixtures';

const bindPost = vi.fn();
const surfaceApplyPost = vi.fn();

vi.mock('../../../api', () => ({
  client: {
    api: {
      skills: {
        packs: {
          $get: () =>
            Promise.resolve(
              ok({
                packs: [
                  {
                    name: 'acme',
                    dir: '/fixture/packs/acme',
                    layout: 'grouped',
                  },
                ],
              })
            ),
        },
        composition: {
          $get: () => Promise.resolve(ok(designFixture('composition'))),
        },
        check: { $get: () => Promise.resolve(ok(designFixture('check'))) },
        anatomy: {
          $get: ({ query }: { query: { skill: string } }) =>
            Promise.resolve(
              ok(
                query.skill === 'work'
                  ? designFixture('anatomy.work')
                  : designFixture('anatomy.stage-plan')
              )
            ),
        },
        changes: {
          $get: () => Promise.resolve(ok(designFixture('changes.clean'))),
        },
        source: {
          $get: ({ query }: { query: { path: string } }) =>
            Promise.resolve(ok(designSource(query.path))),
        },
        compile: { $get: () => Promise.resolve(ok({ content: '' })) },
        surface: {
          $get: () =>
            Promise.resolve(
              ok({ pack: 'acme', packDir: '/fixture/packs/acme', rows: [] })
            ),
          apply: { $post: (...args: unknown[]) => surfaceApplyPost(...args) },
        },
        bind: { $post: (...args: unknown[]) => bindPost(...args) },
        sync: { $post: vi.fn() },
      },
      settings: {
        'default-editor': {
          $get: () => Promise.resolve(ok({ editor: 'zed' })),
        },
      },
    },
  },
}));

const { WiringMap } = await import('../../WiringMap');

function ok(json: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => json };
}

const REBIND = '?tab=graph&focus=stage-plan&select=row:136&rebind=1';
const STRICT = 'acme:plan-policy-strict';

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = stubVirtualLayout({
    rowHeight: 19,
    viewportHeight: 380,
    contentHeight: 1000 * 19,
  });
  bindPost.mockResolvedValue(
    ok({
      pack: 'acme',
      verb: 'stage-plan',
      slot: 'domain',
      fill: STRICT,
      ok: true,
    })
  );
  surfaceApplyPost.mockResolvedValue(
    ok({
      pack: 'acme',
      steps: [{ direction: 'internal', names: ['work'], ok: true }],
      rows: [],
    })
  );
});

afterEach(() => {
  restoreLayout();
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

function renderAt(search: string) {
  window.history.pushState(null, '', `/wiring${search}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WiringMap />
    </QueryClientProvider>
  );
}

const params = () => new URLSearchParams(window.location.search);
const panel = () => screen.findByTestId('rebind-panel');
const picker = (root: HTMLElement) =>
  within(root).getByRole('combobox', { name: 'What fills the domain slot' });

async function openPicker() {
  const root = await panel();
  await userEvent.click(picker(root));
  return root;
}

async function pickStrict() {
  const root = await openPicker();
  await userEvent.click(
    within(root).getByRole('option', { name: /^plan-policy-strict/ })
  );
  return root;
}

/** The confirm, by its title: the drawer is a dialog too. */
const dialog = (title: RegExp = /\?$/) =>
  screen.findByRole('dialog', { name: title });
const noConfirm = () =>
  expect(screen.queryByRole('dialog', { name: /\?$/ })).toBeNull();

describe('RebindPanel', () => {
  it('states the slot it changes and what fills it now', async () => {
    renderAt(REBIND);
    const root = await panel();

    expect(
      within(root).getByText('Change what fills the domain slot')
    ).toBeInTheDocument();
    expect(
      within(root)
        .getAllByTestId('rebind-fact')
        .map(fact => fact.textContent)
    ).toEqual(['contractplan-domain@1', 'set bythis pack', 'requiredyes']);
    expect(within(root).getByTestId('rebind-current')).toHaveTextContent(
      'plan-policynow'
    );
    expect(picker(root)).toHaveTextContent('Pick a file');
  });

  it('lists only the fills with the slot contract, saying where each is bound', async () => {
    renderAt(REBIND);
    const root = await openPicker();

    expect(
      within(root).getByText('Files with the plan-domain@1 contract')
    ).toBeInTheDocument();
    expect(
      within(root)
        .getAllByRole('option')
        .map(option => option.textContent)
    ).toEqual([
      'plan-policyacme · bound here now',
      'plan-policy-strictacme · bound nowhere',
      'plan-policy-liteacme · bound by 1 other skill',
    ]);
  });

  it('picks a fill without a confirm or a write, and names the command Apply runs', async () => {
    renderAt(REBIND);
    const root = await pickStrict();

    noConfirm();
    expect(bindPost).not.toHaveBeenCalled();
    expect(picker(root)).toHaveTextContent('plan-policy-strict');
    expect(within(root).queryByRole('option')).toBeNull();
    expect(within(root).getByTestId('rebind-command')).toHaveTextContent(
      'rt skills bind stage-plan domain acme:plan-policy-strict --pack acme' +
        'Writes the binding in this pack, then rebuilds plan. Nothing is shared until you sync.'
    );

    await userEvent.click(picker(root));
    expect(
      within(root).getByRole('option', { name: /^plan-policy-strict/ })
    ).toHaveAttribute('data-combobox-active');
  });

  it('holds Apply until a different fill is picked', async () => {
    renderAt(REBIND);
    const root = await openPicker();
    const apply = within(root).getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();

    await userEvent.click(
      within(root).getByRole('option', { name: /^plan-policyacme/ })
    );
    expect(apply).toBeDisabled();
    expect(within(root).queryByTestId('rebind-command')).toBeNull();
  });

  it('binds only once the confirm says Apply, then closes', async () => {
    renderAt(REBIND);
    const root = await pickStrict();
    await userEvent.click(within(root).getByRole('button', { name: 'Apply' }));

    const confirm = await dialog();
    expect(confirm).toHaveTextContent('Rebind the domain slot?');
    expect(confirm).toHaveTextContent(
      'plan will use plan-policy-strict instead of plan-policy. Nothing is shared until you sync.'
    );
    expect(bindPost).not.toHaveBeenCalled();

    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Apply' })
    );

    await waitFor(() =>
      expect(bindPost).toHaveBeenCalledWith({
        json: {
          pack: 'acme',
          verb: 'stage-plan',
          slot: 'domain',
          fill: STRICT,
        },
      })
    );
    expect(
      await screen.findByText('Rebound domain to plan-policy-strict')
    ).toBeInTheDocument();
    await waitFor(() => expect(params().get('rebind')).toBeNull());
    expect(params().get('select')).toBe('row:136');
    expect(screen.queryByTestId('rebind-panel')).toBeNull();
  });

  it('writes nothing when the confirm is cancelled', async () => {
    renderAt(REBIND);
    const root = await pickStrict();
    await userEvent.click(within(root).getByRole('button', { name: 'Apply' }));
    await userEvent.click(
      within(await dialog()).getByRole('button', { name: 'Cancel' })
    );

    await waitFor(noConfirm);
    expect(bindPost).not.toHaveBeenCalled();
    expect(screen.getByTestId('rebind-panel')).toBeInTheDocument();
    expect(params().get('rebind')).toBe('1');
  });

  it('lets Escape shut the confirm without shutting the drawer', async () => {
    renderAt(REBIND);
    const root = await pickStrict();
    await userEvent.click(within(root).getByRole('button', { name: 'Apply' }));
    await dialog();
    await userEvent.keyboard('{Escape}');

    await waitFor(noConfirm);
    expect(params().get('select')).toBe('row:136');
    expect(params().get('rebind')).toBe('1');
    expect(bindPost).not.toHaveBeenCalled();
  });

  it('says why a bind failed and stays open', async () => {
    bindPost.mockResolvedValue(
      ok(
        {
          pack: 'acme',
          verb: 'stage-plan',
          slot: 'domain',
          fill: STRICT,
          ok: false,
          error: 'the pack checkout is locked',
        },
        502
      )
    );
    renderAt(REBIND);
    const root = await pickStrict();
    await userEvent.click(within(root).getByRole('button', { name: 'Apply' }));
    await userEvent.click(
      within(await dialog()).getByRole('button', { name: 'Apply' })
    );

    expect(
      await screen.findByText('the pack checkout is locked')
    ).toBeInTheDocument();
    expect(screen.getByTestId('rebind-panel')).toBeInTheDocument();
    expect(params().get('rebind')).toBe('1');
  });

  it('closes on Cancel without writing', async () => {
    renderAt(REBIND);
    const root = await pickStrict();
    await userEvent.click(within(root).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(params().get('rebind')).toBeNull());
    expect(bindPost).not.toHaveBeenCalled();
  });

  it("keeps the drawer's arrow keys out of the picker", async () => {
    renderAt(REBIND);
    const root = await openPicker();
    fireEvent.keyDown(picker(root), { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(picker(root), { key: 'Escape', code: 'Escape' });

    expect(params().get('select')).toBe('row:136');
    expect(params().get('rebind')).toBe('1');
  });
});

describe('the Change button', () => {
  it('opens the panel from a slot row', async () => {
    renderAt('?tab=graph&focus=stage-plan&select=row:136');
    const drawer = await screen.findByTestId('skill-drawer');
    expect(screen.queryByTestId('rebind-panel')).toBeNull();

    await userEvent.click(
      await within(drawer).findByRole('button', { name: 'Change' })
    );

    expect(params().get('rebind')).toBe('1');
    expect(await panel()).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('is not offered on a row that is not a slot', async () => {
    renderAt('?tab=graph&focus=stage-plan&select=row:140');
    const drawer = await screen.findByTestId('skill-drawer');
    await within(drawer).findByTestId('drawer-chip');
    expect(within(drawer).queryByRole('button', { name: 'Change' })).toBeNull();
  });
});

describe('the public switch', () => {
  it('is absent for a stage', async () => {
    renderAt('?tab=graph&focus=stage-plan&select=row:136');
    const drawer = await screen.findByTestId('skill-drawer');
    await within(drawer).findByTestId('drawer-chip');
    expect(within(drawer).queryByRole('switch')).toBeNull();
  });

  it('confirms before making a verb internal', async () => {
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');
    const drawer = await screen.findByTestId('skill-drawer');
    const toggle = await within(drawer).findByRole('switch', {
      name: 'public',
    });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);
    const confirm = await dialog();
    expect(confirm).toHaveTextContent('Make work internal?');
    expect(surfaceApplyPost).not.toHaveBeenCalled();

    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Make internal' })
    );
    await waitFor(() =>
      expect(surfaceApplyPost).toHaveBeenCalledWith({
        json: { pack: 'acme', toPublic: [], toInternal: ['work'] },
      })
    );
    expect(await screen.findByText('work is internal')).toBeInTheDocument();
  });

  it('writes nothing when its confirm is cancelled', async () => {
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');
    const drawer = await screen.findByTestId('skill-drawer');
    await userEvent.click(
      await within(drawer).findByRole('switch', { name: 'public' })
    );
    await userEvent.click(
      within(await dialog()).getByRole('button', { name: 'Cancel' })
    );

    await waitFor(noConfirm);
    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });
});
