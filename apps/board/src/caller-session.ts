import { getSetting, type HarnessId } from '@mattstack/rt-client';

/** The native session a status or gate CLI call comes from. `problem` says
    why none is named. `both` carries the two ids an environment named, for
    resolveCallerSession to choose between. */
export interface CallerSession {
  sessionId?: string;
  harness?: HarnessId;
  problem?: string;
  both?: { codex: string; claude: string };
}

/** Which CLI is asking, for the wording of its problem line. */
export type CallerCli = 'status' | 'gate';

/** Read at call time; unreadable settings keep the switch off. */
export function integrationsOn(read: typeof getSetting = getSetting): boolean {
  try {
    return read<boolean>('agent.integrations.enabled').value === true;
  } catch {
    return false;
  }
}

/** The user's default harness (`agent.provider`), through the resolver;
    undefined when unreadable. */
export function configuredProvider(
  read: typeof getSetting = getSetting
): HarnessId | undefined {
  try {
    const value = read<string>('agent.provider').value;
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

const text = (v: string | undefined): string | undefined =>
  v && v.trim() ? v : undefined;

function bothProblem(cli: CallerCli): string {
  const outcome =
    cli === 'gate'
      ? 'so this gate names no session'
      : 'so the board recorded no session for it';
  return `This pane names both a Codex thread and a Claude Code session, and the board could not tell which one runs it, ${outcome}`;
}

/**
 * The calling session from the pane's environment. With the integrations
 * switch off only Claude Code's own variable counts, as before. With it on,
 * a Codex pane names its thread through CODEX_THREAD_ID; an environment
 * naming both is left to resolveCallerSession.
 */
export function callerSession(
  env: Record<string, string | undefined>,
  switchOn: boolean,
  cli: CallerCli = 'status'
): CallerSession {
  if (!switchOn) {
    const raw = env.CLAUDE_CODE_SESSION_ID;
    return raw ? { sessionId: raw } : {};
  }
  const claude = text(env.CLAUDE_CODE_SESSION_ID);
  const codex = text(env.CODEX_THREAD_ID);
  if (codex && claude)
    return { problem: bothProblem(cli), both: { codex, claude } };
  if (codex) return { sessionId: codex, harness: 'codex' };
  return claude ? { sessionId: claude, harness: 'claude' } : {};
}

/**
 * callerSession, with an environment naming both sessions settled by the
 * harness of the agent the board launched for this state row. Without an
 * agent, or when its harness cannot be read, it names none.
 */
export async function resolveCallerSession(
  env: Record<string, string | undefined>,
  switchOn: boolean,
  cli: CallerCli,
  agentId: () => string | undefined,
  harnessOf: (agentId: string) => Promise<HarnessId | undefined>
): Promise<CallerSession> {
  const found = callerSession(env, switchOn, cli);
  if (!found.both) return found;
  const id = agentId();
  if (!id) return { problem: found.problem };
  let harness: HarnessId | undefined;
  try {
    harness = await harnessOf(id);
  } catch {
    return { problem: found.problem };
  }
  if (harness === 'codex')
    return { sessionId: found.both.codex, harness: 'codex' };
  if (harness === 'claude')
    return { sessionId: found.both.claude, harness: 'claude' };
  return { problem: found.problem };
}
