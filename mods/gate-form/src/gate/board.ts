import type { BoardGate } from '../../types'

export const NO_ADDRESS = 'Board address not found'

const KIND_TITLES: Record<string, string> = {
  'review-post': 'Review findings',
  'respond-plan': 'Respond plan',
  'respond-post': 'Respond replies',
}

export function kindTitle(kind: string): string {
  if (KIND_TITLES[kind]) return KIND_TITLES[kind]
  const words = kind.trim().replace(/[-_]+/g, ' ')
  return words === '' ? 'A gate' : `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const local = (port: unknown) => (typeof port === 'number' && Number.isInteger(port) && port > 0 ? `http://localhost:${port}` : undefined)

// The board's local address from `deck list --json`: the `board` row's port. A deck that prints its table
// whatever the flag says is read by its columns, name then port. A `*.mattstack` URL never opens in a browser, so none is used.
export function boardAddress(stdout: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    const row = stdout.split('\n').map(line => line.trim().split(/\s+/)).find(cells => cells[0] === 'board')
    return row && /^\d+$/.test(row[1] ?? '') ? local(Number(row[1])) : undefined
  }
  const apps = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.apps) ? parsed.apps : []
  const board = apps.find((app): app is Record<string, unknown> => isObject(app) && app.name === 'board')
  return board ? local(board.port) : undefined
}

export const boardUrl = (address: string, gateId: string) => `${address}/?gate=${encodeURIComponent(gateId)}`

// The newest gate, and how many more wait behind it.
export function boardText(list: BoardGate[]): string {
  const newest = list.at(-1)
  if (!newest) return ''
  const more = list.length - 1
  return `${kindTitle(newest.kind)} is waiting on the board${more > 0 ? `, ${more} more` : ''}`
}

// A gate tool's result for a board-only gate this pane waits on.
export function readBoardOnly(text: string): { gateId: string; supersededId?: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(parsed) || parsed.boardOnly !== true || parsed.paneAction !== 'wait' || typeof parsed.id !== 'string' || parsed.id === '') return undefined
  return { gateId: parsed.id, ...(typeof parsed.supersededId === 'string' && { supersededId: parsed.supersededId }) }
}

export function addBoardGate(list: BoardGate[], gate: BoardGate, supersededId?: string): BoardGate[] {
  if (list.some(b => b.gateId === gate.gateId)) return list
  return [...list.filter(b => b.gateId !== supersededId), gate]
}
