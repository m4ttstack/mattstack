import { describe, expect, test } from 'bun:test'

import { buttonSpan } from '../widgets/buttons'
import { sp, widthOf, type Style } from './text'
import { BRAND, FILL, QUIET, SCROLL, SYMBOL, hovered, keySelected, muted, pressed } from './theme'

function luminance(hex: string): number {
  const channel = (at: number) => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

const FILLS: [string, string][] = [...Object.entries(FILL).map(([name, tone]): [string, string] => [name, tone.bg]), ['BRAND.pink', BRAND.pink], ['BRAND.pinkDeep', BRAND.pinkDeep]]
// `disabled` and `field` are not pressable controls, so they have no hover or press shade.
const PRESSABLE = FILLS.filter(([name]) => name !== 'disabled' && name !== 'field')

// The near-black greys are lifted when unfocused instead, so a chip or a field still stands off the background.
const LIFTED = ['chip', 'field']

describe('unfocused fills', () => {
  test.each(FILLS.filter(([name]) => !LIFTED.includes(name)))('muted %s is no brighter than at rest', (_name, bg) => {
    const out = muted({ bg }).bg
    expect(out).toBeDefined()
    expect(luminance(out as string)).toBeLessThanOrEqual(luminance(bg))
  })

  test.each(FILLS.filter(([name]) => LIFTED.includes(name)))('muted %s is a grey no darker than at rest', (_name, bg) => {
    const out = muted({ bg }).bg as string
    expect(out.slice(1, 3)).toBe(out.slice(3, 5))
    expect(out.slice(3, 5)).toBe(out.slice(5, 7))
    expect(luminance(out)).toBeGreaterThanOrEqual(luminance(bg))
  })

  test('muted text keeps dim text below plain text, and a named colour takes an explicit shade', () => {
    const dim = muted<Style>({ dim: true }).color as string
    const plain = muted<Style>({}).color as string
    expect(luminance(dim)).toBeLessThan(luminance(plain))
    for (const color of ['cyan', 'green', 'yellow', 'red', 'gray', BRAND.pink]) expect(muted<Style>({ color }).color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

test('an unfocused scroll bar keeps its thumb apart from its track', () => {
  expect(muted({ bg: SCROLL.thumb }).bg).not.toBe(muted({ bg: SCROLL.track }).bg)
  expect(luminance(muted({ bg: SCROLL.thumb }).bg as string)).toBeLessThanOrEqual(luminance(SCROLL.thumb))
})

describe('pointer states', () => {
  test.each(PRESSABLE)('hovered %s differs from rest', (_name, bg) => {
    expect(hovered({ bg }).bg).not.toBe(bg)
  })

  test.each(PRESSABLE)('pressed %s differs from rest', (_name, bg) => {
    expect(pressed({ bg }).bg).not.toBe(bg)
  })

  test('an unfilled span takes a faint fill', () => {
    expect(hovered<Style>({ dim: true }).bg).toBeDefined()
    expect(pressed<Style>({ dim: true }).bg).toBeDefined()
  })
})

describe('quiet buttons', () => {
  const rest = buttonSpan({ label: 'Skip', action: 'skip', tone: 'quiet' })

  test('at rest: a faint fill, a light label, not bold, the same width as a filled button', () => {
    expect(rest).toMatchObject({ bg: QUIET.rest, color: QUIET.label, quiet: true, bold: false })
    expect(rest.t).toBe(buttonSpan({ label: 'Skip', action: 'skip', tone: 'primary' }).t)
  })

  test('under the pointer a brighter fill and a white label; held down, a step below it', () => {
    expect(hovered(rest)).toMatchObject({ bg: QUIET.hover, color: 'white' })
    expect(pressed(rest)).toMatchObject({ bg: QUIET.press, color: 'white' })
    expect(luminance(QUIET.press)).toBeLessThan(luminance(QUIET.hover))
    expect(luminance(QUIET.rest)).toBeLessThan(luminance(QUIET.hover))
  })

  test('unfocused: its own muted label, no fill change', () => {
    expect(muted(rest)).toMatchObject({ color: QUIET.muted, bg: QUIET.rest })
  })
})

describe('chip and mark', () => {
  test('a chip span takes its chip as the hover fill and a step below it when pressed', () => {
    const hide: Style = { bg: BRAND.pink, color: BRAND.plum, chip: BRAND.pinkDeep }
    expect(hovered(hide).bg).toBe(BRAND.pinkDeep)
    expect(pressed(hide).bg).not.toBe(BRAND.pinkDeep)
    expect(luminance(pressed(hide).bg as string)).toBeLessThan(luminance(BRAND.pinkDeep))
  })

  test("a span with a mark keeps the mark's colour under the pointer while its fill follows", () => {
    const edge: Style = { bg: QUIET.rest, color: BRAND.pink, quiet: true, mark: BRAND.pink }
    expect(hovered(edge)).toMatchObject({ bg: QUIET.hover, color: BRAND.pink })
    expect(pressed(edge)).toMatchObject({ bg: QUIET.press, color: BRAND.pink })
  })
})

describe('keySelected', () => {
  for (const tone of ['primary', 'quiet'] as const) {
    test(`a ${tone} button keeps its fill and width, with a pink edge mark in its first cell`, () => {
      const button = buttonSpan({ label: 'Done', action: 'done', tone })
      const [edge, rest, ...more] = keySelected(button)
      expect(more).toEqual([])
      expect(edge).toMatchObject({ t: SYMBOL.selectEdge, color: BRAND.pink, mark: BRAND.pink, bg: button.bg, action: 'done' })
      expect(rest).toMatchObject({ t: button.t.slice(1), bg: button.bg, color: button.color, action: 'done' })
      expect(widthOf([edge!, rest!])).toBe(widthOf([button]))
      expect(hovered(edge!).bg).toBe(hovered(button).bg)
      expect(hovered(edge!).color).toBe(BRAND.pink)
    })
  }

  test('a span with no blank edge is left as it is', () => {
    const span = sp('Done', { action: 'done' })
    expect(keySelected(span)).toEqual([span])
  })
})
