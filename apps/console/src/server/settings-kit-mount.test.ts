// @vitest-environment node
import { createApp } from '@mattstack/app-server/app';
import type { RtSettingsApi } from '@mattstack/settings-kit/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { createSettingsRoutes, type SettingsDeps } from './settings';

const DEFS: Record<string, Record<string, unknown>> = {
  'rt.logLevel': {
    key: 'rt.logLevel',
    type: 'string',
    scopes: ['machine', 'user'],
    merge: 'replace',
    description: 'Daemon log level.',
    default: 'info',
  },
  'rt.repoRoots': {
    key: 'rt.repoRoots',
    type: 'array',
    scopes: ['machine'],
    merge: 'replace',
    description: 'Scan roots.',
    schema: { type: 'array', items: { type: 'string' } },
  },
  'support.enabled': {
    key: 'support.enabled',
    type: 'boolean',
    scopes: ['org'],
    merge: 'replace',
    description: 'Support requests.',
  },
  'rt.cron': {
    key: 'rt.cron',
    type: 'object',
    scopes: ['machine'],
    merge: 'deep',
    description: 'Scheduled jobs.',
  },
};

const writes: unknown[][] = [];
const unsets: unknown[][] = [];

const RT = {
  allDefs: () => Object.values(DEFS),
  getDef: (key: string) => DEFS[key],
  isMigrated: () => true,
  explainSetting: () => [
    { scope: 'default', file: null, present: true, value: 'info' },
  ],
  validateValue: () => ({ ok: true }),
  listOrgs: () => [],
  activeTeam: () => ({
    org: null,
    team: null,
    reason: 'no-org',
    username: null,
    listedOn: [],
  }),
  setSetting: (...args: unknown[]) => {
    writes.push(args);
  },
  unsetSetting: (...args: unknown[]) => {
    unsets.push(args);
    return true;
  },
} as unknown as RtSettingsApi;

const app = createSettingsRoutes({ rt: RT });

const peer = (address: string) => ({ requestIP: () => ({ address }) });
const LOOPBACK = peer('127.0.0.1');

function post(
  host: string,
  body: unknown,
  type = 'application/json',
  headers: Record<string, string> = {},
  verb = 'set'
) {
  return new Request(`http://${host}/api/settings/${verb}`, {
    method: 'POST',
    headers: { 'content-type': type, host, ...headers },
    body: JSON.stringify(body),
  });
}

const LOG_LEVEL = { key: 'rt.logLevel', scope: 'machine', value: 'debug' };

const UNSET_LOG_LEVEL = { key: 'rt.logLevel', scope: 'machine' };

beforeEach(() => {
  writes.length = 0;
  unsets.length = 0;
});

