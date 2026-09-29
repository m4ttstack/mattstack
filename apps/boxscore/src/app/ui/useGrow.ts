import type { CSSProperties } from 'react';

import { useReducedMotion } from '@mattstack/app-kit/hooks';
import classes from './grow.module.css';

export type GrowAxis = 'x' | 'y' | 'fade';

/** Past this many items the stagger stops growing, so a long list never waits on its tail. */
const STAGGER_CAP = 12;

export interface Grow {
  className: string;
  style: CSSProperties;
}

const STILL: Grow = { className: '', style: {} };

/**
 * The shared mount animation for bar-like marks: `y` rises from the
 * baseline, `x` extends from the left, `fade` fades in. It replays only on
 * mount, so a caller that must replay on a new subject keys the subtree.
 */
export function useGrow(): (axis: GrowAxis, index?: number) => Grow {
  const reduced = useReducedMotion(false, { getInitialValueInEffect: false });
  return (axis, index = 0) =>
    reduced
      ? STILL
      : {
          className: classes[axis]!,
          style: {
            '--grow-i': Math.min(index, STAGGER_CAP),
          } as CSSProperties,
        };
}
