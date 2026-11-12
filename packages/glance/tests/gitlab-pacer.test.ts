/**
 * The live harness's GitLab pacer: each identity's GitLab requests go out at
 * least a minute / `perMinute` apart, so none sends more than `perMinute` in
 * any rolling minute, and the run can say how long it waited. Fake clock,
 * fake fetch: nothing here reaches a forge.
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
  test('one identity sends at most one request per minute / perMinute', async () => {
    const h = harness(80);
    for (let i = 0; i < 3; i++) await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    expect(h.waits).toEqual([750, 750]);
  });

  test('time already passed since the last request counts toward the spacing', async () => {
    const h = harness(80);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    h.advance(500);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    expect(h.waits).toEqual([250]);
  });

  test('no rolling minute ever holds more than perMinute requests', async () => {
    const h = harness(80);
    for (let i = 0; i < 200; i++) await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    const times = h.sent.map((s) => s.at);
    for (let i = 80; i < times.length; i++) expect(times[i]! - times[i - 80]!).toBeGreaterThanOrEqual(60_000);
  });

  test('identities have separate budgets', async () => {
    const h = harness(2);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    await h.fetch('https://gitlab.com/api/graphql', { method: 'POST', ...asApprover });
    await h.fetch(new Request('https://gitlab.com/api/v4/user', { headers: { 'private-token': 'third-secret' } }));
    expect(h.waits).toEqual([]);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    expect(h.waits).toEqual([30_000]);
  });

  test('one token is one identity whether it rides PRIVATE-TOKEN or a bearer header', async () => {
    const h = harness(2);
    await h.fetch('https://gitlab.com/api/v4/user', { headers: { 'PRIVATE-TOKEN': 'same-secret' } });
    await h.fetch('https://gitlab.com/api/graphql', { method: 'POST', headers: { Authorization: 'bearer same-secret' } });
    expect(h.waits).toEqual([30_000]);
    expect(h.pacer.summary()).toContain('from 1 identity');
  });

  test('requests to other hosts are neither paced nor counted', async () => {
    const h = harness(1);
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    for (let i = 0; i < 5; i++) await h.fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer owner-secret' } });
    expect(h.waits).toEqual([]);
    expect(h.pacer.summary()).toContain('1 GitLab request');
  });

  test('concurrent requests from one identity are still spaced', async () => {
    const h = harness(3);
    await Promise.all(Array.from({ length: 4 }, () => h.fetch('https://gitlab.com/api/v4/user', asOwner)));
    expect(h.sent).toHaveLength(4);
    const times = h.sent.map((s) => s.at);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(20_000);
  });

  test('a request whose signal aborted while it queued takes no slot', async () => {
    const h = harness(2);
    const caller = new AbortController();
    await h.fetch('https://gitlab.com/api/v4/user', asOwner);
    const queued = h.fetch('https://gitlab.com/api/v4/user', { ...asOwner, signal: caller.signal });
    caller.abort();
    await queued.catch(() => {});
    expect(h.sent).toHaveLength(1);
    expect(h.pacer.summary()).toContain('1 GitLab request');
    expect(h.lines.at(-1)).toBe('  [gitlab pacer] identity 1: a request was cancelled while it waited; it took no slot');
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
  });
});
