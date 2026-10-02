// @vitest-environment node
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { createQueryClient } from './queryClient';

afterEach(() => {
  onlineManager.setOnline(true);
});

it('runs a write while the browser says it is offline', async () => {
  onlineManager.setOnline(false);
  const write = vi.fn<() => Promise<string>>().mockResolvedValue('written');
  const observer = new MutationObserver<string, Error, void>(
    createQueryClient(),
    { mutationFn: write }
  );

  const settled = await Promise.race([
    observer.mutate(undefined),
    new Promise(resolve => setTimeout(() => resolve('paused'), 50)),
  ]);

  expect(settled).toBe('written');
  expect(write).toHaveBeenCalledOnce();
});
