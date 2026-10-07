/**
 * The chat session file — the local record of a signed-in session's assigned
 * handle. `rt chat sign-in` writes it; every other verb's handle resolution
 * reads it as position 0 (ahead of `--as`); `rt chat sign-out` deletes it.
 *
 * Lives at ~/.mattstack/rt/chat/sessions/<session-id>.json, one file per
 * session so a stale or foreign id can never resolve to someone else's
 * handle — readChatSession enforces that by checking the file's own
 * sessionId against the one asked for, not just trusting the filename.
 */
import { readdirSync, unlinkSync } from "fs";
import { join } from "path";
import type { NativeSessionRef, SessionBinding } from "../packages/rt-client/src/agent-integrations.ts";
import {
  BOTH_SESSIONS_MESSAGE, codexProfile, extractCliEvidence, integrationsEnabled, resolveCliBinding, resolveCliSession,
} from "./agent-integrations/context.ts";
import { lendsPaneIdentity } from "./agent-integrations/pane-identity.ts";
import { UserActionableError } from "./errors.ts";
import { readJson, writeJson } from "./json-store.ts";
import { rtDir } from "./rt-paths.ts";

export interface ChatSession {
  sessionId: string;
  handle: string;
  baseHandle: string;
  /** Absent in files written before identities existed; read it through sessionName. */
  name?: string;
  signedInAt: number;
  room?: string;
  lastCwd?: string;
  lastBranchReadAt?: number;
}

export function sessionsDir(): string {
  return join(rtDir(), "chat", "sessions");
}

const VALID_SESSION_ID = /^[A-Za-z0-9._-]+$/;

/** Whether `id` is safe as a session filename component — rejects `/`, `..`, and anything else path-traversal could use. */
export function isValidSessionId(id: string): boolean {
  return VALID_SESSION_ID.test(id);
}

export function sessionFilePath(sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`invalid session id "${sessionId}" — must match ${VALID_SESSION_ID}`);
  }
  return join(sessionsDir(), `${sessionId}.json`);
}

/**
 * Null on absence, on a session-id mismatch (a copied ~/.mattstack or a
 * session resumed under a new id must never resolve to a stale handle that
 * was never established for the id in hand), on an invalid id (path
 * traversal — treated as "no session", not an error, since every read-only
 * verb runs this on whatever `--session`/CLAUDE_CODE_SESSION_ID happens to
 * contain), and on a non-string `handle` (a corrupt file's `undefined` must
 * never coerce into the literal pidfile-path segment `"undefined"`).
 */
export function readChatSession(sessionId: string | undefined): ChatSession | null {
  if (!sessionId) return null;
  let path: string;
  try {
    path = sessionFilePath(sessionId);
  } catch {
    return null;
  }
  const session = readJson<ChatSession | null>(path, null);
  if (!session || session.sessionId !== sessionId || typeof session.handle !== "string") return null;
  return session;
}

