/**
 * Opens a session's herdr pane the way `rt agent` always has: find or create
 * the workspace, dedup on the tab label, run the command, then name the pane
 * after its label. Shared by the session integrations; the herdr transport
 * comes from the launch host, so a background or herd launch lands on the
 * server its socket names.
 */

import { basename } from "path";
import type { FaultCode, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import type { HerdrRunner } from "../agent-herdr.ts";
import type { LaunchHost } from "./contracts.ts";

export type HostPaneLaunch = { cwd: string; command: string; reservationId: string; host?: LaunchHost };
export type HostPaneOpened = { pane: string; socket?: string; tabId?: string; workspaceId?: string };

const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function runnerFor(host: LaunchHost | undefined): Promise<HerdrRunner> {
  const { defaultHerdrRunner } = await import("../agent-herdr.ts");
  if (host?.socket) {
    const forSocket = host.herdr?.runnerForSocket ?? ((socket: string) => defaultHerdrRunner({ ...process.env, HERDR_SOCKET_PATH: socket }));
    return forSocket(host.socket);
  }
  return host?.herdr?.runner ?? defaultHerdrRunner();
}

/** herdr reports a failed rename in its JSON with exit code 0; either way the pane keeps running under its terminal title. */
async function renamePane(runner: HerdrRunner, paneId: string, label: string, host: LaunchHost | undefined): Promise<void> {
  try {
    const r = await runner(["pane", "rename", paneId, label]);
    if (r.exitCode !== 0 || r.stdout.includes('"error"')) host?.log?.warn({ paneId, out: r.stdout.slice(0, 400) }, "agent: pane rename failed; pane keeps its terminal title");
  } catch (err) {
    host?.log?.warn({ err, paneId }, "agent: pane rename failed; pane keeps its terminal title");
  }
}

/** herdr cuts a `pane run` line longer than this, and a cut launch line starts nothing. */
export const HERDR_LINE_LIMIT_BYTES = 1024;

/**
 * A focused existing tab, a command too long for one herdr line, and a launch
 * herdr never ran (HerdrLaunchNotRun) ran nothing, so each is a definite
 * refusal; any other thrown herdr call may have opened something, so it is
 * transient.
 */
export async function openHostPane(launch: HostPaneLaunch): Promise<Outcome<HostPaneOpened>> {
  const { host } = launch;
  const tab = host?.tab ?? launch.reservationId;
  const bytes = Buffer.byteLength(launch.command);
  if (bytes > HERDR_LINE_LIMIT_BYTES) {
    return fail("refused", `this session's launch command is ${bytes} bytes, longer than the ${HERDR_LINE_LIMIT_BYTES} herdr takes in one line, so rt did not start it; a shorter working directory path brings it under`);
  }
  try {
    const { launchInWorkspace } = await import("../agent-herdr.ts");
    const runner = await runnerFor(host);
    const out = await launchInWorkspace({ workspaceLabel: host?.workspace ?? basename(launch.cwd), tabLabel: tab, paneCommand: launch.command }, runner);
    if (out.focusedExisting) return fail("refused", `tab "${tab}" already open; focused it`);
    if (host?.label) await renamePane(runner, out.paneId, host.label, host);
    return {
      ok: true,
      data: { pane: out.paneId, tabId: out.tabId, workspaceId: out.workspaceId, ...(host?.socket !== undefined && { socket: host.socket }) },
    };
  } catch (err) {
    return fail(err instanceof Error && err.name === "HerdrLaunchNotRun" ? "refused" : "transient", messageOf(err));
  }
}
