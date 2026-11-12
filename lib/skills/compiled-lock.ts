import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LOCK_REL = "pack/compiled.lock.json";

export type CompiledLock = {
  targets: Record<string, Record<string, string>>;
  bases: Record<string, string>;
  mattstackSha: Record<string, string>;
  mattstackDirty: Record<string, 0 | 1>;
};

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const emptyLock = (): CompiledLock => ({ targets: {}, bases: {}, mattstackSha: {}, mattstackDirty: {} });

const asRecord = (v: unknown): Record<string, never> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, never>) : {});

export function readLock(packDir: string, readFile: (p: string) => string | null = readIfPresent): CompiledLock {
  const text = readFile(join(packDir, LOCK_REL));
  if (text === null) return emptyLock();
  try {
    const raw = asRecord(JSON.parse(text));
    return {
      targets: asRecord(raw.targets),
      bases: asRecord(raw.bases),
      mattstackSha: asRecord(raw.mattstackSha),
      mattstackDirty: asRecord(raw.mattstackDirty),
    };
  } catch {
    return emptyLock();
  }
}

export function mergeLock(current: CompiledLock, compiled: CompiledLock): CompiledLock {
  const next: CompiledLock = {
    targets: { ...current.targets },
    bases: { ...current.bases, ...compiled.bases },
    mattstackSha: { ...current.mattstackSha },
    mattstackDirty: { ...current.mattstackDirty },
  };
  for (const target of Object.keys(compiled.targets)) {
    next.targets[target] = compiled.targets[target]!;
    delete next.mattstackSha[target];
    delete next.mattstackDirty[target];
    if (target in compiled.mattstackSha) next.mattstackSha[target] = compiled.mattstackSha[target]!;
    if (target in compiled.mattstackDirty) next.mattstackDirty[target] = compiled.mattstackDirty[target]!;
  }
  return next;
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
  return out;
}

export function serializeLock(lock: CompiledLock): string {
  return JSON.stringify(sortKeys(lock), null, 2) + "\n";
}

export function lockWrite(
  packDir: string,
  next: CompiledLock,
  readFile: (p: string) => string | null,
  write: boolean,
): { written: string[]; removed: string[]; stale: boolean } {
  const target = join(packDir, LOCK_REL);
  const want = serializeLock(next);
  if (readFile(target) === want) return { written: [], removed: [], stale: false };
  if (!write) return { written: [], removed: [], stale: true };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, want);
  return { written: [LOCK_REL], removed: [], stale: false };
}
