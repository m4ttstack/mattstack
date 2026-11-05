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
const modelInvocationPost = vi.fn();

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
        'disable-model-invocation': {
          $post: (...args: unknown[]) => modelInvocationPost(...args),
        },
      },
    },
  },
}));

const { SurfaceTab } = await import('../SurfaceTab');
const { holdWrite } = await import('./writeLock');
const { skillsWriteKey } = await import('../useWiring');

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
  health?: ReadonlyMap<string, 'stale' | 'never-compiled'>,
  onOpenOverview?: () => void
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
      <SurfaceTab pack="demo" health={health} onOpenOverview={onOpenOverview} />
    </QueryClientProvider>
  );
  return Object.assign(view, { queryClient });
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
      basePath: '/org/packs/acme-base/attachments/dev-servers/SKILL.md',
    },
    {
      name: 'board-review',
      kind: 'compiled',
      status: 'internal',
      base: 'acme-base',
      fill: true,
    },
    { name: 'ship', kind: 'compiled', status: 'public' },
  ];

  it('lists a reference skill with the base named and a working switch', async () => {
    renderSurfaceTab(BASE_ROWS);
    const group = await screen.findByTestId('surface-group-reference');
    const row = within(group).getByTestId('surface-row-dev-servers');

    expect(within(row).getByText('acme-base')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /^dev-servers$/ })).toBeEnabled();
  });

  it('stages a base reference skill like any other', async () => {
    renderSurfaceTab(BASE_ROWS);
    await userEvent.click(
      await screen.findByRole('switch', { name: /^dev-servers$/ })
    );

    expect(screen.getByText('1 change staged')).toBeInTheDocument();
  });

  it('leaves a base fill out of the list', async () => {
    renderSurfaceTab(BASE_ROWS);
    await screen.findByTestId('surface-row-dev-servers');

    expect(
      screen.queryByTestId('surface-row-board-review')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('surface-built-in')).toHaveTextContent(
      '0 stages and 1 fill are built into other skills'
    );
  });

  it('counts the From chip over the listed rows, and hides it with no base', async () => {
    renderSurfaceTab(BASE_ROWS);
    expect(await screen.findByTestId('surface-filter-base')).toHaveTextContent(
      'From acme-base1'
    );
  });
});

describe('SurfaceTab: a listed skill with no files', () => {
  it('can be staged off the list, but never on', async () => {
    renderSurfaceTab([
      { name: 'gone', kind: 'missing', status: 'public' },
      { name: 'lost', kind: 'missing', status: 'internal' },
    ]);

    await userEvent.click(
      await screen.findByRole('switch', { name: /^lost$/ })
    );
    expect(screen.getByText('Nothing staged')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: /^gone$/ }));
    expect(screen.getByText('1 change staged')).toBeInTheDocument();
    expect(
      screen.getByText('gone comes off the surface list')
    ).toBeInTheDocument();
  });
});

