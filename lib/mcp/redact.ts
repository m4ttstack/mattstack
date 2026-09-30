import { redactCredentials } from "../../packages/rt-client/src/redact.ts";
import { err, type McpToolDef, type ToolResult } from "./shared.ts";

/** Every tool result passes through here on its way into an agent
    transcript, so this is the one place a credential is stopped, whichever
    tool or field carried it. */
export { redactCredentials };

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactCredentials(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return redactDeep((value as { toJSON: () => unknown }).toJSON());
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[redactCredentials(k)] = redactDeep(v);
    return out;
  }
  return value;
}

type CallResult = { isError?: true; content: Array<{ type: "text"; text: string }> };

export function toCallResult(res: ToolResult): CallResult {
  if (!res.ok) return { isError: true, content: [{ type: "text", text: redactCredentials(res.error ?? "failed") }] };
  return { content: [{ type: "text", text: JSON.stringify(redactDeep(res.body ?? null)) }] };
}

/** A throw inside a handler would otherwise reach the SDK, which sends its
    message to the client as a JSON-RPC error without passing through here. */
export async function callTool(tool: McpToolDef, args: Record<string, unknown>, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<CallResult> {
  try {
    return toCallResult(await tool.handler(args, env, signal));
  } catch (e) {
    return toCallResult(err(e instanceof Error ? e.message : String(e)));
  }
}
