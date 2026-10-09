// Imported by an rt-side bun test that holds the board's wrappers to these
// names, so this file takes no imports and never touches the engine.

/** The board's own status writes; every other status-bin verb (gate, ledger, drafts) stays a Bash call. */
export const STATUS_VERBS = ['review-status', 'respond-status', 'doctor-status'] as const
export type StatusVerb = (typeof STATUS_VERBS)[number]

/** The board's own variables its status writer reads from a pane; the writer gets these, HOME, PATH and the session id, and nothing else. */
export const BOARD_VARS = ['BOARD_STATE_DB', 'BOARD_APP_ROOT', 'BOARD_FIXTURE', 'MATTSTACK_PACK'] as const
export type BoardVar = (typeof BOARD_VARS)[number]

export const STATUS_TOOL = 'status'
/** The name the model calls: the engine prefixes a plugin's own tool with `mcp__<plugin>__`. */
export const STATUS_TOOL_NAME = `mcp__mattstack-mods__${STATUS_TOOL}`

/** What a stood-down session reads; the board's own pane nudge sends the same words. */
export const STAND_DOWN_NOTICE =
  'Operator stood down auto-doctor on this MR/stack. Stop and exit -- this pane will not be resumed automatically.'
