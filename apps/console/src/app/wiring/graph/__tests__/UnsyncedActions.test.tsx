import '../../../icons';

import type { ReactNode } from 'react';
import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillsChanges } from '../../useWiring';
import { designFixture } from './designFixtures';

const changesGet = vi.fn();
const syncPost = vi.fn();
const discardPost = vi.fn();

vi.mock('../../../api', () => ({
  client: {
    api: {
      skills: {
        composition: {
          $get: () => Promise.resolve(ok(designFixture('composition'))),
        },
        changes: {
          $get: (args: { query: { pack: string } }) => changesGet(args),
        },
        sync: { $post: (...args: unknown[]) => syncPost(...args) },
        discard: { $post: (...args: unknown[]) => discardPost(...args) },
      },
    },
  },
}));

const { UnsyncedActions } = await import('../UnsyncedBanner');
const { UnsyncedToast } = await import('../UnsyncedToast');
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
        'The pack checkout at /fixture/packs/acme has changes outside the pack: README.md. Commit or stash those, then run this again',
    },
  ],
  warnings: [],
  restartNeeded: false,
};
const PUBLISHED =
  'Published acme. Run /reload-plugins in open Claude sessions.';
const REBIND = 'domain prop: plan-policy → plan-policy-strict';

const HASH = 'a'.repeat(40);
const FOUR_PATHS = [
  'attachments/plan-policy/SKILL.md',
  'attachments/plan-policy-lite/SKILL.md',
  'attachments/gate-protocol/SKILL.md',
  'pack/notes.md',
];
const FOUR_FILES: SkillsChanges = {
  ...designFixture('changes.clean'),
  dirty: true,
  files: FOUR_PATHS.map(path => ({ path, status: 'M', hash: HASH })),
};
const CHANGED =
  'The pack changed since this list was shown. Review the new list and try again.';

const withNotes = (changes: SkillsChanges): SkillsChanges => ({
  ...changes,
  files: [
    ...changes.files,
    { path: 'pack/notes.md', status: '??', hash: HASH },
  ],
});

/** The same files with every one's content edited again: each content id
    and the signature move, the paths and statuses stay. */
const edited = (changes: SkillsChanges): SkillsChanges => ({
  ...changes,
  files: changes.files.map(f => ({ ...f, hash: 'e'.repeat(40) })),
  signature: 'e'.repeat(64),
});

function serveChanges(changes: SkillsChanges) {
  changesGet.mockImplementation(() => Promise.resolve(ok(changes)));
}

beforeEach(() => {
  serveChanges(designFixture('changes.unsynced'));
  syncPost.mockResolvedValue(ok(SYNCED));
  discardPost.mockResolvedValue(
    ok({ pack: 'acme', packDir: '/fixture/packs/acme', discarded: [] })
  );
});

