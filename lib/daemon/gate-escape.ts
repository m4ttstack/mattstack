import { herdrRequest } from "../herdr/client.ts";
import { hasQuestionForm } from "./question-form.ts";
import { resolveLivePane, snapshotPanes, type LivePane, type PaneHints } from "./pane-resolve-live.ts";

export type EscapeInjector = (
  hints: PaneHints,
  opts?: { paneRef?: string },
) => Promise<{ ok: true; paneRef: string } | { ok: false; error: string }>;

/** Drives herdr's existing pane.send_keys verb; deliberately NOT
    injectIntoPane, which refuses blocked panes, and a pane holding a
    pending form is exactly that state. Escape-only by construction: this
    is the sole key the gate delivery layer is allowed to send. Hints are
    resolved against a fresh snapshot on every call, not the paneId alone,
    so a pane that moved (workspace restart, herdr respawn) is still found
    by session or worktree instead of silently missing the escape. With
    `opts.paneRef`, a fresh resolution landing on any other pane sends
    nothing: Escape must hit the pane that read blocked. */
export function createEscapeInjector(deps: {
  herdr?: typeof herdrRequest;
  snapshot?: () => Promise<LivePane[] | null>;
} = {}): EscapeInjector {
  const herdr = deps.herdr ?? herdrRequest;
  const snapshot = deps.snapshot ?? snapshotPanes;
  return async (hints, opts) => {
    const panes = await snapshot();
    if (!panes) return { ok: false as const, error: "no herdr server reachable" };
    const pane = resolveLivePane(hints, panes);
    if (!pane) return { ok: false as const, error: "no live pane resolved from hints" };
    if (opts?.paneRef !== undefined && pane.paneRef !== opts.paneRef) {
      return { ok: false as const, error: `resolved pane ${pane.paneRef} is not the probed pane ${opts.paneRef}` };
    }
    const paneId = pane.paneRef.startsWith("bg:") ? pane.paneRef.slice("bg:".length) : pane.paneRef;
    const res = await herdr("pane.send_keys", { pane_id: paneId, keys: ["escape"] }, { sockPath: pane.sockPath });
    return res.ok
      ? { ok: true as const, paneRef: pane.paneRef }
      : { ok: false as const, error: `${res.code}: ${res.message}` };
  };
}

export type PaneStatusProbe = (hints: PaneHints) => Promise<{ paneRef: string; status: LivePane["agentStatus"] } | null>;

/** The pane's visible screen text via herdr's pane.read; throws when the
    read fails. */
export async function readVisibleScreen(pane: LivePane, herdr: typeof herdrRequest = herdrRequest): Promise<string> {
  const paneId = pane.paneRef.startsWith("bg:") ? pane.paneRef.slice("bg:".length) : pane.paneRef;
  const res = await herdr<{ read: { text: string } }>(
    "pane.read", { pane_id: paneId, source: "visible" }, { sockPath: pane.sockPath },
  );
  if (!res.ok) throw new Error(`${res.code}: ${res.message}`);
  return res.result.read.text;
}

/** The paneRef and agent status of the pane the hints resolve to, read from
    a fresh snapshot the same way the injector resolves. A question form on
    screen reads "blocked" whatever herdr reports: herdr's status goes stale
    on a form that sat through a sleep/wake. An unreadable screen keeps
    herdr's status. Null when no herdr server answers or no pane resolves. */
export function createPaneStatusProbe(deps: {
  snapshot?: () => Promise<LivePane[] | null>;
  readScreen?: (pane: LivePane) => Promise<string>;
} = {}): PaneStatusProbe {
  const snapshot = deps.snapshot ?? snapshotPanes;
  const readScreen = deps.readScreen ?? ((p: LivePane) => readVisibleScreen(p));
  return async (hints) => {
    const panes = await snapshot();
    if (!panes) return null;
    const pane = resolveLivePane(hints, panes);
    if (!pane) return null;
    let form = false;
    try {
      form = hasQuestionForm(await readScreen(pane));
    } catch {
      // Unreadable screen: herdr's status is the only evidence left.
    }
    return { paneRef: pane.paneRef, status: form ? "blocked" : pane.agentStatus };
  };
}
