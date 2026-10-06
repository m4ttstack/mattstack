import { CSS_VARS, distinctSprites, hashStr } from 'invadrs';

/** The theme's gold is too pale to read as a small avatar on a light card;
    pulled a quarter toward the text colour it reads as yellow in both
    schemes. */
const YELLOW = 'color-mix(in oklch, var(--gold), var(--fg) 25%)';

/** The theme's hues in colour-wheel order, so mixing two neighbours lands on
    a hue between them instead of a muddy blend. */
const RING = [
  'var(--accent)',
  'var(--cyan)',
  'var(--green)',
  YELLOW,
  'var(--amber)',
  'var(--red)',
  'var(--purple)',
];

/** Off the wheel, so never mixed: dark grey on a light card, light grey on a
    dark one. */
const GREY = 'color-mix(in oklch, var(--fg) 70%, var(--card))';

/** At least `n` distinct colours derived from the theme: the wheel's hues and
    a grey, then the midpoints between neighbouring hues, then the quarter
    points, each pass halving the gap, so the colours handed out first are
    the most distinct. Every entry is built from the theme's own light-dark()
    tokens, so it follows the colour scheme like the base hues do. */
export function themePalette(n: number): string[] {
  const out = [...RING, GREY];
  let ring = RING;
  while (out.length < n) {
    const next: string[] = [];
    for (let i = 0; i < ring.length; i++) {
      const mid = `color-mix(in oklch, ${ring[i]}, ${ring[(i + 1) % ring.length]})`;
      next.push(ring[i]!, mid);
      out.push(mid);
    }
    ring = next;
  }
  return out;
}

/** invadrs' own pick for an id, so a member with no clash keeps the colour
    their avatar has always had. */
function hashedColor(id: string): string {
  return CSS_VARS.colors[(hashStr(id) >>> 4) % CSS_VARS.colors.length]!;
}

/** One colour per id, distinct across the whole set. Ids are taken in
    order: each keeps its hashed colour unless an earlier id holds it, and
    otherwise takes the first free palette colour, so appending a member
    never recolours the ones listed before it. */
export function assignInvadrColors(
  ids: readonly string[]
): Map<string, string> {
  const unique = [...new Set(ids)];
  const palette = themePalette(unique.length);
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const id of unique) {
    const hashed = hashedColor(id);
    const color = taken.has(hashed)
      ? palette.find(c => !taken.has(c))!
      : hashed;
    taken.add(color);
    out.set(id, color);
  }
  return out;
}

/** Each roster member's avatar colour and creature, both distinct across
    the roster, in the order the roster lists them. */
export function assignMemberLooks(
  ids: readonly string[]
): Map<string, { color: string; sprite: number }> {
  const colors = assignInvadrColors(ids);
  const sprites = distinctSprites([...colors.keys()]);
  return new Map(
    [...colors].map(([id, color]) => [id, { color, sprite: sprites.get(id)! }])
  );
}
