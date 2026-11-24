import { useEffect, useRef } from 'react';

import { TYPING } from './sheet-keys.ts';

/** The console's key for its own waiting gate, so one habit opens both. */
const QUEUE_KEY = 'g';

const LAYER =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Binds `g` on the bare board. An open layer (the queue itself, a drawer, a
    menu with its type-to-find) keeps its keys, as does a text field. */
function useQueueKey(onOpen: () => void): void {
  const latest = useRef(onOpen);
  latest.current = onOpen;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== QUEUE_KEY || e.defaultPrevented) return;
      if (e.isComposing || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(TYPING)) return;
      if (document.querySelector(LAYER)) return;
      e.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

export { QUEUE_KEY, useQueueKey };
