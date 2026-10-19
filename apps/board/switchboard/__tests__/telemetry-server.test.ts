import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { makeFetchHandler, TELEMETRY_PINGS_PER_HOUR } from '../server.ts';
import { SwitchboardStore } from '../store.ts';
import { sourceIp, TeamInviteStore } from '../team-invites.ts';
import { TelemetryStore, type TelemetryPing } from '../telemetry.ts';

const ADMIN = 'admin-secret';
const VIEW = 'view-secret';
const NOW = 1_000_000_000_000;

const ping = (over: Partial<TelemetryPing> = {}): TelemetryPing => ({
  installId: 'install-a',
  usernames: ['alice'],
  appVersion: '2.0.0',
  rtVersion: '2.0.0',
  pluginVersion: '0.30.0',
  flavor: 'prod',
  macosVersion: '15.1',
  migrationsRecorded: [],
  migrationsKnown: [],
  legacyDirs: [],
  orgs: [],
  packs: [],
  ...over,
});

function setup(viewToken: string | null = VIEW, maxMacs?: number) {
  const db = new Database(':memory:');
  const store = new SwitchboardStore(db);
  const telemetry = new TelemetryStore(db, maxMacs);
  const clock = { t: NOW };
  const handler = makeFetchHandler(
    store,
    ADMIN,
    () => clock.t,
    new TeamInviteStore(db),
    telemetry,
    viewToken
  );
  const post = (
    body: string | ReadableStream<Uint8Array>,
    token?: string,
    extra: Record<string, string> = {}
  ) =>
    handler(
      new Request('http://x/telemetry/ping', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...extra,
        },
        body,
      })
    );
  const get = (path: string, headers: Record<string, string> = {}) =>
    handler(new Request(`http://x${path}`, { headers }));
  return { store, telemetry, clock, post, get };
}

describe('POST /telemetry/ping', () => {
  test('a valid board token stores the verified username', async () => {
    const { store, telemetry, post } = setup();
    const { token } = store.registerBoard('Ada');
    const res = await post(JSON.stringify(ping()), token);
    expect(res.status).toBe(204);
    const [row] = telemetry.snapshot(NOW).macs;
    expect(row?.installId).toBe('install-a');
    expect(row?.verifiedUsername).toBe('ada');
    expect(row?.lastSeen).toBe(NOW);
  });

  test('an invalid or missing token still records, unverified', async () => {
    const { telemetry, post } = setup();
    expect((await post(JSON.stringify(ping()), 'stale-token')).status).toBe(
      204
    );
    expect(telemetry.snapshot(NOW).macs[0]?.verifiedUsername).toBeNull();
    expect(
      (await post(JSON.stringify(ping({ installId: 'install-b' })))).status
    ).toBe(204);
    const macs = telemetry.snapshot(NOW).macs;
    expect(macs).toHaveLength(2);
    expect(macs.map(m => m.verifiedUsername)).toEqual([null, null]);
  });

  test('a body that is not a ping is a 400 and stores nothing', async () => {
    const { telemetry, post } = setup();
    const { installId: _omitted, ...noInstallId } = ping();
    for (const body of [
      'not json',
      '[]',
      JSON.stringify(noInstallId),
      JSON.stringify(ping({ flavor: 'beta' as 'prod' })),
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(telemetry.snapshot(NOW).macs).toHaveLength(0);
  });

  test('a body over 64 KB is a 400 and stores nothing', async () => {
    const { telemetry, post } = setup();
    const big = JSON.stringify(ping({ installId: 'x'.repeat(70_000) }));
    expect((await post(big)).status).toBe(400);
    expect(telemetry.snapshot(NOW).macs).toHaveLength(0);
  });

  test('a declared content-length over 64 KB is a 400 without reading', async () => {
    const { telemetry, post } = setup();
    const res = await post(JSON.stringify(ping()), undefined, {
      'content-length': '100000',
    });
    expect(res.status).toBe(400);
    expect(telemetry.snapshot(NOW).macs).toHaveLength(0);
  });

  test('an oversized streamed body with no content-length is cut off', async () => {
    const { telemetry, post } = setup();
    const chunk = new TextEncoder().encode('x'.repeat(10_000));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 100) controller.enqueue(chunk);
        else controller.close();
      },
    });
    expect((await post(body)).status).toBe(400);
    expect(sent).toBeLessThan(20);
    expect(telemetry.snapshot(NOW).macs).toHaveLength(0);
  });

  test('a source over the hourly limit gets a 429 and stores nothing', async () => {
    const { telemetry, clock, post } = setup();
    for (let i = 0; i < TELEMETRY_PINGS_PER_HOUR; i++) {
      expect((await post(JSON.stringify(ping()))).status).toBe(204);
    }
    const over = await post(JSON.stringify(ping({ installId: 'install-b' })));
    expect(over.status).toBe(429);
    expect(telemetry.snapshot(NOW).macs.map(m => m.installId)).toEqual([
      'install-a',
    ]);
    clock.t += 60 * 60_000;
    expect(
      (await post(JSON.stringify(ping({ installId: 'install-b' })))).status
    ).toBe(204);
  });

  test('the limit is per source address', async () => {
    const { post } = setup();
    for (let i = 0; i < TELEMETRY_PINGS_PER_HOUR; i++) {
      await post(JSON.stringify(ping()), undefined, {
        'x-forwarded-for': '198.51.100.1',
      });
    }
    const other = await post(JSON.stringify(ping()), undefined, {
      'x-forwarded-for': '198.51.100.2',
    });
    expect(other.status).toBe(204);
  });

  test('a new install id is refused with a 503 once the table is full', async () => {
    const { telemetry, post } = setup(VIEW, 2);
    for (const installId of ['install-a', 'install-b'])
      expect((await post(JSON.stringify(ping({ installId })))).status).toBe(
        204
      );
    const refused = await post(
      JSON.stringify(ping({ installId: 'install-c' }))
    );
    expect(refused.status).toBe(503);
    expect(
      telemetry
        .snapshot(NOW)
        .macs.map(m => m.installId)
        .sort()
    ).toEqual(['install-a', 'install-b']);
  });

  test('a known install id still updates when the table is full', async () => {
    const { telemetry, post } = setup(VIEW, 1);
    expect((await post(JSON.stringify(ping()))).status).toBe(204);
    const res = await post(JSON.stringify(ping({ rtVersion: '2.1.0' })));
    expect(res.status).toBe(204);
    expect(telemetry.snapshot(NOW).macs[0]?.rtVersion).toBe('2.1.0');
  });

  test('the limit keys on X-Real-IP ahead of X-Forwarded-For', async () => {
    const { post } = setup();
    for (let i = 0; i < TELEMETRY_PINGS_PER_HOUR; i++) {
      await post(JSON.stringify(ping()), undefined, {
        'x-real-ip': '198.51.100.1',
        'x-forwarded-for': `203.0.113.${i % 250}`,
      });
    }
    const same = await post(JSON.stringify(ping()), undefined, {
      'x-real-ip': '198.51.100.1',
      'x-forwarded-for': '203.0.113.250',
    });
    expect(same.status).toBe(429);
  });

  test('only POST is allowed', async () => {
    const { get } = setup();
    expect((await get('/telemetry/ping')).status).toBe(405);
  });
});

