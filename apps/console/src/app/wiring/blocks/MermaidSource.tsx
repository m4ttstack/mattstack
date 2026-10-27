import type { ReactNode } from 'react';
import { CopyButton } from '@mattstack/app-kit/core';

import classes from './blocks.module.css';

type Tone =
  'comment' | 'keyword' | 'id' | 'text' | 'arrow' | 'edge' | 'mark' | 'class';

const TOKEN =
  /(%%.*$)|(-->|-\.->|==>|---)|(\|[^|]*\|)|(:::\w+)|(\(\(\(|\)\)\)|\(\[|\]\)|\[\/|\/\]|[[\](){}])|([A-Za-z_][\w-]*)/g;

export type SourceLanguage = 'mermaid' | 'dot';

const DOT_TOKEN =
  /(\/\/.*$|#.*$)|(->|--)|("(?:[^"\\]|\\.)*")|([A-Za-z_]\w*(?==))|([[\]{};=,])|([A-Za-z_][\w-]*)/g;

const DOT_KEYWORD = /^(strict|digraph|graph|subgraph|node|edge)$/;

/** One Graphviz line in the same tones: keywords, node ids, quoted labels as
    words, attribute names and their plain values, arrows and comments. */
function dotTokensOf(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  // An attribute's bare value (`shape=diamond`) is a word, not a node id.
  let afterEquals = false;
  const push = (text: string, tone: Tone | null) => {
    out.push(
      tone ? (
        <span key={out.length} data-tone={tone}>
          {text}
        </span>
      ) : (
        text
      )
    );
  };
  for (const match of line.matchAll(DOT_TOKEN)) {
    const index = match.index ?? 0;
    if (index > at) push(line.slice(at, index), null);
    const [whole, comment, arrow, quoted, attr, mark, word] = match;
    if (comment) push(whole, 'comment');
    else if (arrow) push(whole, 'arrow');
    else if (quoted) push(whole, 'text');
    else if (attr) push(whole, 'class');
    else if (mark) push(whole, 'mark');
    else if (word && afterEquals) push(whole, null);
    else if (word) push(whole, DOT_KEYWORD.test(word) ? 'keyword' : 'id');
    afterEquals = mark === '=';
    at = index + whole.length;
  }
  if (at < line.length) push(line.slice(at), null);
  return out;
}

/** One Mermaid line as coloured spans: a node's id outside its brackets,
    its words inside them, arrows, edge labels and comments each in a tone
    of their own. */
function tokensOf(line: string, first: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let depth = 0;
  let at = 0;
  const push = (text: string, tone: Tone | null) => {
    out.push(
      tone ? (
        <span key={out.length} data-tone={tone}>
          {text}
        </span>
      ) : (
        text
      )
    );
  };
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > at) push(line.slice(at, index), depth > 0 ? 'text' : null);
    const [whole, comment, arrow, edge, cls, mark, word] = match;
    if (comment) push(whole, 'comment');
    else if (arrow) push(whole, 'arrow');
    else if (edge) push(whole, 'edge');
    else if (cls) push(whole, 'class');
    else if (mark) {
      if (/^[[({]/.test(mark)) depth += 1;
      else depth = Math.max(0, depth - 1);
      push(whole, 'mark');
    } else if (word) {
      push(whole, depth > 0 ? 'text' : first && index === 0 ? 'keyword' : 'id');
    }
    at = index + whole.length;
  }
  if (at < line.length) push(line.slice(at), depth > 0 ? 'text' : null);
  return out;
}

/** A graph's source as numbered, coloured lines, in Mermaid or Graphviz. */
export function SourceLines({
  source,
  language = 'mermaid',
}: {
  source: string;
  language?: SourceLanguage;
}) {
  const lines = source.replace(/\n$/, '').split('\n');
  return (
    <pre className={classes.sourceBody}>
      <code>
        {lines.map((line, index) => (
          <span key={index} className={classes.sourceLine}>
            <span className={classes.sourceNumber} aria-hidden>
              {index + 1}
            </span>
            <span>
              {language === 'dot'
                ? dotTokensOf(line)
                : tokensOf(line, index === 0)}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

/** A graph's Mermaid source: numbered, coloured lines under a head that
    names it and copies it. */
export function MermaidSource({ source }: { source: string }) {
  const lines = source.replace(/\n$/, '').split('\n');
  return (
    <div className={classes.sourceView} data-testid="graph-source">
      <div className={classes.sourceHead}>
        <span className={classes.sourceTitle}>Mermaid</span>
        <span className={classes.sourceMeta}>{`${lines.length} lines`}</span>
        <CopyButton
          value={source}
          size="compact-xs"
          variant="default"
          className={classes.sourceCopy}
        >
          Copy
        </CopyButton>
      </div>
      <SourceLines source={source} />
    </div>
  );
}
