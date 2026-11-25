/**
 * lib/daemon/handlers/support.ts: the support:* commands behind the board's
 * and the app's help request, and the host's own controls. `support:send`,
 * `support:accept` and `support:stop` are a person's alone: no CLI verb and no
 * MCP tool calls them.
 */

import type { Database } from "bun:sqlite";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import {
  SUPPORT_AWAY_MS,
  SUPPORT_MACHINE_HOLD_MS,
  SUPPORT_PARTS_MAX,
  SUPPORT_PART_MAX,
  SUPPORT_TEXT_MAX,
  SUPPORT_TTL_MS,
  supportBodyTooLarge,
  type SupportMissing,
  type SupportPart,
  type SupportHostState,
  type SupportRequest,
  type SupportSent,
  type SupportState,
} from "../../../packages/rt-client/src/support.ts";
import { UserActionableError } from "../../errors.ts";
import { deleteKvValue, getKvValue, listKvValues, setKvValueCritical } from "../../state/kv-blob.ts";
import { getRequest, insertRequest, listRequests, moveRequest } from "../../state/support-store.ts";
import { createChain } from "../../support/chain.ts";
import type { SupportConfig } from "../../support/config.ts";
import { NO_SUPPORT_KEY, type SupportKeys } from "../../support/org-key.ts";
import { SUPPORT_MAX_OPEN } from "../../support/host.ts";
import { supportBinding } from "../../support/proof.ts";
import type { SupportRelay, SupportSend } from "../../support/relay.ts";
import { signDraft, type RequestBody } from "../../support/sync.ts";
import { canonicalHandle } from "../../team/board-peers.ts";
import type { SealedText } from "../../team/sealed-text.ts";
import type { CommandResult, HandlerContext } from "./types.ts";

const SUPPORT_COMMANDS = ["support:availability", "support:context", "support:send", "support:mine", "support:host", "support:accept", "support:enable", "support:stop"] as const;

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const LABEL_MAX = 100;
const MR_STATE_MAX = 100;
const SHOWN = 20;
const PART_KEYS: readonly string[] = ["versions", "setup", "mr"] satisfies SupportPart["key"][];
const OPEN: readonly SupportState[] = ["sent", "received", "opening", "waiting"];

export interface SupportHandlerDeps {
  db: Database;
  log: HandlerContext["log"];
  now(): number;
  config(): SupportConfig | null;
  keys(): Promise<SupportKeys | null>;
  /** The org has no support key at all, which nothing on this Mac can mend. */
  keyMissing(): boolean;
  sealedText: SealedText;
  /** Null with no board token. */
  relay(): Promise<SupportRelay | null>;
  /** This Mac's own Slack user, null with no connection; throws when Slack does not answer. */
  slackUserId(): Promise<string | null>;
  readiness(): Promise<SupportMissing[]>;
  /** Whether this person may change the org's own switch. */
  mayChange(): boolean;
  openChats(): number;
  persona(): string;
  /** Repos with a folder on this Mac, as `host/path`. */
  repos(): string[];
  setAccepting(on: boolean): void;
  /** The relay now holds this accepting flag. */
  published(on: boolean): void;
  /** Reads the queue of a Mac that just stopped accepting, and answers it. */
  drain(): Promise<void>;
  /** Something the relay loops wait for has changed. */
  poke(): void;
  /** The org's own switch, for its admins: throws a UserActionableError when it refuses. */
  enable(host?: string): Promise<{ host: string }>;
  disable(): { host: string | null };
  stop(conversation: number): Promise<{ ok: true; told: boolean } | { ok: false; reason: string }>;
  /** The relay holds this Mac as the accepting one, as far as this Mac knows. */
  holdsRole(): boolean;
  versions(): Promise<{ rt: string; app: string | null; macos: string | null }>;
  /** Null when the setup status could not be read. */
  unreadySetupRows(): Promise<string[] | null>;
}

function refuse(code: string, message: string): { ok: false; error: string; failure: { code: string; message: string } } {
  return { ok: false, error: `support: ${message}`, failure: { code: `support-${code}`, message } };
}

