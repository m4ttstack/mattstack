import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { describe, expect, it } from 'vitest';

import type { RailStage } from '../derive/stages';

const { StageRail } = await import('./StageRail');

const stage = (
  name: string,
  status: RailStage['status'],
  durationMs: number | null = null,
  attempts = status === 'not-started' ? 0 : 1
): RailStage => ({ name, status, durationMs, attempts });

const MIN = 60_000;

const stages: RailStage[] = [
  stage('provision', 'done', MIN),
  stage('plan', 'done', MIN),
  stage('implement', 'running'),
  stage('self-review', 'not-started'),
];

function columns(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-stage]')];
}

describe('StageRail', () => {
  it('draws one column per stage, in order, with its status', () => {
    const { container } = renderWithProviders(
      <StageRail stages={stages} gateCounts={{}} />
    );
    expect(
      columns(container).map(c => [c.dataset.stage, c.dataset.status])
    ).toEqual([
      ['provision', 'done'],
      ['plan', 'done'],
      ['implement', 'running'],
      ['self-review', 'not-started'],
    ]);
  });

  it('keys only the layers the board paints: the bar, the glyphs and the text', () => {
    const { container } = renderWithProviders(
      <StageRail stages={stages} gateCounts={{}} />
    );
    expect(
      [...container.querySelectorAll('[data-stage]')].map(e =>
        e.getAttribute('data-stage')
      )
    ).toEqual(['provision', 'plan', 'implement', 'self-review']);
    const first = container.querySelector('[data-stage="provision"]')!;
    expect(first.hasAttribute('data-parity')).toBe(false);
    expect(first.querySelector('[data-parity="bar"]')).not.toBeNull();
    expect(first.querySelector('[data-parity="check"]')).not.toBeNull();
    expect(first.querySelector('[data-parity="provision"]')).not.toBeNull();
    expect(first.querySelector('[data-parity="lab"]')).toBeNull();
    const running = container.querySelector('[data-stage="implement"]')!;
    expect(running.querySelector('[data-parity="live"]')).not.toBeNull();
  });

  it('shows the duration, and a dash while a stage has none', () => {
    const { container } = renderWithProviders(
      <StageRail stages={stages} gateCounts={{}} />
    );
    const meta = (name: string) =>
      container.querySelector(`[data-stage="${name}"] [data-part="meta"]`)!
        .textContent;
    expect(meta('provision')).toBe('1m');
    expect(meta('self-review')).toBe('—');
  });

  it('shows the gate count under a stage that has gates', () => {
    const { container } = renderWithProviders(
      <StageRail stages={stages} gateCounts={{ plan: 3 }} />
    );
    const gates = container.querySelector(
      '[data-stage="plan"] [data-part="gates"]'
    );
    expect(gates?.textContent).toBe('3');
    expect(
      container.querySelector('[data-stage="provision"] [data-part="gates"]')
    ).toBeNull();
  });

  it('shows an attempt count past the first', () => {
    const { container } = renderWithProviders(
      <StageRail stages={[stage('plan', 'done', MIN, 2)]} gateCounts={{}} />
    );
    expect(
      container.querySelector('[data-stage="plan"]')!.textContent
    ).toContain('×2');
  });

  it('mutes a stage that has not started', () => {
    const { container } = renderWithProviders(
      <StageRail stages={stages} gateCounts={{}} />
    );
    const label = container.querySelector(
      '[data-stage="self-review"] [data-parity="self-review"]'
    )!;
    expect(label).toHaveAttribute('data-muted', 'true');
    const done = container.querySelector(
      '[data-stage="plan"] [data-parity="plan"]'
    )!;
    expect(done).not.toHaveAttribute('data-muted');
  });

  it('says what a waiting stage is waiting on', () => {
    const { container } = renderWithProviders(
      <StageRail stages={[stage('plan', 'waiting', 4 * MIN)]} gateCounts={{}} />
    );
    expect(
      container.querySelector('[data-stage="plan"] [data-part="lab"]')!
        .textContent
    ).toBe('plan · waiting on you');
  });

  it('draws a running stage as done once the run has finished', () => {
    const { container } = renderWithProviders(
      <StageRail stages={stages} gateCounts={{}} finished />
    );
    expect(
      container.querySelector('[data-stage="implement"]')!
    ).toHaveAttribute('data-status', 'done');
  });

  it('keeps a failed stage failed on a finished run', () => {
    const { container } = renderWithProviders(
      <StageRail
        stages={[stage('ship', 'failed', MIN)]}
        gateCounts={{}}
        finished
      />
    );
    expect(container.querySelector('[data-stage="ship"]')).toHaveAttribute(
      'data-status',
      'failed'
    );
  });

  it('compact draws bars only, named seg <stage>', () => {
    const { container } = renderWithProviders(
      <StageRail stages={stages} gateCounts={{ plan: 2 }} compact />
    );
    expect(
      [...container.querySelectorAll('[data-parity^="seg "]')].map(e =>
        e.getAttribute('data-parity')
      )
    ).toEqual([
      'seg provision',
      'seg plan',
      'seg implement',
      'seg self-review',
    ]);
    expect(container.querySelector('[data-part="lab"]')).toBeNull();
    expect(container.querySelector('[data-part="meta"]')).toBeNull();
    expect(
      container.querySelector('[data-part="compact-rail"]')!.textContent
    ).toBe('');
  });

  it('renders nothing without stages', () => {
    const { container } = renderWithProviders(
      <StageRail stages={[]} gateCounts={{}} />
    );
    expect(container.querySelector('[data-part="rail"]')).toBeNull();
    expect(container.querySelector('[data-part="compact-rail"]')).toBeNull();
  });
});
