import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import type { RunSummary, WorktreeTreeRow } from '@mattstack/rt-client';
import { getDef } from '@mattstack/rt-client';
import {
  actionCommand,
  appBundleOf,
  buildFlockMenu,
  FLOCK_COMMAND_ICONS,
  flockInstalledFrom,
  flockOpenUrl,
  openArgs,
  parseFlockCommands,
  pickMrTree,
  pickResumeRun,
  readFlockToken,
  redactToken,
  type FlockIo,
} from '../flock-open.ts';

const REPO = 'remote:gitlab.com%2Facme%2Fshop';
const MR = 'https://gitlab.com/acme/shop/-/merge_requests/12';

function tree(over: Partial<WorktreeTreeRow>): WorktreeTreeRow {
  return {
    name: 't',
    kind: 'ephemeral',
    path: '/trees/t',
    branch: 'feat',
    repoName: REPO,
    mr: null,
    ...over,
  };
}

function run(over: Partial<RunSummary>): RunSummary {
  return {
    id: 'r1',
    repo: 'gitlab.com-acme-shop',
    work_type: 'work',
    pipeline: 'work',
    status: 'done',
    current_stage: null,
    spawned_by: null,
    started_at: 1,
    ended_at: null,
    pack_commits: null,
    pack_dirty: 0,
    attention: {} as RunSummary['attention'],
    last_event_at: 1,
    ticket: null,
    branch: null,
    session: 'sess-1',
    mr: MR,
    ...over,
  };
}

describe('pickMrTree', () => {
  test('prefers a claimed tree over the main checkout on the branch', () => {
    const trees = [
      tree({ kind: 'main', path: '/repo', branch: 'feat' }),
      tree({ path: '/trees/a' }),
    ];
    expect(pickMrTree(trees, REPO, 'feat')).toEqual({
      tree: '/trees/a',
      repoRoot: '/repo',
    });
  });

  test('falls back to the main checkout when it is on the branch', () => {
    const trees = [tree({ kind: 'main', path: '/repo', branch: 'feat' })];
    expect(pickMrTree(trees, REPO, 'feat').tree).toBe('/repo');
  });

  test('skips golden donors, other branches and other repos', () => {
    const trees = [
      tree({ kind: 'main', path: '/repo', branch: 'main' }),
      tree({ kind: 'golden', path: '/golden' }),
      tree({ path: '/other', branch: 'other' }),
      tree({ path: '/elsewhere', repoName: 'remote:x' }),
    ];
    expect(pickMrTree(trees, REPO, 'feat')).toEqual({
      tree: null,
      repoRoot: '/repo',
    });
  });
});

describe('pickResumeRun', () => {
  test('takes the newest work run with a session for the MR', () => {
    const runs = [
      run({ id: 'old', started_at: 1 }),
      run({ id: 'new', started_at: 5 }),
      run({ id: 'review', work_type: 'review', started_at: 9 }),
      run({ id: 'nosess', session: null, started_at: 9 }),
      run({ id: 'other', mr: `${MR}0`, started_at: 9 }),
    ];
    expect(pickResumeRun(runs, MR)?.id).toBe('new');
  });

  test('ignores a trailing slash on either url', () => {
    expect(pickResumeRun([run({ mr: `${MR}/` })], MR)?.id).toBe('r1');
  });

  test('null when no work run recorded the MR', () => {
    expect(pickResumeRun([run({ work_type: 'receive-review' })], MR)).toBe(
      null
    );
  });
});

test('parseFlockCommands keeps a known icon and drops an unknown one', () => {
  expect(
    parseFlockCommands([
      { label: 'Runner', command: 'rt runner', icon: 'rt' },
      { label: 'Ship', command: 'x', icon: 'rocket' },
    ])
  ).toEqual([
    { label: 'Runner', command: 'rt runner', icon: 'rt' },
    { label: 'Ship', command: 'x' },
  ]);
});

test('the icon list matches the board.flockCommands schema', () => {
  const schema = getDef('board.flockCommands')?.schema as {
    items: { properties: { icon: { enum: string[] } } };
  };
  expect(schema.items.properties.icon.enum).toEqual([...FLOCK_COMMAND_ICONS]);
});

test('parseFlockCommands keeps well-formed rows only', () => {
  expect(
    parseFlockCommands([
      { label: ' Sync ', command: ' rt sync ' },
      { label: 'No command' },
      { label: '', command: 'x' },
      'junk',
    ])
  ).toEqual([{ label: 'Sync', command: 'rt sync' }]);
  expect(parseFlockCommands(undefined)).toEqual([]);
});

test('actionCommand per action', () => {
  expect(actionCommand('shell', {})).toBeUndefined();
  expect(actionCommand('claude', {})).toBe('claude');
  expect(actionCommand('resume', { session: 'abc' })).toBe(
    "claude --resume 'abc'"
  );
  expect(actionCommand('command', { command: 'rt sync' })).toBe('rt sync');
});

