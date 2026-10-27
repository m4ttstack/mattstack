import type { CSSProperties } from 'react';
import { useLocalStorage } from '@mattstack/app-kit/hooks';

import classes from './PaneResizer.module.css';

const STEP = 24;

export type PaneBounds = { initial: number; min: number; max: number };

const clampTo = (bounds: PaneBounds, width: number) =>
  Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));

/** A pane's width, kept per browser under `key` and held to its bounds even
    when a saved value predates them. */
export function usePaneWidth(
  key: string,
  bounds: PaneBounds
): [number, (width: number) => void] {
  const [stored, setStored] = useLocalStorage<number>({
    key,
    defaultValue: bounds.initial,
  });
  return [clampTo(bounds, stored ?? bounds.initial), setStored];
}

/** The line between two panes, dragged or arrowed to size the one on its
    left. The caller places it over that line with `style`. */
export function PaneResizer({
  width,
  onWidth,
  bounds,
  label,
  style,
  testId,
}: {
  width: number;
  onWidth: (width: number) => void;
  bounds: PaneBounds;
  label: string;
  style: CSSProperties;
  testId?: string;
}) {
  const clamp = (next: number) => clampTo(bounds, next);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      className={classes.resizer}
      style={style}
      data-testid={testId}
      onPointerDown={event => {
        // No text selection starts under the drag, and none is made while it
        // runs over either pane.
        event.preventDefault();
        const handle = event.currentTarget;
        const startX = event.clientX;
        const startWidth = width;
        handle.setPointerCapture(event.pointerId);
        const body = document.body.style;
        const before = { select: body.userSelect, cursor: body.cursor };
        body.userSelect = 'none';
        body.cursor = 'col-resize';
        document.body.dataset.paneResizing = '';
        const move = (e: PointerEvent) =>
          onWidth(clamp(startWidth + e.clientX - startX));
        const up = () => {
          body.userSelect = before.select;
          body.cursor = before.cursor;
          delete document.body.dataset.paneResizing;
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      }}
      onKeyDown={event => {
        const by =
          event.key === 'ArrowLeft'
            ? -STEP
            : event.key === 'ArrowRight'
              ? STEP
              : 0;
        if (by === 0) return;
        event.preventDefault();
        onWidth(clamp(width + by));
      }}
    />
  );
}
