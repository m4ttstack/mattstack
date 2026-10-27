/**
 * The CLI's own pane, addressed as a ref. herdr sets HERDR_PANE_ID to a bare
 * id regardless of which server hosts the pane; a bg pane also carries
 * HERDR_SESSION=BG_SESSION (spec "Environment": bg panes get HERDR_SESSION/socket env
 * pointing at the bg server). Every self-reference this process sends to the
 * daemon (pane:send's callerPane, chat:join/chat:invite's pane) must ride in
 * ref space so a same-pane compare on the other end (lib/daemon/inject.ts) can
 * ever match.
 */
import { formatPaneRef, paneSelf, parsePaneRef } from "../packages/rt-client/src/index.ts";
import { BG_SESSION } from "./herdr/bg-session.ts";

const LOOKUP_TIMEOUT_MS = 2000;

export function selfPaneRef(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const paneId = env.HERDR_PANE_ID;
  if (!paneId) return undefined;
  return formatPaneRef(paneId, env.HERDR_SESSION === BG_SESSION ? "bg" : "visible");
}

type PaneSelfLookup = (a: { sessionId: string; paneId?: string }) => Promise<{ ok: true; data?: { paneId: string | null } } | { ok: false; error?: string }>;

/**
 * The pane as herdr numbers it now. HERDR_PANE_ID is fixed when the shell
 * starts and goes stale when herdr renumbers the pane, so a Claude session
 * asks the daemon which pane its process runs in. The env ref stays the
 * answer outside a session, outside herdr, or when the daemon cannot answer.
 */
export async function liveSelfPaneRef(
  env: NodeJS.ProcessEnv = process.env,
  lookup: PaneSelfLookup = (a) => paneSelf(a, { timeoutMs: LOOKUP_TIMEOUT_MS }),
): Promise<string | undefined> {
  const own = selfPaneRef(env);
  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!own || !sessionId) return own;
  const res = await lookup({ sessionId, paneId: own }).catch(() => null);
  return (res?.ok && res.data?.paneId) || own;
}

/** `env` with HERDR_PANE_ID set to the live bare id, for builders that read the env var directly. */
export async function withLivePane(env: NodeJS.ProcessEnv = process.env, lookup?: PaneSelfLookup): Promise<NodeJS.ProcessEnv> {
  const live = await liveSelfPaneRef(env, lookup);
  if (!live || live === selfPaneRef(env)) return env;
  return { ...env, HERDR_PANE_ID: parsePaneRef(live).paneId };
}

/** The live bare pane id, in the HERDR_PANE_ID form. */
export async function liveSelfPaneId(env: NodeJS.ProcessEnv = process.env, lookup?: PaneSelfLookup): Promise<string | undefined> {
  return (await withLivePane(env, lookup)).HERDR_PANE_ID;
}
