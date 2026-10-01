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

const C_ESCAPES: Record<string, string> = { t: "\t", n: "\n", '"': '"', "\\": "\\" };

/** git wraps a path holding a space, quote or control character in C-style quotes; every other byte arrives as written. */
function unquotePath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: number[] = [];
  const body = raw.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") {
      bytes.push(...new TextEncoder().encode(ch));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
      continue;
    }
    bytes.push(...new TextEncoder().encode(C_ESCAPES[body[i + 1] ?? ""] ?? body[i + 1] ?? ""));
    i += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function parsePorcelain(stdout: string): PendingFile[] {
  return stdout.split("\n").filter((l) => l.length > 3).map((l) => {
    const status = l.slice(0, 2).trim();
    const rest = l.slice(3);
    const arrow = rest.indexOf(" -> ");
    return { path: unquotePath(arrow >= 0 ? rest.slice(arrow + 4) : rest), status };
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

function bindingsOf(doc: unknown): Record<string, Record<string, string>> {
  const b = (doc as { bindings?: unknown } | null)?.bindings;
  return b && typeof b === "object" ? (b as Record<string, Record<string, string>>) : {};
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
