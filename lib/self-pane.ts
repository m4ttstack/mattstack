/**
 * The CLI's own pane, addressed as a ref. herdr sets HERDR_PANE_ID to a bare
 * id regardless of which server hosts the pane; a bg pane also carries
 * HERDR_SESSION=BG_SESSION (spec "Environment": bg panes get HERDR_SESSION/socket env
 * pointing at the bg server). Every self-reference this process sends to the
 * daemon (pane:send's callerPane, chat:join/chat:invite's pane) must ride in
 * ref space so a same-pane compare on the other end (lib/daemon/inject.ts) can
 * ever match.
 */
import { formatPaneRef } from "../packages/rt-client/src/index.ts";
import { BG_SESSION } from "./herdr/bg-session.ts";

export function selfPaneRef(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const paneId = env.HERDR_PANE_ID;
  if (!paneId) return undefined;
  return formatPaneRef(paneId, env.HERDR_SESSION === BG_SESSION ? "bg" : "visible");
}
