import { createHash } from "crypto";
import { readFileSync } from "fs";

export type UploadEntry =
  | { sha256: string; project: string; url: string; markdown: string; at: number }
  | { linked: true; at: number };

export function parseUploads(value: string | null): Record<string, UploadEntry> {
  if (value === null) return {};
  try {
    const parsed = JSON.parse(value) as { v?: unknown; uploads?: unknown };
    if (parsed?.v !== 1 || typeof parsed.uploads !== "object" || parsed.uploads === null || Array.isArray(parsed.uploads)) return {};
    return parsed.uploads as Record<string, UploadEntry>;
  } catch {
    return {};
  }
}

export function serializeUploads(map: Record<string, UploadEntry>): string {
  return JSON.stringify({ v: 1, uploads: map });
}

export function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
