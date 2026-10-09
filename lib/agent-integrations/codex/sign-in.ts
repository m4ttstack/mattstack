/**
 * Chat sign-in is where a manually started Codex thread joins, as a Claude
 * Code session's does (prepareClaudeSignIn). The thread is named only by
 * evidence its caller cannot type: CODEX_THREAD_ID in a command Codex ran, or
 * the host's `_meta.threadId` on an MCP server launched as a Codex host. The
 * binding is made once the daemon names the identity, under the thread's
 * canonical Codex profile, and never for a thread another identity holds.
 *
 * The thread's pane comes only from herdr naming the one Codex pane whose
 * agent session is this thread: the command's own HERDR_PANE_ID is its app
 * server's, not the terminal's. A thread with no such pane is bound without
 * one and cannot take chat messages, which its sign-in says.
 */

import type { Database } from "bun:sqlite";
import type { NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { ChatPane } from "../../../packages/rt-client/src/commands.ts";
import { createSessionStore, isDetachedAttachment, lacksInputPane, listBindingsByNativeValue } from "../session-store.ts";

/** Commits once the daemon names the identity: the thread's binding, or a refusal. */
export type CodexSignInCommit = (identity: string) => Outcome<SessionBinding>;

/** Why a Codex thread signed in with no pane cannot take chat messages, in the words its sign-in shows. */
export const CODEX_NO_PANE_WHY =
  "herdr does not show which pane runs this Codex thread, so rt has nowhere to send messages and keeps them in the room. Run the thread in a herdr pane and sign in again.";

/** The one Codex pane herdr shows running `threadId`, or undefined when there is none or more than one. */
export function codexThreadPane(threadId: string, panes: readonly ChatPane[]): string | undefined {
  const running = panes.filter((p) => p.provider === "codex" && p.sessionId === threadId);
  return running.length === 1 ? running[0]!.paneId : undefined;
}

export function prepareCodexSignIn(native: NativeSessionRef, db: Database, pane?: string): CodexSignInCommit {
  const store = createSessionStore(db);
  const current = listBindingsByNativeValue(db, native.value)
    .find((b) => b.native.harness === native.harness && b.native.profile === native.profile && b.native.kind === native.kind);
  return (identity) => {
    if (current && current.identity !== identity) {
      return { ok: false, error: { code: "refused", message: `Codex thread ${native.value} already belongs to another identity` } };
    }
    if (!current) return store.bind(store.reserve({ identity }), native, { mode: "herdr", ...(pane !== undefined && { pane }) });
    if (isDetachedAttachment(current)) {
      const { mode } = current.attachment;
      return store.replaceAttachment(current.key, current.attachment.generation, { mode, ...(pane !== undefined && mode === "herdr" && { pane }) });
    }
    if (pane !== undefined && lacksInputPane(current)) {
      return store.replaceAttachment(current.key, current.attachment.generation, { mode: "herdr", pane });
    }
    return { ok: true, data: current };
  };
}
