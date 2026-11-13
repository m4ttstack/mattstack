import {
  ACCENT,
  BRAND,
  BrandBar,
  Button,
  ButtonRow,
  DIM,
  FILL,
  ICON,
  InputField,
  PageShell,
  Panel,
  Rail,
  Row,
  SelectList,
  Span,
  SYMBOL,
  TabStrip,
  Unfocused,
  hovered,
  kitClient,
  pressed,
} from '@mattstack/mod-kit'
import type { ButtonTone, Choice, KitUi, PointerState } from '@mattstack/mod-kit'

type Props = { cols?: number }

type TabState = { current: number; from: number }

type State = PointerState & {
  page: number
  pageFrom: number
  presses: number
  typed: string
  cursor: Record<string, number>
  picked: Record<string, number[]>
  tabs: Record<string, TabState>
  shell: number
}

type Ui = KitUi<State>

const initial = (): State => ({
  page: 0,
  pageFrom: 0,
  presses: 0,
  typed: '',
  cursor: { single: 0, described: 1, long: 5 },
  picked: { multi: [1], described: [0, 2] },
  tabs: { short: { current: 0, from: 0 }, overflow: { current: 0, from: 0 }, scrolled: { current: 7, from: 5 } },
  shell: 0,
})

const patch = (ui: Ui, change: Partial<State>) => ui.setState({ ...ui.state, ...change })
const cursorOf = (ui: Ui, id: string) => ui.state.cursor[id] ?? 0
const pickedOf = (ui: Ui, id: string) => ui.state.picked[id] ?? []
const moveCursor = (ui: Ui, id: string, idx: number) => patch(ui, { cursor: { ...ui.state.cursor, [id]: idx } })
const toggle = (ui: Ui, id: string, idx: number) => {
  const picked = pickedOf(ui, id)
  patch(ui, { cursor: { ...ui.state.cursor, [id]: idx }, picked: { ...ui.state.picked, [id]: picked.includes(idx) ? picked.filter(i => i !== idx) : [...picked, idx] } })
}

const heading = (text: string) => [<Rail />, <Rail color={ACCENT.color} bold>{text}</Rail>]

const PLAIN: Choice[] = [{ label: 'Rename fetchAll' }, { label: 'Keep the name' }, { label: 'Ask me later' }]
const DESCRIBED: Choice[] = [
  { label: 'Rename fetchAll', description: 'Matches the other loaders and every call site' },
  { label: 'Keep the name', description: 'Nothing changes; the next caller decides' },
  { label: 'Ask me later', description: 'Park it as a follow-up' },
]
const WRITE_IN: Choice = { label: 'Something else', description: 'Say what you have in mind', isWriteIn: true }
const LONG: Choice[] = ['Rename', 'Extract', 'Inline', 'Move', 'Split', 'Merge', 'Delete', 'Rewrite', 'Document', 'Defer'].map(label => ({ label }))
const TAB_NAMES = ['Overview', 'Install', 'Configure', 'Usage', 'Hooks', 'Commands', 'Settings', 'Tools', 'Panes', 'Themes', 'Testing', 'Release', 'Upgrade', 'Support', 'Billing', 'Audit', 'Export', 'Import', 'Sync', 'Search']

const TONES: ButtonTone[] = ['primary', 'secondary', 'neutral', 'caution', 'brand']

function toneRow(ui: Ui, tone: ButtonTone) {
  const fill = { ...FILL[tone], bold: true }
  return (
    <Row>
      <Span {...ACCENT}>{SYMBOL.bar}</Span>
      {`  ${tone.padEnd(11)}`}
      <Button tone={tone} onPress={tone === 'primary' ? () => patch(ui, { presses: ui.state.presses + 1 }) : undefined}>
        Save
      </Button>
      {'   '}
      <Span {...hovered(fill)}>{'  Save  '}</Span>
      {'   '}
      <Span {...pressed(fill)}>{'  Save  '}</Span>
      {'   '}
      <Button tone={tone} disabled>
        Save
      </Button>
      <Unfocused>
        <Button tone={tone}>Save</Button>
      </Unfocused>
    </Row>
  )
}

