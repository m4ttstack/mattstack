import { useEffect } from 'react';
import type { MantineColorScheme } from '@mantine/core';

import { useStoredColorScheme } from '@mattstack/app-kit/hooks';

const ROUTE = '/api/color-scheme';

const isScheme = (v: unknown): v is MantineColorScheme =>
  v === 'auto' || v === 'light' || v === 'dark';

/** Saves the viewer's light / dark / auto pick as this Mac's one choice for
    every mattstack app (`mattstack.colorScheme`, through the app's server). */
export function saveSharedColorScheme(scheme: MantineColorScheme): void {
  void fetch(ROUTE, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scheme }),
  }).catch(() => undefined);
}

/** Follows this Mac's one choice: read when the app opens and again each time
    it comes back to the front, so a change made in another app shows here.
    The browser's own copy paints first and stands in when the server has no
    answer. */
export function useSharedColorScheme(): void {
  const [stored, setStored] = useStoredColorScheme();
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      if (document.visibilityState === 'hidden') return;
      fetch(ROUTE)
        .then(res => (res.ok ? res.json() : null))
        .then((body: { scheme?: unknown } | null) => {
          if (!cancelled && isScheme(body?.scheme) && body.scheme !== stored)
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
  }, [stored, setStored]);
}
