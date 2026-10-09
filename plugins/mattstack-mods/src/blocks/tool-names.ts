// Imported by an rt-side bun test that holds these names to the mattstack
// plugin's own, so this file takes no imports and never touches the engine.

/** The mattstack plugin's MCP server (plugin `mattstack`, server `mattstack`), as Claude Code prefixes its tools. */
export const MATTSTACK_TOOL_PREFIX = 'mcp__plugin_mattstack_mattstack__'

/** The run tools that move a run; `run_status` ends it. Reads and `run_start` act on no existing run. */
export const RUN_TOOL = new RegExp(`^${MATTSTACK_TOOL_PREFIX}run_(stage|field_set|decision|status)$`)
