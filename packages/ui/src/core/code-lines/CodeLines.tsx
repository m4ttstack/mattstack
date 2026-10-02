import { useMemo, type CSSProperties } from 'react';
import type { ScrollAreaProps } from '@mantine/core';

import { VirtualList } from '../virtual-list/VirtualList';
import classes from './CodeLines.module.css';

// Matches the row height in CodeLines.module.css: the virtualizer's size
// estimate has to equal the rendered row or the scroll offsets drift.
const ROW_HEIGHT = 19;
const OVERSCAN = 20;

export type CodeLinesBand = {
  /** First line number of the band, inclusive. */
  from: number;
  /** Last line number of the band, inclusive. */
  to: number;
  /** Shown in the gutter on the band's first row in view. */
  label: string;
  /** `accent` marks the band the viewer is looking at. @default 'muted' */
  tone?: 'accent' | 'muted';
};

/** The elements of one row: the band gutter and its label, the line number
    in its cell, and the code. */
export type CodeLinesPart =
  'row' | 'gutter' | 'gutterLabel' | 'numberCell' | 'number' | 'code';

/** What a row shows, as `rowAttributes` receives it. */
export interface CodeLinesRowState {
  line: number;
  text: string;
  highlighted: boolean;
  tinted: boolean;
  muted: boolean;
  band: CodeLinesBand | null;
  /** The row carries its band's label. */
  labelled: boolean;
  /** The row is inside the viewport, not one of the rows mounted around it. */
  inView: boolean;
}

export type CodeLinesRowAttributes = Partial<
  Record<CodeLinesPart, { [key: `data-${string}`]: string | undefined }>
>;

export interface CodeLinesProps {
  lines: string[];
  /** Line number of `lines[0]`. @default 1 */
  firstLine?: number;
  /** Inclusive line-number range painted with the accent wash. */
  highlight?: [number, number] | null;
  /** Gutter column of labelled line ranges. No gutter when omitted or empty. */
  bands?: CodeLinesBand[];
  /** Lines matching this render in accent text. */
  tintPattern?: RegExp;
  /** Lines matching this read muted, inside the highlight too (a compiler's
      marker lines, say). */
  mutedPattern?: RegExp;
  /** Viewport height in px. */
  height: number;
  /**
   * Line number to bring to the top of the viewport. Applies again only when
   * the value changes, so remount with a `key` when swapping the content (the
   * Template/Rendered toggle, say).
   */
  scrollTo?: number | null;
  /**
   * `wash`: the highlight is a thin accent wash, with its line numbers in
   * accent and its text in the body colour; text outside it reads muted, and
   * a muted band draws its rule in the soft line step.
   * @default 'default'
   */
  variant?: 'default' | 'wash';
  /** Classes for each part of every row, for dimensions (column widths,
      padding, type size). */
  classNames?: Partial<Record<CodeLinesPart, string>>;
  /** Data attributes for each part of a row, from what that row shows: a hook
      for tests and tooling that address rows. */
  rowAttributes?: (row: CodeLinesRowState) => CodeLinesRowAttributes;
  /** When the scrollbars show, as Mantine's ScrollArea `type`.
      @default 'auto' */
  scrollbarType?: ScrollAreaProps['type'];
  /** Break long lines at the viewport's width instead of scrolling
      sideways. @default false */
  wrap?: boolean;
}

const TAB = ' '.repeat(8);

const cx = (...names: (string | undefined)[]) =>
  names.filter(Boolean).join(' ');

/**
 * Line-numbered monospace text in a fixed-height viewport, with an optional
 * highlighted range and a gutter of labelled bands. Rows are virtualized
 * (`VirtualList`), so a file of thousands of lines mounts only the rows near
 * the viewport; `scrollTo` is a line number, not a row index.
 */
export function CodeLines({
  lines,
  firstLine = 1,
  highlight = null,
  bands,
  tintPattern,
  mutedPattern,
  height,
  scrollTo = null,
  variant = 'default',
  classNames,
  rowAttributes,
  scrollbarType = 'auto',
  wrap = false,
}: CodeLinesProps) {
  const hasGutter = bands !== undefined && bands.length > 0;
  const digits = String(firstLine + lines.length - 1).length;
  // Every line takes the longest one's width, so a highlight runs under all
  // of a line scrolled into view sideways. Monospace, so a count is a width.
  const longest = useMemo(
    () =>
      lines.reduce(
        (most, line) => Math.max(most, line.replace(/\t/g, TAB).length),
        0
      ),
    [lines]
  );

  return (
    <VirtualList
      items={lines}
      estimateSize={() => ROW_HEIGHT}
      overscan={OVERSCAN}
      maxHeight={height}
      minHeight={height}
      scrollToIndex={scrollTo === null ? null : scrollTo - firstLine}
      scrollAreaProps={{
        className: classes.root,
        mod: { variant, wrap },
        type: scrollbarType,
        style: {
          '--code-lines-digits': `${digits}ch`,
          '--code-lines-longest': longest,
        } as CSSProperties,
      }}
      renderRow={(line, index, visible) => {
        const lineNumber = firstLine + index;
        const firstInView = firstLine + (visible?.first ?? 0);
        const band =
          bands?.find(b => lineNumber >= b.from && lineNumber <= b.to) ?? null;
        const state: CodeLinesRowState = {
          line: lineNumber,
          text: line,
          highlighted:
            highlight !== null &&
            lineNumber >= highlight[0] &&
            lineNumber <= highlight[1],
          // `search` ignores `lastIndex`, so a global or sticky pattern gives
          // the same answer on every row.
          tinted: tintPattern !== undefined && line.search(tintPattern) >= 0,
          muted: mutedPattern !== undefined && line.search(mutedPattern) >= 0,
          band,
          labelled:
            band !== null && lineNumber === Math.max(band.from, firstInView),
          inView:
            visible !== null && index >= visible.first && index <= visible.last,
        };
        const attributes = rowAttributes?.(state) ?? {};

        return (
          <div
            {...attributes.row}
            className={cx(classes.row, classNames?.row)}
            data-line={lineNumber}
            data-highlighted={state.highlighted || undefined}
          >
            {hasGutter && (
              <div
                {...attributes.gutter}
                className={cx(classes.gutter, classNames?.gutter)}
                data-gutter
                data-tone={band ? (band.tone ?? 'muted') : undefined}
              >
                {band && state.labelled && (
                  <span
                    {...attributes.gutterLabel}
                    className={cx(classes.gutterLabel, classNames?.gutterLabel)}
                  >
                    {band.label}
                  </span>
                )}
              </div>
            )}
            <div
              {...attributes.numberCell}
              className={cx(classes.numberCell, classNames?.numberCell)}
            >
              <span
                {...attributes.number}
                className={cx(classes.number, classNames?.number)}
              >
                {lineNumber}
              </span>
            </div>
            <span
              {...attributes.code}
              className={cx(classes.code, classNames?.code)}
              data-tinted={state.tinted || undefined}
              data-muted={state.muted || undefined}
            >
              {line}
            </span>
          </div>
        );
      }}
    />
  );
}
