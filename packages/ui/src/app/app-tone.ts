import { useSyncExternalStore } from 'react';

// The app's hue as a theme colour name. The shell sets it (from its `hue` and
// the viewer's pick) and the provider above the shell reads it, so the two
// meet here rather than through React context, which runs the other way.
let tone: string | null = null;
const listeners = new Set<() => void>();

export function setAppTone(next: string): void {
  if (next === tone) return;
  tone = next;
  listeners.forEach(listener => listener());
}

export function useAppTone(): string | null {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tone,
    () => tone
  );
}
