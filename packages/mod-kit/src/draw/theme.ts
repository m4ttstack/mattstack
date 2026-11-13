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
  // The left edge of the button the keyboard selected.
  selectEdge: '▎',
}

// Nerd Font icons: codicons, plus Material Design for the question kinds, which draw larger (names from the font's cmap). A font without them draws empty boxes.
export const ICON = {
  layers: '\u{EBD2}',
  done: '\u{EBB3}', // pass_filled
  todo: '\u{EABC}', // circle
  missing: '\u{EA6C}', // warning
  back: '\u{EAB5}', // chevron_left
  next: '\u{EAB6}', // chevron_right
  collapse: '\u{EAB4}', // chevron_down
  chat: '\u{EAC7}', // comment_discussion
  single: '\u{F043E}', // md-radiobox_marked
  multi: '\u{F0138}', // md-checkbox_multiple_marked
  text: '\u{F060E}', // md-form_textbox
  review: '\u{EBB1}', // check_all
  edit: '\u{EA73}',
  info: '\u{EA74}',
  minimize: '\u{EABA}', // chrome_minimize
}

// The mattstack mark's pink and plum (packages/ui MattstackMark).
// `pinkDeep` is a step down the pink for controls inside the bar.
export const BRAND = { pink: '#FF6B9D', pinkDeep: '#e9578b', plum: '#161224', glyph: ICON.layers }

// Filled controls: `primary` for the one action that finishes, `secondary` for paging buttons,
// `neutral` for a side action, `caution` for one that asks to be pressed again,
// `chip` for small marks like the tab strip's scroll counts, `current` for the tab you're on,
// `field` for a box you type in, `brand` for a mattstack call to action.
export const FILL = {
  primary: { bg: '#2f9e5b', color: 'black' },
  secondary: { bg: '#2b4a6b', color: 'white' },
  neutral: { bg: '#4a4a4a', color: 'white' },
  caution: { bg: '#b8902e', color: 'black' },
  chip: { bg: '#3a3a3a', color: 'white' },
  current: { bg: '#3aa8b8', color: 'black' },
  disabled: { bg: '#262626', color: '#5c5c5c' },
  field: { bg: '#2c2c2c', color: 'white' },
  brand: { bg: BRAND.pink, color: BRAND.plum },
}

// A scroll bar's column, drawn as background colour: the track runs the window's height, the thumb sits on it.
export const SCROLL = { track: '#383838', thumb: '#707070' }

export const PLACEHOLDER: Style = { color: '#7a7a7a' }

// A control under the pointer lightens; one held down darkens, so a click reads as a press.
// An unfilled control (an option, a tab, an outlined button) takes a faint fill instead.
const HOVER_FILL: Record<string, string> = {
  [BRAND.pink]: '#ff94b9',
  [BRAND.pinkDeep]: '#f57ba6',
  [FILL.primary.bg]: '#45c275',
  [FILL.secondary.bg]: '#3b6896',
  [FILL.neutral.bg]: '#666666',
  [FILL.caution.bg]: '#d6aa45',
  [FILL.chip.bg]: '#555555',
  [FILL.current.bg]: '#5fcfdc',
}
// A press steps only a little below the resting fill, so the button never sinks into the background.
const PRESS_FILL: Record<string, string> = {
  [BRAND.pink]: '#ea5d8c',
  [BRAND.pinkDeep]: '#d84a7d',
  [FILL.primary.bg]: '#288a4f',
  [FILL.secondary.bg]: '#26425f',
  [FILL.neutral.bg]: '#424242',
  [FILL.caution.bg]: '#a58127',
  [FILL.chip.bg]: '#333333',
  [FILL.current.bg]: '#3394a2',
}

// A quiet button: a light label on a faint fill at rest (never the disabled grey), a brighter fill and a white label under the pointer.
export const QUIET = { label: '#e0e0e0', rest: '#363636', hover: '#4a4a4a', press: '#404040', muted: '#999999' }

export function hovered<S extends Style>(span: S): S {
  if (span.quiet) return { ...span, bg: QUIET.hover, color: 'white' }
  if (span.chip) return { ...span, bg: span.chip }
  return span.bg ? { ...span, bg: HOVER_FILL[span.bg] ?? span.bg } : { ...span, bg: '#404040', dim: false }
}

export function pressed<S extends Style>(span: S): S {
  if (span.quiet) return { ...span, bg: QUIET.press, color: 'white' }
  if (span.chip) return { ...span, bg: PRESS_FILL[span.chip] ?? span.chip }
  return span.bg ? { ...span, bg: PRESS_FILL[span.bg] ?? span.bg } : { ...span, bg: '#353535', dim: false }
}

// The button the keyboard selected: its hover look, with a pink bar in its left edge cell so the cell count stays.
// The bar's piece is no longer quiet, so a pointer over it keeps the bar pink instead of turning it white.
export function keySelected<A>(span: Span<A>): Span<A>[] {
  const lit = hovered(span)
  if (!lit.t.startsWith(' ')) return [lit]
  return [
    { ...lit, t: SYMBOL.selectEdge, color: BRAND.pink, bold: false, quiet: false },
    { ...lit, t: lit.t.slice(1) },
  ]
}

export const ACCENT: Style = { color: 'cyan' }
export const GRAY: Style = { color: 'gray' }
export const DONE: Style = { color: 'green' }
export const WARN: Style = { color: 'yellow' }
export const DIM: Style = { dim: true }

export const rail = <A = never>(style: Style): Span<A>[] => [sp(SYMBOL.bar, style), sp('  ')]

// dimColor does nothing on a span that names a colour, so the unfocused look steps each level down to an explicit shade, keeping their order. Dark terminals only for now.
const MUTED: Record<string, string> = { cyan: '#62a4b0', green: '#72b072', yellow: '#baa75c', red: '#c46e6e', gray: '#6e6e6e', [BRAND.pink]: '#b05680' }

const MUTED_FILL: Record<string, Style> = { [BRAND.pink]: { bg: '#9e5270', color: '#1f1a2b' }, [BRAND.pinkDeep]: { bg: '#884465', color: '#1f1a2b' }, [FILL.secondary.bg]: { bg: '#334659', color: '#b8b8b8' }, [FILL.disabled.bg]: FILL.disabled, [FILL.field.bg]: { bg: '#323232', color: '#b8b8b8' }, [SCROLL.track]: { bg: '#353535' }, [SCROLL.thumb]: { bg: '#646464' } }

export function muted<S extends Style>(span: S): S {
  if (span.quiet) return { ...span, color: QUIET.muted, dim: false }
  if (span.bg) return { ...span, ...(MUTED_FILL[span.bg] ?? { bg: '#4a4a4a', color: '#b8b8b8' }), dim: false }
  if (span.color) return { ...span, color: MUTED[span.color] ?? span.color, dim: false }
  return { ...span, color: span.dim ? '#808080' : '#b8b8b8', dim: false }
}
