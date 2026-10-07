import { pluginOf } from './outline';

export interface OriginFields {
  origin?: 'base';
  base?: string;
  baseVersion?: string | null;
}

export type Owner =
  | { kind: 'pack' }
  | { kind: 'base'; name: string; version: string | null }
  | { kind: 'plugin'; name: string };

export function ownerOf(
  ref: string,
  item: OriginFields | null | undefined,
  pack: string
): Owner {
  if (item?.origin === 'base' && item.base)
    return { kind: 'base', name: item.base, version: item.baseVersion ?? null };
  const plugin = pluginOf(ref);
  return plugin === pack ? { kind: 'pack' } : { kind: 'plugin', name: plugin };
}

export function baseLabel(owner: Extract<Owner, { kind: 'base' }>): string {
  return owner.version ? `${owner.name} ${owner.version}` : owner.name;
}
