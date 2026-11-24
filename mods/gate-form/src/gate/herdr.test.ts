import { expect, test } from 'bun:test'

import { herdrBins } from './herdr'

test('herdr is the binary herdr names for its panes, then PATH, then where mattstack installs it', () => {
  expect(herdrBins({ bin: '/opt/pinned/herdr', home: '/Users/t' })).toEqual(['/opt/pinned/herdr', 'herdr', '/Users/t/.local/bin/herdr'])
})

test('a pane with no named binary tries PATH, then where mattstack installs it', () => {
  expect(herdrBins({ bin: '', home: '/Users/t' })).toEqual(['herdr', '/Users/t/.local/bin/herdr'])
  expect(herdrBins({ bin: undefined, home: undefined })).toEqual(['herdr'])
})

test('the same binary is not tried twice', () => {
  expect(herdrBins({ bin: '/Users/t/.local/bin/herdr', home: '/Users/t' })).toEqual(['/Users/t/.local/bin/herdr', 'herdr'])
})
