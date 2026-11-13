/**
 * rt git auth: lets a clone's git sign in with the forge token rt holds.
 * `--check` reports every registered clone and changes nothing.
 */

import { existsSync } from "fs";
import type { CommandContext } from "../../lib/command-tree.ts";
import { loadRepoIndexEntries } from "../../lib/repo-index.ts";
import { repoLabel } from "../../lib/repo-label.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { classifyClone, realCloneDeps, type CloneDeps, type CloneState } from "./clone-state.ts";
import { failUsage } from "./shared.ts";

export interface AuthDeps extends CloneDeps {
  entries(): { repoName: string; path: string }[];
  interactive: boolean;
  confirm(message: string): Promise<boolean>;
  /** The --json envelope only. */
  print(line: string): void;
}

export function realAuthDeps(): AuthDeps {
  return {
    ...realCloneDeps(),
    entries: () => loadRepoIndexEntries().map(({ repoName, path }) => ({ repoName, path })),
    interactive: Boolean(process.stdin.isTTY) && !process.env.RT_BATCH,
    confirm: async (message) => {
      const { confirm } = await import("../../lib/rt-render.ts");
      return confirm({ message, stderr: true });
    },
    print: (line) => out.payload(`${line}\n`),
  };
}

/** `s` is null when the clone's git config could not be read: it still gets a row, so one bad clone never stops the report. */
export type CheckRow = { label: string; path: string; s: CloneState | null };

const UNREADABLE_REASON = "rt could not read its git config";

export function checkBlocks(rows: CheckRow[]): Block[] {
  if (rows.length === 0) return [out.line("skipped", "rt has no registered clones")];
  const blocks: Block[] = [];
  for (const { label, s } of rows) {
    if (s === null) {
      blocks.push(out.line("skipped", label, UNREADABLE_REASON));
      continue;
    }
    blocks.push(out.line(s.state, label, s.reason));
    if (s.next) blocks.push(out.callout("next", out.cmd(s.next)));
  }
  return blocks;
}

async function checkRows(deps: AuthDeps): Promise<CheckRow[]> {
  const rows: CheckRow[] = [];
  for (const { repoName, path } of deps.entries()) {
    if (!existsSync(path)) continue;
    const label = repoLabel(repoName);
    let s: CloneState | null;
    try {
      s = await classifyClone(path, deps);
    } catch {
      s = null;
    }
    rows.push({ label, path, s });
  }
  return rows;
}

/** Only these fields leave: origin's URL and a clone's own helpers can hold a secret. */
function jsonRow({ label, path, s }: CheckRow): Record<string, unknown> {
  if (s === null) return { path, label, state: "skipped", transport: null, host: null };
  return { path, label, state: s.state, transport: s.transport, host: s.host, ...(s.next ? { next: s.next } : {}) };
}

const USAGE = "usage: rt git auth --check [--json]";

export async function authCommand(args: string[], _ctx: CommandContext, deps: AuthDeps = realAuthDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  if (!args.includes("--check")) failUsage(json, "Pass --check to see your clones", USAGE);

  const rows = await checkRows(deps);
  if (json) {
    deps.print(JSON.stringify({ ok: true, repos: rows.map(jsonRow) }));
    return;
  }
  out.print(...checkBlocks(rows));
}
