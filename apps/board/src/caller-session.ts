import { getSetting, type HarnessId } from '@mattstack/rt-client';

/** The native session a status or gate CLI call comes from. `problem` says
    why none is named when the environment names two. */
export interface CallerSession {
  sessionId?: string;
  harness?: HarnessId;
  problem?: string;
}

/** Read at call time; unreadable settings keep the switch off. */
export function integrationsOn(read: typeof getSetting = getSetting): boolean {
  try {
    return read<boolean>('agent.integrations.enabled').value === true;
  } catch {
    return false;
  }
}

const text = (v: string | undefined): string | undefined =>
  v && v.trim() ? v : undefined;

/**
 * The calling session from the pane's environment. With the integrations
 * switch off only Claude Code's own variable counts, as before. With it on,
 * a Codex pane names its thread through CODEX_THREAD_ID; an environment
 * naming both cannot say which one is calling, so it names neither.
 */
export function callerSession(
  env: Record<string, string | undefined>,
  switchOn: boolean
): CallerSession {
  if (!switchOn) {
    const raw = env.CLAUDE_CODE_SESSION_ID;
    return raw ? { sessionId: raw } : {};
  }
  const claude = text(env.CLAUDE_CODE_SESSION_ID);
  const codex = text(env.CODEX_THREAD_ID);
  if (codex && claude)
    return {
      problem:
        'This pane names both a Codex thread and a Claude Code session, so the board recorded no session for it',
    };
  if (codex) return { sessionId: codex, harness: 'codex' };
  return claude ? { sessionId: claude, harness: 'claude' } : {};
}
