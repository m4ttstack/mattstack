import { useEffect, useState } from 'react';

// One request per list per page load: every card's field shares it.
const lists = new Map<string, Promise<string[] | null>>();

function load(source: string): Promise<string[] | null> {
  let p = lists.get(source);
  if (!p) {
    p = fetch(`/api/settings/suggest/${encodeURIComponent(source)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((b: { values?: unknown } | null) =>
        Array.isArray(b?.values) ? (b.values as string[]) : null
      )
      .catch(() => null);
    lists.set(source, p);
  }
  return p;
}

/** A field's server-side suggestion list (`suggest` in its schema), or
    null while loading, unknown, or when the source has nothing yet. */
export function useSuggestions(source: string | undefined): string[] | null {
  const [values, setValues] = useState<string[] | null>(null);
  useEffect(() => {
    if (!source) return;
    let live = true;
    void load(source).then(v => live && setValues(v));
    return () => {
      live = false;
    };
  }, [source]);
  return source ? values : null;
}

export function resetSuggestions() {
  lists.clear();
}