function buttonsPage(ui: Ui) {
  const times = ui.state.presses === 1 ? 'time' : 'times'
  return [
    ...heading('Button tones: the rest column is live, hover and pressed are drawn still'),
    <Row>
      <Span {...ACCENT}>{SYMBOL.bar}</Span>
      <Span {...DIM}>{`  ${'tone'.padEnd(11)}${'rest'.padEnd(11)}${'hover'.padEnd(11)}${'pressed'.padEnd(11)}${'disabled'.padEnd(11)}unfocused`}</Span>
    </Row>,
    ...TONES.map(tone => toneRow(ui, tone)),
    <Rail dim>{`Primary rest button: pressed ${ui.state.presses} ${times}. A press counts on release, over the button it started on.`}</Rail>,
    ...heading('ButtonRow: buttons from the left, one against the right edge'),
    <ButtonRow right={<Button tone="neutral">Chat</Button>}>
      <Button disabled>Back</Button>
      <Button tone="primary">Next</Button>
    </ButtonRow>,
  ]
}

function barsPage(ui: Ui, width: number) {
  const half = Math.floor((width - 5) / 2)
  const field = (value: string, placeholder: string) => (
    <Row>
      <Span {...ACCENT}>{SYMBOL.bar}</Span>
      {'  '}
      <InputField width={half} value={value} placeholder={placeholder} />
      {'  '}
      <Unfocused>
        <InputField width={half} value={value} placeholder={placeholder} />
      </Unfocused>
    </Row>
  )
  return [
    ...heading('BrandBar'),
    <BrandBar title="mattstack kit gallery" />,
    <Rail dim>No Hide button: the pane has nothing to put away.</Rail>,
    <BrandBar title="mattstack kit gallery" onHide={ui.hide} />,
    <Rail dim>With Hide: the button puts this pane away.</Rail>,
    ...heading('InputField: focused on the left, unfocused on the right'),
    field('', 'Name the function'),
    field('fetchAllPages', 'Name the function'),
    <Rail dim>Typed text scrolls to keep its end in view; the live field below takes your keys.</Rail>,
    field(ui.state.typed, 'Type here'),
  ]
}

function singlePage(ui: Ui) {
  return [
    ...heading('SelectList, single, no descriptions: click a choice'),
    <SelectList choices={PLAIN} cursor={cursorOf(ui, 'single')} cursorIsChoice onPick={idx => moveCursor(ui, 'single', idx)} />,
    ...heading('SelectList, single, with descriptions'),
    <SelectList choices={DESCRIBED} cursor={cursorOf(ui, 'described')} cursorIsChoice onPick={idx => moveCursor(ui, 'described', idx)} />,
    ...heading('SelectList, single, unfocused: muted, nothing to click'),
    <Unfocused>
      <SelectList choices={DESCRIBED.slice(0, 2)} cursor={0} cursorIsChoice />
    </Unfocused>,
  ]
}

function multiPage(ui: Ui) {
  return [
    ...heading('SelectList, multi, no descriptions: click to tick'),
    <SelectList multi choices={PLAIN} cursor={cursorOf(ui, 'multi')} isPicked={idx => pickedOf(ui, 'multi').includes(idx)} onPick={idx => toggle(ui, 'multi', idx)} />,
    ...heading('SelectList, multi, with descriptions'),
    <SelectList multi choices={DESCRIBED} cursor={cursorOf(ui, 'described')} isPicked={idx => pickedOf(ui, 'described').includes(idx)} onPick={idx => toggle(ui, 'described', idx)} />,
    ...heading('SelectList, multi, unfocused'),
    <Unfocused>
      <SelectList multi choices={DESCRIBED.slice(0, 2)} cursor={0} isPicked={idx => idx === 1} />
    </Unfocused>,
  ]
}

function writeInPage() {
  const choices = [PLAIN[0]!, WRITE_IN]
  return [
    ...heading('Write-in, empty, focused: the description becomes the placeholder'),
    <SelectList choices={choices} cursor={1} />,
    ...heading('Write-in, filled, focused'),
    <SelectList choices={choices} cursor={1} writeIn="A fresh name for it" />,
    ...heading('Write-in, filled, cursor elsewhere: the typed text shows quoted'),
    <SelectList choices={choices} cursor={0} writeIn="A fresh name for it" />,
    ...heading('Write-in, empty, unfocused'),
    <Unfocused>
      <SelectList choices={choices} cursor={1} />
    </Unfocused>,
  ]
}

