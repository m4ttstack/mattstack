import { QueryClient } from '@tanstack/react-query';

/** The console only ever calls its own localhost server, so the browser's
    online flag says nothing about whether a request lands. A write paused
    on that flag would hold its pack's write lock until the flag flipped. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { mutations: { networkMode: 'always' } },
  });
}
