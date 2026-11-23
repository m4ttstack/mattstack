/**
 * Whether the unix-socket server may dispatch a request. The socket is bound
 * before the daemon can serve and stays bound while it drains, so a client
 * always gets an answer it can safely retry instead of a refused connection.
 */

export type SocketState = "starting" | "serving" | "stopping";

export interface SocketAvailability {
  state: SocketState;
  /** Requests past the availability check whose response has not been built yet. */
  inFlight: number;
  /**
   * Sent with every unavailable reply. The other flavor's park gate
   * (`probeSocketHolder`) reads pid and flavor from whatever answers rt.sock,
   * and without them it would take a booting daemon for a dead socket and
   * evict it.
   */
  holder?: { pid: number; flavor: string };
}

export function createSocketAvailability(): SocketAvailability {
  return { state: "starting", inFlight: 0 };
}

export const UNAVAILABLE_STATUS = 503;

// Clients that predate the retry show `error` to a person as is, so both
// sentences must read as a complete instruction.
const UNAVAILABLE_ERROR = {
  starting: "rt daemon is starting; try again in a moment",
  stopping: "rt daemon is restarting; try again in a moment",
} as const;

export function unavailableBody(state: "starting" | "stopping"): {
  ok: false;
  error: string;
  unavailable: "starting" | "stopping";
} {
  return { ok: false, error: UNAVAILABLE_ERROR[state], unavailable: state };
}
