import '../../icons';

import { notifications } from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const surfaceGet = vi.fn();
const surfaceApplyPost = vi.fn();
const compositionGet = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: {
      skills: {
        surface: {
          $get: (...args: unknown[]) => surfaceGet(...args),
          apply: { $post: (...args: unknown[]) => surfaceApplyPost(...args) },
        },
        composition: {
          $get: (...args: unknown[]) => compositionGet(...args),
        },
      },
    },
  },
}));

const { SurfaceTab } = await import('../SurfaceTab');
const { holdWrite } = await import('./writeLock');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}
function err(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

const ROWS = [
  { name: 'review', kind: 'compiled', status: 'public' },
  { name: 'watch-ci', kind: 'compiled', status: 'internal' },
  { name: 'ship', kind: 'compiled', status: 'public' },
  { name: 'model-tiering', kind: 'hand-authored', status: 'internal' },
];

/** A composition verb with every field the focus groups read. */
function verb(over: { name: string; sourcePath?: string }) {
  return {
    engine: over.name,
    engineRef: `acme:${over.name}`,
    plugin: 'acme',
    description: over.name,
    public: true,
    artifactPath: `/p/skills/${over.name}`,
    props: {},
    includes: [],
    ...over,
  };
}

function renderSurfaceTab(
  rows: unknown[] = ROWS,
  composition: {
    verbs?: { name: string; sourcePath?: string }[];
    fills?: unknown[];
  } = {},
  health?: ReadonlyMap<string, 'stale' | 'never-compiled'>
) {
  surfaceGet.mockResolvedValue(ok({ pack: 'demo', packDir: '/p', rows }));
  // The open-in-editor link joins composition by name; default to none so the
  // staging tests are unaffected, and let a test supply verbs/fills to opt in.
  compositionGet.mockResolvedValue(
    ok({
      pack: 'demo',
      packDir: '/p',
      verbs: (composition.verbs ?? []).map(verb),
      fills: composition.fills ?? [],
      binders: [],
      groups: [],
    })
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <SurfaceTab pack="demo" health={health} />
    </QueryClientProvider>
  );
  return Object.assign(view, { queryClient });
}

/** Unfolds one group of the list by its head. */
async function openGroup(id: string) {
  const group = await screen.findByTestId(`surface-group-${id}`);
  const head = within(group).getAllByRole('button')[0]!;
  if (head.getAttribute('aria-expanded') !== 'true')
    await userEvent.click(head);
  // The rows stay hidden until the unfold's transition ends.
  await waitFor(() =>
    expect(within(group).getAllByRole('switch').length).toBeGreaterThan(0)
  );
}

/** A badge's meaning shows in its hover card once the pointer rests. */
async function hoverMeaning(target: HTMLElement, meaning: string) {
  await userEvent.hover(target);
  expect(
    await screen.findByText(meaning, {}, { timeout: 2000 })
  ).toBeInTheDocument();
  await userEvent.unhover(target);
}

/** Same read-the-rendered-switches approach the old `SurfaceRoster` suite
    used -- the delta the test computes must match exactly what the
    component itself is required to compute. */
function stagedDelta(rows: { name: string; status: string }[]) {
  const toPublic: string[] = [];
  const toInternal: string[] = [];
  for (const row of rows) {
    const input = screen.getByRole('switch', {
      name: new RegExp(`^${row.name}$`),
    }) as HTMLInputElement;
    const now = input.checked ? 'public' : 'internal';
    if (now === row.status) continue;
    (now === 'public' ? toPublic : toInternal).push(row.name);
  }
  toPublic.sort();
  toInternal.sort();
  return { toPublic, toInternal };
}

afterEach(() => {
  act(() => notifications.clean());
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('SurfaceTab: public rows render as on', () => {
  it('checks the switch for every row whose on-disk status is public', async () => {
    renderSurfaceTab();

    await screen.findByTestId('surface-row-review');
    expect(screen.getByRole('switch', { name: /^review$/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /^ship$/ })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: /^watch-ci$/ })
    ).not.toBeChecked();
    expect(
      screen.getByRole('switch', { name: /^model-tiering$/ })
    ).not.toBeChecked();
  });
});

describe('SurfaceTab: a row an org base pack owns', () => {
  const BASE_ROWS = [
    {
      name: 'dev-servers',
      kind: 'compiled',
      status: 'internal',
      base: 'acme-base',
    },
    { name: 'ship', kind: 'compiled', status: 'public' },
  ];

  it('lists it under the parent pack, folded until opened', async () => {
    renderSurfaceTab(BASE_ROWS);
    const group = await screen.findByTestId('surface-group-base');

    expect(group).toHaveTextContent('From the parent pack');
    expect(within(group).getAllByRole('button')[0]).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByTestId('surface-group-commands')).toHaveAttribute(
      'data-open'
    );

    await openGroup('base');
    expect(within(group).getAllByRole('button')[0]).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(window.localStorage.getItem('console-surface-group-base')).toBe(
      'true'
    );
  });

  it('shows a from-base badge and locks the toggle, while a plain compiled row keeps both', async () => {
    renderSurfaceTab(BASE_ROWS);
    await openGroup('base');
    const row = await screen.findByTestId('surface-row-dev-servers');

    expect(within(row).getByText('from acme-base')).toBeInTheDocument();
    expect(within(row).queryByText('compiled')).not.toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: /^dev-servers$/ })
    ).toBeDisabled();

    const plain = screen.getByTestId('surface-row-ship');
    expect(within(plain).getByText('compiled')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /^ship$/ })).toBeEnabled();
  });

  it('says why on hover', async () => {
    renderSurfaceTab(BASE_ROWS);
    await openGroup('base');
    const row = await screen.findByTestId('surface-row-dev-servers');

    await userEvent.hover(within(row).getByTestId('surface-lock-dev-servers'));

    expect(
      await screen.findByText(
        'The org base pack decides. Verbs read it from attachments/, so it stays internal.'
      )
    ).toBeInTheDocument();
  });
});

