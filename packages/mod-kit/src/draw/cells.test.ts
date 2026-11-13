import { describe, expect, test } from 'bun:test'

import { cellWidth, cutCells, firstGrapheme, padCells, tailCells } from './cells'

describe('cellWidth', () => {
  test('counts ASCII as one cell each', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('')).toBe(0)
  })

  test('counts East Asian wide characters as two cells', () => {
    expect(cellWidth('日本')).toBe(4)
    expect(cellWidth('ｱ')).toBe(1)
    expect(cellWidth('Ａ')).toBe(2)
  })

  test('counts an emoji, a ZWJ family, a flag and a keycap as two cells', () => {
    expect(cellWidth('🚀')).toBe(2)
    expect(cellWidth('👨‍👩‍👧')).toBe(2)
    expect(cellWidth('🇺🇸')).toBe(2)
    expect(cellWidth('1️⃣')).toBe(2)
    expect(cellWidth('#️⃣')).toBe(2)
  })

  test('counts a variation selector 16 as wide only after an emoji base', () => {
    expect(cellWidth('❤️')).toBe(2)
    expect(cellWidth('x️')).toBe(1)
    expect(cellWidth('️')).toBe(0)
  })

  test('counts a combining mark as part of its base', () => {
    expect(cellWidth('é')).toBe(1)
  })

  test('sums mixed text', () => {
    expect(cellWidth('a🚀日b')).toBe(6)
  })
})

describe('cutCells', () => {
  test('keeps whole graphemes that fit', () => {
    expect(cutCells('abcdef', 3)).toBe('abc')
    expect(cutCells('abc', 10)).toBe('abc')
  })

  test('never leaves half a wide character in', () => {
    expect(cutCells('a🚀b', 2)).toBe('a')
    expect(cutCells('a🚀b', 3)).toBe('a🚀')
    expect(cutCells('日本語', 5)).toBe('日本')
  })

  test('never splits a grapheme', () => {
    expect(cutCells('👨‍👩‍👧x', 1)).toBe('')
    expect(cutCells('éx', 1)).toBe('é')
  })

  test('cuts to nothing for a zero or negative room', () => {
    expect(cutCells('abc', 0)).toBe('')
    expect(cutCells('abc', -3)).toBe('')
  })
})

describe('padCells', () => {
  test('pads to the cell count', () => {
    expect(cellWidth(padCells('🚀', 4))).toBe(4)
    expect(padCells('ab', 4)).toBe('ab  ')
  })

  test('leaves text already at or over the count alone', () => {
    expect(padCells('日本', 3)).toBe('日本')
  })
})

describe('tailCells', () => {
  test('keeps the last graphemes that fit', () => {
    expect(tailCells('abcdef', 3)).toBe('def')
    expect(tailCells('a日本', 3)).toBe('本')
    expect(tailCells('abc', 0)).toBe('')
  })
})

describe('firstGrapheme', () => {
  test('takes a whole grapheme', () => {
    expect(firstGrapheme('🚀go')).toBe('🚀')
    expect(firstGrapheme('éx')).toBe('é')
    expect(firstGrapheme('')).toBe('')
  })
})
