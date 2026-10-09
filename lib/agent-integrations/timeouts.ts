/**
 * How long a bound launch may legitimately take, shared by the Codex session
 * integration that spends it and the CLI that waits for it. Kept free of
 * imports so the CLI can read it without loading any integration.
 */

/** Codex's initialization turn on a fresh thread. */
export const CODEX_INIT_TURN_TIMEOUT_MS = 180_000;
/** A Codex policy check turn on a session that must prove its hooks before managed work. */
export const CODEX_POLICY_CHECK_TURN_TIMEOUT_MS = 180_000;
/** Reads of a freshly attached Codex terminal before it counts as unattached. */
export const CODEX_ATTACH_READS = 30;
export const CODEX_ATTACH_READ_MS = 500;

/** A bound `rt agent start` or `resume` may wait on a Codex initialization turn and its terminal attach; the client waits that long plus a margin. */
export const BOUND_LAUNCH_CLIENT_TIMEOUT_MS = CODEX_INIT_TURN_TIMEOUT_MS + CODEX_ATTACH_READS * CODEX_ATTACH_READ_MS + 60_000;
