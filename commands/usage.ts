import { join } from "path";
import { logCliEvent } from "../lib/cli-logger.ts";
import { cswapConfigDirs } from "../lib/cswap.ts";
import { stableMachineId } from "../lib/home/machine-id.ts";
import { runsRoot } from "../lib/runs/paths.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import { listAgents, type AgentRecord } from "../lib/state/agents-store.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import type { AgentLink } from "../lib/usage/sources.ts";
import { usageDbPath } from "../lib/usage/store.ts";
import { runSweep, type SweepLog, type SweepResult } from "../lib/usage/sweep.ts";

const log: SweepLog = {
  warn: (context, message) => logCliEvent("warn", "usage", message, context),
  debug: (context, message) => logCliEvent("debug", "usage", message, context),
};

export function agentLink(agent: AgentRecord): AgentLink {
  return {
    id: agent.id,
    sessionId: agent.sessionId,
    subject: agent.subject ?? null,
    label: agent.label ?? null,
    caller: agent.caller ?? null,
  };
}

export function sweepBlock(result: SweepResult): Block {
  if (!result.ran) return out.line("skipped", "Another usage sweep is already running");
  return out.line(
    "done",
    `Checked ${result.files} transcripts and updated ${result.messages} messages`,
  );
}

export async function usageSweepCommand(): Promise<void> {
  const probes = createRealProbes();
  const result = await runSweep({
    dbPath: usageDbPath(),
    runsRoot: runsRoot(),
    configDirs: [join(probes.home, ".claude"), ...cswapConfigDirs(probes)],
    agents: listAgents({}).map(agentLink),
    machineId: () => stableMachineId(),
    now: Date.now(),
    log,
  });
  out.print(sweepBlock(result));
}
