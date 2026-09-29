import { useState, type FocusEvent } from 'react';

import classes from './row-hover.module.css';

/** Props that mark a row while the pointer is over it or focus is inside it. */
export function useRowHover(you = false) {
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  return {
    className: classes.row,
    'data-hover': pointer || focus ? '' : undefined,
    'data-you': you ? '' : undefined,
    onMouseEnter: () => setPointer(true),
    onMouseLeave: () => setPointer(false),
    onFocus: () => setFocus(true),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
        setFocus(false);
    },
  };
}