describe('settings-kit behind console', () => {
  it('serves the registry with shaped composites writable', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/settings/defs')
    );
    expect(res.status).toBe(200);
    const { defs } = (await res.json()) as {
      defs: { key: string; writable: boolean }[];
    };
    expect(defs.map(d => d.key)).toEqual([
      'rt.logLevel',
      'rt.repoRoots',
      'support.enabled',
      'rt.cron',
    ]);
    expect(defs.find(d => d.key === 'rt.repoRoots')?.writable).toBe(true);
    expect(defs.find(d => d.key === 'rt.cron')?.writable).toBe(false);
  });

  it('writes from a local host', async () => {
    const res = await app.fetch(post('localhost', LOG_LEVEL), LOOPBACK);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it('refuses a write that arrives through a public host', async () => {
    const res = await app.fetch(
      post('console.example.dev', LOG_LEVEL),
      LOOPBACK
    );
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('refuses a write the public edge stamped, even with a local host', async () => {
    const res = await app.fetch(
      post('localhost', LOG_LEVEL, 'application/json', {
        'x-mattstack-edge': 'public',
      }),
      LOOPBACK
    );
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('refuses a write from a peer off this machine', async () => {
    const res = await app.fetch(post('localhost', LOG_LEVEL), peer('10.0.0.2'));
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('unsets from a local host', async () => {
    const res = await app.fetch(
      post('localhost', UNSET_LOG_LEVEL, 'application/json', {}, 'unset'),
      LOOPBACK
    );
    expect(res.status).toBe(200);
    expect(unsets).toHaveLength(1);
  });

  it('refuses an unset that arrives through a public host', async () => {
    const res = await app.fetch(
      post(
        'console.example.dev',
        UNSET_LOG_LEVEL,
        'application/json',
        {},
        'unset'
      ),
      LOOPBACK
    );
    expect(res.status).toBe(403);
    expect(unsets).toHaveLength(0);
  });

  it('refuses an unset the public edge stamped, even with a local host', async () => {
    const res = await app.fetch(
      post(
        'localhost',
        UNSET_LOG_LEVEL,
        'application/json',
        { 'x-mattstack-edge': 'public' },
        'unset'
      ),
      LOOPBACK
    );
    expect(res.status).toBe(403);
    expect(unsets).toHaveLength(0);
  });

  it('keeps the peer check when mounted in the served app', async () => {
    const served = createApp({
      name: 'console',
      version: '0.0.0',
      routes: createSettingsRoutes({ rt: RT }),
      shellHandoff: async () => null,
    });
    const refused = await served.fetch(
      post('localhost', LOG_LEVEL),
      peer('10.0.0.2')
    );
    expect(refused.status).toBe(403);
    expect(writes).toHaveLength(0);
    const allowed = await served.fetch(post('localhost', LOG_LEVEL), LOOPBACK);
    expect(allowed.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it('a caller cannot drop the write gate by passing allowWrite: undefined', async () => {
    const loose = createSettingsRoutes({
      rt: RT,
      allowWrite: undefined,
    } as Parameters<typeof createSettingsRoutes>[0]);
    const res = await loose.fetch(
      post('localhost', LOG_LEVEL),
      peer('10.0.0.2')
    );
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('refuses a non-JSON write', async () => {
    const res = await app.fetch(
      post(
        'localhost',
        { key: 'rt.logLevel', scope: 'machine', value: 'debug' },
        'text/plain'
      )
    );
    expect(res.status).toBe(415);
  });

  it('refuses a composite with no shape', async () => {
    const res = await app.fetch(
      post('localhost', { key: 'rt.cron', scope: 'machine', value: {} })
    );
    expect(res.status).toBe(400);
  });

  describe('turning the org support switch on', () => {
    const SUPPORT_ON = { key: 'support.enabled', scope: 'org', value: true };
    const calls: unknown[] = [];
    let answer: Awaited<ReturnType<SettingsDeps['enableSupport']>>;
    const withSupport = createSettingsRoutes(
      { rt: RT },
      {
        enableSupport: async payload => {
          calls.push([payload, writes.length]);
          return answer;
        },
      }
    );

    beforeEach(() => {
      calls.length = 0;
      answer = { ok: true, data: { enabled: true, host: 'Alex' } };
    });

    it('makes the key before the setting is written', async () => {
      const res = await withSupport.fetch(
        post('localhost', SUPPORT_ON),
        LOOPBACK
      );
      expect(res.status).toBe(200);
      expect(calls).toEqual([[{ on: true }, 0]]);
      expect(writes).toHaveLength(1);
    });

    it('leaves the switch off and says why when the daemon refuses', async () => {
      const said = 'No one is set to answer support requests yet.';
      answer = {
        ok: false,
        error: `support: ${said}`,
        failure: { code: 'support-no-host', message: said },
      };
      const res = await withSupport.fetch(
        post('localhost', SUPPORT_ON),
        LOOPBACK
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: said });
      expect(writes).toHaveLength(0);
    });

    it('never claims support is off when rt does not answer', async () => {
      answer = { ok: false, error: 'connect ENOENT /tmp/rt.sock' };
      const res = await withSupport.fetch(
        post('localhost', SUPPORT_ON),
        LOOPBACK
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'rt did not answer. Reload to see whether support is on.',
      });
      expect(writes).toHaveLength(0);
    });

    it('names the fix when rt is older than the console', async () => {
      answer = {
        ok: false,
        code: 'unknown-command',
        error: 'daemon at version 1.0.0 does not know "support:enable"',
      } as typeof answer;
      const res = await withSupport.fetch(
        post('localhost', SUPPORT_ON),
        LOOPBACK
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error:
          'rt is older than this app, so nothing changed. Restart rt, then try again.',
      });
      expect(writes).toHaveLength(0);
    });

    it('leaves every other write to the kit', async () => {
      for (const body of [
        { ...SUPPORT_ON, value: false },
        { ...SUPPORT_ON, value: 'true' },
        { ...SUPPORT_ON, scope: 'user' },
        LOG_LEVEL,
      ])
        await withSupport.fetch(post('localhost', body), LOOPBACK);
      await withSupport.fetch(
        post('localhost', SUPPORT_ON, 'application/json', {}, 'unset'),
        LOOPBACK
      );
      await withSupport.fetch(
        post('localhost', SUPPORT_ON, 'text/plain'),
        LOOPBACK
      );
      expect(calls).toEqual([]);
    });

    it('never asks the daemon for a write that is not local', async () => {
      const refused = [
        await withSupport.fetch(
          post('localhost', SUPPORT_ON),
          peer('10.0.0.2')
        ),
        await withSupport.fetch(
          post('console.example.dev', SUPPORT_ON),
          LOOPBACK
        ),
      ];
      expect(refused.map(r => r.status)).toEqual([403, 403]);
      expect(calls).toEqual([]);
    });
  });

  it('404s an unknown settings path instead of falling through silently', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/settings/nope')
    );
    expect(res.status).toBe(404);
  });
});
