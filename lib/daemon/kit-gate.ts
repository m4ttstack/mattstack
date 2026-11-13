import type { GatesStore } from "./gates-store.ts";

/** The id of the open gate a kit form is drawn for in this Claude session's
    pane, or null. The agent sits idle at its prompt while the form is open,
    so attention and the watchdog read the gate rather than the pane. */
export function openKitGateFor(store: Pick<GatesStore, "list">): (session: string) => string | null {
  return (session) =>
    store.list({ open: true }).gates
      .find((g) => g.status === "open" && g.origin?.presentation === "kit" && g.nudge?.session === session)?.id ?? null;
}
