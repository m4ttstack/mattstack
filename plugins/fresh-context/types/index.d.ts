// Mirrors Carry in src/carry.ts: a contract may not import.
export type CarryState = {
  mode: 'clear' | 'compact'
  ledger: string
  then?: string
  oldSessionId: string
  chatHandle?: string
  createdAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'fresh-context': {
      // The queued reset, kept where a reload of the mod mid-reset still finds it.
      carry: CarryState | null
    }
  }
}
