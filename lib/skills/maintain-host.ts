/**
 * The harness an `rt skills` maintenance verb (init, sync, link, audit,
 * writing-style) works on, chosen once per run: `--harness` when given,
 * else the configured default by the launch rule (`agent.provider` when it
 * is turned on, else the first one turned on). With
 * agent.integrations.enabled off it is always Claude Code, as before.
 */

import type { HarnessId, IntegrationSummary, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import { selectLaunchHarness } from "../../packages/rt-client/src/harness-context.ts";
import { createClaudeSkills } from "../agent-integrations/claude/skills.ts";
import { codexHomeFor, createCodexSkills, resolveCodexBinIfPresent } from "../agent-integrations/codex/skills.ts";
import type { SkillAdapter } from "../agent-integrations/contracts.ts";
import { BUILTIN_HARNESS_IDS } from "../agent-integrations/harness-ids.ts";
import { configuredHarness, enabledIntegrations } from "../agent-integrations/preferences.ts";
import { integrationsEnabled } from "../agent-integrations/switch.ts";
import { resolveClaudeBin } from "../claude-bin.ts";
import type { PluginListEntry } from "./sources.ts";

export type HarnessFlag = { ok: true; harness?: string; rest: string[] } | { ok: false };

/**
 * `--harness <id>` or `--harness=<id>` out of `args`, never past `--`; a flag
 * with no value is `ok: false`. With `onlyKnown`, only a registered id is
 * taken and anything else stays where it was, so a verb whose positional is
 * passed verbatim (a skill id) never loses it to this flag.
 */
export function takeHarnessFlag(args: string[], opts: { onlyKnown?: boolean } = {}): HarnessFlag {
  const rest: string[] = [];
  let harness: string | undefined;
  const takes = (v: string | undefined): v is string =>
    v !== undefined && v !== "" && !v.startsWith("--") && (!opts.onlyKnown || BUILTIN_HARNESS_IDS.includes(v));
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      rest.push(...args.slice(i));
      break;
    }
    if (a === "--harness") {
      const v = args[i + 1];
      if (takes(v)) {
        harness = v;
        i++;
      } else if (opts.onlyKnown) rest.push(a);
      else return { ok: false };
    } else if (a.startsWith("--harness=")) {
      const v = a.slice("--harness=".length);
      if (takes(v)) harness = v;
      else if (opts.onlyKnown) rest.push(a);
      else return { ok: false };
    } else {
      rest.push(a);
    }
  }
  return { ok: true, ...(harness !== undefined && { harness }), rest };
}

export type HarnessChoiceIo = {
  switchOn(): boolean;
  enabled(): HarnessId[];
  preferred(): string | undefined;
};

const REAL_IO: HarnessChoiceIo = { switchOn: integrationsEnabled, enabled: enabledIntegrations, preferred: configuredHarness };

const fail = <T>(code: "invalid" | "refused", message: string): Outcome<T> => ({ ok: false, error: { code, message } });

const known = (): string => BUILTIN_HARNESS_IDS.join(" or ");

export async function selectSkillsHarness(explicit: string | undefined, io: HarnessChoiceIo = REAL_IO): Promise<Outcome<HarnessId>> {
  if (explicit !== undefined && !BUILTIN_HARNESS_IDS.includes(explicit)) {
    return fail("invalid", `rt has no integration called ${explicit}. Choose ${known()}`);
  }
  if (!io.switchOn()) {
    if (explicit === undefined || explicit === "claude") return { ok: true, data: "claude" };
    return fail("refused", `Keeping skills for ${explicit} needs agent integrations turned on`);
  }
  const enabled = new Set(io.enabled());
  if (explicit !== undefined) {
    return enabled.has(explicit) ? { ok: true, data: explicit } : fail("refused", `${explicit} is not turned on. Turn it on in setup, then run this again`);
  }
  const integrations = BUILTIN_HARNESS_IDS.map((id): IntegrationSummary => ({
    id, label: id, enabled: enabled.has(id), readiness: { ready: true }, capabilities: [], options: [],
  }));
  try {
    const chosen = await selectLaunchHarness({
      switchOn: () => true,
      defaultHarness: io.preferred,
      agentIntegrations: async () => ({ ok: true, data: { integrations } }),
    }, "rt");
    if (chosen !== undefined) return { ok: true, data: chosen };
  } catch {
    // only "no agent is turned on" reaches here: the listing above cannot fail
  }
  return fail("refused", "No agent is turned on, so there is nowhere to keep skills. Turn one on in setup");
}

export type SkillsHost = {
  harness: HarnessId;
  /** How a person names it in a sentence. */
  label: string;
  /** Its CLI, or null when it is not installed. */
  bin: string | null;
  skills: SkillAdapter;
  /** What a run of its CLI needs on top of this process's environment, so it reads the same profile the adapter does. */
  env?: Record<string, string>;
};

/** How a verb picks its host; tests swap in their own. */
export type HostChoice = {
  select(explicit: string | undefined): Promise<Outcome<HarnessId>>;
  hostFor(harness: HarnessId): SkillsHost;
};

export const REAL_HOSTS: HostChoice = { select: (explicit) => selectSkillsHarness(explicit), hostFor: (harness) => skillsHostFor(harness) };

/**
 * What compile and check read as installed for this host: its own listing,
 * read now, or undefined for Claude Code, whose listing they read
 * themselves. A listing the host cannot give throws.
 */
export async function pluginEntriesFor(host: SkillsHost): Promise<PluginListEntry[] | undefined> {
  if (host.harness === "claude") return undefined;
  const listed = await host.skills.inventory();
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.data;
}

/** `env` is what the harness CLI runs under; unset is this process's. */
export function skillsHostFor(harness: HarnessId, env?: Record<string, string | undefined>): SkillsHost {
  const deps = env === undefined ? {} : { env };
  if (harness === "codex") {
    const home = codexHomeFor(undefined, env ?? process.env);
    return {
      harness, label: "Codex", bin: resolveCodexBinIfPresent(), skills: createCodexSkills(deps),
      ...(home.ok && { env: { CODEX_HOME: home.data.home } }),
    };
  }
  return { harness, label: "Claude Code", bin: resolveClaudeBin(), skills: createClaudeSkills(deps) };
}
