import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MermaidSource, SourceLines } from '../MermaidSource';

/** Each coloured span on a line as [text, tone]. */
function tonesOf(source: string, language?: 'mermaid' | 'dot') {
  const { container } = renderWithProviders(
    <SourceLines source={source} language={language} />
  );
  return [...container.querySelectorAll('[data-tone]')].map(span => [
    span.textContent,
    span.getAttribute('data-tone'),
  ]);
}

describe('SourceLines in Mermaid', () => {
  it('numbers each line and drops a trailing newline', () => {
    const { container } = renderWithProviders(
      <SourceLines source={'flowchart TB\n  a --> b\n'} />
    );
    const numbers = [...container.querySelectorAll('[aria-hidden]')].map(
      span => span.textContent
    );
    expect(numbers).toEqual(['1', '2']);
  });

  it("colours the opening keyword, a node's id outside its brackets and its words inside them", () => {
    expect(tonesOf('flowchart TB\n  a[Run it] --> b')).toEqual([
      ['flowchart', 'keyword'],
      ['TB', 'id'],
      ['a', 'id'],
      ['[', 'mark'],
      ['Run', 'text'],
      [' ', 'text'],
      ['it', 'text'],
      [']', 'mark'],
      ['-->', 'arrow'],
      ['b', 'id'],
    ]);
  });

  it('colours an edge label, a class and a comment each in their own tone', () => {
    expect(tonesOf('flowchart TB\n  a -->|yes| b:::hot\n  %% a note')).toEqual(
      expect.arrayContaining([
        ['|yes|', 'edge'],
        [':::hot', 'class'],
        ['%% a note', 'comment'],
      ])
    );
  });
});

describe('SourceLines in Graphviz', () => {
  it('colours keywords, node ids, arrows and quoted labels', () => {
    expect(tonesOf('digraph g {\n  a -> b [label="go on"];\n}', 'dot')).toEqual(
      [
        ['digraph', 'keyword'],
        ['g', 'id'],
        ['{', 'mark'],
        ['a', 'id'],
        ['->', 'arrow'],
        ['b', 'id'],
        ['[', 'mark'],
        ['label', 'class'],
        ['=', 'mark'],
        ['"go on"', 'text'],
        [']', 'mark'],
        [';', 'mark'],
        ['}', 'mark'],
      ]
    );
  });

  it("leaves an attribute's bare value plain, not a node id", () => {
    const tones = tonesOf('a [shape=diamond]', 'dot');
    expect(tones).toContainEqual(['shape', 'class']);
    expect(tones.find(([text]) => text === 'diamond')).toBeUndefined();
    expect(screen.getByText(/diamond/)).toBeInTheDocument();
  });

  it('colours a comment', () => {
    expect(tonesOf('// the run graph', 'dot')).toEqual([
      ['// the run graph', 'comment'],
    ]);
  });
});

describe('MermaidSource', () => {
  it('names the source, counts its lines and offers Copy', () => {
    renderWithProviders(<MermaidSource source={'flowchart TB\n  a --> b'} />);

    const view = screen.getByTestId('graph-source');
    expect(view).toHaveTextContent('Mermaid');
    expect(view).toHaveTextContent('2 lines');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});
