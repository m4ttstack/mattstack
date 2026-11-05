export const ANNOUNCEMENT_TYPE = "announcement";
export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_MESSAGE_MAX = 500;

export interface AnnouncementPayload {
  title: string;
  message: string;
}

function usable(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim() !== "" && v.length <= max;
}

export function parseAnnouncementPayload(p: unknown): AnnouncementPayload | null {
  if (typeof p !== "object" || p === null) return null;
  const { title, message } = p as Record<string, unknown>;
  if (!usable(title, ANNOUNCEMENT_TITLE_MAX) || !usable(message, ANNOUNCEMENT_MESSAGE_MAX)) return null;
  return { title, message };
}
