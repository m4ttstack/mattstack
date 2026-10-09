import {
  agentIntegrations,
  getSetting,
  type HarnessId,
  type IntegrationSummary,
  type OptionDescriptor,
  type RtClientOptions,
} from '@mattstack/rt-client';

/** One harness the new pane form offers: enabled, in registry order. */
export interface PaneHarness {
  id: HarnessId;
  label: string;
  ready: boolean;
  reason?: string;
  options: OptionDescriptor[];
}

/** `enabled: false` while agent.integrations.enabled is off: the form stays
    the Claude-only form it always was. */
export type PaneHarnesses =
  | { enabled: false }
  | {
      enabled: true;
      harnesses: PaneHarness[];
      defaultHarness: HarnessId | null;
    };

/** Read at call time; an unreadable store keeps the switch off. */
export function integrationsOn(): boolean {
  try {
    return getSetting<boolean>('agent.integrations.enabled').value === true;
  } catch {
    return false;
  }
}

function configuredProvider(): HarnessId | undefined {
  try {
    const value = getSetting<string>('agent.provider').value;
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

type Registry =
  | { ok: true; integrations: IntegrationSummary[] }
  | { ok: false; error: string };

async function readRegistry(opts: RtClientOptions): Promise<Registry> {
  const res = await agentIntegrations({ mode: 'herdr' }, opts);
  if (!res.ok || !res.data)
    return {
      ok: false,
      error: `Chat could not read which agents are turned on: ${res.error ?? 'rt sent no answer'}`,
    };
  return { ok: true, integrations: res.data.integrations };
}

/** The Board's rule: agent.provider when it is turned on, else the first
    one turned on. */
function defaultOf(enabled: IntegrationSummary[]): HarnessId | null {
  const preferred = configuredProvider();
  return (enabled.find(i => i.id === preferred) ?? enabled[0])?.id ?? null;
}

export async function paneHarnesses(
  opts: RtClientOptions
): Promise<PaneHarnesses | { error: string }> {
  if (!integrationsOn()) return { enabled: false };
  const registry = await readRegistry(opts);
  if (!registry.ok) return { error: registry.error };
  const enabled = registry.integrations.filter(i => i.enabled);
  return {
    enabled: true,
    harnesses: enabled.map(i => ({
      id: i.id,
      label: i.label,
      ready: i.readiness.ready,
      ...(i.readiness.reason !== undefined && { reason: i.readiness.reason }),
      options: i.options,
    })),
    defaultHarness: defaultOf(enabled),
  };
}

type SpawnOption = 'account' | 'model' | 'effort';

const OPTION_NOUN: Record<SpawnOption, string> = {
  account: 'an account',
  model: 'a model',
  effort: 'an effort level',
};

export type SpawnChoice =
  | { ok: true; provider?: HarnessId }
  | { ok: false; status: 400 | 409 | 502; error: string };

/**
 * The harness a spawn runs. Off, none is named, so the daemon starts what it
 * always did. On, the asked harness must still be turned on and must offer
 * every option sent; it is never swapped for another. Readiness is left to
 * the daemon's launch, which reads it fresh and refuses in its own words.
 */
export async function spawnChoice(
  asked: string | undefined,
  sent: Partial<Record<SpawnOption, string>>,
  opts: RtClientOptions
): Promise<SpawnChoice> {
  if (!integrationsOn()) return { ok: true };
  const registry = await readRegistry(opts);
  if (!registry.ok) return { ok: false, status: 502, error: registry.error };
  const id =
    asked ??
    defaultOf(registry.integrations.filter(i => i.enabled)) ??
    undefined;
  if (id === undefined)
    return {
      ok: false,
      status: 409,
      error:
        'No agent is turned on, so Chat cannot start one. Turn one on in setup.',
    };
  const harness = registry.integrations.find(i => i.id === id);
  if (!harness)
    return {
      ok: false,
      status: 400,
      error: `rt has no agent called ${id}, so Chat did not start it.`,
    };
  if (!harness.enabled)
    return {
      ok: false,
      status: 409,
      error: `${harness.label} is turned off, so Chat did not start it. Turn it on in setup, or pick another agent.`,
    };
  const offered = new Set(harness.options.map(o => o.name));
  for (const name of ['account', 'model', 'effort'] as const)
    if (sent[name] !== undefined && !offered.has(name))
      return {
        ok: false,
        status: 400,
        error: `${harness.label} does not take ${OPTION_NOUN[name]}, so Chat did not start it.`,
      };
  return { ok: true, provider: harness.id };
}
