/**
 * rt progress record --tree <root> [--json]
 * rt progress list [--tree <root>] [--plan <path>] [--refresh] --json
 * Agent-facing: the work-progress plugin hook records ledgers and the
 * progress script lists them. Output is always JSON where it prints at all
 * (`list` prints it with or without --json); a usage error under either is
 * {"ok":false,"error":...} with exit 2.
 */
import { flagValue, required, Usage } from "../lib/cli-args.ts";
import { defaultDeps, listPlans, recordTree, type ProgressDeps } from "../lib/progress/store.ts";
import * as out from "../lib/ui/out.ts";

export type CliResult = { out: string; code: number };

const json = (value: unknown): string => JSON.stringify(value);

export function runProgress(args: string[], deps?: ProgressDeps): CliResult {
  try {
    const [verb, ...rest] = args;
    const wantJson = rest.includes("--json");
    if (verb === "record") {
      const tree = required(rest, "--tree");
      const records = recordTree(tree, deps ?? defaultDeps());
      return { out: wantJson ? json({ ok: true, records }) : "", code: 0 };
    }
    if (verb === "list") {
      const tree = flagValue(rest, "--tree");
      const plan = flagValue(rest, "--plan");
      const refresh = rest.includes("--refresh");
      if (refresh && tree === undefined) throw new Usage("--refresh requires --tree");
      const resolved = deps ?? defaultDeps();
      if (refresh && tree !== undefined) recordTree(tree, resolved);
      return { out: json({ ok: true, plans: listPlans({ tree, plan }, resolved) }), code: 0 };
    }
    throw new Usage(`unknown progress verb: ${verb ?? "(none)"}`);
  } catch (err) {
    if (err instanceof Usage) return { out: json({ ok: false, error: err.message }), code: 2 };
    throw err;
  }
}

async function run(verb: "record" | "list", args: string[]): Promise<void> {
  const r = runProgress([verb, ...args]);
  if (r.out !== "") out.payload(`${r.out}\n`);
  if (r.code !== 0) process.exit(r.code);
}

export const progressRecord = (args: string[]): Promise<void> => run("record", args);
export const progressList = (args: string[]): Promise<void> => run("list", args);
