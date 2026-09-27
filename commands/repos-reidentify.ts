/**
 * rt repos reidentify <old> <new> [--dry-run] [--json]
 *
 * Moves every identity-keyed store between two remote identities. The daemon
 * owns the apply whenever it answers; a local apply only happens when nothing
 * is up to race.
 */

import type { CommandContext } from "../lib/command-tree.ts";
import { reidentifyRepo } from "../lib/repo-reidentify-dispatch.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/setup/errors.ts";
import type { StoreReport } from "../lib/state/reidentify.ts";

const USAGE = "usage: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]";
const FLAGS = ["--json", "--dry-run"];
const VERB = "repos reidentify";

export interface ReidentifyDeps {
  print: (line: string) => void;
}

function table(stores: StoreReport[]): string[] {
  const width = Math.max(...stores.map((s) => s.store.length));
  return stores.map((s) => `  ${s.store.padEnd(width)}  ${s.status.padEnd(8)}${s.count}${s.detail ? `  (${s.detail})` : ""}`);
}

export async function reposReidentify(args: string[], _ctx: CommandContext = {}, deps: ReidentifyDeps = { print: console.log }): Promise<void> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  for (const a of args) {
    if (a.startsWith("--") && !FLAGS.includes(a)) {
      exitUserError(new UserActionableError("usage", `unknown flag "${a}"; ${USAGE}`), json, VERB, deps.print);
    }
  }
  const positionals = args.filter((a) => !a.startsWith("--"));
  if (positionals.length !== 2) {
    exitUserError(new UserActionableError("usage", `reidentify takes two identities, got ${positionals.length}; ${USAGE}`), json, VERB, deps.print);
  }
  const [from, to] = positionals as [string, string];

  const outcome = await reidentifyRepo({ from, to, dryRun });
  if (!outcome.ok && !outcome.report) {
    exitUserError(new UserActionableError("refused", outcome.error), json, VERB, deps.print);
  }
  const report = outcome.report!;

  if (json) {
    deps.print(JSON.stringify(envelope({ ok: outcome.ok, data: report })));
  } else {
    deps.print(`${dryRun ? "would move" : "moved"} ${report.from.serialized} to ${report.to.serialized} (${outcome.via})`);
    for (const line of table(report.stores)) deps.print(line);
  }
  if (!outcome.ok) {
    exitUserError(new UserActionableError("refused", outcome.error), json, VERB, deps.print);
  }
}
