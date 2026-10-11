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

/** Each of `rows` whose name two or more of them share, mapped to that name
    with its place among them in `rows` order (`remy (1 of 2)`), so labels
    stay tellable apart without naming the id. A unique name has no entry. */
export function sameNameOrdinals<T>(
  rows: readonly T[],
  nameOf: (row: T) => string | undefined
): Map<T, string> {
  const byName = new Map<string, T[]>();
  for (const row of rows) {
    const name = nameOf(row);
    if (name === undefined) continue;
    const same = byName.get(name);
    if (same) same.push(row);
    else byName.set(name, [row]);
  }
  const ordinals = new Map<T, string>();
  for (const [name, same] of byName) {
    if (same.length < 2) continue;
    same.forEach((row, i) =>
      ordinals.set(row, `${name} (${i + 1} of ${same.length})`)
    );
  }
  return ordinals;
}
