import Markdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import classes from './GateContext.module.css';

/** remark-breaks keeps a context written as plain lines (every gate opened
    before contexts were Markdown) from collapsing into one paragraph. */
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

export function GateContext({ text }: { text: string }) {
  return (
    <div className={classes.prose} data-testid="gate-context-body">
      <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}
