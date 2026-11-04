import { useState } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaneResizer, usePaneWidth } from './PaneResizer';

const BOUNDS = { initial: 300, min: 240, max: 480 };
const KEY = 'test-pane-width';

afterEach(() => {
  window.localStorage.clear();
  delete document.body.dataset.paneResizing;
});

describe('usePaneWidth', () => {
  it('starts at the initial width when nothing is saved', () => {
    const { result } = renderHook(() => usePaneWidth(KEY, BOUNDS));
    expect(result.current[0]).toBe(300);
  });

  it('keeps a width it was given, per browser, under its key', () => {
    const { result } = renderHook(() => usePaneWidth(KEY, BOUNDS));
    act(() => result.current[1](360));

    expect(result.current[0]).toBe(360);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toBe(360);
  });

  it('reads a saved width back on the next mount', () => {
    window.localStorage.setItem(KEY, '420');
    const { result } = renderHook(() => usePaneWidth(KEY, BOUNDS));
    expect(result.current[0]).toBe(420);
  });

  it('holds a saved width that predates the bounds to them', () => {
    window.localStorage.setItem(KEY, '900');
    expect(renderHook(() => usePaneWidth(KEY, BOUNDS)).result.current[0]).toBe(
      480
    );
    window.localStorage.setItem(`${KEY}-2`, '10');
    expect(
      renderHook(() => usePaneWidth(`${KEY}-2`, BOUNDS)).result.current[0]
    ).toBe(240);
  });
});

function Harness({ onWidth }: { onWidth?: (width: number) => void }) {
  const [width, setWidth] = useState(BOUNDS.initial);
  return (
    <PaneResizer
      width={width}
      onWidth={next => {
        onWidth?.(next);
        setWidth(next);
      }}
      bounds={BOUNDS}
      label="Resize the list"
      style={{ left: width - 4 }}
      testId="resizer"
    />
  );
}

const resizer = () =>
  screen.getByRole('separator', { name: 'Resize the list' });

describe('PaneResizer', () => {
  it('is a vertical separator that says its width and bounds', () => {
    renderWithProviders(<Harness />);

    const handle = resizer();
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    expect(handle).toHaveAttribute('aria-valuemin', '240');
    expect(handle).toHaveAttribute('aria-valuemax', '480');
    expect(handle).toHaveAttribute('tabindex', '0');
  });

  it('steps 24px with the arrow keys, within its bounds', () => {
    renderWithProviders(<Harness />);

    fireEvent.keyDown(resizer(), { key: 'ArrowRight' });
    expect(resizer()).toHaveAttribute('aria-valuenow', '324');
    for (let i = 0; i < 3; i++)
      fireEvent.keyDown(resizer(), { key: 'ArrowLeft' });
    expect(resizer()).toHaveAttribute('aria-valuenow', '252');
    fireEvent.keyDown(resizer(), { key: 'ArrowLeft' });
    expect(resizer()).toHaveAttribute('aria-valuenow', '240');
    for (let i = 0; i < 12; i++)
      fireEvent.keyDown(resizer(), { key: 'ArrowRight' });
    expect(resizer()).toHaveAttribute('aria-valuenow', '480');
  });

  it('ignores any other key', () => {
    const onWidth = vi.fn();
    renderWithProviders(<Harness onWidth={onWidth} />);

    fireEvent.keyDown(resizer(), { key: 'ArrowUp' });
    fireEvent.keyDown(resizer(), { key: 'Enter' });
    expect(onWidth).not.toHaveBeenCalled();
  });

  it('sizes the pane as it is dragged, held to its bounds', () => {
    renderWithProviders(<Harness />);
    const handle = resizer();
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 560 });
    expect(handle).toHaveAttribute('aria-valuenow', '360');
    fireEvent.pointerMove(handle, { clientX: 2000 });
    expect(handle).toHaveAttribute('aria-valuenow', '480');
    fireEvent.pointerMove(handle, { clientX: 0 });
    expect(handle).toHaveAttribute('aria-valuenow', '240');
    fireEvent.pointerUp(handle);

    fireEvent.pointerMove(handle, { clientX: 560 });
    expect(handle).toHaveAttribute('aria-valuenow', '240');
  });

  it('marks the page as resizing, with no text selection, only while the drag runs', () => {
    renderWithProviders(<Harness />);
    const handle = resizer();
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    expect(document.body.dataset.paneResizing).toBe('');
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);

    fireEvent.pointerUp(handle);
    expect(document.body.dataset.paneResizing).toBeUndefined();
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('ends the drag when the pointer is cancelled', () => {
    renderWithProviders(<Harness />);
    const handle = resizer();
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerCancel(handle);
    expect(document.body.dataset.paneResizing).toBeUndefined();
  });
});
