import { describe, expect, test } from 'bun:test'
import type { ClientElements, ClientKeyEvent, ClientPointerEvent, ClientSurface, JsonValue } from 'claude-code'

import { renderLines } from '../draw/render'
import { hoverKeyAt, sp, widthOf, type Line } from '../draw/text'
import { ACCENT, BRAND, FILL, SYMBOL, muted } from '../draw/theme'
import type { PointerState } from '../interact/pointer'
import { brandBar } from '../widgets/brand-bar'
import { buttonRow, buttonSpan } from '../widgets/buttons'
import { selectList } from '../widgets/select-list'
import { BrandBar } from './brand-bar'
import { Button, ButtonRow } from './buttons'
import { drawKit } from './core'
import { kitClient } from './client'
import { InputField } from './input-field'
import { Lines, Row, Span } from './lines'
import { PageShell } from './page-shell'
import { Panel } from './panel'
import { Rail } from './rail'
import { SelectList } from './select-list'
import { TabStrip } from './tab-strip'
import { Unfocused } from './unfocused'

const ELEMENTS = { Box: 'Box', Text: 'Text' } as unknown as ClientElements
const draw = (tree: () => unknown, frame: { focused?: boolean } = {}) => drawKit({ elements: ELEMENTS, look: { focused: frame.focused ?? true }, width: 40, focused: frame.focused ?? true }, tree)
const textOf = (line: Line<unknown>) => line.map(span => span.t).join('')
const press = (handlers: Map<string, () => void>, line: Line<string> | undefined, label: string) => {
  const span = line?.find(s => s.t.includes(label))
  expect(span?.action).toBeDefined()
  handlers.get(span!.action!)!()
}
// What a drawn tree holds anywhere, so a test can say a marker never reached it.
const keysIn = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(keysIn)
  if (node === null || typeof node !== 'object') return []
  const props = (node as { props?: { key?: unknown; children?: unknown } }).props
  return [...(typeof props?.key === 'string' ? [props.key] : []), ...keysIn(props?.children)]
}

describe('Panel', () => {
  test('lays out a brand bar and a button row as lines', () => {
    const { lines } = draw(() => (
      <Panel width={40}>
        <BrandBar title="t" />
        <ButtonRow>
          <Button tone="brand">Open</Button>
        </ButtonRow>
      </Panel>
    ))
    expect(lines[0]!.map(s => s.t)).toEqual(brandBar('t', 40).map(s => s.t))
    expect(lines[1]!.some(span => span.bg === BRAND.pink && span.t === '  Open  ')).toBe(true)
  })

  test('the drawn tree holds no kit marker', () => {
    const { tree } = draw(() => (
      <Panel width={40}>
        <BrandBar title="t" onHide={() => {}} />
        <ButtonRow right={<Button>Chat</Button>}>
          <Button>Back</Button>
        </ButtonRow>
      </Panel>
    ))
    expect(keysIn(tree).filter(key => key.startsWith('kit:'))).toEqual([])
  })

  test('a bare string child is a plain line', () => {
    const { lines } = draw(() => <Panel>hello</Panel>)
    expect(lines.map(textOf)).toEqual(['hello'])
  })
})

describe('controls', () => {
  test('a button press runs its onPress; a disabled one takes no click', () => {
    const pressed: string[] = []
    const { lines, handlers } = draw(() => (
      <Panel width={60}>
        <ButtonRow right={<Button tone="neutral" onPress={() => pressed.push('chat')}>Chat</Button>}>
          <Button disabled onPress={() => pressed.push('back')}>Back</Button>
          <Button onPress={() => pressed.push('next')}>Next</Button>
        </ButtonRow>
      </Panel>
    ))
    press(handlers, lines[0], 'Next')
    press(handlers, lines[0], 'Chat')
    expect(lines[0]!.find(s => s.t.includes('Back'))?.action).toBeUndefined()
    expect(pressed).toEqual(['next', 'chat'])
    const widget = buttonRow([{ label: 'Back', action: 0, disabled: true }, { label: 'Next', action: 1 }], { label: 'Chat', action: 2, tone: 'neutral' }, 60)
    expect(lines[0]!.map(s => s.t)).toEqual(widget.map(s => s.t))
  })

  test('the brand bar hide button runs onHide', () => {
    let hidden = 0
    const { lines, handlers } = draw(() => (
      <Panel width={40}>
        <BrandBar title="t" onHide={() => (hidden += 1)} />
      </Panel>
    ))
    press(handlers, lines[0], 'Hide')
    expect(hidden).toBe(1)
  })

  test('a select list picks by index', () => {
    const picks: number[] = []
    const { lines, handlers } = draw(() => (
      <Panel width={40}>
        <SelectList choices={[{ label: 'One' }, { label: 'Two' }]} cursor={0} onPick={idx => picks.push(idx)} />
      </Panel>
    ))
    const two = lines.find(line => textOf(line).includes('Two'))!
    handlers.get(two.action!)!()
    expect(picks).toEqual([1])
  })

  test('a tab strip selects and scrolls', () => {
    const got: string[] = []
    const tabs = Array.from({ length: 10 }, (_, k) => ({ label: `Question ${k}` }))
    const { lines, handlers } = draw(() => (
      <Panel width={50}>
        <TabStrip tabs={tabs} current={0} from={0} onSelect={k => got.push(`tab ${k}`)} onScroll={from => got.push(`from ${from}`)} />
      </Panel>
    ))
    expect(widthOf(lines[0]!)).toBe(50)
    press(handlers, lines[0], 'Question 1')
    press(handlers, lines[0], '›')
    expect(got).toEqual(['tab 1', 'from 1'])
  })
})

