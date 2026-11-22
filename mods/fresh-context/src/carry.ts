export type Mode = 'clear' | 'compact'

/** What survives the reset: the mod's working file, keyed by the session that asked for it. */
export interface Carry {
  mode: Mode
  ledger: string
  then?: string
  oldSessionId: string
  chatHandle?: string
  createdAt: number
}

export function carryPath(dataDir: string, sessionId: string): string {
  return `${dataDir}/carry-${sessionId}.json`
}

export function parseCarry(text: string): Carry | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  if (c.mode !== 'clear' && c.mode !== 'compact') return null
  if (typeof c.ledger !== 'string' || typeof c.oldSessionId !== 'string' || typeof c.createdAt !== 'number') return null
  if (c.then !== undefined && typeof c.then !== 'string') return null
  if (c.chatHandle !== undefined && typeof c.chatHandle !== 'string') return null
  return {
    mode: c.mode,
    ledger: c.ledger,
    oldSessionId: c.oldSessionId,
    createdAt: c.createdAt,
    ...(c.then !== undefined ? { then: c.then } : {}),
    ...(c.chatHandle !== undefined ? { chatHandle: c.chatHandle } : {}),
  }
}

export function ledgerMessage(ledger: string): string {
  return `Ledger carried from before the reset:\n\n${ledger}`
}
