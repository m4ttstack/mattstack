import { createContext, useContext } from 'react';

import type { MetricKey } from '../../shared/types';
import { statHref } from '../leaderboard/StandingsTable';

/** The roster member whose Self view is being previewed, or null outside a preview. */
export const PreviewContext = createContext<string | null>(null);

export const usePreviewAs = (): string | null => useContext(PreviewContext);

export const previewHref = (username: string): string =>
  `/as/${encodeURIComponent(username)}`;

export const teamPersonHref = (username: string): string =>
  `/user/${encodeURIComponent(username)}`;

/** Builds in-app person links, keeping them under `/as/<u>` while previewing. */
export function usePersonHref(): (
  username: string,
  stat?: MetricKey
) => string {
  const as = usePreviewAs();
  return (username, stat) => {
    if (as === null)
      return stat ? statHref(username, stat) : teamPersonHref(username);
    const own = username.toLowerCase() === as.toLowerCase();
    const page = own
      ? previewHref(as)
      : `${previewHref(as)}${teamPersonHref(username)}`;
    return stat ? `${page}/${stat}` : page;
  };
}
