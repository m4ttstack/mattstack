export interface Named {
  handle: string;
  name?: string;
}

export interface DmPair {
  a: string;
  b: string;
  aName?: string;
  bName?: string;
}

export function displayName(row: Named): string {
  return row.name ?? row.handle;
}

/** A DM is named by its pair; the hashed room name is never shown. */
export function dmPairLabel(pair: DmPair): string {
  return `${pair.aName ?? pair.a} ↔ ${pair.bName ?? pair.b}`;
}
