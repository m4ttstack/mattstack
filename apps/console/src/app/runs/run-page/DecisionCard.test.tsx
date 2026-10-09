import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { formatClock } from '../derive/clock';
import {
  answeredWith,
  approachQuestion,
  AT,
  FINDINGS_CONTEXT,
  gateOf,
  PROSE_CONTEXT,
} from './decisionFixtures';

const { DecisionCard } = await import('./DecisionCard');

const time = formatClock(AT);

function card(gate = gateOf()) {
  return renderWithProviders(<DecisionCard gate={gate} />);
}

function optionsOf(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-option]')].map(
    o => [o.dataset.option, o.dataset.picked === 'true', o.textContent] as const
  );
}

describe('DecisionCard', () => {
  it('lists every option with the pick highlighted and the recommended one badged', () => {
    const { container, getAllByText } = card();
    expect(optionsOf(container)).toEqual([
      [
        'backend',
        true,
        expect.stringContaining('Backend gap-fill + component work'),
      ],
      ['panel', false, 'Panel component only, mock the data'],
      ['spike', false, 'Spike first, then decide'],
    ]);
    expect(getAllByText('recommended')).toHaveLength(1);
    expect(container.textContent).not.toContain('(Recommended)');
  });

  it('marks the pick as selected for assistive tech', () => {
    const { container } = card();
    const picked = container.querySelector('[data-option="backend"]');
    expect(picked).toHaveAttribute('aria-current', 'true');
    expect(picked).toHaveTextContent('selected');
    const other = container.querySelector('[data-option="panel"]');
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).not.toHaveTextContent('selected');
  });

  it('shows who answered and when', () => {
    const { getByText } = card();
    expect(getByText(`you · ${time}`)).toBeInTheDocument();
  });

  it('badges an answer that overrode the recommendation', () => {
    const { getByText, queryByText } = card(
      gateOf({ answer: answeredWith({ approach: 'panel' }) })
    );
    expect(getByText('overrode recommendation')).toBeInTheDocument();
    expect(queryByText('went against the recommendation')).toBeNull();
  });

  it('has no override badge when the pick took the recommendation', () => {
    expect(card().queryByText('overrode recommendation')).toBeNull();
  });

  it('shows the note', () => {
    const { getByText } = card(
      gateOf({
        answer: answeredWith({
          approach: { value: 'panel', note: 'Hourly matters for rush orders' },
        }),
      })
    );
    expect(getByText('Hourly matters for rush orders')).toBeInTheDocument();
  });

  it('shows an edited reply text', () => {
    const { getByText } = card(
      gateOf({
        answer: answeredWith({
          approach: { value: 'panel', text: 'Posting this reply instead' },
        }),
      })
    );
    expect(getByText('Posting this reply instead')).toBeInTheDocument();
  });

  it('keeps prose context collapsed behind its line count, rendered as markdown', async () => {
    const { getByRole, getByTestId } = card(gateOf({ context: PROSE_CONTEXT }));
    const toggle = getByRole('button', { name: /What the agent found/ });
    expect(toggle).toHaveTextContent('4 lines');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(getByTestId('gate-context-body')).not.toBeVisible();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(getByTestId('gate-context-body')).toBeVisible());
    expect(
      getByTestId('gate-context-body').querySelectorAll('li')
    ).toHaveLength(2);
  });

  it('shows structured context as its summary line over a collapsed monospace block, never markdown', async () => {
    const { getByRole, container, queryByTestId } = card(
      gateOf({ context: FINDINGS_CONTEXT })
    );
    const toggle = getByRole('button', { name: /What the agent found/ });
    expect(toggle).toHaveTextContent('2 findings');
    expect(queryByTestId('gate-context-body')).toBeNull();
    const code = container.querySelector('pre');
    expect(code).not.toBeNull();
    expect(code).not.toBeVisible();

    await userEvent.click(toggle);

    await waitFor(() => expect(code).toBeVisible());
    expect(code).toHaveTextContent('"gate-ctx": "findings@1"');
  });

  it('shows a question’s own context under that question', async () => {
    const q = { ...approachQuestion, context: PROSE_CONTEXT };
    const { getByRole } = card(gateOf({ questions: [q] }));
    const toggle = getByRole('button', { name: /What this turns on/ });
    expect(toggle).toHaveTextContent('4 lines');
  });

  it('has no context toggle when the gate has none', () => {
    expect(card().queryByRole('button')).toBeNull();
  });

  it('draws one block per question, with the stamp once', () => {
    const second = {
      id: 'scope',
      label: 'Scope',
      multi: false,
      options: ['both', 'one'],
    };
    const { getAllByText, getByText } = card(
      gateOf({
        questions: [approachQuestion, second],
        answer: answeredWith({ approach: 'backend', scope: 'both' }),
      })
    );
    expect(getByText('Which approach?')).toBeInTheDocument();
    expect(getByText('Scope')).toBeInTheDocument();
    expect(getAllByText(`you · ${time}`)).toHaveLength(1);
  });

  it('draws a closed gate muted with its reason and no pick', () => {
    const { getByText, container } = card(
      gateOf({ status: 'closed', closedReason: 'abandoned', answer: null })
    );
    expect(getByText('closed: abandoned')).toBeInTheDocument();
    expect(container.querySelector('[data-muted="true"]')).not.toBeNull();
    expect(container.querySelector('[data-picked="true"]')).toBeNull();
  });

  it('draws a superseded gate as superseded', () => {
    const { getByText } = card(
      gateOf({ status: 'closed', closedReason: 'superseded', answer: null })
    );
    expect(getByText('superseded')).toBeInTheDocument();
  });
});
