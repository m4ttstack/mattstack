import { createReadStream, existsSync } from "fs";
import { createInterface } from "readline";
import type { UsageActivityData, UsageActivityQuery } from "../../packages/rt-client/src/commands.ts";
import { OUTSIDE_CASE, reading } from "./queries.ts";

const MAX_PROMPTS = 40;
const MAX_AGENTS = 40;
const MAX_TEXT = 500;

/** Text Claude Code wraps in a tag of its own; a prompt that merely starts with a tag stays. */
const WRAPPER =
  /^<(agent-message|cross-session-message|task-notification|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|system-reminder)\b/;
const COMMAND_NAME = /<command-name>\s*([^<]+?)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>\s*([^<]*?)\s*<\/command-args>/;

interface Scope {
  where: string;
  params: Record<string, string | number>;
}

interface Prompt {
  ts: number;
  text: string;
}

interface Collected {
  prompts: Prompt[];
  agents: { ts: number; description: string; type: string | null }[];
  tools: Map<string, number>;
  seenTools: Set<string>;
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

function promptText(raw: string): string | null {
  const text = raw.trim();
  const command = COMMAND_NAME.exec(text);
  if (command) {
    const args = COMMAND_ARGS.exec(text)?.[1];
    return args ? `${command[1]} ${args}` : command[1]!;
  }
  if (!/\w/.test(text) || WRAPPER.test(text) || text.startsWith("[Request interrupted")) return null;
  return text;
}

/** A person's words, not a tool result or injected text. A prompt typed mid-turn is an attachment. */
function promptOf(entry: any): string | null {
  if (entry?.isSidechain) return null;
  const queued = entry?.type === "attachment" ? entry.attachment : null;
  if (queued?.type === "queued_command") {
    const isPrompt = queued.commandMode === "prompt" && typeof queued.prompt === "string";
    return isPrompt ? promptText(queued.prompt) : null;
  }
  if (entry?.type !== "user" || entry.isMeta || entry.isCompactSummary) return null;
  const content = entry.message?.content;
  if (typeof content === "string") return promptText(content);
  if (!Array.isArray(content)) return null;
  return promptText(
    content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n"),
  );
}

function isAgentTool(name: unknown): boolean {
  return name === "Agent" || name === "Task";
}

function countTools(entry: any, ts: number, into: Collected): void {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return;
  for (const tool of content) {
    if (tool?.type !== "tool_use" || typeof tool.name !== "string" || into.seenTools.has(tool.id)) continue;
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

/** Matches by message id, not by time, since a row's messages can sit either side of another
    stage's. A prompt counts when the reply to it is in scope; the first reply in scope also
    brings the prompt before it, which is what set that work off. */
async function collect(path: string, ids: Set<string>, into: Collected): Promise<void> {
  let waiting: Prompt[] = [];
  let latest: Prompt | null = null;
  let started = false;
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (
      !line.includes('"type":"user"') &&
      !line.includes('"type":"assistant"') &&
      !line.includes('"queued_command"')
    ) {
      continue;
    }
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(entry?.timestamp);
    if (Number.isNaN(ts)) continue;

    const text = promptOf(entry);
    if (text !== null) {
      latest = { ts, text: clip(text) };
      waiting.push(latest);
      continue;
    }
    if (entry?.type !== "assistant" || entry.isSidechain) continue;
    if (!ids.has(entry.message?.id)) {
      waiting = [];
      continue;
    }
    if (!started && waiting.length === 0 && latest) into.prompts.push(latest);
    started = true;
    into.prompts.push(...waiting);
    waiting = [];
    countTools(entry, ts, into);
  }
}

function distinctPrompts(prompts: Prompt[]): Prompt[] {
  const seen = new Map(prompts.map((p) => [`${p.ts}\0${p.text}`, p]));
  return [...seen.values()].sort((a, b) => a.ts - b.ts);
}

export async function usageActivity(
  dbPath: string,
  q: UsageActivityQuery,
): Promise<UsageActivityData | null> {
  const found = reading<Map<string, { ids: Set<string>; paths: string[] }> | null>(dbPath, null, (db) => {
    const scope = scopeOf(q);
    const rows = db
      .query(`SELECT m.session_id, m.message_id FROM usage_messages m WHERE ${scope.where}`)
      .all(scope.params) as { session_id: string; message_id: string }[];
    if (rows.length === 0) return null;
    const files = db.query("SELECT path FROM usage_files WHERE session_id = ?");
    const sessions = new Map<string, { ids: Set<string>; paths: string[] }>();
    for (const { session_id, message_id } of rows) {
      let session = sessions.get(session_id);
      if (!session) {
        const paths = (files.all(session_id) as { path: string }[]).map((r) => r.path);
        session = {
          ids: new Set(),
          paths: paths.filter((p) => !p.includes("/subagents/") && existsSync(p)),
        };
        sessions.set(session_id, session);
      }
      session.ids.add(message_id);
    }
    return sessions;
  });
  if (!found) return null;

  const collected: Collected = { prompts: [], agents: [], tools: new Map(), seenTools: new Set() };
  let transcripts = 0;
  for (const { ids, paths } of found.values()) {
    for (const path of paths) {
      await collect(path, ids, collected);
      transcripts++;
    }
  }
  const prompts = distinctPrompts(collected.prompts);
  const agents = collected.agents.sort((a, b) => a.ts - b.ts);
  return {
    transcriptFound: transcripts > 0,
    prompts: prompts.slice(0, MAX_PROMPTS),
    promptCount: prompts.length,
    agents: agents.slice(0, MAX_AGENTS),
    agentCount: agents.length,
    tools: [...collected.tools]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
