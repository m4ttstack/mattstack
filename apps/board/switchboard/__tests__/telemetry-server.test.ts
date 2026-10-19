import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { makeFetchHandler } from '../server.ts';
import { SwitchboardStore } from '../store.ts';
import { TeamInviteStore } from '../team-invites.ts';
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

function setup(viewToken: string | null = VIEW) {
  const db = new Database(':memory:');
  const store = new SwitchboardStore(db);
  const telemetry = new TelemetryStore(db);
  const handler = makeFetchHandler(
    store,
    ADMIN,
    () => NOW,
    new TeamInviteStore(db),
    telemetry,
    viewToken
  );
  const post = (body: string | ReadableStream<Uint8Array>, token?: string) =>
    handler(
      new Request('http://x/telemetry/ping', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
      })
    );
  const get = (path: string, headers: Record<string, string> = {}) =>
    handler(new Request(`http://x${path}`, { headers }));
  return { store, telemetry, post, get };
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
    expect(telemetry.snapshot(NOW).macs).toHaveLength(2);
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
        packs: [{ id: '<i>pack</i>', version: '1.0.0' }],
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
    expect(html).toContain('(unverified)');
    expect(html).toContain('running');
    expect(html).toContain(new Date(NOW).toISOString());
  });
});
