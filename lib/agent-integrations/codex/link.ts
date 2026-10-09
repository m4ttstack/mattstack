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

let experimentalProbe: (() => boolean | undefined) | undefined;

export function setCodexExperimentalProbe(read: () => boolean | undefined): void {
  experimentalProbe = read;
}

/** Whether the live connection negotiated experimentalApi; undefined while there is none. */
export function codexExperimentalApi(): boolean | undefined {
  return experimentalProbe?.();
}

export function setCodexThreadProbe(read: (binding: SessionBinding) => boolean | undefined): void {
  bindingProbe = read;
}

/** The live control connection's id, or null while there is none. */
export function codexMessagingConnection(): string | null {
  return probe?.() ?? null;
}

/**
 * Whether the bound thread can take input, as the live connection knows it.
 * A Herdr attachment is true only when its thread is known loaded and herdr
 * showed codex in its pane when last checked; anything less, an unknown load
 * state included, is false. A headless attachment follows its thread alone:
 * true only while it is known loaded, since rt's own subscription is what
 * keeps it so, and a connection that knows nothing of it holds none.
 * Undefined for either while there is no connection.
 */
export function codexSessionLive(binding: SessionBinding): boolean | undefined {
  return bindingProbe?.(binding);
}

let turnProbe: ((binding: SessionBinding) => string | undefined) | undefined;

export function setCodexTurnProbe(read: (binding: SessionBinding) => string | undefined): void {
  turnProbe = read;
}

/**
 * The turn the live connection saw start and not yet end on the bound
 * thread; undefined when it saw none, or has no connection for the
 * binding's profile. Never connects.
 */
export function codexActiveTurn(binding: SessionBinding): string | undefined {
  return turnProbe?.(binding);
}
