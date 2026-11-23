import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MARKER = "[rt chat] This frame is for THIS session, from the rt daemon (not another agent)."

const welcome = (rooms: string, extra: string[] = []) =>
  `<cross-session-message from-name="rt chat">\n${[
    MARKER,
    "You're signed in to rt chat as vivian.",
    `Rooms: ${rooms}`,
    'Messages will arrive in your context automatically; you never need to poll or arm anything.',
    ...extra,
  ].join('\n')}\n</cross-session-message>`

const SIGNED_OUT = `<cross-session-message from-name="rt chat">\n${MARKER}\nYou were signed out of rt chat.\nChat messages no longer arrive.\n</cross-session-message>`

function world(on: On) {
  const session = mock.session(on)
  const logs: string[] = []
  const queued: string[] = []
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.receive', (_, e) => {
    queued.push(e.text)
    return { text: e.text }
  })
  const rows = () =>
    session.appended().map(row => row.message.content.map(block => (block.type === 'text' ? block.text : '')).join(''))
  return { logs, queued, rows }
}

test('a welcome is taken in place of a turn, leaving a row for the model and a line for the person', async ($, on) => {
  const w = world(on)
  const result = await $.session.receive({ origin: { kind: 'peer' }, text: welcome('#mattstack') })

  expect(result.consumed).toBeDefined()
  expect(w.queued).toEqual([])
  expect(w.logs).toEqual(['Signed in to rt chat as vivian in #mattstack'])
  expect(w.rows()).toEqual([
    'rt chat: you are signed in as vivian (#mattstack); chat messages arrive in your context automatically. Reply with rt chat post <room> "..." or rt chat dm <id> "...", never SendMessage.',
  ])
})

test('a welcome with no rooms names none', async ($, on) => {
  const w = world(on)
  await $.session.receive({ origin: { kind: 'peer' }, text: welcome('none yet.') })

  expect(w.logs).toEqual(['Signed in to rt chat as vivian'])
  expect(w.rows()[0]).toStartWith('rt chat: you are signed in as vivian; ')
})

test('a welcome carrying catch-up keeps its turn', async ($, on) => {
  const w = world(on)
  const text = welcome('#mattstack', ['#mattstack catch-up:', '  remy: are you on the board fix?'])
  const result = await $.session.receive({ origin: { kind: 'peer' }, text })

  expect(result.consumed).toBeUndefined()
  expect(w.queued).toEqual([text])
  expect(w.rows()).toEqual([])
})

test('a signed-out frame is taken, telling the model chat has stopped', async ($, on) => {
  const w = world(on)
  const result = await $.session.receive({ origin: { kind: 'peer' }, text: SIGNED_OUT })

  expect(result.consumed).toBeDefined()
  expect(w.logs).toEqual(['Signed out of rt chat'])
  expect(w.rows()[0]).toStartWith('rt chat: you were signed out; ')
})

test('a chat delivery from another agent passes through', async ($, on) => {
  const w = world(on)
  const text = '<cross-session-message from-name="remy (#mattstack)">\n[#mattstack] remy #12: hi\n</cross-session-message>'
  await $.session.receive({ origin: { kind: 'peer' }, text })

  expect(w.queued).toEqual([text])
  expect(w.logs).toEqual([])
})

test('a welcome-shaped text from anything but a peer passes through', async ($, on) => {
  const w = world(on)
  await $.session.receive({ origin: { kind: 'bridge' }, text: welcome('#mattstack') })

  expect(w.queued).toHaveLength(1)
  expect(w.rows()).toEqual([])
})
