import { existsSync } from "fs";
import type { UsageActivityData, UsageActivityQuery } from "../../packages/rt-client/src/commands.ts";
import { OUTSIDE_CASE, reading } from "./queries.ts";

const MAX_PROMPTS = 40;
const MAX_AGENTS = 40;
const MAX_TEXT = 500;

interface Span {
  session_id: string;
  first_ts: number;
  last_ts: number;
}

interface Scope {
  where: string;
  params: Record<string, string | number>;
}

function scopeOf(q: UsageActivityQuery): Scope {
  const clauses = [q.runId ? "m.run_id = $id" : "m.session_id = $id AND m.run_id IS NULL"];
  const params: Scope["params"] = { $id: q.runId ?? q.sessionId ?? "" };
  if (q.stage) {
    clauses.push("m.stage = $stage AND m.attempt = $attempt");
    params.$stage = q.stage;
    params.$attempt = q.attempt ?? 1;
  } else if (q.outside) {
    clauses.push(`${OUTSIDE_CASE} = $outside`);
    params.$outside = q.outside;
  }
  return { where: clauses.join(" AND "), params };
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}...` : text;
}

/** A person's words, not a tool result, an injected reminder or a slash command's wrapper. */
function promptOf(entry: any): string | null {
  if (entry?.type !== "user" || entry.isMeta || entry.isSidechain || entry.isCompactSummary) return null;
  const content = entry.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((b) => b?.type === "text" && typeof b.text === "string")
            .map((b) => b.text)
            .join("\n")
        : "";
  const trimmed = text.trim();
  return trimmed === "" || trimmed.startsWith("<") || trimmed.startsWith("[Request interrupted") ? null : trimmed;
}

function toolUsesOf(entry: any): any[] {
  if (entry?.type !== "assistant" || entry.isSidechain) return [];
  const content = entry.message?.content;
  return Array.isArray(content) ? content.filter((b) => b?.type === "tool_use") : [];
}

function isAgentTool(name: unknown): boolean {
  return name === "Agent" || name === "Task";
}

interface Collected {
  prompts: { ts: number; text: string }[];
  agents: { ts: number; description: string; type: string | null }[];
  tools: Map<string, number>;
  seenTools: Set<string>;
}

/** The prompt just before the window goes in too: it is what set that work off. */
async function collect(path: string, span: Span, into: Collected): Promise<void> {
  let lead: { ts: number; text: string } | null = null;
  const inWindow: { ts: number; text: string }[] = [];
  for (const line of (await Bun.file(path).text()).split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"tool_use"')) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(entry?.timestamp);
    if (Number.isNaN(ts) || ts > span.last_ts) continue;

    const prompt = promptOf(entry);
    if (prompt !== null) {
      if (ts < span.first_ts) lead = { ts, text: clip(prompt) };
      else inWindow.push({ ts, text: clip(prompt) });
    }
    if (ts < span.first_ts) continue;
    for (const tool of toolUsesOf(entry)) {
      if (typeof tool.name !== "string" || into.seenTools.has(tool.id)) continue;
      into.seenTools.add(tool.id);
      into.tools.set(tool.name, (into.tools.get(tool.name) ?? 0) + 1);
      if (isAgentTool(tool.name) && typeof tool.input?.description === "string") {
        const type = tool.input.subagent_type;
        into.agents.push({
          ts,
          description: clip(tool.input.description),
          type: typeof type === "string" ? type : null,
        });
      }
    }
  }
  if (lead) into.prompts.push(lead);
  into.prompts.push(...inWindow);
}

export async function usageActivity(
  dbPath: string,
  q: UsageActivityQuery,
): Promise<UsageActivityData | null> {
  const found = reading<{ spans: Span[]; paths: Map<string, string[]> } | null>(dbPath, null, (db) => {
    const scope = scopeOf(q);
    const spans = db
      .query(
        `SELECT m.session_id, MIN(m.ts) AS first_ts, MAX(m.ts) AS last_ts
         FROM usage_messages m WHERE ${scope.where} GROUP BY m.session_id`,
      )
      .all(scope.params) as Span[];
    if (spans.length === 0) return null;
    const files = db.query("SELECT path FROM usage_files WHERE session_id = ?");
    const paths = new Map<string, string[]>();
    for (const { session_id } of spans) {
      const rows = files.all(session_id) as { path: string }[];
      paths.set(
        session_id,
        rows.map((r) => r.path).filter((p) => !p.includes("/subagents/") && existsSync(p)),
      );
    }
    return { spans, paths };
  });
  if (!found) return null;

  const collected: Collected = { prompts: [], agents: [], tools: new Map(), seenTools: new Set() };
  let transcripts = 0;
  for (const span of found.spans) {
    for (const path of found.paths.get(span.session_id) ?? []) {
      await collect(path, span, collected);
      transcripts++;
    }
  }
  const byTime = <T extends { ts: number }>(a: T, b: T) => a.ts - b.ts;
  return {
    transcriptFound: transcripts > 0,
    prompts: collected.prompts.sort(byTime).slice(0, MAX_PROMPTS),
    promptCount: collected.prompts.length,
    agents: collected.agents.sort(byTime).slice(0, MAX_AGENTS),
    agentCount: collected.agents.length,
    tools: [...collected.tools]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
