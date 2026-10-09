import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { describe, expect, it } from 'vitest';

import {
  AT,
  FINDINGS_CONTEXT,
  gateOf,
  PROSE_CONTEXT,
  reviewQuestion,
} from './decisionFixtures';

const { HandoffCard } = await import('./HandoffCard');

const waiting = (over = {}) =>
  gateOf({
    subject: 'mr:acme/web!412',
    kind: 'review-post',
    questions: [reviewQuestion],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: AT - 2 * 60_000,
    context: FINDINGS_CONTEXT,
    ...over,
  });

const BOARD = 'http://localhost:11006/?gate=g-20261008-0412';

function card(gate = waiting(), boardUrl: string | null = BOARD) {
  return renderWithProviders(
    <HandoffCard gate={gate} boardUrl={boardUrl} now={AT} />
  );
}

describe('HandoffCard', () => {
  it('heads the card with the gate kind and where it is waiting', () => {
    const { getByText } = card();
    expect(getByText('Review post · waiting in the board')).toBeInTheDocument();
    expect(getByText('opened 2m ago')).toBeInTheDocument();
  });

  it('shows the question with its options as numbered read-only chips', () => {
    const { getByText, container, getAllByText } = card();
    expect(getByText('What should the review post?')).toBeInTheDocument();
    const chips = [
      ...container.querySelectorAll<HTMLElement>('[data-option]'),
    ].map(c => c.textContent);
    expect(chips).toEqual([
      '1Approve',
      '2Request changesrecommended',
      '3Comment only',
    ]);
    expect(getAllByText('recommended')).toHaveLength(1);
  });

  it('summarises a structured context on one line', () => {
    const { getByText } = card();
    expect(getByText('findings@1 · 2 findings')).toBeInTheDocument();
  });

  it('draws no summary line for a prose context or none', () => {
    expect(
      card(waiting({ context: PROSE_CONTEXT })).container.querySelector(
        '[data-summary]'
      )
    ).toBeNull();
    expect(
      card(waiting({ context: null })).container.querySelector('[data-summary]')
    ).toBeNull();
  });

  it('links to the board when there is a url', () => {
    const { getByRole } = card();
    const link = getByRole('link', { name: /Answer in the board/ });
    expect(link).toHaveAttribute('href', BOARD);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('is plain muted text when there is no url', () => {
    const { getByText, queryByRole } = card(waiting(), null);
    expect(getByText('Answer in the board')).toBeInTheDocument();
    expect(queryByRole('link')).toBeNull();
  });

  it('refuses a url that is not http or https', () => {
    const { queryByRole } = card(waiting(), 'javascript:alert(1)');
    expect(queryByRole('link')).toBeNull();
  });

  it('offers no way to answer here', () => {
    const { queryByRole } = card(waiting(), null);
    expect(queryByRole('radio')).toBeNull();
    expect(queryByRole('checkbox')).toBeNull();
    expect(queryByRole('button')).toBeNull();
  });

  it('shows every question', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...reviewQuestion,
      id: `thread-${i}`,
      label: `Thread ${i}`,
    }));
    const { getByText } = card(waiting({ questions: many }));
    for (let i = 0; i < 6; i++)
      expect(getByText(`Thread ${i}`)).toBeInTheDocument();
  });
});
