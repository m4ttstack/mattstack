import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { describe, expect, it } from 'vitest';

const { FieldValue } = await import('./FieldValue');

function kindOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-kind]')?.dataset.kind;
}

describe('FieldValue', () => {
  it('links a url and opens it in a new tab', () => {
    const { container, getByRole } = renderWithProviders(
      <FieldValue
        fieldKey="mr"
        value="https://git.acme.test/web/-/merge_requests/405"
      />
    );
    expect(kindOf(container)).toBe('url');
    const link = getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      'https://git.acme.test/web/-/merge_requests/405'
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('shows each sha of a list in monospace, shortened', () => {
    const { container, getAllByText } = renderWithProviders(
      <FieldValue
        fieldKey="commits"
        value="9f2c1a7e3b5d4c6a8b0e1f2a3b4c5d6e7f8a9b0c 1a2b3c4"
      />
    );
    expect(kindOf(container)).toBe('sha-list');
    expect(getAllByText(/^[0-9a-f]{7}$/).map(e => e.textContent)).toEqual([
      '9f2c1a7',
      '1a2b3c4',
    ]);
    expect(container.querySelectorAll('code')).toHaveLength(2);
  });

  it('pretty-prints json inside a collapsed code block', () => {
    const { container } = renderWithProviders(
      <FieldValue fieldKey="strategy" value='{"tasks":5,"mode":"subagent"}' />
    );
    expect(kindOf(container)).toBe('json');
    const code = container.querySelector('pre');
    expect(code?.textContent).toBe('{\n  "tasks": 5,\n  "mode": "subagent"\n}');
  });

  it('draws a gate reference muted and monospace', () => {
    const { container, getByText } = renderWithProviders(
      <FieldValue fieldKey="waiting-gate" value="g-20261008-0412" />
    );
    expect(kindOf(container)).toBe('gate-ref');
    expect(getByText('g-20261008-0412')).toHaveAttribute('data-muted', 'true');
  });

  it('draws plain text as text', () => {
    const { container, getByText } = renderWithProviders(
      <FieldValue
        fieldKey="approach"
        value="Superpowers: spec, plan, then tasks"
      />
    );
    expect(kindOf(container)).toBe('text');
    expect(
      getByText('Superpowers: spec, plan, then tasks')
    ).toBeInTheDocument();
  });

  it('marks a cleared field', () => {
    const { container } = renderWithProviders(
      <FieldValue fieldKey="mr" value="-" />
    );
    expect(kindOf(container)).toBe('cleared');
    expect(container.querySelector('[data-kind]')?.textContent).toBe('cleared');
  });

  it('opens a file path in the editor when the page knows how', () => {
    const { container, getByRole } = renderWithProviders(
      <FieldValue
        fieldKey="plan"
        value="docs/plans/linked-parcels.md"
        pathHref={p => `vscode://file/w/${p}`}
        data-parity="v"
      />
    );
    expect(kindOf(container)).toBe('path');
    expect(getByRole('link')).toHaveAttribute(
      'href',
      'vscode://file/w/docs/plans/linked-parcels.md'
    );
    expect(container.querySelector('[data-parity="v"]')).not.toBeNull();
  });

  it('shows a file path as text without a way to open it', () => {
    const { container, queryByRole } = renderWithProviders(
      <FieldValue fieldKey="plan" value="docs/plans/linked-parcels.md" />
    );
    expect(kindOf(container)).toBe('path');
    expect(queryByRole('link')).toBeNull();
  });
});
