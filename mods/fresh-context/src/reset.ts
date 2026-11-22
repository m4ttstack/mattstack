import type { EngineInterface, On } from 'claude-code'

import { busyTasks, type TaskLike } from './busy'
import { beginChat, cancelChat, completeChat } from './chat'
import { ledgerMessage, type Carry } from './carry'

const CARRY = { plugin: 'fresh-context', key: 'carry' } as const

// The module keeps running across a /clear, so the queued reset lives here; $.state holds a copy
// for a reload of the mod, which starts the module's variables over.
let pending: Carry | null = null
let lastStopTasks: TaskLike[] = []
let isFiring = false

let isClaiming = false

/** Holds the single queued-reset slot while a call checks and queues; false when it is taken. */
export function claim(): boolean {
  if (pending !== null || isClaiming) return false
  isClaiming = true
  return true
}

export function release(): void {
  isClaiming = false
}

export async function busyNow($: EngineInterface): Promise<string[]> {
  return busyTasks(await $.agent.list(), lastStopTasks)
}

export async function queue($: EngineInterface, carry: Carry): Promise<void> {
  pending = carry
  isClaiming = false
  isFiring = false
  await $.state.set(CARRY, carry)
}

async function drop($: EngineInterface): Promise<void> {
  pending = null
  isFiring = false
  await $.state.set(CARRY, null)
}

// A prompt submitted from a hook the turn waits on would wait on that turn, so it goes after.
function notice($: EngineInterface, text: string): void {
  $.clock.after(0, () => {
    void $.prompt.submit({ text })
  })
}

// The host refuses a prompt from a mod that starts with /, so a slash command goes through the command API.
async function submit($: EngineInterface, text: string): Promise<void> {
  const slash = /^\/([\w:-]+)(?:\s+([\s\S]*))?$/.exec(text)
  if (slash?.[1]) await $.command.run({ command: slash[1], ...(slash[2] ? { args: slash[2].trim() } : {}) })
  else await $.prompt.submit({ text: text.startsWith('/') ? `Next step from before the reset: ${text}` : text })
}

async function abandon($: EngineInterface, carry: Carry, why: string): Promise<void> {
  await drop($)
  if (carry.chatHandle) await cancelChat($, carry.oldSessionId, await $.session.id())
  notice($, `fresh_context did not run: ${why}`)
}

// Adds text to the fresh context without starting a turn; a refused append still gets it in, as a prompt.
async function hold($: EngineInterface, text: string): Promise<void> {
  let appended: Awaited<ReturnType<EngineInterface['session']['append']>> | undefined
  try {
    appended = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  } catch {
    appended = undefined
  }
  if (!appended || appended.deny !== undefined) await $.prompt.submit({ text })
}

async function handOver($: EngineInterface, carry: Carry, sessionId: string): Promise<void> {
  // One hand-over per carry, whichever cue arrives first.
  if (pending !== carry) return
  pending = null
  await hold($, ledgerMessage(carry.ledger))
  await drop($)
  if (carry.chatHandle) {
    const welcome = await completeChat($, carry.oldSessionId, sessionId)
    if (welcome === null) await cancelChat($, carry.oldSessionId, sessionId)
    else if (welcome) await hold($, welcome)
  }
  if (carry.then) await submit($, carry.then)
}

async function runReset($: EngineInterface, queued: Carry): Promise<void> {
  let carry = queued
  if (carry.mode === 'clear') {
    // Begun right before the clear, so no earlier exit path leaves a hand-off waiting on a clear that never runs.
    const handle = await beginChat($, carry.oldSessionId, carry.createdAt)
    // The reset was dropped while begin was in flight (an interrupted turn, an exit): no clear,
    // and a hand-off that did begin is cancelled.
    if (pending !== queued) {
      if (handle) await cancelChat($, carry.oldSessionId, await $.session.id())
      return
    }
    if (handle) {
      carry = { ...carry, chatHandle: handle }
      await queue($, carry)
      isFiring = true
    }
    try {
      await $.command.run({ command: 'clear' })
    } catch (err) {
      await abandon($, carry, `the clear was refused (${String(err)})`)
    }
    return
  }
  let compacted: Awaited<ReturnType<EngineInterface['session']['compact']>>
  try {
    compacted = await $.session.compact({ instructions: carry.ledger })
  } catch (err) {
    await abandon($, carry, `the compaction failed (${String(err)})`)
    return
  }
  if ('skip' in compacted && compacted.skip) {
    await abandon($, carry, `the compaction was skipped (${compacted.skip})`)
    return
  }
  await handOver($, carry, await $.session.id())
}

/** After a reload of the mod: re-arm a reset still to run, or finish one whose clear already happened. */
export async function resumeCarry($: EngineInterface): Promise<void> {
  const { value } = await $.state.get(CARRY)
  if (!value) return
  const current = await $.session.id()
  pending = value
  // A command or prompt from inside session.start would wait on that hook.
  if (value.oldSessionId !== current) $.clock.after(0, () => void handOver($, value, current))
}

export function registerReset(on: On): void {

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    lastStopTasks = e.background_tasks ?? []
    const carry = pending
    if (!carry) return result
    // A hook beneath that keeps the turn going means this was not the turn's end.
    if (result.block || result.preventContinuation) return result
    if (isFiring) {
      // A turn ended again in the session that asked for the clear: the clear never happened.
      if (carry.mode === 'clear' && carry.oldSessionId === (await $.session.id())) await abandon($, carry, 'the clear did not happen')
      return result
    }
    if (carry.mode === 'clear') {
      const busy = await busyNow($)
      if (busy.length > 0) {
        await abandon($, carry, `still running\n${busy.join('\n')}`)
        return result
      }
    }
    isFiring = true
    // $.command.run and $.session.compact are refused inside a hook the turn waits on.
    $.clock.after(0, () => {
      void runReset($, carry)
    })
    return result
  })

  // Stop does not run for a turn the user interrupted or an API error ended, so the reset would
  // otherwise fire at some later, unrelated turn's end.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const carry = pending
    if (carry && !isFiring && !e.agentId && (e.reason === 'aborted' || e.reason === 'error')) {
      await drop($)
      if (carry.chatHandle) await cancelChat($, carry.oldSessionId, await $.session.id())
    }
    return result
  })

  // A /clear starts the next session in this same process: that is the hand-over's cue.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    const carry = pending
    if (carry?.mode === 'clear' && e.source === 'clear' && e.session_id !== carry.oldSessionId) {
      $.clock.after(0, () => {
        void handOver($, carry, e.session_id)
      })
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    const carry = pending
    if (!carry || carry.oldSessionId !== e.sessionId) return ended
    if (carry.mode === 'clear' && e.reason === 'clear') return ended
    await drop($)
    if (carry.chatHandle) await cancelChat($, carry.oldSessionId, e.sessionId, { onExit: true })
    return ended
  })
}
