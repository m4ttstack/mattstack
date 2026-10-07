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
import { scenarioOf, SCENARIOS } from './scenarios';
import sync from './sync.json';

/** What the composition route answers for the fixture: rt's payload, with
    the installed skill file it adds to each app binder (none here). */
const served = {
  ...composition,
  binders: composition.binders.map(binder =>
    binder.kind === 'external' ? { ...binder, skillFile: null } : binder
  ),
};

const pack = (verb: string, ...rest: string[]) => [
  'skills',
  verb,
  '--pack',
  'acme',
  ...rest,
  '--json',
];

const expected: Record<'clean' | 'unsynced', [string[], unknown][]> = {
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
  });

  it('accepts every state scenario and refuses one it does not know', () => {
    for (const scenario of SCENARIOS)
      expect(
        fixtureMode({
          CONSOLE_FIXTURE: 'design',
          CONSOLE_FIXTURE_SCENARIO: scenario,
        })
      ).toBe(scenario);
    expect(() =>
      fixtureMode({
        CONSOLE_FIXTURE: 'design',
        CONSOLE_FIXTURE_SCENARIO: 'other',
      })
    ).toThrow(/CONSOLE_FIXTURE_SCENARIO "other".*referenced/);
  });
});

describe('the state scenarios', () => {
  type Part = (typeof anatomyPlan.parts)[number];
  type Anatomy = Omit<typeof anatomyPlan, 'parts'> & { parts: Part[] };

  const json = async <T>(scenario: FixtureScenario, argv: string[]) =>
    JSON.parse((await fixtureRt(scenario).runRt(argv)).stdout) as T;
  const anatomyOf = (scenario: FixtureScenario, skill: string) =>
    json<Anatomy>(scenario, pack('anatomy', '--skill', skill));
  const compositionOf = (scenario: FixtureScenario) =>
    json<typeof composition>(scenario, pack('composition'));
  const lines = async (scenario: FixtureScenario, path: string) =>
    (await fixtureRt(scenario).readPackFile(path))
      .replace(/\n$/, '')
      .split('\n');
  const domainOf = (anatomy: Anatomy) =>
    anatomy.parts.find(part => part.name === 'domain')!;
  const rangesOf = (anatomy: Anatomy) =>
    anatomy.parts.map(part => [part.name, part.renderedLines]);
  const lastPartsOf = (anatomy: Anatomy) =>
    rangesOf(anatomy)
      .filter(([name]) => name !== null)
      .slice(-2);
  const planBinding = (c: typeof composition) =>
    c.binders.find(b => b.ref === 'mattstack:stage-plan')!.slots;
  const planSlot = (c: typeof composition) =>
    c.targets.find(t => t.name === 'stage-plan')!.slots[0];

  it('serves the subject of every scenario, or fails it', async () => {
    for (const scenario of SCENARIOS) {
      const { subject } = scenarioOf(scenario);
      const result = await fixtureRt(scenario).runRt(
        pack('anatomy', '--skill', subject)
      );
      if (scenario === 'anatomy-failed') {
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('stage-plan');
      } else {
        expect(JSON.parse(result.stdout)).toMatchObject({ skill: subject });
      }
    }
  });

  it('referenced: the domain slot renders as one line naming its fill', async () => {
    const anatomy = await anatomyOf('referenced', 'stage-plan');
    expect(domainOf(anatomy)).toMatchObject({
      mode: 'reference',
      renderedLines: [223, 223],
      source: domainOf(anatomyPlan).source,
    });
    expect(anatomy.rendered.lines).toBe(701);
    expect(lastPartsOf(anatomy)).toEqual([
      ['gate-protocol', [224, 673]],
      ['wrap-up-form', [674, 701]],
    ]);
    const text = await lines('referenced', anatomy.rendered.path);
    expect(text).toHaveLength(701);
    expect(text[222]).toBe(
      'Slot domain is bound to `acme:plan-policy` (acme:plan-policy@0.8.14) -- invoke that skill when this flow needs it.'
    );
    expect(text[223]).toContain('part: include:gate-protocol');
    expect(await compositionOf('referenced')).toEqual(composition);
  });

  it.each([
    'required-unbound',
    'optional-unbound',
    'no-matching-fill',
  ] as const)('%s: the domain slot renders nothing', async scenario => {
    const anatomy = await anatomyOf(scenario, 'stage-plan');
    expect(domainOf(anatomy)).toMatchObject({
      source: null,
      renderedLines: null,
    });
    expect(anatomy.rendered.lines).toBe(700);
    expect(lastPartsOf(anatomy)).toEqual([
      ['gate-protocol', [223, 672]],
      ['wrap-up-form', [673, 700]],
    ]);
    const text = await lines(scenario, anatomy.rendered.path);
    expect(text).toHaveLength(700);
    expect(text[222]).toContain('part: include:gate-protocol');
    expect(text.join('\n')).not.toContain('plan-policy');
  });

  it('required-unbound: nothing binds the required domain slot', async () => {
    const c = await compositionOf('required-unbound');
    expect(planBinding(c)).toEqual([]);
    expect(planSlot(c)).toMatchObject({ name: 'domain', required: true });
  });

  it('optional-unbound: nothing binds the domain slot, which is optional', async () => {
    const c = await compositionOf('optional-unbound');
    expect(planBinding(c)).toEqual([]);
    expect(planSlot(c)).toMatchObject({ name: 'domain', required: false });
  });

  it('no-matching-fill: the domain slot names a fill the pack lacks', async () => {
    const c = await compositionOf('no-matching-fill');
    expect(planBinding(c)).toEqual([
      { name: 'domain', boundTo: 'acme:plan-policy-v1', layer: 'pack' },
    ]);
    expect(c.fills.map(f => f.binding)).not.toContain('acme:plan-policy-v1');
  });

  it("resolve-error: release-notes carries rt's message for its changelog slot", async () => {
    const c = await compositionOf('resolve-error');
    const slot = c.verbs.find(v => v.name === 'release-notes')!.slots[0]!;
    expect(slot).toMatchObject({
      name: 'changelog',
      boundTo: 'acme:changelog-style',
      layer: 'pack',
    });
    expect((slot as { resolveError?: string }).resolveError).toMatch(
      /^loadAttachment: slot "changelog": binding "acme:changelog-style" not found; searched:\n/
    );
    const anatomy = await anatomyOf('resolve-error', 'release-notes');
    const template = await fixtureRt('resolve-error').readPackFile(
      anatomy.template.path
    );
    expect(template.split('\n')[21]).toBe('{{slot:changelog}}');
    expect(await lines('resolve-error', anatomy.rendered.path)).toHaveLength(
      anatomy.rendered.lines
    );
  });

  it("legacy: every part comes from the rendered file's markers", async () => {
    const anatomy = await anatomyOf('legacy', 'stage-plan');
    expect(anatomy.parts.every(part => part.templateLines === null)).toBe(true);
    expect(rangesOf(anatomy)).toEqual([
      [null, [12, 48]],
      ['execution-strategy', [49, 197]],
      ['gate-protocol', [303, 749]],
      ['wrap-up-form', [753, 780]],
    ]);
  });

  it('never-compiled: no rendered file, and check says so', async () => {
    const anatomy = await anatomyOf('never-compiled', 'stage-plan');
    expect(anatomy).toMatchObject({
      status: 'never-compiled',
      rendered: { exists: false, lines: 0 },
      links: [],
    });
    expect(anatomy.template.builtVersion).toBeNull();
    expect(anatomy.parts.every(part => part.renderedLines === null)).toBe(true);
    const report = await json<typeof check>('never-compiled', pack('check'));
    expect(report.verbs.find(v => v.name === 'stage-plan')!.status).toBe(
      'never-compiled'
    );
    const { readPackFile, realpath } = fixtureRt('never-compiled');
    await expect(readPackFile(anatomy.rendered.path)).rejects.toThrow();
    await expect(realpath(anatomy.rendered.path)).rejects.toThrow();
    await expect(readPackFile(anatomy.template.path)).resolves.toContain(
      '{{slot:domain}}'
    );
  });

  it.each([
    ['check-failed', pack('check')],
    ['changes-failed', pack('changes')],
  ] as const)(
    '%s: rt answers with an error and no report',
    async (scenario, argv) => {
      const result = await fixtureRt(scenario).runRt([...argv]);
      expect(result.code).toBeGreaterThan(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toBe('');
    }
  );

  it('leaves every other answer as clean has it', async () => {
    for (const scenario of SCENARIOS) {
      if (scenario === 'unsynced') continue;
      const { runRt } = fixtureRt(scenario);
      const work = await runRt(pack('anatomy', '--skill', 'work'));
      expect(JSON.parse(work.stdout)).toEqual(anatomyWork);
      if (
        ![
          'check-failed',
          'never-compiled',
          'org-base',
          'org-base-drift',
        ].includes(scenario)
      ) {
        const report = await runRt(pack('check'));
        expect(JSON.parse(report.stdout)).toEqual(check);
      }
    }
  });
});

describe('the org base scenarios', () => {
  const ORG = ['org-base', 'org-base-drift'] as const;
  const BASE_FILL =
    '/fixture/orgbase/acme-base/attachments/plan-policy/SKILL.md';
  const BASE_TAG = {
    origin: 'base',
    base: 'acme-base',
    baseVersion: '0.1.0',
  };

  type Composition = typeof composition & {
    extends?: { name: string; version: string };
    verbs: { name: string; slots: Record<string, unknown>[] }[];
    fills: Record<string, unknown>[];
  };
  const json = async <T>(scenario: FixtureScenario, argv: string[]) =>
    JSON.parse((await fixtureRt(scenario).runRt(argv)).stdout) as T;

  it.each(ORG)('%s: the composition binds plan to the base fill', async s => {
    const c = await json<Composition>(s, pack('composition'));
    expect(c.extends).toEqual({ name: 'acme-base', version: '0.1.0' });
    const binder = c.binders.find(b => b.ref === 'mattstack:stage-plan')!;
    expect(binder.slots).toEqual([
      {
        name: 'domain',
        boundTo: 'acme-base:plan-policy',
        layer: 'base:acme-base',
        ...BASE_TAG,
      },
    ]);
    const slot = c.verbs
      .find(v => v.name === 'shepherdr')!
      .slots.find(x => x.name === 'domain');
    expect(slot).toMatchObject({
      boundTo: 'acme-base:plan-policy',
      fillSourcePath: BASE_FILL,
      fillVersion: 'org',
      ...BASE_TAG,
    });
    expect(c.fills.find(f => f.binding === 'acme-base:plan-policy')).toEqual({
      binding: 'acme-base:plan-policy',
      provides: 'plan-domain@1',
      sourcePath: BASE_FILL,
      registered: false,
      ...BASE_TAG,
    });
  });

  it.each(ORG)('%s: plan anatomy tags the base source', async s => {
    const anatomy = await json<typeof anatomyPlan>(
      s,
      pack('anatomy', '--skill', 'stage-plan')
    );
    const domain = anatomy.parts.find(part => part.name === 'domain')!;
    expect(domain.source).toMatchObject({
      ref: 'acme-base:plan-policy',
      path: BASE_FILL,
      version: 'org',
      builtVersion: 'org',
      ...BASE_TAG,
    });
    expect(anatomy.links.map(l => l.path)).toContain(
      '../../attachments/dev-servers/SKILL.md'
    );
  });

  it('org-base: check reports the base attachment in sync', async () => {
    const result = await fixtureRt('org-base').runRt(pack('check'));
    const report = JSON.parse(result.stdout) as typeof check & {
      attachments: unknown[];
      baseErrors: string[];
    };
    expect(report.attachments).toEqual([
      {
        name: 'dev-servers',
        base: 'acme-base',
        status: 'in-sync',
        staleFiles: [],
        orphanFiles: [],
      },
    ]);
    expect(report.baseErrors).toEqual([]);
  });

  it('org-base-drift: check reports it stale with a base error, exiting 1', async () => {
    const result = await fixtureRt('org-base-drift').runRt(pack('check'));
    const report = JSON.parse(result.stdout) as {
      attachments: unknown[];
      baseErrors: string[];
    };
    expect(result.code).toBe(1);
    expect(report.attachments).toEqual([
      {
        name: 'dev-servers',
        base: 'acme-base',
        status: 'stale',
        staleFiles: ['SKILL.md'],
        orphanFiles: [],
      },
    ]);
    expect(report.baseErrors).toEqual([
      'acme-base has no attachments/feature-flags',
    ]);
  });

  it.each(ORG)('%s: surface list holds a base row', async s => {
    const result = await fixtureRt(s).runRt([
      'skills',
      'surface',
      'list',
      '--pack',
      'acme',
      '--json',
    ]);
    expect(result.code).toBe(0);
    const surface = JSON.parse(result.stdout) as {
      pack: string;
      packDir: string;
      rows: { name: string; kind: string; status: string; base?: string }[];
    };
    expect(surface.pack).toBe('acme');
    expect(surface.packDir).toBe('/fixture/packs/acme');
    expect(surface.rows).toContainEqual({
      name: 'dev-servers',
      kind: 'compiled',
      status: 'internal',
      base: 'acme-base',
    });
    expect(surface.rows.some(r => r.kind === 'compiled' && !r.base)).toBe(true);
    expect(surface.rows.some(r => r.name === 'plan-policy')).toBe(true);
  });

  it.each(ORG)('%s: the base fill and compiled copy are readable', async s => {
    const { readPackFile, realpath } = fixtureRt(s);
    await expect(readPackFile(BASE_FILL)).resolves.toContain(
      'How acme plans a change before any code.'
    );
    await expect(realpath(BASE_FILL)).resolves.toBe(BASE_FILL);
    const compiled = await readPackFile(
      '/fixture/packs/acme/attachments/dev-servers/compiled.json'
    );
    expect(JSON.parse(compiled)).toEqual({
      base: 'acme-base',
      version: '0.1.0',
      files: ['SKILL.md'],
    });
  });

  it('the other scenarios keep refusing surface', async () => {
    for (const scenario of SCENARIOS) {
      if (scenario === 'org-base' || scenario === 'org-base-drift') continue;
      const result = await fixtureRt(scenario).runRt([
        'skills',
        'surface',
        'list',
        '--pack',
        'acme',
        '--json',
      ]);
      expect(result.code).toBe(1);
    }
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
    expect(await res.json()).toEqual(served);
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
    expect(await res.json()).toEqual(served);
    expect(live).not.toHaveBeenCalled();
  });
});
