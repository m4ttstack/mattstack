import {
  defaultHarness,
  getSetting,
  integrationsSwitchOn,
  nativeCallerFromEnv,
  type HarnessId,
} from '@mattstack/rt-client';

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
  return integrationsSwitchOn(read);
}

/** The user's default harness (`agent.provider`), through the resolver;
    undefined when unreadable. */
export function configuredProvider(
  read: typeof getSetting = getSetting
): HarnessId | undefined {
  return defaultHarness(read);
}

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
  const found = nativeCallerFromEnv(env, switchOn);
  return found.both ? { problem: bothProblem(cli), both: found.both } : found;
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
