import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RunOutcome } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

const { OutcomeBadge } = await import('./OutcomeBadge');

function badges(outcome: RunOutcome) {
  const { container } = renderWithProviders(<OutcomeBadge outcome={outcome} />);
  return {
    container,
    list: [...container.querySelectorAll<HTMLElement>('[data-outcome]')].map(
      e => [e.dataset.outcome, e.textContent] as const
    ),
  };
}

const merged = (over: Partial<RunOutcome> = {}): RunOutcome => ({
  status: 'done',
  mr: { iid: 405, state: 'merged', url: null },
  ...over,
});

describe('OutcomeBadge', () => {
  it('shows a merged MR with its number', () => {
    expect(badges(merged()).list).toEqual([['merged', 'merged !405']]);
  });

  it('adds a CI badge when CI passed', () => {
    expect(badges(merged({ ci: 'success' })).list).toEqual([
      ['merged', 'merged !405'],
      ['ci-passed', 'CI passed'],
    ]);
  });

  it('adds a CI badge when CI failed', () => {
    expect(badges(merged({ ci: 'failed' })).list).toEqual([
      ['merged', 'merged !405'],
      ['ci-failed', 'CI failed'],
    ]);
  });

  it('leaves out CI while it is still running', () => {
    expect(badges(merged({ ci: 'running' })).list).toEqual([
      ['merged', 'merged !405'],
    ]);
  });

  it('shows abandoned as a neutral badge', () => {
    expect(badges({ status: 'abandoned' }).list).toEqual([
      ['abandoned', 'abandoned'],
    ]);
  });

  it('shows failed', () => {
    expect(badges({ status: 'failed' }).list).toEqual([['failed', 'failed']]);
  });

  it('shows a review with what it posted, in sentence case', () => {
    expect(
      badges({
        status: 'done',
        reviewed: { iid: 412, url: null, posted: 'request changes' },
      }).list
    ).toEqual([['reviewed', 'reviewed !412 · Request changes']]);
  });

  it('shows a review that posted nothing yet as just the MR', () => {
    expect(
      badges({
        status: 'done',
        reviewed: { iid: 412, url: null, posted: null },
      }).list
    ).toEqual([['reviewed', 'reviewed !412']]);
  });

  it('names an open or closed MR on a finished run', () => {
    expect(
      badges({ status: 'done', mr: { iid: 7, state: 'opened', url: null } })
        .list
    ).toEqual([['open', '!7 open']]);
    expect(
      badges({ status: 'done', mr: { iid: 7, state: 'closed', url: null } })
        .list
    ).toEqual([['closed', '!7 closed']]);
  });

  it('renders nothing for an MR whose state is unknown', () => {
    const { container, list } = badges({
      status: 'done',
      mr: { iid: 405, state: 'unknown', url: null },
      ci: 'success',
    });
    expect(list).toEqual([]);
    expect(container.querySelector('[data-outcome]')).toBeNull();
    expect(container.querySelector('[data-parity]')).toBeNull();
  });

  it('renders nothing while the run is running or has no MR', () => {
    expect(badges({ status: 'running' }).list).toEqual([]);
    expect(badges({ status: 'done' }).list).toEqual([]);
  });

  it('carries the board layer names', () => {
    const { container } = badges(merged({ ci: 'success' }));
    const names = [...container.querySelectorAll('[data-parity]')].map(e =>
      e.getAttribute('data-parity')
    );
    expect(names).toEqual([
      'primary',
      'git-merge',
      'label',
      'ci',
      'circle-check',
      'label',
    ]);
  });

  it('names each pill icon after the glyph it draws', () => {
    const names = (outcome: RunOutcome) =>
      [...badges(outcome).container.querySelectorAll('[data-parity]')].map(e =>
        e.getAttribute('data-parity')
      );
    expect(names({ status: 'abandoned' })).toEqual([
      'primary',
      'circle-slash',
      'label',
    ]);
    expect(
      names({
        status: 'done',
        reviewed: { iid: 412, url: null, posted: null },
      })
    ).toEqual(['primary', 'message-square', 'label']);
  });
});