describe('SurfaceTab: staging is the whole design', () => {
  it('toggling rows writes nothing until Apply', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));

    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });

  it('the staged delta names the equivalent CLI command in the footer', async () => {
    renderSurfaceTab([
      { name: 'watch-ci', kind: 'compiled', status: 'internal' },
    ]);
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));

    expect(
      screen.getByText('rt skills surface set watch-ci --public')
    ).toBeInTheDocument();
    expect(screen.getByText('1 change staged')).toBeInTheDocument();
  });

  it('names both directions, joined, when the delta goes both ways', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    // watch-ci: internal -> public. ship: public -> internal.
    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));

    expect(
      screen.getByText(
        'rt skills surface set watch-ci --public · rt skills surface set ship --internal'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('2 changes staged')).toBeInTheDocument();
  });

  it('a row toggled twice leaves the delta empty rather than listing it as unchanged-but-touched', async () => {
    renderSurfaceTab([
      { name: 'watch-ci', kind: 'compiled', status: 'internal' },
    ]);
    await screen.findByTestId('surface-row-watch-ci');
    const toggle = screen.getByRole('switch', { name: /^watch-ci$/ });

    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(stagedDelta([{ name: 'watch-ci', status: 'internal' }])).toEqual({
      toPublic: [],
      toInternal: [],
    });
    expect(screen.getByText('Nothing staged')).toBeInTheDocument();
  });
});

describe('SurfaceTab: pressing Apply', () => {
  it('hands Apply the full bidirectional delta, sorted, via surfaceApply.mutate', async () => {
    surfaceApplyPost.mockResolvedValue(
      ok({ pack: 'demo', steps: [], rows: null })
    );
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(surfaceApplyPost).toHaveBeenCalledTimes(1));
    expect(surfaceApplyPost.mock.calls[0][0]).toMatchObject({
      json: {
        pack: 'demo',
        toPublic: ['watch-ci'],
        toInternal: ['ship'],
      },
    });
  });

  it('disables Apply and Discard until something is staged', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('Discard clears every staged row without calling Apply', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(
      screen.getByRole('switch', { name: /^watch-ci$/ })
    ).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });

  it('holds Apply while another write to the pack is in flight', async () => {
    const { queryClient } = renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');
    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();

    let end!: () => void;
    act(() => {
      end = holdWrite(queryClient, 'demo');
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    );

    await act(async () => end());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
    );
  });

  it('refuses an Apply clicked before the screen caught up with another write to the pack', async () => {
    const { queryClient } = renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');
    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeEnabled();

    holdWrite(queryClient, 'demo');
    fireEvent.click(apply);

    expect(
      await screen.findByText(
        'Another change to demo is still being written. Try again once it finishes.'
      )
    ).toBeInTheDocument();
    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });

  it('shows the error when the apply mutation fails outright', async () => {
    surfaceApplyPost.mockResolvedValue(err(400, 'ship: rt exited nonzero'));
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(
      await screen.findByText('ship: rt exited nonzero')
    ).toBeInTheDocument();
  });
});

