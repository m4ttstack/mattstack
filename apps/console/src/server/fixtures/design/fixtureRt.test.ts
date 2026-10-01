// @vitest-environment node
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseGitLog } from '../../gitLog';
import { mountSkills } from '../../skills';
import anatomyPlan from './anatomy.stage-plan.json';
import anatomyPlanUnsynced from './anatomy.stage-plan.unsynced.json';
import anatomyWork from './anatomy.work.json';
import changesClean from './changes.clean.json';
import changesUnsynced from './changes.unsynced.json';
import check from './check.json';
import composition from './composition.json';
import compositionUnsynced from './composition.unsynced.json';
import { fixtureMode, fixtureRt, type FixtureScenario } from './fixtureRt';
import history from './history.json';
import packs from './packs.json';
import sync from './sync.json';

const pack = (verb: string, ...rest: string[]) => [
  'skills',
  verb,
  '--pack',
  'acme',
  ...rest,
  '--json',
];

const expected: Record<FixtureScenario, [string[], unknown][]> = {
  clean: [
    [['skills', 'packs', '--json'], packs],
    [pack('composition'), composition],
    [pack('check'), check],
    [pack('anatomy', '--skill', 'work'), anatomyWork],
    [pack('anatomy', '--skill', 'stage-plan'), anatomyPlan],
    [pack('changes'), changesClean],
    [
      pack('discard'),
      { pack: 'acme', packDir: '/fixture/packs/acme', discarded: [] },
    ],
    [pack('sync'), sync],
  ],
  unsynced: [
    [pack('composition'), compositionUnsynced],
    [pack('anatomy', '--skill', 'work'), anatomyWork],
    [pack('anatomy', '--skill', 'stage-plan'), anatomyPlanUnsynced],
    [pack('changes'), changesUnsynced],
    [
      pack('discard'),
      {
        pack: 'acme',
        packDir: '/fixture/packs/acme',
        discarded: changesUnsynced.files,
      },
    ],
  ],
};

describe('fixtureMode', () => {
  it('is off unless CONSOLE_FIXTURE is design', () => {
    expect(fixtureMode({})).toBeNull();
    expect(fixtureMode({ CONSOLE_FIXTURE: 'demo' })).toBeNull();
  });

  it('defaults to the clean scenario and accepts unsynced', () => {
    expect(fixtureMode({ CONSOLE_FIXTURE: 'design' })).toBe('clean');
    expect(
      fixtureMode({
        CONSOLE_FIXTURE: 'design',
        CONSOLE_FIXTURE_SCENARIO: 'unsynced',
      })
    ).toBe('unsynced');
    expect(
      fixtureMode({
        CONSOLE_FIXTURE: 'design',
        CONSOLE_FIXTURE_SCENARIO: 'other',
      })
    ).toBe('clean');
  });
});

describe('fixtureRt runRt', () => {
  for (const scenario of ['clean', 'unsynced'] as const) {
    for (const [argv, file] of expected[scenario]) {
      it(`${scenario}: ${argv.slice(1).join(' ')}`, async () => {
        const result = await fixtureRt(scenario).runRt(argv);
        expect(JSON.parse(result.stdout)).toEqual(file);
        expect(result.stderr).toBe('');
      });
    }
  }

  it('exits 1 on check, the way rt does when a skill has drifted', async () => {
    expect((await fixtureRt('clean').runRt(pack('check'))).code).toBe(1);
    expect((await fixtureRt('clean').runRt(pack('composition'))).code).toBe(0);
  });

  it('accepts a bind', async () => {
    const result = await fixtureRt('clean').runRt([
      'skills',
      'bind',
      'stage-plan',
      'domain',
      'acme:plan-policy-strict',
      '--pack',
      'acme',
    ]);
    expect(result.code).toBe(0);
  });

  it.each([
    [['skills', 'surface', 'list', '--pack', 'acme', '--json']],
    [['skills', 'composition', '--pack', 'globex', '--json']],
    [['skills', 'composition', '--pack', 'acme']],
    [pack('anatomy', '--skill', 'review')],
    [pack('anatomy')],
    [['runs', 'list', '--json']],
  ])('exits 1 with no stdout for %j', async argv => {
    const result = await fixtureRt('clean').runRt(argv);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('design fixture');
  });
});

