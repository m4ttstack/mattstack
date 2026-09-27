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

/** The pair labels two or more of `dms` read alike. The sidebar rows and the
    open DM's header both show avatars for exactly these, so both must be
    handed the same listed DMs. */
export function repeatedPairLabels(
  dms: readonly { participants?: DmPair }[]
): Set<string> {
  const counts = new Map<string, number>();
  for (const d of dms) {
    if (!d.participants) continue;
    const label = dmPairLabel(d.participants);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([label]) => label));
}
