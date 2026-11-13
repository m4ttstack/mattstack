import type { ButtonTone } from '@mattstack/mod-kit'

import type { Todo } from '../../types'
import { LIVE_LINES_HERDR, LIVE_LINES_LOCAL, buttonsFor, fileName, hardWrap, isActionable, wrapWords } from '../items'
import type { ButtonId } from '../items'

export type Tone = 'title' | 'dim' | 'warning' | 'script' | 'link' | 'success' | 'error' | 'inactive' | 'plain'
export type PaneButton = { id: ButtonId | 'more' | 'clear'; label: string; tone: ButtonTone; todoId?: string }
export type PaneRow =
  | { kind: 'text'; text: string; tone: Tone; indent: boolean; spin?: true }
  | { kind: 'buttons'; buttons: PaneButton[]; lead?: { text: string; tone: Tone } }
  | { kind: 'finished'; mark: string; tone: Tone; title: string; exit?: number }
  | { kind: 'blank' }
export type PaneModel = { rows: PaneRow[]; spans: { first: number; last: number }[]; hasFinished: boolean }

const SCRIPT_ROWS = 2
const FINISHED_SHOWN = 8

export const LABELS: Record<ButtonId, string> = {
  run: 'Run',
  open: 'Open',
  copy: 'Copy',
  done: 'Done',
  skip: 'Skip',
  confirm: 'Confirm',
  cancel: 'Cancel',
  show: 'Show',
  stop: 'Stop',
  forceStop: 'Force stop',
  openLog: 'Open log',
}

const TONES: Record<ButtonId, ButtonTone> = {
  run: 'primary',
  open: 'primary',
  confirm: 'primary',
  show: 'primary',
  done: 'secondary',
  skip: 'secondary',
  cancel: 'neutral',
  copy: 'neutral',
  openLog: 'neutral',
  stop: 'caution',
  forceStop: 'caution',
}

function markFor(todo: Todo): { mark: string; tone: Tone } {
  if (todo.status === 'failed') return { mark: '✗', tone: 'error' }
  if (todo.status === 'skipped') return { mark: '–', tone: 'inactive' }
  return { mark: '✓', tone: 'success' }
}

function buttonsOf(todo: Todo): PaneButton[] {
  return buttonsFor(todo).map(id => ({ id, label: LABELS[id], tone: TONES[id], todoId: todo.id }))
}

// A title wraps at the full inner width; everything else at `width`, two columns narrower.
export function paneModel(input: { list: Todo[]; expanded: string[]; spin: string; width: number }): PaneModel {
  const { list, expanded, spin, width } = input
  const inner = width + 2
  const actionable = list.filter(isActionable)
  const finished = list.filter(t => !isActionable(t))
  const rows: PaneRow[] = []
  const spans: { first: number; last: number }[] = []
  const blank = () => rows.push({ kind: 'blank' })
  const lines = (text: string, w: number, tone: Tone, indent: boolean) => {
    for (const line of wrapWords(text, w)) rows.push({ kind: 'text', text: line, tone, indent })
  }

  if (actionable.length === 0) {
    rows.push({ kind: 'text', text: 'Nothing for you right now.', tone: 'dim', indent: false })
    if (finished.length > 0) blank()
  }

  for (const todo of actionable) {
    const first = rows.length
    const script = todo.script ? hardWrap(`$ ${todo.script}`, width) : []
    const isConfirming = todo.status === 'confirming'
    const isOpen = expanded.includes(todo.id) || isConfirming
    const shown = isOpen ? script : script.slice(0, SCRIPT_ROWS)
    const hidden = script.length - SCRIPT_ROWS
    const tail = (todo.liveTail ?? []).slice(todo.runner === 'local' ? -LIVE_LINES_LOCAL : -LIVE_LINES_HERDR)

    lines(`${todo.status === 'running' ? `${spin} ` : '○ '}${todo.title}`, inner, 'title', false)
    if (todo.detail) lines(todo.detail, width, 'dim', true)
    if (todo.status !== 'running' && todo.note) lines(todo.note, width, 'warning', true)
    for (const row of shown) rows.push({ kind: 'text', text: row, tone: 'script', indent: true })
    if (hidden > 0 && !isConfirming) {
      const more: PaneButton = { id: 'more', label: isOpen ? 'Show less' : 'Show all', tone: 'neutral', todoId: todo.id }
      rows.push({ kind: 'buttons', buttons: [more], ...(!isOpen && { lead: { text: `… +${hidden} more`, tone: 'dim' as const } }) })
    }
    if (todo.kind === 'run' && todo.cwd) rows.push({ kind: 'text', text: `in ${todo.cwd}`, tone: 'dim', indent: true })
    if (todo.url) lines(todo.url, width, 'link', true)
    if (todo.paths?.length) lines(todo.paths.map(fileName).join(', '), width, 'link', true)
    if (todo.status === 'running') {
      blank()
      for (const line of tail) rows.push({ kind: 'text', text: line, tone: 'dim', indent: true })
      if (tail.length > 0) blank()
      const lead = { text: `${spin} ${todo.isStopping ? 'Stopping…' : 'Running'}`, tone: todo.isStopping ? ('error' as const) : ('warning' as const) }
      rows.push({ kind: 'buttons', lead, buttons: buttonsOf(todo) })
    } else {
      blank()
      if (isConfirming) lines('Are you sure you want to run this script?', width, 'plain', true)
      rows.push({ kind: 'buttons', buttons: buttonsOf(todo) })
    }
    spans.push({ first, last: rows.length - 1 })
    blank()
  }

  if (finished.length > 0) {
    for (const todo of finished.slice(-FINISHED_SHOWN)) {
      const { mark, tone } = markFor(todo)
      spans.push({ first: rows.length, last: rows.length })
      rows.push({
        kind: 'finished',
        mark,
        tone,
        title: todo.title,
        ...(todo.exitCode !== undefined && todo.exitCode !== 0 && { exit: todo.exitCode }),
      })
    }
    blank()
    rows.push({ kind: 'buttons', buttons: [{ id: 'clear', label: 'Clear finished', tone: 'neutral' }] })
  }

  return { rows, spans, hasFinished: finished.length > 0 }
}

export function bandModel(list: Todo[]): { waiting: number; title: string } | undefined {
  const waiting = list.filter(t => t.status === 'open' || t.status === 'confirming').length
  if (waiting === 0) return undefined
  return { waiting, title: `${waiting} ${waiting === 1 ? 'to-do' : 'to-dos'}` }
}
