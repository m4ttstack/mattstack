/**
 * Chat sign-in is where a manually started Codex thread joins, as a Claude
 * Code session's does (prepareClaudeSignIn). The thread is named only by
 * evidence its caller cannot type: CODEX_THREAD_ID in a command Codex ran, or
 * the host's `_meta.threadId` on an MCP server launched as a Codex host. The
 * binding is made once the daemon names the identity, under the thread's
 * canonical Codex profile, and never for a thread another identity holds.
 */

import type { Database } from "bun:sqlite";
import type { NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createSessionStore, isDetachedAttachment, listBindingsByNativeValue } from "../session-store.ts";

/** Commits once the daemon names the identity: the thread's binding, or a refusal. */
export type CodexSignInCommit = (identity: string) => Outcome<SessionBinding>;

export function prepareCodexSignIn(native: NativeSessionRef, db: Database): CodexSignInCommit {
  const store = createSessionStore(db);
  const current = listBindingsByNativeValue(db, native.value)
    .find((b) => b.native.harness === native.harness && b.native.profile === native.profile && b.native.kind === native.kind);
  return (identity) => {
    if (current && current.identity !== identity) {
      return { ok: false, error: { code: "refused", message: `Codex thread ${native.value} already belongs to another identity` } };
    }
    if (!current) return store.bind(store.reserve({ identity }), native, { mode: "herdr" });
    if (!isDetachedAttachment(current)) return { ok: true, data: current };
    return store.replaceAttachment(current.key, current.attachment.generation, { mode: current.attachment.mode });
  };
}
