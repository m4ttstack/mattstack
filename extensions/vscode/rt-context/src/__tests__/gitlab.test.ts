import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { confirmedForgeHost, fetchMRInfo, fetchMRInfoBatch, gitlabTokenRefusal } from '../gitlab';

const TOKEN = 'glpat-test';

describe('gitlabTokenRefusal', () => {
  test('gitlab.com may take the token with no confirmed host', () => {
    expect(gitlabTokenRefusal('git@gitlab.com:acme/app.git', null)).toBeNull();
  });

  test('the confirmed host may take the token, over https or ssh', () => {
    expect(gitlabTokenRefusal('https://gitlab.corp.example/acme/app.git', 'gitlab.corp.example')).toBeNull();
    expect(gitlabTokenRefusal('git@GitLab.Corp.Example:acme/app.git', 'gitlab.corp.example')).toBeNull();
    expect(gitlabTokenRefusal('https://dev@gitlab.corp.example/acme/app.git', 'gitlab.corp.example')).toBeNull();
  });

  test('an unconfirmed host is refused, in plain words, with the command that confirms it', () => {
    const refusal = gitlabTokenRefusal('git@gitlab.evil.example:acme/app.git', 'gitlab.corp.example');
    expect(refusal).toContain('gitlab.evil.example');
    expect(refusal).toContain('rt setup gitlab connect --host gitlab.evil.example');
  });

  test('an authority that a URL parser would send elsewhere is judged by where the request would go', () => {
    expect(gitlabTokenRefusal('https://gitlab.evil.example\\@gitlab.com/acme/app.git', null)).toContain('gitlab.evil.example');
    expect(gitlabTokenRefusal('https://gitlab.evil.example?@gitlab.com/acme/app.git', null)).not.toBeNull();
    expect(gitlabTokenRefusal('https://gitlab.evil.example#@gitlab.com/acme/app.git', null)).not.toBeNull();
  });

  test('github.com is refused as not a GitLab host, with no connect command', () => {
    const refusal = gitlabTokenRefusal('git@github.com:acme/app.git', 'github.com');
    expect(refusal).toContain('github.com is not a GitLab host');
    expect(refusal).not.toContain('rt setup gitlab connect');
  });
});

describe('MR lookups only reach a host that may take the token', () => {
  let calls: string[];
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;

  beforeEach(() => {
    calls = [];
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
      calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify({ data: { project: { mergeRequests: { nodes: [] } } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
  });

  afterEach(() => fetchSpy.mockRestore());

  test('fetchMRInfo makes no request to an unconfirmed host', async () => {
    expect(await fetchMRInfo(TOKEN, 'git@gitlab.evil.example:acme/app.git', 'feature', null)).toBeNull();
    expect(calls).toEqual([]);
  });

  test('fetchMRInfoBatch makes no request to an unconfirmed host', async () => {
    const results = await fetchMRInfoBatch(TOKEN, 'git@gitlab.evil.example:acme/app.git', ['feature'], 'gitlab.corp.example');
    expect(results.size).toBe(0);
    expect(calls).toEqual([]);
  });

  test('fetchMRInfo makes no request when the authority hides another host', async () => {
    expect(await fetchMRInfo(TOKEN, 'https://gitlab.evil.example\\@gitlab.com/acme/app.git', 'feature', null)).toBeNull();
    expect(calls).toEqual([]);
  });

  test('fetchMRInfo asks only the confirmed host', async () => {
    await fetchMRInfo(TOKEN, 'git@gitlab.corp.example:acme/app.git', 'feature', 'gitlab.corp.example');
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) expect(new URL(url).host).toBe('gitlab.corp.example');
  });
});

describe('confirmedForgeHost', () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'rt-context-forge-host-')));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const writeUserStore = (value: unknown) => {
    mkdirSync(join(home, '.mattstack', 'user'), { recursive: true });
    writeFileSync(join(home, '.mattstack', 'user', 'settings.user.jsonc'), JSON.stringify({ 'rt.integrations': value }));
  };

  test('reads the host the person confirmed', () => {
    writeUserStore({ forgeHost: 'gitlab.corp.example' });
    expect(confirmedForgeHost()).toBe('gitlab.corp.example');
  });

  test('is null when nothing was confirmed', () => {
    expect(confirmedForgeHost()).toBeNull();
  });
});
