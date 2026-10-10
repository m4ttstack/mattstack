import { afterEach, describe, expect, it } from 'vitest';

import { mattstackVite } from './vite.js';

type Proxy = Record<string, { target: string }>;

describe('mattstackVite server', () => {
  afterEach(() => {
    delete process.env.SERVER_PORT;
  });

  it('proxies to apiPort when SERVER_PORT is unset', () => {
    const proxy = mattstackVite({ apiPort: 11002 }).server?.proxy as Proxy;
    expect(proxy['/api']!.target).toBe('http://127.0.0.1:11002');
    expect(proxy['/ws']!.target).toBe('ws://127.0.0.1:11002');
  });

  it('proxies to SERVER_PORT when deck sets it', () => {
    process.env.SERVER_PORT = '12002';
    const proxy = mattstackVite({ apiPort: 11002 }).server?.proxy as Proxy;
    expect(proxy['/api']!.target).toBe('http://127.0.0.1:12002');
    expect(proxy['/ws']!.target).toBe('ws://127.0.0.1:12002');
  });

  it('accepts .mattstack and .localhost hosts with or without the proxy', () => {
    expect(mattstackVite({ apiPort: 1 }).server?.allowedHosts).toEqual([
      '.mattstack',
      '.localhost',
    ]);
    const bare = mattstackVite({ apiPort: 1, proxy: false }).server;
    expect(bare?.allowedHosts).toEqual(['.mattstack', '.localhost']);
    expect(bare?.proxy).toBeUndefined();
  });
});
