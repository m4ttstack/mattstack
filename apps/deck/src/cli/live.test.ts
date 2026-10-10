import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

import { clearLive } from '../../core/settings.ts';
import { startApi } from '../api/server.ts';
import { writeApiInfo } from '../api/state.ts';
import { FakeEdgeProxy } from '../edge/portless.ts';
import { FakeTunnelDriver } from '../edge/tunnel.ts';
import type { LiveDeps } from '../live/engine.ts';
import { clearSetup } from '../live/setup.ts';
import { branchOf } from '../live/sources.ts';
import {
  freshChat,
  gitRepo,
  managerOf,
  manifest,
  SERVER,
  UI,
} from '../live/test-kit.ts';
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
afterEach(() => {
  clearLive('chat');
  clearSetup('chat');
});
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

function withWorktree(
  over: { exists?: boolean; readyAt?: string | null } = {}
) {
  const wt = realpathSync(
    gitRepo({ 'apps/chat/mattstack.deck.json': manifest([SERVER, UI]) })
  );
  Object.assign(
    live,
    kit.deps({
      sources: {
        exists: () => over.exists ?? true,
        listTrees: async () => [
          ...kit.trees(),
          {
            path: wt,
            branch: 'feat',
            kind: 'unmanaged',
            state: null,
            repoName: 'r',
            readyAt: over.readyAt ?? null,
          },
        ],
      },
      setup: { run: () => new Promise<number>(() => {}) },
    })
  );
  return wt;
}

test('--worktree matches by branch name', async () => {
  withWorktree();
  const { out, code } = await run(['live', 'chat', 'on', '--worktree', 'feat']);
  expect(code).toBe(0);
  expect(out).toEqual(['chat is live from feat']);
});

test('--worktree matches by path', async () => {
  const wt = withWorktree();
  const { out, code } = await run(['live', 'chat', 'on', '--worktree', wt]);
  expect(code).toBe(0);
  expect(out).toEqual(['chat is live from feat']);
});

test('a worktree that needs setup says so', async () => {
  withWorktree({ exists: false });
  const { out, code } = await run(['live', 'chat', 'on', '--worktree', 'feat']);
  expect(code).toBe(0);
  expect(out).toEqual(['setting up feat first, then chat goes live']);
});

test('switching an app that is already live', async () => {
  const wt = withWorktree();
  await run(['live', 'chat', 'on']);
  const { out, code } = await run(['live', 'chat', 'on', '--worktree', 'feat']);
  expect(code).toBe(0);
  expect(out).toEqual(['chat is live from feat']);
  expect((await run(['live'])).out).toEqual([
    `${'chat'.padEnd(24)} ${branchOf(wt)}`,
  ]);
});

test('a bare --worktree is a usage error', async () => {
  const { err, code } = await run(['live', 'chat', 'on', '--worktree']);
  expect(code).toBe(2);
  expect(err[0]).toContain('deck live <app> on');
});

test('a server error exits 1 with its message', async () => {
  const { err, code } = await run(['live', 'nope', 'on']);
  expect(code).toBe(1);
  expect(err).toEqual(['unknown app']);
});

test('nothing live says so, and --json keeps the envelope', async () => {
  expect((await run(['live'])).out).toEqual(['nothing is live']);
  expect(JSON.parse((await run(['live', '--json'])).out[0]!)).toEqual({
    apps: [],
  });
});

test('off --json prints the API answer', async () => {
  await run(['live', 'chat', 'on']);
  const { out } = await run(['live', 'chat', 'off', '--json']);
  expect(JSON.parse(out[0]!)).toEqual({ ok: true });
});

test('deck not running exits 1', async () => {
  const saved = process.env.LOCAL_STATE_DIR;
  const empty = mkdtempSync(join(tmpdir(), 'local-cli-live-noserve-'));
  process.env.LOCAL_STATE_DIR = empty;
  try {
    const { err, code } = await run(['live']);
    expect(code).toBe(1);
    expect(err[0]).toContain("Deck isn't running");
  } finally {
    process.env.LOCAL_STATE_DIR = saved;
    rmSync(empty, { recursive: true, force: true });
  }
});

test('the list prints a server error and exits 1', async () => {
  const broken = Bun.serve({
    port: PORT + 2,
    fetch: () => Response.json({ error: 'boom' }, { status: 500 }),
  });
  writeApiInfo(PORT + 2);
  try {
    const { err, code } = await run(['live']);
    expect(code).toBe(1);
    expect(err).toEqual(['boom']);
  } finally {
    broken.stop(true);
  }
});

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd });

test('a live app on a detached worktree lists its path', async () => {
  const wt = withWorktree();
  git(wt, 'checkout', '--detach');
  await run(['live', 'chat', 'on', '--worktree', wt]);
  expect((await run(['live'])).out).toEqual([`${'chat'.padEnd(24)} ${wt}`]);
});

test('a live app on the shared checkout lists main whatever its branch', async () => {
  git(kit.shared, 'checkout', '-b', 'something-else');
  await run(['live', 'chat', 'on']);
  expect((await run(['live'])).out).toEqual([`${'chat'.padEnd(24)} main`]);
});
