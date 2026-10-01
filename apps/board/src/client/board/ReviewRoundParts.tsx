import { useState } from 'react';

import type { GateSelections } from '@mattstack/gate-kit';
import { Markdown } from '@mattstack/tui-kit';
import { Disclosure, DisclosureHead } from './Disclosure.tsx';
import type { CarryoverCall, SkippedEntry } from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import { editedText, sendableTexts } from './respond-post.ts';
import { EditableReply, EditedChip, PostResolveChoice } from './RespondCards.tsx';
import { SEVERITY_LABEL, type CarryoverPick } from './review-gate.ts';

/** Every label names who has to act; none says "open" or "unresolved". */
export const CARRYOVER_CALL: Record<
  CarryoverCall,
  { text: string; hue: 'green' | 'amber' | 'accent' }
> = {
  fixed: { text: 'fixed by author', hue: 'green' },
  'not-fixed': { text: 'waiting on author', hue: 'amber' },
  'pushback-accepted': { text: 'author pushed back · accept', hue: 'accent' },
  'pushback-rejected': { text: 'author pushed back · hold firm', hue: 'amber' },
};

export function isPosting(
  pick: CarryoverPick,
  selections: GateSelections
): boolean {
  const v = selections[pick.name];
  return Array.isArray(v) && v.includes(pick.post);
}

export function isResolving(
  pick: CarryoverPick,
  selections: GateSelections
): boolean {
  const v = selections[pick.name];
  return Array.isArray(v) && v.includes(pick.resolve);
}

/** The trimmed edit each posting reply sends; null while one is empty. */
export function carryoverTexts(
  picks: CarryoverPick[],
  selections: GateSelections,
  texts: Record<string, string>
): Record<string, string> | null {
  return sendableTexts(
    picks.map(p => ({
      name: p.name,
      draft: p.carry.reply,
      active: isPosting(p, selections),
    })),
    texts
  );
}

/** "2 fixed · 1 pushback accepted · 1 waiting on author" */
export function carryoverTally(picks: CarryoverPick[]): string {
  let fixed = 0;
  let accepted = 0;
  let waiting = 0;
  for (const p of picks) {
    if (p.carry.call === 'fixed') fixed++;
    else if (p.carry.call === 'pushback-accepted') accepted++;
    else waiting++;
  }
  return [
    fixed > 0 ? `${fixed} fixed` : null,
    accepted > 0 ? `${accepted} pushback accepted` : null,
    waiting > 0 ? `${waiting} waiting on author` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Quote({
  k,
  who,
  text,
}: {
  k: string;
  who: 'you' | 'author';
  text: string;
}) {
  return (
    <div className="tui-carry-quote" data-who={who}>
      <span className="tui-carry-quote-k">{k}</span>
      <div className="tui-carry-quote-text">
        <Markdown unstyled linkTargetBlank>
          {text}
        </Markdown>
      </div>
    </div>
  );
}

/** One of the reviewer's earlier threads: what they wrote, what the author
    said back, the agent's check, and the reply this round posts, with the
    respond gate's own post/hold and resolve controls. */
export function CarryoverCard({
  pick,
  form,
}: {
  pick: CarryoverPick;
  form: GateFormState;
}) {
  const { carry } = pick;
  const posting = isPosting(pick, form.selections);
  const edited = posting && editedText(pick.name, carry.reply, form.texts);
  const call = CARRYOVER_CALL[carry.call];
  return (
    <section
      className="tui-gate-question"
      data-gate-ctx="thread"
      data-step="carryover"
      aria-label={pick.label}
    >
      <div className="tui-gate-question-head">
        <span className="tui-gate-question-label">{pick.label}</span>
        <span
          className="tui-respond-chip tui-thread-outcome"
          data-hue={call.hue}
          data-call={carry.call}
        >
          {call.text}
        </span>
        {edited && <EditedChip />}
      </div>
      <div className="tui-thread-card">
        <Quote
          k={`you wrote · round ${carry.round}`}
          who="you"
          text={carry.original}
        />
        {carry.authorReply ? (
          <Quote k="author replied" who="author" text={carry.authorReply} />
        ) : (
          <p className="tui-thread-nothing">
            The author hasn't replied in this thread.
          </p>
        )}
        {carry.note && (
          <div className="tui-thread-verdict">
            <span className="tui-thread-verdict-k">check</span>
            <span className="tui-thread-verdict-note">{carry.note}</span>
          </div>
        )}
        <EditableReply
          label={pick.label}
          draft={carry.reply}
          value={posting ? form.texts[pick.name] : undefined}
          canEdit={posting}
          onChange={t => form.setText(pick.name, t)}
          onReset={() => form.clearText(pick.name)}
        />
      </div>
      <PostResolveChoice pick={pick} form={form} />
    </section>
  );
}

/** A finding's file:line with its folders set back, so the file name reads
    first on a long path. */
export function FindingAnchor({ file }: { file: string }) {
  const cut = file.lastIndexOf('/') + 1;
  return (
    <span className="tui-review-finding-anchor">
      {cut > 0 && (
        <span className="tui-review-finding-dir">{file.slice(0, cut)}</span>
      )}
      <span className="tui-review-finding-file">{file.slice(cut)}</span>
    </span>
  );
}

/** Findings the reviewer left off the MR in earlier rounds. Closed unless
    something in it is already coming back; nothing in it is ticked until
    the reviewer ticks it. */
export function SkippedEarlier({
  entries,
  selected,
  onToggle,
}: {
  entries: Array<[string, SkippedEntry]>;
  selected: Set<string>;
  onToggle: (value: string, on: boolean) => void;
}) {
  const restoring = entries.filter(([v]) => selected.has(v)).length;
  const [open, setOpen] = useState(restoring > 0);
  return (
    <div className="tui-review-skipped">
      <DisclosureHead
        open={open}
        label="skipped earlier"
        onToggle={() => setOpen(o => !o)}
        className="tui-review-skipped-head"
      >
        <span className="tui-review-skipped-title">
          Skipped earlier ({entries.length})
        </span>
        <span className="tui-review-skipped-hint">
          {restoring > 0
            ? `${restoring} coming back this round`
            : 'you chose not to raise these'}
        </span>
      </DisclosureHead>
      <Disclosure open={open}>
        <div className="tui-review-skipped-list">
          {entries.map(([value, e]) => {
            const checked = selected.has(value);
            const titleId = `tui-review-skipped-title-${e.id}`;
            return (
              <label className="tui-review-finding-row" key={value}>
                <input
                  type="checkbox"
                  className="tui-gate-choice-input"
                  data-type="checkbox"
                  data-checked={checked ? '' : undefined}
                  checked={checked}
                  aria-labelledby={titleId}
                  aria-description="bring this finding back this round"
                  onChange={ev => onToggle(value, ev.currentTarget.checked)}
                />
                <span className="tui-review-finding-body">
                  <span className="tui-review-finding-line1">
                    <span className="tui-review-finding-title" id={titleId}>
                      {e.title}
                    </span>
                    {e.changed && (
                      <span
                        className="tui-respond-pill"
                        data-hue="amber"
                        data-changed=""
                      >
                        code changed since
                      </span>
                    )}
                    <span
                      className="tui-review-tier-pill"
                      data-tier={SEVERITY_LABEL[e.severity]}
                    >
                      {SEVERITY_LABEL[e.severity]}
                    </span>
                    <span className="tui-respond-pill" data-hue="grey">
                      skipped · round {e.round}
                    </span>
                  </span>
                  {e.file && <FindingAnchor file={e.file} />}
                </span>
              </label>
            );
          })}
        </div>
      </Disclosure>
    </div>
  );
}
