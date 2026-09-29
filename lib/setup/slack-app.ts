/**
 * The team's Slack app manifest — one owner runs `rt setup slack create-app`
 * once, and every member's `rt setup slack connect` OAuth handshake targets
 * the app this manifest describes. Scopes are fixed here (not pack-declared)
 * because the manifest and the OAuth `user_scope` request must always name
 * the same set — drift between the two would surface as Slack silently
 * granting fewer scopes than the connect flow asked for.
 */

export interface SlackScopeNeeds {
  bot: string[];
  user: string[];
}

export const DEFAULT_SCOPE_NEEDS: SlackScopeNeeds = {
  bot: ["chat:write", "reactions:write", "channels:read", "users:read"],
  user: ["reactions:write", "chat:write"],
};

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
  const page = appId ? `https://api.slack.com/apps/${appId}/oauth` : "https://api.slack.com/apps (your app's OAuth & Permissions page)";
  return `add ${slackRedirectUri(callbackPort)} to the Slack app's Redirect URLs at ${page}`;
}

export class SlackCallbackTimeoutError extends Error {
  constructor() {
    super("timed out waiting for the Slack OAuth callback");
    this.name = "SlackCallbackTimeoutError";
  }
}

export function buildSlackManifest(opts: { name: string; callbackPort: number; scopes: SlackScopeNeeds }): object {
  return {
    display_information: { name: opts.name },
    oauth_config: {
      redirect_urls: [slackRedirectUri(opts.callbackPort)],
      scopes: { bot: opts.scopes.bot, user: opts.scopes.user },
    },
    settings: { org_deploy_enabled: false },
  };
}
