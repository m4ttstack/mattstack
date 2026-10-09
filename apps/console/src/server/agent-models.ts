import {
  agentCatalog,
  agentIntegrations,
  codexModelCatalog,
  getSetting,
  type AgentCatalogOption,
  type IntegrationSummary,
} from '@mattstack/rt-client';
import { Hono } from 'hono';

export type AgentModelOption = AgentCatalogOption;

export interface AgentModelsDeps {
  /** agent.integrations.enabled; off, the routes answer as they always did. */
  switchOn: () => boolean;
  /** The registry's integrations, or null when rt cannot be read. */
  integrations: () => Promise<IntegrationSummary[] | null>;
  codexCatalog: () => Promise<AgentModelOption[]>;
}

const realDeps: AgentModelsDeps = {
  switchOn: () => {
    try {
      return getSetting<boolean>('agent.integrations.enabled').value === true;
    } catch {
      return false;
    }
  },
  integrations: async () => {
    const res = await agentIntegrations(
      { mode: 'herdr' },
      { sockPath: process.env.RT_SOCK_PATH }
    );
    return res.ok && res.data ? res.data.integrations : null;
  },
  codexCatalog: () => codexModelCatalog(),
};

/** A harness whose model option is free text suggests its shared catalog;
    one with no catalog suggests nothing. */
async function catalogModels(
  id: string,
  deps: AgentModelsDeps
): Promise<AgentModelOption[]> {
  return (
    (await agentCatalog(id, { codexModels: deps.codexCatalog }))?.model ?? []
  );
}

function providerError(ids: string[]): string {
  const quoted = ids.map(id => `"${id}"`);
  return quoted.length < 2
    ? `provider must be ${quoted[0] ?? 'a registered agent'}`
    : `provider must be ${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`;
}

async function modelsFor(
  integration: IntegrationSummary,
  deps: AgentModelsDeps
): Promise<AgentModelOption[]> {
  const model = integration.options.find(o => o.name === 'model');
  if (!model) return [];
  if (model.kind === 'choice')
    return (model.choices ?? []).map(c => ({ value: c, label: c }));
  return catalogModels(integration.id, deps);
}

export function createAgentModels(deps: AgentModelsDeps = realDeps) {
  return new Hono().get('/api/agent/models', async c => {
    const provider = c.req.query('provider');
    if (!deps.switchOn()) {
      if (provider === 'claude' || provider === 'codex')
        return c.json({ models: await catalogModels(provider, deps) }, 200);
      return c.json({ error: providerError(['claude', 'codex']) }, 400);
    }
    const integrations = await deps.integrations();
    if (!integrations)
      return c.json(
        { error: 'Console could not read the agent integrations from rt' },
        502
      );
    const integration = integrations.find(i => i.id === provider);
    if (!integration)
      return c.json({ error: providerError(integrations.map(i => i.id)) }, 400);
    return c.json({ models: await modelsFor(integration, deps) }, 200);
  });
}

export const agentModels = createAgentModels();
