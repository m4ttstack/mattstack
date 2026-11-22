import type { EngineInterface, On } from 'claude-code'

import { busyTasks, type TaskLike } from './busy'
import { cancelChat, completeChat } from './chat'
import { ledgerMessage, type Carry } from './carry'

const CARRY = { plugin: 'fresh-context', key: 'carry' } as const

// The module keeps running across a /clear, so the queued reset lives here; $.state holds a copy
// for a reload of the mod, which starts the module's variables over.
let pending: Carry | null = null
let lastStopTasks: TaskLike[] = []
let isFiring = false

export const isQueued = () => pending !== null

export async function busyNow($: EngineInterface): Promise<string[]> {
  return busyTasks(await $.agent.list(), lastStopTasks)
}

export async function queue($: EngineInterface, carry: Carry): Promise<void> {
  pending = carry
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

// A prompt that starts with / would run as the person; the command API runs it as the mod.
async function submit($: EngineInterface, text: string): Promise<void> {
  const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text)
  if (slash?.[1]) await $.command.run({ command: slash[1], ...(slash[2] ? { args: slash[2] } : {}) })
  else await $.prompt.submit({ text })
}

async function abandon($: EngineInterface, carry: Carry, why: string): Promise<void> {
  await drop($)
  if (carry.chatHandle) await cancelChat($, carry.oldSessionId, await $.session.id())
  notice($, `fresh_context did not run: ${why}`)
}

async function handOver($: EngineInterface, carry: Carry, sessionId: string): Promise<void> {
  await drop($)
  if (carry.chatHandle && !(await completeChat($, carry.oldSessionId, sessionId))) {
    await cancelChat($, carry.oldSessionId, sessionId)
  }
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: ledgerMessage(carry.ledger) }] } })
  if (carry.then) await submit($, carry.then)
}

async function runReset($: EngineInterface, carry: Carry): Promise<void> {
  if (carry.mode === 'clear') {
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
  if (value.oldSessionId === current) pending = value
  else await handOver($, value, current)
}

export function registerReset(on: On): void {

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    lastStopTasks = e.background_tasks ?? []
    const carry = pending
    if (!carry || isFiring) return result
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
    if (carry.chatHandle) await cancelChat($, carry.oldSessionId, e.sessionId)
    return ended
  })
}
