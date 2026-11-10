import type { AddInput, Todo } from '../types'

export const PLUGIN = 'human-todos'
export const TITLE = 'Human Todos'

export type ButtonId = 'run' | 'open' | 'copy' | 'done' | 'skip' | 'confirm' | 'cancel' | 'show' | 'stop' | 'openLog'

export function checkKind(input: AddInput): string | undefined {
  if ((input.kind === 'run' || input.kind === 'terminal') && !input.script?.trim()) return `kind ${input.kind} needs a script.`
  if (input.kind === 'link' && !/^https?:\/\//.test(input.url ?? '')) return 'kind link needs an http(s) url.'
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
    ...(input.kind === 'run' && input.cwd !== undefined && { cwd: input.cwd }),
  }
}

export function buttonsFor(todo: Todo): readonly ButtonId[] {
  if (todo.status === 'confirming') return ['confirm', 'cancel']
  if (todo.status === 'running') {
    const view: ButtonId = todo.runner === 'local' ? 'openLog' : 'show'
    return todo.isStopping ? [view] : [view, 'stop']
  }
  if (todo.status !== 'open') return []
  switch (todo.kind) {
    case 'run':
      return ['run', 'copy', 'done', 'skip']
    case 'terminal':
      return ['copy', 'done', 'skip']
    case 'link':
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

export function tail(out: string, lines = 30): string {
  return out.trimEnd().split('\n').slice(-lines).join('\n')
}

export function describe(list: readonly Todo[]): string {
  if (list.length === 0) return 'No to-dos.'
  return list.map(t => `#${t.id} [${t.status}] ${t.title}${t.script ? `\n    script: ${t.script}` : ''}`).join('\n')
}

export function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}
