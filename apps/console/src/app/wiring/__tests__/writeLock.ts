import { MutationObserver, type QueryClient } from '@tanstack/react-query';

import { skillsWriteKey } from '../useWiring';

/** Starts a write to `pack` that stays in flight until the returned
    function ends it, as another caller's bind or sync would. */
export function holdWrite(queryClient: QueryClient, pack: string): () => void {
  let end!: () => void;
  const settled = new Promise<void>(resolve => {
    end = resolve;
  });
  void new MutationObserver(queryClient, {
    mutationKey: skillsWriteKey(pack),
    mutationFn: () => settled,
  }).mutate();
  return end;
}
