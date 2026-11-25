/** What a host's Mac still needs before it can answer support requests. */

import type { SupportMissing } from "../../packages/rt-client/src/support.ts";
import type { OrgIdContext } from "../linear/org-ids.ts";
import { isDeadConnection } from "../slack/client.ts";
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

const need = (text: string, fix: SupportMissing["fix"] = null, label = text): SupportMissing => ({ text, label, fix });

const CONNECT_SLACK = need("Connect Slack for support chats in Settings > Accounts", "accounts", "Connect Slack for support chats");

async function slackMissing(deps: ReadinessDeps): Promise<SupportMissing | null> {
  try {
    const scopes = await deps.slackScopes();
    return scopes && SLACK_SUPPORT_CHAT_SCOPES.every((s) => scopes.includes(s)) ? null : CONNECT_SLACK;
  } catch (err) {
    return isDeadConnection(err) ? CONNECT_SLACK : need("Slack did not answer");
  }
}

async function repoMissing(deps: ReadinessDeps): Promise<SupportMissing | null> {
  const repo = await attempt(() => deps.defaultRepo(), null);
  if (repo === null) return need("Choose the repo the support agent works in", "repo");
  return (await attempt(() => deps.repoPath(repo), null)) === null ? need("Tell rt where the support agent's repo is on this Mac", "repo") : null;
}

async function boardMissing(deps: ReadinessDeps): Promise<SupportMissing | null> {
  if ((await attempt(() => deps.boardToken(), null)) === null) return need("Connect your board to your team's boards", "accounts");
  return (await attempt(() => deps.relayAnswers(), false)) ? null : need("Your board's connection is not working", "accounts");
}

async function keyMissing(deps: ReadinessDeps): Promise<SupportMissing | null> {
  const key = await attempt<SupportKeyState>(() => deps.supportKey(), "unreadable");
  if (key === "ready") return null;
  return need(key === "missing" ? NO_SUPPORT_KEY : "This Mac cannot open the org's support key");
}

/** Empty when the Mac is ready. */
export async function readiness(deps: ReadinessDeps): Promise<SupportMissing[]> {
  const orgIds = await attempt<OrgIdContext>(() => deps.orgIds(), { forgeHost: null, teamKeys: null });
  const missing = [
    await slackMissing(deps),
    (await attempt(() => deps.linearKey(), null)) ? null : { ...need("Add the Linear key support tickets are filed with"), command: "rt secrets set rt linearSupportApiKey" },
    await repoMissing(deps),
    isValidChatName(await attempt(() => deps.humanHandle(), "")) ? null : need("Set your chat name", "chat-name"),
    await boardMissing(deps),
    await keyMissing(deps),
    orgIds.forgeHost ? null : need("Your org's settings name no forge host, which tickets need"),
    orgIds.teamKeys ? null : need("Your org's settings name no Linear team, which tickets need"),
  ];
  return missing.filter((m): m is SupportMissing => m !== null);
}
