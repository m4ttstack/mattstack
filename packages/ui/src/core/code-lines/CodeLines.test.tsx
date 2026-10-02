import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CodeLines } from '@mattstack/app-kit/core';
import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';

const ROW_HEIGHT = 19;
const VIEWPORT_HEIGHT = 190;
const TOTAL_ROWS = 2000;
// About ten visible rows, 20 overscan either side, and slack for partial rows.
const MOUNTED_ROWS_BOUND = 60;

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = stubVirtualLayout({
    rowHeight: ROW_HEIGHT,
    viewportHeight: VIEWPORT_HEIGHT,
    contentHeight: TOTAL_ROWS * ROW_HEIGHT,
  });
});

afterEach(() => restoreLayout());

const row = (text: string) =>
  screen.getByText(text).closest('[data-line]') as HTMLElement;

describe('CodeLines', () => {
  test('numbers lines from firstLine', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie']}
        firstLine={40}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(row('alpha').getAttribute('data-line')).toBe('40');
    expect(row('charlie').getAttribute('data-line')).toBe('42');
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  test('numbers lines from 1 by default', () => {
    renderWithProviders(
      <CodeLines lines={['alpha', 'bravo']} height={VIEWPORT_HEIGHT} />
    );

    expect(row('bravo').getAttribute('data-line')).toBe('2');
  });

  test('marks rows inside the highlight range, ends included', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie', 'delta']}
        highlight={[2, 3]}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(row('alpha').hasAttribute('data-highlighted')).toBe(false);
    expect(row('bravo').hasAttribute('data-highlighted')).toBe(true);
    expect(row('charlie').hasAttribute('data-highlighted')).toBe(true);
    expect(row('delta').hasAttribute('data-highlighted')).toBe(false);
  });

  test('highlights nothing when highlight is null', () => {
    const { container } = renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo']}
        highlight={null}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(container.querySelector('[data-highlighted]')).toBeNull();
  });

  test('renders a band label once, at the first row of the band', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie', 'delta']}
        bands={[{ from: 2, to: 3, label: 'gate-protocol', tone: 'accent' }]}
        height={VIEWPORT_HEIGHT}
      />
    );

    const label = screen.getByText('gate-protocol');
    expect(screen.getAllByText('gate-protocol')).toHaveLength(1);
    expect(label.closest('[data-line]')?.getAttribute('data-line')).toBe('2');
  });

  test('puts every row of a band in its gutter with the band tone', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie', 'delta']}
        bands={[
          { from: 2, to: 3, label: 'gate-protocol', tone: 'accent' },
          { from: 4, to: 4, label: 'wrap-up-form' },
        ]}
        height={VIEWPORT_HEIGHT}
      />
    );

    const tone = (text: string) =>
      row(text).querySelector('[data-gutter]')?.getAttribute('data-tone');
    expect(tone('alpha')).toBeNull();
    expect(tone('bravo')).toBe('accent');
    expect(tone('charlie')).toBe('accent');
    expect(tone('delta')).toBe('muted');
  });

  test('labels a band at its first loaded row when the band starts above them', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie']}
        firstLine={10}
        bands={[{ from: 5, to: 11, label: 'gate-protocol' }]}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(
      screen
        .getByText('gate-protocol')
        .closest('[data-line]')
        ?.getAttribute('data-line')
    ).toBe('10');
  });

  test('has no gutter without bands', () => {
    const { container, rerender } = renderWithProviders(
      <CodeLines lines={['alpha', 'bravo']} height={VIEWPORT_HEIGHT} />
    );
    expect(container.querySelector('[data-gutter]')).toBeNull();

    rerender(
      <CodeLines
        lines={['alpha', 'bravo']}
        bands={[]}
        height={VIEWPORT_HEIGHT}
      />
    );
    expect(container.querySelector('[data-gutter]')).toBeNull();
  });

  test('tints only the lines matching tintPattern', () => {
    renderWithProviders(
      <CodeLines
        lines={['plain text', 'paste {{include:gate}} here', 'more {{x}}']}
        tintPattern={/\{\{[^}]+\}\}/g}
        height={VIEWPORT_HEIGHT}
      />
    );

    const tinted = (text: string) =>
      screen.getByText(text).hasAttribute('data-tinted');
    expect(tinted('plain text')).toBe(false);
    expect(tinted('paste {{include:gate}} here')).toBe(true);
    expect(tinted('more {{x}}')).toBe(true);
  });

  test('mounts only the rows near the viewport of a 2,000 line file', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const { container, rerender } = renderWithProviders(
      <CodeLines lines={lines} height={VIEWPORT_HEIGHT} />
    );

    expect(screen.getByText('line 1')).toBeTruthy();
    expect(screen.queryByText('line 1990')).toBeNull();
    expect(
      container.querySelectorAll('[data-line]').length
    ).toBeLessThanOrEqual(MOUNTED_ROWS_BOUND);

    rerender(
      <CodeLines lines={lines} height={VIEWPORT_HEIGHT} scrollTo={1980} />
    );

    expect(screen.getByText('line 1980')).toBeTruthy();
    expect(screen.getByText('line 1990')).toBeTruthy();
    expect(screen.queryByText('line 10')).toBeNull();
    expect(
      container.querySelectorAll('[data-line]').length
    ).toBeLessThanOrEqual(MOUNTED_ROWS_BOUND);
  });

  test('brings scrollTo to the top of the viewport on first render', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const { container } = renderWithProviders(
      <CodeLines lines={lines} height={VIEWPORT_HEIGHT} scrollTo={1980} />
    );

    expect(screen.getByText('line 1980')).toBeTruthy();
    expect(screen.queryByText('line 10')).toBeNull();
    const viewport = container.querySelector(
      '.mantine-ScrollArea-viewport'
    ) as HTMLElement;
    expect(viewport.scrollTop).toBe(1979 * ROW_HEIGHT);
  });

  test('scrollTo is a line number, so it accounts for firstLine', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1001}`);
    const { container } = renderWithProviders(
      <CodeLines
        lines={lines}
        firstLine={1001}
        height={VIEWPORT_HEIGHT}
        scrollTo={1401}
      />
    );

    expect(screen.getByText('line 1401')).toBeTruthy();
    const viewport = container.querySelector(
      '.mantine-ScrollArea-viewport'
    ) as HTMLElement;
    expect(viewport.scrollTop).toBe(400 * ROW_HEIGHT);
  });

  test('labels a band at its first row in view when the band starts above the viewport', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    renderWithProviders(
      <CodeLines
        lines={lines}
        bands={[{ from: 1, to: 1500, label: 'gate-protocol' }]}
        height={VIEWPORT_HEIGHT}
        scrollTo={1000}
      />
    );

    expect(screen.getAllByText('gate-protocol')).toHaveLength(1);
    expect(
      screen
        .getByText('gate-protocol')
        .closest('[data-line]')
        ?.getAttribute('data-line')
    ).toBe('1000');
  });

  test('marks lines matching mutedPattern', () => {
    renderWithProviders(
      <CodeLines
        lines={['<!-- part: include:gate -->', '# Gate']}
        highlight={[1, 2]}
        mutedPattern={/^<!--/}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(
      screen.getByText('<!-- part: include:gate -->').hasAttribute('data-muted')
    ).toBe(true);
    expect(screen.getByText('# Gate').hasAttribute('data-muted')).toBe(false);
  });

  test('adds a class to each part of a row through classNames', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha']}
        bands={[{ from: 1, to: 1, label: 'gate-protocol' }]}
        classNames={{
          row: 'r',
          gutter: 'g',
          gutterLabel: 'gl',
          numberCell: 'nc',
          number: 'n',
          code: 'c',
        }}
        height={VIEWPORT_HEIGHT}
      />
    );

    const line = row('alpha');
    expect(line.classList.contains('r')).toBe(true);
    expect(line.querySelector('[data-gutter]')?.classList.contains('g')).toBe(
      true
    );
    expect(screen.getByText('gate-protocol').classList.contains('gl')).toBe(
      true
    );
    expect(screen.getByText('1').classList.contains('n')).toBe(true);
    expect(screen.getByText('1').parentElement?.classList.contains('nc')).toBe(
      true
    );
    expect(screen.getByText('alpha').classList.contains('c')).toBe(true);
  });

  test('gives each part the attributes rowAttributes returns for its row', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo {{x}}']}
        highlight={[1, 1]}
        tintPattern={/\{\{[^}]+\}\}/}
        bands={[{ from: 1, to: 2, label: 'gate-protocol', tone: 'accent' }]}
        rowAttributes={state => ({
          row: { 'data-state': JSON.stringify(state) },
          gutter: { 'data-part': 'band' },
          gutterLabel: { 'data-part': 'label' },
          numberCell: { 'data-part': 'cell' },
          number: { 'data-part': 'number' },
          code: { 'data-part': 'code' },
        })}
        height={VIEWPORT_HEIGHT}
      />
    );

    const state = (text: string) =>
      JSON.parse(row(text).getAttribute('data-state') ?? 'null');
    expect(state('alpha')).toEqual({
      line: 1,
      text: 'alpha',
      highlighted: true,
      tinted: false,
      muted: false,
      band: { from: 1, to: 2, label: 'gate-protocol', tone: 'accent' },
      labelled: true,
      inView: true,
    });
    expect(state('bravo {{x}}')).toMatchObject({
      line: 2,
      highlighted: false,
      tinted: true,
      labelled: false,
    });
    expect(screen.getByText('alpha').getAttribute('data-part')).toBe('code');
    expect(screen.getByText('gate-protocol').getAttribute('data-part')).toBe(
      'label'
    );
    expect(screen.getByText('2').getAttribute('data-part')).toBe('number');
    expect(screen.getByText('2').parentElement?.getAttribute('data-part')).toBe(
      'cell'
    );
    expect(
      row('alpha').querySelector('[data-gutter]')?.getAttribute('data-part')
    ).toBe('band');
  });

  test('tells rowAttributes which rows are in the viewport', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    renderWithProviders(
      <CodeLines
        lines={lines}
        rowAttributes={state => ({
          row: { 'data-in-view': String(state.inView) },
        })}
        height={VIEWPORT_HEIGHT}
        scrollTo={1000}
      />
    );

    const inView = (text: string) => row(text).getAttribute('data-in-view');
    expect(inView('line 990')).toBe('false');
    expect(inView('line 1000')).toBe('true');
    expect(inView('line 1009')).toBe('true');
    expect(inView('line 1020')).toBe('false');
  });

  test('puts its variant on the root', () => {
    const { container } = renderWithProviders(
      <CodeLines lines={['alpha']} variant="wash" height={VIEWPORT_HEIGHT} />
    );

    expect(
      container.querySelector('[data-variant="wash"]')?.contains(row('alpha'))
    ).toBe(true);
  });
});
