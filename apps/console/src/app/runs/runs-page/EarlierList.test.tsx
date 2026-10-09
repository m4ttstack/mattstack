import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RunSummary } from '@mattstack/rt-client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import '../../icons';

import { dayGroups } from '../derive/lanes';
import { EarlierList, type EarlierRowInfo } from './EarlierList';
import { at, STORY_NOW, storyRun } from './storyData';

/** One finished work run on each of the nine days up to the boards' day. */
const NINE_DAYS = Array.from({ length: 9 }, (_, i) =>
  storyRun({
    id: `d${i}`,
    ticket: `WEB-${300 + i}`,
    status: 'done',
    started_at: at(9, 0, 8 - i),
    ended_at: at(10, 0, 8 - i),
    evidence_count: 3,
  })
);

const info = (run: RunSummary): EarlierRowInfo => ({
  ticket: run.ticket,
  title: `Title of ${run.ticket}`,
  href: `/runs/${run.repo}/${run.id}`,
  inBoard: false,
  aging: null,
});

function renderList(paged = true) {
  return renderWithProviders(
    <EarlierList
      groups={dayGroups(NINE_DAYS, STORY_NOW)}
      info={info}
      now={STORY_NOW}
      paged={paged}
    />
  );
}

const rows = () => screen.queryAllByTestId(/^run-row-/);

describe('EarlierList', () => {
  it('shows the last 7 days, then a row that adds 7 more', async () => {
    renderList();
    expect(rows()).toHaveLength(7);
    expect(screen.getByTestId('run-row-d6')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-d7')).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: 'Show earlier days' })
    );
    expect(rows()).toHaveLength(9);
    expect(
      screen.queryByRole('button', { name: 'Show earlier days' })
    ).toBeNull();
  });

  it('lists every day when it is not paged', () => {
    renderList(false);
    expect(rows()).toHaveLength(9);
    expect(
      screen.queryByRole('button', { name: 'Show earlier days' })
    ).toBeNull();
  });

  it('keeps a row to its outcome, title, sub line, duration and time', () => {
    renderList();
    const row = screen.getByTestId('run-row-d0');
    expect(row).toHaveTextContent('WEB-300');
    expect(row).toHaveTextContent('Title of WEB-300');
    expect(row).toHaveTextContent('work pipeline');
    expect(row).toHaveTextContent('1h');
    expect(row).not.toHaveTextContent(/decision/);
    expect(row).not.toHaveTextContent(/evidence/);
    expect(row).not.toHaveTextContent('—');
  });
});
