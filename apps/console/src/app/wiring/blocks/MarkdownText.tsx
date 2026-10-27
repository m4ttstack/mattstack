import 'github-markdown-css/github-markdown.css';

import { Icon } from '@mattstack/app-kit/icons';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import classes from './markdownText.module.css';
import { SourceLines } from './MermaidSource';

const REMARK_PLUGINS = [remarkGfm];

/** Graph sources fold shut: the flow row draws them. */
const GRAPH_LANGS = new Set(['dot', 'graphviz', 'mermaid']);

const SAFE: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // A block can quote text from anywhere; an image would make the console
  // fetch any URL it names.
  img: ({ alt }) => <span>{alt}</span>,
  pre: ({ node, children }) => {
    const code = node?.children[0];
    const names =
      code && code.type === 'element' ? code.properties.className : null;
    const lang = Array.isArray(names)
      ? names.map(String).find(name => name.startsWith('language-'))
      : undefined;
    const graph = lang?.slice('language-'.length);
    if (!graph || !GRAPH_LANGS.has(graph)) return <pre>{children}</pre>;
    const text =
      code?.type === 'element' && code.children[0]?.type === 'text'
        ? code.children[0].value
        : '';
    const lines = text.replace(/\n$/, '').split('\n').length;
    return (
      <div className={classes.graphFoldSpace}>
        <details className={classes.graphFold} data-testid="graph-fold">
          <summary>
            <Icon name="workflow" size={14} className={classes.foldIcon} />
            <span className={classes.foldName}>Graph source</span>
            <span
              className={classes.foldMeta}
            >{`${graph} · ${lines} lines`}</span>
            <span className={classes.foldAction} aria-hidden />
            <Icon
              name="chevronDown"
              size={14}
              className={classes.foldChevron}
            />
          </summary>
          <SourceLines
            source={text}
            language={graph === 'mermaid' ? 'mermaid' : 'dot'}
          />
        </details>
      </div>
    );
  },
};

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;
const COMMENT = /<!--[\s\S]*?-->\n?/g;
const KEY = /^([\w-]+):\s*(.*)$/;

/** A file's YAML front matter by its top-level keys, each key's indented
    lines kept with it. */
function frontMatterRows(yaml: string): [string, string][] {
  const rows: [string, string][] = [];
  for (const line of yaml.split('\n')) {
    const key = KEY.exec(line);
    if (key) rows.push([key[1]!, key[2]!]);
    else if (rows.length > 0) rows.at(-1)![1] += `\n${line}`;
  }
  return rows.map(([key, value]) => [
    key,
    value.trim().replace(/^"([\s\S]*)"$/, '$1'),
  ]);
}

/** A block's Markdown as GitHub renders it: GitHub's own stylesheet over
    react-markdown, coloured from the kit's tokens. A whole file's front
    matter shows as a table of its keys, as GitHub shows it, and HTML
    comments, which GitHub never shows, are dropped. */
export function MarkdownText({ text }: { text: string }) {
  const front = FRONT_MATTER.exec(text);
  const body = (front ? text.slice(front[0].length) : text).replace(
    COMMENT,
    ''
  );
  return (
    <div
      className={`markdown-body ${classes.body}`}
      data-testid="markdown-text"
    >
      {front && (
        <table data-testid="front-matter">
          <tbody>
            {frontMatterRows(front[1]!).map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td className={classes.frontValue}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Markdown remarkPlugins={REMARK_PLUGINS} components={SAFE}>
        {body}
      </Markdown>
    </div>
  );
}
