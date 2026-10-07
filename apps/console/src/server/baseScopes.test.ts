import { describe, expect, it } from 'vitest';

import {
  baseScopesFor,
  rewriteDiffPaths,
  toBaseCoordinate,
} from './baseScopes';

const repoRoot = '/o/acme';
const composition = {
  pack: 'acme',
  packDir: '/o/acme/mattstack/teams/acme/packs/acme',
  verbs: [
    {
      name: 'plan',
      slots: [
        {
          name: 'domain',
          fillSourcePath:
            '/o/acme/mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md',
          origin: 'base' as const,
          base: 'acme-base',
        },
        {
          name: 'tiering',
          fillSourcePath: '/m/mattstack/attachments/model-tiering/SKILL.md',
        },
      ],
    },
    {
      name: 'ship',
      slots: [
        {
          name: 'domain',
          fillSourcePath:
            '/o/acme/mattstack/teams/acme/packs/acme/attachments/board-fill/SKILL.md',
          origin: 'base' as const,
          base: 'acme-base',
        },
      ],
    },
  ],
};
const realpath = async (p: string) => p;

describe('baseScopesFor', () => {
  it('scopes a verb to the base fill dirs it binds, outside the pack', async () => {
    expect(
      await baseScopesFor(composition, 'plan', repoRoot, realpath)
    ).toEqual([
      {
        base: 'acme-base',
        root: '/o/acme/mattstack/org/packs/acme-base',
        top: 'mattstack/org/packs/acme-base/attachments/plan-policy',
      },
    ]);
  });

  it('adds no scope for a team-pack copy of a base fill', async () => {
    expect(
      await baseScopesFor(composition, 'ship', repoRoot, realpath)
    ).toEqual([]);
  });

  it('drops a base dir outside the repo', async () => {
    expect(
      await baseScopesFor(composition, 'plan', '/elsewhere', realpath)
    ).toEqual([]);
  });

  it('takes every verb when no verb is named, one scope per fill dir', async () => {
    const twice = {
      ...composition,
      verbs: [...composition.verbs, { ...composition.verbs[0], name: 'work' }],
    };
    expect(
      (await baseScopesFor(twice, null, repoRoot, realpath)).map(s => s.top)
    ).toEqual(['mattstack/org/packs/acme-base/attachments/plan-policy']);
  });

  it('drops a fill whose path does not resolve', async () => {
    const missing = async () => {
      throw new Error('ENOENT');
    };
    expect(await baseScopesFor(composition, 'plan', repoRoot, missing)).toEqual(
      []
    );
  });

  it('reads a composition with no verbs as no scopes', async () => {
    expect(
      await baseScopesFor({ packDir: '/p' }, null, repoRoot, realpath)
    ).toEqual([]);
  });
});

describe('toBaseCoordinate', () => {
  const scopes = [
    {
      base: 'acme-base',
      root: '/o/acme/mattstack/org/packs/acme-base',
      top: 'mattstack/org/packs/acme-base/attachments/plan-policy',
    },
  ];

  it('rewrites a repo path under a base root', () => {
    expect(
      toBaseCoordinate(
        'mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md',
        scopes,
        repoRoot
      )
    ).toBe('base:acme-base/attachments/plan-policy/SKILL.md');
  });

  it('leaves any other path alone', () => {
    expect(
      toBaseCoordinate(
        'mattstack/teams/acme/packs/acme/skills/plan/SKILL.md',
        scopes,
        repoRoot
      )
    ).toBe('mattstack/teams/acme/packs/acme/skills/plan/SKILL.md');
  });
});

describe('rewriteDiffPaths', () => {
  const scopes = [
    {
      base: 'acme-base',
      root: '/o/acme/mattstack/org/packs/acme-base',
      top: 'mattstack/org/packs/acme-base/attachments/plan-policy',
    },
  ];
  const file = 'mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md';
  const coord = 'base:acme-base/attachments/plan-policy/SKILL.md';

  it('rewrites the file headers and leaves the hunk body alone', () => {
    const diff = [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      '@@ -1,2 +1,2 @@',
      `-- a/${file}`,
      `++ b/${file}`,
      '',
    ].join('\n');

    expect(rewriteDiffPaths(diff, scopes, '/o/acme')).toBe(
      [
        `diff --git a/${coord} b/${coord}`,
        `--- a/${coord}`,
        `+++ b/${coord}`,
        '@@ -1,2 +1,2 @@',
        `-- a/${file}`,
        `++ b/${file}`,
        '',
      ].join('\n')
    );
  });

  it('keeps /dev/null for an added file', () => {
    const diff = [
      `diff --git a/${file} b/${file}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${file}`,
      '',
    ].join('\n');

    expect(rewriteDiffPaths(diff, scopes, '/o/acme')).toContain(
      '--- /dev/null\n'
    );
  });
});
