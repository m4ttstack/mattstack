import { describe, expect, it, vi } from 'vitest';

import {
  parsePackTokens,
  resolveStageDoc,
  type StageDocDeps,
} from './stageDoc';

const fakeGit = (
  repos: Record<
    string,
    { root: string; commits: Record<string, Record<string, string>> }
  >
) =>
  (async (args: string[]) => {
    const dir = args[1];
    const repo = Object.values(repos).find(r => dir.startsWith(r.root));
    if (!repo) return { code: 128, stdout: '', stderr: 'not a repo' };
    const cmd = args.slice(2);
    if (cmd[0] === 'rev-parse') {
      return { code: 0, stdout: repo.root + '\n', stderr: '' };
    }
    if (cmd[0] === 'cat-file') {
      return repo.commits[cmd[2]]
        ? { code: 0, stdout: 'commit\n', stderr: '' }
        : { code: 128, stdout: '', stderr: 'bad' };
    }
    if (cmd[0] === 'ls-tree') {
      return {
        code: 0,
        stdout: Object.keys(repo.commits[cmd[3]] ?? {}).join('\n'),
        stderr: '',
      };
    }
    if (cmd[0] === 'show') {
      const [sha, path] = cmd[1].split(':');
      const text = repo.commits[sha]?.[path];
      return text
        ? { code: 0, stdout: text, stderr: '' }
        : { code: 128, stdout: '', stderr: 'no path' };
    }
    return { code: 1, stdout: '', stderr: '' };
  }) as StageDocDeps['runGit'];

const org = {
  root: '/org',
  commits: {
    aaa1111: {
      'mattstack/packs/acme/attachments/stage-plan/SKILL.md': 'OLD PLAN',
    },
    bbb2222: {
      'mattstack/teams/acme/plugin/attachments/stage-plan/SKILL.md': 'NEW PLAN',
    },
    ccc3333: {
      'mattstack/teams/other/plugin/attachments/stage-plan/SKILL.md':
        'OTHER PLAN',
      'mattstack/teams/acme/plugin/attachments/stage-plan/SKILL.md':
        'ACME PLAN',
    },
  },
};

const deps = (extra: Partial<StageDocDeps> = {}): StageDocDeps => ({
  runGit: fakeGit({ org }),
  packDirs: async () => [
    { name: 'acme', dir: '/org/mattstack/teams/acme/plugin' },
    { name: 'mattstack', dir: '/mono/plugins/mattstack' },
  ],
  readFile: async p =>
    p === '/cache/0.30.20/attachments/pipeline/stage-ship/SKILL.md'
      ? 'SHIP DOC'
      : null,
  pluginCacheDir: '/cache',
  ...extra,
});

describe('parsePackTokens', () => {
  it('reads sha and version tokens', () => {
    expect(parsePackTokens('plugin=bbb2222,mattstack=0.30.20')).toEqual([
      { pack: 'plugin', ref: 'bbb2222', kind: 'sha' },
      { pack: 'mattstack', ref: '0.30.20', kind: 'version' },
    ]);
  });
});

describe('parsePackTokens version tokens', () => {
  it('rejects a version with path characters', () => {
    expect(parsePackTokens('mattstack=0.30.20/../x')).toEqual([]);
  });
});

describe('resolveStageDoc', () => {
  it('prefers the pack dir own path when a commit holds several matches', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'acme=ccc3333',
        stage: 'plan',
      })
    ).toMatchObject({ text: 'ACME PLAN' });
  });

  it('never reads outside the plugin cache for a traversal version', async () => {
    const readFile = vi.fn(async () => 'SECRET');
    expect(
      await resolveStageDoc(deps({ readFile }), {
        packCommits: 'mattstack=0.30.20/../../../x',
        stage: 'ship',
      })
    ).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('finds a doc at an old sha after the pack moved', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'acme=aaa1111',
        stage: 'plan',
      })
    ).toMatchObject({ text: 'OLD PLAN', pack: 'acme' });
  });

  it('resolves a legacy plugin= token through whichever repo has the commit', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'plugin=bbb2222,mattstack=0.30.20',
        stage: 'plan',
      })
    ).toMatchObject({ text: 'NEW PLAN', pack: 'acme' });
  });

  it('reads a version-recorded mattstack doc from the plugin cache', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'acme=bbb2222,mattstack=0.30.20',
        stage: 'ship',
      })
    ).toMatchObject({ text: 'SHIP DOC', pack: 'mattstack' });
  });

  it('is null when no pack has the stage', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'acme=bbb2222',
        stage: 'gates',
      })
    ).toBeNull();
  });

  it('is null with nothing recorded', async () => {
    expect(
      await resolveStageDoc(deps(), { packCommits: null, stage: 'plan' })
    ).toBeNull();
  });
});
