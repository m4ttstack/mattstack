import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "fs";
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
  const listed = new Set<string>();
  for (const configDir of configDirs) {
    const found = new Set<string>();
    const projectsDir = join(configDir, "projects");
    let real: string;
    try {
      real = realpathSync(projectsDir);
    } catch {
      continue;
    }
    if (listed.has(real)) continue;
    listed.add(real);
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

const DEFAULT_CHUNK_BYTES = 16 * 1024 * 1024;

export function readFrom(
  file: TranscriptFile,
  offset: number,
  chunkBytes = DEFAULT_CHUNK_BYTES,
): { messages: UsageMessage[]; nextOffset: number; skippedLines: number } {
  const empty = { messages: [], nextOffset: offset, skippedLines: 0 };
  let fd: number;
  let size: number;
  try {
    size = statSync(file.path).size;
    if (size <= offset) return empty;
    fd = openSync(file.path, "r");
  } catch {
    return empty;
  }

  const byId = new Map<string, UsageMessage>();
  let skippedLines = 0;

  const handleLine = (line: Buffer) => {
    const hasUsage = line.includes('"usage"');
    if (!hasUsage) {
      if (line.includes('"type":"assistant"')) skippedLines++;
      return;
    }
    let entry: any;
    try {
      entry = JSON.parse(line.toString("utf8"));
    } catch {
      skippedLines++;
      return;
    }
    const message = entry?.message;
    const usage = message?.usage;
    if (!usage || typeof usage !== "object") return;
    const model = str(message.model);
    if (model === "<synthetic>") return;
    const messageId = str(message.id);
    const ts = Date.parse(entry.timestamp);
    if (!messageId || !model || Number.isNaN(ts)) {
      skippedLines++;
      return;
    }
    const cc = usage.cache_creation;
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
      cacheWrite5m: num(cc?.ephemeral_5m_input_tokens),
      cacheWrite1h: num(cc?.ephemeral_1h_input_tokens),
      thinking: num(usage.output_tokens_details?.thinking_tokens),
      speed: str(usage.speed),
      serviceTier: str(usage.service_tier),
    });
  };

  let consumed = offset;
  let carry: Buffer = Buffer.alloc(0);
  let pos = offset;
  try {
    const chunk = Buffer.alloc(Math.min(chunkBytes, size - offset));
    while (pos < size) {
      const n = readSync(fd, chunk, 0, Math.min(chunk.length, size - pos), pos);
      if (n === 0) break;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      let start = 0;
      for (let nl = data.indexOf(0x0a, start); nl >= 0; nl = data.indexOf(0x0a, start)) {
        if (nl > start) handleLine(data.subarray(start, nl));
        start = nl + 1;
      }
      consumed += start;
      carry = Buffer.from(data.subarray(start));
    }
  } catch {
    // a read failure keeps what was consumed so far; the rest is retried next sweep
  } finally {
    closeSync(fd);
  }
  return { messages: [...byId.values()], nextOffset: consumed, skippedLines };
}
