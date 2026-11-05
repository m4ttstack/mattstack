import { row, type Action, type Row } from "../contract.ts";
import { SLACK_SUPPORT_CHAT_SCOPES, slackUserScopeFix } from "../slack-app.ts";

export const SLACK_SUPPORT_ROW_ID = "account.slack-support";

export type SlackCheck = { kind: "no-app" } | { kind: "not-connected" } | { kind: "unchecked" } | { kind: "connected"; scopes: string[] };

const BASE = {
  id: SLACK_SUPPORT_ROW_ID,
  kind: "account" as const,
  title: "Slack support chat",
  why: "Lets your Slack token read your DMs. Only people running support chats need it.",
  required: false,
};

const CONNECT: Action = { type: "oauth", label: "Connect", integration: "slack", verb: ["setup", "slack", "connect", "--support-chat"] };

/**
 * The offer reads `skipped`, not `needs-you`: someone who does not want this
 * has nothing to act on, and verify reports nothing outstanding for them. The
 * row still counts toward the Accounts total in the setup status.
 * `shortGrant` comes from a connect this person pressed, and the token cannot
 * show it because a short grant saves nothing.
 */
export function slackSupportRow(input: { slack: SlackCheck; appId?: string; shortGrant?: string[] }): Row {
  const { slack, appId, shortGrant = [] } = input;
  if (slack.kind === "no-app") return row({ ...BASE, status: "skipped", detail: "Your team has no Slack app yet" });
  if (slack.kind === "not-connected") return row({ ...BASE, status: "skipped", detail: "Connect Slack first" });
  if (slack.kind === "unchecked") return row({ ...BASE, status: "skipped", detail: "Could not check Slack" });

  const have = new Set(slack.scopes);
  if (SLACK_SUPPORT_CHAT_SCOPES.every((s) => have.has(s))) return row({ ...BASE, status: "ready", detail: "Ready for support chats" });

  const missing = shortGrant.filter((s) => !have.has(s));
  if (missing.length === 0) return row({ ...BASE, status: "skipped", detail: "Off. Connect to approve it in Slack", action: CONNECT });
  return row({
    ...BASE,
    status: "needs-you",
    detail: `Slack app is missing scopes. Ask its owner to ${slackUserScopeFix(appId, missing)}, then connect again`,
    action: CONNECT,
  });
}
