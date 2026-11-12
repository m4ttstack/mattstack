/**
 * The live harness's GitLab pacer: no identity sends more than `perMinute`
 * requests to GitLab in any rolling minute, and the run can say how long it
 * waited. Fake clock, fake fetch: nothing here reaches a forge.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabPacer } from './live/gitlabPacer.ts';

function harness(perMinute = 80) {
  let now = 1_000_000;
  const waits: number[] = [];
  const lines: string[] = [];
  const sent: Array<{ url: string; at: number }> = [];
  const pacer = new GitLabPacer({
    perMinute,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    log: (line) => lines.push(line),
  });
  const inner = (async (input: string | URL | Request) => {
    sent.push({ url: input instanceof Request ? input.url : String(input), at: now });
    return new Response('{}');
  }) as typeof fetch;
  return { pacer, fetch: pacer.wrap(inner), waits, lines, sent, advance: (ms: number) => (now += ms), now: () => now };
}

const asOwner = { headers: { 'PRIVATE-TOKEN': 'owner-secret' } };
const asApprover = { headers: { Authorization: 'Bearer approver-secret' } };

describe('GitLabPacer', () => {
  test('a burst of perMinute requests goes out without waiting', async () => {
    const h = harness();
    for (let i = 0; i < 80; i++) await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    expect(h.waits).toEqual([]);
    expect(h.sent).toHaveLength(80);
  });

  test('the next request waits until the oldest leaves the rolling minute', async () => {
    const h = harness();
    const start = h.now();
    for (let i = 0; i < 80; i++) await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    h.advance(10_000);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    expect(h.waits).toEqual([50_000]);
    expect(h.sent.at(-1)!.at).toBe(start + 60_000);
  });

  test('identities have separate budgets, keyed by PRIVATE-TOKEN or bearer token', async () => {
    const h = harness(2);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    await h.fetch('https://gitlab.com/api/graphql', { method: 'POST', ...asApprover });
    await h.fetch(new Request('https://gitlab.com/api/v4/user', { headers: { 'private-token': 'third-secret' } }));
    expect(h.waits).toEqual([]);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    expect(h.waits).toEqual([60_000]);
  });

  test('requests to other hosts are neither paced nor counted', async () => {
    const h = harness(1);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    for (let i = 0; i < 5; i++) await h.fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer owner-secret' } });
    expect(h.waits).toEqual([]);
    expect(h.pacer.summary()).toContain('1 GitLab request');
  });

  test('concurrent requests from one identity still respect the limit', async () => {
    const h = harness(3);
    await Promise.all(Array.from({ length: 5 }, () => h.fetch('https://gitlab.com/api/v4/user', asOwner)));
    expect(h.sent).toHaveLength(5);
    expect(h.waits.reduce((a, b) => a + b, 0)).toBe(60_000);
    const times = h.sent.map((s) => s.at);
    for (let i = 3; i < times.length; i++) expect(times[i]! - times[i - 3]!).toBeGreaterThanOrEqual(60_000);
  });

  test('the summary names the total wait per identity and never the token', async () => {
    const h = harness(1);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    await h.fetch('https://gitlab.com/api/v4/user', asApprover);
    expect(h.pacer.totalWaitMs).toBe(60_000);
    const summary = h.pacer.summary();
    expect(summary).toBe(
      'GitLab pacing: 3 GitLab requests from 2 identities at most 1 a minute each; waited 60.0s in total (identity 1: 2 requests, waited 60.0s; identity 2: 1 request, waited 0.0s)',
    );
    expect([summary, ...h.lines].join('\n')).not.toMatch(/secret/);
    expect(h.lines).toEqual(['  [gitlab pacer] identity 1 sent 1 request in the last minute; waiting 60.0s']);
  });
});
