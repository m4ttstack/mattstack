/**
 * `rt setup prepare <macos|accounts>`: runs the installs setup can do in the
 * background. The app spawns it and may quit before it ends, so a lost
 * reader never stops an install.
 */
import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { ignoreClosedPipes } from "../lib/setup/closed-pipes.ts";
import { envelope } from "../lib/setup/contract.ts";
import { orgRefFromIntent, readIntent } from "../lib/setup/intent.ts";
import { PREPARE_STAGES, runPrepare, type PrepareResult, type PrepareStage } from "../lib/setup/prepare.ts";
import { createRealProbes, type Probes } from "../lib/setup/probes.ts";
import { readPackRequirements, type PackRequirements } from "../lib/setup/requirements.ts";
import type { installTool } from "../lib/setup/tools-install.ts";
import { exitWithUserError } from "../lib/setup/user-failure.ts";
import { listOrgs } from "../lib/settings/stores.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

export interface PrepareDeps {
  probes: Probes;
  reqs: (p: Probes) => PackRequirements[];
  json: (v: unknown) => void;
  exit: (code: number) => never;
  install?: typeof installTool;
  alive?: (pid: number) => boolean;
}

function teamReqs(p: Probes): PackRequirements[] {
  const ref = orgRefFromIntent(readIntent(p), listOrgs());
  return ref.slug ? readPackRequirements(p, ref.slug) : [];
}

function realPrepareDeps(): PrepareDeps {
  return { probes: createRealProbes(), reqs: teamReqs, json: (v) => out.json(v), exit: process.exit };
}

const USAGE = "rt setup prepare macos|accounts";

function isStage(value: string | undefined): value is PrepareStage {
  return PREPARE_STAGES.includes(value as PrepareStage);
}

function resultBlocks(result: PrepareResult): Block[] {
  if (result.skipped === "running") return [out.line("skipped", "Setup is already installing these")];
  const blocks = [...result.installed.map((tool) => out.line("done", `Installed ${tool}`)), ...result.failed.map((f) => out.line("failed", `${f.tool} was not installed`, f.detail))];
  return blocks.length > 0 ? blocks : [out.line("done", "Nothing to install")];
}

export async function setupPrepare(args: string[], _ctx: CommandContext = {}, deps: PrepareDeps = realPrepareDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) {
    out.payloadOnStdout();
    ignoreClosedPipes();
  }
  const p = deps.probes;

  const stage = args.find((a) => !a.startsWith("--"));
  if (!isStage(stage)) {
    const err = new UserActionableError("bad-stage", `${stage ?? "(none)"} is not a part of setup that installs anything. Use macos or accounts`);
    return exitWithUserError(err, json, { json: deps.json, exit: deps.exit, now: () => p.now() }, usageFailure("Pick a part of setup: macos or accounts", USAGE));
  }

  const result = await runPrepare(p, stage, { reqs: deps.reqs(p), install: deps.install, alive: deps.alive });
  if (json) {
    try {
      deps.json(envelope(result, p.now()));
    } catch {
      // The app that spawned this may have quit; its installs already ran.
    }
    return;
  }
  out.print(...resultBlocks(result));
}
