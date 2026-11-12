import { sp, type Span, type Style } from './text'

// Clack's unicode symbols and colours, from @clack/prompts (MIT).
export const SYMBOL = {
  start: '┌',
  bar: '│',
  end: '└',
  active: '◆',
  submit: '◇',
  cancel: '■',
  warn: '▲',
  radioOn: '●',
  radioOff: '○',
  boxActive: '◻',
  boxOn: '◼',
  boxOff: '◻',
}

// Nerd Font icons: codicons, plus Material Design for the question kinds, which draw larger (names from the font's cmap). A font without them draws empty boxes.
export const ICON = {
  layers: '\u{EBD2}',
  done: '\u{EBB3}', // pass_filled
  todo: '\u{EABC}', // circle
  missing: '\u{EA6C}', // warning
  back: '\u{EAB5}', // chevron_left
  next: '\u{EAB6}', // chevron_right
  send: '\u{EC0F}',
  chat: '\u{EAC7}', // comment_discussion
  single: '\u{F043E}', // md-radiobox_marked
  multi: '\u{F0138}', // md-checkbox_multiple_marked
  text: '\u{F060E}', // md-form_textbox
  review: '\u{EBB1}', // check_all
  edit: '\u{EA73}',
  info: '\u{EA74}',
}

// The mattstack mark's pink and plum (packages/ui MattstackMark).
export const BRAND = { pink: '#FF6B9D', plum: '#161224', glyph: ICON.layers }

// Filled controls: `primary` for the one action that finishes, `secondary` for paging buttons,
// `neutral` for a side action, `caution` for one that asks to be pressed again,
// `chip` for small marks like the tab strip's scroll counts, `current` for the tab you're on.
export const FILL = {
  primary: { bg: '#2f9e5b', color: 'black' },
  secondary: { bg: '#2b4a6b', color: 'white' },
  neutral: { bg: '#4a4a4a', color: 'white' },
  caution: { bg: '#b8902e', color: 'black' },
  chip: { bg: '#3a3a3a', color: 'white' },
  current: { bg: '#3aa8b8', color: 'black' },
  disabled: { bg: '#262626', color: '#5c5c5c' },
}

// A control under the pointer lightens; one held down darkens, so a click reads as a press.
// An unfilled control (an option, a tab, an outlined button) takes a faint fill instead.
const HOVER_FILL: Record<string, string> = {
  [FILL.primary.bg]: '#45c275',
  [FILL.secondary.bg]: '#3b6896',
  [FILL.neutral.bg]: '#666666',
  [FILL.caution.bg]: '#d6aa45',
  [FILL.chip.bg]: '#555555',
  [FILL.current.bg]: '#5fcfdc',
}
// A press steps only a little below the resting fill, so the button never sinks into the background.
const PRESS_FILL: Record<string, string> = {
  [FILL.primary.bg]: '#288a4f',
  [FILL.secondary.bg]: '#26425f',
  [FILL.neutral.bg]: '#424242',
  [FILL.caution.bg]: '#a58127',
  [FILL.chip.bg]: '#333333',
  [FILL.current.bg]: '#3394a2',
}

export function hovered<S extends Style>(span: S): S {
  return span.bg ? { ...span, bg: HOVER_FILL[span.bg] ?? span.bg } : { ...span, bg: '#404040', dim: false }
}

export function pressed<S extends Style>(span: S): S {
  return span.bg ? { ...span, bg: PRESS_FILL[span.bg] ?? span.bg } : { ...span, bg: '#353535', dim: false }
}

export const ACCENT: Style = { color: 'cyan' }
export const GRAY: Style = { color: 'gray' }
export const DONE: Style = { color: 'green' }
export const WARN: Style = { color: 'yellow' }
export const DIM: Style = { dim: true }

export const rail = <A = never>(style: Style): Span<A>[] => [sp(SYMBOL.bar, style), sp('  ')]

// dimColor does nothing on a span that names a colour, so the unfocused look steps each level down to an explicit shade, keeping their order. Dark terminals only for now.
const MUTED: Record<string, string> = { cyan: '#3d6f78', green: '#4d7a4d', yellow: '#857640', red: '#8a4a4a', gray: '#4a4a4a' }

const MUTED_FILL: Record<string, Style> = { [BRAND.pink]: { bg: '#6e3a52', color: '#1f1a2b' }, [FILL.secondary.bg]: { bg: '#24313f', color: '#8a8a8a' }, [FILL.disabled.bg]: FILL.disabled }

export function muted<S extends Style>(span: S): S {
  if (span.bg) return { ...span, ...(MUTED_FILL[span.bg] ?? { bg: '#3a3a3a', color: '#8a8a8a' }), dim: false }
  if (span.color) return { ...span, color: MUTED[span.color] ?? span.color, dim: false }
  return { ...span, color: span.dim ? '#555555' : '#8a8a8a', dim: false }
}
