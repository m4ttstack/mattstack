import { GOLDEN_NAME } from "./registry.ts";

// Adjectives for neutral name generator
const ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "deft",
  "eager",
  "frank",
  "grand",
  "happy",
  "ideal",
  "joyful",
  "kind",
  "lively",
  "merry",
  "noble",
  "olive",
  "proud",
];

// Nouns for neutral name generator
const NOUNS = [
  "anvil",
  "beacon",
  "cedar",
  "daisy",
  "eagle",
  "feather",
  "garden",
  "harbor",
  "inlet",
  "jungle",
  "kettle",
  "lantern",
  "marble",
  "nectar",
  "oyster",
  "paddle",
];

/**
 * Take the next unused pool name after `after`, wrapping to the head, or
 * generate a neutral name when the pool is exhausted or absent.
 *
 * Round-robin, not random: a disposed tree's name must not come straight
 * back, because a session idle in the old tree still holds that path as its
 * cwd and would act on whoever claims the new one.
 */
export function pickName(pool: string[] | undefined, used: Set<string>, after?: string): string {
  if (pool && pool.length > 0) {
    const start = after === undefined ? 0 : pool.indexOf(after) + 1;
    for (let i = 0; i < pool.length; i++) {
      const name = pool[(start + i) % pool.length]!;
      // GOLDEN_NAME is reserved even when a custom pool names it explicitly:
      // a member minted "golden" before the donor exists collides with it
      // later, and name-keyed verbs (freshen --only, dispose by name) would
      // then match two rows.
      if (!used.has(name) && name !== GOLDEN_NAME) return name;
    }
  }

  // Fall back to neutral generator
  return generateNeutralName(used);
}

/**
 * Generate a neutral name in format "<adj>-<noun>" with retry on collision.
 * Generates base pair once, then retries with numeric suffixes.
 */
function generateNeutralName(used: Set<string>): string {
  // Generate the base pair
  const adjIndex = Math.floor(Math.random() * ADJECTIVES.length);
  const nounIndex = Math.floor(Math.random() * NOUNS.length);

  const adj = ADJECTIVES[adjIndex]!;
  const noun = NOUNS[nounIndex]!;
  const baseName = `${adj}-${noun}`;

  // Return base if unused
  if (!used.has(baseName)) {
    return baseName;
  }

  // Retry with numeric suffixes until unused
  let counter = 2;
  while (true) {
    const candidate = `${baseName}-${counter}`;
    if (!used.has(candidate)) {
      return candidate;
    }
    counter++;
  }
}
