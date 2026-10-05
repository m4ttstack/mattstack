/**
 * rt services list|register|restart: thin facade over tray.sock's
 * /services routes (mattstack.app's LaunchAgent registrar). Used standalone
 * and by the apply engine's services.register step.
 *
 *   rt services list [--json]
 *   rt services register [--plist <name>]... [--json]
 *   rt services restart <label> [--json]
 */

import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { flagValues } from "../lib/cli-args.ts";
import { processFlavor } from "../lib/flavor.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/errors.ts";
import { servicePlists } from "../lib/setup/need.ts";
import { createRealProbes, type Probes } from "../lib/setup/probes.ts";

export interface ServicesDeps {
  probes: Probes;
  print: (s: string) => void;
  /** Notices must not land inside a JSON envelope on stdout. */
  warn: (s: string) => void;
  /** exitUserError owns its exit; this seam covers result failures. */
  exit?: (code: number) => never;
}

export function realServicesDeps(): ServicesDeps {
  return { probes: createRealProbes(), print: (s) => out.payload(`${s}\n`), warn: (s) => out.note(out.line("warn", s)), exit: process.exit };
}

interface ServiceAgent {
  label: string;
  status: string;
}

interface RegisterReply {
  ok: boolean;
  results?: unknown;
}

function appNotRunning(json: boolean, verb: string, deps: ServicesDeps): never {
  exitUserError(new UserActionableError("app-not-running", "mattstack.app is not open", {}, { why: "rt asks it to manage background services.", next: "open -a mattstack" }), json, verb, deps.print);
}

function exitWith(deps: ServicesDeps, code: number): never {
  return (deps.exit ?? process.exit)(code);
}

export async function servicesList(args: string[], _ctx: CommandContext = {}, deps: ServicesDeps = realServicesDeps()): Promise<void> {
  const json = args.includes("--json");

  const res = await deps.probes.tray<{ agents: ServiceAgent[] }>("/services", { method: "GET" });
  if (res.status === 0) appNotRunning(json, "services list", deps);

  const agents = res.status === 200 ? res.json?.agents : undefined;
  if (!Array.isArray(agents)) {
    exitUserError(
      new UserActionableError("services-list-failed", "mattstack.app gave an answer rt could not read", {}, { log: `status ${res.status}` }),
      json,
      "services list",
      deps.print,
    );
  }

  if (json) {
    deps.print(JSON.stringify(envelope({ agents })));
    return;
  }
  out.print(...servicesListBlocks(agents));
}

export async function servicesRegister(args: string[], _ctx: CommandContext = {}, deps: ServicesDeps = realServicesDeps()): Promise<void> {
  const json = args.includes("--json");
  const explicit = flagValues(args, "--plist");
  let plists: string[];
  if (explicit.length > 0) {
    plists = explicit;
  } else {
    const defaults = servicePlists(processFlavor(), deps.probes);
    plists = defaults.plists;
    if (defaults.deckOmitted) deps.warn("Only the daemon was registered: this app does not carry deck yet");
  }

  const res = await deps.probes.tray<RegisterReply>("/services/register", { method: "POST", body: { plists } });
  if (res.status === 0) appNotRunning(json, "services register", deps);

  const ok = res.json?.ok ?? false;
  if (json) {
    deps.print(JSON.stringify(envelope({ ok, plists, results: res.json?.results })));
    if (!ok) exitWith(deps, 1);
    return;
  }
  if (ok) out.print(out.line("done", `Registered ${plists.length} background service${plists.length === 1 ? "" : "s"}`, plists.join(", ")));
  else out.fail({ title: "mattstack.app did not register them", hint: plists.join(", ") });
  if (!ok) exitWith(deps, 1);
}

async function registeredAgents(deps: ServicesDeps): Promise<ServiceAgent[]> {
  const res = await deps.probes.tray<{ agents: ServiceAgent[] }>("/services", { method: "GET" });
  const agents = res.status === 200 ? res.json?.agents : undefined;
  return Array.isArray(agents) ? agents : [];
}

export async function servicesRestart(args: string[], _ctx: CommandContext = {}, deps: ServicesDeps = realServicesDeps()): Promise<void> {
  const json = args.includes("--json");
  let label = args.find((a) => !a.startsWith("--"));
  if (!label) {
    const agents = process.stdin.isTTY && !json && !process.env.RT_BATCH ? await registeredAgents(deps) : [];
    if (agents.length > 0) {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      const picked = await filterableSelect({
        message: "Restart which service?",
        options: agents.map((a) => ({ value: a.label, label: a.label, hint: a.status })),
        stderr: true,
      });
      if (!picked) process.exit(0);
      label = picked;
    } else {
      if (!json) {
        out.fail(usageFailure("Which service?", "rt services restart <label>"));
        return exitWith(deps, 2);
      }
      exitUserError(new UserActionableError("usage", "usage: rt services restart <label> [--json]"), json, "services restart", deps.print);
    }
  }

  const res = await deps.probes.tray<{ ok: boolean }>("/services/restart", { method: "POST", body: { label } });
  if (res.status === 0) appNotRunning(json, "services restart", deps);

  const ok = res.json?.ok ?? false;
  if (json) {
    deps.print(JSON.stringify(envelope({ ok, label })));
    if (!ok) exitWith(deps, 1);
    return;
  }
  if (ok) out.print(out.line("done", `Restarted ${label}`));
  else out.fail({ title: `mattstack.app did not restart ${label}` });
  if (!ok) exitWith(deps, 1);
}

const SERVICE_STATUS: Record<string, { word: string; role: Segment["role"] }> = {
  enabled: { word: "enabled", role: "running" },
  requiresApproval: { word: "waiting for your approval", role: "needs-you" },
  notRegistered: { word: "not registered", role: "off" },
  notFound: { word: "not found", role: "off" },
};

export function servicesListBlocks(agents: ServiceAgent[]): Block[] {
  if (agents.length === 0) return [out.line("skipped", "No background services are registered")];
  return [out.table(agents.map((a) => {
    const status = Object.hasOwn(SERVICE_STATUS, a.status)
      ? SERVICE_STATUS[a.status]!
      : { word: a.status, role: "skipped" as const };
    return [out.strong(a.label), { text: status.word, role: status.role }];
  }))];
}
