import { describe, expect, test } from 'vitest';

import {
  agentState,
  isRoomForRepo,
  paneLocation,
  stateLine,
} from './agent-state';

describe('agentState', () => {
  test('a signed-out buddy is offline whatever herdr last said', () => {
    expect(agentState({ status: 'offline', agentStatus: 'working' })).toBe(
      'offline'
    );
  });

  test("herdr's own state wins over presence", () => {
    expect(agentState({ status: 'idle', agentStatus: 'blocked' })).toBe(
      'blocked'
    );
    expect(agentState({ status: 'idle', agentStatus: 'working' })).toBe(
      'working'
    );
    expect(agentState({ status: 'live', agentStatus: 'done' })).toBe('done');
    expect(agentState({ status: 'live', agentStatus: 'idle' })).toBe('done');
  });

  test('with no pane, or an unknown herdr state, presence decides', () => {
    expect(agentState({ status: 'live' })).toBe('working');
    expect(agentState({ status: 'idle' })).toBe('done');
    expect(agentState({ status: 'live', agentStatus: 'unknown' })).toBe(
      'working'
    );
  });
});

describe('paneLocation', () => {
  test('workspace and tab read as one path', () => {
    expect(
      paneLocation({ paneWorkspace: 'rt', paneTab: 'loosening mcp rules' })
    ).toBe('rt › loosening mcp rules');
  });

  test("herdr's numbered default tab label is dropped", () => {
    expect(paneLocation({ paneWorkspace: 'rt', paneTab: '7' })).toBe('rt');
  });

  test('no workspace means no pane to describe', () => {
    expect(paneLocation({ paneTab: 'orphan' })).toBeUndefined();
  });
});

describe('stateLine', () => {
  test('a signed-in agent reads its state word and no age', () => {
    expect(stateLine({ status: 'idle', agentStatus: 'blocked' }, 0)).toBe(
      'Waiting on you'
    );
    expect(stateLine({ status: 'live' }, 0)).toBe('Working');
  });

  test('a signed-out agent reads how long ago it left', () => {
    expect(stateLine({ status: 'offline', signedOutAt: 60_000 }, 660_000)).toBe(
      'Signed out · 10m ago'
    );
  });
});

describe('isRoomForRepo', () => {
  test("a repo's slug or a path-kind repo's two-segment room both match", () => {
    expect(isRoomForRepo('rt', 'rt')).toBe(true);
    expect(isRoomForRepo('my-app', 'My App')).toBe(true);
    expect(isRoomForRepo('pool-gamma', 'gamma')).toBe(true);
  });

  test('another repo does not', () => {
    expect(isRoomForRepo('rt', 'acme-api')).toBe(false);
  });

  test('without the repo identity, the suffix rule also matches an unrelated room', () => {
    expect(isRoomForRepo('acme-api', 'api')).toBe(true);
  });
});
