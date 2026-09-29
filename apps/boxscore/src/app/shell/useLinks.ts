import { useQuery } from '@tanstack/react-query';

import { client, readOrThrow } from '../api';

export interface Links {
  console: string;
}

const FALLBACK: Links = { console: 'https://console.mattstack' };

export function useLinks(): Links {
  const query = useQuery({
    queryKey: ['links'],
    queryFn: async () => {
      const res = await client.api.links.$get();
      return readOrThrow<Links>(res, 'links');
    },
    staleTime: Infinity,
    retry: false,
  });
  return query.data ?? FALLBACK;
}
