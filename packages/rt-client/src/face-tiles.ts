/**
 * The tile behind a generated face, shared by everything that draws one. The
 * colours are measured against the Personas' own skin, hair and clothing
 * colours (apps/chat/src/app/face-tiles-contrast.test.ts holds them to it), so
 * a face never melts into its tile. Oranges and yellows sit on the skin tones,
 * and pinks vanish on chat's selected row. Plain hex, because DiceBear writes
 * these into the SVG.
 */
export const FACE_TILES = ["def8b2", "a4eec0", "90e9f6", "b0d2fc", "d3c5fc"] as const;

/** Coprime with the list's length, so a clash walks every colour. */
const TILE_STEP = 3;

/** From the handle alone: display names are only known for the open room, and a
    face must not change when its room is selected. A Slack handle's first part
    is the same for everyone. */
export function faceSeed(handle: string): string {
  return handle.startsWith("slack.") ? handle : handle.split(".")[0]!;
}

/** A seed's tile when nothing else is drawn beside it. */
export function ownTile(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  return ((hash ^ (hash >>> 13)) >>> 0) % FACE_TILES.length;
}

/** A tile per handle for people drawn together, all different until the list
    runs out. Sorted first, so it doesn't depend on who spoke first. */
export function faceTiles(handles: readonly string[]): Map<string, number> {
  const tiles = new Map<string, number>();
  const taken = new Set<number>();
  for (const handle of [...new Set(handles)].sort()) {
    if (taken.size === FACE_TILES.length) taken.clear();
    let tile = ownTile(faceSeed(handle));
    while (taken.has(tile)) tile = (tile + TILE_STEP) % FACE_TILES.length;
    taken.add(tile);
    tiles.set(handle, tile);
  }
  return tiles;
}
