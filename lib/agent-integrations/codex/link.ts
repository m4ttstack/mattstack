/**
 * The shared Codex connection's identity, readable without loading the
 * session module, connecting or spawning anything. Until the shared loader
 * exists there is no connection.
 */

import type { SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";

let probe: (() => string | null) | undefined;
let bindingProbe: ((binding: SessionBinding) => boolean | undefined) | undefined;

export function setCodexLinkProbe(read: () => string | null): void {
  probe = read;
}

export function setCodexThreadProbe(read: (binding: SessionBinding) => boolean | undefined): void {
  bindingProbe = read;
}

/** The live control connection's id, or null while there is none. */
export function codexMessagingConnection(): string | null {
  return probe?.() ?? null;
}

/**
 * Whether the bound thread can take input, as the live connection knows it:
 * loaded and, for a Herdr attachment, codex in its pane when last observed.
 * Undefined while there is no connection or it knows nothing of the thread.
 */
export function codexSessionLive(binding: SessionBinding): boolean | undefined {
  return bindingProbe?.(binding);
}
