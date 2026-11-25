import type { SealBinding } from '@mattstack/rt-client';
import { askWireType, type AskKind, type NudgeResult } from './envelope.ts';
import type { NudgeState } from './nudges.ts';
import {
  askBinding,
  openOnce,
  type OpenText,
  type SealedReader,
} from './sealed.ts';

export const ASK_HISTORY_MS = 14 * 24 * 60 * 60_000;

export interface AskView {
  id: string;
  from: string;
  kind: AskKind;
  mrUrl: string;
  iid: number;
  title?: string;
  sourceBranch?: string;
  note?: string;
  /** Why the title, branch and note are not here: this Mac cannot open them
      yet, or never will. */
  textState?: 'pending' | 'unreadable';
  receivedAt: number;
  handled?: {
    at: number;
    result: NudgeResult;
    reason?: string;
    note?: string;
    declined?: true;
  };
}

function bindingOf(n: NudgeState): SealBinding {
  const type = askWireType(n.kind);
  return askBinding({ type, from: n.from, id: n.id }, n.mrUrl);
}

/** An ask's title for a notice shown once, from a process that does not stay
    to try again. */
export async function openAskTitle(
  n: NudgeState,
  open: OpenText
): Promise<string | undefined> {
  if (!n.sealed) return n.title;
  const read = await openOnce(open, n.sealed, bindingOf(n));
  return read.state === 'open' ? read.fields.title : undefined;
}

function askText(
  n: NudgeState,
  reader: SealedReader | undefined
): Pick<AskView, 'title' | 'sourceBranch' | 'note' | 'textState'> {
  if (!n.sealed) return n;
  const read = reader?.read(n.sealed, bindingOf(n)) ?? { state: 'pending' };
  if (read.state !== 'open') return { textState: read.state };
  const { title, sourceBranch, note } = read.fields;
  return { title, sourceBranch, note };
}

function view(n: NudgeState, reader: SealedReader | undefined): AskView {
  const text = askText(n, reader);
  return {
    id: n.id,
    from: n.from,
    kind: n.kind ?? 're-review',
    mrUrl: n.mrUrl,
    iid: n.iid,
    receivedAt: n.receivedAt,
    ...(text.title ? { title: text.title } : {}),
    ...(text.sourceBranch ? { sourceBranch: text.sourceBranch } : {}),
    ...(text.note ? { note: text.note } : {}),
    ...(text.textState ? { textState: text.textState } : {}),
    ...(n.handled ? { handled: n.handled } : {}),
  };
}

export function buildAskInbox(
  nudges: NudgeState[],
  now: number,
  reader?: SealedReader
): { pending: AskView[]; history: AskView[] } {
  const pending = nudges
    .filter(n => !n.handled)
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .map(n => view(n, reader));
  const history = nudges
    .filter(n => n.handled && now - n.handled.at <= ASK_HISTORY_MS)
    .sort((a, b) => b.handled!.at - a.handled!.at)
    .map(n => view(n, reader));
  return { pending, history };
}
