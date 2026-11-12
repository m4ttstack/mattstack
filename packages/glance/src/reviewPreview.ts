const PENDING_PREVIEW = 5;

/** First non-blank line of each of the first five texts, each cut to 120 characters. */
export function pendingPreview(texts: string[]): string[] {
  return texts.slice(0, PENDING_PREVIEW).map(firstLine);
}

function firstLine(text: string): string {
  return (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 120);
}

