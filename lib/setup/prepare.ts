/**
 * `rt setup prepare`: the installs setup starts while the member is still
 * answering screens, so nothing waits on them later. Command Line Tools start
 * at the macOS screen; Claude Code, herdr, the team's tools and Fast Browser's
 * runtime start once the member is approved. Each stage keeps its own record,
 * which the form reads to show a row as installing.
 */
import { dirname } from "path";
import { resolveTool } from "../deps/resolve.ts";
import type { StepOutcome } from "./apply.ts";
import { FAST_BROWSER, preparePath, readPrepare, waitWhilePreparing, type PrepareRecord, type PrepareStage } from "./prepare-record.ts";
import type { Probes } from "./probes.ts";
import type { PackRequirements, ToolRequirement } from "./requirements.ts";
import { signInTools } from "./sign-in-tools.ts";
import { setUpFastBrowser } from "./steps/tools.ts";
import { CLT_INSTALL_TIMEOUT_MS, installRoute, installTool } from "./tools-install.ts";
import { pidAlive } from "./update-lock.ts";

export { FAST_BROWSER, PREPARE_BUDGET_MS, PREPARE_STAGES, preparePath, readPrepare, type PrepareRecord, type PrepareStage } from "./prepare-record.ts";

export interface PrepareResult {
  stage: PrepareStage;
  skipped?: "running";
  installed: string[];
  failed: { tool: string; detail: string }[];
}

const PROBE_TIMEOUT_MS = 5000;

function writeRecord(p: Probes, record: PrepareRecord, pid: number): void {
  const path = preparePath(p.home, record.stage);
  const tmp = `${path}.${pid}.tmp`;
  p.mkdirp(dirname(path));
  p.writeFile(tmp, JSON.stringify(record));
  p.rename(tmp, path);
}

/**
 * What a person's own `rt tools install` left behind, in the record the form
 * reads. `failure` null is a success. A running record is left to its owner,
 * and anything this writes reads as ended, so no pid in it can look alive later.
 */
export function recordToolInstall(p: Probes, tool: string, failure: string | null, opts: { alive?: (pid: number) => boolean; pid?: number } = {}): void {
  const current = readPrepare(p, "accounts", opts.alive ?? pidAlive, () => p.now());
  if (current?.running) return;
  const now = p.now().toISOString();
  const pressFailed = [...(current?.pressFailed ?? []).filter((f) => f.tool !== tool), ...(failure === null ? [] : [{ tool, detail: failure }])];
  const record: PrepareRecord = { stage: "accounts", startedAt: current?.startedAt ?? now, endedAt: current?.endedAt ?? now, items: current?.items ?? [], failed: current?.failed ?? [], pressFailed };
  writeRecord(p, record, opts.pid ?? process.pid);
}

async function missingBinary(p: Probes, tool: string): Promise<boolean> {
  return (await p.exec([tool, "--version"], { timeoutMs: PROBE_TIMEOUT_MS })).code === 127;
}

function firstByName(tools: ToolRequirement[]): ToolRequirement[] {
  const seen = new Set<string>();
  return tools.filter((t) => !seen.has(t.name) && seen.add(t.name));
}

export async function prepareTools(p: Probes, stage: PrepareStage, reqs: PackRequirements[]): Promise<string[]> {
  if (stage === "macos") {
    const clt = await p.exec(["xcode-select", "-p"], { timeoutMs: PROBE_TIMEOUT_MS });
    return clt.code === 0 ? [] : ["apple-clt"];
  }

  const items: string[] = [];
  for (const tool of ["claude", "herdr"]) if (await missingBinary(p, tool)) items.push(tool);

  const required = (tools: ToolRequirement[]) => tools.filter((t) => !t.optional);
  const team = firstByName([...required(signInTools(reqs)), ...required(reqs.flatMap((r) => r.tools))]);
  let hasBrew: boolean | null = null;
  for (const tool of team) {
    if (items.includes(tool.name) || !(await missingBinary(p, tool.name))) continue;
    hasBrew ??= (await p.exec(["brew", "--version"], { timeoutMs: PROBE_TIMEOUT_MS })).code === 0;
    if ((await installRoute(p, tool.name, reqs, hasBrew)) !== null) items.push(tool.name);
  }
  // Last, so the Claude Code it integrates into is already installed.
  if (resolveTool(p, FAST_BROWSER).exec) items.push(FAST_BROWSER);
  return items;
}

/** brew and the vendor scripts need git, which arrives with Command Line Tools. */
async function waitForCommandLineTools(p: Probes, alive: (pid: number) => boolean): Promise<void> {
  await waitWhilePreparing(p, "macos", { holds: (macos) => macos.items.includes("apple-clt"), alive, maxMs: CLT_INSTALL_TIMEOUT_MS });
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runPrepare(
  p: Probes,
  stage: PrepareStage,
  deps: { reqs: PackRequirements[]; install?: typeof installTool; setUpFastBrowser?: (p: Probes) => Promise<StepOutcome>; alive?: (pid: number) => boolean; pid?: number },
): Promise<PrepareResult> {
  const alive = deps.alive ?? pidAlive;
  const install = deps.install ?? installTool;
  const setUp = deps.setUpFastBrowser ?? ((probes: Probes) => setUpFastBrowser(probes, { nonInteractive: true }));
  const installOne = async (tool: string) => {
    if (tool !== FAST_BROWSER) return install(p, tool, deps.reqs);
    const outcome = await setUp(p);
    return outcome.state === "done" ? { ok: true as const } : { ok: false as const, detail: outcome.detail };
  };
  const previous = readPrepare(p, stage, alive, () => p.now());
  if (previous?.running) return { stage, skipped: "running", installed: [], failed: [] };

  const items = await prepareTools(p, stage, deps.reqs);
  const pid = deps.pid ?? process.pid;
  const record: PrepareRecord = { stage, startedAt: p.now().toISOString(), pid, items, failed: [], ...(previous?.pressFailed ? { pressFailed: previous.pressFailed } : {}) };
  writeRecord(p, record, pid);

  const installed: string[] = [];
  try {
    if (stage === "accounts" && items.length > 0) await waitForCommandLineTools(p, alive);
    for (const tool of items) {
      try {
        const result = await installOne(tool);
        if (result.ok) installed.push(tool);
        else record.failed.push({ tool, detail: result.detail });
      } catch (err) {
        record.failed.push({ tool, detail: errorDetail(err) });
      }
      writeRecord(p, record, pid);
    }
  } finally {
    const { pid: _pid, ...rest } = record;
    writeRecord(p, { ...rest, endedAt: p.now().toISOString() }, pid);
  }
  return { stage, installed, failed: record.failed };
}
