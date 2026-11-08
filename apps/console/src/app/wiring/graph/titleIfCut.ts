import type { MouseEvent } from 'react';

/** A row's hover: names the full text only when the row has cut it, so a name
    that fits does not repeat itself in a tooltip. */
export function titleIfCut(text: string) {
  return (event: MouseEvent<HTMLElement>) => {
    const el = event.currentTarget;
    el.title = el.scrollWidth > el.clientWidth ? text : '';
  };
}
