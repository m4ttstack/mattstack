const TEXT_MAX = 80

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1)}…` : line
}

type Fields = Record<string, unknown>

const fields = (value: unknown): Fields => (typeof value === 'object' && value !== null ? (value as Fields) : {})

// A review names only some of its gate's questions (the tool builds the rest from the findings), so it has no count.
function questionCount(input: Fields): number | undefined {
  const lists = [input.questions, fields(input.source).questions]
  return lists.find(Array.isArray)?.length
}

// What a gate call's transcript row shows in place of its input: the pane draws the context and the questions.
export function rowInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const row: Fields = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'context') continue
    if (typeof value === 'string') row[key] = oneLine(value)
    else if (typeof value === 'number' || typeof value === 'boolean') row[key] = value
  }
  const questions = questionCount(input as Fields)
  return questions === undefined ? row : { ...row, questions }
}
