import {
  agentGet as rtAgentGet,
  agentIntegrations as rtAgentIntegrations,
  agentResume as rtAgentResume,
  agentStart as rtAgentStart,
  selectLaunchHarness as selectSharedHarness,
  type Commands,
  type HarnessId,
} from '@mattstack/rt-client';
import { configuredProvider, integrationsOn } from './caller-session.ts';

/** What picking a pane's harness reads: the integrations switch, the
    registry's metadata, and an agent record's provider. */
export interface HarnessIo {
  switchOn(): boolean;
  /** The user's default harness (`agent.provider`); unset when unreadable. */
  defaultHarness(): HarnessId | undefined;
  agentIntegrations: typeof rtAgentIntegrations;
  agentGet: typeof rtAgentGet;
}

export const defaultHarnessIo: HarnessIo = {
  switchOn: () => integrationsOn(),
  defaultHarness: () => configuredProvider(),
  agentIntegrations: rtAgentIntegrations,
  agentGet: rtAgentGet,
};

/**
 * The harness a fresh board pane runs: undefined while the integrations
 * switch is off, so the launch is what it always was. With it on, the
 * user's default (`agent.provider`) when it is turned on, else the first
 * integration turned on in registry order. Readiness is left to the launch
 * itself, since a harness can read not ready until something connects.
 */
export async function selectLaunchHarness(
  io: HarnessIo = defaultHarnessIo
): Promise<HarnessId | undefined> {
  return selectSharedHarness(io, {
    sentenceStart: 'The board',
    inSentence: 'the board',
  });
}

/** The harness an existing agent record runs; undefined while the switch is off. */
export async function agentHarness(
  agentId: string,
  io: HarnessIo = defaultHarnessIo
): Promise<HarnessId | undefined> {
  if (!io.switchOn()) return undefined;
  const res = await io.agentGet({ id: agentId });
  if (!res.ok || !res.data)
    throw new Error(
      `The board could not read agent ${agentId}: ${res.error ?? 'rt sent no answer'}`
    );
  return res.data.provider;
}

export interface AgentLaunchResult {
  agentId: string;
  sessionId: string;
  paneId: string;
  tabId: string;
  workspaceId: string;
  focusedExisting: boolean;
}

/** A resume always names its pack: the daemon re-applies a stored pack to a
    resume that names none, so no pack is sent as the empty string, which
    clears it. */
export function resumePackEnv(
  pack: string | undefined
): Record<string, string> {
  return { MATTSTACK_PACK: pack ?? '' };
}

export interface AgentIo {
  agentStart: typeof rtAgentStart;
  agentResume: typeof rtAgentResume;
  /** Unset reads the real switch and daemon. */
  harness?: HarnessIo;
}

export async function startAgentPane(
  opts: {
    repo: string;
    cwd: string;
    prompt: string;
    workspaceLabel: string;
    tabLabel: string;
    subject: string;
    account?: string;
    model?: string;
    effort?: string;
    env?: Record<string, string>;
    /** Unset lets the daemon pick, as before the integrations switch. */
    harness?: HarnessId;
  },
  io?: AgentIo
): Promise<AgentLaunchResult> {
  const ioInstance = io || {
    agentStart: rtAgentStart,
    agentResume: rtAgentResume,
  };

  const payload: Commands['agent:start']['payload'] = {
    repo: opts.repo,
    cwd: opts.cwd,
    prompt: opts.prompt,
    surface: 'herdr',
    workspace: opts.workspaceLabel,
    tab: opts.tabLabel,
    subject: opts.subject,
    ...(opts.harness !== undefined ? { provider: opts.harness } : {}),
    ...(opts.account !== undefined ? { account: opts.account } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  };

  const response = await ioInstance.agentStart(payload);

  if (!response.ok) {
    if (response.error && response.error.match(/already open; focused it/)) {
      return {
        agentId: '',
        sessionId: '',
        paneId: '',
        tabId: '',
        workspaceId: '',
        focusedExisting: true,
      };
    }
    throw new Error(response.error || 'unknown error');
  }

  if (!response.data) {
    throw new Error('no data in response');
  }

  const data = response.data;
  return {
    agentId: data.id,
    sessionId: data.sessionId,
    paneId: data.paneId || '',
    tabId: data.tabId || '',
    workspaceId: data.workspaceId || '',
    focusedExisting: false,
  };
}

export async function resumeAgentPane(
  opts: {
    agentId: string;
    prompt?: string;
    workspaceLabel: string;
    tabLabel: string;
    env?: Record<string, string>;
  },
  io?: AgentIo
): Promise<AgentLaunchResult> {
  const ioInstance = io || {
    agentStart: rtAgentStart,
    agentResume: rtAgentResume,
  };

  const payload: Commands['agent:resume']['payload'] = {
    id: opts.agentId,
    surface: 'herdr',
    workspace: opts.workspaceLabel,
    tab: opts.tabLabel,
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  };

  const response = await ioInstance.agentResume(payload);

  if (!response.ok) {
    if (response.error && response.error.match(/already open; focused it/)) {
      return {
        agentId: '',
        sessionId: '',
        paneId: '',
        tabId: '',
        workspaceId: '',
        focusedExisting: true,
      };
    }
    throw new Error(response.error || 'unknown error');
  }

  if (!response.data) {
    throw new Error('no data in response');
  }

  const data = response.data;
  return {
    agentId: data.id,
    sessionId: data.sessionId,
    paneId: data.paneId || '',
    tabId: data.tabId || '',
    workspaceId: data.workspaceId || '',
    focusedExisting: false,
  };
}
