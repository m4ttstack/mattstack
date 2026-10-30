/**
 * `rt setup prepare`: the installs setup starts while the member is still
 * answering screens, so nothing waits on them later. Command Line Tools start
 * at the macOS screen; Claude Code, herdr and the team's tools start once the
 * member is approved. Each stage keeps its own record, which the form reads
 * to show a row as installing.
 */
import { dirname, join } from "path";
import type { Probes } from "./probes.ts";
import type { PackRequirements, ToolRequirement } from "./requirements.ts";
import { signInTools } from "./sign-in-tools.ts";
import { CLT_INSTALL_TIMEOUT_MS, installRoute, installTool } from "./tools-install.ts";
import { pidAlive } from "./update-lock.ts";

export type PrepareStage = "macos" | "accounts";
export const PREPARE_STAGES: readonly PrepareStage[] = ["macos", "accounts"];

export interface PrepareRecord {
  stage: PrepareStage;
  startedAt: string;
  pid?: number;
  endedAt?: string;
  items: string[];
  failed: { tool: string; detail: string }[];
}

export interface PrepareResult {
  stage: PrepareStage;
  skipped?: "running";
  installed: string[];
  failed: { tool: string; detail: string }[];
}

const PROBE_TIMEOUT_MS = 5000;
const MACOS_POLL_SECONDS = 5;

export function preparePath(home: string, stage: PrepareStage): string {
  return join(home, ".mattstack", "rt", `setup-prepare-${stage}.json`);
}

export function readPrepare(p: Pick<Probes, "readFile" | "home">, stage: PrepareStage, alive: (pid: number) => boolean = pidAlive): (PrepareRecord & { running: boolean }) | null {
  const text = p.readFile(preparePath(p.home, stage));
  if (text === null) return null;
  let record: PrepareRecord;
  try {
    record = JSON.parse(text) as PrepareRecord;
  } catch {
    return null;
  }
  if (typeof record !== "object" || record === null || !Array.isArray(record.items)) return null;
  const running = typeof record.pid === "number" && record.endedAt === undefined && alive(record.pid);
  return { ...record, running };
}

function writeRecord(p: Probes, record: PrepareRecord, pid: number): void {
  const path = preparePath(p.home, record.stage);
  const tmp = `${path}.${pid}.tmp`;
  p.mkdirp(dirname(path));
  p.writeFile(tmp, JSON.stringify(record));
  p.rename(tmp, path);
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
  return items;
}

/** brew and the vendor scripts need git, which arrives with Command Line Tools. */
async function waitForCommandLineTools(p: Probes, alive: (pid: number) => boolean): Promise<void> {
  const maxPolls = CLT_INSTALL_TIMEOUT_MS / (MACOS_POLL_SECONDS * 1000);
  for (let poll = 0; poll < maxPolls; poll++) {
    const macos = readPrepare(p, "macos", alive);
    if (!macos?.running || !macos.items.includes("apple-clt")) return;
    await p.exec(["sleep", String(MACOS_POLL_SECONDS)], { timeoutMs: (MACOS_POLL_SECONDS + 5) * 1000 });
  }
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runPrepare(
  p: Probes,
  stage: PrepareStage,
  deps: { reqs: PackRequirements[]; install?: typeof installTool; alive?: (pid: number) => boolean; pid?: number },
): Promise<PrepareResult> {
  const alive = deps.alive ?? pidAlive;
  const install = deps.install ?? installTool;
  if (readPrepare(p, stage, alive)?.running) return { stage, skipped: "running", installed: [], failed: [] };

  const items = await prepareTools(p, stage, deps.reqs);
  const pid = deps.pid ?? process.pid;
  const record: PrepareRecord = { stage, startedAt: p.now().toISOString(), pid, items, failed: [] };
  writeRecord(p, record, pid);

  const installed: string[] = [];
  try {
    if (stage === "accounts" && items.length > 0) await waitForCommandLineTools(p, alive);
    for (const tool of items) {
      try {
        const result = await install(p, tool, deps.reqs);
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
