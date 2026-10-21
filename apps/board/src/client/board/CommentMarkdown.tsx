import { Component, Suspense, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useCodeBlock } from './diff-source.ts';

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/** A fence's info string as react-markdown hands it on: `language-ts`, or
    GitLab's `language-suggestion:-0+0`. */
function fenceLang(code: HastNode | undefined): string | undefined {
  const cls = code?.properties?.className;
  const first = Array.isArray(cls) ? cls[0] : undefined;
  return typeof first === 'string' && first.startsWith('language-')
    ? first.slice('language-'.length)
    : undefined;
}

function PlainCode({ code }: { code: string }) {
  return (
    <pre className="tui-md-code-body">
      <code>{code}</code>
    </pre>
  );
}

/** Keeps a highlighter chunk that fails to load from throwing past
    Suspense and taking the whole sheet (and its unsaved edits) down. */
class HighlightBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A fenced code block: a labelled block, highlighted once the sheet's
    source brings the highlighter and the language is one it knows, and a
    plain block otherwise. A `suggestion` fence is the forge's suggested
    change, labelled so. */
function CodeFence({ lang, code }: { lang?: string; code: string }) {
  const Highlighted = useCodeBlock();
  const suggestion = lang !== undefined && /^suggestion\b/.test(lang);
  const plain = <PlainCode code={code} />;
  return (
    <div
      className="tui-md-code"
      data-suggestion={suggestion || undefined}
      data-lang={suggestion ? undefined : lang}
    >
      <div className="tui-md-code-head">
        {suggestion ? 'Suggested change' : (lang ?? 'code')}
      </div>
      {Highlighted && lang && !suggestion ? (
        <HighlightBoundary fallback={plain}>
          <Suspense fallback={plain}>
            <Highlighted lang={lang} code={code} fallback={plain} />
          </Suspense>
        </HighlightBoundary>
      ) : (
        plain
      )}
    </div>
  );
}

const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  pre: ({ node }) => {
    const code = (node as HastNode | undefined)?.children?.find(
      c => c.tagName === 'code'
    );
    return (
      <CodeFence
        lang={fenceLang(code)}
        code={hastText(code).replace(/\n$/, '')}
      />
    );
  },
};

/** A comment's text as it will read on the MR: the Markdown subset review
    comments use, in board type and colours. */
export function CommentMarkdown({ children }: { children: string }): ReactNode {
  return (
    <div className="tui-md-comment">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