describe('SurfaceTab: compiled rows are not moved', () => {
  it('gives a compiled row its own effect line, never the hand-authored move wording', async () => {
    renderSurfaceTab([{ name: 'ship', kind: 'compiled', status: 'public' }]);
    await screen.findByTestId('surface-row-ship');

    await userEvent.click(screen.getByRole('switch', { name: /^ship$/ }));

    expect(
      screen.getByText('skills/ship/ stops being compiled and is removed')
    ).toBeInTheDocument();
    expect(screen.queryByText(/attachments\/ship/)).not.toBeInTheDocument();
  });

  it('describes a hand-authored row as a real move', async () => {
    renderSurfaceTab([
      { name: 'model-tiering', kind: 'hand-authored', status: 'internal' },
    ]);
    await screen.findByTestId('surface-row-model-tiering');

    await userEvent.click(
      screen.getByRole('switch', { name: /^model-tiering$/ })
    );

    expect(
      screen.getByText('attachments/model-tiering/ → skills/model-tiering/')
    ).toBeInTheDocument();
  });
});

describe('SurfaceTab: filters', () => {
  it('narrows the roster by name as the filter text is typed', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.type(screen.getByTestId('surface-filter-input'), 'watch');

    expect(screen.getByTestId('surface-row-watch-ci')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-ship')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-model-tiering')
    ).not.toBeInTheDocument();
  });

  it('the Public chip narrows to rows currently public on disk', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByTestId('surface-filter-public'));

    expect(screen.getByTestId('surface-row-review')).toBeInTheDocument();
    expect(screen.getByTestId('surface-row-ship')).toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-watch-ci')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-model-tiering')
    ).not.toBeInTheDocument();
  });

  it('the Standard chip narrows to standard rows', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByTestId('surface-filter-standard'));

    expect(screen.getByTestId('surface-row-model-tiering')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-ship')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-watch-ci')
    ).not.toBeInTheDocument();
  });
});

