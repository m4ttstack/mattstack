import 'github-markdown-css/github-markdown.css';

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import classes from './markdownText.module.css';

const REMARK_PLUGINS = [remarkGfm];

const SAFE: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // A block can quote text from anywhere; an image would make the console
  // fetch any URL it names.
  img: ({ alt }) => <span>{alt}</span>,
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
    <div className={`markdown-body ${classes.body}`} data-testid="markdown-text">
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
