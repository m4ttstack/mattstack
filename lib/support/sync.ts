/**
 * Moves support messages between the relay and this Mac's state db: requests
 * in on the host's Mac, statuses in on the sender's, statuses out from the
 * host's. Nothing is acked before it is stored.
 */
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import {
  SUPPORT_PARTS_MAX,
  SUPPORT_PART_MAX,
  SUPPORT_TEXT_MAX,
  SUPPORT_TTL_MS,
  type SupportDraft,
  type SupportKind,
  type SupportMessage,
} from "../../packages/rt-client/src/support.ts";
import {
  dropStatus,
  getRequest,
  insertRequest,
  listRequests,
  moveRequest,
  pendingStatuses,
  queueStatus,
  type SupportPart,
  type SupportRequest,
  type SupportState,
} from "../state/support-store.ts";
import { canonicalHandle } from "../team/board-peers.ts";
import type { SealedText } from "../team/sealed-text.ts";
import { createChain } from "./chain.ts";
import { onRoster, type SupportConfig } from "./config.ts";
import { usableKeys, type SupportKeys } from "./org-key.ts";
import { supportBinding, supportMac, verifySupportMac } from "./proof.ts";
import type { SupportRelay } from "./relay.ts";

/** The parts of a status that leave sealed. */
const STATUS_TEXTS = ["reason", "persona", "dmLink"] as const;

/** A status as it waits in this Mac's own database. */
export interface StatusBody {
  requestId: string;
  state: SupportState;
  /** When the host moved the request, always later than the status before it. */
  at: number;
  reason?: string;
  dmLink?: string;
  /** The name the host's bot signs with. */
  persona?: string;
}

/** A request before it is sealed. */
export interface RequestBody {
  text: string;
  parts: SupportPart[];
  slackUserId: string;
}

export interface SyncDeps {
  db: Database;
  relay(): Promise<SupportRelay | null>;
  config(): SupportConfig | null;
  keys(): Promise<SupportKeys | null>;
  sealedText: SealedText;
  onRequest(r: SupportRequest): void;
  onStatus(r: SupportRequest): void;
  now(): number;
  log: Pick<Logger, "info" | "warn" | "debug">;
}

export interface SupportSync {
  /** `drain` reads the queue of a Mac that has just stopped accepting, so what is in it can be answered. True when the queue was read and left empty. */
  pull(kind: SupportKind, opts?: { drain?: boolean }): Promise<boolean>;
  flush(): Promise<void>;
}

/** How long this Mac must be awake and seeing a message it cannot prove before dropping it: its copy of the org may not have pulled a new key or a new member yet. */
export const PROOF_SETTLE_MS = 60 * 60_000;
/** The same wait for a message that proves nothing: a new member can arrive with a new key, but a stranger's must not fill the queue for long. */
export const STRANGER_SETTLE_MS = 20 * 60_000;
/** How far a sender's clock may be off before its message reads as too old, or from the future. */
const CLOCK_SLACK_MS = 24 * 60 * 60_000;
const PAGE = 100;
const MAX_PAGES = 20;
const REASON_MAX = 500;
const PERSONA_MAX = 60;
const UNREADABLE = "the host's mattstack could not read your request";
const UNPROVED_MAX = 1000;
/** The most one sighting counts for: a longer gap since the last one is time asleep. */
const SIGHTING_MS = 60_000;

const PART_KEYS: readonly string[] = ["versions", "setup", "mr"] satisfies SupportPart["key"][];
/** The states a host may report; `sent` and `opening` never leave the Mac they are kept on. */
const HOST_STATES: readonly string[] = [
  "received",
  "opened",
  "waiting",
  "already-waiting",
  "already-open",
  "declined",
  "not-accepting",
  "failed",
  "expired",
] satisfies SupportState[];
const SENDER_OPEN: readonly SupportState[] = ["sent", "received", "waiting"];

