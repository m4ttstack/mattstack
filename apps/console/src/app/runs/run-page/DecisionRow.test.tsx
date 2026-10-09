import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { formatClock } from '../derive/clock';
import { answeredWith, approachQuestion, AT, gateOf } from './decisionFixtures';

const { DecisionRow } = await import('./DecisionRow');

const time = formatClock(AT);

function row(gate = gateOf()) {
  return renderWithProviders(
    <DecisionRow gate={gate} question={approachQuestion} />
  );
}

describe('DecisionRow', () => {
  it('shows the question, the pick without its recommended marker, and who answered when', () => {
    const { getByText, queryByText } = row();
    expect(getByText('Which approach?')).toBeInTheDocument();
    expect(getByText('Backend gap-fill + component work')).toBeInTheDocument();
    expect(queryByText(/\(Recommended\)/i)).toBeNull();
    expect(getByText(`you · ${time}`)).toBeInTheDocument();
  });

  it('reads a shepherd answer as shepherd', () => {
    const { getByText } = row(
      gateOf({ answer: answeredWith({ approach: 'panel' }, 'shepherd') })
    );
    expect(getByText(`shepherd · ${time}`)).toBeInTheDocument();
  });

  it('shows the time alone when the answer has no by', () => {
    const { getByText } = row(
      gateOf({ answer: answeredWith({ approach: 'panel' }, null) })
    );
    expect(getByText(time)).toBeInTheDocument();
  });

  it('names the surface in a tooltip on the stamp', async () => {
    const { getByText, findByText } = row();
    await userEvent.hover(getByText(`you · ${time}`));
    expect(await findByText('Answered in the console')).toBeInTheDocument();
  });

  it('opens the surface tooltip from the keyboard', async () => {
    const { getByText, findByText } = row();
    await userEvent.tab();
    expect(getByText(`you · ${time}`)).toHaveFocus();
    expect(await findByText('Answered in the console')).toBeInTheDocument();
  });

  it('joins a multi-select pick', () => {
    const q = { ...approachQuestion, multi: true };
    const { getByText } = renderWithProviders(
      <DecisionRow
        gate={gateOf({
          questions: [q],
          answer: answeredWith({ approach: ['panel', 'spike'] }),
        })}
        question={q}
      />
    );
    expect(
      getByText('Panel component only, mock the data, Spike first, then decide')
    ).toBeInTheDocument();
  });

  it('expands to the note, the other options and the recommendation mark', async () => {
    const { getByRole, getByText } = row(
      gateOf({
        answer: answeredWith({
          approach: { value: 'panel', note: 'The service is not ready' },
        }),
      })
    );
    const toggle = getByRole('button', { name: 'Show details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(getByText('The service is not ready')).not.toBeVisible();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(getByText('The service is not ready')).toBeVisible()
    );
    expect(getByText('Spike first, then decide')).toBeVisible();
    expect(getByText('Backend gap-fill + component work')).toBeVisible();
    expect(getByText('went against the recommendation')).toBeVisible();
  });

  it('shows the edited reply text when the answer carries one', async () => {
    const { getByRole, getByText } = row(
      gateOf({
        answer: answeredWith({
          approach: { value: 'panel', text: 'Posting this reply instead' },
        }),
      })
    );
    await userEvent.click(getByRole('button', { name: 'Show details' }));
    await waitFor(() =>
      expect(getByText('Posting this reply instead')).toBeVisible()
    );
  });

  it('draws no recommendation mark when the pick took it', async () => {
    const { getByRole, queryByText } = row();
    await userEvent.click(getByRole('button', { name: 'Show details' }));
    expect(queryByText('went against the recommendation')).toBeNull();
  });

  it('draws a closed gate muted with its reason and no expander', () => {
    const { getByText, queryByRole, container } = row(
      gateOf({ status: 'closed', closedReason: 'abandoned', answer: null })
    );
    expect(getByText('closed: abandoned')).toBeInTheDocument();
    expect(queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-muted="true"]')).not.toBeNull();
  });

  it('draws a superseded gate as superseded', () => {
    const { getByText } = row(
      gateOf({ status: 'closed', closedReason: 'superseded', answer: null })
    );
    expect(getByText('superseded')).toBeInTheDocument();
  });

  it('says so when an answered gate skipped this question', () => {
    const { getByText } = row(gateOf({ answer: answeredWith({}) }));
    expect(getByText('No answer recorded')).toBeInTheDocument();
  });

  it('carries the gate and question as an anchor for the side card', () => {
    const { container } = row();
    expect(
      container.querySelector('#decision-g-20261008-0412-approach')
    ).not.toBeNull();
  });
});
