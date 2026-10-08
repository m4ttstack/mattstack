// The plugin's own contract: the $.state values it keeps, which
// `claude plugin validate` holds every $.state reference in the module to.

declare module 'claude-code' {
  interface PluginState {
    'mattstack-mods': {
      /** The live daemon link's id, or null with no link. */
      linkId: string | null
      /** What the daemon accepted at the last register: a hint for the shared resolver, never authority. */
      context: {
        sessionId: string
        linkId: string
        cwd: string
        root: string
        pane: string | null
        blocks: string[]
      } | null
      /** Set when the core composed its prompt section for this conversation. */
      sectionComposed: boolean
    }
  }
}
