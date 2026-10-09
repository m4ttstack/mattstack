import { describe, expect, test } from 'claude-code/testing'
import { register } from '../hooks/register.ts'
import { CLAUDE_ONLY_TAIL, REPLY_RULE_SECTION, SPILL_READ_SECTION, trimClaudeOnlyReply } from '../src/blocks/sections.ts'
import { flush, harness as stub, type Respond } from './stub.ts'

/** The plugin as hooks.json loads it, over the stubbed engine. */
function harness(options: Parameters<typeof stub>[0] = {}) {
  const h = stub(options)
  register(h.on, {})
  return h
}

const STEER = 'reply via rt chat post <room> "..." or rt chat dm max.k3f9 "..."'
const BODY = `[#general] max #17: ship it\n${STEER} ${CLAUDE_ONLY_TAIL}`
const TRIMMED = `[#general] max #17: ship it\n${STEER}`
/** wrapCrossSession's bytes, as lib/daemon/inbox.ts writes them. */
const envelope = (body = BODY, id = 'd-17-remy') =>
  `<cross-session-message from-name="max (#general)" delivery-id="${id}">\n${body}\n</cross-session-message>`
const peer = (text: string) => ({ origin: { kind: 'peer' }, text })

const ENGINE_SECTIONS = [
  { id: 'intro', text: 'You are Claude Code.', scope: 'shared' },
  { id: 'memory', text: 'Remember things.', scope: 'session' },
]
const REPLY_SECTION = { id: 'mattstack-mods:reply-rule', text: REPLY_RULE_SECTION, scope: 'session' }
const SPILL_SECTION = { id: 'mattstack-mods:spill-read', text: SPILL_READ_SECTION, scope: 'session' }
const CORE_SECTIONS = [REPLY_SECTION, SPILL_SECTION]

function compose(h: ReturnType<typeof stub>, traits: string[] = []) {
  const e = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits }
  return h.fire('prompt.compose', e, async () => ({ sections: ENGINE_SECTIONS }))
}

/** Hands one delivery to the plugin and answers with what the engine beneath was given. */
async function deliver(h: ReturnType<typeof stub>, text = envelope()) {
  const delivery = peer(text)
  const seen: any[] = []
  await h.fire('session.receive', delivery, async (e: any) => {
    seen.push(e)
    return { text: e.text }
  })
  await flush()
  return { delivery, queued: seen[0] }
}

const keepNoBlocks: Respond = verb =>
  verb === 'session:register' ? { ok: true, data: { linkId: 'ml-1', blocks: [] } } : { ok: true, data: {} }

