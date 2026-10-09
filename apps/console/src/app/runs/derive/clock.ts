/** Only the design fixture's answers carry `asOf` (the time its board was
    drawn at); the daemon's never do, so live pages use this clock. */
export function nowOf(data: { asOf?: number } | null | undefined): number {
  return data?.asOf ?? Date.now();
}

/** A time of day for an answer stamp: "1:41 PM" in the viewer's locale. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}
