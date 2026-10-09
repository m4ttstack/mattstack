// @vitest-environment node
import type { IntegrationSummary } from '@mattstack/rt-client';
import { describe, expect, it, vi } from 'vitest';

import { createAgentModels, type AgentModelsDeps } from './agent-models';

function summary(
  id: string,
  options: IntegrationSummary['options']
): IntegrationSummary {
  return {
    id,
    label: id,
    enabled: true,
    readiness: { ready: true },
    capabilities: ['launch'],
    options,
  };
}

const REGISTRY: IntegrationSummary[] = [
  summary('claude', [{ name: 'model', kind: 'text' }]),
  summary('codex', [{ name: 'model', kind: 'text' }]),
  summary('pilot', [
    { name: 'model', kind: 'choice', choices: ['p-1', 'p-2'] },
  ]),
  summary('quiet', [{ name: 'effort', kind: 'text' }]),
];

function deps(over: Partial<AgentModelsDeps> = {}): AgentModelsDeps {
  return {
    switchOn: () => false,
    integrations: vi.fn(async () => REGISTRY),
    codexCatalog: vi.fn(async () => [{ value: 'gpt-5', label: 'GPT-5' }]),
    ...over,
  };
}

async function models(d: AgentModelsDeps, provider: string) {
  const res = await createAgentModels(d).fetch(
    new Request(`http://localhost/api/agent/models?provider=${provider}`)
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

describe('GET /api/agent/models', () => {
  it('claude returns the curated list', async () => {
    const { status, body } = await models(deps(), 'claude');
    expect(status).toBe(200);
    expect(
      (body as { models: { value: string }[] }).models.some(
        m => m.value === 'sonnet'
      )
    ).toBe(true);
  });

  it('unknown provider is a 400', async () => {
    const { status, body } = await models(deps(), 'cursor');
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'provider must be "claude" or "codex"' });
  });

  it('with the switch off the registry is never read', async () => {
    const d = deps();
    await models(d, 'codex');
    expect(d.integrations).not.toHaveBeenCalled();
    expect((await models(d, 'pilot')).status).toBe(400);
  });

  it('Console models come from selected integration', async () => {
    const d = deps({ switchOn: () => true });
    expect(await models(d, 'pilot')).toEqual({
      status: 200,
      body: {
        models: [
          { value: 'p-1', label: 'p-1' },
          { value: 'p-2', label: 'p-2' },
        ],
      },
    });
    expect(await models(d, 'codex')).toEqual({
      status: 200,
      body: { models: [{ value: 'gpt-5', label: 'GPT-5' }] },
    });
    expect(
      ((await models(d, 'claude')).body as { models: { value: string }[] })
        .models[0]!.value
    ).toBe('sonnet');
    expect(await models(d, 'quiet')).toEqual({
      status: 200,
      body: { models: [] },
    });
    expect(await models(d, 'cursor')).toEqual({
      status: 400,
      body: {
        error: 'provider must be "claude", "codex", "pilot" or "quiet"',
      },
    });
  });

  it('with the switch on, an unreadable registry keeps the envelope', async () => {
    const d = deps({ switchOn: () => true, integrations: async () => null });
    expect(await models(d, 'claude')).toEqual({
      status: 502,
      body: { error: 'Console could not read the agent integrations from rt' },
    });
  });
});
