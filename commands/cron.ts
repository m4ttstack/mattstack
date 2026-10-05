/**
 * rt cron install|remove: manage daemon cron triggers.
 *
 *   rt cron install <trigger> [--json]   (trigger: board-triage)
 *   rt cron remove <trigger> [--json]
 */

import type { CommandContext } from "../lib/command-tree.ts";
import { resolveTool } from "../lib/deps/resolve.ts";
import { getKnownRepos } from "../lib/repo-index.ts";
import { installCronTrigger, removeCronTrigger, resolveBoardTriage, triageTrigger } from "../lib/setup/cron-install.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/errors.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";

const KNOWN_TRIGGERS = ["board-triage"] as const;
type KnownTrigger = (typeof KNOWN_TRIGGERS)[number];

function usageForTrigger(json: boolean, verb: string): never {
  if (json) {
    exitUserError(
      new UserActionableError("usage", `usage: rt cron ${verb} <trigger> [--json] (trigger: ${KNOWN_TRIGGERS.join(", ")})`),
      json,
    );
  }
  out.fail(usageFailure("Which trigger?", "rt cron <install|remove> <trigger>", `The one trigger is ${KNOWN_TRIGGERS.join(", ")}.`));
  process.exit(2);
}

async function requireKnownTrigger(args: string[], json: boolean, verb: string): Promise<KnownTrigger> {
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    // No trigger given: an interactive terminal gets a picker; agents and
    // --json callers keep the usage error and its exit code.
    if (process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      const picked = await filterableSelect({
        message: `rt cron ${verb}`,
        options: KNOWN_TRIGGERS.map((t) => ({ value: t, label: t, hint: "" })),
      });
      if (!picked) process.exit(0);
      return picked as KnownTrigger;
    }
    usageForTrigger(json, verb);
  }
  // A present-but-unknown trigger is a typo, not an omission: still an error.
  if (!(KNOWN_TRIGGERS as readonly string[]).includes(name)) usageForTrigger(json, verb);
  return name as KnownTrigger;
}

export async function cronInstall(args: string[], _ctx: CommandContext = {}): Promise<void> {
  const json = args.includes("--json");
  await requireKnownTrigger(args, json, "install");

  const p = createRealProbes();
  const board = resolveTool(p, "board");
  const resolution = resolveBoardTriage(p, getKnownRepos(), board.exec);

  if (resolution.kind === "missing") {
    exitUserError(
      new UserActionableError(
        "board-missing",
        "rt cannot find the board app",
        {},
        { next: "rt deps resolve board" },
      ),
      json,
    );
  }

  const trigger = triageTrigger(resolution.run);
  installCronTrigger(trigger);

  if (json) {
    out.json(envelope({ installed: trigger, restartRequired: false }));
    return;
  }
  out.print(
    out.line("done", `Installed the ${trigger.name} schedule`, "the daemon picks it up within 30 seconds"),
    out.callout("tip", ["To start it now: ", out.cmd("rt daemon restart")]),
  );
}

export async function cronRemove(args: string[], _ctx: CommandContext = {}): Promise<void> {
  const json = args.includes("--json");
  const name = await requireKnownTrigger(args, json, "remove");

  const result = removeCronTrigger(name);

  if (json) {
    out.json(envelope({ removed: result.removed, name, restartRequired: false }));
    return;
  }
  if (result.removed) {
    out.print(
      out.line("done", `Removed the ${name} schedule`, "the daemon drops it within 30 seconds"),
      out.callout("tip", ["To apply this now: ", out.cmd("rt daemon restart")]),
    );
  } else {
    out.print(out.line("skipped", `The ${name} schedule was not installed`));
  }
}
