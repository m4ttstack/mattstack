import { INVADR_SPRITES, spriteIndex } from 'invadrs';

/** One hue in every shade a person's look is drawn in: the avatar sprite,
    the name chip's text at each size band, and the chip's wash. */
export interface LookHue {
  avatar: string;
  small: string;
  body: string;
  fill: string;
}

const hue = (name: string): LookHue => ({
  avatar: `var(--tk-text-${name}-small)`,
  small: `var(--tk-text-${name}-small)`,
  body: `var(--tk-text-${name})`,
  fill: `var(--tk-fill-${name})`,
});

/** The human's own hue, matching the tint his posts already carry. */
export const ACCENT_LOOK: LookHue = {
  avatar: 'var(--mantine-color-accent-text)',
  small: 'var(--mantine-color-accent-text)',
  body: 'var(--mantine-color-accent-text)',
  fill: 'var(--tk-fill-accent)',
};

/** The theme's ok is a teal that sits right next to cyan; nudged toward
    gold it reads as a true green, still clear of the gold itself. */
const GREEN: LookHue = (() => {
  const ok = hue('ok');
  const gold = hue('gold');
  const m = (x: string, y: string) => `color-mix(in oklch, ${x}, ${y} 20%)`;
  return {
    avatar: m(ok.avatar, gold.avatar),
    small: m(ok.small, gold.small),
    body: m(ok.body, gold.body),
    fill: m(ok.fill, gold.fill),
  };
})();

/** The theme's hues in colour-wheel order, so mixing two neighbours lands on
    a hue between them instead of a muddy blend. The wheel stops short of
    accent at both ends and never wraps: every mix across the purple-cyan
    gap is a blue that reads as the human's accent, so that stretch stays
    his alone. */
const WHEEL: readonly LookHue[] = [
  hue('cyan'),
  GREEN,
  hue('gold'),
  hue('warn'),
  hue('bad'),
  hue('purple'),
];

/** Off the wheel, so never mixed. There is no neutral fill token, so the
    wash takes the same muted text step. */
const GREY: LookHue = {
  avatar: 'var(--tk-text-2)',
  small: 'var(--tk-text-2)',
  body: 'var(--tk-text-2)',
  fill: 'var(--tk-text-2)',
};

function mix(a: LookHue, b: LookHue): LookHue {
  const m = (x: string, y: string) => `color-mix(in oklch, ${x}, ${y})`;
  return {
    avatar: m(a.avatar, b.avatar),
    small: m(a.small, b.small),
    body: m(a.body, b.body),
    fill: m(a.fill, b.fill),
  };
}

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

/** At least `n` distinct hues derived from the theme: the wheel's hues and
    a grey, then the midpoints between neighbouring hues, then the quarter
    points, each pass halving the gap, so the hues handed out first are the
    most distinct. Every entry is built from the theme's own tokens, so it
    follows the colour scheme like the base hues do. */
export function themePalette(n: number): LookHue[] {
  const out = [...spread(WHEEL), GREY];
  let ring = WHEEL;
  while (out.length < n) {
    const next: LookHue[] = [ring[0]!];
    const mids: LookHue[] = [];
    for (let i = 1; i < ring.length; i++) {
      const mid = mix(ring[i - 1]!, ring[i]!);
      next.push(mid, ring[i]!);
      mids.push(mid);
    }
    out.push(...spread(mids));
    ring = next;
  }
  return out;
}

/** A person's avatar creature and the hue their avatar and name chip share. */
export interface MemberLook {
  sprite: number;
  hue: LookHue;
}

/** Each person's look, in the order given. The human always takes accent;
    everyone else takes palette hues in order, so the first people get the
    most distinct ones and nobody shares a hue until the palette runs out.
    Creatures start from invadrs' hash and step to the next free one, so
    nobody shares a creature among the first 16. Appending a person never
    changes anyone before them. */
export function assignMemberLooks(
  ids: readonly string[],
  humanHandle: string
): Map<string, MemberLook> {
  const unique = [...new Set(ids)];
  const palette = themePalette(unique.length);
  const count = INVADR_SPRITES.length;
  const used = new Set<number>();
  const out = new Map<string, MemberLook>();
  let next = 0;
  for (const id of unique) {
    let sprite = spriteIndex(id);
    if (used.size < count) {
      while (used.has(sprite)) sprite = (sprite + 1) % count;
      used.add(sprite);
    }
    const look = id === humanHandle ? ACCENT_LOOK : palette[next++]!;
    out.set(id, { sprite, hue: look });
  }
  return out;
}
