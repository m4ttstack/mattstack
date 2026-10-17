import { createHash } from "crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from "fs";
import { extname } from "path";
import { UPLOAD_EXTENSIONS, UPLOAD_MAX_BYTES } from "../daemon/upload-guard.ts";

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

function uploadProblem(path: string, size: number, isFile: boolean): string | null {
  if (!isFile) return `${path}: not a regular file`;
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(extname(path).slice(1).toLowerCase())) return `${path}: extension must be one of ${UPLOAD_EXTENSIONS.join(", ")}`;
  if (size > UPLOAD_MAX_BYTES) return `${path}: over the upload cap`;
  return null;
}

/** Throws, reading nothing, unless path is a regular file mr_upload could send: a record can name a FIFO or a device. */
export function sha256Of(path: string): string {
  const before = statSync(path);
  const early = uploadProblem(path, before.size, before.isFile());
  if (early) throw new Error(early);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    const late = uploadProblem(path, st.size, st.isFile());
    if (late) throw new Error(late);
    return createHash("sha256").update(readFileSync(fd)).digest("hex");
  } finally {
    closeSync(fd);
  }
}
