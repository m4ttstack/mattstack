import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "fs";
import { join } from "path";

export interface TranscriptFile {
  path: string;
  sessionId: string;
  configDir: string;
  subagentId: string | null;
  subagentType: string | null;
  subagentModel: string | null;
}

export interface UsageMessage {
  messageId: string;
  sessionId: string;
  ts: number;
  model: string;
  subagentId: string | null;
  subagentType: string | null;
  subagentModel: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  thinking: number;
  speed: string | null;
  serviceTier: string | null;
}

function listDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readMeta(path: string): { type: string | null; model: string | null } {
  try {
    const meta = JSON.parse(readFileSync(path, "utf8"));
    return {
      type: typeof meta?.agentType === "string" ? meta.agentType : null,
      model: typeof meta?.model === "string" ? meta.model : null,
    };
  } catch {
    return { type: null, model: null };
  }
}

export function indexTranscripts(
  configDirs: string[],
  sessionIds: Set<string>,
): TranscriptFile[] {
  const files: TranscriptFile[] = [];
  const claimed = new Set<string>();
  for (const configDir of configDirs) {
    const found = new Set<string>();
    const projectsDir = join(configDir, "projects");
    for (const project of listDir(projectsDir)) {
      if (!project.isDirectory()) continue;
      const projectDir = join(projectsDir, project.name);
      for (const entry of listDir(projectDir)) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const sessionId = entry.name.slice(0, -".jsonl".length);
          if (!sessionIds.has(sessionId) || claimed.has(sessionId)) continue;
          found.add(sessionId);
          files.push({
            path: join(projectDir, entry.name),
            sessionId,
            configDir,
            subagentId: null,
            subagentType: null,
            subagentModel: null,
          });
        } else if (entry.isDirectory()) {
          const sessionId = entry.name;
          if (!sessionIds.has(sessionId) || claimed.has(sessionId)) continue;
          const subDir = join(projectDir, sessionId, "subagents");
          for (const sub of listDir(subDir)) {
            if (!sub.isFile() || !/^agent-.+\.jsonl$/.test(sub.name)) continue;
            const base = sub.name.slice(0, -".jsonl".length);
            const meta = readMeta(join(subDir, `${base}.meta.json`));
            found.add(sessionId);
            files.push({
              path: join(subDir, sub.name),
              sessionId,
              configDir,
              subagentId: base.slice("agent-".length),
              subagentType: meta.type,
              subagentModel: meta.model,
            });
          }
        }
      }
    }
    for (const id of found) claimed.add(id);
  }
  return files;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function readFrom(
  file: TranscriptFile,
  offset: number,
): { messages: UsageMessage[]; nextOffset: number; skippedLines: number } {
  let size: number;
  try {
    size = statSync(file.path).size;
  } catch {
    return { messages: [], nextOffset: offset, skippedLines: 0 };
  }
  if (size <= offset) return { messages: [], nextOffset: offset, skippedLines: 0 };

  const buf = Buffer.alloc(size - offset);
  const fd = openSync(file.path, "r");
  let got = 0;
  try {
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, offset + got);
      if (n === 0) break;
      got += n;
    }
  } finally {
    closeSync(fd);
  }

  const end = buf.subarray(0, got).lastIndexOf(0x0a);
  if (end < 0) return { messages: [], nextOffset: offset, skippedLines: 0 };

  const byId = new Map<string, UsageMessage>();
  let skippedLines = 0;
  const text = buf.subarray(0, end).toString("utf8");
  for (const line of text.split("\n")) {
    if (line.trim() === "" || !line.includes('"usage"')) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      skippedLines++;
      continue;
    }
    const message = entry?.message;
    const usage = message?.usage;
    if (!usage || typeof usage !== "object") continue;
    const model = str(message.model);
    if (model === "<synthetic>") continue;
    const messageId = str(message.id);
    const ts = Date.parse(entry.timestamp);
    if (!messageId || !model || Number.isNaN(ts)) {
      skippedLines++;
      continue;
    }
    const cc = usage.cache_creation;
    const has5m = cc && typeof cc === "object" && "ephemeral_5m_input_tokens" in cc;
    byId.set(messageId, {
      messageId,
      sessionId: file.sessionId,
      ts,
      model,
      subagentId: file.subagentId,
      subagentType: file.subagentType,
      subagentModel: file.subagentModel,
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite5m: has5m
        ? num(cc.ephemeral_5m_input_tokens)
        : num(usage.cache_creation_input_tokens) - num(cc?.ephemeral_1h_input_tokens),
      cacheWrite1h: num(cc?.ephemeral_1h_input_tokens),
      thinking: num(usage.output_tokens_details?.thinking_tokens),
      speed: str(usage.speed),
      serviceTier: str(usage.service_tier),
    });
  }
  return { messages: [...byId.values()], nextOffset: offset + end + 1, skippedLines };
}