describe('fixtureRt runGit', () => {
  const git = (scenario: FixtureScenario, ...argv: string[]) =>
    fixtureRt(scenario).runGit(['-C', '/fixture/packs/acme', ...argv]);

  it('answers the history route from history.json', async () => {
    const root = await git('clean', 'rev-parse', '--show-toplevel');
    expect(root.stdout.trim()).toBe(history.repoRoot);

    const log = await git(
      'clean',
      'log',
      '--max-count=21',
      '--no-color',
      '--name-only',
      '--format=ignored',
      '--',
      '.'
    );
    expect(parseGitLog(log.stdout)).toEqual(history.commits);
  });

  it('scopes and bounds the log', async () => {
    const log = await git(
      'clean',
      'log',
      '--max-count=1',
      '--name-only',
      '--',
      'attachments/plan-policy'
    );
    const commits = parseGitLog(log.stdout);
    expect(commits.map(c => c.subject)).toEqual([
      'acme: plan-policy asks one question per gate',
    ]);
  });

  it('reports the pending files as porcelain status', async () => {
    expect(
      (await git('clean', 'status', '--porcelain', '--', '.')).stdout
    ).toBe('');
    expect(
      (await git('unsynced', 'status', '--porcelain', '--', '.')).stdout
    ).toBe(' M pack/skills.jsonc\n');
    expect(
      (await git('unsynced', 'status', '--porcelain', '--', 'skills/work'))
        .stdout
    ).toBe('');
  });

  it('diffs two listed commits and refuses an unknown one', async () => {
    const [newest, previous] = history.commits;
    const diff = await git(
      'clean',
      'diff',
      '--no-color',
      '--relative',
      `${previous!.shortSha}..${newest!.shortSha}`,
      '--',
      '.'
    );
    expect(diff.code).toBe(0);
    expect(diff.stdout).toContain('+  "version": "0.8.14",');

    const bad = await git(
      'clean',
      'diff',
      '--no-color',
      'deadbee..cafef00d',
      '--',
      '.'
    );
    expect(bad.code).toBe(128);
  });

  it('is not a repository anywhere but the pack', async () => {
    const result = await fixtureRt('clean').runGit(['-C', '/tmp', 'status']);
    expect(result.code).toBe(128);
  });
});

describe('fixtureRt files', () => {
  const { readPackFile, realpath } = fixtureRt('clean');

  it('reads fixture paths from files/', async () => {
    const text = await readPackFile(anatomyPlan.rendered.path);
    expect(text.split('\n')[302]).toContain('part: include:gate-protocol');
    await expect(realpath(anatomyPlan.template.path)).resolves.toBe(
      anatomyPlan.template.path
    );
  });

  it.each([
    '/etc/hosts',
    '/fixture/../etc/hosts',
    '/fixture/packs/acme/missing.md',
  ])('has no %s', async path => {
    await expect(readPackFile(path)).rejects.toThrow();
    await expect(realpath(path)).rejects.toThrow();
  });
});

describe('the skills routes on the fixture', () => {
  const mount = (scenario: FixtureScenario) => {
    const f = fixtureRt(scenario);
    return mountSkills(
      new Hono(),
      f.runRt,
      f.runGit,
      f.readPackFile,
      f.realpath
    );
  };

  it('serves composition and anatomy', async () => {
    const app = mount('clean');
    const res = await app.request('/api/skills/composition?pack=acme');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(composition);
    const anatomy = await app.request(
      '/api/skills/anatomy?pack=acme&skill=stage-plan'
    );
    expect(await anatomy.json()).toEqual(anatomyPlan);
  });

  it('serves a template through the confined source route', async () => {
    const app = mount('clean');
    const res = await app.request(
      `/api/skills/source?pack=acme&path=${encodeURIComponent(anatomyWork.template.path)}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: number; content: string };
    expect(body.lines).toBe(anatomyWork.template.lines);
    expect(body.content.split('\n')[1]).toBe('name: work');
  });

  it('refuses a source path outside the pack and engine roots', async () => {
    const res = await mount('clean').request(
      '/api/skills/source?pack=acme&path=%2Ffixture%2Fpacks%2Fglobex%2FSKILL.md'
    );
    expect(res.status).toBe(404);
  });

  it('serves history with the pack version and the pending files', async () => {
    const res = await mount('unsynced').request(
      '/api/skills/history?pack=acme'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commits: unknown[];
      runtime: { dirtyFiles: string[]; packVersion: string };
    };
    expect(body.commits).toHaveLength(history.commits.length);
    expect(body.runtime).toMatchObject({
      dirtyFiles: ['pack/skills.jsonc'],
      packVersion: '0.8.14',
    });
  });
});

describe('server wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('../../rt-bin');
  });

  const routesWith = async (env: string | undefined) => {
    vi.resetModules();
    vi.stubEnv('CONSOLE_FIXTURE', env);
    const live = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'live rt',
    }));
    vi.doMock('../../rt-bin', async importOriginal => ({
      ...(await importOriginal<typeof import('../../rt-bin')>()),
      runRt: live,
    }));
    const { routes } = await import('../../routes');
    return { routes, live };
  };

  it('uses the live rt runner without CONSOLE_FIXTURE', async () => {
    const { routes, live } = await routesWith(undefined);
    await routes.request('/api/skills/composition?pack=acme');
    expect(live).toHaveBeenCalledWith([
      'skills',
      'composition',
      '--pack',
      'acme',
      '--json',
    ]);
  });

  it('answers from the fixture with CONSOLE_FIXTURE=design', async () => {
    const { routes, live } = await routesWith('design');
    const res = await routes.request('/api/skills/composition?pack=acme');
    expect(await res.json()).toEqual(composition);
    expect(live).not.toHaveBeenCalled();
  });
});
