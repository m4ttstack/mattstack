declare global {
  interface Window {
    __mattstackHost?: {
      ready(): void;
      failed(reason: string): void;
      fatal(): void;
    };
  }
}

/** The served page's host bridge, absent in a plain browser or under an older server. */
export function hostSignal(): { ready(): void; fatal(): void } | undefined {
  return window.__mattstackHost;
}