describe('GET /telemetry', () => {
  test('is 404 when no view token is configured', async () => {
    const { get } = setup(null);
    expect((await get(`/telemetry?key=${VIEW}`)).status).toBe(404);
  });

  test('rejects a missing or wrong key', async () => {
    const { get } = setup();
    expect((await get('/telemetry')).status).toBe(401);
    expect((await get('/telemetry?key=nope')).status).toBe(401);
    expect(
      (await get('/telemetry', { authorization: 'Bearer nope' })).status
    ).toBe(401);
  });

  test('serves the readout for ?key= and for a bearer header', async () => {
    const { get } = setup();
    for (const res of [
      await get(`/telemetry?key=${VIEW}`),
      await get('/telemetry', { authorization: `Bearer ${VIEW}` }),
    ]) {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'"
      );
      const html = await res.text();
      for (const heading of [
        'Macs',
        'Versions',
        'Retirement checks',
        'Recent updates',
      ]) {
        expect(html).toContain(heading);
      }
    }
  });

  test('an empty view token never opens the page', async () => {
    const { get } = setup('');
    expect((await get('/telemetry?key=')).status).toBe(404);
  });

  test('every section marks a spoofed name as unverified', async () => {
    const { telemetry, get } = setup();
    telemetry.record(ping({ usernames: ['mallory'] }), null, NOW);
    telemetry.record(
      ping({
        usernames: ['mallory'],
        rtVersion: '2.1.0',
        migrationsKnown: ['m1'],
        legacyDirs: ['.rt'],
        orgs: [{ org: 'acme', layout: 3 }],
      }),
      null,
      NOW + 1
    );
    const html = await (await get(`/telemetry?key=${VIEW}`)).text();
    expect(
      html.split('mallory (unverified)').length - 1
    ).toBeGreaterThanOrEqual(5);
    expect(html).not.toMatch(/mallory(?! \(unverified\))/);
  });

  test('the admin token does not open the page', async () => {
    const { get } = setup();
    expect((await get(`/telemetry?key=${ADMIN}`)).status).toBe(401);
  });

  test('escapes every ping string and marks the unverified', async () => {
    const { telemetry, get } = setup();
    telemetry.record(
      ping({
        usernames: ['<script>x</script>'],
        orgs: [{ org: '<b>org</b>', layout: 3 }],
        packs: [
          { id: '<i>pack</i>@mkt', version: '1.0.0' },
          { id: 'bare@mkt', version: null },
        ],
        legacyDirs: ['<u>dir</u>'],
        migrationsKnown: ['<m>1'],
      }),
      null,
      NOW
    );
    const html = await (await get(`/telemetry?key=${VIEW}`)).text();
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x');
    for (const raw of ['<b>org', '<i>pack', '<u>dir', '<m>1']) {
      expect(html).not.toContain(raw);
    }
    for (const escaped of [
      '&lt;b&gt;org&lt;/b&gt;',
      '&lt;i&gt;pack&lt;/i&gt;',
      '&lt;u&gt;dir&lt;/u&gt;',
      '&lt;m&gt;1',
    ]) {
      expect(html).toContain(escaped);
    }
    expect(html).toContain('(unverified)');
    expect(html).toContain(`running (${new Date(NOW).toISOString()})`);
    expect(html).toContain('&lt;b&gt;org&lt;/b&gt;:3');
    expect(html).toContain('&lt;i&gt;pack&lt;/i&gt;@mkt (1.0.0)');
    expect(html).toContain('bare@mkt<');
  });
});

describe('sourceIp', () => {
  const from = (headers: Record<string, string>) =>
    sourceIp(new Request('http://x/', { headers }));

  test('prefers x-real-ip, then the first x-forwarded-for entry', () => {
    expect(
      from({ 'x-real-ip': '198.51.100.9', 'x-forwarded-for': '203.0.113.1' })
    ).toBe('198.51.100.9');
    expect(from({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' })).toBe(
      '203.0.113.1'
    );
    expect(from({})).toBe('unknown');
  });
});
