import type { CallerContext, Outcome } from "../packages/rt-client/src/agent-integrations.ts";
import {
  extractMcpEvidence, mcpTransportFromArgs, resolveCallerContext, type CallerEvidence, type McpTransport,
} from "../lib/agent-integrations/context.ts";
import { UserActionableError } from "../lib/errors.ts";
import { mcpTools, type McpToolDef } from "../lib/mcp/tools.ts";
import { callTool } from "../lib/mcp/redact.ts";
import { toolContext } from "../lib/mcp/shared.ts";
import * as out from "../lib/ui/out.ts";

declare const RT_VERSION: string;

export function mcpToolsPayload(tools: McpToolDef[] = mcpTools()): { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> } {
  return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
}

export async function mcpToolsList(args: string[]): Promise<void> {
  const payload = mcpToolsPayload();
  if (args.includes("--json")) {
    await out.jsonFlushed(payload);
    return;
  }
  out.payload(payload.tools.map((t) => `${t.name}\n`).join(""));
}

type CallParams = { name: string; arguments?: Record<string, unknown>; _meta?: unknown };

/**
 * Caller evidence comes from the request's own `params._meta`, which the
 * pinned SDK's CallToolRequestSchema keeps as a loose object, and from this
 * server's launch configuration; `arguments` never reaches the extractor.
 */
export function createCallHandler(
  tools: McpToolDef[],
  transport: McpTransport,
  env: NodeJS.ProcessEnv,
  resolve: (evidence: CallerEvidence) => Promise<Outcome<CallerContext>> = (evidence) => resolveCallerContext(evidence),
): (params: CallParams, signal?: AbortSignal) => Promise<Awaited<ReturnType<typeof callTool>>> {
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  return async (params, signal) => {
    const tool = toolByName.get(params.name);
    if (!tool) return { isError: true, content: [{ type: "text" as const, text: `unknown tool: ${params.name}` }] };
    const context = toolContext(extractMcpEvidence(params._meta, env, transport), resolve);
    return callTool(tool, (params.arguments ?? {}) as Record<string, unknown>, env, signal, context);
  };
}

/**
 * McpServer.registerTool in the pinned SDK requires zod schemas, so this
 * uses the low-level Server to serve each tool's raw JSON Schema unchanged.
 */
export async function mcpServe(args: string[]): Promise<void> {
  const [{ Server }, { StdioServerTransport }, { ListToolsRequestSchema, CallToolRequestSchema }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);

  const tools = mcpTools();
  const launch = mcpTransportFromArgs(args, process.env);
  if (!launch.ok) throw new UserActionableError("mcp-transport", "rt mcp serve was started with a launch setting it does not support", {}, { why: launch.error.message });
  const handleCall = createCallHandler(tools, launch.data, process.env);

  const version = (typeof RT_VERSION !== "undefined" ? RT_VERSION : null) ?? process.env.RT_VERSION ?? "1.0.0";
  const server = new Server({ name: "mattstack", version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  }));

  // The SDK aborts every in-flight tools/call on close and drops its reply
  // (it checks the abort signal before sending), so stdin EOF must wait for
  // these to settle rather than close underneath them.
  const pending = new Set<Promise<unknown>>();

  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    const call = handleCall(request.params, extra.signal);
    pending.add(call);
    call.finally(() => pending.delete(call));
    return call;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const DRAIN_TIMEOUT_MS = 5000;

  // StdioServerTransport only listens for stdin "data"/"error"; it never
  // observes EOF, so without this the process would hang forever once the
  // client disconnects.
  await new Promise<void>((resolve) => {
    server.onclose = () => resolve();
    process.stdin.on("end", () => {
      void (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((r) => { timer = setTimeout(r, DRAIN_TIMEOUT_MS); });
        await Promise.race([Promise.allSettled(pending), timeout]);
        if (timer) clearTimeout(timer);
        // A macrotask boundary flushes the SDK's own send continuation,
        // which is chained a tick past each settled call above.
        await new Promise((r) => setImmediate(r));
        server.close().catch(() => resolve());
      })();
    });
  });
}
