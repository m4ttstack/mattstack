import { describe, expect, it } from 'vitest';

import { headingTree } from './headingTree';

const GADGETS = [
  '---',
  'name: gadgets',
  'description: "Builds the gadgets, then checks them."',
  '---',
  '# Gadgets',
  '',
  'Intro for the whole skill.',
  '',
  '## Build them',
  '',
  'Build every `gadget` in order. Then stop.',
  '',
  '### Fetch parts',
  '',
  'Fetch the parts.',
  '',
  '```bash',
  '# not a heading',
  '```',
  '',
  '## Build them',
  '',
  'A second section with the same title.',
  '',
  '## Check',
  '',
  'Check the **gadgets** work.',
].join('\n');

describe('headingTree', () => {
  it('makes one note block per heading section, nested by level', () => {
    const payload = headingTree(GADGETS, 'gadgets', '/acme/gadgets/SKILL.md');

    expect(
      payload.blocks.map(block => [block.id, block.parentId, block.depth])
    ).toEqual([
      ['gadgets', null, 0],
      ['gadgets/build-them', 'gadgets', 1],
      ['gadgets/build-them/fetch-parts', 'gadgets/build-them', 2],
      ['gadgets/build-them-2', 'gadgets', 1],
      ['gadgets/check', 'gadgets', 1],
    ]);
    expect(new Set(payload.blocks.map(block => block.kind))).toEqual(
      new Set(['note'])
    );
  });

  it('carries no props, no graphs and no layers', () => {
    const payload = headingTree(GADGETS, 'gadgets');

    expect(payload.skill).toBe('gadgets');
    expect(payload.graphs).toEqual([]);
    expect(payload.layers).toEqual([]);
    expect(payload.blocks.every(block => block.props.length === 0)).toBe(true);
  });

  it('takes a lone top-level heading as the root title and the frontmatter description as its summary', () => {
    const [root] = headingTree(GADGETS, 'gadgets').blocks;

    expect(root.title).toBe('Gadgets');
    expect(root.label).toBe('Gadgets');
    expect(root.summary).toBe('Builds the gadgets, then checks them.');
    expect(root.text).toContain('Intro for the whole skill.');
  });

  it('summarises a section by its first sentence as plain text', () => {
    const build = headingTree(GADGETS, 'gadgets').blocks[1];

    expect(build.summary).toBe('Build every gadget in order.');
    expect(build.text.startsWith('## Build them')).toBe(true);
    expect(build.segments).toEqual([
      expect.objectContaining({ prop: null, text: build.text }),
    ]);
  });

  it('never reads a hash inside a code fence as a heading', () => {
    const ids = headingTree(GADGETS, 'gadgets').blocks.map(block => block.id);

    expect(ids.some(id => id.includes('not-a-heading'))).toBe(false);
  });

  it('counts the frontmatter in its line numbers and sets the path on every block', () => {
    const blocks = headingTree(
      GADGETS,
      'gadgets',
      '/acme/gadgets/SKILL.md'
    ).blocks;
    const build = blocks[1];

    expect(build.lines).toEqual([9, 12]);
    expect(build.renderedLines).toEqual([9, 12]);
    expect(new Set(blocks.map(block => block.path))).toEqual(
      new Set(['/acme/gadgets/SKILL.md'])
    );
  });

  it('roots several top-level headings under the skill name', () => {
    const payload = headingTree('# One\n\na.\n\n# Two\n\nb.', 'widgets');

    expect(payload.blocks.map(block => [block.id, block.parentId])).toEqual([
      ['widgets', null],
      ['widgets/one', 'widgets'],
      ['widgets/two', 'widgets'],
    ]);
    expect(payload.blocks[0].title).toBe('widgets');
  });

  it('keeps a file with no headings as a lone root', () => {
    const payload = headingTree('Just prose here. More.', 'mini');

    expect(payload.blocks).toHaveLength(1);
    expect(payload.blocks[0].summary).toBe('Just prose here.');
  });
});
