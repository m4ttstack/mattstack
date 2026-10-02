import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { layoutTemplate } from '../layout/templateLayout';
import { buildTemplateView } from '../model/templateModel';
import TemplateCanvas from '../TemplateCanvas';
import { designFixture } from './designFixtures';

const FIXTURES = {
  work: { anatomy: 'anatomy.work', step: null, focus: 'pipeline:feature' },
  'stage-plan': { anatomy: 'anatomy.stage-plan', step: 2, focus: 'stage-plan' },
} as const;

function renderCanvas(skill: keyof typeof FIXTURES, select?: string) {
  const fixture = FIXTURES[skill];
  const query = new URLSearchParams({ tab: 'graph', focus: fixture.focus });
  if (select) query.set('select', select);
  window.history.pushState(null, '', `/wiring?${query}`);

  const view = buildTemplateView({
    anatomy: designFixture(fixture.anatomy),
    composition: designFixture('composition'),
    check: designFixture('check'),
    changes: designFixture('changes.clean'),
    step: fixture.step,
    workType: 'feature',
  });
  const onSelect = vi.fn();
  renderWithProviders(
    <TemplateCanvas
      layout={layoutTemplate(view)}
      view={view}
      height="900px"
      onSelect={onSelect}
    />
  );
  return { onSelect };
}

// Clicks, not pointer sequences: React Flow's pan handler reads the
// `MouseEvent.view` that jsdom's synthetic pointer events leave null.
const click = (element: Element) => fireEvent.click(element);

const rows = () => screen.getAllByTestId('template-row');
const rowAt = (gutter: string) => {
  const row = rows().find(
    candidate =>
      within(candidate).getByTestId('row-gutter').textContent === gutter
  );
  if (!row) throw new Error(`no row ${gutter}`);
  return row;
};

afterEach(() => {
  window.history.pushState(null, '', '/');
});

describe('TemplateCanvas: a step template', () => {
  it('draws every template row with its gutter', () => {
    renderCanvas('stage-plan');

    expect(
      rows().map(row => within(row).getByTestId('row-gutter').textContent)
    ).toEqual([
      'L1-15',
      'L16',
      'L17-75',
      'L76',
      'L77-135',
      'L136',
      'L137-139',
      'L140',
      'L141-143',
      'L144',
    ]);
    expect(rowAt('L1-15')).toHaveTextContent('··· 15 lines of step text');
    expect(rowAt('L140')).toHaveTextContent('{{include:gate-protocol}}');
  });

  it('heads the template with its file and build', () => {
    renderCanvas('stage-plan');

    const template = screen.getByTestId('template-node');
    expect(template).toHaveTextContent('stage-plan/SKILL.md');
    expect(template).toHaveTextContent('144 lines · mattstack 0.28.10');
  });

  it('draws a card for each file or value substituted in', () => {
    renderCanvas('stage-plan');

    expect(
      screen
        .getAllByTestId('input-card')
        .map(card => within(card).getByTestId('card-title').textContent)
    ).toEqual([
      'run fields',
      'execution-strategy/SKILL.md',
      'plan-policy/SKILL.md',
      'gate-protocol/SKILL.md',
      'wrap-up-form/SKILL.md',
    ]);
  });

  it('lists what the rendered file is made of', () => {
    renderCanvas('stage-plan');

    const output = screen.getByTestId('output-node');
    expect(output).toHaveTextContent('plan');
    expect(output).toHaveTextContent('780 lines');
    expect(output).toHaveTextContent("What's in the 780 lines");
    expect(
      within(output)
        .getAllByTestId('output-part')
        .map(part => part.textContent)
    ).toEqual([
      'step text64 · 8%',
      'execution-strategy149 · 19%',
      'plan-policy80 · 10%',
      'gate-protocol450 · 58%',
      'wrap-up-form28 · 4%',
    ]);
    expect(
      within(output)
        .getAllByTestId('output-link')
        .map(link => link.textContent)
    ).toEqual(['gates/SKILL.md', 'evidence/SKILL.md', 'dev-servers/SKILL.md']);
  });

  it('labels the three columns', () => {
    renderCanvas('stage-plan');

    const headers = screen.getByTestId('column-headers');
    expect(headers).toHaveTextContent('Substituted in');
    expect(headers).toHaveTextContent(
      'Files and values that replace each placeholder'
    );
    expect(headers).toHaveTextContent(
      'The step as written, with its placeholders'
    );
    expect(headers).toHaveTextContent('Rendered');
    expect(headers).toHaveTextContent('What the agent actually reads');
  });

  it('selects a row by its first template line', () => {
    const { onSelect } = renderCanvas('stage-plan');

    click(rowAt('L140'));

    expect(onSelect).toHaveBeenCalledWith('row:140');
  });

  it('selects an input card, the output, a part and a link', () => {
    const { onSelect } = renderCanvas('stage-plan');

    const gate = screen
      .getAllByTestId('input-card')
      .find(card => card.textContent?.includes('gate-protocol/SKILL.md'))!;
    click(gate);
    expect(onSelect).toHaveBeenLastCalledWith('input:include:gate-protocol');

    const output = screen.getByTestId('output-node');
    click(within(output).getByTestId('output-header'));
    expect(onSelect).toHaveBeenLastCalledWith('output');

    click(within(output).getAllByTestId('output-part')[3]!);
    expect(onSelect).toHaveBeenLastCalledWith('output:include:gate-protocol');

    click(within(output).getAllByTestId('output-link')[0]!);
    expect(onSelect).toHaveBeenLastCalledWith(
      'link:../../attachments/gates/SKILL.md'
    );
  });

  it('marks the selected row and card from the URL', () => {
    renderCanvas('stage-plan', 'row:140');
    expect(rowAt('L140')).toHaveAttribute('data-selected', 'true');
    expect(rowAt('L136')).not.toHaveAttribute('data-selected');
  });

  it('marks a selected input card', () => {
    renderCanvas('stage-plan', 'input:include:gate-protocol');
    const selected = screen
      .getAllByTestId('input-card')
      .filter(card => card.hasAttribute('data-selected'));
    expect(selected.map(card => card.textContent)).toEqual([
      expect.stringContaining('gate-protocol/SKILL.md'),
    ]);
  });
});

