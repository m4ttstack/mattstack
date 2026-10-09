/**
 * Suggested values for a harness's free-text model and effort options, shared
 * by every app that offers them. Suggestions only: the harness validates.
 */

export interface AgentCatalogOption {
  value: string;
  label: string;
}

export interface AgentCatalog {
  model: AgentCatalogOption[];
  effort: AgentCatalogOption[];
}

// No live catalog command exists for claude (verified: no model-list
// subcommand in `claude --help`). Maintained by hand; a stale entry here is
// a documentation debt, not a correctness bug.
export const CLAUDE_MODEL_CATALOG: readonly AgentCatalogOption[] = [
  { value: "sonnet", label: "Sonnet (latest)" },
  { value: "opus", label: "Opus (latest)" },
  { value: "haiku", label: "Haiku (latest)" },
  { value: "fable", label: "Fable (latest)" },
];

export const CLAUDE_EFFORT_CATALOG: readonly AgentCatalogOption[] = ["low", "medium", "high", "max"].map((v) => ({ value: v, label: v }));

interface CodexCatalogModel {
  slug: string;
  display_name: string;
  visibility: string;
}

// A hung `codex` binary must not hold a request (or the child process) open
// forever; Bun kills the process once `timeout` elapses.
const CODEX_MODELS_TIMEOUT_MS = 5000;

/**
 * `codex debug models`, filtered to visibility "list" (the user-facing set).
 * Codex missing, failing or changing its output shape gives an empty list,
 * which a form shows as plain free text.
 */
export async function codexModelCatalog(): Promise<AgentCatalogOption[]> {
  try {
    const proc = Bun.spawn(["codex", "debug", "models"], { stdout: "pipe", stderr: "ignore", timeout: CODEX_MODELS_TIMEOUT_MS });
    try {
      const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      if (exitCode !== 0) return [];
      const parsed = JSON.parse(text) as { models: CodexCatalogModel[] };
      return parsed.models.filter((m) => m.visibility === "list").map((m) => ({ value: m.slug, label: m.display_name }));
    } finally {
      proc.kill();
    }
  } catch {
    return [];
  }
}

export interface AgentCatalogDeps {
  codexModels?: () => Promise<AgentCatalogOption[]>;
}

/** A known harness's suggestions; undefined for a harness with no catalog. */
export async function agentCatalog(harness: string, deps: AgentCatalogDeps = {}): Promise<AgentCatalog | undefined> {
  if (harness === "claude") return { model: [...CLAUDE_MODEL_CATALOG], effort: [...CLAUDE_EFFORT_CATALOG] };
  if (harness === "codex") {
    let model: AgentCatalogOption[];
    try {
      model = await (deps.codexModels ?? codexModelCatalog)();
    } catch {
      model = [];
    }
    return { model, effort: [] };
  }
  return undefined;
}
