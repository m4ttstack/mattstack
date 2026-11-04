/**
 * The team's Slack app manifest — one owner runs `rt setup slack create-app`
 * once, and every member's `rt setup slack connect` OAuth handshake targets
 * the app this manifest describes. Scopes are fixed here (not pack-declared)
 * because the manifest and the OAuth `user_scope` request must always name
 * the same set — drift between the two would surface as Slack silently
 * granting fewer scopes than the connect flow asked for. The one exception is
 * SLACK_SUPPORT_SCOPES: the manifest always declares them so the app can grant
 * them, but only `rt setup slack connect --support-chat` requests them.
 */

export interface SlackScopeNeeds {
  bot: string[];
  user: string[];
}

export const DEFAULT_SCOPE_NEEDS: SlackScopeNeeds = {
  bot: ["chat:write", "reactions:write", "channels:read", "users:read"],
  user: ["channels:read", "groups:read", "channels:history", "groups:history", "reactions:read", "reactions:write", "chat:write"],
};

/** Opt-in: im:history lets a token read all of a person's DMs, so only the operator who runs a support chat asks for these. */
export const SLACK_SUPPORT_SCOPES = ["im:history", "im:read", "im:write", "users:read"];

export function missingSlackUserScopes(granted: string[]): string[] {
  const have = new Set(granted);
  return DEFAULT_SCOPE_NEEDS.user.filter((s) => !have.has(s));
}

function slackOAuthPage(appId: string | undefined): string {
  return appId ? `https://api.slack.com/apps/${appId}/oauth` : "https://api.slack.com/apps (your app's OAuth & Permissions page)";
}

/** Slack grants a user token only the scopes the app itself declares, so a team app made before rt asked for these has to gain them on its OAuth page before any reconnect can help. */
export function slackUserScopeFix(appId: string | undefined, missing: string[]): string {
  return `add ${missing.join(", ")} under User Token Scopes at ${slackOAuthPage(appId)}`;
}

export const DEFAULT_CALLBACK_PORT = 11234;

export function slackRedirectUri(callbackPort: number): string {
  return `http://localhost:${callbackPort}/callback`;
}

/**
 * An app made by hand, before rt's manifest, lacks rt's redirect URL. Slack
 * then shows its "redirect_uri did not match" page and never calls back, and
 * no credential rt holds can read an app's redirect URLs, so this is the fix
 * named on failure rather than checked for up front.
 */
export function slackRedirectFix(callbackPort: number, appId: string | undefined): string {
  return `add ${slackRedirectUri(callbackPort)} to the Slack app's Redirect URLs at ${slackOAuthPage(appId)}`;
}

export function slackRedirectHint(callbackPort: number): string {
  return `If Slack rejects the redirect, add ${slackRedirectUri(callbackPort)} in the app's OAuth settings`;
}

export class SlackCallbackTimeoutError extends Error {
  constructor() {
    super("timed out waiting for the Slack OAuth callback");
    this.name = "SlackCallbackTimeoutError";
  }
}

export class SlackCallbackError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Slack sent back an error: ${code}`);
    this.name = "SlackCallbackError";
    this.code = code;
  }
}

export function buildSlackManifest(opts: { name: string; callbackPort: number; scopes: SlackScopeNeeds }): object {
  return {
    display_information: { name: opts.name },
    oauth_config: {
      redirect_urls: [slackRedirectUri(opts.callbackPort)],
      scopes: { bot: opts.scopes.bot, user: [...opts.scopes.user, ...SLACK_SUPPORT_SCOPES] },
    },
    settings: { org_deploy_enabled: false },
  };
}