/** A refusal's words as one line for a screen that shows no callouts. */
function plainly(err: UserActionableError): string {
  return [err.message, err.why?.replace(/\.$/, ""), err.next && `Run ${err.next}`].filter(Boolean).map((s) => `${s}.`).join(" ");
}

function oneLine(text: string, max: number): string {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, " ").trim().slice(0, max);
}

/** The MR's plain address: a query or a fragment can carry a token. */
function mrAddress(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 1000) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return null;
  return `${parsed.origin}${parsed.pathname}`;
}

function parseParts(v: unknown): SupportPart[] | null {
  if (!Array.isArray(v) || v.length > SUPPORT_PARTS_MAX) return null;
  const parts: SupportPart[] = [];
  for (const p of v as unknown[]) {
    const { key, label, value } = (p ?? {}) as Record<string, unknown>;
    if (typeof key !== "string" || !PART_KEYS.includes(key)) return null;
    if (typeof label !== "string" || label.length > LABEL_MAX) return null;
    if (typeof value !== "string" || value.length > SUPPORT_PART_MAX) return null;
    parts.push({ key: key as SupportPart["key"], label, value });
  }
  return parts;
}

const SEND_REFUSALS: Record<Exclude<SupportSend, "ok" | "changed">, (host: string) => [code: string, message: string]> = {
  unreachable: () => ["unreachable", "The relay did not answer, so nothing was sent. Try again."],
  unauthorized: () => ["unauthorized", "Your board's connection no longer works. Ask an org admin for a new invite."],
  "unknown-recipient": (host) => ["unknown-recipient", `${host}'s board is not connected, so message them directly.`],
  full: (host) => ["full", `${host} has too many requests from you waiting. Message them directly.`],
  rejected: () => ["rejected", "The relay would not take this request. Update mattstack, then try again."],
};

const CHANGED: [code: string, message: string] = ["changed", "Your first version of this was already sent, so that is the one they will read."];

function nameOf(cfg: SupportConfig | null, username: string): string {
  return cfg?.roster.find((e) => canonicalHandle(e.username) === canonicalHandle(username))?.name ?? username;
}

const hostName = (cfg: SupportConfig): string => nameOf(cfg, cfg.host ?? "");

/** A sealed body is different each time and the relay refuses a second one under an id, so the first is kept until the relay answers. */
const SEALED_NS = "support-sealed";

interface KeptBody {
  from: string;
  to: string;
  text: string;
  parts: SupportPart[];
  slackUserId: string;
  body: string;
  at: number;
}

function dropOldBodies(db: Database, now: number): void {
  for (const [id, kept] of Object.entries(listKvValues<KeptBody>(SEALED_NS, db))) {
    if (now - kept.at >= SUPPORT_TTL_MS) deleteKvValue(SEALED_NS, id, db);
  }
}

/** A request the host never finished with stops counting once the relay has forgotten it. Returns the ones that just expired. */
export function expireSent(db: Database, now: number): SupportRequest[] {
  dropOldBodies(db, now);
  return listRequests("out", OPEN, db).filter((r) => now - r.sentAt >= SUPPORT_TTL_MS && moveRequest(r, OPEN, { state: "expired" }, now, db));
}

