import { parsePaneRef } from "../../packages/rt-client/src/index.ts";
import type { GatesStore } from "./gates-store.ts";

export interface KitGateMatch { id: string; session?: string }

/** The id of the open gate a kit form is drawn for in this Claude session's
    pane, or null. The agent sits idle at its prompt while the form is open,
    so attention and the watchdog read the gate rather than the pane. */
export function openKitGateFor(store: Pick<GatesStore, "list">): (session: string) => string | null {
  return (session) =>
    store.list({ open: true }).gates
      .find((g) => g.status === "open" && g.origin?.presentation === "kit" && g.nudge?.session === session)?.id ?? null;
}

/** The open kit gate drawn in the pane at this ref (bare for the visible
    server, `bg:`-prefixed for the bg one), with the Claude session it was
    raised in, or null. A gate records its pane as `origin.paneId`, else the
    top-level `pane`. */
export function openKitGateForPane(store: Pick<GatesStore, "list">): (paneRef: string) => KitGateMatch | null {
  return (paneRef) => {
    const target = parsePaneRef(paneRef);
    const gate = store.list({ open: true }).gates.find((g) => {
      if (g.status !== "open" || g.origin?.presentation !== "kit") return false;
      const recorded = g.origin.paneId || g.pane;
      if (!recorded) return false;
      const ref = parsePaneRef(recorded);
      return ref.server === target.server && ref.paneId === target.paneId;
    });
    if (!gate) return null;
    return gate.nudge?.session ? { id: gate.id, session: gate.nudge.session } : { id: gate.id };
  };
}