test('flockOpenUrl encodes every part and omits run for a shell', () => {
  const url = new URL(
    flockOpenUrl({
      folder: '/trees/a b',
      repo: '/repo',
      label: '!12',
      kind: 'shell',
      token: 'tok',
    })
  );
  expect(url.protocol).toBe('flock:');
  expect(url.host).toBe('open');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    folder: '/trees/a b',
    repo: '/repo',
    label: '!12',
    kind: 'shell',
    token: 'tok',
  });
  const withRun = new URL(
    flockOpenUrl({
      folder: '/a',
      repo: '/r',
      label: '!1',
      kind: 'command',
      run: 'rt sync && echo "done"',
      token: 't',
    })
  );
  expect(withRun.searchParams.get('run')).toBe('rt sync && echo "done"');
});

test('openArgs sends the link to the running app by path', () => {
  expect(openArgs('flock://open?x', '/Apps/Flock Dev.app')).toEqual([
    '-a',
    '/Apps/Flock Dev.app',
    'flock://open?x',
  ]);
  expect(openArgs('flock://open?x', null)).toEqual(['flock://open?x']);
});

test('appBundleOf finds the .app folder of a running executable', () => {
  expect(
    appBundleOf('/code/flock/build/dev/Flock-dev.app/Contents/MacOS/Flock-dev')
  ).toBe('/code/flock/build/dev/Flock-dev.app');
  expect(appBundleOf('-/Applications/Flock.app/Contents/MacOS/Flock')).toBe(
    '/Applications/Flock.app'
  );
  expect(appBundleOf('/usr/bin/login')).toBe(null);
});

test('flockOpenUrl writes a space as %20, never +', () => {
  const url = flockOpenUrl({
    folder: '/a b',
    repo: '/r',
    label: 'flock e2e',
    kind: 'command',
    run: 'rt sync && echo "a+b"',
    token: 't',
  });
  expect(url).not.toContain('+');
  expect(url).toContain('run=rt%20sync%20%26%26%20echo%20%22a%2Bb%22');
});

test('a session id with anything but letters, digits and dashes is never resumed', () => {
  expect(pickResumeRun([run({ session: 'abc\u0003; rm -rf ~' })], MR)).toBe(
    null
  );
  expect(pickResumeRun([run({ session: '0d1f-9a2b' })], MR)?.id).toBe('r1');
});

test('redactToken hides the token in open errors', () => {
  expect(
    redactToken('LSOpen failed for flock://open?a=1&token=abc123&b=2')
  ).toBe('LSOpen failed for flock://open?a=1&token=…&b=2');
});

test('flockInstalledFrom: any Spotlight hit for either bundle id counts', () => {
  expect(flockInstalledFrom('/Applications/Flock.app\n')).toBe(true);
  expect(flockInstalledFrom('')).toBe(false);
  expect(flockInstalledFrom('\n')).toBe(false);
});

describe('readFlockToken', () => {
  test('creates a private token once and reuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flock-token-'));
    const path = join(dir, 'flock', 'open-token');
    const first = readFlockToken(path);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFlockToken(path)).toBe(first);
    expect(readFileSync(path, 'utf8').trim()).toBe(first);
  });

  test('never replaces a token that is already there, and leaves no temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flock-token-'));
    const path = join(dir, 'open-token');
    writeFileSync(path, 'flock-made\n', { mode: 0o644 });
    expect(readFlockToken(path)).toBe('flock-made');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['open-token']);
  });
});

describe('buildFlockMenu', () => {
  function io(over: Partial<FlockIo> = {}): FlockIo {
    return {
      listTrees: async () => [tree({ path: '/trees/a' })],
      listRuns: async () => [run({ agent: { status: 'idle', pane: 'p-1' } })],
      runWorktree: async () => '/trees/run',
      exists: () => true,
      flockInstalled: async () => true,
      ...over,
    };
  }
  const mr = { webUrl: MR, sourceBranch: 'feat' };

  test('reports the tree, the resume session and its live pane at any status', async () => {
    const menu = await buildFlockMenu(mr, REPO, [], io());
    expect(menu).toEqual({
      installed: true,
      tree: '/trees/a',
      repoRoot: null,
      resume: {
        session: 'sess-1',
        worktree: '/trees/run',
        livePane: 'p-1',
        worktreeGone: false,
      },
      commands: [],
    });
  });

  test('without Flock on the machine it reports only that, reading nothing else', async () => {
    let read = false;
    const menu = await buildFlockMenu(
      mr,
      REPO,
      [{ label: 'sync', command: 'rt sync' }],
      io({
        flockInstalled: async () => false,
        listTrees: async () => {
          read = true;
          return [];
        },
      })
    );
    expect(menu).toEqual({
      installed: false,
      tree: null,
      repoRoot: null,
      resume: null,
      commands: [],
    });
    expect(read).toBe(false);
  });

  test("marks the session's worktree gone when it no longer exists", async () => {
    const menu = await buildFlockMenu(
      mr,
      REPO,
      [],
      io({ exists: () => false, listRuns: async () => [run({})] })
    );
    expect(menu.resume?.worktreeGone).toBe(true);
    expect(menu.resume?.livePane).toBe(null);
  });

  test('no resume when no work run recorded the MR', async () => {
    const menu = await buildFlockMenu(
      mr,
      REPO,
      [],
      io({ listRuns: async () => [] })
    );
    expect(menu.resume).toBe(null);
  });
});
