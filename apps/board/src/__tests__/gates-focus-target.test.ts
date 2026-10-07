import { describe, expect, it } from 'bun:test';

import { resolveGateFocusTarget } from '../gates/focus-target.ts';

const ORIGIN = {
  paneId: 'wTT:p2',
  tabId: 'wTT:t2',
  worktree: '/wt/a',
};

describe('resolveGateFocusTarget', () => {
  it("focuses the origin pane while it's live", () => {
    expect(
      resolveGateFocusTarget(ORIGIN, [{ paneId: 'wTT:p2' }], [])
    ).toEqual({ ok: true, paneId: 'wTT:p2', tabId: 'wTT:t2' });
  });

  it("falls back to the MR's live lane pane once the origin pane has closed", () => {
    expect(
      resolveGateFocusTarget(
        ORIGIN,
        [{ paneId: 'wVK:p4', cwd: '/repo' }],
        [{ paneId: 'wVK:p4', tabId: 'wVK:t4' }]
      )
    ).toEqual({ ok: true, paneId: 'wVK:p4', tabId: 'wVK:t4' });
  });

  it('skips a lane whose pane is gone too', () => {
    expect(
      resolveGateFocusTarget(
        ORIGIN,
        [{ paneId: 'wVK:p5' }],
        [
          { paneId: 'wXX:p1', tabId: 'wXX:t1' },
          { paneId: 'wVK:p5', tabId: 'wVK:t5' },
        ]
      )
    ).toEqual({ ok: true, paneId: 'wVK:p5', tabId: 'wVK:t5' });
  });

  it('falls back to a live pane in the origin worktree', () => {
    expect(
      resolveGateFocusTarget(ORIGIN, [{ paneId: 'w1:p9', cwd: '/wt/a' }], [])
    ).toEqual({ ok: true, paneId: 'w1:p9' });
  });

  it('says the pane closed when nothing live is left, never handing back the dead ids', () => {
    expect(resolveGateFocusTarget(ORIGIN, [], [])).toEqual({
      ok: false,
      reason: 'the pane that asked this has closed',
    });
  });

  it('trusts the origin ids when the pane list could not be read', () => {
    expect(resolveGateFocusTarget(ORIGIN, null, [])).toEqual({
      ok: true,
      paneId: 'wTT:p2',
      tabId: 'wTT:t2',
    });
  });

  it('says it could not list panes when there is only a worktree to match', () => {
    expect(resolveGateFocusTarget({ worktree: '/wt/a' }, null, [])).toEqual({
      ok: false,
      reason: 'could not list panes to match the origin worktree',
    });
  });

  it('reports a gate with no origin and no lane', () => {
    expect(resolveGateFocusTarget(undefined, [], [])).toEqual({
      ok: false,
      reason: 'no origin on this gate',
    });
  });
});
