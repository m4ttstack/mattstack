import { useEffect, useState, type ReactNode } from 'react';

import { Icon } from '@mattstack/tui-kit';
import type { StepState, SyncView } from './sync-steps.ts';

// lucide-react 1.34.0 path data (ISC licensed, https://lucide.dev).
const PATHS = {
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  diamond:
    'M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z',
  circle: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0',
  minus: 'M5 12h14',
  chevron: 'M9 18l6-6-6-6',
  tree: 'M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5M18 16a2 2 0 1 0 4 0a2 2 0 1 0-4 0M14 22a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 14v.5M16 20v-1.5M18 18.5L16 20',
};

const GLYPH: Partial<Record<StepState, keyof typeof PATHS>> = {
  done: 'check',
  failed: 'x',
  paused: 'diamond',
  pending: 'circle',
  skipped: 'minus',
};

function StepGlyph({ state }: { state: StepState }) {
  if (state === 'running')
    return <span className="tui-syncsteps-ring" aria-hidden />;
  const name = GLYPH[state]!;
  const size = state === 'pending' ? 10 : 13;
  return <Icon d={PATHS[name]} width={size} height={size} />;
}

function CopyRef({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="tui-syncsteps-action"
      title="Copy the backup branch"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

/** The backup branch's time of day: it is what tells two backups apart. */
const shortRef = (ref: string) => {
  const parts = ref.split('/');
  if (parts.length <= 2) return ref;
  const stamp = parts.at(-1)!;
  return `${parts[0]}/…/${stamp.split('T').at(-1)}`;
};

/** A local sync as four fixed steps, with the raw log one click away. */
export function SyncSteps({
  view,
  raw,
  handoff,
}: {
  view: SyncView;
  /** The terminal-style log, shown under "Raw output". */
  raw: ReactNode;
  /** A doctor picked up the paused rebase. */
  handoff?: { onFocus: () => void };
}) {
  const [showRaw, setShowRaw] = useState(false);
  const note =
    handoff && view.outcome === 'paused'
      ? { tone: 'work' as const, text: 'Doctor resolving' }
      : // A stop no step owns (a refusal) says why here; a step's own
        // failure already says it on its line.
        view.failure && !view.steps.some(s => s.state === 'failed')
        ? { tone: 'bad' as const, text: view.failure }
        : null;
  return (
    <div className="tui-syncsteps" data-outcome={view.outcome}>
      <div className="tui-syncsteps-head">
        <span className="tui-syncsteps-title">{view.title}</span>
        {view.tree && (
          <span className="tui-syncsteps-tree" title="Worktree">
            <Icon d={PATHS.tree} width={12} height={12} />
            {view.tree}
          </span>
        )}
      </div>
      <ol className="tui-syncsteps-list">
        {view.steps.map(step => (
          <li
            key={step.key}
            className="tui-syncsteps-step"
            data-state={step.state}
          >
            <span className="tui-syncsteps-glyph">
              <StepGlyph state={step.state} />
            </span>
            <span className="tui-syncsteps-label">{step.label}</span>
            {step.ref ? (
              <>
                <code className="tui-syncsteps-ref" title={step.ref}>
                  {shortRef(step.ref)}
                </code>
                <CopyRef value={step.ref} />
              </>
            ) : (
              step.detail && (
                <span className="tui-syncsteps-detail">{step.detail}</span>
              )
            )}
          </li>
        ))}
      </ol>
      {note && (
        <div className="tui-syncsteps-note" data-tone={note.tone}>
          <span className="tui-syncsteps-note-text">
            {note.tone === 'work' && (
              <span className="tui-syncsteps-ring" aria-hidden />
            )}
            {note.text}
          </span>
          {handoff && note.tone === 'work' && (
            <button
              type="button"
              className="tui-syncsteps-action"
              onClick={handoff.onFocus}
            >
              focus
            </button>
          )}
        </div>
      )}
      <div className="tui-syncsteps-foot">
        <button
          type="button"
          className="tui-syncsteps-raw"
          aria-expanded={showRaw}
          onClick={() => setShowRaw(v => !v)}
        >
          <Icon d={PATHS.chevron} width={12} height={12} />
          Raw output
        </button>
      </div>
      {showRaw && <div className="tui-syncsteps-rawlog">{raw}</div>}
    </div>
  );
}
