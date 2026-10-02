import { defaultVariantColorsResolver, rem } from '@mantine/core';
import type {
  VariantColorResolverResult,
  VariantColorsResolver,
} from '@mantine/core';

// Mantine's own filled-label pick is a luminance test between pure white and
// pure black (or unconditionally white with autoContrast off); neither lands
// on the kit's measured per-hue pick. `gold` is absent: it has no Mantine
// colour entry, so no filled gold button exists to label.
const ON_FILL_HUES = new Set(['accent', 'ok', 'bad', 'warn', 'purple', 'cyan']);

/**
 * Opt-in tones for labels that sit on the page ground (`--tk-bg`), where
 * Mantine's gray `light` fill is the ground itself: `quiet` is a raised fill
 * with a muted label and no rule, `quiet-outline` a card fill with the kit
 * border and a muted label. `panel-outline` is a chip inside a card: a panel
 * fill, a soft rule and a body label. `soft-outline` is a control that takes
 * the surface it sits on: no fill, a soft rule and a muted glyph.
 * `card-outline` is a secondary button on a card: a card fill, the kit border
 * and a body label, where Mantine's `default` reads its own black or white
 * label and, in dark, a border a step lighter than the kit's. All five ignore
 * `color`, since a Badge always passes the primary colour when none is given.
 */
const QUIET_TONES = new Map<string, VariantColorResolverResult>([
  [
    'quiet',
    {
      background: 'var(--tk-raised)',
      hover: 'var(--tk-raised)',
      color: 'var(--tk-text-3)',
      border: `${rem(1)} solid transparent`,
    },
  ],
  [
    'quiet-outline',
    {
      background: 'var(--tk-card)',
      hover: 'var(--tk-card)',
      color: 'var(--tk-text-3)',
      border: `${rem(1)} solid var(--tk-border)`,
    },
  ],
  [
    'panel-outline',
    {
      background: 'var(--tk-panel)',
      hover: 'var(--tk-panel)',
      color: 'var(--tk-text-1)',
      border: `${rem(1)} solid var(--tk-line-3)`,
    },
  ],
  [
    'soft-outline',
    {
      background: 'transparent',
      hover: 'var(--tk-raised)',
      color: 'var(--tk-text-3)',
      border: `${rem(1)} solid var(--tk-line-3)`,
    },
  ],
  [
    'card-outline',
    {
      background: 'var(--tk-card)',
      hover: 'var(--mantine-color-default-hover)',
      color: 'var(--tk-text-1)',
      border: `${rem(1)} solid var(--tk-border)`,
    },
  ],
]);

/** A kit hue mixed over transparent at a strength scheme-vars.css sets per
    scheme. */
const washOf = (hue: string, strength: string) =>
  `color-mix(in srgb, var(--tk-fill-${hue}) var(${strength}), transparent)`;

/**
 * Opt-in `wash` tone for a selected row: a thin wash of a kit hue behind a
 * label in that hue's text step. A colour outside the kit hues reads as the
 * `light` variant.
 */
function wash(hue: string): VariantColorResolverResult {
  return {
    background: washOf(hue, '--ui-wash'),
    hover: washOf(hue, '--ui-wash-hover'),
    color: `var(--tk-text-${hue})`,
    border: `${rem(1)} solid transparent`,
  };
}

/**
 * Opt-in tones that mark something as needing attention in a kit hue. `tint`
 * mixes the hue's fill at `--ui-tint` (lighter than a selection's wash in
 * dark) behind a label in the hue's text step, with no rule: a status tag.
 * `tint-outline` adds a rule in the hue's fill: a banner. `hue-outline` is a
 * card fill ringed in the hue's fill, with the same label: a status chip on
 * a card. None of them is interactive, so hover keeps the rest fill.
 */
const HUE_TONES: Record<
  string,
  { fallback: string; tone: (hue: string) => VariantColorResolverResult }
> = {
  tint: {
    fallback: 'light',
    tone: hue => ({
      background: washOf(hue, '--ui-tint'),
      hover: washOf(hue, '--ui-tint'),
      color: `var(--tk-text-${hue})`,
      border: `${rem(1)} solid transparent`,
    }),
  },
  'tint-outline': {
    fallback: 'light',
    tone: hue => ({
      background: washOf(hue, '--ui-tint'),
      hover: washOf(hue, '--ui-tint'),
      color: `var(--tk-text-${hue})`,
      border: `${rem(1)} solid var(--tk-fill-${hue})`,
    }),
  },
  'hue-outline': {
    fallback: 'outline',
    tone: hue => ({
      background: 'var(--tk-card)',
      hover: 'var(--tk-card)',
      color: `var(--tk-text-${hue})`,
      border: `${rem(1)} solid var(--tk-fill-${hue})`,
    }),
  },
};

/**
 * Mantine 9's variant-color hook. Starts from Mantine's `defaultVariantColorsResolver`
 * and overrides only the cases the kit cares about.
 *
 * Two overrides: for the `default` variant, instead of Mantine's flat gray,
 * `default` reads from the layered background scheme so it always sits one
 * level above whatever surface it's on. For the `filled` variant on a kit
 * hue, the label reads the per-hue `--tk-on-fill-<hue>` token instead of
 * Mantine's white/black pick.
 *
 * It also answers the kit's own `quiet`, `quiet-outline`, `panel-outline`,
 * `soft-outline`, `card-outline`, `wash`, `tint`, `tint-outline` and
 * `hue-outline` tones above.
 */
export const variantColorResolver: VariantColorsResolver = input => {
  const quiet = input.variant ? QUIET_TONES.get(input.variant) : undefined;
  if (quiet) return quiet;

  if (input.variant === 'wash') {
    return typeof input.color === 'string' && ON_FILL_HUES.has(input.color)
      ? wash(input.color)
      : defaultVariantColorsResolver({ ...input, variant: 'light' });
  }

  const hueTone = input.variant ? HUE_TONES[input.variant] : undefined;
  if (hueTone) {
    return typeof input.color === 'string' && ON_FILL_HUES.has(input.color)
      ? hueTone.tone(input.color)
      : defaultVariantColorsResolver({
          ...input,
          variant: hueTone.fallback,
        });
  }

  const base = defaultVariantColorsResolver(input);

  if (input.variant === 'default') {
    return {
      ...base,
      background: 'var(--ui-bg-3)',
    };
  }

  if (
    input.variant === 'filled' &&
    typeof input.color === 'string' &&
    ON_FILL_HUES.has(input.color)
  ) {
    return {
      ...base,
      color: `var(--tk-on-fill-${input.color})`,
    };
  }

  return base;
};
