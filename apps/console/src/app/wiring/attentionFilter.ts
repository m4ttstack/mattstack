export const WIRING_HREF = '/wiring';

/**
 * The filter rides the URL rather than React state because the control that
 * turns it on -- the rail badge -- is mounted outside the Wiring route and
 * cannot share state with it.
 */
export const WIRING_ATTENTION_HREF = `${WIRING_HREF}?attention=1`;
