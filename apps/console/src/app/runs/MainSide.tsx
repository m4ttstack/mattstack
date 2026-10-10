import type { CSSProperties, ReactNode } from 'react';

import classes from './MainSide.module.css';

export interface MainSideProps {
  main: ReactNode;
  /** The fixed-width column beside the main one; none leaves main alone. */
  side?: ReactNode;
  sideWidth?: number;
  gap?: number;
}

/** A page body's main column with a fixed side column beside it, stacked
    under it on a narrow window. */
export function MainSide({
  main,
  side,
  sideWidth = 340,
  gap = 20,
}: MainSideProps) {
  return (
    <div
      className={classes.columns}
      style={
        { '--side-w': `${sideWidth}px`, '--gap': `${gap}px` } as CSSProperties
      }
    >
      <div className={classes.main}>{main}</div>
      {side ? <div className={classes.side}>{side}</div> : null}
    </div>
  );
}
