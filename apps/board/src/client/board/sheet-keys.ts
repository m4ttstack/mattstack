import { useEffect, useRef } from 'react';

export type SheetKey = { kind: 'submit' } | { kind: 'pick'; index: number };

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

const TYPING =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])';

/** A key reaches a gate sheet only when the sheet is the topmost dialog
    around it: a modal opened over the sheet (the full diff) keeps its keys.
    Focus on the page itself counts as the open sheet's. */
function inGateSheet(target: EventTarget | null): boolean {
  const dialog =
    target instanceof Element && target !== document.body
      ? target.closest('[role="dialog"]')
      : document.querySelector('[role="dialog"][aria-modal="true"]');
  return dialog?.classList.contains('tui-gate-sheet') ?? false;
}

/** What a keydown means on an open gate sheet: Cmd/Ctrl+Enter submits from
    anywhere in it, a text field included; 1 to `picks` pick an option
    unless the key is being typed into a field. */
function sheetKey(e: KeyLike, picks: number): SheetKey | null {
  if (e.isComposing || !inGateSheet(e.target)) return null;
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
    return e.altKey || e.shiftKey ? null : { kind: 'submit' };
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (!/^[1-9]$/.test(e.key)) return null;
  const index = Number(e.key) - 1;
  if (index >= picks) return null;
  if (e.target instanceof Element && e.target.closest(TYPING)) return null;
  return { kind: 'pick', index };
}

/** Binds a sheet body's keys for its lifetime. `onSubmit` is passed only
    while the submit button is enabled, so a key never submits what a click
    could not; `onPick` takes the 0-based option index. */
function useSheetKeys({
  onSubmit,
  onPick,
  picks = 0,
}: {
  onSubmit?: () => void;
  onPick?: (index: number) => void;
  picks?: number;
}): void {
  const latest = useRef({ onSubmit, onPick, picks });
  latest.current = { onSubmit, onPick, picks };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { onSubmit, onPick, picks } = latest.current;
      const hit = sheetKey(e, onPick ? picks : 0);
      if (!hit) return;
      if (hit.kind === 'submit') {
        if (!onSubmit) return;
        e.preventDefault();
        onSubmit();
        return;
      }
      e.preventDefault();
      onPick?.(hit.index);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

export { sheetKey, useSheetKeys };
