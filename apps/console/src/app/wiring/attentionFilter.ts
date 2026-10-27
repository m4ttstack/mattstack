export const PACKS_HREF = '/packs';

/**
 * The filter rides the URL rather than React state because the control that
 * turns it on -- the rail badge -- is mounted outside the Packs route and
 * cannot share state with it.
 */
export const PACKS_ATTENTION_HREF = `${PACKS_HREF}?tab=config&attention=1`;