export function createSupportHandlers(deps: SupportHandlerDeps): { [K in (typeof SUPPORT_COMMANDS)[number]]: (payload: unknown) => Promise<CommandResult<K>> } {
  const { db } = deps;
  const sending = createChain();
  /** Two at once would each find no key and make one. */
  const enabling = createChain();
  const noKey = () => (deps.keyMissing() ? NO_SUPPORT_KEY : "This Mac cannot open the org's secrets");

  const cannotReceive = (cfg: SupportConfig) => `${hostName(cfg)} can't receive requests yet`;

  async function sealBody(me: string, id: string, to: string, text: string, parts: SupportPart[], slackUserId: string): Promise<{ body: string } | { refused: "no-recipients" | "unavailable" }> {
    const kept = getKvValue<KeptBody | null>(SEALED_NS, id, null, db);
    const what = JSON.stringify([me, to, text, parts, slackUserId]);
    if (kept && JSON.stringify([kept.from, kept.to, kept.text, kept.parts, kept.slackUserId]) === what) return { body: kept.body };
    const inner = JSON.stringify({ text, parts, slackUserId } satisfies RequestBody);
    const result = await deps.sealedText.seal([to], supportBinding("request", id, me), { body: inner });
    if (!result.ok) return { refused: result.reason };
    const body = JSON.stringify({ sealed: result.sealed });
    const keep = { from: me, to, text, parts, slackUserId, body, at: deps.now() } satisfies KeptBody;
    if (!supportBodyTooLarge(body) && !setKvValueCritical(SEALED_NS, id, keep, db)) return { refused: "unavailable" };
    return { body };
  }

  async function send(id: string, text: string, parts: SupportPart[]): Promise<CommandResult<"support:send">> {
    const cfg = deps.config();
    if (!cfg?.enabled || cfg.host === null) return refuse("off", "Your org has no one answering support requests.");
    if (cfg.isHost) return refuse("host", "You answer your org's support requests.");
    if (cfg.me === null) return refuse("no-username", "Connect your forge account first.");
    const to = canonicalHandle(cfg.host);

    const already = getRequest("out", to, id, db);
    if (already) {
      const same = already.text === text && JSON.stringify(already.parts) === JSON.stringify(parts);
      return same ? { ok: true, data: { request: asSent(already) } } : refuse(...CHANGED);
    }
    expireSent(db, deps.now());
    if (listRequests("out", OPEN, db).some((r) => r.peer === to && r.org === cfg.orgRemote)) return refuse("already-waiting", "You already have a request waiting.");

    const relay = await deps.relay();
    if (!relay) return refuse("no-board", "Connect your board first.");
    const keys = await deps.keys();
    if (!keys) return refuse("no-key", `${noKey()}.`);
    // Null says nothing: a revoked token reads that way too, and the send below names the fix.
    const host = await relay.host(cfg.host);
    if (host?.accepting === false) return refuse("not-accepting", `${hostName(cfg)} is not taking requests now. Message them directly.`);
    let slackUserId: string | null;
    try {
      slackUserId = await deps.slackUserId();
    } catch (err) {
      deps.log.warn({ err }, "support: the sender's Slack account could not be read");
      return refuse("slack", "Slack did not answer, so nothing was sent. Try again.");
    }
    if (!slackUserId) return refuse("no-slack", "Connect Slack first.");

    const sealed = await sealBody(cfg.me, id, to, text, parts, slackUserId);
    if ("refused" in sealed) {
      return sealed.refused === "no-recipients"
        ? refuse("no-host-key", `${cannotReceive(cfg)}.`)
        : refuse("not-sealed", "This Mac could not lock your request, so nothing was sent. Try again.");
    }
    const { body } = sealed;
    if (supportBodyTooLarge(body)) return refuse("too-long", "That is too long to send. Shorten it, or remove something attached.");
    const sentAt = deps.now();
    const result = await relay.send(signDraft(cfg, keys, { id, to, kind: "request", body }, sentAt));
    if (result !== "ok" && result !== "changed") return refuse(...SEND_REFUSALS[result](hostName(cfg)));

    const request = {
      id, direction: "out" as const, peer: to, org: cfg.orgRemote, text, parts, slackUserId, state: "sent" as const,
      reason: null, persona: null, dmLink: null, conversationId: null, gateId: null, statusAt: 0, sentAt, receivedAt: sentAt,
    };
    insertRequest(request, db);
    deleteKvValue(SEALED_NS, id, db);
    deps.poke();
    if (result === "changed") return refuse(...CHANGED);
    return { ok: true, data: { request: asSent({ ...request, updatedAt: sentAt }) } };
  }

  const asSent = (r: SupportRequest): SupportSent => ({
    ...r,
    away: r.state === "sent" && deps.now() - r.sentAt > SUPPORT_AWAY_MS,
    host: nameOf(deps.config(), r.peer),
  });

  /** A Mac that went silent keeps its flag on the relay, and no longer stops another from taking over. */
  const heldElsewhere = (relay: SupportHostState | null): boolean =>
    relay?.accepting === true && relay.lastSeenAt !== null && deps.now() - relay.lastSeenAt < SUPPORT_MACHINE_HOLD_MS;

  return {
    "support:availability": async (): Promise<CommandResult<"support:availability">> => {
      const hidden = { ok: true as const, data: { state: "hidden" as const } };
      const cfg = deps.config();
      if (!cfg?.enabled || cfg.host === null || cfg.isHost) return hidden;
      const host = hostName(cfg);
      const disabled = (reason: string) => ({ ok: true as const, data: { state: "disabled" as const, reason, host, persona: deps.persona() } });
      if (cfg.me === null) return disabled("Connect your forge account first");
      const relay = await deps.relay();
      if (!relay) return disabled("Connect your board first");
      const status = await relay.host(cfg.host);
      if (!status?.accepting) return hidden;
      if (!deps.sealedText.reachable().includes(canonicalHandle(cfg.host))) return disabled(cannotReceive(cfg));
      const slack = await deps.slackUserId().catch(() => "unknown");
      if (slack === null) return disabled("Connect Slack first");
      if (!(await deps.keys())) return disabled(noKey());
      const away = status.lastSeenAt === null || deps.now() - status.lastSeenAt > SUPPORT_AWAY_MS;
      return { ok: true, data: { state: "ready", host, away, persona: deps.persona() } };
    },

    "support:context": async (rawPayload: unknown): Promise<CommandResult<"support:context">> => {
      const { mr, board, app } = (rawPayload ?? {}) as Partial<Commands["support:context"]["payload"]>;
      const parts: SupportPart[] = [];
      let address: string | null = null;
      if (mr !== undefined) {
        address = mrAddress(mr?.url);
        if (address === null || typeof mr.state !== "string") return refuse("mr", "That is not an MR's https address.");
      }
      const v = await deps.versions();
      const given = (value: unknown) => (typeof value === "string" ? oneLine(value, MR_STATE_MAX) : "");
      const versions = [
        ["rt", v.rt],
        ["app", given(app) || v.app],
        ["board", given(board)],
        ["macOS", v.macos],
      ].filter((pair): pair is [string, string] => Boolean(pair[1]));
      parts.push({ key: "versions", label: "Versions", value: versions.map(([name, value]) => `${name} ${value}`).join(", ").slice(0, SUPPORT_PART_MAX) });
      const rows = await deps.unreadySetupRows();
      if (rows && rows.length > 0) parts.push({ key: "setup", label: "Setup rows that need attention", value: rows.join(", ").slice(0, SUPPORT_PART_MAX) });
      if (mr !== undefined && address !== null) {
        const state = oneLine(mr.state, MR_STATE_MAX);
        parts.push({ key: "mr", label: "MR", value: state ? `${address} (${state})` : address });
      }
      return { ok: true, data: { parts } };
    },

    "support:send": async (rawPayload: unknown): Promise<CommandResult<"support:send">> => {
      const p = (rawPayload ?? {}) as Partial<Commands["support:send"]["payload"]>;
      if (typeof p.id !== "string" || !REQUEST_ID.test(p.id)) return refuse("id", "A request needs an id.");
      if (typeof p.text !== "string" || !p.text.trim() || p.text.length > SUPPORT_TEXT_MAX) return refuse("text", `Say what you need help with, in up to ${SUPPORT_TEXT_MAX} characters.`);
      const parts = parseParts(p.parts);
      if (!parts) return refuse("parts", "Something attached to the request is not allowed.");
      const { id, text } = p;
      return sending.run(() => send(id, text, parts));
    },

    "support:mine": async (): Promise<CommandResult<"support:mine">> => {
      expireSent(db, deps.now());
      const requests = listRequests("out", undefined, db)
        .reverse()
        .slice(0, SHOWN)
        .map(asSent);
      return { ok: true, data: { requests } };
    },

    "support:host": async (): Promise<CommandResult<"support:host">> => {
      const cfg = deps.config();
      const isHost = cfg?.isHost === true;
      const admin = cfg !== null && deps.mayChange();
      const relay = isHost || admin ? await deps.relay() : null;
      const onRelay = cfg?.host ? ((await relay?.host(cfg.host)) ?? null) : null;
      const accepting = isHost && cfg.acceptHere && deps.holdsRole();
      const needs = isHost ? await deps.readiness() : [];
      return {
        ok: true,
        data: {
          isHost,
          enabled: cfg?.enabled === true,
          accepting,
          missing: needs.map((m) => m.text),
          needs,
          otherMac: isHost && !deps.holdsRole() && heldElsewhere(onRelay),
          open: isHost ? deps.openChats() : 0,
          cap: SUPPORT_MAX_OPEN,
          waiting: isHost ? listRequests("in", ["waiting"], db).length : 0,
          persona: deps.persona(),
          repos: needs.some((m) => m.fix === "repo") ? deps.repos() : [],
          org: admin ? { host: cfg.host, hasKey: !deps.keyMissing(), people: cfg.roster, answering: onRelay && onRelay.accepting } : null,
        },
      };
    },

    "support:accept": async (rawPayload: unknown): Promise<CommandResult<"support:accept">> => {
      const on = (rawPayload as Partial<Commands["support:accept"]["payload"]> | null)?.on;
      if (typeof on !== "boolean") return refuse("accept", "Say whether to accept requests.");
      const relay = await deps.relay();

      if (!on) {
        const result = relay ? await relay.setHost(false) : "failed";
        if (result !== "failed") deps.published(false);
        deps.setAccepting(false);
        await deps.drain();
        return { ok: true, data: { accepting: false } };
      }

      const cfg = deps.config();
      if (!cfg?.enabled || !cfg.isHost) return refuse("not-host", "Only your org's support host can accept requests.");
      const missing = await deps.readiness();
      if (missing.length > 0) return refuse("not-ready", missing.map((m) => `${m.text}.`).join(" "));
      const result = relay ? await relay.setHost(true) : "failed";
      if (result === "other-machine") return refuse("other-machine", "Another of your Macs is already accepting. Turn it off there first.");
      if (result === "failed") return refuse("relay", "The relay did not answer, so nothing changed. Try again.");
      deps.published(true);
      deps.setAccepting(true);
      deps.poke();
      return { ok: true, data: { accepting: true } };
    },

    "support:enable": async (rawPayload: unknown): Promise<CommandResult<"support:enable">> => {
      const { on, host } = (rawPayload ?? {}) as Partial<Commands["support:enable"]["payload"]>;
      if (typeof on !== "boolean") return refuse("enable", "Say whether to turn support on.");
      if (host !== undefined && (typeof host !== "string" || !host.trim())) return refuse("enable", "Say who answers support requests.");
      try {
        const changed = await enabling.run(async () => (on ? deps.enable(host?.trim()) : deps.disable()));
        deps.poke();
        return { ok: true, data: { enabled: on, host: changed.host } };
      } catch (err) {
        if (err instanceof UserActionableError) {
          if (err.log) deps.log.warn({ code: err.code, detail: err.log }, "support: the org's support switch was refused");
          return refuse(err.code, plainly(err));
        }
        deps.log.warn({ err }, "support: the org's support switch could not be changed");
        return refuse("enable", `Support could not be turned ${on ? "on" : "off"}, and rt's log says why.`);
      }
    },

    "support:stop": async (rawPayload: unknown): Promise<CommandResult<"support:stop">> => {
      const conversation = (rawPayload as Partial<Commands["support:stop"]["payload"]> | null)?.conversation;
      if (typeof conversation !== "number" || !Number.isInteger(conversation) || conversation <= 0) return refuse("stop", "Say which chat to stop.");
      const stopped = await deps.stop(conversation);
      return stopped.ok ? { ok: true, data: { told: stopped.told } } : refuse("stop", stopped.reason);
    },
  };
}
