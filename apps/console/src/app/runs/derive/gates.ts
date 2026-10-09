import {
  optionLabel,
  optionValue,
  stripRecommended,
  unwrapGateAnswer,
} from '@mattstack/gate-kit';
import type {
  GateAnswer,
  GateQuestion,
  GateRow,
  RunStageRow,
} from '@mattstack/rt-client';

export function decisionLogForRun(gates: GateRow[], runId: string): GateRow[] {
  const subject = `run:${runId}`;
  return gates
    .filter(g => g.subject === subject)
    .sort((a, b) => a.openedAt - b.openedAt);
}

export function gateStage(gate: GateRow, stages: RunStageRow[]): string | null {
  const stamped = gate.meta?.stage;
  if (typeof stamped === 'string' && stamped) return stamped;
  let found: string | null = null;
  let foundStart = -Infinity;
  for (const s of stages) {
    if (s.started_at == null || s.started_at > gate.openedAt) continue;
    if (s.ended_at != null && gate.openedAt >= s.ended_at) continue;
    if (s.started_at >= foundStart) {
      found = s.name;
      foundStart = s.started_at;
    }
  }
  return found;
}

/** What the answer says about one question: the picked option values, and the
    note or edited reply text that rode with them. Null when the gate has no
    answer or the answer skips the question. */
export function questionAnswer(
  answer: GateAnswer | null,
  question: GateQuestion
): { picked: string[]; note?: string; text?: string } | null {
  const raw = answer?.answers[question.id];
  if (raw == null) return null;
  const { value, note, text } = unwrapGateAnswer(raw);
  return {
    picked: Array.isArray(value) ? value : [value],
    ...(note !== undefined ? { note } : {}),
    ...(text !== undefined ? { text } : {}),
  };
}

export interface OptionView {
  value: string;
  /** The label with its recommended marker lifted off. */
  text: string;
  recommended: boolean;
}

export function optionViews(question: GateQuestion): OptionView[] {
  return question.options.map(o => {
    const { text, recommended } = stripRecommended(optionLabel(o));
    return { value: optionValue(o), text, recommended: recommended === true };
  });
}

/** The picked options' labels, joined; a value no option carries shows as it
    is. */
export function pickedText(question: GateQuestion, picked: string[]): string {
  const views = optionViews(question);
  return picked.map(v => views.find(o => o.value === v)?.text ?? v).join(', ');
}

/** Why a gate that is past answering ended: "closed: abandoned",
    "superseded", or plain "closed". Null for any gate not closed. */
export function gateEndNote(gate: GateRow): string | null {
  if (gate.status !== 'closed') return null;
  if (gate.closedReason === 'superseded') return 'superseded';
  return gate.closedReason ? `closed: ${gate.closedReason}` : 'closed';
}

/** A gate kind as words: `review-post` is "Review post". */
export function gateKindLabel(kind: string): string {
  const words = kind.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function tookRecommendation(
  question: GateQuestion,
  answer: GateAnswer | null
): boolean | null {
  const recommended = question.options
    .filter(o => stripRecommended(optionLabel(o)).recommended)
    .map(optionValue);
  if (!answer || recommended.length === 0) return null;
  const picked = questionAnswer(answer, question)?.picked ?? [];
  if (picked.length === 0) return null;
  return picked.every(p => recommended.includes(p));
}

export function waitingOnYou(gates: GateRow[], now: number): number {
  const spans = gates
    .map(g => [g.openedAt, g.answer?.answeredAt ?? g.closedAt ?? now] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of spans) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  return cur ? total + cur[1] - cur[0] : total;
}

const CLI_LINE = /^(?:jest|bun|pnpm|npm|git|rt)\s+\S/;

function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/:$/, '')
    .trim();
}

/** An option description split into its prose and the one command it names:
    the text after `From <dir>:`, a backticked span, or a line that starts
    with a CLI word. */
export function splitCommand(description: string): {
  prose: string;
  command: string | null;
} {
  const text = description.trim();
  const from = /^(From \S+):\s+(.+?)(?:,\s+(.+)|\.)?$/s.exec(text);
  if (from) {
    const [, dir, command, rest] = from;
    return {
      prose: rest ? `${dir}, ${rest}` : `${dir}.`,
      command: command!.trim(),
    };
  }
  const ticked = /`([^`]+)`/.exec(text);
  if (ticked) {
    return {
      prose: tidy(text.replace(ticked[0], ' ')),
      command: ticked[1]!.trim(),
    };
  }
  const lines = text.split('\n');
  const at = lines.findIndex(l => CLI_LINE.test(l.trim()));
  if (at >= 0) {
    return {
      prose: tidy(lines.filter((_, i) => i !== at).join(' ')),
      command: lines[at]!.trim(),
    };
  }
  return { prose: text, command: null };
}

export interface ContextPoint {
  label: string;
  text: string;
}

export type ContextBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'points'; points: ContextPoint[] };

const POINT =
  /^[-*]\s+(?:\*\*([^*:`]{1,24}?):?\*\*:?|([^*:`\s][^:`]{0,23}?):)\s+(.+)$/;

/** Gate context as Markdown with its "Label: text" bullet lists lifted out,
    so labelled points can draw as a label column. A list becomes points only
    when every item has a label; a fenced line never does. */
export function contextBlocks(text: string): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  let markdown: string[] = [];
  let list: string[] = [];
  let fenced = false;
  const flushMarkdown = () => {
    const body = markdown.join('\n').trim();
    if (body) blocks.push({ kind: 'markdown', text: body });
    markdown = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    const matches = list.map(line => POINT.exec(line));
    if (matches.every(m => m !== null)) {
      flushMarkdown();
      blocks.push({
        kind: 'points',
        points: matches.map(m => ({
          label: (m![1] ?? m![2])!.trim(),
          text: m![3]!.trim(),
        })),
      });
    } else {
      markdown.push(...list);
    }
    list = [];
  };
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^[-*]\s+\S/.test(line)) {
      list.push(line);
      continue;
    }
    flushList();
    markdown.push(line);
  }
  flushList();
  flushMarkdown();
  return blocks;
}
