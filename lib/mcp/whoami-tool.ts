/**
 * A pure read of this process's env and the chat session file (or, with
 * agent.integrations.enabled on, of the resolved session binding): no
 * daemon call, so it reports what the chat_* and herd tools would act as,
 * not live presence.
 */
import { readChatSession, sessionName, type ChatSession } from "../chat-session.ts";
import { boundCaller, callerRefusal, ok, SIGN_IN_HINT, type McpToolDef } from "./shared.ts";

export interface WhoamiDeps {
  session: (id: string | undefined) => ChatSession | null;
}

export const realWhoamiDeps: WhoamiDeps = { session: readChatSession };

function chatOf(session: ChatSession | null) {
  return session ? { handle: session.handle, name: sessionName(session), baseHandle: session.baseHandle ?? null, room: session.room ?? null } : null;
}

export function whoamiToolDefs(deps: WhoamiDeps = realWhoamiDeps): McpToolDef[] {
  return [
    {
      name: "whoami",
      description: "Report this session's identity as the other tools see it: its Claude Code session id, herdr pane, the chat identity every chat_* tool acts as, as its name (what others see and type) and its handle (the id the tools send; null, with a sign-in hint, when this session has no chat session file), and the herd id, job and room when this is a herd worker. Reads only this server's environment and the session file, so it shows what the tools would act as, not live presence.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      shellForms: { none: "reads this server's own env and chat session file; no shell command is equivalent" },
      async handler(_input, env, _signal, context) {
        const herd = env.HERD_ID || env.HERD_JOB
          ? { id: env.HERD_ID || null, job: env.HERD_JOB || null, room: env.HERD_ROOM || null }
          : null;
        const caller = await boundCaller(context);
        if (caller !== null) {
          if (!caller.ok) return ok({ sessionId: null, pane: null, chat: null, herd, binding: null, hint: callerRefusal(caller.error) });
          const { key, identity, native, attachment } = caller.data.binding;
          const chat = chatOf(deps.session(native.value));
          return ok({
            sessionId: native.value, pane: attachment.pane ?? null, chat, herd,
            binding: { key, identity, harness: native.harness, profile: native.profile, generation: attachment.generation },
            ...(chat ? {} : { hint: SIGN_IN_HINT }),
          });
        }
        const sessionId = env.CLAUDE_CODE_SESSION_ID || null;
        const chat = chatOf(deps.session(sessionId ?? undefined));
        return ok({ sessionId, pane: env.HERDR_PANE_ID || null, chat, herd, ...(chat ? {} : { hint: SIGN_IN_HINT }) });
      },
    },
  ];
}
