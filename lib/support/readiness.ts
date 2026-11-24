/** What a host's Mac still needs before it can answer support requests. */

import type { OrgIdContext } from "../linear/org-ids.ts";
import { SLACK_SUPPORT_CHAT_SCOPES } from "../setup/slack-app.ts";
import { isValidChatName } from "../state/index.ts";
import { NO_SUPPORT_KEY, type SupportKeyState } from "./org-key.ts";

export interface ReadinessDeps {
  /** Null with no Slack connection; throws when Slack does not answer. */
  slackScopes(): Promise<string[] | null>;
  linearKey(): Promise<string | null>;
  defaultRepo(): string | null;
  repoPath(repo: string): string | null;
  humanHandle(): string;
  boardToken(): Promise<string | null>;
  /** Whether the relay takes this Mac's token. */
  relayAnswers(): Promise<boolean>;
  supportKey(): Promise<SupportKeyState>;
  orgIds(): OrgIdContext;
}

async function attempt<T>(read: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

async function slackMissing(deps: ReadinessDeps): Promise<string | null> {
  try {
    const scopes = await deps.slackScopes();
    return scopes && SLACK_SUPPORT_CHAT_SCOPES.every((s) => scopes.includes(s)) ? null : "Connect Slack for support chats in Setup";
  } catch {
    return "Slack did not answer";
  }
}

async function repoMissing(deps: ReadinessDeps): Promise<string | null> {
  const repo = await attempt(() => deps.defaultRepo(), null);
  if (repo === null) return "Choose the repo the support agent works in";
  return (await attempt(() => deps.repoPath(repo), null)) === null ? "Tell rt where the support agent's repo is on this Mac" : null;
}

async function boardMissing(deps: ReadinessDeps): Promise<string | null> {
  if ((await attempt(() => deps.boardToken(), null)) === null) return "Connect your board to your team's boards";
  return (await attempt(() => deps.relayAnswers(), false)) ? null : "Your board's connection is not working";
}

async function keyMissing(deps: ReadinessDeps): Promise<string | null> {
  const key = await attempt<SupportKeyState>(() => deps.supportKey(), "unreadable");
  if (key === "ready") return null;
  return key === "missing" ? NO_SUPPORT_KEY : "This Mac cannot open the org's support key";
}

/** One plain sentence for each thing missing; empty when the Mac is ready. */
export async function readiness(deps: ReadinessDeps): Promise<string[]> {
  const orgIds = await attempt<OrgIdContext>(() => deps.orgIds(), { forgeHost: null, teamKeys: null });
  const missing = [
    await slackMissing(deps),
    (await attempt(() => deps.linearKey(), null)) ? null : "Add the Linear key support tickets are filed with",
    await repoMissing(deps),
    isValidChatName(await attempt(() => deps.humanHandle(), "")) ? null : "Set your chat name",
    await boardMissing(deps),
    await keyMissing(deps),
    orgIds.forgeHost ? null : "Your org's settings name no forge host, which tickets need",
    orgIds.teamKeys ? null : "Your org's settings name no Linear team, which tickets need",
  ];
  return missing.filter((m): m is string => m !== null);
}
