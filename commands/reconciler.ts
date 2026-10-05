/**
 * rt reconciler: CLI over the executor reconciler's read-only status and
 * manual clear (lib/daemon/reconciler.ts). Thin over the rt-client
 * reconciler* wrappers, same idiom as commands/bg.ts.
 *
 *   rt reconciler status [--json]            last sweep snapshot
 *   rt reconciler clear <agentId> [--json]   clear one agent's reconciler state
 */
import { reconcilerClear as clientClear, reconcilerStatus as clientStatus } from "../packages/rt-client/src/index.ts";
import type { Commands, ExecutorState, RtResponse } from "../packages/rt-client/src/index.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

function fail(msg: string): never {
  out.fail({ title: msg });
  process.exit(1);
}

function positional(args: string[]): string | undefined {
  for (const a of args) {
    if (!a.startsWith("--")) return a;
  }
  return undefined;
}

function unwrap<T>(res: RtResponse<T>, label: string): T {
  if (!res.ok || res.data === undefined) fail(res.error ?? `${label} failed`);
  return res.data;
}

const EXECUTOR: Record<ExecutorState, { word: string; role: Segment["role"] }> = {
  live: { word: "live", role: "running" },
  blocked: { word: "waiting on you", role: "needs-you" },
  hidden: { word: "hidden", role: "off" },
  gone: { word: "gone", role: "warn" },
  cleared: { word: "cleared", role: "skipped" },
  unknown: { word: "unknown", role: "skipped" },
};

export function reconcilerStatusBlocks(data: Commands["reconciler:status"]["data"]): Block[] {
  const blocks: Block[] = [
    out.kv("last sweep", data.sweptAt > 0 ? new Date(data.sweptAt).toLocaleString() : "never"),
    data.herdrReachable ? out.line("done", "herdr is reachable") : out.line("warn", "herdr is not reachable"),
  ];
  if (data.executors.length === 0) return [...blocks, out.line("skipped", "No known executors")];
  const rows = data.executors.map((e) => {
    const state = Object.hasOwn(EXECUTOR, e.state) ? EXECUTOR[e.state] : EXECUTOR.unknown;
    return [out.strong(e.agentId), { text: state.word, role: state.role }, out.dim(e.paneRef ?? "-")];
  });
  return [...blocks, out.table(rows)];
}

export async function reconcilerStatus(args: string[]): Promise<void> {
  const data = unwrap(await clientStatus(), "status");
  if (args.includes("--json")) return void out.json({ ok: true, ...data });
  out.print(...reconcilerStatusBlocks(data));
}

export async function reconcilerClear(args: string[]): Promise<void> {
  const agentId = positional(args);
  if (!agentId) {
    out.fail(usageFailure("Which agent?", "rt reconciler clear <agentId>"));
    process.exit(1);
  }
  const data = unwrap(await clientClear({ agentId }), "clear");
  if (args.includes("--json")) return void out.json({ ok: true, ...data });
  out.print(out.line("done", `Cleared ${agentId}`));
}
