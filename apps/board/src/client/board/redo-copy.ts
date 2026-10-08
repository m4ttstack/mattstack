import type { Lane } from './row-actions.ts';

const NOUN: Record<Lane, [one: string, many: string]> = {
  review: ['review', 'reviews'],
  respond: ['response', 'responses'],
  doctor: ['doctor run', 'doctor runs'],
};

/** What the redo confirm says. `prior` is how many of the `count` MRs
    already had a run; a bulk launch can mix them with first runs, and then
    it starts rather than redoes. */
export function redoCopy(
  lane: Lane,
  count: number,
  prior = count
): { title: string; body: [string, string]; confirmLabel: string } {
  const [one, many] = NOUN[lane];
  if (count === 1)
    return {
      title: `Redo ${one}?`,
      body: [
        `This will start a new ${one} from scratch.`,
        `This MR already had a ${one}. Are you sure?`,
      ],
      confirmLabel: `Redo ${one}`,
    };
  const verb = prior >= count ? 'Redo' : 'Start';
  return {
    title: `${verb} ${count} ${many}?`,
    body: [
      `This will start ${count} new ${many} from scratch.`,
      prior >= count
        ? `Each of these MRs already had a ${one}. Are you sure?`
        : `${prior} of these MRs already had a ${one}. Are you sure?`,
    ],
    confirmLabel: `${verb} ${count} ${many}`,
  };
}
