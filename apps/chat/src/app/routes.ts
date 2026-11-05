import { useRoute } from 'wouter';
import { useLocationProperty } from 'wouter/use-browser-location';

import { DEMO_PATH, PAGE_SHELL_DEMO_PATH } from './demo/paths';
import { DIRECT_PATH } from './direct';

export type AppRoute =
  | { name: 'home' }
  | { name: 'direct' }
  | { name: 'room'; room: string }
  | { name: 'embed'; room: string }
  | { name: 'demo-page-shell' }
  | { name: 'not-found' };

/** wouter hands params back raw; a malformed escape (`/r/%E0%A4%A`) must
    read as no room, not throw out of render. */
function decodeParam(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/**
 * The app's route table, as a hook: the current location in, a structured
 * route out. `home` hands over to the latest active conversation.
 * `/messages` is Messages to you, every DM the human is an end of.
 * `/embed/r/<room>` is one room alone, for a host's own sidebar.
 * `/r/<room>#m-<id>` is the link rt prints after a post and on a wake line, so that shape is a
 * contract with repo-tools' lib/chat-viewer-url.ts. `/demo` and the
 * canonical PAGE_SHELL_DEMO_PATH both render the PageShell showcase; any
 * other /demo/* is not-found.
 */
export function useAppRoute(): AppRoute {
  const [isHome] = useRoute('/');
  const [isDirect] = useRoute(DIRECT_PATH);
  const [isRoom, roomParams] = useRoute('/r/:room');
  const [isEmbed, embedParams] = useRoute('/embed/r/:room');
  const [isDemo] = useRoute(DEMO_PATH);
  const [isDemoCanonical] = useRoute(PAGE_SHELL_DEMO_PATH);
  if (isHome) return { name: 'home' };
  if (isDirect) return { name: 'direct' };
  if (isRoom) {
    const room = decodeParam(roomParams.room ?? '');
    return room ? { name: 'room', room } : { name: 'not-found' };
  }
  if (isEmbed) {
    const room = decodeParam(embedParams.room ?? '');
    return room ? { name: 'embed', room } : { name: 'not-found' };
  }
  if (isDemo || isDemoCanonical) return { name: 'demo-page-shell' };
  return { name: 'not-found' };
}

/** The URL fragment, live: wouter's location store already listens to
    pushState, replaceState, popstate and hashchange. */
export function useHash(): string {
  return useLocationProperty(() => window.location.hash);
}
