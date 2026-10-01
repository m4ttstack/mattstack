import { describe, expect, test } from 'vitest';

import {
  agentState,
  isRoomForRepo,
  paneLocation,
  seenAgo,
  seenElapsed,
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

describe('seenAgo', () => {
  test('a signed-in buddy reads as seen, never as a state age', () => {
    expect(seenAgo({ status: 'live', lastSeenAt: 1_000 }, 181_000)).toBe(
      'seen 3m ago'
    );
    expect(seenElapsed({ status: 'live', lastSeenAt: 1_000 }, 181_000)).toBe(
      '3m'
    );
  });

  test('a signed-out buddy reads how long ago it left', () => {
    expect(
      seenAgo(
        { status: 'offline', lastSeenAt: 0, signedOutAt: 60_000 },
        660_000
      )
    ).toBe('10m ago');
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

  test('the suffix rule errs toward hiding the chip, never toward a wrong one', () => {
    expect(isRoomForRepo('acme-api', 'api')).toBe(true);
  });
});
