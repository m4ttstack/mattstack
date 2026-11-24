import { useLayoutEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  CopyActionIcon,
  Paper,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './code-block.module.css';

export interface CodeBlockProps {
  code: string;
}

/** Whether a line is wider than the block: wrapped, it takes more rows than
    the code has lines; unwrapped, it scrolls sideways. */
function hasLongLine(pre: HTMLElement, code: string, wrap: boolean): boolean {
  if (!wrap) return pre.scrollWidth > pre.clientWidth;
  const rows =
    (pre.firstElementChild as HTMLElement).offsetHeight /
    parseFloat(getComputedStyle(pre).lineHeight);
  return Math.round(rows) > code.split('\n').length;
}

/** A fence in a message. Long lines wrap until the reader turns that off for
    the block. */
export function CodeBlock({ code }: CodeBlockProps) {
  const [wrap, setWrap] = useState(true);
  const [longLine, setLongLine] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    const pre = preRef.current;
    if (!pre) return;
    const measure = () => setLongLine(hasLongLine(pre, code, wrap));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pre);
    return () => observer.disconnect();
  }, [code, wrap]);

  const wrapTip = wrap ? "Don't wrap lines" : 'Wrap lines';
  return (
    <Paper
      withBorder
      bg="var(--tk-panel)"
      radius="sm"
      className={classes.block}
      data-testid="code-block"
    >
      <pre
        ref={preRef}
        className={classes.pre}
        data-wrap={wrap || undefined}
        tabIndex={wrap ? undefined : 0}
      >
        <code>{code}</code>
      </pre>
      <div className={classes.corner}>
        <Paper
          withBorder
          bg="var(--tk-card)"
          shadow="sm"
          radius="md"
          className={classes.toolbar}
        >
          {longLine && (
            <Tooltip label={wrapTip} position="top" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={22}
                radius="sm"
                aria-label="Wrap lines"
                aria-pressed={wrap}
                onClick={() => setWrap(!wrap)}
              >
                <Icon name="wrapText" size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <CopyActionIcon
            value={code}
            label="Copy code"
            tooltipPosition="top"
            size={22}
            iconSize={16}
            radius="sm"
          />
        </Paper>
      </div>
    </Paper>
  );
}
