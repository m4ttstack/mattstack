import { useState } from 'react';

import type { GateSelections } from '@mattstack/gate-kit';
import { Disclosure, DisclosureHead } from './Disclosure.tsx';
import type { CarryoverCall, SkippedEntry } from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import { sendableTexts } from './respond-post.ts';
import { SEVERITY_LABEL, type CarryoverPick } from './review-gate.ts';
import { ThreadReplyCard } from './ThreadReplyCard.tsx';

/** Every label names who has to act; none says "open" or "unresolved". */
export const CARRYOVER_CALL: Record<
  CarryoverCall,
  { text: string; hue: 'green' | 'amber' | 'accent' }
> = {
  fixed: { text: 'Fixed', hue: 'green' },
  'not-fixed': { text: 'Waiting on author', hue: 'amber' },
  'pushback-accepted': { text: 'Pushback accepted', hue: 'accent' },
  'pushback-rejected': { text: 'Holding firm', hue: 'amber' },
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
  return !!pick.resolve && Array.isArray(v) && v.includes(pick.resolve);
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

/** One of the reviewer's earlier threads: what they wrote, what the author
    said back, the agent's check, and the reply this round posts. */
export function CarryoverCard({
  pick,
  form,
  author,
}: {
  pick: CarryoverPick;
  form: GateFormState;
  /** The MR author's name, who the reviewer's thread is with. */
  author: string;
}) {
  const { carry } = pick;
  const posting = isPosting(pick, form.selections);
  return (
    <ThreadReplyCard
      label={pick.label}
      status={CARRYOVER_CALL[carry.call]}
      messages={[
        { who: 'You', meta: `round ${carry.round}`, text: carry.original },
        ...(carry.authorReply ? [{ who: author, text: carry.authorReply }] : []),
      ]}
      silence={carry.authorReply ? undefined : `${author} hasn't replied.`}
      check={
        carry.note
          ? {
              note: carry.note,
              settled:
                carry.call === 'fixed' || carry.call === 'pushback-accepted',
            }
          : undefined
      }
      draft={carry.reply}
      value={posting ? form.texts[pick.name] : undefined}
      posting={posting}
      onPosting={on => form.toggleMulti(pick.name, pick.post, on)}
      resolve={
        pick.resolve
          ? {
              on: isResolving(pick, form.selections),
              onChange: on => form.toggleMulti(pick.name, pick.resolve!, on),
            }
          : undefined
      }
      onChange={t => form.setText(pick.name, t)}
      onReset={() => form.clearText(pick.name)}
    />
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
        <span className="tui-review-skipped-title">Skipped earlier</span>
        <span className="tui-review-skipped-count">{entries.length}</span>
        <span className="tui-review-skipped-hint">
          {restoring > 0
            ? `${restoring} coming back this round`
            : 'you chose not to raise these · tick one to bring it back'}
        </span>
      </DisclosureHead>
      <Disclosure open={open}>
        <div className="tui-review-skipped-list">
          {entries.map(([value, e]) => {
            const checked = selected.has(value);
            const titleId = `tui-review-skipped-title-${e.id}`;
            return (
              <label
                className="tui-review-finding-row tui-review-skipped-row"
                data-restoring={checked || undefined}
                key={value}
              >
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
                  <span className="tui-review-finding-title" id={titleId}>
                    {e.title}
                  </span>
                  <span className="tui-review-skipped-meta">
                    {e.file && (
                      <span className="tui-review-skipped-path">{e.file}</span>
                    )}
                    <span data-severity={e.severity}>
                      {SEVERITY_LABEL[e.severity]}
                    </span>
                    <span>skipped in round {e.round}</span>
                    {e.changed && (
                      <span className="tui-review-skipped-changed">
                        code changed since
                      </span>
                    )}
                  </span>
                </span>
                {checked && (
                  <span className="tui-review-skipped-restoring">
                    coming back this round
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </Disclosure>
    </div>
  );
}
