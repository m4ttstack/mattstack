import { INVADR_SPRITES, spriteIndex } from 'invadrs';

/** The theme's gold is too pale to read as a small avatar on a light card.
    Pulled toward its own text step (not the bluish text colour, which turns
    it olive and walks it into the green) it stays a mustard yellow. */
const YELLOW = 'color-mix(in oklch, var(--gold), var(--text-gold-vivid) 40%)';

/** The theme's green is a teal that sits right next to cyan; nudged toward
    gold it reads as a true green, still clear of the yellow. */
const GREEN = 'color-mix(in oklch, var(--green), var(--gold) 20%)';

/** The theme's hues in colour-wheel order, so mixing two neighbours lands on
    a hue between them instead of a muddy blend. */
const RING = [
  'var(--accent)',
  'var(--cyan)',
  GREEN,
  YELLOW,
  'var(--amber)',
  'var(--red)',
  'var(--purple)',
];

/** Off the wheel, so never mixed: dark grey on a light card, light grey on a
    dark one. */
const GREY = 'color-mix(in oklch, var(--fg) 70%, var(--card))';

/** `items` reordered by stepping a stride of about two fifths of the way
    round, so consecutive entries sit far apart on the wheel: people listed
    next to each other never get neighbouring hues. */
function spread<T>(items: readonly T[]): T[] {
  const n = items.length;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let step = Math.max(1, Math.round(n * 0.4));
  while (gcd(step, n) !== 1) step++;
  return items.map((_, i) => items[(i * step) % n]!);
}

/** At least `n` distinct colours derived from the theme: the wheel's hues and
    a grey, then the midpoints between neighbouring hues, then the quarter
    points, each pass halving the gap, so the colours handed out first are
    the most distinct. Each pass is spread round the wheel so consecutive
    colours are never neighbours. Every entry is built from the theme's own
    light-dark() tokens, so it follows the colour scheme like the base hues
    do. */
export function themePalette(n: number): string[] {
  const out = [...spread(RING), GREY];
  let ring = RING;
  while (out.length < n) {
    const next: string[] = [];
    const mids: string[] = [];
    for (let i = 0; i < ring.length; i++) {
      const mid = `color-mix(in oklch, ${ring[i]}, ${ring[(i + 1) % ring.length]})`;
      next.push(ring[i]!, mid);
      mids.push(mid);
    }
    out.push(...spread(mids));
    ring = next;
  }
  return out;
}

/** A member's avatar: the creature, the palette and colour index it is
    drawn with, and `fill`, the colour itself for UI that should match it. */
export interface MemberLook {
  sprite: number;
  color: number;
  fill: string;
  palette: readonly string[];
}

/** Each person's look, in the order given. Colours go out in palette order,
    so the first people get the most distinct hues and nobody shares a
    colour until the palette runs out. Creatures start from invadrs' hash and
    step to the next free one, so nobody shares a creature among the first
    16. Appending a person never changes anyone before them. */
export function assignMemberLooks(
  ids: readonly string[]
): Map<string, MemberLook> {
  const unique = [...new Set(ids)];
  const palette = themePalette(unique.length);
  const count = INVADR_SPRITES.length;
  const used = new Set<number>();
  const out = new Map<string, MemberLook>();
  unique.forEach((id, i) => {
    const own = spriteIndex(id);
    let sprite = own;
    if (used.size < count) {
      while (used.has(sprite)) sprite = (sprite + 1) % count;
      used.add(sprite);
    }
    const color = i % palette.length;
    out.set(id, { sprite, color, fill: palette[color]!, palette });
  });
  return out;
}
