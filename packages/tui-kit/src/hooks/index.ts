import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { pushLayer, handleEscape } from "./layers.ts";
import { acquireScrollLock, releaseScrollLock } from "./scroll-lock.ts";

// Re-exported so a consumer importing only the `./hooks` subpath can still
// exercise the DOM-free cores in its own tests.
export { pushLayer, handleEscape, acquireScrollLock, releaseScrollLock };
export type { OverflowTarget } from "./scroll-lock.ts";

/** Scrolls the returned ref's element into its scroll container whenever `key`
    turns truthy or changes, for content that can render below the fold of a
    height-capped modal. `block: "nearest"` is deliberate: it is a no-op when
    the element is already visible, so this never yanks a settled modal around. */
function useRevealOnChange<T extends HTMLElement = HTMLElement>(key: unknown) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (key) ref.current?.scrollIntoView({ block: "nearest" });
  }, [key]);
  return ref;
}

// One shared document listener for all layers, registered on the first push
// and torn down on the last pop.
let openLayers = 0;
let escListener: ((e: KeyboardEvent) => void) | null = null;

/** Join the app's layer stack for the calling component's lifetime: Escape
    closes only the topmost open layer, not every one at once. The pushed
    closure's identity never changes (once per mount, not once per render), so
    a re-rendered lower layer cannot re-register itself to the top of the
    stack; `onClose` is read through a ref kept current every render. */
function useEscapeClose(onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const pop = pushLayer(() => onCloseRef.current());
    openLayers++;
    if (!escListener) {
      escListener = (e: KeyboardEvent) => {
        if (e.key === "Escape") handleEscape();
      };
      document.addEventListener("keydown", escListener);
    }
    return () => {
      pop();
      openLayers--;
      if (openLayers === 0 && escListener) {
        document.removeEventListener("keydown", escListener);
        escListener = null;
      }
    };
  }, []);
}

/** Auto-grow a textarea to fit its content, re-measuring whenever `deps`
    changes. Two traps, both load-bearing: reset to "auto" first or the box can
    only ever grow (scrollHeight is clamped by the current height, so deleting
    text would leave the extra rows behind); and add the border back, because
    scrollHeight covers content + padding but not the border while border-box
    `height` is responsible for it. The border is measured off the element
    rather than hardcoded, so it survives a CSS change. */
function useAutoGrowTextarea(deps: readonly unknown[]): RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, deps);
  return ref;
}

/** Lock body scroll for the calling component's lifetime. Counter-based (see
    scroll-lock.ts) so instances need not unmount in mount order. */
function useBodyScrollLock(): void {
  useEffect(() => {
    acquireScrollLock(document.body.style);
    return () => {
      releaseScrollLock(document.body.style);
    };
  }, []);
}

/** One transient toast: a fresh id per addToast() call and the text to show.
    `state` marks a toast that tracks work: `pending` draws a spinner until the
    work settles, `done` a check. A plain toast has none. */
interface Toast {
  id: number;
  text: string;
  state?: "pending" | "done";
}

/** Settles a toast that `startToast` opened, in place. */
interface ToastHandle {
  done: (text: string) => void;
  fail: (text: string) => void;
}

const TOAST_MS = 3500;
const DONE_MS = 2000;
/** A pending toast whose work never answers still leaves. */
const PENDING_MS = 30000;

/** Transient toast queue: each addToast() call appends one with a fresh id and
    self-removes it after 3.5s. startToast() opens a pending toast that stays
    until its handle settles it: done swaps in a check and leaves after 2s,
    fail swaps in plain text and leaves after 3.5s. */
function useToasts(): {
  toasts: Toast[];
  addToast: (text: string) => void;
  startToast: (text: string) => ToastHandle;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const expire = useCallback((id: number, ms: number) => {
    return setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  const addToast = useCallback(
    (text: string) => {
      const id = ++toastId.current;
      setToasts((t) => [...t, { id, text }]);
      expire(id, TOAST_MS);
    },
    [expire],
  );
  const startToast = useCallback(
    (text: string): ToastHandle => {
      const id = ++toastId.current;
      setToasts((t) => [...t, { id, text, state: "pending" }]);
      let timer: ReturnType<typeof setTimeout> | undefined = expire(id, PENDING_MS);
      const settle = (next: Toast, ms: number) => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        setToasts((t) => t.map((x) => (x.id === id ? next : x)));
        expire(id, ms);
      };
      return {
        done: (doneText) => settle({ id, text: doneText, state: "done" }, DONE_MS),
        fail: (failText) => settle({ id, text: failText }, TOAST_MS),
      };
    },
    [expire],
  );
  return { toasts, addToast, startToast };
}

export { useRevealOnChange, useEscapeClose, useAutoGrowTextarea, useBodyScrollLock, useToasts };
export type { Toast, ToastHandle };
