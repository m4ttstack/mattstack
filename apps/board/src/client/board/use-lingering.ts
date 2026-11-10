import { useEffect, useState } from 'react';

/** Matches the kit drawer's slide-out (`sidedrawer-out`, 120ms) and the row
    spotlight's fade; the longer of the two, so neither is cut short. */
export const EXIT_MS = 150;

/** Keeps the last non-null value for `ms` after it goes null, so an overlay
    can play its exit before it unmounts. `leaving` is true for that window. */
export function useLingering<T>(
  value: T | null,
  ms: number = EXIT_MS
): { shown: T | null; leaving: boolean } {
  const [shown, setShown] = useState<T | null>(value);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (value !== null) {
      setShown(value);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return { shown: value ?? shown, leaving: value === null && leaving };
}
