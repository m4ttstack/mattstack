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
  // Context can quote untrusted text (an MR under review); an image would
  // make the console fetch any URL it names.
  img: ({ alt }) => <span>{alt}</span>,
};

/** `components` add to the safe defaults, never replace `a` or `img`. */
export function GateContext({
  text,
  className,
  components,
}: {
  text: string;
  className?: string;
  components?: Omit<Components, 'a' | 'img'>;
}) {
  return (
    <div
      className={className ? `${classes.prose} ${className}` : classes.prose}
      data-testid="gate-context-body"
    >
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        components={{ ...components, ...COMPONENTS }}
      >
        {text}
      </Markdown>
    </div>
  );
}
