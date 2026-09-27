/**
 * A pure read of this process's env and the chat session file: no daemon
 * call, so it reports what the chat_* and herd tools would act as, not live
 * presence.
 */
import { readChatSession, sessionName, type ChatSession } from "../chat-session.ts";
import { ok, SIGN_IN_HINT, type McpToolDef } from "./shared.ts";

export interface WhoamiDeps {
  session: (id: string | undefined) => ChatSession | null;
}

export const realWhoamiDeps: WhoamiDeps = { session: readChatSession };

export function whoamiToolDefs(deps: WhoamiDeps = realWhoamiDeps): McpToolDef[] {
  return [
    {
      name: "whoami",
      description: "Report this session's identity as the other tools see it: its Claude Code session id, herdr pane, the chat identity every chat_* tool acts as, as its name (what others see and type) and its handle (the id the tools send; null, with a sign-in hint, when this session has no chat session file), and the herd id, job and room when this is a herd worker. Reads only this server's environment and the session file, so it shows what the tools would act as, not live presence.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      shellForms: { none: "reads this server's own env and chat session file; no shell command is equivalent" },
      async handler(_input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID || null;
        const session = deps.session(sessionId ?? undefined);
        const chat = session ? { handle: session.handle, name: sessionName(session), baseHandle: session.baseHandle ?? null, room: session.room ?? null } : null;
        const herd = env.HERD_ID || env.HERD_JOB
          ? { id: env.HERD_ID || null, job: env.HERD_JOB || null, room: env.HERD_ROOM || null }
          : null;
        return ok({ sessionId, pane: env.HERDR_PANE_ID || null, chat, herd, ...(chat ? {} : { hint: SIGN_IN_HINT }) });
      },
    },
  ];
}