afterEach(() => {
  // Both stores outlive a render, so one test's toast would satisfy the next.
  act(() => {
    notifications.clean();
    modals.closeAll();
  });
  vi.clearAllMocks();
  window.localStorage.clear();
});

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function render(node: ReactNode, queryClient = newClient()) {
  const view = renderWithProviders(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
  return Object.assign(view, { queryClient });
}

const actions = () => screen.findByTestId('unsynced-actions');
const button = (root: HTMLElement, name: string) =>
  within(root).getByRole('button', { name });
const dialog = (name: string) => screen.findByRole('dialog', { name });

/** Opens the Publish confirm from the actions and returns it. */
async function openPublish(title = 'Publish 1 change?') {
  await userEvent.click(button(await actions(), 'Publish'));
  return dialog(title);
}

/** Lets the changes poll answer before checking that nothing drew. */
async function settled() {
  await waitFor(() => expect(changesGet).toHaveBeenCalled());
  await act(async () => {});
}

describe('UnsyncedActions', () => {
  it('draws nothing while the pack has no changes', async () => {
    serveChanges(designFixture('changes.clean'));
    render(<UnsyncedActions pack="acme" />);
    await settled();

    expect(screen.queryByTestId('unsynced-actions')).toBeNull();
  });

  it('draws nothing for edits only outside the pack', async () => {
    serveChanges({
      ...designFixture('changes.clean'),
      dirty: true,
      outsideScope: [{ path: 'README.md', status: 'M' }],
    });
    render(<UnsyncedActions pack="acme" />);
    await settled();

    expect(screen.queryByTestId('unsynced-actions')).toBeNull();
  });

  it('draws nothing, and says nothing, when the changes poll fails', async () => {
    changesGet.mockImplementation(() =>
      Promise.resolve(ok({ error: 'rt is not installed' }, 503))
    );
    render(<UnsyncedActions pack="acme" />);
    await settled();

    expect(screen.queryByTestId('unsynced-actions')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers Discard and Publish, with no trial badge off a trial branch', async () => {
    render(<UnsyncedActions pack="acme" />);
    const root = await actions();

    expect(button(root, 'Discard')).toBeEnabled();
    expect(button(root, 'Publish')).toBeEnabled();
    expect(within(root).queryByTestId('unsynced-trial')).toBeNull();
  });

  it('names the trial branch it would publish to, on the button and in the confirm', async () => {
    serveChanges({
      ...designFixture('changes.unsynced'),
      trialBranch: 'block-packs',
    });
    render(<UnsyncedActions pack="acme" />);
    const root = await actions();

    expect(within(root).getByTestId('unsynced-trial')).toHaveTextContent(
      'trial · block-packs'
    );
    await userEvent.click(button(root, 'Publish to block-packs'));
    expect(await dialog('Publish 1 change?')).toHaveTextContent(
      'pushes it to the trial branch block-packs, not the data branch.'
    );
  });

  it('draws only Publish for a bar that shows the rest itself', async () => {
    render(<UnsyncedActions pack="acme" publishOnly />);

    expect(
      await screen.findByRole('button', { name: 'Publish' })
    ).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.queryByTestId('unsynced-actions')).toBeNull();
  });

  it('holds Publish, and says why, while something blocks it', async () => {
    render(<UnsyncedActions pack="acme" blockedBy="Compile the pack first" />);
    const root = await actions();

    expect(button(root, 'Publish')).toBeDisabled();
    expect(button(root, 'Discard')).toBeEnabled();
    await userEvent.hover(button(root, 'Publish').parentElement!);
    expect(
      await screen.findByText('Compile the pack first')
    ).toBeInTheDocument();
  });

  it('turns Publish off, and says why, while files outside the pack are edited too', async () => {
    serveChanges({
      ...designFixture('changes.unsynced'),
      outsideScope: [
        { path: 'README.md', status: 'M' },
        { path: 'notes/todo.md', status: '??' },
      ],
    });
    render(<UnsyncedActions pack="acme" />);
    const root = await actions();

    expect(button(root, 'Publish')).toBeDisabled();
    expect(button(root, 'Discard')).toBeEnabled();
    await userEvent.hover(button(root, 'Publish').parentElement!);
    expect(
      await screen.findByText(
        'Commit or stash these files outside the pack first: README.md, notes/todo.md'
      )
    ).toBeInTheDocument();
  });
});

describe('Publish', () => {
  it('confirms with the change listed before it posts anything', async () => {
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish();

    expect(confirm).toHaveTextContent(
      'This saves the change to the acme pack and shares it with your team. Then it installs the pack in Claude Code.'
    );
    expect(within(confirm).getByText(REBIND)).toBeInTheDocument();
    expect(confirm).toHaveTextContent(
      'Afterwards, run /reload-plugins in open Claude sessions to pick it up.'
    );
    expect(syncPost).not.toHaveBeenCalled();

    await userEvent.click(button(confirm, 'Publish'));

    await waitFor(() =>
      expect(syncPost).toHaveBeenCalledWith({
        json: {
          pack: 'acme',
          commitPending: true,
          expect: designFixture('changes.unsynced').signature,
        },
      })
    );
    expect(await screen.findByText(PUBLISHED)).toBeInTheDocument();
  });

  it('lists a file by its path when no binding or surface change explains it', async () => {
    serveChanges({
      ...designFixture('changes.clean'),
      dirty: true,
      files: [
        { path: 'skills/review/SKILL.md', status: 'M', hash: HASH },
        { path: 'pack/notes.md', status: '??', hash: HASH },
      ],
    });
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish('Publish 2 changes?');

    expect(
      within(confirm).getByText('skills/review/SKILL.md')
    ).toBeInTheDocument();
    expect(within(confirm).getByText('pack/notes.md')).toBeInTheDocument();
  });

  it('lists an edited file the rebind does not explain beside the rebind', async () => {
    const unsynced = designFixture('changes.unsynced');
    serveChanges({
      ...unsynced,
      files: [
        ...unsynced.files,
        { path: 'attachments/gate-protocol/SKILL.md', status: 'M', hash: HASH },
      ],
    });
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish('Publish 2 changes?');

    expect(
      within(confirm).getByText('attachments/gate-protocol/SKILL.md')
    ).toBeInTheDocument();
    expect(within(confirm).getByText(REBIND)).toBeInTheDocument();
  });

  it("does not list the rebind's own bindings file or the stage it rebuilt", async () => {
    const unsynced = designFixture('changes.unsynced');
    serveChanges({
      ...unsynced,
      files: [
        ...unsynced.files,
        { path: 'attachments/stage-plan/SKILL.md', status: 'M', hash: HASH },
      ],
    });
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish();

    expect(within(confirm).getByText(REBIND)).toBeInTheDocument();
    expect(
      within(confirm).queryByText('attachments/stage-plan/SKILL.md')
    ).toBeNull();
    expect(within(confirm).queryByText('pack/skills.jsonc')).toBeNull();
  });

  it('names a surface change by its skill', async () => {
    serveChanges({
      ...designFixture('changes.clean'),
      dirty: true,
      files: [{ path: 'pack/surface.jsonc', status: 'M', hash: HASH }],
      surface: [{ skill: 'review', from: 'public', to: 'internal' }],
    });
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish();

    expect(within(confirm).queryByText('pack/surface.jsonc')).toBeNull();
    expect(within(confirm).getByText('review')).toBeInTheDocument();
    expect(within(confirm).getByText('public → internal')).toBeInTheDocument();
  });

  it('lists every change in its confirm', async () => {
    serveChanges(FOUR_FILES);
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish('Publish 4 changes?');

    for (const path of FOUR_PATHS)
      expect(within(confirm).getByText(path)).toBeInTheDocument();
  });

  it("posts nothing when the confirm's Cancel is pressed", async () => {
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await openPublish(), 'Cancel'));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Publish 1 change?' })
      ).toBeNull()
    );
    expect(syncPost).not.toHaveBeenCalled();
  });

  it('shows the refusal when sync stops at its guards', async () => {
    syncPost.mockResolvedValue(ok(REFUSED));
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await openPublish(), 'Publish'));

    expect(
      await screen.findByText(REFUSED.steps[0]!.detail)
    ).toBeInTheDocument();
    expect(screen.queryByText(PUBLISHED)).toBeNull();
  });

  it('shows the error when the sync request itself fails', async () => {
    syncPost.mockResolvedValue(ok({ error: 'rt is not installed' }, 503));
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await openPublish(), 'Publish'));

    expect(await screen.findByText('rt is not installed')).toBeInTheDocument();
  });

  it('holds both buttons while it runs', async () => {
    const sync = held();
    syncPost.mockReturnValue(sync.promise);
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await openPublish(), 'Publish'));
    const root = await actions();

    await waitFor(() => expect(button(root, 'Discard')).toBeDisabled());
    expect(button(root, 'Publish')).toBeDisabled();
    expect(button(root, 'Publish')).toHaveAttribute('data-loading');

    serveChanges(designFixture('changes.clean'));
    act(() => sync.answer(SYNCED));

    expect(await screen.findByText(PUBLISHED)).toBeInTheDocument();
  });

  it('posts nothing when the pack changed while its confirm was open', async () => {
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish();
    serveChanges(withNotes(designFixture('changes.unsynced')));

    await userEvent.click(button(confirm, 'Publish'));

    expect(await screen.findByText(CHANGED)).toBeInTheDocument();
    expect(syncPost).not.toHaveBeenCalled();
  });

  it("posts nothing when a listed file's content changed while its confirm was open", async () => {
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish();
    serveChanges(edited(designFixture('changes.unsynced')));

    await userEvent.click(button(confirm, 'Publish'));

    expect(await screen.findByText(CHANGED)).toBeInTheDocument();
    expect(syncPost).not.toHaveBeenCalled();
  });

  it('posts nothing when files outside the pack turned up while its confirm was open', async () => {
    render(<UnsyncedActions pack="acme" />);
    const confirm = await openPublish();
    serveChanges({
      ...designFixture('changes.unsynced'),
      outsideScope: [{ path: 'README.md', status: 'M' }],
    });

    await userEvent.click(button(confirm, 'Publish'));

    expect(
      await screen.findByText(
        'Commit or stash these files outside the pack first: README.md'
      )
    ).toBeInTheDocument();
    expect(syncPost).not.toHaveBeenCalled();
  });

  it('reports a publish that settles after the actions have unmounted', async () => {
    const sync = held();
    syncPost.mockReturnValue(sync.promise);
    const queryClient = newClient();
    const host = (show: boolean) => (
      <QueryClientProvider client={queryClient}>
        {show && <UnsyncedActions pack="acme" />}
      </QueryClientProvider>
    );
    const view = renderWithProviders(host(true));
    await userEvent.click(button(await openPublish(), 'Publish'));
    await waitFor(() => expect(syncPost).toHaveBeenCalled());

    view.rerender(host(false));
    expect(screen.queryByTestId('unsynced-actions')).toBeNull();
    act(() => sync.answer(REFUSED));

    expect(
      await screen.findByText(REFUSED.steps[0]!.detail)
    ).toBeInTheDocument();
  });

  it('waits while another write to the pack is in flight', async () => {
    const { queryClient } = render(<UnsyncedActions pack="acme" />);
    const root = await actions();
    let end!: () => void;
    act(() => {
      end = holdWrite(queryClient, 'acme');
    });

    await waitFor(() => expect(button(root, 'Publish')).toBeDisabled());
    expect(button(root, 'Discard')).toBeDisabled();

    await act(async () => end());
    await waitFor(() => expect(button(root, 'Publish')).toBeEnabled());
  });
});

