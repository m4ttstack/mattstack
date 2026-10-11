import { explainSetting } from '@mattstack/rt-client';

export type ExplainFn = typeof explainSetting;

/** The resolver's per-scope explain, the one door every deck module reads rungs through. */
export const defaultExplain: ExplainFn = explainSetting;

export interface HeldEntries {
  /** A store holds a value the resolver refused; the import must leave it alone. */
  refused: boolean;
  /** Every entry name any store sets, so the import never overwrites one. */
  held: Set<string>;
  /** What the scope the import writes holds now, so a write keeps it. */
  own: Record<string, unknown>;
}

/** What the stores already hold for one of deck's object-shaped keys. */
export function heldEntries(
  key: string,
  scope: 'user' | 'machine',
  explain: ExplainFn
): HeldEntries {
  const rows = explain(key).filter(r => r.present && r.scope !== 'default');
  const held = new Set<string>();
  let own: Record<string, unknown> = {};
  for (const row of rows) {
    if (typeof row.value !== 'object' || row.value === null) continue;
    for (const name of Object.keys(row.value)) held.add(name);
    if (row.scope === scope) own = row.value as Record<string, unknown>;
  }
  return { refused: rows.some(r => r.invalid !== undefined), held, own };
}
