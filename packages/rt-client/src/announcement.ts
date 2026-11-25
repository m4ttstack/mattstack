import type { SealBinding } from "./sealed-text.ts";

export const ANNOUNCEMENT_TYPE = "announcement";
export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_MESSAGE_MAX = 500;

export interface AnnouncementPayload {
  title: string;
  message: string;
  /** Holds the real title and message; the plain ones are then the placeholder. */
  sealed?: string;
}

/** What a sealed announcement says in the clear, so a board too old to open one still parses it. */
export const ANNOUNCEMENT_PLACEHOLDER = { title: "Announcement", message: "Update mattstack to read this." } as const;

export function announcementBinding(id: string, from: string): SealBinding {
  return { type: ANNOUNCEMENT_TYPE, from, subject: id };
}

function usable(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim() !== "" && v.length <= max;
}

export function parseAnnouncementPayload(p: unknown): AnnouncementPayload | null {
  if (typeof p !== "object" || p === null) return null;
  const { title, message, sealed } = p as Record<string, unknown>;
  if (!usable(title, ANNOUNCEMENT_TITLE_MAX) || !usable(message, ANNOUNCEMENT_MESSAGE_MAX)) return null;
  if (sealed !== undefined && typeof sealed !== "string") return null;
  return { title, message, ...(sealed !== undefined ? { sealed } : {}) };
}
