/**
 * Whether the identity a session signed in as may stand in at its pane for
 * another session there. This is #708's continuation: a Claude Code session
 * moved to the background keeps going under its own id elsewhere, while the
 * pane's Claude process goes on under a new session id with no session file
 * of its own.
 *
 * With agent.integrations.enabled off it always may, as #708 ships. On, a
 * session no binding names still may. A bound session's identity is lent
 * only when Claude Code's own records show the pane's process left it:
 * its Claude binding was detached (observed moved), or it is still attached
 * at that pane and the process it recorded is gone or now runs another
 * session. A /clear or a fork never gets here: the cleared session signs
 * out at its SessionEnd, and a fork leaves its parent with no live process,
 * so neither is still on the roster to lend. Another harness's identity is
 * never lent through a pane.
 */

import type { Database } from "bun:sqlite";
import type { SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import { registryRoots, sessionForPid } from "../claude-registry.ts";
import { isAlive } from "../runner/workspace-registry.ts";
import { getStateDb } from "../state/db.ts";
import { integrationsEnabled } from "./context.ts";
import { isDetachedAttachment, listBindingsByNativeValue } from "./session-store.ts";

export type PaneLendDeps = {
  db?: Database;
  enabled?: () => boolean;
  /** The session a Claude process runs now, from its own registry file. */
  sessionForPid?: (pid: number) => string | null;
  alive?: (pid: number) => boolean;
};

export function lendsPaneIdentity(holder: string, pane: string, deps: PaneLendDeps = {}): boolean {
  if (!(deps.enabled ?? integrationsEnabled)()) return true;
  const bindings = listBindingsByNativeValue(deps.db ?? getStateDb(), holder);
  if (bindings.length === 0) return true;
  const alive = deps.alive ?? isAlive;
  const runs = deps.sessionForPid ?? ((pid: number) => sessionForPid(pid, { roots: registryRoots(process.env.HOME) }));
  const leftItsProcess = (b: SessionBinding): boolean => {
    const pid = b.attachment.pid;
    // No recorded process: the evidence cannot tell #708's move from anything else, so #708's behaviour stands.
    if (pid === undefined || !alive(pid)) return true;
    return runs(pid) !== b.native.value;
  };
  return bindings.every((b) => b.native.harness === "claude"
    && (isDetachedAttachment(b) || (b.attachment.pane === pane && leftItsProcess(b))));
}
