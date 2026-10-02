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
 * border and a muted label. Both ignore `color`, since a Badge always passes
 * the primary colour when none is given.
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
]);

/** A kit hue at the given strengths in light and dark, over transparent. */
const washOf = (hue: string, light: number, dark: number) =>
  `light-dark(color-mix(in srgb, var(--tk-fill-${hue}) ${light}%, transparent), color-mix(in srgb, var(--tk-fill-${hue}) ${dark}%, transparent))`;

/**
 * Opt-in `wash` tone for a selected row: a thin wash of a kit hue behind a
 * label in that hue's text step. A colour outside the kit hues reads as the
 * `light` variant.
 */
function wash(hue: string): VariantColorResolverResult {
  return {
    background: washOf(hue, 10, 20),
    hover: washOf(hue, 14, 26),
    color: `var(--tk-text-${hue})`,
    border: `${rem(1)} solid transparent`,
  };
}

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
 * It also answers the kit's own `quiet`, `quiet-outline` and `wash` tones
 * above.
 */
export const variantColorResolver: VariantColorsResolver = input => {
  const quiet = input.variant ? QUIET_TONES.get(input.variant) : undefined;
  if (quiet) return quiet;

  if (input.variant === 'wash') {
    return typeof input.color === 'string' && ON_FILL_HUES.has(input.color)
      ? wash(input.color)
      : defaultVariantColorsResolver({ ...input, variant: 'light' });
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
