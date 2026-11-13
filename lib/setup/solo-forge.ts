import type { UserIntegrationOverrides } from "./team-settings.ts";

/** forgeHost is shared by both forges, and a team Mac writes github.com there, so a solo GitLab must not inherit it. */
export function soloForgeOverrides(overrides: UserIntegrationOverrides, solo: boolean): UserIntegrationOverrides {
  if (!solo || overrides.forgeHost?.toLowerCase() !== "github.com") return overrides;
  const { forgeHost: _dropped, ...rest } = overrides;
  return rest;
}
