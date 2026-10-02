import { useMemo } from 'react';
import {
  Box,
  CodeLines,
  Skeleton,
  Text,
  type CodeLinesRowAttributes,
  type CodeLinesRowState,
} from '@mattstack/app-kit/core';
import { useElementSize } from '@mattstack/app-kit/hooks';

import { useSkillSource } from '../../useWiring';
import type { DrawerContent } from '../model/drawerContent';
import classes from './drawer.module.css';

const PLACEHOLDER = /\{\{[^}]+\}\}/;
/** The compiler's own comment lines, which mark where each part starts. */
const MARKER = /^<!--/;
/** Lines shown above a highlighted range when the drawer opens on it. */
const CONTEXT_LINES = 15;

const CODE_CLASSES = {
  gutter: classes.band,
  gutterLabel: classes.bandLabel,
  numberCell: classes.numberCell,
  number: classes.number,
  code: classes.text,
};

/** The board layers a row matches: rows scrolled out of view are not drawn
    there, and a row, band cell or line of code is a layer only where it
    paints. */
function parityLayers(row: CodeLinesRowState): CodeLinesRowAttributes {
  if (!row.inView) return {};
  return {
    row: row.highlighted ? { 'data-parity': `line ${row.line}` } : undefined,
    gutter: row.band ? { 'data-parity': 'part' } : undefined,
    gutterLabel: { 'data-parity': 'p' },
    number: { 'data-parity': 'n' },
    code: row.text ? { 'data-parity': 'code' } : undefined,
  };
}

export function linesOf(content: string): string[] {
  return content.replace(/\n$/, '').split('\n');
}

/** Where the drawer opens a file: a few lines above its highlighted range,
    or the range itself when a panel above leaves less room. */
export function scrollLineOf(
  highlight: [number, number] | null,
  context = CONTEXT_LINES
) {
  return highlight ? Math.max(1, highlight[0] - context) : null;
}

/** The file the drawer reads, numbered, its range highlighted and each pasted
    part banded in the gutter. */
export function TextTab({
  pack,
  content,
  beneathPanel = false,
}: {
  pack: string;
  content: DrawerContent;
  /** Under a panel that edits it: dimmed, and opened at its range. */
  beneathPanel?: boolean;
}) {
  const source = useSkillSource(pack, content.filePath);
  const { ref, height } = useElementSize();
  const lines = useMemo(
    () => (source.data ? linesOf(source.data.content) : null),
    [source.data]
  );
  const highlight = content.highlight[content.view];
  const banded = content.bands.length > 0;

  return (
    <Box
      className={classes.code}
      data-banded={banded || undefined}
      data-dimmed={beneathPanel || undefined}
      data-parity="code"
      data-testid="drawer-text"
    >
      <div ref={ref} className={classes.viewport}>
        {source.isError ? (
          <Text size="sm" px={18} c="var(--tk-text-3)">
            {(source.error as Error).message}
          </Text>
        ) : lines ? (
          <CodeLines
            key={`${content.filePath}:${content.view}`}
            lines={lines}
            height={height}
            variant="wash"
            highlight={highlight}
            bands={content.bands}
            tintPattern={PLACEHOLDER}
            mutedPattern={MARKER}
            scrollTo={scrollLineOf(highlight, beneathPanel ? 0 : undefined)}
            classNames={CODE_CLASSES}
            scrollbarType="hover"
            rowAttributes={parityLayers}
          />
        ) : (
          <Skeleton height={16} mx={18} width="60%" />
        )}
      </div>
    </Box>
  );
}
