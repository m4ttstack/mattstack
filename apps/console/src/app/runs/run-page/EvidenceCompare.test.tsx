import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { parseEvidence } from '@mattstack/rt-client/evidence';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { EvidenceV1Parsed } from './evidenceImages';

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

function compare(evidence = BOTH, initialPhase?: 'before' | 'after') {
  return renderWithProviders(
    <EvidenceCompare
      repo={REPO}
      runId="r1"
      evidence={evidence}
      initialPhase={initialPhase}
    />
  );
}

function src(container: HTMLElement) {
  return container.querySelector('img')?.getAttribute('src');
}

describe('EvidenceCompare', () => {
  it('starts on Before and names the file', () => {
    const { container, getByText } = compare();
    expect(src(container)).toBe(`${BASE}/before`);
    expect(getByText('before.png')).toBeInTheDocument();
  });

  it('starts on the phase it is asked for', () => {
    const { container } = compare(BOTH, 'after');
    expect(src(container)).toBe(`${BASE}/afterAnnotated`);
  });

  it('flips with the Before/After toggle', async () => {
    const user = userEvent.setup();
    const { container, getByText } = compare();
    await user.click(getByText('After'));
    expect(src(container)).toBe(`${BASE}/afterAnnotated`);
    await user.click(getByText('Before'));
    expect(src(container)).toBe(`${BASE}/before`);
  });

  it('flips with the arrows, which stop at the ends', async () => {
    const user = userEvent.setup();
    const { container, getByRole } = compare();
    expect(getByRole('button', { name: 'Nothing earlier' })).toBeDisabled();
    await user.click(getByRole('button', { name: 'Show after' }));
    expect(src(container)).toBe(`${BASE}/afterAnnotated`);
    expect(getByRole('button', { name: 'Nothing later' })).toBeDisabled();
    await user.click(getByRole('button', { name: 'Show before' }));
    expect(src(container)).toBe(`${BASE}/before`);
  });

  it('offers Plain and Annotated only where both exist', async () => {
    const user = userEvent.setup();
    const { container, getByText, queryByText } = compare();
    expect(queryByText('Plain')).toBeNull();
    await user.click(getByText('After'));
    await user.click(getByText('Plain'));
    expect(src(container)).toBe(`${BASE}/after`);
  });

  it('has nothing to flip to with one phase', () => {
    const { queryByText, getByRole } = compare(v1({ before: '/x/before.png' }));
    expect(queryByText('After')).toBeNull();
    expect(getByRole('button', { name: 'Nothing later' })).toBeDisabled();
    expect(getByRole('button', { name: 'Nothing earlier' })).toBeDisabled();
  });
});