describe('reply rule section', () => {
  test('the section is composed for a new conversation and sets sectionComposed', async () => {
    const h = harness()
    await h.start()
    await h.sessionStart('startup')
    expect(h.state.get('sectionComposed')).not.toBe(true)

    expect(await compose(h)).toEqual({ sections: [...ENGINE_SECTIONS, ...CORE_SECTIONS] })
    expect(h.state.get('sectionComposed')).toBe(true)

    const { queued } = await deliver(h)
    expect(queued.text).toBe(envelope(TRIMMED))
    expect(queued.text.endsWith('\n</cross-session-message>')).toBe(true)

    // A /clear starts a conversation of its own: the full line until its prompt carries the section.
    await h.clear('sess-2')
    expect(h.state.get('sectionComposed')).toBe(false)
    expect((await deliver(h, envelope(BODY, 'd-18-remy'))).queued.text).toBe(envelope(BODY, 'd-18-remy'))
    await compose(h)
    expect(h.state.get('sectionComposed')).toBe(true)
    expect((await deliver(h, envelope(BODY, 'd-19-remy'))).queued.text).toBe(envelope(TRIMMED, 'd-19-remy'))

    // A compaction continues the same conversation.
    await h.sessionStart('compact')
    expect(h.state.get('sectionComposed')).toBe(true)
  })

  test('the spill-read section is present for a new conversation', async () => {
    for (const opening of [(h: ReturnType<typeof stub>) => h.sessionStart('startup'), (h: ReturnType<typeof stub>) => h.clear('sess-2')]) {
      const h = harness()
      await h.start()
      await opening(h)
      const { sections } = await compose(h)
      expect(sections.filter((s: { id: string }) => s.id === 'mattstack-mods:spill-read')).toEqual([SPILL_SECTION])
    }

    // The note is not a block's: a session whose daemon keeps no block still gets it.
    const h = harness({ respond: keepNoBlocks })
    await h.start()
    await h.sessionStart('startup')
    expect((await compose(h)).sections).toContainEqual(SPILL_SECTION)
  })

  test('a resumed conversation without the marker keeps the full reply line', async () => {
    for (const source of ['resume', 'fork']) {
      const h = harness()
      await h.start()
      await h.sessionStart(source)
      expect(await compose(h)).toEqual({ sections: [...ENGINE_SECTIONS, ...CORE_SECTIONS] })
      expect(h.state.get('sectionComposed')).not.toBe(true)
      const { delivery, queued } = await deliver(h)
      expect(queued).toBe(delivery)
    }

    // A conversation that switches to a resumed one in the same process drops the marker it had.
    const h = harness()
    await h.start()
    await h.sessionStart('startup')
    await compose(h)
    expect(h.state.get('sectionComposed')).toBe(true)
    await h.sessionStart('resume', 'sess-9')
    expect(h.state.get('sectionComposed')).toBe(false)
    await compose(h)
    const { delivery, queued } = await deliver(h)
    expect(queued).toBe(delivery)

    // Loaded into a conversation already under way: no SessionStart, so nothing marks it.
    const late = harness()
    await late.start()
    await compose(late)
    expect(late.state.get('sectionComposed')).not.toBe(true)
    const midway = await deliver(late)
    expect(midway.queued).toBe(midway.delivery)
  })

  test('a teammate compose gets no reply-rule section', async () => {
    // SendMessage is how an in-process teammate reports to its lead.
    const h = harness()
    await h.start()
    await h.sessionStart('startup')
    expect(await compose(h, ['teammate'])).toEqual({ sections: ENGINE_SECTIONS })
    expect(await compose(h, ['skills', 'teammate'])).toEqual({ sections: ENGINE_SECTIONS })
    expect(h.state.get('sectionComposed')).not.toBe(true)
    expect(await compose(h, ['skills'])).toEqual({ sections: [...ENGINE_SECTIONS, ...CORE_SECTIONS] })
    expect(h.state.get('sectionComposed')).toBe(true)
  })

  test('an analysis compose neither carries the section nor sets the marker', async () => {
    const h = harness()
    await h.start()
    await h.sessionStart('startup')
    expect(await compose(h, ['analysis'])).toEqual({ sections: ENGINE_SECTIONS })
    expect(h.state.get('sectionComposed')).not.toBe(true)
    const { delivery, queued } = await deliver(h)
    expect(queued).toBe(delivery)

    expect(await compose(h)).toEqual({ sections: [...ENGINE_SECTIONS, ...CORE_SECTIONS] })
    expect(h.state.get('sectionComposed')).toBe(true)
  })

  test('trim removes only the Claude-only tail', () => {
    expect(trimClaudeOnlyReply(BODY)).toBe(TRIMMED)

    const passedOn = `[#general] kai #3: hi\nreply via rt chat post dm-1a2b "..." ${CLAUDE_ONLY_TAIL}`
    expect(trimClaudeOnlyReply(passedOn)).toBe('[#general] kai #3: hi\nreply via rt chat post dm-1a2b "..."')

    const batched = [
      '[#general] max #17: one',
      '[#general] remy #18: two',
      `reply via rt chat post <room> "..." or rt chat dm <id> "..." ${CLAUDE_ONLY_TAIL}`,
      '  reply to max: rt chat dm max.k3f9 "..."',
      '  reply to kai: rt chat post general "..." (the name kai now reaches another agent)',
    ].join('\n')
    expect(trimClaudeOnlyReply(batched)).toBe(batched.replace(` ${CLAUDE_ONLY_TAIL}`, ''))

    // A message that quotes the tail keeps it: only the reply line rt appended is trimmed.
    const quoting = `[#general] max #17: it said ${CLAUDE_ONLY_TAIL}\n${STEER} ${CLAUDE_ONLY_TAIL}`
    expect(trimClaudeOnlyReply(quoting)).toBe(`[#general] max #17: it said ${CLAUDE_ONLY_TAIL}\n${STEER}`)
    const noSteer = `[#general] max #17: reply via rt chat post x "..." ${CLAUDE_ONLY_TAIL}\n[#general] max #18: bye`
    expect(trimClaudeOnlyReply(noSteer)).toBe(noSteer)

    for (const text of ['', 'plain text', TRIMMED, `${BODY}\n`, `${BODY} `]) expect(trimClaudeOnlyReply(text)).toBe(text)
    expect(trimClaudeOnlyReply(trimClaudeOnlyReply(BODY))).toBe(TRIMMED)
  })

  test('a session without the block gets today\'s line', async () => {
    // The daemon keeps no block: the section still states the rule, the delivery is untouched.
    const h = harness({ respond: keepNoBlocks })
    await h.start()
    await h.sessionStart('startup')
    await compose(h)
    const { delivery, queued } = await deliver(h)
    expect(queued).toBe(delivery)

    // An engine below the tested range, or a session with nobody at the prompt: no section, no edit.
    for (const old of [true, false]) {
      const off = harness(old ? { version: '2.1.292' } : {})
      await off.start(old)
      await off.sessionStart('startup')
      expect(await compose(off)).toEqual({ sections: ENGINE_SECTIONS })
      expect(off.state.get('sectionComposed')).not.toBe(true)
      const passed = await deliver(off)
      expect(passed.queued).toBe(passed.delivery)
    }
  })
})
