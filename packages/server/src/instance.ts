import { createHash } from 'node:crypto';

export const bootId: string = crypto.randomUUID();

export interface HealthState {
  ok: boolean;
  buildId: string | null;
}

export function buildIdOf(...parts: Array<string | Uint8Array>): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex').slice(0, 16);
}
