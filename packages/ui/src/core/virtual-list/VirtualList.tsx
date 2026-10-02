import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ScrollArea } from '@mantine/core';
import type { ScrollAreaAutosizeProps } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

/** The first and last index of the items inside the viewport, overscan
    excluded. */
export interface VirtualListWindow {
  first: number;
  last: number;
}

/** Where each item sits in the scroll content, in px: measured once it has
    rendered, estimated until then. */
export interface VirtualListLayout {
  start: (index: number) => number;
  end: (index: number) => number;
  visible: VirtualListWindow | null;
}

export interface VirtualListProps<T = unknown> {
  /** Items to render. Only the ones currently in view (plus overscan) are mounted. */
  items: T[];
  /**
   * Renders a single item. Receives the item, its absolute index in `items`,
   * and the items inside the viewport (`null` until the list has a size).
   */
  renderRow: (
    item: T,
    index: number,
    visible: VirtualListWindow | null
  ) => ReactNode;
  /**
   * Estimated size (height, in px) of a row, used before it's actually
   * measured. Can vary per index. @default () => 45
   */
  estimateSize?: (index: number) => number;
  /** Rows to render above/below the visible window. @default 20 */
  overscan?: number;
  /** Max height of the scrollable viewport. @default '20vh' */
  maxHeight?: string | number;
  /** Min height of the scrollable viewport. @default 'auto' */
  minHeight?: string | number;
  /** Key for each item; defaults to its index. */
  getItemKey?: (item: T, index: number) => string | number;
  /**
   * Index of the item to bring to the top of the viewport. Applied on mount,
   * whenever the value changes, and once `items` goes from empty to
   * non-empty; `null` or `undefined` leaves the scroll position alone.
   */
  scrollToIndex?: number | null;
  /**
   * Extra props for the outer `ScrollArea.Autosize` scroll container (the
   * same prop name `PageShell.Content` uses for the same concept).
   * `viewportRef` is excluded: the virtualizer owns the viewport ref.
   */
  scrollAreaProps?: Omit<ScrollAreaAutosizeProps, 'viewportRef'>;
  /**
   * Drawn over the rows in the scroll content, which is positioned but never
   * shifted, so an absolutely placed child can span several rows and a
   * sticky one sticks to the viewport.
   */
  renderOverlay?: (layout: VirtualListLayout) => ReactNode;
}

/**
 * Windowed list on `@tanstack/react-virtual`: only the rows currently
 * scrolled into view (plus `overscan`) are ever mounted, so `items` can hold
 * tens of thousands of rows without tens of thousands of DOM nodes.
 */
export function VirtualList<T>({
  items,
  renderRow,
  estimateSize = () => 45,
  overscan = 20,
  maxHeight = '20vh',
  minHeight = 'auto',
  getItemKey,
  scrollToIndex,
  scrollAreaProps,
  renderOverlay,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
    getItemKey: getItemKey
      ? index => getItemKey(items[index], index)
      : undefined,
  });

  const hasItems = items.length > 0;
  useEffect(() => {
    if (scrollToIndex == null || !hasItems) return;
    virtualizer.scrollToIndex(scrollToIndex, { align: 'start' });
  }, [virtualizer, scrollToIndex, hasItems]);

  const virtualRows = virtualizer.getVirtualItems();
  // Read after getVirtualItems, which recomputes the range for this render.
  const range = virtualizer.range;
  const visible = range
    ? { first: range.startIndex, last: range.endIndex }
    : null;

  return (
    <ScrollArea.Autosize
      viewportRef={scrollRef}
      mah={maxHeight}
      mih={minHeight}
      type="auto"
      scrollbarSize={8}
      {...scrollAreaProps}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRows[0]?.start ?? 0}px)`,
          }}
        >
          {virtualRows.map(virtualRow => (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
            >
              {renderRow(items[virtualRow.index], virtualRow.index, visible)}
            </div>
          ))}
        </div>
        {renderOverlay?.({
          start: index => virtualizer.measurementsCache[index]?.start ?? 0,
          end: index => virtualizer.measurementsCache[index]?.end ?? 0,
          visible,
        })}
      </div>
    </ScrollArea.Autosize>
  );
}
