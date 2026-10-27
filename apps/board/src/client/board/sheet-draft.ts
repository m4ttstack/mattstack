import { useEffect, useRef, useState } from 'react';

import {
  draftRestorableOn,
  parseSheetDraftReply,
  type SheetDraft,
} from '../../sheet-draft-shape.ts';
import type { GateFormState } from './GateForm.tsx';
import { commentKey, summaryKey } from './review-drafts.ts';

/** Keeps the review sheet's ticks and edits on the board server, per MR, so a
    gate the review agent re-raises after revising a finding (the new gate
    supersedes the old one) comes back the way the reviewer left it. The form state
    lives only in React and the per-gate localStorage draft, neither of which
    follows the reviewer to the new gate. A fresh review run starts clean:
    its launch deletes the draft (server side), and a draft carries the gate
    it was saved on, which restores only onto that gate or the one that
    superseded it, so one never crosses runs. */

const SAVE_DEBOUNCE_MS = 500;
const ENDPOINT = '/review/sheet-draft';

type FormSlice = Pick<GateFormState, 'selections' | 'texts' | 'notes'>;

/** The form's keys for the two questions the draft cares about. The sheet
    keys selections by the COLLAPSED question ids (`collapseChunks`), so
    `findings` is the one multi; a bare gate may still carry its
    `findings-N` chunks, which count too. */
export interface SheetNames {
  findings?: string;
  outcome?: string;
}

/** The form as a draft on `gateId`. `findingIds` are every finding the
    sheet shows, so a later restore can tell an unticked finding from one it
    never saw. */
export function snapshotSheet(
  form: FormSlice,
  names: SheetNames,
  findingIds: string[],
  gateId: string
): SheetDraft {
  const ticked = new Set<string>();
  const base = names.findings;
  if (base !== undefined) {
    for (const [name, value] of Object.entries(form.selections)) {
      const isChunk = name === base || /^-\d+$/.test(name.slice(base.length));
      if (name.startsWith(base) && isChunk && Array.isArray(value))
        for (const id of value) ticked.add(id);
    }
  }
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(form.texts))
    if (key.startsWith(commentKey('')) || key.startsWith(summaryKey('')))
      texts[key] = value;
  const outcome =
    names.outcome !== undefined ? form.selections[names.outcome] : undefined;
  return {
    ticked: [...ticked],
    known: [...findingIds],
    texts,
    ...(typeof outcome === 'string' ? { outcome } : {}),
    notes: { ...form.notes },
    gateId,
  };
}

export type RestoreOp =
  | { op: 'tick'; id: string; on: boolean }
  | { op: 'text'; key: string; value: string }
  | { op: 'outcome'; value: string }
  | { op: 'note'; key: string; value: string };

/** What to apply to a freshly seeded form to bring a saved draft back.
    Only findings the draft knew (`known`) and the gate still has are
    touched: a finding new to this gate keeps its default tick and draft, and
    a draft with no `known` restores nothing. `revisedIds` are the findings
    the gate on screen carries a revision for: they keep their tick but lose
    the saved comment text, so the agent's new draft shows instead of the
    edit it replaces. */
export function restoreOps(
  draft: SheetDraft,
  findingIds: string[],
  revisedIds: string[]
): RestoreOp[] {
  const known = new Set(draft.known);
  const ids = findingIds.filter(id => known.has(id));
  if (ids.length === 0) return [];
  const restorable = new Set(ids);
  const revised = new Set(revisedIds);
  const ticked = new Set(draft.ticked);
  const ops: RestoreOp[] = ids.map(id => ({
    op: 'tick',
    id,
    on: ticked.has(id),
  }));
  for (const [key, value] of Object.entries(draft.texts)) {
    if (key.startsWith(commentKey(''))) {
      const id = key.slice(commentKey('').length);
      if (!restorable.has(id) || revised.has(id)) continue;
    } else if (!key.startsWith(summaryKey(''))) continue;
    ops.push({ op: 'text', key, value });
  }
  if (draft.outcome !== undefined)
    ops.push({ op: 'outcome', value: draft.outcome });
  for (const [key, value] of Object.entries(draft.notes))
    ops.push({ op: 'note', key, value });
  return ops;
}

const byKey = (a: [string, string], b: [string, string]) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

/** A draft as one string that ignores ordering, so a snapshot compares equal
    to the saved draft it was restored from. */
export function canonicalDraft(d: SheetDraft): string {
  return JSON.stringify({
    ticked: [...d.ticked].sort(),
    known: [...d.known].sort(),
    texts: Object.fromEntries(Object.entries(d.texts).sort(byKey)),
    ...(d.outcome !== undefined ? { outcome: d.outcome } : {}),
    notes: Object.fromEntries(Object.entries(d.notes).sort(byKey)),
    ...(d.gateId !== undefined ? { gateId: d.gateId } : {}),
  });
}

