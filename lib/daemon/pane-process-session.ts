import { sessionForPid } from "../claude-registry.ts";
import type { herdrRequest } from "../herdr/client.ts";
import type { HerdrPane } from "./handlers/pane.ts";

/** The pane's foreground process group, then its foreground processes, in herdr's order. */
async function foregroundPids(herdr: typeof herdrRequest, paneId: string, sockPath: string | undefined): Promise<number[]> {
  const info = await herdr<{ process_info?: { foreground_process_group_id?: number | null; foreground_processes?: { pid: number }[] } }>(
    "pane.process_info",
    { pane_id: paneId },
    { sockPath },
  );
  if (!info.ok || !info.result.process_info) return [];
  const { foreground_process_group_id: group, foreground_processes: procs = [] } = info.result.process_info;
  return [...(typeof group === "number" ? [group] : []), ...procs.map((p) => p.pid)];
}

/**
 * herdr learns a pane's session only from the SessionStart hook, which
 * reports to the shell's `HERDR_PANE_ID`. A shell that outlived a herdr pane
 * renumber still carries the old id, so herdr drops the report and the pane
 * shows no `agent_session`. The pane's foreground Claude process and its own
 * registry file still name the session.
 */
export async function sessionFromPaneProcess(
  herdr: typeof herdrRequest,
  paneId: string,
  sockPath: string | undefined,
  registryRoots?: string[],
): Promise<string | null> {
  for (const pid of await foregroundPids(herdr, paneId, sockPath)) {
    const sessionId = sessionForPid(pid, { roots: registryRoots });
    if (sessionId) return sessionId;
  }
  return null;
}

/** `pane` with `agent_session` filled from its process when herdr has none. */
export async function withProcessSession(
  herdr: typeof herdrRequest,
  pane: HerdrPane,
  sockPath: string | undefined,
  registryRoots?: string[],
): Promise<HerdrPane> {
  if (pane.agent_session?.kind === "id") return pane;
  const sessionId = await sessionFromPaneProcess(herdr, pane.pane_id, sockPath, registryRoots);
  if (!sessionId) return pane;
  return { ...pane, agent_session: { source: "process", agent: "claude", kind: "id", value: sessionId } };
}

/**
 * withProcessSession for any harness: the pane's foreground process is looked
 * up through its harness's own `sessionForPid`. A harness without one is never
 * asked, and its pane's process is not read.
 */
export async function withIntegrationSession(
  herdr: typeof herdrRequest,
  pane: HerdrPane,
  sockPath: string | undefined,
  sessionForPid: ((pid: number) => Promise<string | null>) | undefined,
): Promise<HerdrPane> {
  if (pane.agent_session?.kind === "id" || pane.agent === undefined || !sessionForPid) return pane;
  for (const pid of await foregroundPids(herdr, pane.pane_id, sockPath)) {
    const sessionId = await sessionForPid(pid);
    if (sessionId) return { ...pane, agent_session: { source: "process", agent: pane.agent, kind: "id", value: sessionId } };
  }
  return pane;
}