describe('Unfocused', () => {
  test('draws its children muted and unclickable beside focused ones', () => {
    const { lines, tree } = draw(() => (
      <Panel width={40}>
        <Button tone="brand">Live</Button>
        <Unfocused>
          <Button tone="brand">Dim</Button>
          <SelectList choices={[{ label: 'One' }, { label: 'Two' }]} cursor={0} />
        </Unfocused>
      </Panel>
    ))
    const live = lines[0]!.find(s => s.t.includes('Live'))!
    const dim = lines[1]!.find(s => s.t.includes('Dim'))!
    expect(live.bg).toBe(BRAND.pink)
    expect(live.action).toBeDefined()
    expect(dim.bg).toBe(muted({ bg: BRAND.pink }).bg!)
    expect(lines.slice(1).every(line => line.action === undefined && line.every(s => s.action === undefined && s.isLabel === undefined))).toBe(true)
    expect(tree).toEqual(renderLines(lines, ELEMENTS, { focused: true }))
  })

  test('its children lay out as unfocused: an input field shows no cursor', () => {
    const { lines } = draw(() => (
      <Panel width={40}>
        <Unfocused>
          <InputField value="" placeholder="Type" width={20} />
        </Unfocused>
      </Panel>
    ))
    expect(lines[0]!.some(s => s.inverse)).toBe(false)
  })
})

describe('drawing pieces', () => {
  test('a rail with text hangs under the bar; without text it is the bar alone', () => {
    const { lines } = draw(() => (
      <Panel width={40}>
        <Rail color="cyan" />
        <Rail color="cyan">pick any number</Rail>
      </Panel>
    ))
    expect(lines.map(textOf)).toEqual([SYMBOL.bar, `${SYMBOL.bar}  pick any number`])
    expect(lines[1]![0]!.color).toBe(ACCENT.color)
  })

  test('an input field fills the width it is given', () => {
    const { lines } = draw(() => (
      <Panel width={40}>
        <InputField value="" placeholder="Type here" width={20} />
      </Panel>
    ))
    expect(widthOf(lines[0]!)).toBe(20)
    expect(lines[0]![0]!.bg).toBe(FILL.field.bg)
  })

  test('a row draws spans, text and a button on one line, as the reopen band did', () => {
    const { lines } = draw(() => (
      <Panel>
        <Row>
          <Span color={BRAND.pink} bold>
            {'G label  '}
          </Span>
          <Span>Title</Span>
          <Span>{'  '}</Span>
          <Button tone="brand">Open</Button>
        </Row>
      </Panel>
    ))
    const band = [sp('G label  ', { color: BRAND.pink, bold: true }), sp('Title'), sp('  '), buttonSpan({ label: 'Open', action: 'x', tone: 'brand' })]
    expect(lines).toHaveLength(1)
    expect(lines[0]!.map(({ action, ...rest }) => rest)).toEqual(band.map(({ action, ...rest }) => rest))
  })

  test('lines pass through with their actions mapped to the handler', () => {
    type Act = { go: number }
    const got: Act[] = []
    const raw: Line<Act>[] = [[sp('a', { action: { go: 1 } })], Object.assign([sp('b')], { action: { go: 2 } }), Object.assign([sp('c')], { action: { go: 2 } })]
    const { lines, handlers } = draw(() => (
      <Panel>
        <Lines lines={raw} onAction={a => got.push(a)} />
      </Panel>
    ))
    expect(lines.map(textOf)).toEqual(['a', 'b', 'c'])
    expect(lines[1]!.action).toBe(lines[2]!.action!)
    handlers.get(lines[0]![0]!.action!)!()
    handlers.get(lines[2]!.action!)!()
    expect(got).toEqual([{ go: 1 }, { go: 2 }])
  })

  test('lines in a Panel draw exactly as renderLines draws them, under the pointer anywhere and focused or not', () => {
    type Act = { type: string; n?: number }
    const raw: Line<Act>[] = [
      ...selectList<Act>({ choices: [{ label: 'One', description: 'first' }, { label: 'Two' }], cursor: 0, multi: false, isPicked: () => false, cursorIsChoice: true, writeIn: '', width: 40, focused: true, actionFor: n => ({ type: 'option', n }) }),
      buttonRow<Act>([{ label: 'Back', action: { type: 'page', n: 0 } }, { label: 'Next', action: { type: 'page', n: 1 } }], { label: 'Chat', action: { type: 'chat' } }, 40),
    ]
    const drawLines = (look: { focused: boolean; hover?: string; pressed?: string }) =>
      drawKit({ elements: ELEMENTS, look, width: 40, focused: look.focused }, () => (
        <Panel>
          <Lines lines={raw} />
        </Panel>
      ))
    const keyedLines = drawLines({ focused: true }).lines
    for (const focused of [true, false])
      raw.forEach((line, row) => {
        for (let x = 0; x < widthOf(line); x += 1) {
          const before = hoverKeyAt(raw, row, x)
          const after = hoverKeyAt(keyedLines, row, x)
          expect(after === undefined).toBe(before === undefined)
          const tree = drawLines({ focused, hover: after, pressed: after }).tree
          expect(tree).toEqual(renderLines(raw, ELEMENTS, { focused, hover: before, pressed: before }))
          expect(drawLines({ focused, hover: after }).tree).toEqual(renderLines(raw, ELEMENTS, { focused, hover: before }))
        }
      })
  })

  test('a page shell keeps the head and the end of the page within rows, dropping context first', () => {
    const { lines } = draw(() => (
      <Panel>
        <PageShell rows={8} head={<BrandBar title="t" />} context={[<Rail>context</Rail>]} foot={<ButtonRow><Button>Next</Button></ButtonRow>}>
          {Array.from({ length: 10 }, (_, k) => (
            <Rail>{`row ${k}`}</Rail>
          ))}
        </PageShell>
      </Panel>
    ))
    expect(lines).toHaveLength(8)
    expect(textOf(lines[0]!)).toContain('t')
    expect(lines.map(textOf).some(t => t.includes('context'))).toBe(false)
    expect(textOf(lines.at(-1)!)).toContain('Next')
    expect(textOf(lines.at(-2)!)).toContain('row 9')
  })
})

