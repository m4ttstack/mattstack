import { describe, expect, test } from 'bun:test';

import type { BoardConfig } from '../config.ts';
import { armedLatchBody } from '../latch/markers.ts';
import type { AuditEntry } from '../triage/audit.ts';
import type { TriageForgePlan } from '../triage/forge-plan.ts';
import { latchPassSetup } from '../triage/latch-setup.ts';
import type { LatchMrFacts } from '../triage/latch.ts';

const github = {
  forge: { kind: 'github', host: 'https://github.test' },
  projects: ['o/r'],
  rtRepos: {},
} as unknown as BoardConfig;
const gitlab = {
  forge: { kind: 'gitlab', host: 'https://gitlab.example.com' },
  projects: ['g/p'],
  rtRepos: {},
} as unknown as BoardConfig;

const githubPlan: TriageForgePlan = {
  identity: { recorded: 'alice' },
  asks: false,
  latch: true,
  lines: [],
};
const gitlabPlan: TriageForgePlan = {
  identity: 'gitlab-token',
  asks: true,
  latch: true,
  lines: [],
};

const fact = (iid: number, rtRepo: string): LatchMrFacts => ({
  mrUrl: `https://github.test/${rtRepo}/pull/${iid}`,
  iid,
  projectId: null,
  projectPath: rtRepo,
  rtRepo,
  approvedBySelf: false,
});

function harness(verdicts: Record<string, string | true> = {}) {
  const verified: string[] = [];
  const audits: AuditEntry[] = [];
  const lines: string[] = [];
  const calls: Array<{ verb: string; payload: Record<string, unknown> }> = [];
  let reply: unknown = { ok: false, error: 'unset' };
  const deps = {
    verify: async (repoName: string, self: string) => {
      verified.push(`${repoName}|${self}`);
      const v = verdicts[repoName] ?? true;
      return v === true
        ? ({ ok: true } as const)
        : ({ ok: false, login: v } as const);
    },
    command: (async (verb: string, payload: Record<string, unknown>) => {
      calls.push({ verb, payload });
      return reply;
    }) as never,
    appendAudit: (e: AuditEntry) => audits.push(e),
    now: () => 5_000,
    log: (line: string) => lines.push(line),
  };
  return {
    deps,
    verified,
    audits,
    lines,
    calls,
    answer: (r: unknown) => {
      reply = r;
    },
  };
}

const note = (
  username: string,
  createdAt: string,
  body = 'a finding',
  system = false
) => ({
  id: 1,
  body,
  author: { username },
  createdAt,
  system,
});

describe('latchPassSetup on a GitHub team', () => {
  test('runs as the recorded username through the GitHub gateway', () => {
    const h = harness();
    const setup = latchPassSetup(
      {
        config: github,
        plan: githubPlan,
        gitlabToken: null,
        username: 'alice',
      },
      h.deps
    );
    expect(setup?.self).toBe('alice');
    expect(setup?.gateway.forge).toBe('github');
  });

  test('scope verifies each repo once and keeps a verified repo', async () => {
    const h = harness();
    const setup = latchPassSetup(
      {
        config: github,
        plan: githubPlan,
        gitlabToken: null,
        username: 'alice',
      },
      h.deps
    )!;
    const mrs = [fact(1, 'repo-a'), fact(2, 'repo-a')];
    expect(await setup.scope(mrs)).toEqual(mrs);
    expect(h.verified).toEqual(['repo-a|alice']);
    expect(h.audits).toEqual([]);
    expect(h.lines).toEqual([]);
  });

  test('scope drops an unverified repo with one line and one audit', async () => {
    const h = harness({ 'repo-b': 'ivasco' });
    const setup = latchPassSetup(
      {
        config: github,
        plan: githubPlan,
        gitlabToken: null,
        username: 'alice',
      },
      h.deps
    )!;
    const kept = fact(1, 'repo-a');
    expect(
      await setup.scope([kept, fact(2, 'repo-b'), fact(3, 'repo-b')])
    ).toEqual([kept]);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toContain('ivasco');
    expect(h.lines[0]).toContain('alice');
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      event: 'latch',
      action: 'identity-mismatch',
      mrUrl: fact(2, 'repo-b').mrUrl,
      iid: 2,
      ts: 5_000,
    });
  });

  test('countNew refreshes the discussions and counts new reviewer threads', async () => {
    const h = harness();
    const setup = latchPassSetup(
      {
        config: github,
        plan: githubPlan,
        gitlabToken: null,
        username: 'alice',
      },
      h.deps
    )!;
    const launchAt = Date.parse('2026-11-10T12:00:00Z');
    h.answer({
      ok: true,
      data: {
        fetchedAt: 1,
        discussions: [
          { id: 'a', notes: [note('Alice', '2026-11-10T12:00:00Z')] },
          { id: 'b', notes: [note('alice', '2026-11-10T13:00:00Z')] },
          { id: 'c', notes: [note('alice', '2026-11-10T11:00:00Z')] },
          { id: 'd', notes: [note('bob', '2026-11-10T13:00:00Z')] },
          {
            id: 'e',
            notes: [
              note('alice', '2026-11-10T13:00:00Z', armedLatchBody('![x](y)')),
            ],
          },
          {
            id: 'f',
            notes: [note('alice', '2026-11-10T13:00:00Z', 'moved', true)],
          },
        ],
      },
    });
    expect(await setup.countNew(fact(4, 'repo-a'), launchAt)).toBe(2);
    expect(h.calls).toEqual([
      { verb: 'discussions:refresh', payload: { repoName: 'repo-a', iid: 4 } },
    ]);
  });

  test('countNew answers null when the refresh fails', async () => {
    const h = harness();
    const setup = latchPassSetup(
      {
        config: github,
        plan: githubPlan,
        gitlabToken: null,
        username: 'alice',
      },
      h.deps
    )!;
    h.answer({ ok: false, error: 'rt daemon unreachable' });
    expect(await setup.countNew(fact(4, 'repo-a'), 0)).toBeNull();
  });

  test('a plan with the latch off gives no setup', () => {
    const h = harness();
    expect(
      latchPassSetup(
        {
          config: github,
          plan: { identity: null, asks: false, latch: false, lines: [] },
          gitlabToken: null,
          username: '',
        },
        h.deps
      )
    ).toBeNull();
  });
});

describe('latchPassSetup on a GitLab team', () => {
  test('a token gives the GitLab gateway and scope keeps every MR', async () => {
    const h = harness({ 'repo-a': 'ivasco' });
    const setup = latchPassSetup(
      {
        config: gitlab,
        plan: gitlabPlan,
        gitlabToken: 'glpat-fake',
        username: 'alice',
      },
      h.deps
    )!;
    expect(setup.self).toBe('alice');
    expect(setup.gateway.forge).toBe('gitlab');
    const mrs = [fact(1, 'repo-a')];
    expect(await setup.scope(mrs)).toBe(mrs);
    expect(h.verified).toEqual([]);
  });

  test('no token gives no setup', () => {
    const h = harness();
    expect(
      latchPassSetup(
        {
          config: gitlab,
          plan: gitlabPlan,
          gitlabToken: null,
          username: 'alice',
        },
        h.deps
      )
    ).toBeNull();
  });
});
