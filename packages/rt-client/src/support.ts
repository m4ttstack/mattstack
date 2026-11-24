/** The support queue's wire. The relay image copies only
 *  `apps/board/switchboard/*.ts`, so `switchboard/support.ts` redeclares the
 *  draft and its limits; its tests hold the two together. */

export type SupportKind = "request" | "status";

export interface SupportDraft {
  id: string;
  to: string;
  kind: SupportKind;
  sentAt: number;
  body: string;
  mac: string;
}

export interface SupportMessage extends SupportDraft {
  from: string;
  receivedAt: number;
}

export interface SupportHostState {
  accepting: boolean;
  lastSeenAt: number | null;
}

export const SUPPORT_BODY_MAX_BYTES = 64 * 1024;
export const SUPPORT_TTL_MS = 7 * 24 * 60 * 60_000;
export const SUPPORT_TEXT_MAX = 8000;
export const SUPPORT_PART_MAX = 2000;
export const SUPPORT_PARTS_MAX = 12;
export const SUPPORT_AWAY_MS = 2 * 60_000;

const ID_MAX = 200;
const MAC_MAX = 256;

function canonical(username: string): string {
  return username.trim().toLowerCase();
}

export function parseSupportDraft(v: unknown): SupportDraft | null {
  if (!v || typeof v !== "object") return null;
  const { id, to, kind, sentAt, body, mac } = v as Record<string, unknown>;
  if (typeof id !== "string" || !id || id.length > ID_MAX) return null;
  if (typeof to !== "string" || !to.trim() || to.trim() === "*") return null;
  if (kind !== "request" && kind !== "status") return null;
  if (typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
  if (typeof body !== "string") return null;
  if (typeof mac !== "string" || !mac || mac.length > MAC_MAX) return null;
  return { id, to: canonical(to), kind, sentAt, body, mac };
}

export function parseSupportMessage(v: unknown): SupportMessage | null {
  const draft = parseSupportDraft(v);
  if (!draft) return null;
  const { from, receivedAt } = v as Record<string, unknown>;
  if (typeof from !== "string" || !from.trim()) return null;
  if (typeof receivedAt !== "number" || !Number.isFinite(receivedAt)) return null;
  return { ...draft, from: canonical(from), receivedAt };
}