describe('TemplateCanvas: the share bar', () => {
  const activeSegments = () =>
    [...document.querySelectorAll('[data-parity^="seg · "]')]
      .filter(segment => segment.hasAttribute('data-active'))
      .map(segment => segment.getAttribute('data-parity'));

  it('marks no part with nothing selected', () => {
    renderCanvas('stage-plan');
    expect(activeSegments()).toEqual([]);
  });

  it('marks the part a selected row pastes in', () => {
    renderCanvas('stage-plan', 'row:140');
    expect(activeSegments()).toEqual(['seg · gate-protocol']);
  });

  it('marks a selected part', () => {
    renderCanvas('stage-plan', 'output:slot:domain');
    expect(activeSegments()).toEqual(['seg · plan-policy']);
  });
});

describe('TemplateCanvas: a pipeline that links its steps', () => {
  it('draws a link card per step it runs, and no output', () => {
    renderCanvas('work');

    expect(
      screen
        .getAllByTestId('link-card')
        .map(card => within(card).getByTestId('card-title').textContent)
    ).toEqual([
      'stage-provision/SKILL.md',
      'stage-plan/SKILL.md',
      'stage-gates/SKILL.md',
      'stage-evidence/SKILL.md',
      'stage-implement/SKILL.md',
      'stage-self-review/SKILL.md',
      'stage-ship/SKILL.md',
      'stage-watch-ci/SKILL.md',
    ]);
    expect(screen.queryByTestId('output-node')).not.toBeInTheDocument();
    expect(screen.getByTestId('column-headers')).toHaveTextContent('Links to');
    expect(screen.getByTestId('column-headers')).toHaveTextContent(
      'work as written · click a line range to read it'
    );
  });

  it('opens a linked step by focusing it', () => {
    renderCanvas('work');

    const plan = screen
      .getAllByTestId('link-card')
      .find(card => card.textContent?.includes('stage-plan/SKILL.md'))!;
    click(plan);

    expect(new URLSearchParams(window.location.search).get('focus')).toBe(
      'stage-plan'
    );
  });

  it('keeps the rows of a stale skill clickable', () => {
    const { onSelect } = renderCanvas('work');

    click(rowAt('L1-28'));

    expect(onSelect).toHaveBeenCalledWith('row:1');
  });
});
