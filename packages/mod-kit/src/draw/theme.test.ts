import { describe, expect, test } from 'bun:test'

import { BRAND, FILL, hovered, muted, pressed } from './theme'
import type { Style } from './text'

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

describe('unfocused fills', () => {
  test.each(FILLS)('muted %s is no brighter than at rest', (_name, bg) => {
    const out = muted({ bg }).bg
    expect(out).toBeDefined()
    expect(luminance(out as string)).toBeLessThanOrEqual(luminance(bg))
  })
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
