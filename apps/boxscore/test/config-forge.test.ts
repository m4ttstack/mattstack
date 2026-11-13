import { afterEach, describe, expect, it } from 'vitest';

import {
  __setRosterReader,
  __setSettingReader,
  readSettings,
} from '../src/server/config/index.js';

const store = (values: Record<string, unknown>) => {
  __setSettingReader(<T>(key: string) => values[key] as T | undefined);
  __setRosterReader(() => []);
};

afterEach(() => {
  __setSettingReader(null);
  __setRosterReader(null);
});

describe('readSettings forge', () => {
  it('reads forge github and the github.com base url', () => {
    store({
      'mattstack.integrations': {
        forge: { provider: 'github', host: 'github.com' },
      },
    });
    const s = readSettings();
    expect(s.forge).toBe('github');
    expect(s.baseUrl).toBe('https://github.com');
  });

  it('an empty github host means github.com', () => {
    store({ 'mattstack.integrations': { forge: { provider: 'github' } } });
    expect(readSettings().baseUrl).toBe('https://github.com');
  });

  it('a github enterprise host gets no base url', () => {
    store({
      'mattstack.integrations': {
        forge: { provider: 'github', host: 'ghe.example' },
      },
    });
    const s = readSettings();
    expect(s.forge).toBe('github');
    expect(s.baseUrl).toBe('');
    expect(s.declaredHost).toBe('ghe.example');
  });

  it('github ignores the confirmed gitlab host', () => {
    store({
      'mattstack.integrations': { forge: { provider: 'github' } },
      'rt.integrations': { forgeHost: 'gitlab.example' },
    });
    expect(readSettings().baseUrl).toBe('https://github.com');
  });

  it('absent or gitlab provider reads as gitlab', () => {
    store({});
    expect(readSettings().forge).toBe('gitlab');
    store({
      'mattstack.integrations': {
        forge: { provider: 'gitlab', host: 'gitlab.example' },
      },
      'rt.integrations': { forgeHost: 'gitlab.example' },
    });
    const s = readSettings();
    expect(s.forge).toBe('gitlab');
    expect(s.baseUrl).toBe('https://gitlab.example');
  });
});
