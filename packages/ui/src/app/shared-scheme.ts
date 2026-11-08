import { useEffect, useRef } from 'react';
import type { MantineColorScheme } from '@mantine/core';

import { useStoredColorScheme } from '@mattstack/app-kit/hooks';

const ROUTE = '/api/color-scheme';

const isScheme = (v: unknown): v is MantineColorScheme =>
  v === 'auto' || v === 'light' || v === 'dark';

// A read that overlaps a save can carry the value from before it, and a save
// the server refused (a host that isn't local) leaves the old value there: in
// both cases the viewer's pick stands over what the read says.
let saving = 0;
let saves = 0;
let refused = false;

/** Saves the viewer's light / dark / auto pick as this Mac's one choice for
    every mattstack app (`mattstack.colorScheme`, through the app's server). */
export function saveSharedColorScheme(scheme: MantineColorScheme): void {
  saving += 1;
  saves += 1;
  void fetch(ROUTE, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scheme }),
  })
    .then(res => {
      refused = res.status === 403;
    })
    .catch(() => undefined)
    .finally(() => {
      saving -= 1;
    });
}

/** Follows this Mac's one choice: read when the app opens and again each time
    it comes back to the front, so a change made in another app shows here.
    The browser's own copy paints first and stands in when the server has no
    answer. */
export function useSharedColorScheme(): void {
  const [stored, setStored] = useStoredColorScheme();
  const current = useRef(stored);
  current.current = stored;
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      if (document.visibilityState === 'hidden' || saving > 0 || refused)
        return;
      const startedAt = saves;
      fetch(ROUTE)
        .then(res => (res.ok ? res.json() : null))
        .then((body: { scheme?: unknown } | null) => {
          if (
            !cancelled &&
            startedAt === saves &&
            isScheme(body?.scheme) &&
            body.scheme !== current.current
          )
            setStored(body.scheme);
        })
        .catch(() => undefined);
    };
    pull();
    window.addEventListener('focus', pull);
    document.addEventListener('visibilitychange', pull);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', pull);
      document.removeEventListener('visibilitychange', pull);
    };
  }, [setStored]);
}
