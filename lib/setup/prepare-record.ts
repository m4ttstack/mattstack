/**
 * The record each `rt setup prepare` stage keeps, apart from the installs
 * themselves so Install's steps can wait on it without importing them.
 */
import { join } from "path";
import type { Probes } from "./probes.ts";
import { CLT_INSTALL_TIMEOUT_MS } from "./tools-install.ts";
import { pidAlive } from "./update-lock.ts";

/** The accounts item for Fast Browser's setup, which the connect form's Fast Browser row reads. */
export const FAST_BROWSER = "fast-browser";

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

/**
 * How long a run of each stage may take before its record stops counting as
 * running, whatever its pid says: a run killed before it could end its record
 * leaves the pid behind, and after a reboot that pid can belong to anything.
 * macos is the Command Line Tools install plus its catalog scans; accounts can
 * wait that long for macos and then install several tools.
 */
export const PREPARE_BUDGET_MS: Record<PrepareStage, number> = {
  macos: CLT_INSTALL_TIMEOUT_MS + 15 * 60_000,
  accounts: CLT_INSTALL_TIMEOUT_MS + 90 * 60_000,
};

const POLL_SECONDS = 5;

export function preparePath(home: string, stage: PrepareStage): string {
  return join(home, ".mattstack", "rt", `setup-prepare-${stage}.json`);
}

export function readPrepare(
  p: Pick<Probes, "readFile" | "home">,
  stage: PrepareStage,
  alive: (pid: number) => boolean = pidAlive,
  now: () => Date = () => new Date(),
): (PrepareRecord & { running: boolean }) | null {
  const text = p.readFile(preparePath(p.home, stage));
  if (text === null) return null;
  let record: PrepareRecord;
  try {
    record = JSON.parse(text) as PrepareRecord;
  } catch {
    return null;
  }
  if (typeof record !== "object" || record === null || !Array.isArray(record.items)) return null;
  const age = now().getTime() - Date.parse(record.startedAt);
  const withinBudget = age <= PREPARE_BUDGET_MS[stage];
  const running = typeof record.pid === "number" && record.endedAt === undefined && withinBudget && alive(record.pid);
  return { ...record, running };
}

export const PREPARE_WAIT_LINE = "Waiting for the background installs to finish";

/** Polls until the stage's run ends, `holds` stops holding, or `maxMs` passes. `onWait` runs once, before the first wait. */
export async function waitWhilePreparing(
  p: Probes,
  stage: PrepareStage,
  opts: { holds?: (record: PrepareRecord) => boolean; alive?: (pid: number) => boolean; maxMs?: number; onWait?: (line: string) => void } = {},
): Promise<void> {
  const holds = opts.holds ?? (() => true);
  const maxPolls = (opts.maxMs ?? PREPARE_BUDGET_MS[stage]) / (POLL_SECONDS * 1000);
  for (let poll = 0; poll < maxPolls; poll++) {
    const record = readPrepare(p, stage, opts.alive ?? pidAlive, () => p.now());
    if (!record?.running || !holds(record)) return;
    if (poll === 0) opts.onWait?.(PREPARE_WAIT_LINE);
    await p.exec(["sleep", String(POLL_SECONDS)], { timeoutMs: (POLL_SECONDS + 5) * 1000 });
  }
}
