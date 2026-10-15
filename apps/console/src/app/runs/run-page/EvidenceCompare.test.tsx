import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { readEvidence } from '@mattstack/rt-client/evidence';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CompareMode, EvidenceCases } from './evidenceImages';

const { EvidenceCompare } = await import('./EvidenceCompare');
type EvidenceCompareProps = React.ComponentProps<typeof EvidenceCompare>;

const REPO = 'remote:acme%2Fweb';
const RUN = '20261008-1142';
const BASE = `/api/runs/${REPO}/r1/evidence`;

function v1(fields: Record<string, string>): EvidenceCases {
  const parsed = readEvidence(JSON.stringify({ v: 1, ...fields }));
  if (parsed.version !== 2) throw new Error('not cases');
  return parsed;
}

const W = '/fixture/evidence/web-421';
const THREE = readEvidence(
  JSON.stringify({
    v: 2,
    cases: [
      {
        id: 'rush-window',
        label: 'Rush order, same-day window',
        before: {
          path: `${W}/rush-before.png`,
          annotated: `${W}/rush-before-annotated.png`,
          caption: 'Red box: no window',
        },
        after: {
          path: `${W}/rush-after.png`,
          annotated: `${W}/rush-after-annotated.png`,
          caption: 'Red box: window shows',
        },
      },
      {
        id: 'order-card-themes',
        label: 'Order card in light and dark',
        after: {
          light: {
            path: `${W}/l.png`,
            annotated: `${W}/l-annotated.png`,
            caption: 'Arrow: contrast',
          },
          dark: { path: `${W}/d.png`, waiver: 'Same marks as light' },
        },
      },
      {
        id: 'empty-state',
        label: 'No delivery window yet',
        after: { path: `${W}/empty-after.png` },
        waiver: 'Before and after are pixel-identical',
      },
    ],
    attach: 'ship',
  })
) as EvidenceCases;

const BOTH = v1({
  before: '/x/before.png',
  after: '/x/after.png',
  afterAnnotated: '/x/after-annotated.png',
});

function compare(record = BOTH, mode?: CompareMode, onClose = vi.fn()) {
  renderWithProviders(
    <EvidenceCompare
      repo={REPO}
      runId="r1"
      ticket="WEB-409"
      record={record}
      mode={mode}
      onClose={onClose}
    />
  );
  return screen.findByRole('dialog');
}

const srcs = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('img')
    .map(i => i.getAttribute('src'));

