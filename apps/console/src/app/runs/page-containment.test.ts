import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * PageShell.Content's scroll frame is an autosize ScrollArea whose content
 * takes `min-width: min-content`. A truncated line's min-content is its
 * whole text, so one long summary, branch or path props the frame open and
 * the page scrolls sideways, whatever `min-width: 0` the columns carry.
 * Each runs page's frame therefore contains its inline size: its width comes
 * from the frame, never from its content.
 */
const PAGES = [
  'RunDetail.module.css',
  'RunSearch.module.css',
  'runs-page/RunsPage.module.css',
];

/** The declarations of `selector`'s first rule in `css`. */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[2]! : null;
}

describe('runs page containment', () => {
  it('finds a rule body and ignores a longer selector', () => {
    const css =
      '.pageTitle { color: red; }\n.page {\n  contain: inline-size;\n}';
    expect(ruleBody(css, '.page')).toContain('contain: inline-size');
    expect(ruleBody('.pageTitle { a: b; }', '.page')).toBeNull();
  });

  it.each(PAGES)('%s contains its inline size', file => {
    const css = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(ruleBody(css, '.page')).toMatch(/contain:\s*inline-size/);
  });
});
