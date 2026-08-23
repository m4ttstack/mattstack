import { describe, test, expect, beforeEach } from 'bun:test';
import { getClientAssets, injectClientAssets, resetClientAssets } from '../src/server/client-assets.ts';

describe('client assets', () => {
  beforeEach(() => {
    resetClientAssets();
  });

  test('an injected bundle is served instead of building from source', async () => {
    injectClientAssets({ appJs: 'embedded' });
    expect((await getClientAssets()).appJs).toBe('embedded');
  });

  // The compiled binary would otherwise boot with an empty client and no
  // symptom until a browser hit it, so this is a throw rather than a warning.
  test('injecting after the server resolved its bundle throws', async () => {
    injectClientAssets({ appJs: 'first' });
    await getClientAssets();
    expect(() => injectClientAssets({ appJs: 'second' })).toThrow('already loaded its client bundle');
  });

  test('with nothing injected it bundles the real client from source', async () => {
    const { appJs } = await getClientAssets();
    expect(appJs.length).toBeGreaterThan(1000);
  });
});
