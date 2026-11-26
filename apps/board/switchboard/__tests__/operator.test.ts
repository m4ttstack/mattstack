import { describe, expect, test } from 'bun:test';

import { runOperator } from '../operator.ts';

const TOKEN = `sbo_${'a'.repeat(64)}`;
const ID = 'b'.repeat(32);

type Call = { url: string; method: string; auth: string | null };

function fake(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      auth: new Headers(init?.headers).get('authorization'),
    });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('operator script', () => {
  test('mint prints the new token once on stdout', async () => {
    const { fn, calls } = fake(201, { id: ID, token: TOKEN });
    const r = await runOperator(
      ['mint'],
      { SWITCHBOARD_OPERATOR_TOKEN: 'master' },
      fn
    );
    expect(r.code).toBe(0);
    expect(r.stdout.split(TOKEN).length - 1).toBe(1);
    expect(r.stderr).not.toContain(TOKEN);
    expect(calls[0]).toEqual({
      url: 'https://switchboard.mattstack.dev/orgs',
      method: 'POST',
      auth: 'Bearer master',
    });
  });

  test('token <id> calls POST /orgs/<id>/token', async () => {
    const { fn, calls } = fake(200, { id: ID, token: TOKEN });
    const r = await runOperator(
      ['token', ID],
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'master',
        SWITCHBOARD_URL: 'http://localhost:9/',
      },
      fn
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(TOKEN);
    expect(calls[0]!.url).toBe(`http://localhost:9/orgs/${ID}/token`);
    expect(calls[0]!.method).toBe('POST');
  });

  test('orgs lists the orgs', async () => {
    const { fn, calls } = fake(200, {
      orgs: [
        {
          id: ID,
          legacy: false,
          hasToken: true,
          boards: 2,
          createdAt: 1,
          tokenAt: 2,
        },
      ],
    });
    const r = await runOperator(
      ['orgs'],
      { SWITCHBOARD_OPERATOR_TOKEN: 'master' },
      fn
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(ID);
    expect(calls[0]!.method).toBe('GET');
  });

  test('refuses with no SWITCHBOARD_OPERATOR_TOKEN, and never reads SWITCHBOARD_ADMIN_TOKEN', async () => {
    const { fn, calls } = fake(200, {});
    const r = await runOperator(
      ['orgs'],
      { SWITCHBOARD_ADMIN_TOKEN: 'master' },
      fn
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('SWITCHBOARD_OPERATOR_TOKEN');
    expect(calls).toHaveLength(0);
  });

  test('refuses an http URL that is not loopback', async () => {
    const { fn, calls } = fake(200, {});
    const r = await runOperator(
      ['orgs'],
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'master',
        SWITCHBOARD_URL: 'http://example.com',
      },
      fn
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('SWITCHBOARD_URL');
    expect(calls).toHaveLength(0);
  });

  test("prints the relay's 409 rotate-master-first plainly", async () => {
    const { fn } = fake(409, { error: 'rotate-master-first' });
    const r = await runOperator(
      ['mint'],
      { SWITCHBOARD_OPERATOR_TOKEN: 'master' },
      fn
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('rotate-master-first');
    expect(r.stdout).toBe('');
  });

  test('an unknown verb prints usage', async () => {
    const { fn } = fake(200, {});
    const r = await runOperator(
      ['nope'],
      { SWITCHBOARD_OPERATOR_TOKEN: 'master' },
      fn
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage');
  });
});
