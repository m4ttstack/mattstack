import { join } from "node:path";

import type { Evidence } from "../evidence";
import { readJsonl } from "../evidence";
import type { Lab } from "../lab";
import { judgeSockets } from "../verdicts";
import { drive, ready } from "./common";

export async function run(lab: Lab, ev: Evidence) {
  const w = lab.workers[0] ?? (await lab.launchWorker("s1"));
  const c = await lab.connect();
  try {
    const state = await ready(c, w);
    ev.record("G6-effective", {
      sandbox: state.sandbox,
      approvalPolicy: state.approvalPolicy,
    });
    await drive(
      c,
      w,
      "Call probe_rt_ping from the harness_probe MCP server with marker G6. Reply DONE."
    );
    const row = readJsonl(join(lab.runDir, "mcp.jsonl")).find(
      r => r.kind === "rt-ping" && r.marker === "G6"
    );
    ev.record("G6-ping", row);
    return [
      judgeSockets({
        mcp: row?.ping?.ok,
        restricted:
          state.sandbox?.type === "workspaceWrite" &&
          state.sandbox.networkAccess === false,
      }),
    ];
  } finally {
    c.close();
  }
}
