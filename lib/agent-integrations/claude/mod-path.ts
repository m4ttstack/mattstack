/**
 * The one place a Claude adapter asks whether the mattstack-mods plugin owns a
 * feature for a session. Each feature falls back on its own: a block that is
 * not live on the binding's session (never started, cleared after an error,
 * or lapsed with its link's heartbeat) sends that one call down today's path.
 *
 * Link state lives only in the daemon's memory, so in any other process (the
 * CLI, a hook, the MCP server) there is no registry and every answer is
 * today's path.
 */

import type { Capability, ModBlock, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { isDetachedAttachment } from "../session-store.ts";
import { installedModLinks, type ModLinks, type ModLinkView } from "./mod-links.ts";

/** What a live link reported about where its session runs: a hint, never authority. */
export type ModContextHint = Pick<ModLinkView, "linkId" | "sessionId" | "cwd" | "root" | "pane">;

function claudeId(binding: SessionBinding): boolean {
  return binding.native.harness === "claude" && binding.native.kind === "id";
}

/** The live link for a native Claude session id, or null with none (or outside the daemon). */
export function liveModLink(nativeId: string, links: ModLinks | null = installedModLinks()): ModLinkView | null {
  return links?.linkOf(nativeId) ?? null;
}

/**
 * True only for an attached Claude binding whose native id has a live link
 * reporting `block`. Asked per call, so a block the mod cleared falls back on
 * the very next one.
 */
export function modPath(binding: SessionBinding, block: ModBlock, links: ModLinks | null = installedModLinks()): boolean {
  if (!claudeId(binding) || isDetachedAttachment(binding)) return false;
  return links?.live(binding.native.value, block) ?? false;
}

/** The live link's context for a native Claude session id, for the caller resolver to weigh as a hint. */
export function modContext(nativeId: string, links: ModLinks | null = installedModLinks()): ModContextHint | null {
  const link = liveModLink(nativeId, links);
  if (!link) return null;
  return {
    linkId: link.linkId, sessionId: link.sessionId, cwd: link.cwd, root: link.root,
    ...(link.pane !== undefined && { pane: link.pane }),
  };
}

const POLICY_BLOCKS: readonly ModBlock[] = ["policy", "stop-gate"];
const MOD_POLICY: readonly Capability[] = ["gate-policy", "continuation-policy"];

/** What a link carrying `blocks` advertises for its session: both policies only with both the guard and the stop gate. */
export function modPolicyCapabilities(blocks: readonly ModBlock[]): Capability[] {
  return POLICY_BLOCKS.every((b) => blocks.includes(b)) ? [...MOD_POLICY] : [];
}

/** The policy capabilities an attached Claude binding's live link advertises now; none without that link. */
export function sessionModPolicy(binding: SessionBinding, links: ModLinks | null = installedModLinks()): Capability[] {
  return POLICY_BLOCKS.every((b) => modPath(binding, b, links)) ? [...MOD_POLICY] : [];
}