/** Every session file that `readChatSession` would accept for its own id, as written. */
export function listChatSessions(): ChatSession[] {
  let names: string[];
  try {
    names = readdirSync(sessionsDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const sessions: ChatSession[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const session = readChatSession(name.slice(0, -".json".length));
    if (session) sessions.push(session);
  }
  return sessions;
}

export function writeChatSession(s: ChatSession): void {
  writeJson(sessionFilePath(s.sessionId), s);
}

export function deleteChatSession(sessionId: string): void {
  try {
    unlinkSync(sessionFilePath(sessionId));
  } catch {
    // already gone, or an invalid id — nothing to remove either way
  }
}

/** The display name a session file stands for; an older file without `name` is a legacy id, whose name is itself. */
export function sessionName(s: Pick<ChatSession, "handle" | "name">): string {
  return typeof s.name === "string" && s.name ? s.name : s.handle;
}

/**
 * `--session <id>` (the documented path for a process with no environment
 * variable) else `CLAUDE_CODE_SESSION_ID` (present in every Claude Code
 * session on this machine but undocumented — the CLI's own Bash calls rely
 * on it, `--session` stays the supported override for everything else).
 * With agent.integrations.enabled on, either source (or CODEX_THREAD_ID)
 * must resolve to exactly one session binding, else the command refuses,
 * except a never-bound Claude session, which keeps its environment id.
 * `readOnly` callers only look (another pane's rooms, for herdr-chat): an
 * explicit `--session` no binding names still answers for the session file
 * its own sign-in wrote, which is all a look needs.
 */
export function currentSessionId(args: string[], opts: { readOnly?: boolean } = {}): string | undefined {
  if (integrationsEnabled()) {
    const resolved = resolveCliSession(args, process.env);
    if (resolved.ok) return resolved.data;
    const explicit = explicitSession(args);
    if (opts.readOnly && explicit !== undefined && readChatSession(explicit)) return explicit;
    throw unattributed(resolved.error.message);
  }
  const i = args.indexOf("--session");
  const value = i >= 0 ? args[i + 1] : undefined;
  // A value slot that is itself a flag means --session was given no value
  // (e.g. `--session --no-room`) — treat it as missing rather than signing
  // in as the literal next flag's name.
  if (value !== undefined && !value.startsWith("--")) return value;
  return process.env.CLAUDE_CODE_SESSION_ID || undefined;
}

function explicitSession(args: string[]): string | undefined {
  const i = args.indexOf("--session");
  const value = i >= 0 ? args[i + 1] : undefined;
  return value !== undefined && !value.startsWith("--") ? value : undefined;
}

/**
 * The binding this command's session evidence names, with
 * agent.integrations.enabled on; undefined when the switch is off, for a
 * plain shell, and for a session no live binding names.
 */
export function boundCliSession(args: string[]): SessionBinding | undefined {
  return integrationsEnabled() ? resolveCliBinding(args, process.env) : undefined;
}

/** Whether the identity `holder` signed in as at `pane` may stand in there for this command's session; see lendsPaneIdentity. */
export function paneIdentityLendable(holder: string, pane: string): boolean {
  return lendsPaneIdentity(holder, pane);
}

/**
 * Whether a chat verb may take the identity signed in at this pane when its
 * session has no session file (a fork or a background move keeps the pane but
 * gets a new session id). With agent.integrations.enabled on, that stays the
 * environment path's fallback: a session a binding names, which includes any
 * explicit --session, is that binding's and never the pane's.
 */
export function paneContinuationApplies(args: string[]): boolean {
  if (!integrationsEnabled()) return true;
  const bound = resolveCliSession(args, process.env, {}, { bindingsOnly: true });
  return !(bound.ok && bound.data !== undefined);
}

function unattributed(why: string): UserActionableError {
  return new UserActionableError("caller-unattributed", "rt cannot tell which agent session ran this command", {}, { why });
}

/**
 * The session `rt chat sign-in` acts as; `binding` when one already names it,
 * and, for a session not bound yet, how to bind it once the daemon names its
 * identity. `paneTrusted: false` when this process's pane is not the
 * session's (a Codex thread's commands run in its app server).
 */
export type SignInSession = {
  sessionId: string | undefined; binding?: SessionBinding; bind?: (identity: string) => void; paneTrusted?: false;
};

/**
 * currentSessionId, except that with agent.integrations.enabled on a Claude
 * Code session or a Codex thread with no binding is bound here rather than
 * refused: sign-in is where a manually started session joins, and its
 * identity is the one the daemon signs it in as. The bound session must then
 * resolve like any other. A Claude session that cannot be bound signs in
 * unbound, as it did before bindings; a Codex thread is named only by
 * CODEX_THREAD_ID, and a `--session` naming another thread is refused.
 */
export async function signInSession(args: string[]): Promise<SignInSession> {
  if (!integrationsEnabled()) return { sessionId: currentSessionId(args) };
  const resolved = resolveCliSession(args, process.env, {}, { bindingsOnly: true });
  if (resolved.ok) {
    const binding = resolveCliBinding(args, process.env);
    return { sessionId: resolved.data, ...(binding && { binding }) };
  }
  const evidence = extractCliEvidence(args, process.env);
  const thread = process.env.CODEX_THREAD_ID?.trim() || undefined;
  if (evidence.ok && thread !== undefined) {
    const raw = evidence.data.raw;
    if (raw !== undefined && raw !== thread) {
      throw unattributed(`--session names ${raw}, but this command runs in Codex thread ${thread}`);
    }
    if (process.env.CLAUDE_CODE_SESSION_ID?.trim()) throw unattributed(BOTH_SESSIONS_MESSAGE);
    return codexSignIn(args, { harness: "codex", profile: codexProfile(process.env), kind: "id", value: thread });
  }
  const claim = !evidence.ok ? undefined
    : evidence.data.raw !== undefined ? { sessionId: evidence.data.raw, explicit: true }
    : evidence.data.native?.harness === "claude" ? { sessionId: evidence.data.native.value, explicit: false }
    : undefined;
  if (!claim) throw unattributed(resolved.error.message);
  const { prepareClaudeSignIn } = await import("./agent-integrations/claude/sessions.ts");
  const commit = await prepareClaudeSignIn(claim, process.env);
  return {
    sessionId: claim.sessionId,
    bind: (identity) => {
      const bound = commit(identity);
      if (!bound.ok) throw unattributed(bound.error.message);
      if (bound.data === null) return;
      const confirmed = resolveCliSession(args, process.env, {}, { bindingsOnly: true });
      if (!confirmed.ok) throw unattributed(confirmed.error.message);
    },
  };
}

/** A Codex thread no binding names yet, bound under the identity the daemon signs it in as. */
async function codexSignIn(args: string[], native: NativeSessionRef): Promise<SignInSession> {
  const [{ prepareCodexSignIn }, { getStateDb }] = await Promise.all([
    import("./agent-integrations/codex/sign-in.ts"), import("./state/db.ts"),
  ]);
  const commit = prepareCodexSignIn(native, getStateDb());
  return {
    sessionId: native.value,
    paneTrusted: false,
    bind: (identity) => {
      const bound = commit(identity);
      if (!bound.ok) throw unattributed(bound.error.message);
      const confirmed = resolveCliSession(args, process.env, {}, { bindingsOnly: true });
      if (!confirmed.ok) throw unattributed(confirmed.error.message);
    },
  };
}
