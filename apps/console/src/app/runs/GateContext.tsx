import { isValidElement, type ReactNode } from 'react';
import { Anchor, Blockquote, Code, List } from '@mattstack/app-kit/core';
import Markdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import classes from './GateContext.module.css';

/** remark-breaks keeps a context written as plain lines (every gate opened
    before contexts were Markdown) from collapsing into one paragraph. */
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/** A fenced block's text: Markdown renders it as `pre > code`, and `code`
    is already the inline kit Code by the time `pre` sees it. */
function fencedText(children: ReactNode): ReactNode {
  return isValidElement<{ children?: ReactNode }>(children)
    ? children.props.children
    : children;
}

/** Markdown's elements as kit components; a caller's `components` replace
    these. */
const KIT: Components = {
  code: ({ children }) => <Code>{children}</Code>,
  pre: ({ children }) => <Code block>{fencedText(children)}</Code>,
  blockquote: ({ children }) => (
    <Blockquote color="gray" className={classes.quote}>
      {children}
    </Blockquote>
  ),
  ul: ({ children }) => (
    <List fz="inherit" spacing={4} className={classes.list}>
      {children}
    </List>
  ),
  ol: ({ children }) => (
    <List type="ordered" fz="inherit" spacing={4} className={classes.list}>
      {children}
    </List>
  ),
  li: ({ children }) => <List.Item>{children}</List.Item>,
};

const SAFE: Components = {
  a: ({ href, children }) => (
    <Anchor href={href} target="_blank" rel="noreferrer" inherit>
      {children}
    </Anchor>
  ),
  // Context can quote untrusted text (an MR under review); an image would
  // make the console fetch any URL it names.
  img: ({ alt }) => <span>{alt}</span>,
};

/** `components` add to the safe defaults, never replace `a` or `img`.
    `fill` lets the text run the width of its column instead of a line
    length that reads comfortably. */
export function GateContext({
  text,
  className,
  components,
  fill = false,
}: {
  text: string;
  className?: string;
  components?: Omit<Components, 'a' | 'img'>;
  fill?: boolean;
}) {
  return (
    <div
      className={className ? `${classes.prose} ${className}` : classes.prose}
      data-fill={fill || undefined}
      data-testid="gate-context-body"
    >
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        components={{ ...KIT, ...components, ...SAFE }}
      >
        {text}
      </Markdown>
    </div>
  );
}
