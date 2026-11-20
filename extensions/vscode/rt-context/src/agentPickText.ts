import { AGENT_STATUS_WORDS, modelWords } from '@mattstack/rt-client';
import type { AgentRow } from './agentRows';

const ICONS: Record<AgentRow['status'] | 'gate', string> = {
  working: '$(circle-filled)',
  waiting: '$(bell-dot)',
  gate: '$(bell-dot)',
  idle: '$(circle-outline)',
  done: '$(pass)',
  ended: '$(history)',
};

function statusWord(row: AgentRow): string {
  if (row.info.gate) return AGENT_STATUS_WORDS.gate;
  return AGENT_STATUS_WORDS[row.status === 'waiting' ? 'blocked' : row.status];
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** A chat handle ends in a short suffix (`acme-1234-login-fix.lvki`); the part before it is the readable name. */
function handleName(handle: string): string {
  return handle.replace(/\.[a-z0-9]{4}$/, '');
}

export function agentDisplayName(row: AgentRow): string {
  return row.info.label ?? (row.info.handle ? handleName(row.info.handle) : row.title);
}

export function agentPickText(row: AgentRow, now = Date.now()): { label: string; description: string; detail?: string } {
  const icon = ICONS[row.info.gate ? 'gate' : row.status];
  const word = statusWord(row);
  const handle = row.info.handle;
  const name = agentDisplayName(row);
  const when = row.at > 0 ? (row.group === 'recent' ? `ended ${ago(row.at, now)}` : `started ${ago(row.at, now)}`) : '';
  const description = row.group === 'recent' ? (when || word) : [word, when].filter(Boolean).join(' · ');

  const detail = [
    row.info.gate ? `“${row.info.gate}”` : undefined,
    row.startedBy,
    modelWords(row.info.model, row.info.effort) || undefined,
    row.group === 'running' && row.info.tab ? `tab ${row.info.tab}` : undefined,
    handle && handle !== name ? handle : undefined,
  ].filter(Boolean).join('  ·  ');

  return { label: `${icon} ${name}`, description, ...(detail ? { detail } : {}) };
}
