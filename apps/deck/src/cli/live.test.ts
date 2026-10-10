import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive } from '../../core/settings.ts';
import { startApi } from '../api/server.ts';
import { writeApiInfo } from '../api/state.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import { FakeTunnelDriver } from '../edge/tunnel.ts';
import type { LiveDeps } from '../live/engine.ts';
import { freshChat, managerOf } from '../live/test-kit.ts';
import { runCommand } from './commands.ts';

const PORT = 18955;
let kit = freshChat();
const live: LiveDeps = {};
const server = startApi({
  manager: managerOf(() => kit.manager),
  edge: new FakeEdgeProxy(),
  tunnel: new FakeTunnelDriver(),
  port: PORT,
  canaryPort: PORT + 1,
  freshness: () => 'unknown',
  autoHeal: () => null,
  onRouteWrite: () => {},
  devMode: () => true,
  live,
});
beforeEach(() => {
  kit = freshChat();
  for (const k of Object.keys(live)) delete live[k as keyof LiveDeps];
  Object.assign(live, kit.deps());
  writeApiInfo(PORT);
});
afterEach(() => clearLive('chat'));
afterAll(() => server.stop(true));

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCommand(argv, {
    out: s => out.push(s),
    err: s => err.push(s),
  });
  return { out, err, code };
}

test('on with no --worktree runs main', async () => {
  const { out, code } = await run(['live', 'chat', 'on']);
  expect(code).toBe(0);
  expect(out).toEqual(['chat is live from main']);
});

test('deck live lists live apps', async () => {
  await run(['live', 'chat', 'on']);
  expect((await run(['live'])).out).toEqual([`${'chat'.padEnd(24)} main`]);
});

test('an unknown worktree is a plain error', async () => {
  const { err, code } = await run(['live', 'chat', 'on', '--worktree', 'nope']);
  expect(code).toBe(1);
  expect(err).toEqual(['no worktree named nope']);
});

test('off brings it back', async () => {
  await run(['live', 'chat', 'on']);
  const { out, code } = await run(['live', 'chat', 'off']);
  expect(code).toBe(0);
  expect(out).toEqual(['chat is back to normal']);
});

test('--json prints the API answer', async () => {
  const { out } = await run(['live', 'chat', 'on', '--json']);
  expect(JSON.parse(out[0]!)).toEqual({ ok: true });
});
