import { expect, test } from 'bun:test';

import { orphanServices, type LaunchdService } from '../../core/discover.ts';
import { isLiveLabel, liveLabel, liveLabelPrefix } from './labels.ts';

test('live labels sit under the app label with a live segment', () => {
  expect(liveLabel('chat', 'ui')).toBe('com.mattstack.deck.chat.live.ui');
  expect(liveLabelPrefix('chat')).toBe('com.mattstack.deck.chat.live.');
  expect(isLiveLabel('com.mattstack.deck.chat.live.worker-1')).toBe(true);
  expect(isLiveLabel('com.mattstack.deck.chat')).toBe(false);
  expect(isLiveLabel('com.other.chat.live.ui')).toBe(false);
});

test('a live service with no route of its own is not a stray', () => {
  const svc = (label: string): LaunchdService => ({
    label,
    plistPath: `/x/${label}.plist`,
    program: [],
    workingDirectory: null,
    stderrPath: null,
    port: 11002,
    pid: 1,
    lastExitStatus: null,
  });
  const strays = orphanServices(
    [],
    [
      svc('com.mattstack.deck.chat.live.server'),
      svc('com.mattstack.deck.tunnel'),
    ]
  );
  expect(strays.map(s => s.label)).toEqual(['com.mattstack.deck.tunnel']);
});
