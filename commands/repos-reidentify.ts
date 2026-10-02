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
import { UserActionableError, exitUserError } from "../lib/errors.ts";
import type { StoreReport } from "../lib/state/reidentify.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

const USAGE = "usage: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]";
const FLAGS = ["--json", "--dry-run"];
const VERB = "repos reidentify";

export interface ReidentifyDeps {
  /** The --json envelope line only; human text goes through lib/ui/out.ts. */
  print: (line: string) => void;
}

function storeTable(stores: StoreReport[]): Block {
  return out.table(stores.map((s) => (s.detail ? [s.store, s.status, String(s.count), out.dim(s.detail)] : [s.store, s.status, String(s.count)])));
}

function givenCount(n: number): string {
  if (n === 0) return "none";
  if (n === 1) return "one";
  return String(n);
}

/** `jsonMessage` is the envelope's error text and never changes; a person gets the sentence and the command. */
function refuseUsage(deps: ReidentifyDeps, json: boolean, jsonMessage: string, title: string, why?: string): never {
  if (json) exitUserError(new UserActionableError("usage", jsonMessage), true, VERB, deps.print);
  out.fail(usageFailure(title, USAGE, why));
  process.exit(2);
}

export async function reposReidentify(args: string[], _ctx: CommandContext = {}, deps: ReidentifyDeps = { print: (line) => out.payload(`${line}\n`) }): Promise<void> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  for (const a of args) {
    if (a.startsWith("--") && !FLAGS.includes(a)) {
      refuseUsage(deps, json, `unknown flag "${a}"; ${USAGE}`, `This command has no option called ${a}`);
    }
  }
  const positionals = args.filter((a) => !a.startsWith("--"));
  if (positionals.length !== 2) {
    refuseUsage(deps, json, `reidentify takes two identities, got ${positionals.length}; ${USAGE}`, "This needs the repo's old identity and its new one", `You gave ${givenCount(positionals.length)}.`);
  }
  const [from, to] = positionals as [string, string];

  const outcome = await reidentifyRepo({ from, to, dryRun });
  if (!outcome.ok && !outcome.report) {
    exitUserError(new UserActionableError("refused", outcome.error, {}, { why: outcome.why, next: outcome.next }), json, VERB, deps.print);
  }
  const report = outcome.report!;
  const route = `${report.from.serialized} → ${report.to.serialized}`;

  if (!outcome.ok) {
    // JSON mode must stay one parseable document, so the report rides in the error payload.
    if (json) exitUserError(new UserActionableError("refused", outcome.error, { via: outcome.via, report }), true, VERB, deps.print);
    out.note(out.line("refused", dryRun ? "This move would be refused" : "The move stopped partway", route), storeTable(report.stores));
    process.exit(2);
  }

  if (json) {
    deps.print(JSON.stringify(envelope({ ok: true, via: outcome.via, data: report })));
    return;
  }
  // A typo in <old> reads as an all-none report, which must not look like a move.
  const nothing = report.stores.every((s) => s.status === "none");
  out.print(
    nothing
      ? out.line("skipped", "Nothing to move", `rt holds nothing under ${report.from.serialized}`)
      : out.line(dryRun ? "pending" : "done", dryRun ? "Would move this repo's data" : "Moved this repo's data", route),
    storeTable(report.stores),
  );
}
