import {
  agentIntegrations,
  getSetting,
  type IntegrationSummary,
} from '@mattstack/rt-client';
import { Hono } from 'hono';

export interface AgentModelOption {
  value: string;
  label: string;
}

// No live catalog command exists for claude (verified: no model-list
// subcommand in `claude --help`). Maintained by hand; a stale entry here is
// a documentation debt, not a correctness bug -- these are suggestions, not
// validated choices.
const CLAUDE_MODELS: AgentModelOption[] = [
  { value: 'sonnet', label: 'Sonnet (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
  { value: 'haiku', label: 'Haiku (latest)' },
  { value: 'fable', label: 'Fable (latest)' },
];

interface CodexCatalogModel {
  slug: string;
  display_name: string;
  visibility: string;
}

/** `codex debug models` returns the real, live catalog -- confirmed against
    the installed codex-cli 0.153.4. Filtered to visibility: "list" (the
    user-facing set; "hide" entries are internal/experimental). */
// A hung `codex` binary must not hold the HTTP request (or the child
// process) open forever; Bun kills the process once `timeout` elapses.
const CODEX_MODELS_TIMEOUT_MS = 5000;

async function codexModels(): Promise<AgentModelOption[]> {
  const proc = Bun.spawn(['codex', 'debug', 'models'], {
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: CODEX_MODELS_TIMEOUT_MS,
  });
  try {
    const [text, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return [];
    const parsed = JSON.parse(text) as { models: CodexCatalogModel[] };
    return parsed.models
      .filter(m => m.visibility === 'list')
      .map(m => ({ value: m.slug, label: m.display_name }));
  } finally {
    proc.kill();
  }
}

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
  codexCatalog: codexModels,
};

/** A harness whose model option is free text keeps its own catalog as
    suggestions; one that offers no catalog suggests nothing. */
const CATALOGS: Record<
  string,
  (deps: AgentModelsDeps) => Promise<AgentModelOption[]>
> = {
  claude: async () => CLAUDE_MODELS,
  codex: async deps => {
    try {
      return await deps.codexCatalog();
    } catch {
      // codex not installed / catalog shape changed: an empty list degrades
      // to free-text entry in the UI rather than a broken page.
      return [];
    }
  },
};

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
  return Object.hasOwn(CATALOGS, integration.id)
    ? CATALOGS[integration.id]!(deps)
    : [];
}

export function createAgentModels(deps: AgentModelsDeps = realDeps) {
  return new Hono().get('/api/agent/models', async c => {
    const provider = c.req.query('provider');
    if (!deps.switchOn()) {
      if (provider === 'claude' || provider === 'codex')
        return c.json({ models: await CATALOGS[provider]!(deps) }, 200);
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
