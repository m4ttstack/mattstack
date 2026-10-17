/**
 * rt herdr start: makes sure the visible herdr server is running, starting it
 * detached when it is not. For the apps and agents; never prompts.
 */
import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { startHerdr, type HerdrStartResult } from "../lib/herdr/start.ts";
import { envelope } from "../lib/setup/contract.ts";
import * as out from "../lib/ui/out.ts";

export async function herdrStart(
  args: string[],
  _ctx: CommandContext = {},
  deps: { start: () => Promise<HerdrStartResult> } = { start: startHerdr },
): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const result = await deps.start();
  const ok = result.state === "running" || result.state === "started";
  if (json) {
    out.json(envelope(result));
    if (!ok) process.exitCode = 2;
    return;
  }
  if (result.state === "running") return void out.print(out.line("running", "herdr is running"));
  if (result.state === "started") return void out.print(out.line("done", "Started herdr"));
  if (result.state === "not-installed") {
    throw new UserActionableError("herdr-not-installed", "herdr isn't installed", {}, { next: "Open mattstack Setup" });
  }
  throw new UserActionableError("herdr-start-failed", result.detail);
}