export function signDraft(
  cfg: Pick<SupportConfig, "me">,
  keys: SupportKeys,
  m: { id: string; to: string; kind: SupportKind; body: string },
  now: number,
): SupportDraft {
  if (cfg.me === null) throw new Error("support: this Mac does not know its own username");
  const to = canonicalHandle(m.to);
  const mac = supportMac(keys.current, { ...m, to, from: cfg.me, sentAt: now });
  return { id: m.id, to, kind: m.kind, sentAt: now, body: m.body, mac };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseRequestBody(text: string): RequestBody | null {
  const v = parseJson(text);
  if (!v || typeof v.text !== "string" || !v.text.trim() || v.text.length > SUPPORT_TEXT_MAX) return null;
  if (typeof v.slackUserId !== "string") return null;
  if (!Array.isArray(v.parts) || v.parts.length > SUPPORT_PARTS_MAX) return null;
  const parts: SupportPart[] = [];
  for (const p of v.parts as unknown[]) {
    const { key, label, value } = (p ?? {}) as Record<string, unknown>;
    if (typeof key !== "string" || typeof label !== "string" || typeof value !== "string") return null;
    if (label.length > SUPPORT_PART_MAX || value.length > SUPPORT_PART_MAX) return null;
    if (PART_KEYS.includes(key)) parts.push({ key: key as SupportPart["key"], label, value });
  }
  return { text: v.text, parts, slackUserId: v.slackUserId };
}

function sealedOf(v: Record<string, unknown> | null): string | null {
  return typeof v?.sealed === "string" ? v.sealed : null;
}

type StatusTexts = Pick<StatusBody, (typeof STATUS_TEXTS)[number]>;

function parseStatusTexts(v: Record<string, unknown>): StatusTexts {
  return {
    ...(typeof v.reason === "string" ? { reason: v.reason.slice(0, REASON_MAX) } : {}),
    ...(typeof v.persona === "string" && v.persona.trim() ? { persona: v.persona.replace(/\s+/g, " ").trim().slice(0, PERSONA_MAX) } : {}),
    ...(typeof v.dmLink === "string" && v.dmLink.startsWith("slack://") ? { dmLink: v.dmLink } : {}),
  };
}

function parseStatusFacts(v: Record<string, unknown> | null): Omit<StatusBody, keyof StatusTexts> | null {
  if (!v || typeof v.requestId !== "string" || typeof v.state !== "string" || !HOST_STATES.includes(v.state)) return null;
  if (typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
  return { requestId: v.requestId, state: v.state as SupportState, at: v.at };
}

export function createSupportSync(deps: SyncDeps): SupportSync {
  const { db, log } = deps;
  const unproved = new Map<string, { lastSeen: number; waited: number }>();
  const flushing = createChain();
  let nextFlush: Promise<void> | null = null;

  /** Whether the message may be believed: `wait` leaves it on the relay for now. */
  function judge(m: SupportMessage, cfg: SupportConfig, keys: string[]): "proved" | "wait" | "drop" {
    const named = onRoster(cfg, m.from);
    const signed = verifySupportMac(keys, { ...m, to: cfg.me ?? "" }, m.mac);
    const key = `${m.from} ${m.id}`;
    const now = deps.now();
    if (named && signed) {
      unproved.delete(key);
      const age = now - m.sentAt;
      if (age <= SUPPORT_TTL_MS + CLOCK_SLACK_MS && age >= -CLOCK_SLACK_MS) return "proved";
      log.warn({ from: m.from, id: m.id, kind: m.kind, age }, "support: a message signed too long ago, or ahead of time, was dropped");
      return "drop";
    }
    const seen = unproved.get(key);
    const waited = seen ? seen.waited + Math.max(0, Math.min(now - seen.lastSeen, SIGHTING_MS)) : 0;
    const about = { from: m.from, id: m.id, kind: m.kind, named, signed };
    if (waited < (named || signed ? PROOF_SETTLE_MS : STRANGER_SETTLE_MS)) {
      if (!seen) log.warn(about, "support: a message is not proved to come from the org yet");
      if (!seen && unproved.size >= UNPROVED_MAX) unproved.clear();
      unproved.set(key, { lastSeen: now, waited });
      return "wait";
    }
    unproved.delete(key);
    log.warn(about, "support: a message that is not proved to come from the org was dropped");
    return "drop";
  }

  /** The request, `unreadable` when no Mac ever will read it, or `wait` when this one cannot yet: the key is locked, or is on the person's other Mac. */
  async function openRequest(m: SupportMessage): Promise<RequestBody | "unreadable" | "wait"> {
    const sealed = sealedOf(parseJson(m.body));
    if (sealed === null) return "unreadable";
    const opened = await deps.sealedText.open(sealed, supportBinding("request", m.id, m.from));
    if (opened.ok) return parseRequestBody(opened.fields.body ?? "") ?? "unreadable";
    if (opened.reason === "mismatch" || opened.reason === "damaged") return "unreadable";
    log.debug({ from: m.from, id: m.id, reason: opened.reason }, "support: a request cannot be opened on this Mac yet");
    return "wait";
  }

  /** True when the message may be acked. */
  async function takeRequest(m: SupportMessage, cfg: SupportConfig, arrived: SupportRequest[]): Promise<boolean> {
    if (getRequest("in", m.from, m.id, db)) return true;
    const body = await openRequest(m);
    if (body === "wait") return false;
    if (body === "unreadable") {
      log.warn({ from: m.from, id: m.id }, "support: a request could not be read");
      const status: StatusBody = { requestId: m.id, state: "failed", at: deps.now(), reason: UNREADABLE };
      queueStatus({ id: `${m.id}:failed`, to: m.from, body: JSON.stringify(status) }, deps.now(), db);
      return true;
    }
    const request = {
      id: m.id,
      direction: "in" as const,
      peer: m.from,
      org: cfg.orgRemote,
      ...body,
      state: "received" as const,
      reason: null,
      persona: null,
      dmLink: null,
      conversationId: null,
      gateId: null,
      statusAt: 0,
      sentAt: m.sentAt,
      receivedAt: m.receivedAt,
    };
    if (insertRequest(request, db)) arrived.push({ ...request, updatedAt: m.receivedAt });
    return true;
  }

  async function openStatusTexts(m: SupportMessage, wire: Record<string, unknown> | null): Promise<StatusTexts> {
    const sealed = sealedOf(wire);
    if (sealed === null) return {};
    const opened = await deps.sealedText.open(sealed, supportBinding("status", m.id, m.from));
    if (opened.ok) return parseStatusTexts(opened.fields);
    log.warn({ from: m.from, id: m.id, reason: opened.reason }, "support: a status's text could not be opened");
    return {};
  }

  async function takeStatus(m: SupportMessage): Promise<boolean> {
    const wire = parseJson(m.body);
    const facts = parseStatusFacts(wire);
    if (!facts) {
      log.warn({ from: m.from, id: m.id }, "support: a status could not be read");
      return true;
    }
    const row = getRequest("out", m.from, facts.requestId, db);
    // The person's other Mac may be the one that asked.
    if (!row) return listRequests("out", undefined, db).some((r) => r.id === facts.requestId);
    if (facts.at <= row.statusAt) return true;
    const body: StatusBody = { ...facts, ...(await openStatusTexts(m, wire)) };
    const patch = { state: body.state, reason: body.reason ?? null, dmLink: body.dmLink ?? null, statusAt: body.at, ...(body.persona !== undefined ? { persona: body.persona } : {}) };
    if (moveRequest(row, SENDER_OPEN, patch, deps.now(), db)) {
      deps.onStatus(getRequest("out", m.from, body.requestId, db)!);
    }
    return true;
  }

  async function pullPage(kind: SupportKind, relay: SupportRelay, cfg: SupportConfig, keys: string[]): Promise<"empty" | "more" | "left"> {
    const messages = await relay.list(kind);
    if (!messages) return "left";
    const acks: { from: string; id: string }[] = [];
    // Handed over once the page is read: opening takes a moment each, and every hand-over starts a pass.
    const arrived: SupportRequest[] = [];
    for (const m of messages) {
      try {
        const verdict = judge(m, cfg, keys);
        if (verdict === "wait") continue;
        if (verdict === "drop" || (await (kind === "request" ? takeRequest(m, cfg, arrived) : takeStatus(m)))) acks.push({ from: m.from, id: m.id });
      } catch (err) {
        log.warn({ err, from: m.from, id: m.id }, "support: a message could not be taken");
        if (kind === "request" && stored(m)) acks.push({ from: m.from, id: m.id });
      }
    }
    for (const r of arrived) {
      try {
        deps.onRequest(r);
      } catch (err) {
        log.warn({ err, from: r.peer, id: r.id }, "support: a request could not be handed over");
      }
    }
    if (messages.length === 0) return "empty";
    const acked = acks.length > 0 && (await relay.ack(acks));
    if (acked && messages.length >= PAGE) return "more";
    return acked && acks.length === messages.length ? "empty" : "left";
  }

  function stored(m: SupportMessage): boolean {
    try {
      return getRequest("in", m.from, m.id, db) !== null;
    } catch {
      return false;
    }
  }

  return {
    async pull(kind, opts = {}) {
      const cfg = deps.config();
      // A store that cannot be read gives an empty roster, which would make a stranger of everyone.
      if (!cfg || cfg.me === null || cfg.roster.length === 0) return false;
      if (kind === "request" && !cfg.accepts && !opts.drain) return false;
      const keys = await deps.keys();
      if (!keys) return false;
      const relay = await deps.relay();
      if (!relay) return false;
      const usable = usableKeys(keys, deps.now());
      for (let page = 0; page < MAX_PAGES; page++) {
        const left = await pullPage(kind, relay, cfg, usable);
        if (left !== "more") return left === "empty";
      }
      return false;
    },

    flush() {
      nextFlush ??= flushing.run(async () => {
        nextFlush = null;
        await flushNow();
      });
      return nextFlush;
    },
  };

  async function statusOnTheWire(me: string, s: { id: string; to: string; body: string }): Promise<string> {
    const stored = parseJson(s.body) ?? {};
    const { requestId, state, at } = stored;
    const texts = Object.fromEntries(STATUS_TEXTS.flatMap((key) => (typeof stored[key] === "string" ? [[key, stored[key] as string]] : [])));
    if (Object.keys(texts).length === 0) return JSON.stringify({ requestId, state, at });
    const result = await deps.sealedText.seal([s.to], supportBinding("status", s.id, me), texts);
    if (!result.ok) log.warn({ to: s.to, id: s.id, reason: result.reason }, "support: a status went out without its text");
    return JSON.stringify({ requestId, state, at, sealed: result.ok ? result.sealed : undefined });
  }

  async function flushNow(): Promise<void> {
    if (pendingStatuses(db).length === 0) return;
    const cfg = deps.config();
    if (!cfg || cfg.me === null) return;
    const keys = await deps.keys();
    if (!keys) return;
    const relay = await deps.relay();
    if (!relay) return;
    const full = new Set<string>();
    for (const s of pendingStatuses(db)) {
      if (full.has(s.to)) continue;
      if (deps.now() - s.createdAt >= SUPPORT_TTL_MS) {
        dropStatus(s.id, s.to, db);
        continue;
      }
      const body = await statusOnTheWire(cfg.me, s);
      const result = await relay.send(signDraft(cfg, keys, { id: s.id, to: s.to, kind: "status", body }, deps.now()));
      if (result === "unreachable" || result === "unauthorized") return;
      if (result === "full") {
        full.add(s.to);
        continue;
      }
      // Sealed afresh each time, so a retry after a lost answer reads as changed: the relay has the first one.
      if (result !== "ok" && result !== "changed") log.warn({ to: s.to, id: s.id, result }, "support: a status was not taken");
      dropStatus(s.id, s.to, db);
    }
  }
}