describe('Discard', () => {
  it('confirms destructively before it throws anything away', async () => {
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await actions(), 'Discard'));

    const confirm = await dialog('Discard 1 change?');
    expect(confirm).toHaveTextContent(
      'This throws away this change in acme. It cannot be undone.'
    );
    expect(within(confirm).getByText(REBIND)).toBeInTheDocument();
    expect(button(confirm, 'Discard').getAttribute('style')).toMatch(/red/);
    expect(discardPost).not.toHaveBeenCalled();

    await userEvent.click(button(confirm, 'Discard'));

    await waitFor(() =>
      expect(discardPost).toHaveBeenCalledWith({
        json: {
          pack: 'acme',
          expect: designFixture('changes.unsynced').signature,
        },
      })
    );
    expect(
      await screen.findByText('Discarded the unsynced changes in acme')
    ).toBeInTheDocument();
  });

  it('lists every change in its confirm', async () => {
    serveChanges(FOUR_FILES);
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await actions(), 'Discard'));

    const confirm = await dialog('Discard 4 changes?');
    expect(confirm).toHaveTextContent(
      'This throws away these 4 changes in acme. It cannot be undone.'
    );
    for (const path of FOUR_PATHS)
      expect(within(confirm).getByText(path)).toBeInTheDocument();
  });

  it('throws nothing away when the pack changed while its confirm was open', async () => {
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await actions(), 'Discard'));
    const confirm = await dialog('Discard 1 change?');
    serveChanges(withNotes(designFixture('changes.unsynced')));

    await userEvent.click(button(confirm, 'Discard'));

    expect(await screen.findByText(CHANGED)).toBeInTheDocument();
    expect(discardPost).not.toHaveBeenCalled();
  });

  it("throws nothing away when a listed file's content changed while its confirm was open", async () => {
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await actions(), 'Discard'));
    const confirm = await dialog('Discard 1 change?');
    serveChanges(edited(designFixture('changes.unsynced')));

    await userEvent.click(button(confirm, 'Discard'));

    expect(await screen.findByText(CHANGED)).toBeInTheDocument();
    expect(discardPost).not.toHaveBeenCalled();
  });

  it('shows the error when rt refuses to discard', async () => {
    discardPost.mockResolvedValue(
      ok({ error: 'pack acme is in the shared checkout' }, 400)
    );
    render(<UnsyncedActions pack="acme" />);
    await userEvent.click(button(await actions(), 'Discard'));
    await userEvent.click(button(await dialog('Discard 1 change?'), 'Discard'));

    expect(
      await screen.findByText('pack acme is in the shared checkout')
    ).toBeInTheDocument();
  });
});

