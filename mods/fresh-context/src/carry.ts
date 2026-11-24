export type Mode = 'clear' | 'compact'

/** What survives the reset: the ledger and where it goes, for the session that asked for it. */
export interface Carry {
  mode: Mode
  ledger: string
  then?: string
  oldSessionId: string
  chatHandle?: string
  createdAt: number
}

/** The skill a `then` names as /name, with what follows it; undefined for plain text, a path included. */
export function skillIn(then: string): { name: string; args: string } | undefined {
  const slash = /^\/([\w:-]+)(?:\s+([\s\S]*))?$/.exec(then)
  return slash?.[1] ? { name: slash[1], args: (slash[2] ?? '').trim() } : undefined
}

/** A named skill goes in as a request to use it, never as a command, so the skill's own limits on who may start it hold. */
export function thenPrompt(then: string): string {
  const skill = skillIn(then)
  if (skill) return `Use the ${skill.name} skill${skill.args ? ` with: ${skill.args}` : ''}`
  return then.startsWith('/') ? `Next step from before the reset: ${then}` : then
}

export function ledgerMessage(ledger: string): string {
  return `Ledger carried from before the reset:\n\n${ledger}`
}
