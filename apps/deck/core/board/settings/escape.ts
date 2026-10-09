import type { KeyboardEvent } from 'react';

/** Escape in a settings input that holds text clears that draft and keeps
    the modal open; in an empty input it falls through, so the modal closes.
    Stopping the React event is enough: React listens at the root container,
    below the `document` listener the kit Modal closes on. Returns whether it
    handled the key. */
export function escapeClearsDraft(
  ev: KeyboardEvent,
  value: string,
  clear: () => void
): boolean {
  if (ev.key !== 'Escape' || value === '') return false;
  ev.stopPropagation();
  clear();
  return true;
}
