import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Chip, Markdown } from '@mattstack/tui-kit';
import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import { ClickToEditField } from './ClickToEditField.tsx';
import { AgentGlyph, CommentGlyph } from './icons.tsx';

/**
 * First build pass of the click-to-edit comment (board.pen B26 and B27):
 * every comment reads rendered, a click on its text opens the raw Markdown
 * with the caret at the click, and there is no Write/Preview toggle. The
 * summary card stacks bare fields so it reads as the one comment the forge
 * shows; a comment from a finding edits in the summary or in its own card,
 * both on the same text. Invented content only (the repo is public).
 */
function Stage({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark';
  children: ReactNode;
}) {
  return (
    <div
      className={scheme === 'dark' ? 'dark' : undefined}
      style={{
        background: 'var(--page)',
        color: 'var(--text-1)',
        minHeight: '100vh',
        padding: 32,
        boxSizing: 'border-box',
      }}
    >
      <SoribashiProvider theme={tuiTheme}>
        <div style={{ maxWidth: 860 }}>{children}</div>
      </SoribashiProvider>
    </div>
  );
}

const meta = {
  title: 'Gates/Board/Click to edit',
  decorators: [
    (Story, context) => (
      <Stage scheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}>
        <Story />
      </Stage>
    ),
  ],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const FINDINGS = [
  {
    id: 'f1',
    title: 'No run for the --changed flag',
    body: 'The AC for `--changed` on files under `src/jobs/**` has no run in the evidence.',
    comment:
      '**suggestion:** thanks for the extra evidence, that covers it nicely. the one AC without a run is `--changed` picking up a file under `src/jobs/**`... would you mind grabbing one quick run of that?',
  },
  {
    id: 'f2',
    title: 'Stale comments and a stale stat name',
    body: 'Comments in `scan-jobs.ts` still describe the old single folder, and `stats.reachableInJobs` now counts both.',
    comment:
      "**nitpick:** a few comments in `scan-jobs.ts` still describe the old single folder: `JobRow.path` (:88) says it's relative to `src/jobs/`. `stats.reachableInJobs` (:140) counts both folders now too, so maybe rename it?",
  },
  {
    id: 'f3',
    title: 'README is out of step with the script',
    body: 'The README still names the old folder, and nothing mentions the path change.',
    comment:
      '**suggestion:** the `README.md` still says the scanner reads `src/jobs` (:42). anyone with a local overlay keyed on the old paths will get `merged 0/N` with no hint why. could we add a line about both? see [the overlay docs](https://example.test/docs/overlay).',
  },
];

function SummaryAndFindings() {
  const [summary, setSummary] = useState(
    'Left a few comments, the `retryPolicy` one is the main one.'
  );
  const [texts, setTexts] = useState<Record<string, string>>(
    Object.fromEntries(FINDINGS.map(f => [f.id, f.comment]))
  );
  const [ticked, setTicked] = useState(new Set(FINDINGS.map(f => f.id)));
  const [editing, setEditing] = useState<string | null>(null);
  const setText = (id: string) => (t: string) =>
    setTexts(prev => ({ ...prev, [id]: t }));
  const track = (key: string) => (on: boolean) =>
    setEditing(prev => (on ? key : prev === key ? null : prev));
  const folded = FINDINGS.filter(f => ticked.has(f.id));
  return (
    <>
      <div className="tui-sheet-list-head" style={{ marginTop: 0 }}>
        <span className="tui-sheet-list-title">Summary comment</span>
        <span
          className="tui-sheet-list-tally"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}
        >
          <Chip intent="accent" variant="outline" uppercase>
            for comment
          </Chip>
          posts on !1182
        </span>
      </div>
      <article className="tui-review-card tui-review-summary">
        <section className="tui-review-section">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ClickToEditField
              label="Summary line"
              text={summary}
              variant="bare"
              stripe="always"
              hint={false}
              onChange={setSummary}
              onEditing={track('summary')}
            />
            {folded.map(f => (
              <ClickToEditField
                key={f.id}
                label={`Summary comment: ${f.title}`}
                text={texts[f.id]!}
                variant="bare"
                stripe="always"
                hint={false}
                onChange={setText(f.id)}
                onEditing={track(`summary:${f.id}`)}
              />
            ))}
          </div>
          {editing?.startsWith('summary') && (
            <span className="tui-cte-hint">Markdown supported</span>
          )}
        </section>
      </article>

      <div className="tui-sheet-list-head">
        <span className="tui-sheet-list-title">Findings</span>
        <span className="tui-sheet-list-tally">
          {ticked.size} of {FINDINGS.length} selected
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {FINDINGS.map(f => {
          const on = ticked.has(f.id);
          return (
            <article
              key={f.id}
              className="tui-review-finding tui-review-card"
              data-off={on ? undefined : ''}
            >
              <label className="tui-review-finding-row tui-review-card-head">
                <input
                  type="checkbox"
                  className="tui-gate-choice-input"
                  data-type="checkbox"
                  data-checked={on ? '' : undefined}
                  checked={on}
                  onChange={e =>
                    setTicked(prev => {
                      const next = new Set(prev);
                      if (e.currentTarget.checked) next.add(f.id);
                      else next.delete(f.id);
                      return next;
                    })
                  }
                />
                <span className="tui-review-finding-title">{f.title}</span>
              </label>
              {on && (
                <>
                  <section className="tui-review-section">
                    <div className="tui-review-section-head">
                      <span
                        className="tui-review-section-name"
                        data-hue="accent"
                      >
                        <AgentGlyph />
                        Agent Finding
                      </span>
                    </div>
                    <div className="tui-review-section-body">
                      <Markdown unstyled linkTargetBlank>
                        {f.body}
                      </Markdown>
                    </div>
                  </section>
                  <section className="tui-review-section">
                    <div className="tui-review-section-head">
                      <span className="tui-review-section-name" data-hue="ok">
                        <CommentGlyph />
                        Comment
                      </span>
                      <span className="tui-review-section-meta">
                        {editing === `summary:${f.id}`
                          ? 'editing in summary'
                          : 'posts in summary'}
                      </span>
                    </div>
                    <ClickToEditField
                      label={`Comment on ${f.title}`}
                      text={texts[f.id]!}
                      onChange={setText(f.id)}
                      onEditing={track(`card:${f.id}`)}
                    />
                  </section>
                </>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

export const SummaryWithFindings: Story = {
  name: 'Summary and finding cards',
  render: () => <SummaryAndFindings />,
};

function OneField() {
  const [text, setText] = useState(
    [
      '**question:** does the retry here back off, or hammer the queue?',
      '',
      '- `retryPolicy.max` is 5',
      '- the delay looks fixed at 200ms',
      '',
      '```ts',
      'await retry(job, { max: 5, delayMs: 200 });',
      '```',
      '',
      'see [the retry notes](https://example.test/retry) for the old numbers.',
    ].join('\n')
  );
  return <ClickToEditField label="Comment" text={text} onChange={setText} />;
}

export const SingleField: Story = {
  name: 'One boxed field (lists, code, a link)',
  render: () => <OneField />,
};

function EmptyField() {
  const [text, setText] = useState('');
  return (
    <ClickToEditField
      label="Comment"
      text={text}
      invalid={text.trim() === ''}
      onChange={setText}
    />
  );
}

export const Empty: Story = {
  name: 'An empty comment',
  render: () => <EmptyField />,
};
