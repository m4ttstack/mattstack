import { expect, test } from 'bun:test'

import type { Todo, TodoKind } from '../types'
import { buttonsFor, checkKind, clipLine, describe, hardWrap, isActionable, quote, tail, toTodo } from './items'

const todo = (over: Partial<Todo> & { kind: TodoKind }): Todo => ({ id: '1', title: 't', status: 'open', ...over })

test('checkKind names what each kind is missing', () => {
  expect(checkKind({ kind: 'run', title: 'x' })).toBe('kind run needs a script.')
  expect(checkKind({ kind: 'terminal', title: 'x' })).toBe('kind terminal needs a script.')
  expect(checkKind({ kind: 'link', title: 'x', url: 'ftp://x' })).toBe('kind link needs an http(s) url.')
  expect(checkKind({ kind: 'task', title: 'x' })).toBeUndefined()
  expect(checkKind({ kind: 'image', title: 'x' })).toBe('kind image needs paths: one absolute path per image.')
  expect(checkKind({ kind: 'image', title: 'x', paths: [] })).toBe('kind image needs paths: one absolute path per image.')
  expect(checkKind({ kind: 'image', title: 'x', paths: ['/a.png', 'b.png'] })).toBe('kind image needs absolute paths; b.png is not one.')
  expect(checkKind({ kind: 'image', title: 'x', paths: ['/a.png', '/b.JPG'] })).toBeUndefined()
  expect(checkKind({ kind: 'image', title: 'x', paths: ['/a.png', '/Applications/Calculator.app'] })).toBe(
    'kind image opens image files only (png, jpg, jpeg, gif, webp, heic, heif, tif, tiff, bmp, svg); /Applications/Calculator.app is not one.',
  )
  expect(checkKind({ kind: 'image', title: 'x', paths: ['/x/.png'] })).toMatch(/is not one\.$/)
  expect(checkKind({ kind: 'bogus' as TodoKind, title: 'x' })).toBe('kind bogus is not one of task, run, terminal, link, image.')
})

test('toTodo drops the fields that do not belong to the kind', () => {
  const task = toTodo('3', { kind: 'task', title: 't', script: 'ls', url: 'https://a' })
  expect(task.script).toBeUndefined()
  expect(task.url).toBeUndefined()
  expect(task.status).toBe('open')

  const run = toTodo('4', { kind: 'run', title: 't', script: 'ls', cwd: '/tmp', url: 'https://a' })
  expect(run.script).toBe('ls')
  expect(run.cwd).toBe('/tmp')
  expect(run.url).toBeUndefined()
  expect(run.paths).toBeUndefined()

  const image = toTodo('5', { kind: 'image', title: 't', paths: ['/a.png'], script: 'ls' })
  expect(image.paths).toEqual(['/a.png'])
  expect(image.script).toBeUndefined()
})

test('buttonsFor follows the kind and the status', () => {
  expect(buttonsFor(todo({ kind: 'run' }))).toEqual(['run', 'copy', 'done', 'skip'])
  expect(buttonsFor(todo({ kind: 'terminal' }))).toEqual(['copy', 'done', 'skip'])
  expect(buttonsFor(todo({ kind: 'link' }))).toEqual(['open', 'done', 'skip'])
  expect(buttonsFor(todo({ kind: 'task' }))).toEqual(['done', 'skip'])
  expect(buttonsFor(todo({ kind: 'image', paths: ['/a.png'] }))).toEqual(['open', 'done', 'skip'])
  expect(buttonsFor(todo({ kind: 'run', status: 'confirming' }))).toEqual(['confirm', 'cancel'])
  expect(buttonsFor(todo({ kind: 'run', status: 'running', runner: 'herdr' }))).toEqual(['show', 'stop'])
  expect(buttonsFor(todo({ kind: 'run', status: 'running', runner: 'local' }))).toEqual(['openLog', 'stop'])
  expect(buttonsFor(todo({ kind: 'run', status: 'running', runner: 'herdr', isStopping: true }))).toEqual(['show', 'forceStop'])
  expect(buttonsFor(todo({ kind: 'run', status: 'running', runner: 'local', isStopping: true }))).toEqual(['openLog', 'forceStop'])
  expect(buttonsFor(todo({ kind: 'run', status: 'done' }))).toEqual([])
})

test('isActionable is open, confirming or running', () => {
  expect(isActionable(todo({ kind: 'task', status: 'open' }))).toBe(true)
  expect(isActionable(todo({ kind: 'task', status: 'confirming' }))).toBe(true)
  expect(isActionable(todo({ kind: 'task', status: 'running' }))).toBe(true)
  for (const status of ['done', 'failed', 'skipped'] as const) {
    expect(isActionable(todo({ kind: 'task', status }))).toBe(false)
  }
})

test('describe lists each item with its status and script', () => {
  expect(describe([])).toBe('No to-dos.')
  expect(describe([todo({ kind: 'run', script: 'ls' }), todo({ kind: 'task', id: '2', status: 'done' })])).toBe(
    '#1 [open] t\n    script: ls\n#2 [done] t',
  )
  expect(describe([todo({ kind: 'image', paths: ['/x/a.png', '/x/b.png'] })])).toBe('#1 [open] t\n    images: /x/a.png, /x/b.png')
})

test('text helpers wrap, trim and quote', () => {
  expect(hardWrap('$ abcdef', 4)).toEqual(['$ ab', 'cdef'])
  const out = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
  expect(tail(out).split('\n')).toHaveLength(30)
  expect(tail(out).startsWith('line 11')).toBe(true)
  expect(quote("it's")).toBe(`'it'\\''s'`)
})

test('tail caps each line and the whole tail, keeping the newest lines', () => {
  expect(clipLine('x'.repeat(300))).toBe('x'.repeat(300))
  expect(clipLine('x'.repeat(301))).toBe(`${'x'.repeat(299)}…`)

  const meter = `${'a'.repeat(5000)}\n`.repeat(3)
  expect(tail(meter).split('\n').every(line => line.length <= 300)).toBe(true)

  const many = Array.from({ length: 30 }, (_, i) => `${String(i).padStart(3, '0')}${'y'.repeat(297)}`).join('\n')
  const kept = tail(many)
  expect(kept.length).toBeLessThanOrEqual(8 * 1024)
  expect(kept.endsWith(`029${'y'.repeat(297)}`)).toBe(true)
  expect(kept.split('\n').length).toBeLessThan(30)
})
