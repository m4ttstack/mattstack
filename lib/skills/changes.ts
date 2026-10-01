export const PACK_SCOPE = ["pack", "skills", "attachments", ".claude-plugin", "surface.jsonc"] as const;

export type PendingFile = { path: string; status: string };
export type BindingChange = { engineRef: string; slot: string; from: string | null; to: string | null };
export type SurfaceChange = { skill: string; from: "public" | "internal"; to: "public" | "internal" };
export type ChangesPayload = {
  pack: string;
  packDir: string;
  dirty: boolean;
  files: PendingFile[];
  outsideScope: PendingFile[];
  bindings: BindingChange[];
  surface: SurfaceChange[];
};

const C_ESCAPES: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\" };

/** git wraps a path holding a space, quote or control character in C-style quotes; every other byte arrives as written. */
function unquotePath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const encoder = new TextEncoder();
  const chars = Array.from(raw.slice(1, -1));
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch !== "\\") {
      bytes.push(...encoder.encode(ch));
      continue;
    }
    const octal = chars.slice(i + 1, i + 4).join("");
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
      continue;
    }
    const next = chars[i + 1] ?? "";
    bytes.push(...encoder.encode(C_ESCAPES[next] ?? next));
    i += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function parsePorcelain(stdout: string): PendingFile[] {
  return stdout.split("\n").filter((l) => l.length > 3).map((l) => {
    const xy = l.slice(0, 2);
    const rest = l.slice(3);
    const arrow = /[RC]/.test(xy) ? rest.indexOf(" -> ") : -1;
    return { path: unquotePath(arrow >= 0 ? rest.slice(arrow + 4) : rest), status: xy.trim() };
  });
}

/** Porcelain prints repo-root paths; a pack that lives in a subdirectory of its repo needs them relative to the pack. */
export function relativeToPrefix(files: PendingFile[], prefix: string): PendingFile[] {
  if (prefix === "") return files;
  return files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
}

export function inScope(path: string): boolean {
  return PACK_SCOPE.some((root) => path === root || path.startsWith(`${root}/`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingsOf(doc: unknown): Record<string, Record<string, string>> {
  const raw = isRecord(doc) ? doc.bindings : undefined;
  const out: Record<string, Record<string, string>> = {};
  if (!isRecord(raw)) return out;
  for (const [engineRef, slots] of Object.entries(raw)) {
    if (!isRecord(slots)) continue;
    out[engineRef] = Object.fromEntries(Object.entries(slots).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }
  return out;
}

export function bindingChanges(before: unknown, after: unknown): BindingChange[] {
  const a = bindingsOf(before);
  const b = bindingsOf(after);
  const out: BindingChange[] = [];
  for (const engineRef of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const slots = new Set([...Object.keys(a[engineRef] ?? {}), ...Object.keys(b[engineRef] ?? {})]);
    for (const slot of [...slots].sort()) {
      const from = a[engineRef]?.[slot] ?? null;
      const to = b[engineRef]?.[slot] ?? null;
      if (from !== to) out.push({ engineRef, slot, from, to });
    }
  }
  return out;
}

function publicOf(doc: unknown): Set<string> {
  const p = (doc as { public?: unknown } | null)?.public;
  return new Set(Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []);
}

export function surfaceChanges(before: unknown, after: unknown): SurfaceChange[] {
  const a = publicOf(before);
  const b = publicOf(after);
  const out: SurfaceChange[] = [];
  for (const skill of [...new Set([...a, ...b])].sort()) {
    if (a.has(skill) && !b.has(skill)) out.push({ skill, from: "public", to: "internal" });
    if (!a.has(skill) && b.has(skill)) out.push({ skill, from: "internal", to: "public" });
  }
  return out;
}

export type GitRun = { exitCode: number; stderr: string; timedOut?: boolean };

/** Only git's own wording says the directory is not a repository; any other failure (a bad config, a lock, git missing) is not that. */
export function isNotARepo(res: GitRun): boolean {
  return res.stderr.includes("not a git repository");
}

/** runCapture reports a child that never started or never answered as exit code -1 with no stderr. */
export function describeGitFailure(res: GitRun): string {
  if (res.timedOut) return "git did not answer in time";
  if (res.exitCode === -1) return "git could not run";
  return res.stderr.trim() || `git exited with status ${res.exitCode}`;
}
