import type { BoardMR } from '../../data.ts';
import type { ActionResult } from '../api.ts';
import { mrRef } from './MrLinks.tsx';

/** The kit's `ToastHandle`, restated so this file stays DOM-free. */
export interface ToastHandle {
  done: (text: string) => void;
  fail: (text: string) => void;
}

/** Deps a launch flow needs from its caller: how to POST, how to reflect the
    optimistic queued/rollback state (no-ops for non-optimistic actions like
    resume), how to toast, and how to reload once the server answers. */
export interface LaunchFlowDeps {
  post: (payload: Record<string, unknown>) => Promise<ActionResult>;
  setQueued: () => void;
  rollback: () => void;
  addToast: (t: string) => void;
  startToast: (t: string) => ToastHandle;
  reload: () => void;
  verbing: string;
  noun: string;
  /** The launch toast's done text, before the MR ref: "review started". */
  started: string;
  /** Overrides the default failure toast (`couldn't launch ${noun} for !${iid}
      (${status})`). Resume actions use this to surface the server's own
      response text, matching today's handleResume (`resume review failed for
      !N (400): <server message>`) -- the other six handlers rely on the
      default and are unaffected. */
  failureMessage?: (result: ActionResult, mr: BoardMR) => string;
}

/** The pure shape common to every launch-a-pane action (characterized from
    today's handleLaunch): claim optimistic queued state, toast that it's
    starting, POST, and on the answer settle that one toast: roll back and
    turn it into the failure status, or mark it done (saying so when the
    server focused an existing tab instead), and reload to the server's
    real state.

    DOM-free by design (no react, no browser globals) so it stays importable
    from a plain root-tsconfig test without pulling DOM types into that
    program -- see hooks.ts, which imports this for useLaunchAction. */
export async function runLaunchFlow(
  deps: LaunchFlowDeps,
  mr: BoardMR,
  extra: Record<string, unknown>,
  intent: 'launch' | 'focus' = 'launch'
): Promise<ActionResult | undefined> {
  if (!mr.webUrl) return undefined;
  // Focus clicks ride the same endpoint (the server's in-flight dedup does
  // the focusing), but claiming "queued" or toasting a launch would misstate
  // what the click asked for -- the pane is already running. `focus: true`
  // tells the server it may only focus: a pane that turns out to be gone is
  // a refusal, never a fresh launch, and the reload shows the row's real state.
  let toast: ToastHandle | undefined;
  if (intent === 'launch') {
    deps.setQueued();
    toast = deps.startToast(`${deps.verbing} for ${mrRef(mr)}…`);
  }
  const result = await deps.post({
    mrUrl: mr.webUrl,
    iid: mr.iid,
    ...extra,
    ...(intent === 'focus' ? { focus: true } : {}),
  });
  if (!result.ok) {
    if (intent === 'focus') {
      deps.addToast(
        `couldn't focus ${deps.noun} pane for ${mrRef(mr)}${result.text ? `: ${result.text}` : ` (${result.status})`}`
      );
      deps.reload();
      return result;
    }
    deps.rollback();
    toast?.fail(
      deps.failureMessage
        ? deps.failureMessage(result, mr)
        : `couldn't launch ${deps.noun} for ${mrRef(mr)} (${result.status})`
    );
    return result;
  }
  if (intent === 'focus') {
    if (result.body?.focused)
      deps.addToast(`focused ${deps.noun} tab for ${mrRef(mr)}`);
  } else {
    toast?.done(
      result.body?.focused
        ? `${deps.noun} already running for ${mrRef(mr)}... focused its tab`
        : `${deps.started} for ${mrRef(mr)}`
    );
  }
  deps.reload();
  return result;
}

/** A question about one review finding (`POST /question`), launched from the
    review sheet through the same flow as every other pane. A refusal names
    the route's reason (no reviewCwd, the report no longer lists the finding,
    nothing to focus), so the click never does nothing visible. */
export const QUESTION_LAUNCH = {
  path: '/question',
  verbing: 'opening a question',
  started: 'question opened',
  noun: 'question',
  failureMessage: (result: ActionResult, mr: BoardMR): string =>
    `question failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`,
} as const;

/** The `/question` body beyond the flow's own `mrUrl`/`iid`. A click on the
    open-question pill sends `focus: true`, which the route answers by
    focusing the running pane or refusing; it rides as a body field on a
    `launch` intent so a refusal gets the same failure toast as a launch. */
export function questionLaunchFields(
  gateId: string,
  findingId: string,
  tabId: string,
  focus: boolean
): Record<string, unknown> {
  return { gateId, findingId, tabId, ...(focus ? { focus: true } : {}) };
}
