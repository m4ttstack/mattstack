import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { parseEvidence } from '@mattstack/rt-client/evidence';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CompareMode, EvidenceV1Parsed } from './evidenceImages';

const { EvidenceCompare } = await import('./EvidenceCompare');

const REPO = 'remote:acme%2Fweb';
const BASE = `/api/runs/${REPO}/r1/evidence`;

function v1(fields: Record<string, string>): EvidenceV1Parsed {
  const parsed = parseEvidence(JSON.stringify({ v: 1, ...fields }));
  if (parsed.version !== 1) throw new Error('not v1');
  return parsed;
}

const BOTH = v1({
  before: '/x/before.png',
  after: '/x/after.png',
  afterAnnotated: '/x/after-annotated.png',
});

function compare(evidence = BOTH, mode?: CompareMode, onClose = vi.fn()) {
  renderWithProviders(
    <EvidenceCompare
      repo={REPO}
      runId="r1"
      title="WEB-409"
      evidence={evidence}
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
    expect(srcs(dialog)).toEqual([`${BASE}/before`, `${BASE}/afterAnnotated`]);
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
    expect(srcs(dialog)).toEqual([`${BASE}/afterAnnotated`]);
    expect(within(dialog).getByText('after-annotated.png')).toBeInTheDocument();
  });

  it('switches with the control', async () => {
    const user = userEvent.setup();
    const dialog = await compare();
    await user.click(within(dialog).getByRole('radio', { name: 'Before' }));
    expect(srcs(dialog)).toEqual([`${BASE}/before`]);
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
        title="WEB-409"
        evidence={BOTH}
        mode="after"
        variant="plain"
        onClose={vi.fn()}
      />
    );
    const dialog = await screen.findByRole('dialog');
    expect(srcs(dialog)).toEqual([`${BASE}/after`]);
  });

  it('has nothing to switch with one phase', async () => {
    const dialog = await compare(v1({ before: '/x/before.png' }));
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(srcs(dialog)).toEqual([`${BASE}/before`]);
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