/** Restores the MR's saved draft once per gate, then saves each change
    (debounced) so the next rebuilt gate can do the same.

    The save baseline is the draft as fetched, not the form after the
    restore: whatever the restore changed (a revised comment dropped, a
    finding new to the gate added) differs from it and is saved, so the next
    gate does not bring the dropped edit back. A gate with nothing saved
    takes its first post-restore render as the baseline, so it writes
    nothing until the reviewer changes something; so does a gate whose saved
    draft belongs to another gate (`draftRestorableOn`), which keeps a draft
    the board cannot place (its predecessor gone from the gate cache) from
    being overwritten by a sheet that never touched it. A restored draft
    saves again under the gate on screen, so the next gate it supersedes
    still finds it. Saving waits for the
    restore, which keeps a fresh gate's seeded defaults from overwriting the
    draft before it is read; a failed read leaves saving off for that gate
    rather than risk replacing a draft it could not see. Saving stops at a
    submit (until one fails): the board deletes the draft once the review is
    submitted, and a late write would bring it back. */
export function useSheetDraft(
  mrUrl: string | undefined,
  form: FormSlice &
    Pick<GateFormState, 'busy' | 'failed'> & {
      toggleMulti: GateFormState['toggleMulti'];
      setText: GateFormState['setText'];
      setSingle: GateFormState['setSingle'];
      setNote: GateFormState['setNote'];
    },
  names: SheetNames,
  findingIds: string[],
  revisedIds: string[],
  gateId: string
): void {
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  // `json` is null until the first post-restore render fills it in (a gate
  // with nothing saved).
  const baseline = useRef<{ gateId: string; json: string | null } | null>(null);
  const submitted = useRef(false);
  const pending = useRef<{ mrUrl: string; draft: SheetDraft } | null>(null);
  // Read at restore time, not at effect-dependency time: the ids belong to
  // the gate the restore runs for, and re-running on their identity would
  // restore twice.
  const latest = useRef({ form, names, findingIds, revisedIds });
  latest.current = { form, names, findingIds, revisedIds };

  const put = (url: string, draft: SheetDraft) => {
    void fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mrUrl: url, draft }),
      keepalive: true,
    }).catch(() => {});
  };

  useEffect(() => {
    if (!mrUrl) return;
    let live = true;
    fetch(
      `${ENDPOINT}?mr=${encodeURIComponent(mrUrl)}&gate=${encodeURIComponent(gateId)}`
    )
      .then(r =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status)))
      )
      .then(body => {
        if (!live) return;
        const reply = parseSheetDraftReply(body);
        const draft =
          reply.draft &&
          draftRestorableOn(reply.draft, gateId, reply.previousGateId)
            ? reply.draft
            : null;
        if (draft) {
          const cur = latest.current;
          const outcomeName = cur.names.outcome;
          const findingsName = cur.names.findings;
          for (const o of restoreOps(draft, cur.findingIds, cur.revisedIds)) {
            if (o.op === 'tick' && findingsName)
              cur.form.toggleMulti(findingsName, o.id, o.on);
            else if (o.op === 'text') cur.form.setText(o.key, o.value);
            else if (o.op === 'outcome' && outcomeName)
              cur.form.setSingle(outcomeName, o.value);
            else if (o.op === 'note') cur.form.setNote(o.key, o.value);
          }
        }
        baseline.current = {
          gateId,
          json: draft ? canonicalDraft(draft) : null,
        };
        submitted.current = false;
        setRestoredFor(gateId);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mrUrl, gateId]);

  const snapshot = snapshotSheet(form, names, findingIds, gateId);
  const json = canonicalDraft(snapshot);
  useEffect(() => {
    const base = baseline.current;
    if (!mrUrl || restoredFor !== gateId || base?.gateId !== gateId) return;
    if (base.json === null) {
      base.json = json;
      return;
    }
    // A submit stops saving for good unless it fails: the answer was sent (or
    // lost to another), and the board deletes the draft either way.
    if (form.busy) submitted.current = true;
    else if (form.failed) submitted.current = false;
    if (submitted.current || json === base.json) {
      pending.current = null;
      return;
    }
    const draft = JSON.parse(json) as SheetDraft;
    pending.current = { mrUrl, draft };
    const timer = setTimeout(() => {
      pending.current = null;
      base.json = json;
      put(mrUrl, draft);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mrUrl, gateId, restoredFor, json, form.busy, form.failed]);

  // The gate closing mid-debounce (a revision rebuilds it) must not lose the
  // last edit. A submit clears `pending` above, so this never revives a draft
  // the board is about to delete.
  useEffect(
    () => () => {
      const p = pending.current;
      if (p) put(p.mrUrl, p.draft);
    },
    []
  );
}
