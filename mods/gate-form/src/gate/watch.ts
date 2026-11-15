import type { EngineInterface } from 'claude-code'

export type GateEnd = { status: 'answered'; by: string; session?: string; answers?: Record<string, unknown> } | { status: 'closed'; reason?: string }

type Row = { id?: string; status?: unknown; answer?: unknown; closedReason?: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// How a gate row ended, or undefined while it still waits (open or parked).
export function rowEnd(row: Row): GateEnd | undefined {
  if (row.status === 'answered') {
    const answer = isObject(row.answer) ? row.answer : {}
    return {
      status: 'answered',
      by: String(answer.by ?? ''),
      ...(typeof answer.session === 'string' && { session: answer.session }),
      ...(isObject(answer.answers) && { answers: answer.answers }),
    }
  }
  if (row.status === 'closed') return { status: 'closed', ...(typeof row.closedReason === 'string' && { reason: row.closedReason }) }
  return undefined
}

// `rt gate wait` prints `{ ok, status, row }` once the gate is answered or closed.
export function waitEnd(stdout: string): GateEnd | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (!isObject(parsed) || parsed.ok !== true) return undefined
  return rowEnd({ ...(isObject(parsed.row) ? parsed.row : {}), status: parsed.status })
}

// The daemon counts a pane answer with no session as the pane's own too, and rings no doorbell for either.
export const isSelf = (end: GateEnd, session: string) => end.status === 'answered' && end.by === 'pane' && (end.session === undefined || end.session === session)

const ANSWERED_ON: Record<string, string> = {
  board: 'Answered on the board',
  console: 'Answered in the console',
  shepherd: 'Answered by the shepherd',
  pane: 'Answered in another pane',
}

export function endNote(end: GateEnd): string {
  if (end.status === 'closed') return end.reason === 'superseded' ? 'Replaced by a newer gate' : 'Closed elsewhere'
  return ANSWERED_ON[end.by] ?? 'Answered elsewhere'
}

// Waits for the gate to end through `rt gate wait`, on PATH first, then where mattstack installs it.
// The session id is empty so the wait never stamps another surface's answer consumed before the agent reconciles.
// Only a name that could not start moves on to the next; a wait that ran and failed returns undefined.
export async function waitFor($: EngineInterface, gateId: string): Promise<GateEnd | undefined> {
  const home = await $.env.get('HOME')
  for (const rt of ['rt', `${home ?? ''}/.local/bin/rt`]) {
    const child = $.process.spawn({ argv: [rt, 'gate', 'wait', gateId], env: { CLAUDE_CODE_SESSION_ID: '' } })
    let step
    try {
      step = await child.next()
    } catch {
      continue
    }
    let stdout = ''
    try {
      while (!step.done) {
        if (step.value.stream === 'stdout') stdout += step.value.text
        step = await child.next()
      }
    } catch {
      return undefined
    }
    return step.value.code === 0 ? waitEnd(stdout) : undefined
  }
  return undefined
}
