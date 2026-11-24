import { CopyActionIcon, Paper } from '@mattstack/app-kit/core';

import classes from './code-block.module.css';

export interface CodeBlockProps {
  code: string;
}

/** A fence in a message: long lines wrap, so nothing scrolls sideways, and
    the copy control sits in its own column, so it never covers code. */
export function CodeBlock({ code }: CodeBlockProps) {
  return (
    <Paper
      withBorder
      bg="var(--tk-panel)"
      className={classes.block}
      data-testid="code-block"
    >
      <pre className={classes.pre}>
        <code>{code}</code>
      </pre>
      <CopyActionIcon
        className={classes.copy}
        value={code}
        label="Copy code"
        tooltipPosition="top"
        size="sm"
        iconSize={14}
      />
    </Paper>
  );
}