describe('SurfaceTab: staging resets on pack switch', () => {
  it('drops a staged change when the pack changes, even if the new pack shares the row signature', async () => {
    const user = userEvent.setup();
    surfaceGet.mockResolvedValue(
      ok({ pack: 'demo', packDir: '/p', rows: ROWS })
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <SurfaceTab pack="demo" />
      </QueryClientProvider>
    );

    await screen.findByTestId('surface-row-watch-ci');
    await user.click(screen.getByRole('switch', { name: /^watch-ci$/ }));
    expect(await screen.findByText('1 change staged')).toBeInTheDocument();

    // A different pack that happens to return the SAME rows (identical
    // signature): only `pack` changed, so a signature-only reset would leak the
    // stale delta. The reset must fire on the pack change.
    rerender(
      <QueryClientProvider client={queryClient}>
        <SurfaceTab pack="other" />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText('Nothing staged')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });
});

describe('SurfaceTab: open in editor', () => {
  it('links a row to its source, joining composition by name (verb) and binding suffix (fill)', async () => {
    renderSurfaceTab(ROWS, {
      verbs: [{ name: 'review', sourcePath: '/p/skills/review/SKILL.md' }],
      fills: [
        {
          binding: 'demo:model-tiering',
          name: 'model-tiering',
          sourcePath: '/p/fills/model-tiering/SKILL.md',
        },
      ],
    });

    expect(await screen.findByTestId('surface-open-review')).toHaveAttribute(
      'href',
      'vscode://file/p/skills/review/SKILL.md'
    );
    expect(screen.getByTestId('surface-open-model-tiering')).toHaveAttribute(
      'href',
      'vscode://file/p/fills/model-tiering/SKILL.md'
    );
    // A row composition has no source for shows no link, rather than a dead one.
    expect(
      screen.queryByTestId('surface-open-watch-ci')
    ).not.toBeInTheDocument();
  });

  it('offers no editor button on a base row, which compile rewrites', async () => {
    renderSurfaceTab(
      [
        {
          name: 'dev-servers',
          kind: 'compiled',
          status: 'internal',
          base: 'acme-base',
        },
        { name: 'review', kind: 'compiled', status: 'public' },
      ],
      {
        verbs: [
          { name: 'dev-servers', sourcePath: '/p/skills/dev-servers/SKILL.md' },
          { name: 'review', sourcePath: '/p/skills/review/SKILL.md' },
        ],
      }
    );

    expect(
      await screen.findByTestId('surface-open-review')
    ).toBeInTheDocument();
    await openGroup('base');
    await screen.findByTestId('surface-row-dev-servers');
    expect(
      screen.queryByTestId('surface-open-dev-servers')
    ).not.toBeInTheDocument();
  });

  it("links a standalone skill through the row's own path", async () => {
    renderSurfaceTab([
      {
        name: 'context',
        kind: 'hand-authored',
        status: 'public',
        path: '/p/skills/context/SKILL.md',
      },
    ]);

    expect(await screen.findByTestId('surface-open-context')).toHaveAttribute(
      'href',
      'vscode://file/p/skills/context/SKILL.md'
    );
  });
});

describe('SurfaceTab: what the switch and badges mean', () => {
  it('says what the switch does in one line above the list', async () => {
    renderSurfaceTab();
    const key = await screen.findByTestId('surface-switch-key');

    expect(key).toHaveTextContent("OnIn agents' skill list");
    expect(key).toHaveTextContent('OffReached only through another skill');
  });

  it('names each kind on its badge, standard for one not compiled, and says what it means on hover', async () => {
    renderSurfaceTab();
    const standard = await screen.findByTestId('surface-row-model-tiering');
    const compiled = screen.getByTestId('surface-row-review');

    expect(within(standard).getByText('standard')).toBeInTheDocument();
    expect(within(standard).queryByText(/fill|hand/)).not.toBeInTheDocument();
    await hoverMeaning(
      within(standard).getByText('standard'),
      'Installed as written'
    );
    await hoverMeaning(
      within(compiled).getByText('compiled'),
      'Built from blocks and fills'
    );
  });

  it('says a base row is edited in the parent pack', async () => {
    renderSurfaceTab([
      {
        name: 'dev-servers',
        kind: 'compiled',
        status: 'internal',
        base: 'acme-base',
      },
    ]);
    await openGroup('base');
    const row = await screen.findByTestId('surface-row-dev-servers');

    await hoverMeaning(
      within(row).getByText('from acme-base'),
      'From the parent pack. Edit it there'
    );
  });
});

describe('SurfaceTab: groups', () => {
  it('lists the groups in order, what agents see first within each', async () => {
    renderSurfaceTab([
      { name: 'zeta', kind: 'hand-authored', status: 'internal' },
      {
        name: 'dev-servers',
        kind: 'compiled',
        status: 'internal',
        base: 'acme-base',
      },
      ...ROWS,
    ]);
    await screen.findByTestId('surface-row-review');

    expect(
      screen
        .getAllByTestId(/^surface-group-/)
        .map(group => group.getAttribute('data-testid'))
    ).toEqual([
      'surface-group-commands',
      'surface-group-unwired',
      'surface-group-base',
    ]);
    const commands = screen.getByTestId('surface-group-commands');
    expect(
      within(commands)
        .getAllByTestId(/^surface-row-/)
        .map(row => row.getAttribute('data-testid'))
    ).toEqual([
      'surface-row-review',
      'surface-row-ship',
      'surface-row-watch-ci',
    ]);
    expect(commands).toHaveTextContent('Commands3');
    expect(commands).toHaveTextContent('2 public');
  });
});

describe('SurfaceTab: skills that need attention', () => {
  const HEALTH = new Map([
    ['ship', 'stale'],
    ['watch-ci', 'never-compiled'],
  ] as const);

  it('notes a stale or never-compiled row on the row itself', async () => {
    renderSurfaceTab(ROWS, {}, HEALTH);

    expect(await screen.findByTestId('surface-health-ship')).toHaveTextContent(
      'source newer'
    );
    expect(screen.getByTestId('surface-health-watch-ci')).toHaveTextContent(
      'never compiled'
    );
    expect(
      screen.queryByTestId('surface-health-review')
    ).not.toBeInTheDocument();
  });

  it('offers a Needs attention chip that narrows to them', async () => {
    renderSurfaceTab(ROWS, {}, HEALTH);
    await screen.findByTestId('surface-row-review');

    const chip = screen.getByTestId('surface-filter-needs attention');
    expect(chip).toHaveTextContent('Needs attention2');
    await userEvent.click(chip);

    expect(screen.getByTestId('surface-row-ship')).toBeInTheDocument();
    expect(screen.getByTestId('surface-row-watch-ci')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-review')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('surface-row-model-tiering')
    ).not.toBeInTheDocument();
  });

  it('offers no such chip when nothing needs attention', async () => {
    renderSurfaceTab();
    await screen.findByTestId('surface-row-review');

    expect(
      screen.queryByTestId('surface-filter-needs attention')
    ).not.toBeInTheDocument();
  });
});
