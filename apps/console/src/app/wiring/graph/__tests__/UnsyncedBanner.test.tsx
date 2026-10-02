import '../../../icons';

import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from 'wouter/use-browser-location';

import type { SkillsChanges } from '../../useWiring';
import { designFixture, designSource } from './designFixtures';

const changesGet = vi.fn();
const ACME = { name: 'acme', dir: '/fixture/packs/acme', layout: 'grouped' };
const packs = vi.fn(() => [ACME]);
const syncPost = vi.fn();
const discardPost = vi.fn();
const bindPost = vi.fn();

vi.mock('../../../api', () => ({
  client: {
    api: {
      skills: {
        packs: { $get: () => Promise.resolve(ok({ packs: packs() })) },
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
          $get: (args: { query: { pack: string } }) => changesGet(args),
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
          apply: { $post: vi.fn() },
        },
        bind: { $post: (...args: unknown[]) => bindPost(...args) },
        sync: { $post: (...args: unknown[]) => syncPost(...args) },
        discard: { $post: (...args: unknown[]) => discardPost(...args) },
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
const { UnsyncedBanner } = await import('../UnsyncedBanner');
const { holdWrite } = await import('../../__tests__/writeLock');

function ok(json: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => json };
}

/** A write rt has not answered yet. */
function held() {
  let answer!: (json: unknown, status?: number) => void;
  const promise = new Promise(resolve => {
    answer = (json, status = 200) => resolve(ok(json, status));
  });
  return { promise, answer };
}

const TITLE =
  '1 unsynced change in acme. Your Claude sessions still use the old version.';
const SYNCED = {
  ok: true,
  pack: 'acme',
  steps: [
    { name: 'guards', status: 'ran', detail: 'pack checkout is on main' },
  ],
  warnings: [],
  restartNeeded: true,
};
const REFUSED = {
  ok: false,
  pack: 'acme',
  steps: [
    {
      name: 'guards',
      status: 'refused',
      detail:
        'pack checkout at /fixture/packs/acme has changes outside the pack: README.md; commit or stash those and re-run',
    },
  ],
  warnings: [],
  restartNeeded: false,
};

const FOUR_PATHS = [
  'attachments/plan-policy/SKILL.md',
  'attachments/plan-policy-lite/SKILL.md',
  'attachments/gate-protocol/SKILL.md',
  'pack/notes.md',
];
const FOUR_FILES: SkillsChanges = {
  ...designFixture('changes.clean'),
  dirty: true,
  files: FOUR_PATHS.map(path => ({ path, status: 'M' })),
};
const CHANGED =
  'The pack changed since this list was shown. Review the new list and try again.';

const withNotes = (changes: SkillsChanges): SkillsChanges => ({
  ...changes,
  files: [...changes.files, { path: 'pack/notes.md', status: '??' }],
});

let restoreLayout: () => void;

function serveChanges(changes: SkillsChanges) {
  changesGet.mockImplementation(() => Promise.resolve(ok(changes)));
}

beforeEach(() => {
  serveChanges(designFixture('changes.unsynced'));
  syncPost.mockResolvedValue(ok(SYNCED));
  discardPost.mockResolvedValue(
    ok({ pack: 'acme', packDir: '/fixture/packs/acme', discarded: [] })
  );
  restoreLayout = stubVirtualLayout({
    rowHeight: 19,
    viewportHeight: 380,
    contentHeight: 1000 * 19,
  });
});

afterEach(() => {
  // Both stores outlive a render, so one test's toast would satisfy the next.
  act(() => {
    notifications.clean();
    modals.closeAll();
  });
  restoreLayout();
  vi.clearAllMocks();
  packs.mockReturnValue([ACME]);
  window.history.pushState(null, '', '/');
});

function renderAt(search = '?tab=graph&focus=stage-plan') {
  window.history.pushState(null, '', `/wiring${search}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WiringMap />
    </QueryClientProvider>
  );
  return Object.assign(view, { queryClient });
}

const banner = () => screen.findByTestId('unsynced-banner');
const button = (root: HTMLElement, name: string) =>
  within(root).getByRole('button', { name });
const dialog = (name: string) => screen.findByRole('dialog', { name });

/** The page once its changes poll has answered. */
async function settled() {
  await screen.findByTestId('focus-header');
  await waitFor(() => expect(changesGet).toHaveBeenCalled());
  await act(async () => {});
}

describe('the unsynced banner', () => {
  it('shows nothing while the pack has no changes', async () => {
    serveChanges(designFixture('changes.clean'));
    renderAt();
    await settled();

    expect(screen.queryByTestId('unsynced-banner')).toBeNull();
  });

  it('shows nothing for edits only outside the pack', async () => {
    serveChanges({
      ...designFixture('changes.clean'),
      dirty: true,
      outsideScope: [{ path: 'README.md', status: 'M' }],
    });
    renderAt();
    await settled();

    expect(screen.queryByTestId('unsynced-banner')).toBeNull();
  });

  it('shows nothing, and says nothing, when the changes poll fails', async () => {
    changesGet.mockImplementation(() =>
      Promise.resolve(ok({ error: 'rt is not installed' }, 503))
    );
    renderAt();
    await settled();

    expect(screen.queryByTestId('unsynced-banner')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("names the pack's pending change the way the board does", async () => {
    renderAt();
    const root = await banner();

    expect(root).toHaveTextContent(TITLE);
    expect(within(root).getByText('plan')).toBeInTheDocument();
    expect(
      within(root).getByText('domain slot: plan-policy → plan-policy-strict')
    ).toBeInTheDocument();
  });

  it('lists a file by its path when no binding or surface change explains it', async () => {
    serveChanges({
      ...designFixture('changes.clean'),
      dirty: true,
      files: [
        { path: 'skills/review/SKILL.md', status: 'M' },
        { path: 'pack/notes.md', status: '??' },
      ],
    });
    renderAt();
    const root = await banner();

    expect(root).toHaveTextContent(
      '2 unsynced changes in acme. Your Claude sessions still use the old version.'
    );
    expect(
      within(root).getByText('skills/review/SKILL.md')
    ).toBeInTheDocument();
    expect(within(root).getByText('pack/notes.md')).toBeInTheDocument();
  });

  it('lists an edited file the rebind does not explain, in the banner and the sync confirm', async () => {
    const unsynced = designFixture('changes.unsynced');
    serveChanges({
      ...unsynced,
      files: [
        ...unsynced.files,
        { path: 'attachments/gate-protocol/SKILL.md', status: 'M' },
      ],
    });
    renderAt();
    const root = await banner();

    expect(root).toHaveTextContent(
      '2 unsynced changes in acme. Your Claude sessions still use the old version.'
    );
    expect(
      within(root).getByText('domain slot: plan-policy → plan-policy-strict')
    ).toBeInTheDocument();
    expect(
      within(root).getByText('attachments/gate-protocol/SKILL.md')
    ).toBeInTheDocument();

    await userEvent.click(button(root, 'Sync changes'));
    const confirm = await dialog('Sync 2 changes?');
    expect(
      within(confirm).getByText('attachments/gate-protocol/SKILL.md')
    ).toBeInTheDocument();
    expect(
      within(confirm).getByText('domain slot: plan-policy → plan-policy-strict')
    ).toBeInTheDocument();
  });

  it("does not list the rebind's own bindings file or the stage it rebuilt", async () => {
    const unsynced = designFixture('changes.unsynced');
    serveChanges({
      ...unsynced,
      files: [
        ...unsynced.files,
        { path: 'attachments/stage-plan/SKILL.md', status: 'M' },
      ],
    });
    renderAt();
    const root = await banner();

    await waitFor(() => expect(root).toHaveTextContent(TITLE));
    expect(
      within(root).queryByText('attachments/stage-plan/SKILL.md')
    ).toBeNull();
    expect(within(root).queryByText('pack/skills.jsonc')).toBeNull();
  });

  it('names every change, the ones past the first three behind a show-more in place', async () => {
    serveChanges(FOUR_FILES);
    renderAt();
    const root = await banner();

    expect(root).toHaveTextContent('4 unsynced changes in acme.');
    expect(within(root).queryByText(FOUR_PATHS[3]!)).toBeNull();
    await userEvent.click(button(root, 'Show 1 more'));
    for (const path of FOUR_PATHS)
      expect(within(root).getByText(path)).toBeInTheDocument();
  });

  it('names a surface change by its skill', async () => {
    serveChanges({
      ...designFixture('changes.clean'),
      dirty: true,
      files: [{ path: 'pack/surface.jsonc', status: 'M' }],
      surface: [{ skill: 'review', from: 'public', to: 'internal' }],
    });
    renderAt();
    const root = await banner();

    expect(root).toHaveTextContent('1 unsynced change in acme.');
    expect(within(root).queryByText('pack/surface.jsonc')).toBeNull();
    expect(within(root).getByText('review')).toBeInTheDocument();
    expect(within(root).getByText('public → internal')).toBeInTheDocument();
  });

  it('turns Sync off, and says why, while files outside the pack are edited too', async () => {
    serveChanges({
      ...designFixture('changes.unsynced'),
      outsideScope: [
        { path: 'README.md', status: 'M' },
        { path: 'notes/todo.md', status: '??' },
      ],
    });
    renderAt();
    const root = await banner();

    expect(root).toHaveTextContent(
      'Sync is off until you commit or stash these files outside the pack: README.md, notes/todo.md'
    );
    expect(button(root, 'Sync changes')).toBeDisabled();
    expect(button(root, 'Discard')).toBeEnabled();
  });

  it('docks above the focus list and the canvas alike, under the tab bar', async () => {
    renderAt();
    const root = await banner();
    const sidebar = document.getElementById('page-shell-sidebar')!;

    expect(document.getElementById('page-shell-main')).not.toContainElement(
      root
    );
    expect(sidebar).not.toContainElement(root);
    expect(
      root.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('starts over for another pack, with its list folded again', async () => {
    packs.mockReturnValue([
      ACME,
      { name: 'globex', dir: '/fixture/packs/globex', layout: 'grouped' },
    ]);
    serveChanges(FOUR_FILES);
    renderAt('?tab=graph&pack=acme');
    await userEvent.click(button(await banner(), 'Show 1 more'));
    expect(button(await banner(), 'Show fewer')).toBeInTheDocument();

    act(() => navigate('/wiring?tab=graph&pack=globex'));

    await waitFor(() =>
      expect(
        button(screen.getByTestId('unsynced-banner'), 'Show 1 more')
      ).toBeInTheDocument()
    );
  });

  it('shows on the Surface tab too', async () => {
    renderAt('?tab=surface');

    expect(await banner()).toHaveTextContent(TITLE);
  });
});

describe('Sync changes', () => {
  it('confirms with the change listed before it posts anything', async () => {
    renderAt();
    await userEvent.click(button(await banner(), 'Sync changes'));

    const confirm = await dialog('Sync 1 change?');
    expect(confirm).toHaveTextContent(
      'This saves the change to the acme pack and shares it with your team. Then it rebuilds the pack and updates your installed copy.'
    );
    expect(
      within(confirm).getByText('domain slot: plan-policy → plan-policy-strict')
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent(
      'Afterwards, run /reload-plugins in open Claude sessions to pick it up.'
    );
    expect(syncPost).not.toHaveBeenCalled();

    await userEvent.click(button(confirm, 'Sync changes'));

    await waitFor(() =>
      expect(syncPost).toHaveBeenCalledWith({
        json: { pack: 'acme', commitPending: true },
      })
    );
    expect(
      await screen.findByText(
        'Synced acme. Run /reload-plugins in open Claude sessions.'
      )
    ).toBeInTheDocument();
  });

  it("posts nothing when the confirm's Cancel is pressed", async () => {
    renderAt();
    await userEvent.click(button(await banner(), 'Sync changes'));
    await userEvent.click(button(await dialog('Sync 1 change?'), 'Cancel'));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Sync 1 change?' })
      ).toBeNull()
    );
    expect(syncPost).not.toHaveBeenCalled();
  });

  it('shows the refusal when sync stops at its guards', async () => {
    syncPost.mockResolvedValue(ok(REFUSED));
    renderAt();
    await userEvent.click(button(await banner(), 'Sync changes'));
    await userEvent.click(
      button(await dialog('Sync 1 change?'), 'Sync changes')
    );

    expect(
      await screen.findByText(REFUSED.steps[0]!.detail)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Synced acme. Run /reload-plugins in open Claude sessions.'
      )
    ).toBeNull();
  });

  it('shows the error when the sync request itself fails', async () => {
    syncPost.mockResolvedValue(ok({ error: 'rt is not installed' }, 503));
    renderAt();
    await userEvent.click(button(await banner(), 'Sync changes'));
    await userEvent.click(
      button(await dialog('Sync 1 change?'), 'Sync changes')
    );

    expect(await screen.findByText('rt is not installed')).toBeInTheDocument();
  });

  it('holds both buttons while it runs, then gives way once the pack is clean', async () => {
    const sync = held();
    syncPost.mockReturnValue(sync.promise);
    renderAt();
    const root = await banner();
    await userEvent.click(button(root, 'Sync changes'));
    await userEvent.click(
      button(await dialog('Sync 1 change?'), 'Sync changes')
    );

    await waitFor(() => expect(button(root, 'Discard')).toBeDisabled());
    expect(button(root, 'Sync changes')).toBeDisabled();
    expect(button(root, 'Sync changes')).toHaveAttribute('data-loading');

    serveChanges(designFixture('changes.clean'));
    act(() => sync.answer(SYNCED));

    await waitFor(() => expect(root).not.toBeVisible());
  });

  it('lists every change in its confirm', async () => {
    serveChanges(FOUR_FILES);
    renderAt();
    await userEvent.click(button(await banner(), 'Sync changes'));

    const confirm = await dialog('Sync 4 changes?');
    for (const path of FOUR_PATHS)
      expect(within(confirm).getByText(path)).toBeInTheDocument();
  });

  it('posts nothing when the pack changed while its confirm was open', async () => {
    renderAt();
    await userEvent.click(button(await banner(), 'Sync changes'));
    const confirm = await dialog('Sync 1 change?');
    serveChanges(withNotes(designFixture('changes.unsynced')));

    await userEvent.click(button(confirm, 'Sync changes'));

    expect(await screen.findByText(CHANGED)).toBeInTheDocument();
    expect(syncPost).not.toHaveBeenCalled();
  });

  it('posts nothing when files outside the pack turned up while its confirm was open', async () => {
    renderAt();
    await userEvent.click(button(await banner(), 'Sync changes'));
    const confirm = await dialog('Sync 1 change?');
    serveChanges({
      ...designFixture('changes.unsynced'),
      outsideScope: [{ path: 'README.md', status: 'M' }],
    });

    await userEvent.click(button(confirm, 'Sync changes'));

    expect(
      await screen.findByText(
        'Sync is off until you commit or stash these files outside the pack: README.md'
      )
    ).toBeInTheDocument();
    expect(syncPost).not.toHaveBeenCalled();
  });

  it('reports a sync that settles after the banner has unmounted', async () => {
    const sync = held();
    syncPost.mockReturnValue(sync.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const host = (show: boolean) => (
      <QueryClientProvider client={queryClient}>
        {show && <UnsyncedBanner pack="acme" />}
      </QueryClientProvider>
    );
    const view = renderWithProviders(host(true));
    await userEvent.click(button(await banner(), 'Sync changes'));
    await userEvent.click(
      button(await dialog('Sync 1 change?'), 'Sync changes')
    );
    await waitFor(() => expect(syncPost).toHaveBeenCalled());

    view.rerender(host(false));
    expect(screen.queryByTestId('unsynced-banner')).toBeNull();
    act(() => sync.answer(REFUSED));

    expect(
      await screen.findByText(REFUSED.steps[0]!.detail)
    ).toBeInTheDocument();
  });

  it('waits while another write to the pack is in flight', async () => {
    const { queryClient } = renderAt();
    const root = await banner();
    let end!: () => void;
    act(() => {
      end = holdWrite(queryClient, 'acme');
    });

    await waitFor(() => expect(button(root, 'Sync changes')).toBeDisabled());
    expect(button(root, 'Discard')).toBeDisabled();

    await act(async () => end());
    await waitFor(() => expect(button(root, 'Sync changes')).toBeEnabled());
  });
});

describe('Discard', () => {
  it('confirms destructively before it throws anything away', async () => {
    renderAt();
    await userEvent.click(button(await banner(), 'Discard'));

    const confirm = await dialog('Discard 1 change?');
    expect(confirm).toHaveTextContent(
      'This throws away this change in acme. It cannot be undone.'
    );
    expect(
      within(confirm).getByText('domain slot: plan-policy → plan-policy-strict')
    ).toBeInTheDocument();
    expect(button(confirm, 'Discard').getAttribute('style')).toMatch(/red/);
    expect(discardPost).not.toHaveBeenCalled();

    await userEvent.click(button(confirm, 'Discard'));

    await waitFor(() =>
      expect(discardPost).toHaveBeenCalledWith({ json: { pack: 'acme' } })
    );
    expect(
      await screen.findByText('Discarded the unsynced changes in acme')
    ).toBeInTheDocument();
  });

  it('lists every change in its confirm', async () => {
    serveChanges(FOUR_FILES);
    renderAt();
    await userEvent.click(button(await banner(), 'Discard'));

    const confirm = await dialog('Discard 4 changes?');
    expect(confirm).toHaveTextContent(
      'This throws away these 4 changes in acme. It cannot be undone.'
    );
    for (const path of FOUR_PATHS)
      expect(within(confirm).getByText(path)).toBeInTheDocument();
  });

  it('throws nothing away when the pack changed while its confirm was open', async () => {
    renderAt();
    await userEvent.click(button(await banner(), 'Discard'));
    const confirm = await dialog('Discard 1 change?');
    serveChanges(withNotes(designFixture('changes.unsynced')));

    await userEvent.click(button(confirm, 'Discard'));

    expect(await screen.findByText(CHANGED)).toBeInTheDocument();
    expect(discardPost).not.toHaveBeenCalled();
  });

  it('shows the error when rt refuses to discard', async () => {
    discardPost.mockResolvedValue(
      ok({ error: 'pack acme is in the shared checkout' }, 400)
    );
    renderAt();
    await userEvent.click(button(await banner(), 'Discard'));
    await userEvent.click(button(await dialog('Discard 1 change?'), 'Discard'));

    expect(
      await screen.findByText('pack acme is in the shared checkout')
    ).toBeInTheDocument();
  });
});
