import '../../../icons';

import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from 'wouter/use-browser-location';

import { designFixture, designSource } from './designFixtures';

const bindPost = vi.fn();
const surfaceApplyPost = vi.fn();
const compositionGet = vi.fn();

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
        composition: { $get: () => compositionGet() },
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
  compositionGet.mockImplementation(() =>
    Promise.resolve(ok(designFixture('composition')))
  );
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
  // Both stores outlive a render, so one test's toast would satisfy the next.
  act(() => {
    notifications.clean();
    modals.closeAll();
  });
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
/** A write rt has not answered yet. */
function held() {
  let answer!: (json: unknown, status?: number) => void;
  const promise = new Promise(resolve => {
    answer = (json, status = 200) => resolve(ok(json, status));
  });
  return { promise, answer };
}

const FAILED_BIND = {
  pack: 'acme',
  verb: 'stage-plan',
  slot: 'domain',
  fill: STRICT,
  ok: false,
  error: 'the pack checkout is locked',
};

async function confirmApply(root: HTMLElement) {
  await userEvent.click(within(root).getByRole('button', { name: 'Apply' }));
  await userEvent.click(
    within(await dialog()).getByRole('button', { name: 'Apply' })
  );
}

const closeDrawer = async () =>
  userEvent.click(
    within(screen.getByTestId('skill-drawer')).getByRole('button', {
      name: 'Close',
    })
  );

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

  it('reports a bind that fails after the drawer has closed', async () => {
    const bind = held();
    bindPost.mockReturnValue(bind.promise);
    renderAt(REBIND);
    await confirmApply(await pickStrict());
    await closeDrawer();
    await waitFor(() => expect(params().get('select')).toBeNull());
    expect(screen.queryByTestId('rebind-panel')).toBeNull();

    await act(async () => bind.answer(FAILED_BIND, 502));
    expect(
      await screen.findByText('the pack checkout is locked')
    ).toBeInTheDocument();
  });

  it('holds Apply while a bind is in flight, even in a reopened panel', async () => {
    const bind = held();
    bindPost.mockReturnValue(bind.promise);
    renderAt(REBIND);
    const root = await pickStrict();
    await confirmApply(root);
    expect(within(root).getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(within(root).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await closeDrawer();
    act(() => navigate(`/wiring${REBIND}`));
    const reopened = await pickStrict();
    expect(
      within(reopened).getByRole('button', { name: 'Apply' })
    ).toBeDisabled();
    expect(bindPost).toHaveBeenCalledTimes(1);

    await act(async () =>
      bind.answer({ ...FAILED_BIND, ok: true, error: undefined })
    );
    await waitFor(() =>
      expect(
        within(reopened).getByRole('button', { name: 'Apply' })
      ).toBeEnabled()
    );
  });

  it('picks a fill from the keyboard', async () => {
    renderAt(REBIND);
    const root = await panel();
    picker(root).focus();
    // The first ArrowDown opens the list; the next two step to the second fill.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    expect(picker(root)).toHaveTextContent('plan-policy-strict');
    expect(within(root).queryByRole('option')).toBeNull();
    expect(params().get('select')).toBe('row:136');
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

  it('reports a switch that fails after the Graph tab has gone, and holds the switch meanwhile', async () => {
    const apply = held();
    surfaceApplyPost.mockReturnValue(apply.promise);
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');
    const drawer = await screen.findByTestId('skill-drawer');
    await userEvent.click(
      await within(drawer).findByRole('switch', { name: 'public' })
    );
    await userEvent.click(
      within(await dialog()).getByRole('button', { name: 'Make internal' })
    );
    await waitFor(() =>
      expect(
        within(drawer).getByRole('switch', { name: 'public' })
      ).toBeDisabled()
    );

    act(() => navigate('/wiring?tab=surface'));
    await waitFor(() =>
      expect(screen.queryByTestId('skill-drawer')).toBeNull()
    );
    await act(async () =>
      apply.answer({
        pack: 'acme',
        steps: [
          {
            direction: 'internal',
            names: ['work'],
            ok: false,
            error: 'surface set refused',
          },
        ],
        rows: null,
      })
    );
    expect(await screen.findByText('surface set refused')).toBeInTheDocument();
  });

  it('confirms making a verb public without the destructive tone', async () => {
    const composition = designFixture('composition');
    composition.verbs = composition.verbs.map(verb =>
      verb.name === 'work' ? { ...verb, public: false } : verb
    );
    compositionGet.mockImplementation(() => Promise.resolve(ok(composition)));
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');
    const drawer = await screen.findByTestId('skill-drawer');
    const toggle = await within(drawer).findByRole('switch', {
      name: 'public',
    });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    const confirm = await dialog();
    expect(confirm).toHaveTextContent('Make work public?');
    expect(
      within(confirm)
        .getByRole('button', { name: 'Make public' })
        .getAttribute('style') ?? ''
    ).not.toMatch(/red/);
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
    expect(
      within(confirm)
        .getByRole('button', { name: 'Make internal' })
        .getAttribute('style')
    ).toMatch(/red/);
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
