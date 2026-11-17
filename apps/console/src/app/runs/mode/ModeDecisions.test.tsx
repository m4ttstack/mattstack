import '../../icons';

import type { ReactNode } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModeFeedRow } from '../derive/modeFeed';
import {
  ModePanel,
  ModeRunContext,
  PausedBanner,
  useGateRedo,
} from './ModeDecisions';

const holdPost = vi.fn();
const redoPost = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: {
      runs: {
        ':repo': {
          ':runId': { hold: { $post: (...a: unknown[]) => holdPost(...a) } },
        },
      },
      gates: {
        ':id': { redo: { $post: (...a: unknown[]) => redoPost(...a) } },
      },
    },
  },
}));

afterEach(() => {
  holdPost.mockReset();
  redoPost.mockReset();
});

const ok = () => ({ ok: true, json: async () => ({}) });

const gate = (id: string, stage: string | null, by = 'mode:quiet') =>
  ({
    id,
    subject: 'run:r1',
    kind: 'plan',
    status: 'answered',
    openedAt: 1000,
    meta: stage ? { stage, headCommit: 'abc1234def' } : null,
    questions: [
      {
        id: 'tier',
        label: 'Tier',
        multi: false,
        options: [{ value: 'direct-tdd', label: 'Direct TDD' }],
      },
    ],
    answer: { answers: { tier: 'direct-tdd' }, by, answeredAt: 2000 },
  }) as unknown as GateRow;

const row = (id: string, stage: string): ModeFeedRow => ({
  gate: gate(id, stage),
  mode: 'quiet',
  choice: 'Direct TDD',
  stage,
  headCommit: 'abc1234def',
  answeredAt: 2000,
});

function wrap(node: ReactNode) {
  const qc = new QueryClient();
  return renderWithProviders(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>
  );
}

const panel = (over: Partial<Parameters<typeof ModePanel>[0]> = {}) => (
  <ModePanel
    repo="remote:acme%2Fweb"
    runId="r1"
    mode="quiet"
    rows={[row('g1', 'plan')]}
    canControl
    pause="none"
    stage="implement"
    {...over}
  />
);

describe('ModePanel', () => {
  it('Pause posts to the hold route and reads Pausing… while it is sent', async () => {
    let settle!: (v: unknown) => void;
    holdPost.mockReturnValue(new Promise(r => (settle = r)));
    wrap(panel());
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(holdPost).toHaveBeenCalledWith({
      param: { repo: 'remote:acme%2Fweb', runId: 'r1' },
    });
    expect(await screen.findByText('Pausing…')).toBeTruthy();
    settle(ok());
  });

  it('Redo sends the note for that gate', async () => {
    redoPost.mockResolvedValue(ok());
    wrap(panel({ defaultOpen: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await userEvent.type(
      screen.getByLabelText('What the worker should do differently'),
      'use the shared helper'
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Send back to plan' })
    );
    expect(redoPost).toHaveBeenCalledWith({
      param: { id: 'g1' },
      json: { note: 'use the shared helper' },
    });
    await waitFor(() => expect(screen.queryByTestId('redo-note')).toBeNull());
  });

  it('a refused Redo stays open and says why', async () => {
    redoPost.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'that gate is from an earlier pass of its step',
        code: 'stale',
      }),
    });
    wrap(panel({ defaultOpen: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await userEvent.type(
      screen.getByLabelText('What the worker should do differently'),
      'x'
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Send back to plan' })
    );
    expect(await screen.findByTestId('redo-refused')).toBeTruthy();
    expect(screen.getByTestId('redo-note')).toBeTruthy();
  });

  it('once the Pause request settles, the run state alone says pausing', async () => {
    holdPost.mockResolvedValue(ok());
    wrap(panel());
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    );
    expect(screen.queryByText('Pausing…')).toBeNull();
  });

  it("a late Redo result stays with its own row's note", async () => {
    let settle!: (v: unknown) => void;
    redoPost.mockReturnValue(new Promise(r => (settle = r)));
    wrap(
      panel({
        defaultOpen: true,
        rows: [row('g1', 'plan'), row('g2', 'evidence')],
      })
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Redo' });
    await userEvent.click(first!);
    await userEvent.type(
      screen.getByLabelText('What the worker should do differently'),
      'x'
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Send back to plan' })
    );
    await userEvent.click(second!);
    settle({
      ok: false,
      status: 409,
      json: async () => ({ error: 'stale', code: 'stale' }),
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Send back to evidence' })
      ).toBeTruthy()
    );
    expect(screen.queryByTestId('redo-refused')).toBeNull();
  });

  it('a finished run offers neither Pause nor Redo', () => {
    wrap(panel({ canControl: false, defaultOpen: true }));
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redo' })).toBeNull();
    expect(screen.getByText('Direct TDD')).toBeTruthy();
  });

  it('a paused run shows the paused pill and no Pause', () => {
    wrap(panel({ pause: 'paused' }));
    expect(screen.getByText('paused')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });
});

describe('PausedBanner', () => {
  it('names the step it stops after and the mode it stops answering for', () => {
    wrap(
      <PausedBanner pause="pausing" at={0} stage="watch-ci" mode="normal" />
    );
    expect(
      screen.getByText('Pausing from the console: it stops after watch-ci.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Gates that open now ask you instead of the normal mode.'
      )
    ).toBeTruthy();
  });
});

function StoryRecord({ g }: { g: GateRow }) {
  const redo = useGateRedo(g);
  return (
    <div>
      {redo.canRedo ? <button onClick={redo.toggle}>Redo</button> : null}
      {redo.note}
    </div>
  );
}

describe('useGateRedo', () => {
  const inRun = (node: ReactNode, canControl = true) => (
    <ModeRunContext.Provider
      value={{ repo: 'remote:acme%2Fweb', runId: 'r1', canControl }}
    >
      {node}
    </ModeRunContext.Provider>
  );

  it('offers Redo on a mode-answered gate in a live run', () => {
    wrap(inRun(<StoryRecord g={gate('g1', 'plan')} />));
    expect(screen.getByRole('button', { name: 'Redo' })).toBeTruthy();
  });

  it('offers no Redo on your own answer, a gate with no stage, a finished run or outside a run page', () => {
    wrap(
      <>
        {inRun(<StoryRecord g={gate('g1', 'plan', 'console')} />)}
        {inRun(<StoryRecord g={gate('g2', null)} />)}
        {inRun(<StoryRecord g={gate('g3', 'plan')} />, false)}
        <StoryRecord g={gate('g4', 'plan')} />
      </>
    );
    expect(screen.queryByRole('button', { name: 'Redo' })).toBeNull();
  });
});
