/**
 * The team's tools a member signs in to from the connect screen. A tool that
 * connects any other integration (StrongDM, Linear) is covered by that
 * integration's own account row instead.
 */
import type { Integration } from "./contract.ts";
import type { PackRequirements, ToolRequirement } from "./requirements.ts";

export const CLI_SESSION_INTEGRATIONS: readonly Integration[] = ["doppler", "ldcli"];

function hasSignIn(tool: ToolRequirement): boolean {
  if (!tool.connect) return false;
  return "verb" in tool.connect || CLI_SESSION_INTEGRATIONS.includes(tool.connect.integration);
}

export function signInTools(reqs: PackRequirements[]): ToolRequirement[] {
  const seen = new Set<string>();
  const first: ToolRequirement[] = [];
  for (const tool of reqs.flatMap((r) => r.tools)) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    first.push(tool);
  }
  const signIn = first.filter(hasSignIn);
  return [...signIn.filter((t) => !t.optional), ...signIn.filter((t) => t.optional)];
}