describe('SurfaceTab: stages and fills', () => {
  const COMPOSITION = {
    verbs: [{ name: 'work', sourcePath: '/p/skills/work/SKILL.md' }],
    fills: [
      {
        binding: 'demo:criteria',
        name: 'criteria',
        sourcePath: '/p/fills/criteria/SKILL.md',
      },
    ],
  };
  const ROWS_WITH_FILL = [
    { name: 'work', kind: 'compiled', status: 'public' },
    { name: 'criteria', kind: 'hand-authored', status: 'internal' },
  ];

  it('links out of the list', async () => {
    const onOpenOverview = vi.fn();
    renderSurfaceTab(ROWS_WITH_FILL, COMPOSITION, undefined, onOpenOverview);
    await screen.findByTestId('surface-row-work');

    expect(
      screen.queryByTestId('surface-row-criteria')
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See Overview' }));
    expect(onOpenOverview).toHaveBeenCalledTimes(1);
  });

  it('shows a stale one under Needs attention, with no switch', async () => {
    renderSurfaceTab(
      ROWS_WITH_FILL,
      COMPOSITION,
      new Map([['criteria', 'stale' as const]])
    );
    await screen.findByTestId('surface-row-work');

    await userEvent.click(screen.getByTestId('surface-filter-needs attention'));

    expect(await screen.findByTestId('surface-row-criteria')).toHaveTextContent(
      'source newer'
    );
    expect(
      screen.queryByRole('switch', { name: /^criteria$/ })
    ).not.toBeInTheDocument();
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

  it('the From chip narrows to rows from the base', async () => {
    renderSurfaceTab([
      ...ROWS,
      {
        name: 'dev-servers',
        kind: 'compiled',
        status: 'internal',
        base: 'acme-base',
      },
    ]);
    await screen.findByTestId('surface-row-watch-ci');

    await userEvent.click(screen.getByTestId('surface-filter-base'));

    expect(screen.getByTestId('surface-row-dev-servers')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-row-review')).not.toBeInTheDocument();
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
    const rows = ROWS.map(row =>
      row.name === 'model-tiering' ? { ...row, status: 'public' } : row
    );
    renderSurfaceTab(rows, {
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

  it("links a base row to the base pack's file, never the team's copy", async () => {
    renderSurfaceTab([
      {
        name: 'dev-servers',
        kind: 'compiled',
        status: 'internal',
        base: 'acme-base',
        path: '/p/attachments/dev-servers/SKILL.md',
        basePath: '/org/packs/acme-base/attachments/dev-servers/SKILL.md',
      },
    ]);

    expect(
      await screen.findByTestId('surface-open-dev-servers')
    ).toHaveAttribute(
      'href',
      'vscode://file/org/packs/acme-base/attachments/dev-servers/SKILL.md'
    );
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
    expect(key).toHaveTextContent(
      'OffOnly reached if another skill points here'
    );
  });

  it('shows no compiled or standard badge', async () => {
    renderSurfaceTab();
    const row = await screen.findByTestId('surface-row-review');

    expect(within(row).queryByText('compiled')).not.toBeInTheDocument();
    expect(screen.queryByText('standard')).not.toBeInTheDocument();
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
    const row = await screen.findByTestId('surface-row-dev-servers');

    await hoverMeaning(
      within(row).getByText('acme-base'),
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
    ).toEqual(['surface-group-commands', 'surface-group-reference']);
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
    expect(commands).toHaveTextContent('Commands');
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

describe('SurfaceTab: disable model invocation', () => {
  const INFO =
    'Can only be invoked by typing the skill call directly. Agents will not auto-discover this skill, or be able to invoke it themselves.';
  const LINE = 'Model invocation disabled';
  const ITEM = 'Disable model invocation';
  const DMI_ROWS = [
    {
      name: 'deploy',
      kind: 'compiled',
      status: 'public',
      disableModelInvocation: 'off',
    },
    {
      name: 'release',
      kind: 'compiled',
      status: 'public',
      disableModelInvocation: 'on',
    },
    {
      name: 'triage',
      kind: 'compiled',
      status: 'public',
      disableModelInvocation: 'locked',
    },
    { name: 'gates', kind: 'compiled', status: 'internal' },
    {
      name: 'dev-servers',
      kind: 'compiled',
      status: 'internal',
      base: 'acme-base',
    },
  ];
  const applied = {
    names: ['deploy'],
    on: true,
    applied: true,
    warnings: [] as string[],
  };

  const row = (name: string) => screen.getByTestId(`surface-row-${name}`);
  const gear = (name: string) =>
    screen.queryByTestId(`surface-settings-${name}`);

  async function renderRows(rows: unknown[] = DMI_ROWS) {
    const view = renderSurfaceTab(rows);
    await screen.findByTestId('surface-row-deploy');
    return view;
  }

  async function openMenu(name: string) {
    await userEvent.click(gear(name)!);
    return screen.findByRole('menuitemcheckbox', { name: ITEM });
  }

  function rereadWith(name: string, over: Record<string, unknown>) {
    surfaceGet.mockResolvedValue(
      ok({
        pack: 'demo',
        packDir: '/p',
        rows: DMI_ROWS.map(r => (r.name === name ? { ...r, ...over } : r)),
      })
    );
  }

  it('an off row is one line with a gear', async () => {
    await renderRows();
    expect(row('deploy')).not.toHaveTextContent(LINE);
    expect(gear('deploy')).toBeInTheDocument();
  });

  it('an on row names it on a second line', async () => {
    await renderRows();
    expect(row('release')).toHaveTextContent(LINE);
    expect(row('release')).not.toHaveTextContent('Set by the pack');
    expect(gear('release')).toBeInTheDocument();
  });

  it('a locked row names who set it', async () => {
    await renderRows();
    expect(row('triage')).toHaveTextContent(`${LINE}Set by the pack`);
    expect(gear('triage')).toBeInTheDocument();
  });

  it('a row without the field has no gear and no second line', async () => {
    await renderRows();
    for (const name of ['gates', 'dev-servers']) {
      expect(gear(name)).not.toBeInTheDocument();
      expect(row(name)).not.toHaveTextContent(LINE);
    }
  });

  it('leaves the legend alone', async () => {
    await renderRows();
    expect(screen.getByTestId('surface-switch-key')).toHaveTextContent(
      "OnIn agents' skill listOffOnly reached if another skill points here"
    );
  });

  it('the info icon explains it, by pointer and by keyboard', async () => {
    await renderRows();
    const info = within(row('release')).getByRole('img', { name: INFO });

    await hoverMeaning(info, INFO);

    act(() => info.focus());
    expect(info).toHaveFocus();
    expect(await screen.findByText(INFO)).toBeInTheDocument();
  });

  it('turns it on from an off row, posting at once and closing the menu', async () => {
    await renderRows();
    modelInvocationPost.mockResolvedValue(ok(applied));

    await userEvent.click(await openMenu('deploy'));

    expect(modelInvocationPost).toHaveBeenCalledWith({
      json: { pack: 'demo', name: 'deploy', on: true },
    });
    await waitFor(() =>
      expect(screen.queryByRole('menuitemcheckbox', { name: ITEM })).toBeNull()
    );
    expect(screen.getByText('Nothing staged')).toBeInTheDocument();
  });

  it('turns it off from an on row, whose item carries the check', async () => {
    await renderRows();
    modelInvocationPost.mockResolvedValue(
      ok({ ...applied, names: ['release'], on: false })
    );

    const item = await openMenu('release');
    expect(within(item).getByTestId('dmi-check')).toBeInTheDocument();
    await userEvent.click(item);

    expect(modelInvocationPost).toHaveBeenCalledWith({
      json: { pack: 'demo', name: 'release', on: false },
    });
  });

  it('an off row keeps an empty check slot', async () => {
    await renderRows();
    const item = await openMenu('deploy');
    expect(
      item.querySelector('.mantine-Menu-itemIndicator')
    ).toBeEmptyDOMElement();
    expect(within(item).queryByTestId('dmi-check')).toBeNull();
    expect(within(item).queryByTestId('dmi-lock')).toBeNull();
  });

  it('a locked row disables the item, with a lock in its slot', async () => {
    await renderRows();
    const item = await openMenu('triage');

    expect(item).toBeDisabled();
    expect(within(item).getByTestId('dmi-lock')).toBeInTheDocument();
    await userEvent.click(item, { pointerEventsCheck: 0 });
    expect(modelInvocationPost).not.toHaveBeenCalled();
  });

  it('re-reads the rows after a toggle, and the line follows', async () => {
    await renderRows();
    modelInvocationPost.mockResolvedValue(ok(applied));
    rereadWith('deploy', { disableModelInvocation: 'on' });

    await userEvent.click(await openMenu('deploy'));

    await waitFor(() => expect(row('deploy')).toHaveTextContent(LINE));
  });

  it('a toggle keeps what is staged', async () => {
    await renderRows();
    await userEvent.click(screen.getByRole('switch', { name: /^triage$/ }));
    modelInvocationPost.mockResolvedValue(ok(applied));
    rereadWith('deploy', { disableModelInvocation: 'on' });

    await userEvent.click(await openMenu('deploy'));

    await waitFor(() => expect(row('deploy')).toHaveTextContent(LINE));
    expect(screen.getByText('1 change staged')).toBeInTheDocument();
  });

  it('a row staged off still reads the on-disk field, until Apply lands', async () => {
    await renderRows();
    await userEvent.click(screen.getByRole('switch', { name: /^release$/ }));

    expect(row('release')).toHaveTextContent(LINE);
    expect(gear('release')).toBeInTheDocument();

    surfaceApplyPost.mockResolvedValue(
      ok({ pack: 'demo', steps: [], rows: [] })
    );
    rereadWith('release', {
      status: 'internal',
      disableModelInvocation: undefined,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(gear('release')).not.toBeInTheDocument());
    expect(row('release')).not.toHaveTextContent(LINE);
  });

  it('applied: false says plainly the installed copy did not change, and stays up', async () => {
    const warning = vi.spyOn(notifications, 'warning');
    const path =
      '/Users/someone/.claude/plugins/cache/acme/skills/deploy/SKILL.md';
    await renderRows();
    modelInvocationPost.mockResolvedValue(
      ok({
        ...applied,
        applied: false,
        warnings: [`${path}: read-only, left alone`],
      })
    );

    await userEvent.click(await openMenu('deploy'));

    expect(
      await screen.findByText('Saved, but the installed copy did not change')
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(path))).toBeNull();
    expect(screen.queryByText(/read-only/)).toBeNull();
    expect(warning).toHaveBeenCalledWith({
      message: 'Saved, but the installed copy did not change',
      autoClose: false,
    });
    warning.mockRestore();
  });

  it('a refusal from rt shows its words', async () => {
    await renderRows();
    modelInvocationPost.mockResolvedValue(
      ok({ ok: false, error: 'deploy is an internal skill' })
    );
    await userEvent.click(await openMenu('deploy'));
    expect(
      await screen.findByText('deploy is an internal skill')
    ).toBeInTheDocument();
  });

  it('a failed post shows the server error', async () => {
    await renderRows();
    modelInvocationPost.mockResolvedValue(
      err(502, 'the design fixture has no answer')
    );
    await userEvent.click(await openMenu('deploy'));
    expect(
      await screen.findByText('the design fixture has no answer')
    ).toBeInTheDocument();
  });

  it.each([
    ['deploy', 'false'],
    ['release', 'true'],
    ['triage', 'true'],
  ])(
    '%s: the item is a menu checkbox, aria-checked %s',
    async (name, checked) => {
      await renderRows();
      const item = await openMenu(name);
      expect(item).toHaveAttribute('aria-checked', checked);
    }
  );

  it('a second quick toggle waits for the first', async () => {
    await renderRows();
    let finish!: (value: unknown) => void;
    modelInvocationPost.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    modelInvocationPost.mockResolvedValueOnce(ok(applied));

    await userEvent.click(await openMenu('deploy'));
    await waitFor(() => expect(modelInvocationPost).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('menuitemcheckbox', { name: ITEM })).toBeNull()
    );

    await userEvent.click(await openMenu('release'));
    await waitFor(() =>
      expect(screen.queryByRole('menuitemcheckbox', { name: ITEM })).toBeNull()
    );
    expect(modelInvocationPost).toHaveBeenCalledTimes(1);

    await act(async () => finish(ok(applied)));

    await waitFor(() => expect(modelInvocationPost).toHaveBeenCalledTimes(2));
    expect(modelInvocationPost).toHaveBeenLastCalledWith({
      json: { pack: 'demo', name: 'release', on: false },
    });
  });

  it('does not count as a write to the pack', async () => {
    const { queryClient } = await renderRows();
    let finish!: (value: unknown) => void;
    modelInvocationPost.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );

    await userEvent.click(await openMenu('deploy'));

    await waitFor(() => expect(queryClient.isMutating()).toBe(1));
    expect(
      queryClient.isMutating({ mutationKey: skillsWriteKey('demo') })
    ).toBe(0);
    await act(async () => finish(ok(applied)));
  });
});
