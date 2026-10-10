import { expect, test } from 'bun:test';

import { orphanServices, type LaunchdService } from '../../core/discover.ts';
import {
  isLiveLabel,
  liveAppOf,
  liveLabel,
  liveLabelPrefix,
} from './labels.ts';

test('live labels sit under the app label with a live segment', () => {
  expect(liveLabel('chat', 'ui')).toBe('com.mattstack.deck.chat.live.ui');
  expect(liveLabelPrefix('chat')).toBe('com.mattstack.deck.chat.live.');
  expect(isLiveLabel('com.mattstack.deck.chat.live.worker-1')).toBe(true);
  expect(isLiveLabel('com.mattstack.deck.chat')).toBe(false);
  expect(isLiveLabel('com.other.chat.live.ui')).toBe(false);
});

test('liveAppOf names the app a live label belongs to', () => {
  expect(liveAppOf('com.mattstack.deck.chat.live.ui')).toBe('chat');
  expect(liveAppOf('com.mattstack.deck.a.live.live.worker-1')).toBe('a.live');
  expect(liveAppOf('com.mattstack.deck.chat')).toBeNull();
});

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

test('a live service of a live app is not a stray, one with no live app is', () => {
  const strays = orphanServices(
    [],
    [
      svc('com.mattstack.deck.chat.live.server'),
      svc('com.mattstack.deck.ghost.live.server'),
      svc('com.mattstack.deck.tunnel'),
    ],
    name => name === 'chat'
  );
  expect(strays.map(s => s.label)).toEqual([
    'com.mattstack.deck.ghost.live.server',
    'com.mattstack.deck.tunnel',
  ]);
});
