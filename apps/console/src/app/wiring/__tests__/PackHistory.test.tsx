import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const COMMITS = [
  {
    sha: 'c3'.padEnd(40, '3'),
    shortSha: 'c333333',
    subject: 'newest change',
    authoredAt: '2026-10-27T12:00:00Z',
  },
  {
    sha: 'c2'.padEnd(40, '2'),
    shortSha: 'c222222',
    subject: 'middle change',
    authoredAt: '2026-10-26T12:00:00Z',
  },
  {
    sha: 'c1'.padEnd(40, '1'),
    shortSha: 'c111111',
    subject: 'oldest change',
    authoredAt: '2026-10-25T12:00:00Z',
  },
];
const [NEWEST, MIDDLE, OLDEST] = COMMITS as [
  (typeof COMMITS)[number],
  (typeof COMMITS)[number],
  (typeof COMMITS)[number],
];

const DIFF = [
  'diff --git a/skills/ship/SKILL.md b/skills/ship/SKILL.md',
  '--- a/skills/ship/SKILL.md',
  '+++ b/skills/ship/SKILL.md',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

const summary = vi.hoisted(() => ({
  current: null as { count: number; trial: string | null } | null,
}));
const diffCalls = vi.hoisted(() => [] as (string | null)[][]);

vi.mock('../useWiring', () => ({
  useSkillsHistory: () => ({
    data: { commits: COMMITS, truncated: false },
    isPending: false,
    isError: false,
    error: null,
  }),
  useSkillsDiff: (pack: string, from: string | null, to: string | null) => {
    diffCalls.push([pack, from, to]);
    return {
      data: from && to ? { diff: DIFF, truncated: false } : undefined,
      isPending: false,
      isError: false,
      error: null,
    };
  },
}));

vi.mock('../graph/UnsyncedBanner', () => ({
  useUnsyncedSummary: () => summary.current,
  UnsyncedActions: ({ pack }: { pack: string }) => (
    <div data-testid="unsynced-actions">{pack}</div>
  ),
}));

vi.mock('../DiffFileTree', () => ({
  default: ({ files }: { files: { path: string }[] }) => (
    <ul data-testid="file-tree">
      {files.map(file => (
        <li key={file.path}>{file.path}</li>
      ))}
    </ul>
  ),
}));

vi.mock('../PatchView', () => ({
  default: ({ path }: { path: string }) => (
    <div data-testid="patch-view">{path}</div>
  ),
}));

const { HistoryMain, HistorySidebar, WORKING } = await import('../PackHistory');

const at = (search: string) =>
  window.history.replaceState(null, '', `/wiring${search}`);
const commitsInUrl = () =>
  new URLSearchParams(window.location.search).get('commits');
const row = (commit: (typeof COMMITS)[number]) =>
  screen.getByTestId(`commit-${commit.shortSha}`);

beforeEach(() => {
  summary.current = null;
  diffCalls.length = 0;
  at('?tab=history&pack=acme');
});

afterEach(() => {
  at('');
  window.localStorage.clear();
});

describe('the Changes sidebar: unsynced changes', () => {
  it('opens on the unsynced changes, a card above the committed log', async () => {
    summary.current = { count: 2, trial: null };
    renderWithProviders(<HistorySidebar pack="acme" />);

    await waitFor(() => expect(commitsInUrl()).toBe(WORKING));
    const working = screen.getByTestId('commit-working');
    expect(working).toHaveTextContent('Unsynced changes');
    expect(working).toHaveTextContent('2 changes');
    expect(working).toHaveTextContent('not synced yet');
    expect(working).toHaveAttribute('data-selected', 'true');
    expect(working).toHaveAttribute('aria-pressed', 'true');

    const list = screen.getByTestId('commit-list');
    const label = within(list).getByText('Committed');
    expect(
      working.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      label.compareDocumentPosition(row(NEWEST)) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('names the trial branch the changes would go to', () => {
    summary.current = { count: 1, trial: 'block-packs' };
    renderWithProviders(<HistorySidebar pack="acme" />);

    const working = screen.getByTestId('commit-working');
    expect(working).toHaveTextContent('1 change');
    expect(working).toHaveTextContent('to sync to block-packs');
  });

  it('draws no card and no Committed label when the pack is clean, and opens on the newest commit', async () => {
    renderWithProviders(<HistorySidebar pack="acme" />);

    await waitFor(() => expect(commitsInUrl()).toBe(NEWEST.sha));
    expect(screen.queryByTestId('commit-working')).not.toBeInTheDocument();
    expect(screen.queryByText('Committed')).not.toBeInTheDocument();
  });

  it('selects the card from a commit, and leaves it for a commit alone, never a compare', async () => {
    summary.current = { count: 2, trial: null };
    at(`?tab=history&pack=acme&commits=${MIDDLE.sha}`);
    renderWithProviders(<HistorySidebar pack="acme" />);

    await userEvent.click(screen.getByTestId('commit-working'));
    expect(commitsInUrl()).toBe(WORKING);

    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(row(OLDEST));
    await user.keyboard('{/Shift}');
    expect(commitsInUrl()).toBe(OLDEST.sha);
    expect(screen.getByTestId('commit-working')).not.toHaveAttribute(
      'data-selected'
    );
  });

  it('moves on to the newest commit once a sync empties the working tree', async () => {
    summary.current = { count: 2, trial: null };
    const view = renderWithProviders(<HistorySidebar pack="acme" />);
    await waitFor(() => expect(commitsInUrl()).toBe(WORKING));

    summary.current = null;
    view.rerender(<HistorySidebar pack="acme" />);
    await waitFor(() => expect(commitsInUrl()).toBe(NEWEST.sha));
  });
});

describe('the Changes sidebar: compare', () => {
  async function compare(first: typeof NEWEST, second: typeof NEWEST) {
    at(`?tab=history&pack=acme&commits=${first.sha}`);
    renderWithProviders(<HistorySidebar pack="acme" />);
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(row(second));
    await user.keyboard('{/Shift}');
  }

  it('offers the shift-click hint until two commits are picked', () => {
    at(`?tab=history&pack=acme&commits=${NEWEST.sha}`);
    renderWithProviders(<HistorySidebar pack="acme" />);

    expect(screen.getByText('⇧-click to compare')).toBeInTheDocument();
    expect(screen.queryByTestId('clear-compare')).not.toBeInTheDocument();
  });

  it('labels the older pick From and the newer pick To, whichever was picked first', async () => {
    await compare(OLDEST, NEWEST);

    expect(commitsInUrl()).toBe(`${OLDEST.sha},${NEWEST.sha}`);
    expect(row(NEWEST)).toHaveTextContent(/To$/);
    expect(row(OLDEST)).toHaveTextContent(/From$/);
    expect(row(MIDDLE)).not.toHaveTextContent(/(To|From)$/);
  });

  it('puts Clear compare in place of the hint, and clears both picks', async () => {
    await compare(NEWEST, MIDDLE);

    expect(screen.queryByText('⇧-click to compare')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('clear-compare'));

    // With nothing picked the page opens on the newest commit again.
    await waitFor(() => expect(commitsInUrl()).toBe(NEWEST.sha));
    expect(screen.queryByTestId('clear-compare')).not.toBeInTheDocument();
    expect(screen.getByText('⇧-click to compare')).toBeInTheDocument();
    expect(row(MIDDLE)).toHaveAttribute('aria-pressed', 'false');
    expect(row(NEWEST)).not.toHaveTextContent(/(To|From)$/);
  });

  it('drops a pick clicked again', async () => {
    await compare(NEWEST, MIDDLE);

    await userEvent.click(row(NEWEST));
    expect(commitsInUrl()).toBe(MIDDLE.sha);
  });
});

describe('the Changes diff', () => {
  it('heads the unsynced changes by name, with their actions, diffed from HEAD', async () => {
    summary.current = { count: 1, trial: null };
    at(`?tab=history&pack=acme&commits=${WORKING}`);
    renderWithProviders(<HistoryMain pack="acme" height="600px" />);

    const diff = screen.getByTestId('commit-diff');
    expect(diff).toHaveTextContent('Unsynced changes');
    expect(diff).not.toHaveTextContent('→');
    expect(within(diff).getByTestId('unsynced-actions')).toHaveTextContent(
      'acme'
    );
    expect(diffCalls).toContainEqual(['acme', 'HEAD', WORKING]);
    expect(await screen.findByTestId('patch-view')).toHaveTextContent(
      'skills/ship/SKILL.md'
    );
  });

  it('heads a commit by its range, with no actions', () => {
    at(`?tab=history&pack=acme&commits=${NEWEST.sha}`);
    renderWithProviders(<HistoryMain pack="acme" height="600px" />);

    const diff = screen.getByTestId('commit-diff');
    expect(diff).toHaveTextContent(`${MIDDLE.shortSha} → ${NEWEST.shortSha}`);
    expect(screen.queryByTestId('unsynced-actions')).not.toBeInTheDocument();
  });

  it('runs a compare from the older pick to the newer', () => {
    at(`?tab=history&pack=acme&commits=${NEWEST.sha},${OLDEST.sha}`);
    renderWithProviders(<HistoryMain pack="acme" height="600px" />);

    expect(screen.getByTestId('commit-diff')).toHaveTextContent(
      `${OLDEST.shortSha} → ${NEWEST.shortSha}`
    );
  });

  it('says there is nothing before the oldest commit', () => {
    at(`?tab=history&pack=acme&commits=${OLDEST.sha}`);
    renderWithProviders(<HistoryMain pack="acme" height="600px" />);

    expect(screen.getByTestId('compare-hint')).toHaveTextContent(
      'nothing before it to compare'
    );
  });

  it('sizes the file list from its resizer', () => {
    at(`?tab=history&pack=acme&commits=${NEWEST.sha}`);
    renderWithProviders(<HistoryMain pack="acme" height="600px" />);

    const resizer = screen.getByRole('separator', {
      name: 'Resize the file list',
    });
    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    expect(resizer).toHaveAttribute('aria-valuenow', '384');
    expect(screen.getByTestId('pack-history').style.gridTemplateColumns).toBe(
      '384px minmax(0, 1fr)'
    );
  });
});
