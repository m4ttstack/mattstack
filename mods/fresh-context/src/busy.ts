export interface TaskLike { type: string; status: string; description?: string }

// A wakeup is left out on purpose: it survives a /clear and fires on time.
const BLOCKING_TYPES = new Set(['shell', 'monitor', 'subagent', 'workflow'])
const ACTIVE = new Set(['running', 'pending'])
const AGENT_ACTIVE = new Set(['running', 'pending', 'waiting'])

/** One line per piece of work a /clear would cut off. */
export function busyTasks(agents: { id: string; description: string; status?: string }[], tasks: TaskLike[]): string[] {
  const lines: string[] = []
  for (const a of agents) {
    if (a.status === undefined || AGENT_ACTIVE.has(a.status)) lines.push(`subagent: ${a.description}`)
  }
  for (const t of tasks) {
    if (BLOCKING_TYPES.has(t.type) && ACTIVE.has(t.status)) lines.push(`${t.type}: ${t.description ?? 'no description'}`)
  }
  return [...new Set(lines)]
}
