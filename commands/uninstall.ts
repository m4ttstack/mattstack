/**
 * `rt uninstall [--keep-data|--delete-data] [--dry-run] [--yes] [--json]` —
 * the verb mattstack.app's Settings "Uninstall" sheet spawns, and a human can
 * run directly. Mirrors `rt setup apply`'s NDJSON discipline: `--json` mode
 * emits ONLY NDJSON on stdout, one object per line.
 */

import type { CommandContext } from "../lib/command-tree.ts";
import { createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { createRealSecretsExecSeam, type SecretsSeams } from "../lib/secrets/store.ts";
import { createApplyContext, type ApplyContext, type CreateApplyContextDeps } from "../lib/setup/apply.ts";
import { envelope } from "../lib/setup/contract.ts";
import { createStepEmitter, type Emit, type StepEmitter, type StepEmitterLabels } from "../lib/setup/emit.ts";
import { exitWithUserError } from "../lib/setup/user-failure.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
import { UserActionableError } from "../lib/errors.ts";
import { createRealProbes, type Probes } from "../lib/setup/probes.ts";
import { computeUninstallActions, runUninstall, type UninstallAction } from "../lib/setup/uninstall.ts";
import { createRelayClient, inviteRelayUrl, type RelayClient } from "../lib/team/relay-client.ts";
import * as out from "../lib/ui/out.ts";
import type { SecretPresence } from "../lib/setup/validators/accounts.ts";

export interface UninstallDeps {
  probes: Probes;
  secrets: SecretsSeams;
  relay: RelayClient;
  /** Defaults to `realSecretPresence()` inside `createApplyContext` — override in tests. */
  secretPresence?: SecretPresence;
  needOpts?: CreateApplyContextDeps["needOpts"];
  /** Overrides `computeUninstallActions`'s own result — the seam every test drives instead of shaping a whole fake machine. */
  actions?: UninstallAction[];
  /** One machine line on stdout: a --json envelope or an NDJSON event. Never human text. */
  json: (value: unknown) => void;
  exit: (code: number) => never;
  isTTY: () => boolean;
  confirm: (message: string) => Promise<boolean>;
}

export function realUninstallDeps(): UninstallDeps {
  const probes = createRealProbes();
  return {
    probes,
    secrets: { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() },
    relay: createRelayClient(probes.fetch, inviteRelayUrl(probes.env)),
    json: (v) => out.json(v),
    exit: process.exit,
    isTTY: () => process.stdin.isTTY === true,
    confirm: async (message: string) => {
      const { confirm } = await import("../lib/rt-render.ts");
      return confirm({ message });
    },
  };
}

const UNINSTALL_LABELS: StepEmitterLabels = { done: "mattstack is uninstalled", needsYou: "Uninstall needs you", caveat: "mattstack is uninstalled, with a caveat", failed: "Uninstall stopped" };

function removalList(title: string, actions: { title: string }[]): ReturnType<typeof out.section> {
  return out.section(title, undefined, out.changes(actions.map((a) => ({ op: "-" as const, name: a.title }))));
}

function dryRunPayload(actions: UninstallAction[], now: Date): { contract: 1; at: string; actions: { id: string; title: string }[] } {
  return envelope({ actions: actions.map((a) => ({ id: a.id, title: a.title })) }, now);
}

export const UNINSTALL_FLAGS = ["--keep-data", "--delete-data", "--dry-run", "--yes", "--json"] as const;

function rejectStrayArgs(args: string[]): void {
  const stray = args.filter((a) => !(UNINSTALL_FLAGS as readonly string[]).includes(a));
  if (stray.length === 0) return;
  const named = stray.map((a) => `"${a}"`).join(", ");
  throw new UserActionableError(
    "unexpected-args",
    `Unexpected ${stray.length === 1 ? "argument" : "arguments"} ${named}. rt uninstall takes no app name and removes all of mattstack. To remove one app from deck, run deck remove <name> (add --force for a mattstack app; bundled apps return when deck restarts)`,
    { args: stray },
  );
}

export async function runUninstallCommand(args: string[], _ctx: CommandContext = {}, deps: UninstallDeps = realUninstallDeps()): Promise<void> {
  const json = args.includes("--json");
  const keepDataFlag = args.includes("--keep-data");
  const deleteData = args.includes("--delete-data");
  const yes = args.includes("--yes");
  const dryRun = args.includes("--dry-run");

  let human: StepEmitter | null = null;

  try {
    rejectStrayArgs(args);

    if (keepDataFlag && deleteData) {
      throw new UserActionableError("conflicting-data-flags", "--keep-data and --delete-data cannot be used together");
    }

    const actions = deps.actions ?? computeUninstallActions(deps.probes, { keepData: !deleteData });

    if (dryRun) {
      const payload = dryRunPayload(actions, deps.probes.now());
      if (json) {
        deps.json(payload);
      } else {
        out.print(removalList("This would remove", payload.actions));
      }
      return;
    }

    // `!deps.isTTY() || json`, not just `!isTTY()`: a `--json` invocation has
    // nowhere to render a confirm prompt even on a TTY, so it must hit this
    // refusal rather than fall through to the prompt below unconfirmed.
    if (deleteData && !yes && (!deps.isTTY() || json)) {
      throw new UserActionableError("confirm-required", "--delete-data needs --yes when not on a TTY (or when --json is set)");
    }

    if (!json && deps.isTTY() && !yes) {
      out.print(removalList("This will remove", actions));
      const proceed = await deps.confirm(deleteData ? "Uninstall and delete ~/.mattstack? This cannot be undone." : "Uninstall now?");
      if (!proceed) return;
    }

    human = json ? null : createStepEmitter({ labels: UNINSTALL_LABELS, log: (id, line) => logCliEvent("debug", "uninstall", line, { step: id }) });
    const emit: Emit = human ? human.emit : (ev) => deps.json(ev);

    const ctx: ApplyContext = await createApplyContext({
      probes: deps.probes,
      emit,
      secrets: deps.secrets,
      relay: deps.relay,
      secretPresence: deps.secretPresence,
      // appMayDrive: a non-TTY uninstall is normally the app itself driving
      // (the Settings sheet spawns it and services its needs off stdout).
      flags: { nonInteractive: !deps.isTTY(), teamOfOne: true, ci: process.env.CI === "true", appMayDrive: true },
      needOpts: deps.needOpts,
    });

    const result = await runUninstall(ctx, actions);
    await human?.flush();

    // `stayed` has no place in the NDJSON stream's fixed event shapes, so it is
    // a human-only section after the stream and `--json` stays one object per
    // line.
    if (!json && result.stayed.length > 0) {
      out.print(out.section("Kept on this Mac", undefined, ...result.stayed.map((s) => out.line("skipped", s))));
    }

    if (!result.ok) deps.exit(2);
  } catch (err) {
    await human?.flush();
    if (err instanceof UserActionableError) {
      return exitWithUserError(err, json, { json: deps.json, exit: deps.exit, now: () => deps.probes.now() });
    }
    throw err;
  }
}
