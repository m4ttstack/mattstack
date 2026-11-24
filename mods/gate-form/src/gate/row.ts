const TEXT_MAX = 80

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1)}…` : line
}

// What a gate call's transcript row shows in place of its input: the pane draws the context and the questions.
export function rowInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const row: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'context') continue
    if (key === 'questions' && Array.isArray(value)) row[key] = value.length
    else if (typeof value === 'string') row[key] = oneLine(value)
    else if (typeof value === 'number' || typeof value === 'boolean') row[key] = value
  }
  return row
}
