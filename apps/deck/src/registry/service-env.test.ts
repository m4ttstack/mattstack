import { expect, test } from 'bun:test';

import type { AppRecord } from './records.ts';
import { serviceEnv } from './service-env.ts';

const owned = { name: 'console', port: 11001, managedBy: 'rt' } as AppRecord;
const mine = { name: 'mine', port: 11500 } as AppRecord;

test('a mattstack-owned service carries the flavor of the deck that runs it', () => {
  expect(serviceEnv(owned, true).MATTSTACK_FLAVOR).toBe('dev');
  expect(serviceEnv(owned, false).MATTSTACK_FLAVOR).toBe('prod');
});

test('a user service gets no flavor', () => {
  expect(serviceEnv(mine, true)).not.toHaveProperty('MATTSTACK_FLAVOR');
});

test('a manifest cannot set the flavor', () => {
  const env = serviceEnv({ ...owned, env: { MATTSTACK_FLAVOR: 'dev' } }, false);
  expect(env.MATTSTACK_FLAVOR).toBe('prod');
});
