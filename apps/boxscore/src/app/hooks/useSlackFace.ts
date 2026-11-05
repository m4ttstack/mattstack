import { useEffect, useState } from 'react';

/** A person's Slack picture, unset until found or when no one matches. */
export function useSlackFace(name: string): string | undefined {
  const [face, setFace] = useState<string>();
  useEffect(() => {
    let current = true;
    setFace(undefined);
    fetch(`/api/slack-face?name=${encodeURIComponent(name)}`)
      .then(res => (res.ok ? (res.json() as Promise<{ url?: string }>) : null))
      .then(found => {
        if (current && found?.url) setFace(found.url);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [name]);
  return face;
}
