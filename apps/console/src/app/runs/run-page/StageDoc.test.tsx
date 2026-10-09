import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { describe, expect, it } from 'vitest';

const { StageDocText } = await import('./StageDoc');

const COMPILED = [
  '<!-- compiled by rt skills compile from acme@4c1d9e2 -->',
  '---',
  'name: stage-plan',
  '---',
  '',
  '# Plan',
  '',
  '<!-- part: acme/plan-intro -->',
  'Write the plan before any code. <!-- inline note -->',
  '',
  '- Name every file you touch',
  '',
  '```md',
  '<!-- kept inside a fence -->',
  '```',
].join('\n');

describe('StageDocText', () => {
  it('never shows an HTML comment as text', () => {
    const { container } = renderWithProviders(<StageDocText text={COMPILED} />);
    const text =
      container.querySelector('[data-testid="gate-context-body"]')
        ?.textContent ?? '';
    expect(text).not.toContain('compiled by');
    expect(text).not.toContain('part:');
    expect(text).not.toContain('inline note');
    expect(text).not.toContain('name: stage-plan');
    expect(text).toContain('Write the plan before any code.');
    expect(text).toContain('<!-- kept inside a fence -->');
  });

  it('drops comments from the preview too', () => {
    const { container } = renderWithProviders(
      <StageDocText text={COMPILED} preview />
    );
    const text =
      container.querySelector('[data-testid="gate-context-body"]')
        ?.textContent ?? '';
    expect(text).not.toContain('<!--');
    expect(text).toContain('Write the plan before any code.');
    expect(text).toContain('Name every file you touch');
  });
});
