import { cellWidth, chunkCells } from '@mattstack/mod-kit'

import type { AddInput, Todo } from '../types'

export const PLUGIN = 'human-todos'
export const TITLE = 'Human Todos'

// `message` opens the item's message row; `send`, `sendDone` and `cancelMessage` are that row's buttons (kit drawer only).
export type ButtonId = 'run' | 'open' | 'copy' | 'done' | 'skip' | 'confirm' | 'cancel' | 'show' | 'stop' | 'forceStop' | 'openLog' | 'message' | 'send' | 'sendDone' | 'cancelMessage'

export const KINDS = ['task', 'run', 'terminal', 'link', 'image'] as const
export const LIVE_LINES_LOCAL = 15
export const LIVE_LINES_HERDR = 3
const LINE_MAX = 300
const TAIL_MAX = 8 * 1024

// What runs or opens must be all there on screen: no control, format or invisible character gets in.
const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u
// Prose keeps the joiners emoji are made of, but nothing that moves or reorders text.
const UNSEEN_IN_PROSE = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u

// A file name can hold an emoji, whose own joiners and presentation mark are part of it; they stay refused elsewhere.
// Keycaps and tag-sequence flags stay refused: they are not built on a pictograph.
const EMOJI = /\p{Extended_Pictographic}[\u{FE0F}\p{Emoji_Modifier}]?(?:\u{200D}\p{Extended_Pictographic}[\u{FE0F}\p{Emoji_Modifier}]?)*/gu
const isUnseenPath = (path: string) => UNSEEN.test(path.replace(EMOJI, ''))

type Checked = Pick<Todo, 'title' | 'script' | 'cwd' | 'url' | 'paths' | 'detail' | 'doneLabel'>

export function unseenField(input: Checked): string | undefined {
  if (UNSEEN.test((input.script ?? '').replace(/[\n\t]/g, ''))) return 'script'
  if (isUnseenPath(input.cwd ?? '')) return 'cwd'
  if (UNSEEN.test(input.url ?? '')) return 'url'
  if (Array.isArray(input.paths) && input.paths.some(p => isUnseenPath(String(p)))) return 'paths'
  if (UNSEEN_IN_PROSE.test(input.title)) return 'title'
  if (UNSEEN_IN_PROSE.test((input.detail ?? '').replace(/[\n\t]/g, ''))) return 'detail'
  if (UNSEEN_IN_PROSE.test(input.doneLabel ?? '')) return 'doneLabel'
  return undefined
}

export function checkKind(input: AddInput): string | undefined {
  if (!(KINDS as readonly string[]).includes(input.kind)) return `kind ${String(input.kind)} is not one of ${KINDS.join(', ')}.`
  if ((input.kind === 'run' || input.kind === 'terminal') && !input.script?.trim()) return `kind ${input.kind} needs a script.`
  const unseen = unseenField(input)
  if (unseen) return `${unseen} has characters the user cannot see (control, direction or zero-width); leave them out.`
  if (input.kind === 'run' && input.cwd?.trim() && !input.cwd.startsWith('/')) return "cwd must be an absolute path; leave it out to run in the session's folder."
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

// Long enough for a short phrase; the button row wraps past this, and a sentence belongs in `detail`.
const DONE_LABEL_MAX = 32

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
    ...(input.kind !== 'run' && input.doneLabel?.trim() && { doneLabel: input.doneLabel.trim().slice(0, DONE_LABEL_MAX) }),
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

// Both wrap by terminal cells and break only between graphemes, so an emoji or a wide character never splits across rows.
export function hardWrap(text: string, width: number): string[] {
  const rows: string[] = []
  for (const line of text.split('\n')) {
    if (line.length === 0) rows.push('')
    else rows.push(...chunkCells(line, width))
  }
  return rows
}

export function wrapWords(text: string, width: number): string[] {
  const rows: string[] = []
  for (const line of text.split('\n')) {
    let row = ''
    for (const word of line.split(' ').filter(w => w !== '')) {
      const joined = row === '' ? word : `${row} ${word}`
      if (cellWidth(joined) <= width) {
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
      // Each later line is indented, so none can read as a row of the list.
      const script = t.script ? `\n    script: ${t.script.replaceAll('\n', '\n      ')}` : ''
      const images = t.paths?.length ? `\n    images: ${t.paths.join(', ')}` : ''
      return `#${t.id} [${t.status}] ${JSON.stringify(t.title)}${script}${images}`
    })
    .join('\n')
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp'] as const

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
