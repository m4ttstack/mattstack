/** Where the Rendered view reads a skill from: its compiled file, a husk
    pack's full text from rt, or nothing yet while rt has not said which.
    `settled` is false while the text or the blocks' line ranges refetch. */
export type RenderedSource =
  | { kind: 'file' }
  | { kind: 'husk'; text: string; settled: boolean }
  | { kind: 'pending' }
  | { kind: 'error'; message: string };

export type RenderedSourceInput = {
  /** A board skill or a hand-written one: no compile to take apart. */
  fromFile: boolean;
  /** The blocks are in hand. */
  ready: boolean;
  /** Read from a hand-written file's headings. */
  readOnly: boolean;
  anatomy: { rendered: { husk?: true; text?: string } } | undefined;
  anatomyError: string | null;
  anatomyFetching: boolean;
  blocksFetching: boolean;
};

/**
 * A pack's committed file may be only its husk, so nothing renders from it
 * until rt's anatomy says the pack commits full skills. A husk pack's text
 * and the blocks' ranges come from two reads; `settled` says both landed.
 */
export function renderedSourceOf(input: RenderedSourceInput): RenderedSource {
  if (input.fromFile || !input.ready || input.readOnly) return { kind: 'file' };
  // A failed refetch keeps the last answer: a pack known to commit full skills still reads its file.
  if (input.anatomy && !input.anatomy.rendered.husk) return { kind: 'file' };
  if (input.anatomyError !== null) {
    return { kind: 'error', message: input.anatomyError };
  }
  if (!input.anatomy) return { kind: 'pending' };
  return {
    kind: 'husk',
    text: input.anatomy.rendered.text ?? '',
    settled: !(input.anatomyFetching || input.blocksFetching),
  };
}