describe('kitClient', () => {
  type S = PointerState & { count: number }

  function mount<P>(module: (props: P, surface: ClientSurface<S>) => unknown, props: P) {
    let state: S | undefined
    let pointer: ((e: ClientPointerEvent) => void) | undefined
    let key: ((e: ClientKeyEvent) => void) | undefined
    const posts: JsonValue[] = []
    const surface = {
      elements: ELEMENTS,
      get state() {
        return state
      },
      setState: (next: S) => {
        state = next
      },
      columns: 40,
      rows: 10,
      onPointer: (fn: typeof pointer) => {
        pointer = fn
        return () => {}
      },
      onKey: (fn: typeof key) => {
        key = fn
        return () => {}
      },
      post: (m: JsonValue) => posts.push(m),
    } as unknown as ClientSurface<S>
    const render = () => module(props, surface)
    let tree = render()
    const send = (e: ClientPointerEvent) => {
      pointer?.(e)
      tree = render()
    }
    const type = (e: ClientKeyEvent) => {
      key?.(e)
      tree = render()
    }
    return { send, type, posts, state: () => state, tree: () => tree, hasPointer: () => pointer !== undefined }
  }

  const Counter = kitClient<{ focused?: boolean }, S>(
    (_props, ui) => {
      ui.onKey(() => ui.setState({ ...ui.state, count: ui.state.count + 10 }))
      return (
        <Panel>
          <ButtonRow>
            <Button onPress={() => ui.setState({ ...ui.state, count: ui.state.count + 1 })}>Add</Button>
          </ButtonRow>
        </Panel>
      )
    },
    { initial: () => ({ count: 0 }), engaged: () => ({ type: 'engaged' }) },
  )
  const ADD = { x: 4, y: 0 }

  test('seeds the state and listens for the pointer on the first frame', () => {
    const m = mount(Counter, {})
    expect(m.state()?.count).toBe(0)
    expect(m.hasPointer()).toBe(true)
  })

  test('a press then a release over a button runs it once and leaves nothing pressed', () => {
    const m = mount(Counter, {})
    m.send({ type: 'down', ...ADD, button: 'left' })
    expect(m.state()?.pressed).toBeDefined()
    m.send({ type: 'up', ...ADD, button: 'left' })
    expect(m.state()).toMatchObject({ count: 1, pressed: undefined })
    expect(m.posts).toEqual([{ type: 'engaged' }])
  })

  test('a key engages and reaches the module', () => {
    const m = mount(Counter, {})
    m.type({ key: 'a' })
    expect(m.state()?.count).toBe(10)
    expect(m.posts).toEqual([{ type: 'engaged' }])
  })

  test('an unfocused surface draws muted and the first click only engages', () => {
    const m = mount(Counter, { focused: false })
    m.send({ type: 'down', ...ADD, button: 'left' })
    m.send({ type: 'up', ...ADD, button: 'left' })
    expect(m.state()?.count).toBe(0)
    expect(m.posts).toEqual([{ type: 'engaged' }])
  })
})
