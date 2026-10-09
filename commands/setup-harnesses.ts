/**
 * `rt setup harnesses`: the person's choice of which agent apps rt turns on,
 * and which one `rt agent` starts by default. Machine scope, the scope the
 * setup migration records, so no stored value can hide the change.
 */
import type { Outcome } from "../packages/rt-client/src/agent-integrations.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { configuredHarness, enabledIntegrations, joined, validateIntegrationPreference, writeIntegrationChoice, type IntegrationChoice } from "../lib/agent-integrations/preferences.ts";
import { integrationsEnabled } from "../lib/agent-integrations/switch.ts";
import { UserActionableError } from "../lib/errors.ts";
import { envelope } from "../lib/setup/contract.ts";
import { exitWithUserError, type UserErrorSink } from "../lib/setup/user-failure.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";

export type HarnessOption = { id: string; label: string };

export interface HarnessesDeps {
  json: (value: unknown) => void;
  exit: (code: number) => never;
  now: () => Date;
  isTTY: () => boolean;
  registered: () => Promise<HarnessOption[]>;
  switchOn: () => boolean;
  currentDefault: () => string | undefined;
  currentEnabled: () => string[];
  write: (choice: IntegrationChoice) => Outcome<void>;
  pickHarnesses: (options: HarnessOption[], initial: string[]) => Promise<string[] | null>;
  pickDefault: (options: HarnessOption[], current: string | undefined) => Promise<string | null>;
}

export function realHarnessesDeps(): HarnessesDeps {
  return {
    json: (v) => out.json(v),
    exit: process.exit,
    now: () => new Date(),
    isTTY: () => process.stdin.isTTY === true,
    registered: async () => {
      const { builtinRegistry } = await import("../lib/agent-integrations/builtins.ts");
      return builtinRegistry().list().map((i) => ({ id: i.id, label: i.label }));
    },
    switchOn: integrationsEnabled,
    currentDefault: configuredHarness,
    currentEnabled: enabledIntegrations,
    write: (choice) => writeIntegrationChoice(choice, "machine"),
    pickHarnesses: async (options, initial) => {
      const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");
      return filterableMultiselect({ message: "Which agent apps should rt turn on?", options: options.map((o) => ({ value: o.id, label: o.label })), initialValues: initial, stderr: true });
    },
    pickDefault: async (options, current) => {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      const ordered = current === undefined ? options : [...options.filter((o) => o.id === current), ...options.filter((o) => o.id !== current)];
      return filterableSelect({ message: "Which one should rt agent start by default?", options: ordered.map((o) => ({ value: o.id, label: o.label })), stderr: true });
    },
  };
}

const USAGE = "rt setup harnesses <ids…> --default <id>";

function parse(args: string[]): { json: boolean; none: boolean; def: string | undefined; defaultFlag: boolean; ids: string[] } {
  const ids: string[] = [];
  let def: string | undefined;
  let defaultFlag = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--default") {
      defaultFlag = true;
      def = args[i + 1]?.startsWith("--") ? undefined : args[i + 1];
      if (def !== undefined) i++;
    } else if (a.startsWith("--default=")) {
      defaultFlag = true;
      def = a.slice("--default=".length) || undefined;
    } else if (!a.startsWith("--")) {
      ids.push(a);
    }
  }
  return { json: args.includes("--json"), none: args.includes("--none"), def, defaultFlag, ids };
}

export async function setupHarnesses(args: string[], _ctx: CommandContext = {}, deps: HarnessesDeps = realHarnessesDeps()): Promise<void> {
  const { json, none, def: defFlag, defaultFlag, ids: argIds } = parse(args);
  const sink: UserErrorSink = { json: deps.json, exit: deps.exit, now: deps.now };
  const usage = (message: string, title = message, why?: string): never =>
    exitWithUserError(new UserActionableError("usage", message), json, sink, usageFailure(title, USAGE, why));
  const badDefault = (d: string, chosen: string[]): never => {
    const message = `${d} is not in the list you turned on. Choose your default from ${joined(chosen, "or")}.`;
    return usage(message, "Which app should be your default?", message);
  };

  if (defaultFlag && defFlag === undefined) usage("--default needs the id of one of the apps you turn on.", "Which app should be your default?");
  if (none && (argIds.length > 0 || defaultFlag)) usage("--none turns every agent app off, so it takes no ids and no --default.", "Choose some apps or --none, not both");

  const registered = await deps.registered();
  let ids = argIds;
  let def = defFlag;

  if (!none && ids.length === 0) {
    if (!(deps.isTTY() && !json && !process.env.RT_BATCH)) {
      usage(`Name the agent apps to turn on, from ${joined(registered.map((o) => o.id), "and")}, or pass --none.`, "Which agent apps should rt turn on?");
    }
    const picked = await deps.pickHarnesses(registered, deps.currentEnabled());
    // Only --none turns every app off; an empty pick is a cancel.
    if (picked === null || picked.length === 0) return deps.exit(0);
    ids = picked;
    if (def !== undefined) {
      if (!ids.includes(def)) badDefault(def, ids);
    } else if (ids.length > 1) {
      const current = deps.currentDefault();
      const chosen = await deps.pickDefault(registered.filter((o) => ids.includes(o.id)), current !== undefined && ids.includes(current) ? current : undefined);
      if (chosen === null) return deps.exit(0);
      def = chosen;
    }
  }

  const valid = validateIntegrationPreference(ids, registered.map((o) => o.id));
  if (!valid.ok) usage(valid.error.message, "Which agent apps should rt turn on?", valid.error.message);
  if (def !== undefined && !ids.includes(def)) badDefault(def, ids);
  if (def === undefined && ids.length > 0) {
    const current = deps.currentDefault();
    def = current !== undefined && ids.includes(current) ? current : ids[0];
  }

  let written: Outcome<void>;
  try {
    written = deps.write({ enabled: ids, ...(def !== undefined && { defaultHarness: def }) });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return exitWithUserError(new UserActionableError("settings-unwritable", `Could not save your choice: ${why}`), json, sink, {
      title: "Could not save your choice",
      why,
      next: out.cmd("rt settings check"),
    });
  }
  if (!written.ok) {
    if (written.error.code === "refused" && !json) {
      out.note(out.line("refused", written.error.message));
      return deps.exit(2);
    }
    return exitWithUserError(new UserActionableError(written.error.code, written.error.message), json, sink, { next: out.cmd("rt settings explain agent.integrations") });
  }

  if (json) {
    deps.json(envelope({ ok: true, enabled: ids, default: def ?? null }, deps.now()));
    return;
  }
  const label = (id: string) => registered.find((o) => o.id === id)?.label ?? id;
  const lines = [
    ids.length === 0
      ? out.line("done", "Turned off every agent app")
      : out.line("done", `Turned on ${joined(ids.map(label), "and")}`, `${label(def!)} is your default`),
  ];
  if (!deps.switchOn()) lines.push(out.line("off", "Agent integrations are off on this Mac, so this applies once they are turned on"));
  out.print(...lines);
}
