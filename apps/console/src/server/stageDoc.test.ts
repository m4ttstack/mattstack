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
    ddd4444: {
      'mattstack/teams/acme/plugin/attachments/stage-evidence/SKILL.md':
        'DEFAULT EVIDENCE',
      'mattstack/teams/acme/plugin/attachments/stage-evidence--accessibility/SKILL.md':
        'ACCESSIBILITY EVIDENCE',
    },
    eee5555: {
      'mattstack/teams/acme/plugin/attachments/stage-evidence/SKILL.md':
        'ACME EVIDENCE',
      'mattstack/teams/globex/plugin/attachments/stage-evidence--accessibility/SKILL.md':
        'GLOBEX ACCESSIBILITY EVIDENCE',
    },
    fff6666: {
      'mattstack/teams/globex/plugin/attachments/stage-evidence/SKILL.md':
        'GLOBEX EVIDENCE',
      'mattstack/teams/globex/plugin/attachments/stage-evidence--accessibility/SKILL.md':
        'GLOBEX ACCESSIBILITY EVIDENCE',
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
    ({
      '/cache/0.30.20/attachments/pipeline/stage-ship/SKILL.md': 'SHIP DOC',
      '/cache/0.30.20/attachments/pipeline/stage-ship--accessibility/SKILL.md':
        'ACCESSIBILITY SHIP DOC',
    })[p] ?? null,
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
        pipeline: null,
      })
    ).toMatchObject({ text: 'ACME PLAN' });
  });

  it('never reads outside the plugin cache for a traversal version', async () => {
    const readFile = vi.fn(async () => 'SECRET');
    expect(
      await resolveStageDoc(deps({ readFile }), {
        packCommits: 'mattstack=0.30.20/../../../x',
        stage: 'ship',
        pipeline: null,
      })
    ).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('finds a doc at an old sha after the pack moved', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'acme=aaa1111',
        stage: 'plan',
        pipeline: null,
      })
    ).toMatchObject({ text: 'OLD PLAN', pack: 'acme' });
  });

  it('resolves a legacy plugin= token through whichever repo has the commit', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'plugin=bbb2222,mattstack=0.30.20',
        stage: 'plan',
        pipeline: null,
      })
    ).toMatchObject({ text: 'NEW PLAN', pack: 'acme' });
  });

  it('reads a version-recorded mattstack doc from the plugin cache', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'acme=bbb2222,mattstack=0.30.20',
        stage: 'ship',
        pipeline: null,
      })
    ).toMatchObject({ text: 'SHIP DOC', pack: 'mattstack' });
  });

  it('is null when no pack has the stage', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'acme=bbb2222',
        stage: 'gates',
        pipeline: null,
      })
    ).toBeNull();
  });

  it('is null with nothing recorded', async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: null,
        stage: 'plan',
        pipeline: null,
      })
    ).toBeNull();
  });

  it("reads the run's pipeline copy of a stage over the default", async () => {
    const at = (pipeline: string | null) =>
      resolveStageDoc(deps(), {
        packCommits: 'acme=ddd4444',
        stage: 'evidence',
        pipeline,
      });
    expect(await at('accessibility')).toMatchObject({
      text: 'ACCESSIBILITY EVIDENCE',
      pack: 'acme',
    });
    expect(await at('feature')).toMatchObject({ text: 'DEFAULT EVIDENCE' });
    expect(await at(null)).toMatchObject({ text: 'DEFAULT EVIDENCE' });
  });

  it("reads this pack's default over another team's copy at the same commit", async () => {
    expect(
      await resolveStageDoc(deps(), {
        packCommits: 'acme=eee5555',
        stage: 'evidence',
        pipeline: 'accessibility',
      })
    ).toMatchObject({ text: 'ACME EVIDENCE', pack: 'acme' });
  });

  describe('for a pack with no dir on this machine', () => {
    const onlyGlobex = deps({
      packDirs: async () => [
        { name: 'globex', dir: '/org/mattstack/teams/globex/plugin' },
      ],
    });

    it("reads its own default over another pack's copy", async () => {
      expect(
        await resolveStageDoc(onlyGlobex, {
          packCommits: 'acme=eee5555',
          stage: 'evidence',
          pipeline: 'accessibility',
        })
      ).toMatchObject({ text: 'ACME EVIDENCE', pack: 'acme' });
    });

    it("reads nothing when the commit holds only another pack's docs", async () => {
      expect(
        await resolveStageDoc(onlyGlobex, {
          packCommits: 'acme=fff6666',
          stage: 'evidence',
          pipeline: 'accessibility',
        })
      ).toBeNull();
    });
  });

  it('reads a version-recorded pipeline copy from the plugin cache', async () => {
    const at = (pipeline: string) =>
      resolveStageDoc(deps(), {
        packCommits: 'mattstack=0.30.20',
        stage: 'ship',
        pipeline,
      });
    expect(await at('accessibility')).toMatchObject({
      text: 'ACCESSIBILITY SHIP DOC',
    });
    expect(await at('feature')).toMatchObject({ text: 'SHIP DOC' });
  });

  it('ignores a pipeline name that could leave the stage directory', async () => {
    const readFile = vi.fn(async () => null);
    await resolveStageDoc(deps({ readFile }), {
      packCommits: 'mattstack=0.30.20',
      stage: 'ship',
      pipeline: '../../x',
    });
    expect(readFile.mock.calls).toEqual([
      ['/cache/0.30.20/attachments/pipeline/stage-ship/SKILL.md'],
    ]);
  });
});
