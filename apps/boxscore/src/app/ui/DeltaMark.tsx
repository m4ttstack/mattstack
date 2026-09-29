import type { DeltaTone } from '../model/delta';
import classes from './ui.module.css';

const TONE_COLOR: Record<DeltaTone, string> = {
  better: 'var(--tk-text-ok)',
  worse: 'var(--tk-text-bad)',
  none: 'var(--tk-text-3)',
};

export function DeltaMark({
  text,
  tone,
  parity,
}: {
  text: string;
  tone: DeltaTone;
  parity?: string;
}) {
  return (
    <span
      className={`${classes.num} ${classes.text} ${classes.delta}`}
      data-parity={parity}
      style={{ color: TONE_COLOR[tone] }}
    >
      {text}
    </span>
  );
}
