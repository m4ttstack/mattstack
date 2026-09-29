import classes from './ui.module.css';

export function LeaderMark({
  size = 16,
  parity,
}: {
  size?: 16;
  parity?: string;
}) {
  return (
    <span
      className={classes.leaderMark}
      data-parity={parity}
      style={{ width: size, height: size }}
    >
      <span
        className={`${classes.num} ${classes.text} ${classes.leaderNumeral}`}
        data-parity="n"
      >
        1
      </span>
    </span>
  );
}
