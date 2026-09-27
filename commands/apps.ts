/**
 * rt apps list|enable|disable: the mattstack apps deck serves on this Mac.
 * Thin facade over deck's admin API, calling as the registrar so a managed
 * row accepts the flip.
 */

import type { CommandContext } from "../lib/command-tree.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, userErrorPayload } from "../lib/setup/errors.ts";
import { createRealProbes, type Probes } from "../lib/setup/probes.ts";
import { MATTSTACK_REGISTRAR, deckHealthyAt, readDeckApiPortFrom } from "../lib/setup/steps/deck.ts";

export interface AppsDeps {
  probes: Probes;
  print: (s: string) => void;
  exit: (code: number) => never;
}

export function realAppsDeps(): AppsDeps {
  return { probes: createRealProbes(), print: (s) => console.log(s), exit: process.exit };
}

export interface AppRow {
  name: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  requiresTeam: boolean;
}

function fail(deps: AppsDeps, json: boolean, verb: string, err: UserActionableError): never {
  deps.print(json ? JSON.stringify(userErrorPayload(err, deps.probes.now())) : `rt ${verb}: ${err.message}`);
  return deps.exit(2);
}

async function deckPort(deps: AppsDeps): Promise<number | null> {
  const port = readDeckApiPortFrom(deps.probes);
  if (port === null) return null;
  return (await deckHealthyAt(deps.probes, port)) ? port : null;
}

function parseApps(body: string): Array<AppRow & { managedBy: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const apps = (parsed as { apps?: unknown } | null)?.apps;
  if (!Array.isArray(apps)) throw new UserActionableError("deck-error", "deck answered an unreadable app list");
  return apps as Array<AppRow & { managedBy: string }>;
}

async function listRows(deps: AppsDeps, port: number): Promise<AppRow[]> {
  const res = await deps.probes.fetch(`http://127.0.0.1:${port}/api/v1/apps`);
  if (res.status !== 200) throw new UserActionableError("deck-error", `deck answered ${res.status} listing apps`);
  return parseApps(res.body)
    .filter((a) => a?.managedBy === MATTSTACK_REGISTRAR)
    .map(({ name, displayName, description, enabled, requiresTeam }) => ({
      name,
      displayName,
      ...(description !== undefined ? { description } : {}),
      enabled,
      requiresTeam,
    }));
}

function printList(deps: AppsDeps, json: boolean, apps: AppRow[]): void {
  if (json) {
    deps.print(JSON.stringify(envelope({ apps }, deps.probes.now())));
    return;
  }
  if (apps.length === 0) {
    deps.print("no mattstack apps registered");
    return;
  }
  for (const a of apps) deps.print(`${a.enabled ? "on " : "off"}  ${a.name.padEnd(10)} ${a.displayName}${a.requiresTeam ? "  (needs a team)" : ""}`);
}

export async function appsList(args: string[], _ctx: CommandContext = {}, deps: AppsDeps = realAppsDeps()): Promise<void> {
  const json = args.includes("--json");
  const port = await deckPort(deps);
  if (port === null) return fail(deps, json, "apps list", new UserActionableError("deck-not-running", "deck is not running; open mattstack.app, then retry"));
  try {
    printList(deps, json, await listRows(deps, port));
  } catch (err) {
    if (err instanceof UserActionableError) return fail(deps, json, "apps list", err);
    throw err;
  }
}

async function setEnabled(args: string[], deps: AppsDeps, enabled: boolean): Promise<void> {
  const json = args.includes("--json");
  const verb = enabled ? "apps enable" : "apps disable";
  const name = args.find((a) => !a.startsWith("--"));
  const port = await deckPort(deps);
  if (port === null) return fail(deps, json, verb, new UserActionableError("deck-not-running", "deck is not running; open mattstack.app, then retry"));
  if (!name) {
    if (process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      try {
        printList(deps, false, await listRows(deps, port));
      } catch (err) {
        if (err instanceof UserActionableError) return fail(deps, json, verb, err);
        throw err;
      }
    }
    return fail(deps, json, verb, new UserActionableError("usage", `usage: rt ${verb} <name> [--json]`));
  }
  const res = await deps.probes.fetch(`http://127.0.0.1:${port}/api/v1/apps/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-local-caller": MATTSTACK_REGISTRAR },
    body: JSON.stringify({ enabled }),
  });
  if (res.status === 404) return fail(deps, json, verb, new UserActionableError("unknown-app", `deck has no app named ${name}`));
  if (res.status === 409) {
    return fail(deps, json, verb, new UserActionableError("not-managed", `${name} is not a mattstack app; rt manages only the apps mattstack ships, and user apps and deck itself are always served`));
  }
  if (res.status < 200 || res.status >= 300) return fail(deps, json, verb, new UserActionableError("deck-error", `deck answered ${res.status}`));
  deps.print(json ? JSON.stringify(envelope({ name, enabled }, deps.probes.now())) : `rt ${verb}: ${name} is now ${enabled ? "on" : "off"}`);
}

export async function appsEnable(args: string[], _ctx: CommandContext = {}, deps: AppsDeps = realAppsDeps()): Promise<void> {
  return setEnabled(args, deps, true);
}

export async function appsDisable(args: string[], _ctx: CommandContext = {}, deps: AppsDeps = realAppsDeps()): Promise<void> {
  return setEnabled(args, deps, false);
}
