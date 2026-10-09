import { describe, expect, test } from 'claude-code/testing'
import { NOT_LIVE, registerBoard, STATUS_TOOL_NAME, STATUS_TIMEOUT_MS } from '../src/blocks/board.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { flush, harness as stub, recorder } from './stub.ts'

const BIN = '/Applications/mattstack.app/Contents/Helpers/board'
const STATE = '/u/.mattstack/board/doctors/mr-12.json'

function harness(options: Parameters<typeof stub>[0] = { env: { MATTSTACK_BOARD_STATUS_BIN: BIN } }) {
  const h = stub(options)
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerBoard(hub, link)
  attachHub(h.on, hub)
  return { ...h, hub, link }
}

const status = (input: Record<string, unknown>) => ({ tool: STATUS_TOOL_NAME, tool_use_id: 'tu-s', ...input })
const bash = (id: string) => ({ tool: 'Bash', tool_use_id: id, command: 'sleep 600' })
const STOP = { session_id: 'sess-1', transcript_path: '/t.jsonl', cwd: '/repo', hook_event_name: 'Stop', stop_hook_active: false }
const SHELL_TASK = { id: 'b-1', type: 'shell', status: 'running', description: 'sleep 600', command: 'sleep 600' }
const NOTICE = 'Operator stood down auto-doctor on this MR/stack. Stop and exit -- this pane will not be resumed automatically.'

const turnStart = (h: ReturnType<typeof stub>, turnId: string) => h.fire('turn.start', { text: 'go', turnId }, async () => ({ turnId }))
const turnEnd = (h: ReturnType<typeof stub>, turnId: string) =>
  h.fire('turn.complete', { answer: '', durationMs: 5, isAborted: false, turnId, reason: 'answer' }, async () => ({ text: '' }))
const stop = (h: ReturnType<typeof stub>, tasks: unknown[]) => h.fire('classic.Stop', { ...STOP, background_tasks: tasks }, async () => ({}))
const standDown = (id: string, link: string, data: unknown) =>
  ({ origin: { kind: 'peer' }, text: `<rt-mod-command id="${id}" kind="stand-down" link="${link}">${JSON.stringify(data)}</rt-mod-command>` })
const reports = (h: ReturnType<typeof stub>) => h.verbs('session:stood-down').map(s => s.body)

describe('board status tool', () => {
  test('status tool updates the run like status-bin', async () => {
    const h = harness()
    h.script.run = () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    await h.start()

    expect(h.hub.liveBlocks()).toEqual(['board'])
    expect(h.registered.map(t => t.name)).toEqual(['status'])
    expect(h.registered[0].isDeferred).toBe(false)

    const engine = recorder({ text: 'unused' })
    const result = await h.fire('tool.call', status({ verb: 'doctor-status', args: [STATE, 'rebasing', 'rebasing onto main'] }), engine.next)

    expect(result).toEqual({ result: 'doctor-status recorded' })
    expect(engine.seen).toHaveLength(0)
    // The board's own writer, its own verb and argv: the same write, validation and signal a Bash call makes.
    expect(h.ran).toEqual([
      { argv: [BIN, 'doctor-status', STATE, 'rebasing', 'rebasing onto main'], init: { env: { CLAUDE_CODE_SESSION_ID: 'sess-1' }, timeoutMs: STATUS_TIMEOUT_MS } },
    ])
  })

  test("a write the status writer refuses comes back as its own words", async () => {
    const h = harness()
    h.script.run = () => ({ exitCode: 1, stdout: '', stderr: 'usage: review-status <statePath> <queued|reviewing|done|error> [message]\n', isStdoutTruncated: false, isStderrTruncated: false })
    await h.start()

    const result = await h.fire('tool.call', status({ verb: 'review-status', args: [STATE, 'reviwing'] }), recorder({}).next)
    expect(result).toEqual({ deny: 'review-status exited 1: usage: review-status <statePath> <queued|reviewing|done|error> [message]' })
    expect(h.hub.liveBlocks()).toEqual(['board'])
  })

  test('only the three status verbs run, with string arguments', async () => {
    const h = harness()
    await h.start()
    for (const input of [
      { verb: 'gate', args: ['open', STATE] },
      { verb: 'review-status', args: [] },
      { verb: 'review-status', args: [STATE, 3] },
      { verb: 'review-status' },
    ]) {
      const result = await h.fire('tool.call', status(input), recorder({}).next)
      expect(typeof result.deny).toBe('string')
    }
    expect(h.ran).toHaveLength(0)
  })

  test('a writer that cannot start sends the model back to status-bin', async () => {
    const h = harness()
    h.script.run = () => new Error('ENOENT')
    await h.start()

    const result = await h.fire('tool.call', status({ verb: 'respond-status', args: [STATE, 'drafting'] }), recorder({}).next)
    expect(result.deny).toContain(NOT_LIVE)
  })

  test('a pane the board did not launch gets no tool and no block', async () => {
    const h = harness({})
    await h.start()

    expect(h.hub.liveBlocks()).toEqual([])
    expect(h.registered).toHaveLength(0)
  })

  test('a call once the block is cleared is answered with the status-bin fallback', async () => {
    const h = harness()
    h.script.respond = (verb, body) =>
      verb === 'session:register' ? { ok: true, data: { linkId: 'ml-1', blocks: [] } } : h.defaults(verb, body)
    await h.start()

    expect(h.hub.liveBlocks()).toEqual([])
    const engine = recorder({ text: 'unused' })
    expect(await h.fire('tool.call', status({ verb: 'review-status', args: [STATE, 'reviewing'] }), engine.next)).toEqual({ deny: NOT_LIVE })
    expect(engine.seen).toHaveLength(0)
    expect(h.ran).toHaveLength(0)
  })
})

