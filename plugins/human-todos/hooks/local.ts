import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'
import { LIVE_LINES_LOCAL, clipLines, newToken } from './items'
import { report } from './report'
import { patchTodo } from './store'

const PID_LINE = /^__human_todo_pid__(\d+)$/
const FLUSH_MS = 1000
// $.fs.write refuses 4 MiB, so the log keeps a rolling window well under it.
const WINDOW = 1024 * 1024
const DROPPED = '[earlier output was dropped]\n'

type Job = { pid?: number; isStopped: boolean; isGone: boolean }

// One entry per live run, keyed by its token, so two runs never share a child, a log or a stop.
const jobs = new Map<string, Job>()

async function logFolder($: EngineInterface): Promise<string> {
  const cache = await $.env.get('XDG_CACHE_HOME')
  if (cache) return `${cache}/human-todos`
  const home = await $.env.get('HOME')
  if (!home) throw new Error('no home folder for the log')
  return `${home}/Library/Caches/human-todos`
}

function signal($: EngineInterface, pid: number) {
  return $.process.run(['/bin/sh', '-c', `pkill -TERM -P ${pid}; kill -TERM ${pid}`])
}

// Only the first whole stderr line that is the marker is the pid; a half line waits for its newline,
// so a pid split across pieces is never read short, and marker text a script prints later stays output.
function scanStderr(held: string, text: string): { held: string; passed: string; pid?: number } {
  const buffered = held + text
  const cut = buffered.lastIndexOf('\n') + 1
  let passed = ''
  let pid: number | undefined
  for (const line of buffered.slice(0, cut).split('\n').slice(0, -1)) {
    const marker = pid === undefined ? PID_LINE.exec(line) : null
    if (marker) pid = Number(marker[1])
    else passed += `${line}\n`
  }
  const rest = buffered.slice(cut)
  return pid === undefined ? { held: rest, passed } : { held: '', passed: passed + rest, pid }
}

function liveLines(output: string): string[] {
  return output
    .split('\n')
    .filter(line => line.trim() !== '')
    .slice(-LIVE_LINES_LOCAL)
}

export async function startLocal($: EngineInterface, todo: Todo): Promise<void> {
  let token = newToken()
  while (jobs.has(token)) token = newToken()
  const logPath = `${await logFolder($)}/${await $.session.id()}-${todo.id}-${token}.log`
  await $.fs.write(logPath, '')
  // A rerun replaces logPath, so the last run's file would otherwise outlive the item.
  if (todo.logPath) await $.process.run(['rm', '-f', '--', todo.logPath]).catch(() => undefined)
  const job: Job = { isStopped: false, isGone: false }
  jobs.set(token, job)
  await patchTodo($, todo.id, { token, logPath, liveTail: [], isStopping: false })

  let output = ''
  let isTrimmed = false
  let held = ''
  let revision = 0
  let written = 0
  let isWriteFailed = false
  const append = (text: string) => {
    output += text
    if (output.length > WINDOW) {
      output = output.slice(-WINDOW)
      isTrimmed = true
    }
    revision += 1
  }
  let queue: Promise<void> = Promise.resolve()
  const writeOut = async () => {
    if (job.isGone || revision === written) return
    written = revision
    try {
      await $.fs.write(logPath, isTrimmed ? `${DROPPED}${output}` : output)
    } catch {
      if (!isWriteFailed) $.ui.toast(`Could not save the output of #${todo.id}`)
      isWriteFailed = true
    }
    await patchTodo($, todo.id, { liveTail: clipLines(liveLines(output)) }).catch(() => undefined)
  }
  // Writes queue up so a late timer flush can never overwrite the final one.
  const flush = () => (queue = queue.then(writeOut))
  const ticker = $.clock.every(FLUSH_MS, () => {
    void flush()
  })

  const child = $.process.spawn({
    argv: ['/bin/zsh', '-lc', `print -u2 "__human_todo_pid__$$"; ${todo.script ?? ''}`],
    cwd: todo.cwd,
  })
  let step
  try {
    step = await child.next()
  } catch (err) {
    ticker.cancel()
    jobs.delete(token)
    await $.process.run(['rm', '-f', '--', logPath]).catch(() => undefined)
    await patchTodo($, todo.id, { token: undefined, logPath: undefined }).catch(() => undefined)
    throw err
  }

  let exitCode = -1
  try {
    while (!step.done) {
      if (job.pid === undefined && step.value.stream === 'stderr') {
        const scanned = scanStderr(held, step.value.text)
        held = scanned.held
        append(scanned.passed)
        if (scanned.pid !== undefined) {
          job.pid = scanned.pid
          if (job.isGone) await signal($, job.pid)
        }
      } else {
        append(step.value.text)
      }
      step = await child.next()
    }
    exitCode = step.value.code ?? (step.value.signal ? 130 : -1)
  } catch (err) {
    append(`\n${String(err)}`)
  }
  append(held)
  ticker.cancel()
  jobs.delete(token)
  if (job.isGone) return
  await flush()
  await report($, todo, job.isStopped ? { kind: 'stopped', outputTail: output } : { kind: 'ran', exitCode, outputTail: output })
}

export async function stopLocal($: EngineInterface, todo: Todo): Promise<void> {
  const job = todo.token ? jobs.get(todo.token) : undefined
  if (job?.pid === undefined) {
    await patchTodo($, todo.id, { isStopping: false })
    $.ui.toast('Still starting; try Stop again in a moment')
    return
  }
  job.isStopped = true
  try {
    await signal($, job.pid)
  } catch {
    job.isStopped = false
    await patchTodo($, todo.id, { isStopping: false })
    $.ui.toast(`Could not stop #${todo.id}`)
  }
}

// Local items have no Show button.
export async function showLocal(_$: EngineInterface, _todo: Todo): Promise<void> {}

// The mod API has no delete, so the log goes through rm.
export async function cleanupLocal($: EngineInterface, todo: Todo): Promise<void> {
  const job = todo.token ? jobs.get(todo.token) : undefined
  try {
    if (job) {
      job.isGone = true
      if (job.pid !== undefined) await signal($, job.pid)
    }
  } finally {
    if (todo.logPath) await $.process.run(['rm', '-f', '--', todo.logPath])
  }
}
