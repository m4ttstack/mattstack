import { Text } from '@mantine/core';

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
  /** Shown in the gutter on the band's first row. */
  label: string;
  /** `accent` marks the band the viewer is looking at. @default 'muted' */
  tone?: 'accent' | 'muted';
};

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
  /** Viewport height in px. */
  height: number;
  /** Line number to bring to the top of the viewport. */
  scrollTo?: number | null;
}

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
  height,
  scrollTo = null,
}: CodeLinesProps) {
  const hasGutter = bands !== undefined && bands.length > 0;
  const numberWidth = `${String(firstLine + lines.length - 1).length}ch`;

  return (
    <VirtualList
      items={lines}
      estimateSize={() => ROW_HEIGHT}
      overscan={OVERSCAN}
      maxHeight={height}
      minHeight={height}
      scrollToIndex={scrollTo === null ? null : scrollTo - firstLine}
      renderRow={(line, index) => {
        const lineNumber = firstLine + index;
        const band = bands?.find(
          b => lineNumber >= b.from && lineNumber <= b.to
        );
        const highlighted =
          highlight !== null &&
          lineNumber >= highlight[0] &&
          lineNumber <= highlight[1];
        // `search` ignores `lastIndex`, so a global or sticky pattern gives
        // the same answer on every row.
        const tinted =
          tintPattern !== undefined && line.search(tintPattern) >= 0;

        return (
          <div
            className={classes.row}
            data-line={lineNumber}
            data-highlighted={highlighted || undefined}
          >
            {hasGutter && (
              <div
                className={classes.gutter}
                data-gutter
                data-tone={band && (band.tone ?? 'muted')}
              >
                {band && lineNumber === Math.max(band.from, firstLine) && (
                  <Text
                    component="span"
                    ff="monospace"
                    size="xs"
                    truncate
                    c={band.tone === 'accent' ? 'accent' : undefined}
                    className={classes.gutterLabel}
                  >
                    {band.label}
                  </Text>
                )}
              </div>
            )}
            <Text
              component="span"
              ff="monospace"
              size="xs"
              ta="right"
              miw={numberWidth}
              className={classes.number}
            >
              {lineNumber}
            </Text>
            <Text
              component="span"
              ff="monospace"
              size="xs"
              c={tinted ? 'accent' : undefined}
              className={classes.code}
              data-tinted={tinted || undefined}
            >
              {line}
            </Text>
          </div>
        );
      }}
    />
  );
}
