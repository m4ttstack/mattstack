import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A named path: vite rewrites a literal `new URL('...', import.meta.url)` into
// a served asset URL, which `readFileSync` refuses.
const FILE = '../SurfaceTab.module.css';
const css = readFileSync(new URL(FILE, import.meta.url), 'utf8');

/** The text inside the `@media` block with this exact query. */
function mediaBody(query: string): string | null {
  const start = css.indexOf(`@media ${query} {`);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  let depth = 1;
  for (let at = open + 1; at < css.length; at += 1) {
    if (css[at] === '{') depth += 1;
    if (css[at] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, at);
  }
  return null;
}

describe('SurfaceTab.module.css', () => {
  it('keeps the row icons visible where nothing can hover', () => {
    expect(mediaBody('(hover: none)')).toMatch(
      /\.rowEdit\s*\{\s*opacity:\s*1;/
    );
  });

  it('lists rows in one column below the shell breakpoint', () => {
    expect(mediaBody('(max-width: 48em)')).toMatch(
      /\.groupRows\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/
    );
  });
});
