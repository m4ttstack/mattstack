import type { AddInput, Todo } from '../types'

export const PLUGIN = 'human-todos'
export const TITLE = 'Human Todos'

export type ButtonId = 'run' | 'open' | 'copy' | 'done' | 'skip' | 'confirm' | 'cancel' | 'show' | 'stop' | 'forceStop' | 'openLog'

export const KINDS = ['task', 'run', 'terminal', 'link', 'image'] as const
export const LIVE_LINES_LOCAL = 15
export const LIVE_LINES_HERDR = 3
const LINE_MAX = 300
const TAIL_MAX = 8 * 1024

export function checkKind(input: AddInput): string | undefined {
  if (!(KINDS as readonly string[]).includes(input.kind)) return `kind ${String(input.kind)} is not one of ${KINDS.join(', ')}.`
  if ((input.kind === 'run' || input.kind === 'terminal') && !input.script?.trim()) return `kind ${input.kind} needs a script.`
  if (input.kind === 'link' && !/^https?:\/\//.test(input.url ?? '')) return 'kind link needs an http(s) url.'
  if (input.kind === 'image') {
    const paths = Array.isArray(input.paths) ? input.paths : []
    if (paths.length === 0) return 'kind image needs paths: one absolute path per image.'
    const relative = paths.find(p => typeof p !== 'string' || !p.startsWith('/'))
    if (relative !== undefined) return `kind image needs absolute paths; ${String(relative)} is not one.`
    const other = paths.find(p => !isImageName(p))
    if (other !== undefined) return `kind image opens image files only (${IMAGE_EXTENSIONS.join(', ')}); ${other} is not one.`
  }
  return undefined
}

export function toTodo(id: string, input: AddInput): Todo {
  const hasScript = input.kind === 'run' || input.kind === 'terminal'
  return {
    id,
    kind: input.kind,
    title: input.title,
    status: 'open',
    ...(input.detail !== undefined && { detail: input.detail }),
    ...(hasScript && input.script !== undefined && { script: input.script }),
    ...(input.kind === 'link' && input.url !== undefined && { url: input.url }),
    ...(input.kind === 'image' && input.paths !== undefined && { paths: [...input.paths] }),
    ...(input.kind === 'run' && input.cwd !== undefined && { cwd: input.cwd }),
  }
}

export function buttonsFor(todo: Todo): readonly ButtonId[] {
  if (todo.status === 'confirming') return ['confirm', 'cancel']
  if (todo.status === 'running') {
    const view: ButtonId = todo.runner === 'local' ? 'openLog' : 'show'
    return [view, todo.isStopping ? 'forceStop' : 'stop']
  }
  if (todo.status !== 'open') return []
  switch (todo.kind) {
    case 'run':
      return ['run', 'copy', 'done', 'skip']
    case 'terminal':
      return ['copy', 'done', 'skip']
    case 'link':
    case 'image':
      return ['open', 'done', 'skip']
    case 'task':
      return ['done', 'skip']
  }
}

export function isActionable(t: Todo): boolean {
  return t.status === 'open' || t.status === 'confirming' || t.status === 'running'
}

export function hardWrap(text: string, width: number): string[] {
  const rows: string[] = []
  for (const line of text.split('\n')) {
    if (line.length === 0) rows.push('')
    for (let i = 0; i < line.length; i += width) rows.push(line.slice(i, i + width))
  }
  return rows
}

export function wrapWords(text: string, width: number): string[] {
  const rows: string[] = []
  for (const line of text.split('\n')) {
    let row = ''
    for (const word of line.split(' ').filter(w => w !== '')) {
      const joined = row === '' ? word : `${row} ${word}`
      if (joined.length <= width) {
        row = joined
        continue
      }
      if (row !== '') rows.push(row)
      const pieces = hardWrap(word, width)
      row = pieces.pop() ?? ''
      rows.push(...pieces)
    }
    rows.push(row)
  }
  return rows
}

// The plugin's whole store is capped, so a long line (a progress meter, minified output) must not reach it whole.
export function clipLine(line: string): string {
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line
}

export function clipLines(lines: readonly string[]): string[] {
  return lines.map(clipLine)
}

export function tail(out: string, lines = 30): string {
  const kept = clipLines(out.trimEnd().split('\n').slice(-lines))
  let size = kept.reduce((sum, line) => sum + line.length + 1, 0)
  while (kept.length > 1 && size > TAIL_MAX) size -= (kept.shift() ?? '').length + 1
  return kept.join('\n')
}

export function newToken(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0')
}

export function describe(list: readonly Todo[]): string {
  if (list.length === 0) return 'No to-dos.'
  return list
    .map(t => {
      const script = t.script ? `\n    script: ${t.script}` : ''
      const images = t.paths?.length ? `\n    images: ${t.paths.join(', ')}` : ''
      return `#${t.id} [${t.status}] ${t.title}${script}${images}`
    })
    .join('\n')
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'svg'] as const

export function isImageName(path: string): boolean {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 && (IMAGE_EXTENSIONS as readonly string[]).includes(name.slice(dot + 1).toLowerCase())
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}
