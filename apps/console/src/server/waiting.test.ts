import { describe, expect, it } from 'vitest';

import {
  compiledOutputs,
  movedSourcesOf,
  parseNameLog,
  staleSkillsOf,
  waitingForCompile,
  type WaitingDeps,
} from './waiting';

describe('staleSkillsOf', () => {
  it('lists stale verbs and own attachments, never a base copy', () => {
    expect(
      staleSkillsOf({
        verbs: [
          { name: 'work', status: 'stale' },
          { name: 'ship', status: 'in-sync' },
        ],
        attachments: [
          { name: 'checkout', status: 'stale' },
          { name: 'board-doctor', status: 'stale', base: 'acme-base' },
        ],
      })
    ).toEqual([
      { name: 'work', dir: 'skills/work' },
      { name: 'checkout', dir: 'attachments/checkout' },
    ]);
  });
});

describe('movedSourcesOf', () => {
  const tiering = {
    ref: 'mattstack:model-tiering',
    version: '0.32.47',
    builtVersion: '0.32.45',
  };

  it('names a changed part whose source version moved', () => {
    expect(
      movedSourcesOf({
        staleBecause: ['fill'],
        parts: [{ changed: true, source: tiering }],
      })
    ).toEqual([tiering]);
  });

  it('skips a bump that changed no part, and the template unless rt blames the source', () => {
    const template = { ...tiering, ref: 'mattstack:work' };
    expect(
      movedSourcesOf({
        staleBecause: ['fill'],
        template,
        parts: [{ changed: false, source: tiering }],
      })
    ).toEqual([]);
    expect(
      movedSourcesOf({ staleBecause: ['source'], template, parts: [] })
    ).toEqual([template]);
  });
});

describe('compiledOutputs', () => {
  it('holds the lock and each SKILL.md, compiled.json and keyed file', () => {
    expect(
      compiledOutputs([
        {
          dir: 'skills/review',
          keys: { 'lore/a.lore': 'skills/review/references/lore/a.lore' },
        },
      ])
    ).toEqual(
      new Set([
        'pack/compiled.lock.json',
        'skills/review/SKILL.md',
        'skills/review/compiled.json',
        'skills/review/references/lore/a.lore',
      ])
    );
  });
});

describe('parseNameLog', () => {
  it('splits commits and their files', () => {
    expect(parseNameLog('\0aaa\n\nx/a.md\nx/b.md\n\0bbb\n\nx/c.md\n')).toEqual(
      new Map([
        ['aaa', ['x/a.md', 'x/b.md']],
        ['bbb', ['x/c.md']],
      ])
    );
  });
});

describe('waitingForCompile', () => {
  const PACK = '/org/teams/demo/plugin';
  const manifest = JSON.stringify({ dir: 'skills/work', keys: {} });

  function deps(check: unknown, log: string): WaitingDeps {
    return {
      runRt: async argv => ({
        stdout: JSON.stringify(
          argv[1] === 'check' ? check : { staleBecause: [], parts: [] }
        ),
      }),
      parse: s => JSON.parse(s) as unknown,
      runGit: async argv => ({
        code: 0,
        stderr: '',
        stdout: argv.includes('ls-files') ? 'skills/work/compiled.json\n' : log,
      }),
      readPackFile: async () => manifest,
    };
  }

  it('marks the source commits since the newest compile', async () => {
    const log = [
      '',
      'c3\n\nteams/demo/plugin/pack/sections/a.md\n',
      'c2\n\nteams/demo/plugin/skills/work/SKILL.md\n',
      'c1\n\nteams/demo/plugin/pack/sections/b.md\n',
    ].join('\0');
    const result = await waitingForCompile(
      'demo',
      PACK,
      '/org',
      deps({ verbs: [{ name: 'work', status: 'stale' }] }, log)
    );
    expect(result).toEqual({ skills: ['work'], commits: ['c3'], outside: [] });
  });

  it('a lock-only commit counts as a compile', async () => {
    const log = [
      '',
      'c3\n\nteams/demo/plugin/pack/sections/a.md\n',
      'c2\n\nteams/demo/plugin/.claude-plugin/plugin.json\nteams/demo/plugin/pack/compiled.lock.json\n',
      'c1\n\nteams/demo/plugin/pack/sections/b.md\n',
    ].join('\0');
    const result = await waitingForCompile(
      'demo',
      PACK,
      '/org',
      deps({ verbs: [{ name: 'work', status: 'stale' }] }, log)
    );
    expect(result.commits).toEqual(['c3']);
  });

  it('marks nothing when no skill is stale', async () => {
    const result = await waitingForCompile(
      'demo',
      PACK,
      '/org',
      deps({ verbs: [{ name: 'work', status: 'in-sync' }] }, '\0c1\n\nx\n')
    );
    expect(result).toEqual({ skills: [], commits: [], outside: [] });
  });
});
