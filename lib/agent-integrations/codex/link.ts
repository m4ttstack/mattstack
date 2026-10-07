/**
 * The shared Codex connection's identity, readable without loading the
 * session module, connecting or spawning anything. Until the shared loader
 * exists there is no connection.
 */

let probe: (() => string | null) | undefined;
let threadProbe: ((threadId: string, profile: string) => boolean | undefined) | undefined;

export function setCodexLinkProbe(read: () => string | null): void {
  probe = read;
}

export function setCodexThreadProbe(read: (threadId: string, profile: string) => boolean | undefined): void {
  threadProbe = read;
}

/** The live control connection's id, or null while there is none. */
export function codexMessagingConnection(): string | null {
  return probe?.() ?? null;
}

/** Whether the live connection has seen the thread loaded (true) or unloaded or closed (false); undefined when it knows nothing. */
export function codexThreadLive(threadId: string, profile: string): boolean | undefined {
  return threadProbe?.(threadId, profile);
}
