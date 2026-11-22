/**
 * rt chat handoff: a signed-in session that clears itself keeps its chat
 * name. The fresh-context mod runs begin before the /clear, complete from
 * the session the process moves on to, and cancel when the clear does not
 * happen. CLI only: no MCP tool may move an identity between sessions.
 *
 *   rt chat handoff begin [--json]
 *   rt chat handoff complete --from <sessionId> [--json]
 *   rt chat handoff cancel --from <sessionId> [--json]
 */

import { baseOfHandle } from "../lib/chat-names.ts";
import { resolveInbox } from "../lib/claude-registry.ts";
import { isValidSessionId, writeChatSession } from "../lib/chat-session.ts";
import * as out from "../lib/ui/out.ts";
import { chatHandoffBegin, chatHandoffCancel, chatHandoffComplete, type RtResponse } from "../packages/rt-client/src/index.ts";
import { fail, failUsage, flagValue, say, sockOpts } from "./chat.ts";

const USAGE = "rt chat handoff begin|complete --from <sessionId>|cancel --from <sessionId> [--json]";

function envSessionId(): string {
  const id = process.env.CLAUDE_CODE_SESSION_ID;
  if (!id) failUsage("rt cannot tell which session this is", USAGE, "Claude Code sets CLAUDE_CODE_SESSION_ID; a hand-off only runs inside a Claude session.");
  if (!isValidSessionId(id)) fail({ title: "That session id is not valid", why: "A session id uses letters, digits, dots, dashes and underscores." });
  return id;
}

function fromSessionId(args: string[]): string {
  const from = flagValue(args, "--from");
  if (!from || from.startsWith("--")) failUsage("Say which session the hand-off comes from", USAGE);
  if (!isValidSessionId(from)) fail({ title: "That session id is not valid", why: "A session id uses letters, digits, dots, dashes and underscores." });
  return from;
}

/** A refusal exits 2 so the mod can tell "the daemon said no" from "rt could not run". */
function settle<T>(res: RtResponse<T>, json: boolean): T {
  if (res.ok && res.data !== undefined) return res.data;
  const error = res.error ?? "The hand-off did not go through";
  if (res.failure) {
    if (json) out.json({ ok: false, code: res.failure.code, error });
    else out.note(out.line("refused", res.failure.message));
    process.exit(2);
  }
  if (json) {
    out.json({ ok: false, error });
    process.exit(1);
  }
  fail({ title: error });
}

export async function chatHandoff(args: string[]): Promise<void> {
  const verb = args[0];
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();

  if (verb === "begin") {
    const sessionId = envSessionId();
    // A mod's child has no CLAUDE_PID; the Claude registry names the process its session runs in.
    const pid = process.env.CLAUDE_PID ? Number(process.env.CLAUDE_PID) : (resolveInbox(sessionId)?.pid ?? NaN);
    if (!Number.isInteger(pid) || pid <= 0) failUsage("rt cannot tell which Claude process this is", USAGE, "Claude Code sets CLAUDE_PID and lists its session in its registry; a hand-off only runs inside a Claude session.");
    const { handle } = settle(await chatHandoffBegin({ sessionId, pid }, sockOpts(args)), json);
    if (json) out.json({ ok: true, handle });
    else say(`✓ handing off ${handle}`);
    return;
  }

  if (verb === "complete") {
    const from = fromSessionId(args);
    const sessionId = envSessionId();
    const { handle, name } = settle(await chatHandoffComplete({ fromSessionId: from, sessionId }, sockOpts(args)), json);
    writeChatSession({ sessionId, handle, baseHandle: baseOfHandle(handle), name, signedInAt: Date.now() });
    if (json) out.json({ ok: true, handle, name });
    else say(`✓ signed in as ${name}`);
    return;
  }

  if (verb === "cancel") {
    const from = fromSessionId(args);
    const { signedOut } = settle(await chatHandoffCancel({ fromSessionId: from }, sockOpts(args)), json);
    if (json) out.json({ ok: true, signedOut });
    else say(signedOut ? "✓ hand-off cancelled, signed out" : "✓ hand-off cancelled");
    return;
  }

  failUsage("Say begin, complete or cancel", USAGE);
}
