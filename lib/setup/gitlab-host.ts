import { isValidHostname } from "./host-validate.ts";
import type { UserIntegrationOverrides } from "./team-settings.ts";

/** forgeHost is shared by both forges, and a Mac in a github.com team writes github.com there, so a GitLab token must never inherit it. */
export function confirmedGitlabHost(overrides: UserIntegrationOverrides): string | null {
  const host = overrides.forgeHost;
  if (!host || !isValidHostname(host)) return null;
  const lower = host.toLowerCase();
  return lower === "github.com" ? null : lower;
}