describe('EvidenceCompare', () => {
  it('opens side by side, each image under its phase', async () => {
    const dialog = await compare();
    expect(srcs(dialog)).toEqual([
      `${BASE}/case/before`,
      `${BASE}/case/after?annotated=1`,
    ]);
    expect(within(dialog).getByText('WEB-409')).toBeInTheDocument();
  });

  it('has one control with Before, After and Side by side, and no arrows', async () => {
    const dialog = await compare();
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map(r => r.getAttribute('value'))
    ).toEqual(['before', 'after', 'side']);
    expect(
      within(dialog).queryByRole('button', {
        name: /previous|next|earlier|later/i,
      })
    ).toBeNull();
    expect(within(dialog).queryByText('Plain')).toBeNull();
  });

  it('starts on the mode it is asked for and names the file', async () => {
    const dialog = await compare(BOTH, 'after');
    expect(srcs(dialog)).toEqual([`${BASE}/case/after?annotated=1`]);
    expect(within(dialog).getByText('after-annotated.png')).toBeInTheDocument();
  });

  it('switches with the control', async () => {
    const user = userEvent.setup();
    const dialog = await compare();
    await user.click(within(dialog).getByRole('radio', { name: 'Before' }));
    expect(srcs(dialog)).toEqual([`${BASE}/case/before`]);
    await user.click(
      within(dialog).getByRole('radio', { name: 'Side by side' })
    );
    expect(srcs(dialog)).toHaveLength(2);
  });

  it('shows the plain image when it was opened on one', async () => {
    renderWithProviders(
      <EvidenceCompare
        repo={REPO}
        runId="r1"
        ticket="WEB-409"
        record={BOTH}
        mode="after"
        variant="plain"
        onClose={vi.fn()}
      />
    );
    const dialog = await screen.findByRole('dialog');
    expect(srcs(dialog)).toEqual([`${BASE}/case/after`]);
  });

  it('has nothing to switch with one phase', async () => {
    const dialog = await compare(v1({ before: '/x/before.png' }));
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(srcs(dialog)).toEqual([`${BASE}/case/before`]);
  });

  it('starts with focus on its close button, not the control', async () => {
    const dialog = await compare(BOTH, 'side');
    const close = within(dialog).getByRole('button', { name: /close/i });
    await waitFor(() => expect(close).toHaveFocus());
  });

  it('closes from its close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const dialog = await compare(BOTH, undefined, onClose);
    await user.click(within(dialog).getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('EvidenceCompare, one named case', () => {
  it('titles itself with the ticket and the case', async () => {
    renderWithProviders(
      <EvidenceCompare
        repo={REPO}
        runId="r1"
        ticket="WEB-409"
        record={v1({
          before: '/x/before.png',
          after: '/x/after.png',
          case: 'Rush order, Sep 14 delay, Denver',
        })}
        onClose={vi.fn()}
      />
    );
    expect(
      await screen.findByText('WEB-409 · Rush order, Sep 14 delay, Denver')
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Case' })).toBeNull();
  });
});

describe('EvidenceCompare, several cases', () => {
  const open = (p: Partial<EvidenceCompareProps> = {}) =>
    renderWithProviders(
      <EvidenceCompare
        repo={REPO}
        runId={RUN}
        record={THREE}
        ticket="WEB-421"
        onClose={vi.fn()}
        {...p}
      />
    );

  it('titles itself with the ticket and offers every case', async () => {
    open();
    expect(await screen.findByText('WEB-421')).toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Case' });
    expect(picker).toHaveValue('Rush order, same-day window');
  });

  it('shows the theme control only for a case with both themes', async () => {
    open();
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
    cleanup();
    open({ caseId: 'order-card-themes', theme: 'dark', mode: 'after' });
    expect(
      await screen.findByRole('radiogroup', { name: 'Theme' })
    ).toBeInTheDocument();
    expect(screen.getByText('Waived: Same marks as light')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/api/runs/remote:acme%2Fweb/20261008-1142/evidence/order-card-themes/after?theme=dark'
    );
  });

  it('opens the first case for an unknown case and light for an absent theme', async () => {
    open({ caseId: 'gone', theme: 'dark', mode: 'side' });
    expect(await screen.findByRole('combobox', { name: 'Case' })).toHaveValue(
      'Rush order, same-day window'
    );
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
    expect(screen.getAllByRole('img').map(i => i.getAttribute('src'))).toEqual([
      `/api/runs/${REPO}/${RUN}/evidence/rush-window/before?annotated=1`,
      `/api/runs/${REPO}/${RUN}/evidence/rush-window/after?annotated=1`,
    ]);
  });

  it('shows the light shot, with no theme control, when dark is asked of a light-only slot', async () => {
    const lightOnly = readEvidence(
      JSON.stringify({
        v: 2,
        cases: [
          {
            id: 'card',
            label: 'Order card',
            after: { light: { path: `${W}/l.png` } },
          },
        ],
      })
    ) as EvidenceCases;
    open({ record: lightOnly, theme: 'dark', mode: 'after' });
    await screen.findByRole('img');
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      `/api/runs/${REPO}/${RUN}/evidence/card/after?theme=light`
    );
  });

  it('keeps the mode when the new case has it, else takes its last', async () => {
    const onShow = vi.fn();
    open({ mode: 'side', onShow });
    await userEvent.click(screen.getByRole('combobox', { name: 'Case' }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'No delivery window yet' })
    );
    expect(onShow).toHaveBeenLastCalledWith({
      caseId: 'empty-state',
      mode: 'after',
    });
  });

  it('steps through the cases with the arrow keys, stopping at each end', async () => {
    open();
    const picker = await screen.findByRole('combobox', { name: 'Case' });
    await userEvent.keyboard('{ArrowLeft}');
    expect(picker).toHaveValue('Rush order, same-day window');
    await userEvent.keyboard('{ArrowRight}');
    expect(picker).toHaveValue('Order card in light and dark');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(picker).toHaveValue('No delivery window yet');
    await userEvent.keyboard('{ArrowLeft}');
    expect(picker).toHaveValue('Order card in light and dark');
  });

  it('leaves the arrow keys to a focused control', async () => {
    open({ caseId: 'order-card-themes', mode: 'after' });
    const picker = await screen.findByRole('combobox', { name: 'Case' });
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(picker).toHaveValue('Order card in light and dark');
  });

  it('writes the caption under each frame side by side', async () => {
    open({ mode: 'side' });
    expect(await screen.findByText('Red box: no window')).toBeInTheDocument();
    expect(screen.getByText('Red box: window shows')).toBeInTheDocument();
  });

  it('titles a v1 run that named no case with the ticket alone', async () => {
    renderWithProviders(
      <EvidenceCompare
        repo={REPO}
        runId={RUN}
        ticket="WEB-409"
        onClose={vi.fn()}
        record={v1({ before: '/a/b.png', after: '/a/c.png' })}
      />
    );
    expect(await screen.findByText('WEB-409')).toBeInTheDocument();
  });
});

describe('useCompareLink', () => {
  async function linked(path: string) {
    const { memoryLocation } = await import('wouter/memory-location');
    const { Router } = await import('wouter');
    const { useCompareLink } = await import('./EvidenceCompare');
    const mem = memoryLocation({ path, record: true });
    let link!: ReturnType<typeof useCompareLink>;
    function Probe() {
      link = useCompareLink();
      return null;
    }
    renderWithProviders(
      <Router hook={mem.hook} searchHook={mem.searchHook}>
        <Probe />
      </Router>
    );
    return { mem, link: () => link };
  }

  it('reads the mode, case and theme a link names', async () => {
    const { link } = await linked(
      '/r?compare=after&case=order-card-themes&theme=dark'
    );
    expect(link().open).toEqual({
      mode: 'after',
      caseId: 'order-card-themes',
      theme: 'dark',
    });
  });

  it('opens nothing for a compare value that is not a mode', async () => {
    const { link } = await linked('/r?compare=nope&case=x');
    expect(link().open).toBeNull();
    expect(link().asked).toBe('nope');
  });

  it('writes what the modal shows back, and drops all three on clear', async () => {
    const { mem, link } = await linked('/r?tab=evidence&compare=side');
    act(() => link().sync({ caseId: 'empty-state', mode: 'after' }));
    await waitFor(() =>
      expect(mem.history?.at(-1)).toBe(
        '/r?tab=evidence&compare=after&case=empty-state'
      )
    );
    act(() =>
      link().sync({ caseId: 'order-card-themes', mode: 'after', theme: 'dark' })
    );
    await waitFor(() => expect(link().open?.theme).toBe('dark'));
    act(() => link().clear());
    await waitFor(() => expect(link().open).toBeNull());
    expect(mem.history?.at(-1)).toBe('/r?tab=evidence');
  });

  it('writes nothing while the link has no compare', async () => {
    const { mem, link } = await linked('/r?tab=story');
    act(() => link().sync({ caseId: 'a', mode: 'after' }));
    expect(mem.history?.at(-1)).toBe('/r?tab=story');
  });
});
