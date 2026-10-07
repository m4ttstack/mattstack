/**
 * The shared Codex connection's identity, readable without loading the
 * session module, connecting or spawning anything. Until the shared loader
 * exists there is no connection.
 */

let probe: (() => string | null) | undefined;

export function setCodexLinkProbe(read: () => string | null): void {
  probe = read;
}

/** The live control connection's id, or null while there is none. */
export function codexMessagingConnection(): string | null {
  return probe?.() ?? null;
}