describe('board stand-down', () => {
  test('stand-down stops the turn', async () => {
    const h = harness()
    await h.start()
    await turnStart(h, 't-1')

    const engine = recorder({ text: 'unused' })
    const result = await h.fire('session.receive', standDown('cmd-1', 'ml-1', { text: NOTICE }), engine.next)
    await flush()

    expect(result.consumed).toBeDefined()
    expect(engine.seen).toHaveLength(0)
    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'cmd-1' }])
    expect(h.aborted).toEqual(['t-1'])
    expect(reports(h)).toEqual([{ commandId: 'cmd-1', state: 'stood-down', linkId: 'ml-1' }])
    expect(h.submitted).toEqual([{ text: NOTICE }])
  })

  test('an idle session stands down with nothing to abort', async () => {
    const h = harness()
    await h.start()
    await turnStart(h, 't-1')
    await turnEnd(h, 't-1')

    await h.fire('session.receive', standDown('cmd-2', 'ml-1', { text: NOTICE }), recorder({}).next)
    await flush()

    expect(h.aborted).toEqual([])
    expect(reports(h)).toEqual([{ commandId: 'cmd-2', state: 'stood-down', linkId: 'ml-1' }])
  })

  test('a Bash call the abort leaves running reads as background work until a turn ends with none', async () => {
    const h = harness()
    await h.start()
    await turnStart(h, 't-1')
    let finish!: (v: unknown) => void
    const running = h.fire('tool.call', bash('tu-b'), () => new Promise(resolve => (finish = resolve)))
    await flush()

    await h.fire('session.receive', standDown('cmd-3', 'ml-1', { text: NOTICE }), recorder({}).next)
    await flush()
    expect(h.aborted).toEqual(['t-1'])
    expect(reports(h)).toEqual([{ commandId: 'cmd-3', state: 'stood-down-background', linkId: 'ml-1' }])

    // The notice's own turn ends while the shell still runs: still finishing.
    finish({ text: 'moved to the background' })
    await running
    await turnStart(h, 't-2')
    await stop(h, [SHELL_TASK])
    await turnEnd(h, 't-2')
    await flush()
    expect(reports(h)).toHaveLength(1)

    // The shell's completion wakes the session; that turn ends with nothing left.
    await turnStart(h, 't-3')
    await stop(h, [])
    await turnEnd(h, 't-3')
    await flush()
    expect(reports(h).at(-1)).toEqual({ commandId: 'cmd-3', state: 'background-finished', linkId: 'ml-1' })
  })

  test('background work the last Stop listed counts too', async () => {
    const h = harness()
    await h.start()
    await turnStart(h, 't-1')
    await stop(h, [SHELL_TASK])
    await turnEnd(h, 't-1')

    await h.fire('session.receive', standDown('cmd-4', 'ml-1', {}), recorder({}).next)
    await flush()

    expect(reports(h)).toEqual([{ commandId: 'cmd-4', state: 'stood-down-background', linkId: 'ml-1' }])
    expect(h.submitted).toEqual([])
  })

  test('a turn the engine will not abort still stands down', async () => {
    const h = harness()
    h.script.abort = () => new Error('turn t-1 is not the running turn')
    await h.start()
    await turnStart(h, 't-1')

    await h.fire('session.receive', standDown('cmd-5', 'ml-1', { text: NOTICE }), recorder({}).next)
    await flush()

    expect(reports(h)).toEqual([{ commandId: 'cmd-5', state: 'stood-down', linkId: 'ml-1' }])
    expect(h.hub.liveBlocks()).toEqual(['board'])
  })

  test('without the block live a stand-down is not acked, so rt takes its own path', async () => {
    const h = harness({})
    await h.start()
    await turnStart(h, 't-1')

    await h.fire('session.receive', standDown('cmd-6', 'ml-1', { text: NOTICE }), recorder({}).next)
    await flush()

    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(h.aborted).toEqual([])
    expect(reports(h)).toEqual([])
  })
})