function longPage(ui: Ui) {
  return [
    ...heading('SelectList of 10: eight show at a time, and the window follows the cursor'),
    <SelectList choices={LONG} cursor={cursorOf(ui, 'long')} cursorIsChoice onPick={idx => moveCursor(ui, 'long', idx)} />,
  ]
}

function liveTabs(ui: Ui, id: string) {
  const state = ui.state.tabs[id] ?? { current: 0, from: 0 }
  const set = (change: Partial<TabState>) => patch(ui, { tabs: { ...ui.state.tabs, [id]: { ...state, ...change } } })
  return { current: state.current, from: state.from, onSelect: (current: number) => set({ current }), onScroll: (from: number) => set({ from }) }
}

const NAMED = TAB_NAMES.map(label => ({ label }))

function tabsPage(ui: Ui) {
  const short = [{ label: 'Overview', isDone: true, mark: ICON.done }, { label: 'Details', isDone: true, mark: ICON.done }, { label: 'Notes' }]
  return [
    ...heading('TabStrip, short: done tabs are green, the current one is filled'),
    <TabStrip tabs={short} {...liveTabs(ui, 'short')} />,
    <Unfocused>
      <TabStrip tabs={short} current={0} />
    </Unfocused>,
    ...heading('TabStrip, overflowing: a chip counts the tabs out of sight and scrolls one'),
    <TabStrip tabs={NAMED} {...liveTabs(ui, 'overflow')} />,
    ...heading('TabStrip, scrolled: chips on both sides'),
    <TabStrip tabs={NAMED} {...liveTabs(ui, 'scrolled')} />,
    ...heading('Reopen band: what waits above the prompt once a pane is put away'),
    <Row>
      <Span color={BRAND.pink} bold>
        {`${BRAND.glyph} mattstack waiting  `}
      </Span>
      <Span>Kit gallery</Span>
      {'  '}
      <Button tone="brand">Open</Button>
    </Row>,
  ]
}

function shellPage(ui: Ui) {
  const at = ui.state.shell
  const last = 2
  return [
    ...heading('PageShell: head, context, a page held to one height, and a nav row that keeps its place'),
    <PageShell
      rows={16}
      padTo={8}
      head={<BrandBar title="mattstack page shell" />}
      context={<Rail dim>The context sits under the head and is the first thing given up when rows run out.</Rail>}
      foot={
        <ButtonRow right={<Button tone="neutral">Chat</Button>}>
          <Button disabled={at === 0} onPress={() => patch(ui, { shell: at - 1 })}>
            Back
          </Button>
          <Button tone={at === last ? 'primary' : 'secondary'} onPress={() => patch(ui, { shell: at === last ? 0 : at + 1 })}>
            {at === last ? 'Start over' : 'Next'}
          </Button>
        </ButtonRow>
      }
    >
      <Rail bold>{`Page ${at + 1} of ${last + 1}`}</Rail>
      <Rail dim>Pages are different heights; the foot stays on one row.</Rail>
      <SelectList choices={DESCRIBED.slice(0, at + 1)} cursor={0} cursorIsChoice />
    </PageShell>,
  ]
}

const PAGES: { label: string; draw: (ui: Ui, width: number) => JSX.Element[] }[] = [
  { label: 'Buttons', draw: buttonsPage },
  { label: 'Bars', draw: barsPage },
  { label: 'Single', draw: singlePage },
  { label: 'Multi', draw: multiPage },
  { label: 'Write-in', draw: writeInPage },
  { label: 'Long list', draw: longPage },
  { label: 'Tabs', draw: tabsPage },
  { label: 'Shell', draw: shellPage },
]

const PAGE_TABS = PAGES.map(({ label }) => ({ label }))
const BARS = 1

export default kitClient<Props, State>(
  (props, ui) => {
    const width = Math.max(40, props.cols || ui.width)
    ui.onKey(({ key, ctrl, meta }) => {
      if (ui.state.page !== BARS || ctrl || meta) return
      if (key === 'backspace') patch(ui, { typed: ui.state.typed.slice(0, -1) })
      else if (key.length === 1) patch(ui, { typed: ui.state.typed + key })
    })
    return (
      <Panel width={width}>
        <TabStrip tabs={PAGE_TABS} current={ui.state.page} from={ui.state.pageFrom} onSelect={page => patch(ui, { page })} onScroll={pageFrom => patch(ui, { pageFrom })} />
        {PAGES[ui.state.page]!.draw(ui, width)}
      </Panel>
    )
  },
  { initial },
)
