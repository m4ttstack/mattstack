/**
 * The daemon's registry of live mattstack-mods links, in memory only: a
 * daemon restart drops every link, and each mod re-registers on its next
 * "unknown link" answer.
 *
 * Blocks are keyed by native Claude session id, so a session with no binding
 * still registers. A block counts as live only while its link is: a link
 * clears when no heartbeat arrives for 30 s, when it ends, when a newer link
 * registers for the same session, and, all at once, when
 * agent.integrations.enabled is off.
 */

import {
  MOD_BLOCKS, type ModBlock, type FaultCode, type Outcome,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { resolveLiveInbox } from "../../claude-registry.ts";
import { deliverToInbox } from "../../daemon/inbox.ts";
import type { SessionStore } from "../session-store.ts";

/** The Claude Code releases this daemon has tested the plugin against. Only a test run widens it. */
export const TESTED_CLAUDE_CODE = { min: "2.1.293", max: "2.1.293" } as const;

export const LINK_EXPIRY_MS = 30_000;
const ACK_RETENTION_MS = 60_000;
const HARNESS = "claude";

/**
 * `previousSessionId` with `previousLinkId` is a link-reported id change (a
 * `/clear`): the same mod, over the link it kept, naming the old id and the
 * new one. Only that pair continues the old id's binding.
 */
export type ModRegistration = {
  sessionId: string; previousSessionId?: string; previousLinkId?: string; cwd: string; root: string; pane?: string;
  claudeCode: string; plugin: string; blocks: ModBlock[];
};

/** What diagnostics list for one live link. */
export type ModLinkView = {
  linkId: string; sessionId: string; cwd: string; root: string; pane?: string;
  claudeCode: string; plugin: string; blocks: ModBlock[];
  registeredAt: number; lastHeartbeatAt: number;
};

/** A mod's confirmation of a pushed command, kept until it is taken or ages out. */
export type ModAck = { linkId: string; sessionId: string; at: number };

export interface ModLinks {
  register(input: ModRegistration): Outcome<{ linkId: string; blocks: ModBlock[] }>;
  heartbeat(linkId: string): Outcome<void>;
  end(linkId: string): void;
  /** Whether `linkId` is a live link: not expired, ended or superseded. */
  has(linkId: string): boolean;
  live(sessionId: string, block: ModBlock): boolean;
  linkOf(sessionId: string): ModLinkView | null;
  /** Records the first ack of `commandId` from `linkId`'s session; a later one for the same pair changes nothing. */
  ack(linkId: string, commandId: string): Outcome<void>;
  /** Removes and returns `sessionId`'s ack of `commandId`, or null when that session has not acked it. */
  takeAck(commandId: string, sessionId: string): ModAck | null;
  /** Drops expired links (every link while the switch is off) and aged acks; returns how many links it dropped. */
  sweep(): number;
}

export type ModLinksDeps = {
  now(): number;
  integrationsEnabled(): boolean;
  store: SessionStore;
  /** Called once a binding has continued from generation `from` to `to`, so stores outside state.db (gate questions) follow it. */
  continued?(sessionKey: string, from: number, to: number): void;
};

function release(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

export function inTestedRange(claudeCode: string): boolean {
  const have = release(claudeCode);
  const min = release(TESTED_CLAUDE_CODE.min)!;
  const max = release(TESTED_CLAUDE_CODE.max)!;
  return have !== null && compare(have, min) >= 0 && compare(have, max) <= 0;
}

/** A block name this daemon does not know (a newer plugin's) is dropped, never refused. */
function knownBlocks(blocks: readonly string[]): ModBlock[] {
  return MOD_BLOCKS.filter((b) => blocks.includes(b));
}

function fail(code: FaultCode, message: string): Outcome<never> {
  return { ok: false, error: { code, message } };
}

export const UNKNOWN_LINK = "no live link has that id; register again";

let installed: ModLinks | null = null;

/** Makes `links` the process's one registry; only the daemon installs one. */
export function installModLinks(links: ModLinks | null): void {
  installed = links;
}

/** The daemon's registry, or null in any process that holds no links (the CLI, a hook). */
export function installedModLinks(): ModLinks | null {
  return installed;
}

export function createModLinks(deps: ModLinksDeps): ModLinks {
  const links = new Map<string, ModLinkView>();
  const bySession = new Map<string, string>();
  // Keyed by session and command id, so one session's link cannot ack a command pushed to another.
  const acks = new Map<string, ModAck>();
  const ackKey = (sessionId: string, commandId: string) => `${sessionId}\n${commandId}`;

  function drop(linkId: string): void {
    const link = links.get(linkId);
    if (!link) return;
    links.delete(linkId);
    if (bySession.get(link.sessionId) === linkId) bySession.delete(link.sessionId);
  }

  function sweep(): number {
    // With nothing held, the switch is not read: a daemon that never sees a mod pays nothing.
    if (links.size === 0 && acks.size === 0) return 0;
    const now = deps.now();
    for (const [id, ack] of acks) if (now - ack.at >= ACK_RETENTION_MS) acks.delete(id);
    const enabled = deps.integrationsEnabled();
    let dropped = 0;
    for (const link of [...links.values()]) {
      if (!enabled || now - link.lastHeartbeatAt >= LINK_EXPIRY_MS) {
        drop(link.linkId);
        dropped++;
      }
    }
    return dropped;
  }

  function current(sessionId: string): ModLinkView | null {
    sweep();
    const linkId = bySession.get(sessionId);
    return linkId === undefined ? null : links.get(linkId) ?? null;
  }

  function known(linkId: string): ModLinkView | null {
    sweep();
    return links.get(linkId) ?? null;
  }

  /** The single Claude binding on the previous id moves to the new one; anything else is left alone. */
  function continueBinding(previous: string, next: string): Outcome<void> {
    const recorded = deps.store.listByNativeValue(previous)
      .filter((b) => b.native.harness === HARNESS && b.native.kind === "id");
    if (recorded.length !== 1) return { ok: true, data: undefined };
    const binding = recorded[0]!;
    const from = binding.attachment.generation;
    const moved = deps.store.continueNative(binding.key, from, { ...binding.native, value: next });
    if (moved.ok) {
      if (moved.data.attachment.generation !== from) deps.continued?.(binding.key, from, moved.data.attachment.generation);
      return { ok: true, data: undefined };
    }
    return moved.error.code === "transient" ? moved : { ok: true, data: undefined };
  }

  return {
    register(input) {
      sweep();
      if (!deps.integrationsEnabled()) {
        return fail("refused", "agent integrations are off, so rt takes no mod links");
      }
      const holder = input.previousSessionId !== undefined && input.previousSessionId !== input.sessionId
        ? current(input.previousSessionId)
        : null;
      const previous = holder !== null && holder.linkId === input.previousLinkId ? holder : null;
      if (previous) {
        const continued = continueBinding(previous.sessionId, input.sessionId);
        if (!continued.ok) return continued;
        drop(previous.linkId);
      }
      const superseded = bySession.get(input.sessionId);
      if (superseded !== undefined) drop(superseded);

      const now = deps.now();
      const blocks = inTestedRange(input.claudeCode) ? knownBlocks(input.blocks) : [];
      const link: ModLinkView = {
        linkId: `ml-${crypto.randomUUID()}`, sessionId: input.sessionId, cwd: input.cwd, root: input.root,
        ...(input.pane !== undefined && { pane: input.pane }),
        claudeCode: input.claudeCode, plugin: input.plugin, blocks,
        registeredAt: now, lastHeartbeatAt: now,
      };
      links.set(link.linkId, link);
      bySession.set(link.sessionId, link.linkId);
      return { ok: true, data: { linkId: link.linkId, blocks: [...blocks] } };
    },

    heartbeat(linkId) {
      const link = known(linkId);
      if (!link) return fail("invalid", UNKNOWN_LINK);
      link.lastHeartbeatAt = deps.now();
      return { ok: true, data: undefined };
    },

    end(linkId) {
      drop(linkId);
    },

    has(linkId) {
      return known(linkId) !== null;
    },

    live(sessionId, block) {
      return current(sessionId)?.blocks.includes(block) ?? false;
    },

    linkOf(sessionId) {
      const link = current(sessionId);
      return link ? { ...link, blocks: [...link.blocks] } : null;
    },

    ack(linkId, commandId) {
      const link = known(linkId);
      if (!link) return fail("invalid", UNKNOWN_LINK);
      const key = ackKey(link.sessionId, commandId);
      if (!acks.has(key)) acks.set(key, { linkId, sessionId: link.sessionId, at: deps.now() });
      return { ok: true, data: undefined };
    },

    takeAck(commandId, sessionId) {
      const key = ackKey(sessionId, commandId);
      const ack = acks.get(key);
      if (!ack) return null;
      acks.delete(key);
      return ack;
    },

    sweep,
  };
}

/** How long a push waits for the mod's `session:ack` before reporting the command unconfirmed. */
export const MOD_COMMAND_ACK_MS = 5_000;
const ACK_POLL_MS = 50;
const COMMAND_KIND = /^[A-Za-z][A-Za-z0-9._-]*$/;

/**
 * The inbox frame's whole content for one command. The mod consumes a delivery
 * only when it is exactly this envelope, so a chat message quoting one (always
 * wrapped in its cross-session-message) never reads as a command, and only
 * when `linkId` is its own current link, which no other inbox writer knows.
 */
export function modCommandEnvelope(id: string, kind: string, data: unknown, linkId: string): string {
  return `<rt-mod-command id="${id}" kind="${kind}" link="${linkId}">${JSON.stringify(data ?? null)}</rt-mod-command>`;
}

export type PushDeps = {
  links: ModLinks | null;
  inbox(sessionId: string): { socketPath: string } | null;
  deliver: typeof deliverToInbox;
  now(): number;
  sleep(ms: number): Promise<void>;
  newId(): string;
};

function defaultPushDeps(): PushDeps {
  return {
    links: installedModLinks(),
    inbox: (sessionId) => resolveLiveInbox(sessionId),
    deliver: deliverToInbox,
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms),
    newId: () => crypto.randomUUID(),
  };
}

/**
 * Sends one command to a Claude session's mod through its inbox and waits up
 * to MOD_COMMAND_ACK_MS for that session's ack. `acked: false` is the caller's
 * cue to take its fallback, once, for that action.
 */
export async function pushModCommand(
  sessionId: string, kind: string, data: unknown, overrides: Partial<PushDeps> = {},
): Promise<Outcome<{ acked: boolean }>> {
  const deps: PushDeps = { ...defaultPushDeps(), ...overrides };
  if (!COMMAND_KIND.test(kind)) return fail("invalid", `"${kind}" cannot name a mod command`);
  if (!deps.links) return fail("not-ready", "this process holds no mod links");
  const link = deps.links.linkOf(sessionId);
  if (!link) return fail("not-ready", `Claude session ${sessionId} has no live mod link`);
  const inbox = deps.inbox(sessionId);
  if (!inbox) return fail("not-ready", `Claude session ${sessionId} has no live inbox`);

  const id = deps.newId();
  const written = await deps.deliver(inbox.socketPath, modCommandEnvelope(id, kind, data, link.linkId), { msgId: id });
  if (!written.ok) return fail("transient", `the command could not be written to session ${sessionId}'s inbox: ${written.error}`);

  const deadline = deps.now() + MOD_COMMAND_ACK_MS;
  for (;;) {
    if (deps.links.takeAck(id, sessionId)) return { ok: true, data: { acked: true } };
    if (deps.now() >= deadline) return { ok: true, data: { acked: false } };
    await deps.sleep(ACK_POLL_MS);
  }
}
