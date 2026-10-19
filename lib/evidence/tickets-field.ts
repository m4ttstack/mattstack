/**
 * The evidence-tickets run field: every saved ticket image evidence_record
 * has copied into the run, by its run-folder path and bytes. Written on every
 * call that sees one, written:false included, and never shrunk, so a ticket
 * image stays one when a later call leaves out source, removes its slot, or
 * never writes the record at all.
 */
import type { EvidenceShot } from "../../packages/rt-client/src/evidence.ts";

export const TICKETS_FIELD = "evidence-tickets";

export type TicketEntry = { path: string; size: number; sha256: string };

const SHA256 = /^[0-9a-f]{64}$/;

function isEntry(v: unknown): v is TicketEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.path === "string" && e.path !== "" && Number.isSafeInteger(e.size) && (e.size as number) >= 0 && typeof e.sha256 === "string" && SHA256.test(e.sha256);
}

export function parseTickets(value: string | null): TicketEntry[] {
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value) as { v?: unknown; tickets?: unknown };
    if (parsed?.v !== 1 || !Array.isArray(parsed.tickets)) return [];
    return parsed.tickets.filter(isEntry).map(({ path, size, sha256 }) => ({ path, size, sha256 }));
  } catch {
    return [];
  }
}

/**
 * The field is the only durable mark once a record has dropped one, so a
 * write must parse whole and keep every entry already stored: a cleared or
 * shrunk value would let a byte copy upload.
 */
export function ticketsWriteProblem(stored: string | null, next: string): string | null {
  let parsed: { v?: unknown; tickets?: unknown };
  try {
    parsed = JSON.parse(next) as typeof parsed;
  } catch {
    return `${TICKETS_FIELD} must be {"v":1,"tickets":[...]}`;
  }
  if (parsed?.v !== 1 || !Array.isArray(parsed.tickets)) return `${TICKETS_FIELD} must be {"v":1,"tickets":[...]}`;
  if (!parsed.tickets.every(isEntry)) return `${TICKETS_FIELD} entries each need a path, a whole size and a 64-hex sha256`;
  const keys = new Set((parsed.tickets as TicketEntry[]).map((t) => `${t.path}\0${t.sha256}`));
  const dropped = parseTickets(stored).filter((t) => !keys.has(`${t.path}\0${t.sha256}`));
  return dropped.length ? `${TICKETS_FIELD} never shrinks: the write drops ${dropped.length} remembered ticket image(s)` : null;
}

export function serializeTickets(tickets: TicketEntry[]): string {
  return JSON.stringify({ v: 1, tickets });
}

export function addTickets(known: TicketEntry[], seen: TicketEntry[]): { tickets: TicketEntry[]; changed: boolean } {
  const key = (t: TicketEntry) => `${t.path}\0${t.sha256}`;
  const have = new Set(known.map(key));
  const tickets = [...known];
  for (const t of seen) {
    if (have.has(key(t))) continue;
    have.add(key(t));
    tickets.push({ path: t.path, size: t.size, sha256: t.sha256 });
  }
  return { tickets, changed: tickets.length !== known.length };
}

export function ticketShots(tickets: TicketEntry[]): EvidenceShot[] {
  return tickets.map((t) => ({ path: t.path, source: "ticket", size: t.size, sha256: t.sha256 }));
}