describe('UnsyncedToast', () => {
  const SEEN = 'console-unsynced-seen-acme';
  const toast = () => screen.findByTestId('unsynced-toast');

  function renderToast({
    ready = true,
    queryClient = newClient(),
  }: { ready?: boolean; queryClient?: QueryClient } = {}) {
    const onReview = vi.fn();
    const view = render(
      <UnsyncedToast pack="acme" ready={ready} onReview={onReview} />,
      queryClient
    );
    return Object.assign(view, { onReview });
  }

  it('says how many changes wait, and where, once the page is ready', async () => {
    serveChanges({
      ...designFixture('changes.unsynced'),
      trialBranch: 'block-packs',
    });
    renderToast();

    const root = await toast();
    expect(root).toHaveTextContent('1 change not synced');
    expect(root).toHaveTextContent('acme · block-packs');
  });

  it('waits for the page to draw before it shows', async () => {
    const view = renderToast({ ready: false });
    await settled();

    expect(screen.queryByTestId('unsynced-toast')).toBeNull();
    expect(window.localStorage.getItem(SEEN) ?? '').not.toContain(
      designFixture('changes.unsynced').signature
    );

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <UnsyncedToast pack="acme" ready onReview={view.onReview} />
      </QueryClientProvider>
    );
    expect(await toast()).toBeInTheDocument();
  });

  it('shows nothing while the pack is clean', async () => {
    serveChanges(designFixture('changes.clean'));
    renderToast();
    await settled();

    expect(screen.queryByTestId('unsynced-toast')).toBeNull();
  });

  it('shows once per change list, never again for the same one', async () => {
    const first = renderToast();
    await toast();
    expect(window.localStorage.getItem(SEEN)).toContain(
      designFixture('changes.unsynced').signature
    );
    first.unmount();

    renderToast();
    await settled();
    expect(screen.queryByTestId('unsynced-toast')).toBeNull();
  });

  it('shows again once the change list moves on', async () => {
    const first = renderToast();
    await toast();
    first.unmount();

    serveChanges(edited(designFixture('changes.unsynced')));
    renderToast();
    expect(await toast()).toBeInTheDocument();
  });

  it('opens the list from the pill and goes away', async () => {
    const { onReview } = renderToast();
    const root = await toast();

    await userEvent.click(within(root).getByText('Review'));

    expect(onReview).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByTestId('unsynced-toast')).toBeNull()
    );
  });

  it('goes away on Dismiss without opening the list', async () => {
    const { onReview } = renderToast();
    const root = await toast();

    await userEvent.click(button(root, 'Dismiss'));

    expect(onReview).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId('unsynced-toast')).toBeNull()
    );
  });

  it('hides by itself after a while, and stays while hovered', async () => {
    renderToast();
    const root = await toast();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => {
        root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByTestId('unsynced-toast')).toBeInTheDocument();

      act(() => {
        root.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      });
      await act(async () => {
        vi.advanceTimersByTime(8_500);
      });
      await waitFor(() =>
        expect(screen.queryByTestId('unsynced-toast')).toBeNull()
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
